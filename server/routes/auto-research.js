import express from 'express';
import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';

import { appSettingsDb, autoResearchDb, userDb, userSettingsDb } from '../database/db.js';
import { extractProjectDirectory } from '../projects.js';
import { resolveStoredPiProviderSelection } from '../pi-runtime/provider-store.js';
import {
  abortAgentRuntimeSession,
  executeAgentTurn,
  getAgentRuntimeSessionStatus,
  mergeRuntimeUsage,
  normalizeRuntimeObservations,
} from '../agent-runtime/index.js';
import { sendAutoResearchCompletionEmail } from '../utils/auto-research-mailer.js';
import { getLocalSessionUserPreferenceContext } from './localKernel.js';
import { readPipelineState } from '../pipeline/state.js';
import { runAutoResearchPreflight, summarizePreflightFailure } from '../pipeline/preflight.js';
import { deriveAutoResearchStageContractSummary, validateAutoResearchStageContract } from '../pipeline/contracts.js';
import { enrichTaskForExecution, loadTaskPromptContext } from '../pipeline/task-prompt-context.js';
import { hashFile, hashJson, hashProjectFiles } from '../pipeline/hash-utils.js';
import { getTransitiveDependencyIds } from '../pipeline/task-graph.js';
import {
  findMissingAcceptedDependencies,
  loadAcceptedDependencyEvidence,
} from '../pipeline/accepted-evidence.js';
import {
  approveResearchSpec,
  createResearchSpecDraft,
  ensureResearchSpec,
  createResearchSpecChangeRequest,
  listResearchSpecChangeRequests,
  loadResearchSpec,
  resolveResearchSpecChangeRequest,
  toResearchSpecPromptView,
  validateResearchSpecCompleteness,
} from '../pipeline/research-spec.js';
import {
  buildTaskEnvelope,
  readTaskEnvelope,
  writeTaskEnvelope,
} from '../pipeline/task-envelope.js';
import {
  captureProtectedFileSnapshot,
  readIntegrityResult,
  readProtectedFileSnapshot,
  restoreProtectedFileSnapshot,
  verifyProtectedFileSnapshot,
  writeDriftReport,
  writeIntegrityResult,
  writeProtectedFileSnapshot,
} from '../pipeline/drift-guard.js';
import {
  buildEvidenceManifest,
  promoteAcceptedEvidence,
  readEvidenceManifest,
  transitionTaskStatus,
  verifyTaskIndependently,
  writeEvidenceManifest,
} from '../pipeline/task-verifier.js';
import { buildAutoResearchResumeMetadata, loadAutoResearchResumeState } from '../pipeline/resume.js';
import { readAutoResearchRunSummary, writeAutoResearchRunJson } from '../pipeline/run-files.js';
import { deriveAutoResearchStateMachine } from '../pipeline/state-machine.js';
import {
  appendAutoResearchRunEvent,
  buildAutoResearchCheckpoint,
  buildAutoResearchHeartbeat,
  buildAutoResearchStageSummary,
  writeAutoResearchCheckpoint,
  writeAutoResearchHeartbeat,
  writeAutoResearchStageSummary,
} from '../pipeline/run-tracker.js';
import { readExecutionMemorySnapshot } from '../execution-memory/summary.js';
import { createExecutionMemoryTracker, wrapWriterWithExecutionMemory } from '../execution-memory/tracker.js';
import { buildResearchAwarePromptPrefix } from '../execution-memory/lessons.js';
import { broadcastTaskMasterProjectUpdate, broadcastTaskMasterTasksUpdate } from '../utils/taskmaster-websocket.js';
import { buildManagedAgentSessionContext } from '../utils/agentSessionEnv.js';
import { createRequestSerializer } from '../utils/requestSerializer.js';

const router = express.Router();

const activeRuns = new Map();

// Starting a run is a read-modify-write over the project: the active-run check,
// the preflight, and createRun are separated by awaits. Serialize per project so
// two concurrent requests cannot both launch a pipeline over the same files.
const serializeProjectStarts = createRequestSerializer(
  (req) => `${req.user?.id ?? 'local'}\u0000${req.params.projectName}`,
);
const TASK_TIMEOUT_MS = Number.parseInt(process.env.AUTO_RESEARCH_TASK_TIMEOUT_MS || '', 10) || 30 * 60 * 1000;
const AUTO_RESEARCH_SENDER_EMAIL_KEY = 'auto_research_sender_email';
const AUTO_RESEARCH_RESEND_API_KEY = 'auto_research_resend_api_key';
const AUTO_RESEARCH_DEFAULT_PERMISSION_MODE = 'auto';
const AUTO_RESEARCH_PERMISSION_MODES = new Set(['auto', 'ask', 'readOnly', 'plan']);
const AUTO_RESEARCH_HEARTBEAT_INTERVAL_MS = 15_000;
const AUTO_RESEARCH_PROMPT_TEMPLATE_VERSION = 'auto-research-v2.1';
const AUTO_RESEARCH_CODE_POLICY_VERSION = process.env.MEDHELP_GIT_COMMIT || 'workspace:0.1.1';
const AUTO_RESEARCH_MAX_MODEL_CALLS = Math.max(1, Number(process.env.AUTO_RESEARCH_MAX_MODEL_CALLS || 200));
const AUTO_RESEARCH_MAX_WALL_CLOCK_MS = Math.max(60_000, Number(process.env.AUTO_RESEARCH_MAX_WALL_CLOCK_MS || 24 * 60 * 60 * 1000));

async function resolveAutoResearchSenderEmail(req, userId) {
  if (req.localKernelSession) {
    const context = await getLocalSessionUserPreferenceContext(req.localKernelSession, { force: true });
    return String(context?.autoResearchSenderEmail || '').trim();
  }
  return String(userSettingsDb.get(userId, AUTO_RESEARCH_SENDER_EMAIL_KEY) || '').trim();
}

function normalizeAutoResearchProvider() {
  return 'pi';
}

function resolveAutoResearchModelSelection(userId, modelId = null) {
  const selection = resolveStoredPiProviderSelection(userId, modelId ? { modelId } : {});
  if (!selection) {
    const error = new Error('Configure an active Pi model for chat before starting Auto Research.');
    error.code = 'PI_PROVIDER_NOT_CONFIGURED';
    throw error;
  }
  return {
    modelId: selection.selectionModelId,
    modelProviderId: selection.providerId,
    modelApi: selection.model.api,
  };
}

function normalizePermissionMode(permissionMode) {
  if (AUTO_RESEARCH_PERMISSION_MODES.has(permissionMode)) {
    return permissionMode;
  }
  return AUTO_RESEARCH_DEFAULT_PERMISSION_MODE;
}

function hasBypassPermissionsConfirmation(body = {}) {
  return body.bypassPermissionsConfirmed === true
    || body.bypassPermissionsConfirmed === 'true'
    || body.confirmBypassPermissions === true
    || body.confirmBypassPermissions === 'true';
}

function abortActiveSession(provider, sessionId) {
  return abortAgentRuntimeSession(normalizeAutoResearchProvider(provider), sessionId);
}

function isSessionActiveForProvider(provider, sessionId) {
  return getAgentRuntimeSessionStatus(normalizeAutoResearchProvider(provider), sessionId).isActive;
}

function serializeRun(run, runtime = null) {
  if (!run) return null;
  return {
    id: run.id,
    projectName: run.project_name,
    projectPath: run.project_path,
    provider: runtime?.provider || run.provider,
    status: run.status,
    sessionId: runtime?.sessionId || run.session_id,
    currentTaskId: run.current_task_id,
    completedTasks: run.completed_tasks,
    totalTasks: run.total_tasks,
    error: run.error,
    metadata: run.metadata || null,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    emailSentAt: run.email_sent_at,
    budget: runtime?.budget || run.metadata?.autoResearchBudget || null,
    budgetUsage: runtime ? {
      modelCalls: Number(runtime.modelCalls || 0),
      estimatedCostUsd: Number(runtime.estimatedCostUsd || 0),
      tokenUsage: runtime.tokenUsage || null,
    } : (run.metadata?.autoResearchBudgetUsage || null),
  };
}

function buildEligibility(profile, pipelineState, activeRun) {
  const reasons = [];

  if (!profile?.notification_email) {
    reasons.push('notification_email_missing');
  }
  if (!pipelineState.hasResearchBrief) {
    reasons.push('research_brief_missing');
  } else if (!pipelineState.researchBriefValid) {
    reasons.push('research_brief_invalid');
  }
  if (!pipelineState.hasTasksFile) {
    reasons.push('tasks_file_missing');
  } else if (!pipelineState.tasksValid) {
    reasons.push('tasks_file_invalid');
  }
  if (pipelineState.hasTasksFile && pipelineState.tasksValid && pipelineState.actionableTaskCount === 0) {
    reasons.push('no_actionable_tasks');
  }
  if (activeRun) {
    reasons.push('run_in_progress');
  }

  return {
    eligible: reasons.length === 0,
    reasons,
  };
}

async function persistRunBootstrapFiles({ runId, projectPath, provider, permissionMode, preflight }) {
  const checkedAt = preflight?.checkedAt || new Date().toISOString();

  await Promise.all([
    writeAutoResearchRunJson(projectPath, runId, 'preflight-report.json', preflight),
    writeAutoResearchRunJson(projectPath, runId, 'run.json', {
      runId,
      projectPath,
      provider,
      permissionMode,
      status: 'queued',
      checkedAt,
      startedAt: checkedAt,
    }),
  ]);
}

async function syncRunSnapshot(runId, runtime = null) {
  const run = autoResearchDb.getRunById(runId);
  if (!run) {
    return;
  }

  await writeAutoResearchRunJson(run.project_path, runId, 'run.json', {
    id: run.id,
    projectName: run.project_name,
    projectPath: run.project_path,
    provider: runtime?.provider || run.provider,
    status: run.status,
    sessionId: runtime?.sessionId || run.session_id,
    currentTaskId: run.current_task_id,
    completedTasks: run.completed_tasks,
    totalTasks: run.total_tasks,
    error: run.error,
    metadata: run.metadata || null,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    emailSentAt: run.email_sent_at,
    updatedAt: new Date().toISOString(),
  });
}

function createTrackingQueue() {
  let queue = Promise.resolve();

  return async (work) => {
    queue = queue.then(work, work);
    return queue;
  };
}

async function writeRunTrackingArtifacts({
  run,
  runtime = null,
  pipelineState,
  currentTask = null,
  completedTask = null,
  heartbeatStatus = null,
  researchSpec = null,
}) {
  if (!run) {
    return;
  }

  const [heartbeat, stageSummary] = await Promise.all([
    buildAutoResearchHeartbeat({
      run,
      runtime,
      pipelineState,
      currentTask,
      heartbeatStatus,
    }),
    buildAutoResearchStageSummary({
      pipelineState,
      currentTask,
      runStatus: heartbeatStatus || run.status,
    }),
  ]);

  await Promise.all([
    writeAutoResearchHeartbeat(run.project_path, run.id, heartbeat),
    writeAutoResearchStageSummary(run.project_path, run.id, stageSummary),
  ]);

  if (completedTask) {
    const nextInputPaths = (pipelineState?.nextTask?.acceptedInputFiles || [])
      .filter((value) => typeof value === 'string');
    const acceptedInputHashes = await hashProjectFiles(run.project_path, nextInputPaths);
    const verificationArtifactHash = completedTask
      ? await hashFile(path.join(
          run.project_path,
          '.pipeline',
          'runs',
          String(run.id),
          'tasks',
          String(completedTask.id),
          'verification.json',
        ))
      : null;
    const checkpoint = buildAutoResearchCheckpoint({
      run,
      pipelineState,
      completedTask,
      researchSpec,
      acceptedInputHashes,
      datasetSnapshotHash: hashJson(acceptedInputHashes),
      promptTemplateVersion: AUTO_RESEARCH_PROMPT_TEMPLATE_VERSION,
      codeCommit: AUTO_RESEARCH_CODE_POLICY_VERSION,
      modelPolicyHash: run.metadata?.autoResearchModelPolicyHash || null,
      verificationArtifactHash,
    });
    await writeAutoResearchCheckpoint(run.project_path, run.id, checkpoint);
  }
}

async function loadRunTrackingForStatus(run) {
  if (!run?.project_path || !run?.id) {
    return null;
  }

  try {
    return await readAutoResearchRunSummary(run.project_path, run.id, { eventLimit: 5 });
  } catch (error) {
    console.warn('[AutoResearch] Failed to read run tracking summary:', error.message);
    return null;
  }
}

async function loadRunExecutionMemoryForStatus(run) {
  if (!run?.project_path || !run?.id) {
    return null;
  }

  try {
    const snapshot = await readExecutionMemorySnapshot({
      scope: 'run',
      projectPath: run.project_path,
      runId: run.id,
      provider: run.provider || null,
      sessionId: run.session_id || null,
    }, { ledgerLimit: 50 });
    return {
      microtasks: snapshot.microtasks,
      derived: snapshot.derived,
      sessionSummary: snapshot.sessionSummary,
    };
  } catch (error) {
    console.warn('[AutoResearch] Failed to read execution memory:', error.message);
    return null;
  }
}

class AutoResearchWriter {
  constructor(onEvent, provider = null) {
    this.sessionId = null;
    this.onEvent = onEvent;
    this.provider = provider;
    this.usages = [];
  }

  send(data) {
    normalizeRuntimeObservations(data, { provider: this.provider }).forEach((observation) => {
      if (observation.type === 'usage_updated' && observation.usage) this.usages.push(observation.usage);
    });
    if (data?.type === 'session-created' && data.sessionId) {
      this.sessionId = data.sessionId;
    }
    if (typeof this.onEvent === 'function') {
      this.onEvent(data, this.sessionId);
    }
  }

  setSessionId(sessionId) {
    this.sessionId = sessionId;
  }

  getSessionId() {
    return this.sessionId;
  }

  getUsage() {
    return mergeRuntimeUsage(this.provider, this.usages);
  }
}

class AutoResearchVerifierWriter extends AutoResearchWriter {
  constructor(onEvent, provider = null) {
    super(onEvent, provider);
    this.textFragments = [];
  }

  send(data) {
    this.textFragments.push(...extractAgentTextFragments(data));
    super.send(data);
  }

  getText() {
    return this.textFragments.join('\n').trim();
  }
}

function extractAgentTextFragments(payload) {
  const fragments = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (value.type === 'text' && typeof value.text === 'string') {
      fragments.push(value.text);
      return;
    }
    ['data', 'message', 'content', 'result'].forEach((key) => visit(value[key]));
  };
  visit(payload);
  return fragments;
}

function persistTaskSession(runId, taskId, actor, sessionId) {
  if (!sessionId) return null;
  const run = autoResearchDb.getRunById(runId);
  if (!run) return null;
  const sessions = {
    ...(run.metadata?.autoResearchTaskSessions || {}),
  };
  const current = sessions[String(taskId)] || {};
  sessions[String(taskId)] = {
    ...current,
    [`${actor}SessionId`]: sessionId,
    attempt: actor === 'executor' ? Number(current.attempt || 0) + 1 : Number(current.attempt || 1),
    updatedAt: new Date().toISOString(),
  };
  return autoResearchDb.updateRun(runId, {
    metadata: {
      ...(run.metadata || {}),
      autoResearchTaskSessions: sessions,
    },
  });
}

async function readLatestDriftReport(projectPath, runId) {
  if (!projectPath || !runId) return null;
  const tasksDir = path.join(projectPath, '.pipeline', 'runs', String(runId), 'tasks');
  try {
    const taskDirs = await fs.readdir(tasksDir, { withFileTypes: true });
    const reports = await Promise.all(taskDirs.filter((entry) => entry.isDirectory()).map(async (entry) => {
      try {
        const reportPath = path.join(tasksDir, entry.name, 'drift-report.json');
        const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
        return {
          ...report,
          reportPath: path.relative(projectPath, reportPath).replace(/\\/g, '/'),
        };
      } catch {
        return null;
      }
    }));
    return reports
      .filter(Boolean)
      .sort((left, right) => String(right.checkedAt || '').localeCompare(String(left.checkedAt || '')))[0] || null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function computeVerificationCoverage(projectPath, tasks = [], specHash = null) {
  const latestByTask = new Map();
  const runsDir = path.join(projectPath, '.pipeline', 'runs');
  let runNames = [];
  try { runNames = await fs.readdir(runsDir); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  for (const runName of runNames) {
    const taskRoot = path.join(runsDir, runName, 'tasks');
    let taskNames = [];
    try { taskNames = await fs.readdir(taskRoot); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    for (const taskName of taskNames) {
      try {
        const verification = JSON.parse(await fs.readFile(path.join(taskRoot, taskName, 'verification.json'), 'utf8'));
        const previous = latestByTask.get(String(verification.taskId || taskName));
        if (!previous || String(verification.verifiedAt || '').localeCompare(String(previous.verifiedAt || '')) > 0) {
          latestByTask.set(String(verification.taskId || taskName), verification);
        }
      } catch {}
    }
  }
  let verifiedDone = 0;
  let legacyDone = 0;
  let invalidated = 0;
  tasks.forEach((task) => {
    const verification = latestByTask.get(String(task.id));
    if (verification?.status === 'invalidated') invalidated += 1;
    else if (task.status === 'done' && verification?.verdict === 'pass' && verification.specHash === specHash) verifiedDone += 1;
    else if (task.status === 'done') legacyDone += 1;
  });
  return {
    verifiedDone,
    legacyDone,
    invalidated,
    totalRequired: tasks.length,
    currentSpecHash: specHash,
    latestByTask: Object.fromEntries(latestByTask),
  };
}

function assertRunBudget(runState, pipelineState) {
  const elapsed = Date.now() - Number(runState.startedAtMs || Date.now());
  if ((pipelineState?.tasks?.length || 0) > Number(runState.budget?.maxTasks || 100)) {
    const error = new Error('Auto Research task budget exceeded.');
    error.code = 'MAX_TASKS_EXCEEDED';
    throw error;
  }
  if (Number(runState.modelCalls || 0) >= Number(runState.budget?.maxModelCalls || AUTO_RESEARCH_MAX_MODEL_CALLS)) {
    const error = new Error('Auto Research model-call budget exceeded.');
    error.code = 'MAX_MODEL_CALLS_EXCEEDED';
    throw error;
  }
  if (elapsed >= Number(runState.budget?.maxWallClockMs || AUTO_RESEARCH_MAX_WALL_CLOCK_MS)) {
    const error = new Error('Auto Research wall-clock budget exceeded.');
    error.code = 'MAX_WALL_CLOCK_EXCEEDED';
    throw error;
  }
  const costLimit = runState.budget?.maxEstimatedCost;
  if (costLimit != null && Number(runState.estimatedCostUsd || 0) >= Number(costLimit)) {
    const error = new Error('Auto Research estimated-cost budget exceeded.');
    error.code = 'MAX_ESTIMATED_COST_EXCEEDED';
    throw error;
  }
}

function recordEstimatedModelCost(runState, writer) {
  const usage = writer?.getUsage?.() || {};
  const rates = runState.provider === 'codex'
    ? { input: 1.5, output: 6 }
    : { input: 3, output: 15 };
  const estimatedCostUsd = ((Number(usage.inputTokens || 0) + Number(usage.cacheReadTokens || 0)) / 1_000_000) * rates.input
    + (Number(usage.outputTokens || 0) / 1_000_000) * rates.output;
  runState.estimatedCostUsd = Number(runState.estimatedCostUsd || 0) + estimatedCostUsd;
  runState.tokenUsage = {
    inputTokens: Number(runState.tokenUsage?.inputTokens || 0) + Number(usage.inputTokens || 0),
    outputTokens: Number(runState.tokenUsage?.outputTokens || 0) + Number(usage.outputTokens || 0),
    cacheReadTokens: Number(runState.tokenUsage?.cacheReadTokens || 0) + Number(usage.cacheReadTokens || 0),
    cacheCreationTokens: Number(runState.tokenUsage?.cacheCreationTokens || 0) + Number(usage.cacheCreationTokens || 0),
  };
  return estimatedCostUsd;
}

function persistRunBudgetUsage(runId, runState) {
  const stored = autoResearchDb.getRunById(runId);
  if (!stored) return null;
  return autoResearchDb.updateRun(runId, {
    metadata: {
      ...(stored.metadata || {}),
      autoResearchBudget: runState.budget,
      autoResearchBudgetUsage: {
        modelCalls: Number(runState.modelCalls || 0),
        estimatedCostUsd: Number(runState.estimatedCostUsd || 0),
        tokenUsage: runState.tokenUsage || null,
        updatedAt: new Date().toISOString(),
      },
    },
  });
}

function normalizeRunBudget(body = {}) {
  const finitePositive = (value, fallback, minimum = 1) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
  };
  const estimatedCost = body.maxEstimatedCost == null ? null : Number(body.maxEstimatedCost);
  return {
    maxTasks: finitePositive(body.maxTasks, 100),
    maxModelCalls: finitePositive(body.maxModelCalls, AUTO_RESEARCH_MAX_MODEL_CALLS),
    maxWallClockMs: finitePositive(body.maxWallClockMs, AUTO_RESEARCH_MAX_WALL_CLOCK_MS, 60_000),
    maxEstimatedCost: Number.isFinite(estimatedCost) ? Math.max(0, estimatedCost) : null,
    startedAtMs: Date.now(),
  };
}

const BRIEF_TO_SPEC_FIELD = {
  'meta.primary_database': 'dataSource.name',
  'meta.database_version': 'dataSource.version',
  'sections.literature.core_research_question': 'canonicalQuestion',
  'sections.ideation.population_setting': 'population.setting',
  'sections.ideation.inclusion_criteria': 'population.inclusion',
  'sections.ideation.exclusion_criteria': 'population.exclusion',
  'sections.ideation.time_zero': 'population.timeZero',
  'sections.ideation.follow_up': 'population.followUp',
  'sections.ideation.biomarker_or_exposure': 'biomarkerOrExposure.name',
  'sections.ideation.comparator': 'comparator',
  'sections.ideation.primary_outcome': 'primaryOutcome.name',
  'sections.ideation.outcome_definition': 'primaryOutcome.definition',
  'sections.ideation.outcome_time_horizon': 'primaryOutcome.timeHorizon',
  'sections.ideation.study_design': 'studyDesign',
  'sections.ideation.estimand': 'estimand',
  'sections.experiment.primary_model': 'primaryModel',
  'sections.experiment.mandatory_covariates': 'mandatoryCovariates',
  'sections.experiment.sensitivity_plan': 'mandatorySensitivityAnalyses',
};

async function createDriftChangeRequest(projectPath, runId, task, integrityResult) {
  const change = (integrityResult?.drift || []).find((item) => BRIEF_TO_SPEC_FIELD[item.field]);
  if (!change) return null;
  return createResearchSpecChangeRequest(projectPath, {
    runId,
    taskId: String(task.id),
    field: BRIEF_TO_SPEC_FIELD[change.field],
    before: change.before,
    after: change.after,
    reason: `Auto Research task ${task.id} attempted to change a locked research field.`,
    impact: { affectedStages: [task.stage].filter(Boolean), affectedTaskIds: [String(task.id)], invalidateDescendants: true },
  });
}

function withTimeout(promise, timeoutMs, onTimeout) {
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(async () => {
      try {
        await onTimeout?.();
      } catch (error) {
        console.error('[AutoResearch] Timeout cleanup failed:', error);
      }
      reject(new Error(`Task timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([
    promise.finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }),
    timeoutPromise,
  ]);
}

async function deliverCompletionEmail(runId, userId, projectName, senderEmail = '') {
  const run = autoResearchDb.getRunById(runId);
  const profile = userDb.getProfile(userId);

  if (!run || !profile?.notification_email) {
    return;
  }

  try {
    const result = await sendAutoResearchCompletionEmail({
      toEmail: profile.notification_email,
      senderEmail,
      run,
      projectName,
    });
    if (result?.sent) {
      autoResearchDb.updateRun(runId, { emailSentAt: new Date().toISOString() });
    }
  } catch (error) {
    console.error('[AutoResearch] Failed to send completion email:', error);
  }
}

function isRunSessionStillActive(run) {
  return isSessionActiveForProvider(run?.provider, run?.session_id);
}

function reconcileActiveRun(run) {
  if (!run) {
    return null;
  }

  const hasRuntime = activeRuns.has(run.id);
  const sessionStillActive = isRunSessionStillActive(run);
  if (hasRuntime || sessionStillActive) {
    return run;
  }

  const staleStatus = run.status === 'cancelling' ? 'cancelled' : 'failed';
  return autoResearchDb.updateRun(run.id, {
    status: staleStatus,
    error: run.error || 'Recovered stale Auto Research run after session interruption',
    currentTaskId: null,
    finishedAt: run.finished_at || new Date().toISOString(),
  });
}

async function runAutoResearch(runId, userId, projectName, projectPath, wss = null) {
  const runState = activeRuns.get(runId);
  if (!runState) {
    return;
  }

  const enqueueTrackingWrite = createTrackingQueue();
  let trackedPipelineState = null;
  let trackedCurrentTask = null;
  let trackedHeartbeatStatus = 'queued';
  let heartbeatInterval = null;
  let researchSpec = null;
  const executionMemoryTracker = createExecutionMemoryTracker({
    scope: 'run',
    projectPath,
    runId,
    provider: 'pi',
    sessionId: runState.sessionId || null,
    currentObjective: 'Auto Research execution',
    taskTransitionPolicy: 'disabled',
    briefSyncPolicy: 'disabled',
    onConfirmedSync: async (syncResult) => {
      if (!wss || !projectName) {
        return;
      }
      broadcastTaskMasterProjectUpdate(wss, projectName, {
        status: 'execution-memory-synced',
        stage: syncResult?.stage || null,
      });
      broadcastTaskMasterTasksUpdate(wss, projectName);
    },
  });

  // Build the same managed runtime environment the interactive entry points
  // build, and rebuild it per turn. Passing process.env instead would drop the
  // database API credential and give the pooled Codex app-server a different
  // environment fingerprint than chat, making the two tear down each other's
  // process mid-turn.
  const resolveAgentSessionContext = () => buildManagedAgentSessionContext({
    userId,
    localKernelSession: runState.localKernelSession || null,
  });

  const flushTracking = async ({ completedTask = null } = {}) => {
    const run = autoResearchDb.getRunById(runId);
    if (!run || !trackedPipelineState) {
      return;
    }

    await writeRunTrackingArtifacts({
      run,
      runtime: runState,
      pipelineState: trackedPipelineState,
      currentTask: trackedCurrentTask,
      completedTask,
      heartbeatStatus: trackedHeartbeatStatus,
      researchSpec,
    });
  };

  const queueTrackingFlush = ({ completedTask = null } = {}) => (
    enqueueTrackingWrite(() => flushTracking({ completedTask }))
  );

  try {
    let pipelineState = await readPipelineState(projectPath);
    researchSpec = await ensureResearchSpec(projectPath, pipelineState.researchBriefData);
    trackedPipelineState = pipelineState;
    trackedHeartbeatStatus = 'running';
    autoResearchDb.updateRun(runId, {
      status: 'running',
      totalTasks: pipelineState.tasks.length,
      completedTasks: pipelineState.completedTaskCount,
      // Clear any stale-recovery verdict a status poll may have written while
      // the run was still queued.
      error: null,
      finishedAt: null,
    });
    await syncRunSnapshot(runId, runState);
    await queueTrackingFlush();
    await appendAutoResearchRunEvent(projectPath, runId, {
      type: runState.resumeState?.available ? 'run_resumed' : 'run_started',
      provider: runState.provider,
      permissionMode: runState.permissionMode,
      resumedFromStatus: runState.resumeState?.status || null,
      resumeCheckpointTimestamp: runState.resumeState?.checkpoint?.timestamp || null,
      totalTasks: pipelineState.tasks.length,
      completedTasks: pipelineState.completedTaskCount,
    });
    await executionMemoryTracker.recordRunLifecycle('run_started', {
      currentObjective: pipelineState.nextTask?.title || 'Auto Research execution',
      stage: pipelineState.nextTask?.stage || null,
      summary: runState.resumeState?.available ? 'Run resumed from the latest checkpoint.' : 'Run started.',
    });

    heartbeatInterval = setInterval(() => {
      void queueTrackingFlush();
    }, AUTO_RESEARCH_HEARTBEAT_INTERVAL_MS);
    heartbeatInterval.unref?.();

    while (pipelineState.nextTask) {
      if (runState.cancelRequested) {
        throw new Error('Run cancelled by user');
      }

      let task = pipelineState.nextTask;
      assertRunBudget(runState, pipelineState);
      const taskKind = pipelineState.nextTaskKind || (task.status === 'review' ? 'verify' : 'execute');
      trackedCurrentTask = task;
      trackedPipelineState = pipelineState;
      autoResearchDb.updateRun(runId, {
        status: 'running',
        currentTaskId: String(task.id),
        totalTasks: pipelineState.tasks.length,
        completedTasks: pipelineState.completedTaskCount,
      });
      await syncRunSnapshot(runId, runState);
      await queueTrackingFlush();

      const stageContract = await validateAutoResearchStageContract({
        stage: task.stage,
        projectPath,
        pipelineState,
        currentTask: task,
        runStatus: 'running',
      });
      if (!stageContract.readiness.canStart) {
        await appendAutoResearchRunEvent(projectPath, runId, {
          type: 'stage_contract_failed',
          stage: stageContract.key,
          contractMode: 'readiness',
          issueCodes: stageContract.readiness.blockingErrors.map((issue) => issue.code),
          summary: stageContract.readiness.summary,
        });
        throw new Error(stageContract.readiness.summary);
      }
      if (stageContract.readiness.warnings.length > 0) {
        await appendAutoResearchRunEvent(projectPath, runId, {
          type: 'stage_contract_warning',
          stage: stageContract.key,
          contractMode: 'readiness',
          issueCodes: stageContract.readiness.warnings.map((issue) => issue.code),
          summary: stageContract.readiness.summary,
        });
      }

      const provider = 'pi';
      const runtimeId = 'pi';
      const modelSelection = resolveAutoResearchModelSelection(userId, runState.model);
      const model = modelSelection.modelId;

      if (taskKind === 'verify') {
        if (Number(task.executionState?.verificationAttempt || 0) >= Number(task.maxVerificationAttempts || 3)) {
          await transitionTaskStatus(projectPath, task.id, 'blocked', {
            actor: 'server', runId, code: 'MAX_VERIFICATION_ATTEMPTS_EXCEEDED',
            detail: 'Maximum independent verification attempts exceeded.',
          });
          throw new Error(`Task ${task.id} exceeded its verification attempt budget.`);
        }
        if (task.status !== 'review') {
          task = await transitionTaskStatus(projectPath, task.id, 'review', {
            actor: 'verifier',
            runId,
            detail: 'Verifier-only task entered independent review.',
          });
          pipelineState = await readPipelineState(projectPath);
        }

        let taskEnvelope = await readTaskEnvelope(projectPath, runId, task.id);
        if (!taskEnvelope) {
          const acceptedEvidence = await loadAcceptedDependencyEvidence(projectPath, {
            runId, currentTask: task, tasks: pipelineState.tasks, specHash: researchSpec.specHash,
          });
          taskEnvelope = buildTaskEnvelope({
            task,
            runId,
            researchSpec,
            actor: 'verifier',
            acceptedEvidence,
            dependencyTaskIds: getTransitiveDependencyIds(task, pipelineState.tasks),
          });
          await writeTaskEnvelope(projectPath, runId, taskEnvelope);
        }
        let evidenceManifest = await readEvidenceManifest(projectPath, runId, task.id);
        if (!evidenceManifest && task.noArtifactExpected === true) {
          evidenceManifest = {
          schemaVersion: '2.0',
          status: 'submitted',
          runId: String(runId),
          taskId: String(task.id),
          taskHash: taskEnvelope.taskHash,
          specVersion: researchSpec.specVersion,
          specHash: researchSpec.specHash,
          executorSessionId: null,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          touchedFiles: [],
          createdArtifacts: [],
          artifacts: [],
          structuredFindings: [],
          protectedFileChanges: [],
          warnings: ['Verifier-only quality gate has no executor evidence.'],
          };
          await writeEvidenceManifest(projectPath, runId, task.id, evidenceManifest);
        }
        evidenceManifest ||= {};
        const persistedSnapshot = await readProtectedFileSnapshot(projectPath, runId, task.id);
        let integrityResult = await readIntegrityResult(projectPath, runId, task.id);
        if (persistedSnapshot && integrityResult?.pass === true) {
          const resumedIntegrity = await verifyProtectedFileSnapshot(persistedSnapshot);
          if (!resumedIntegrity.pass) {
            await restoreProtectedFileSnapshot(persistedSnapshot, resumedIntegrity);
            integrityResult = resumedIntegrity;
            await writeIntegrityResult(projectPath, runId, task.id, resumedIntegrity);
          }
        } else if (task.noArtifactExpected !== true) {
          integrityResult = null;
        }
        if (!integrityResult && task.noArtifactExpected === true) {
          const qualitySnapshot = await captureProtectedFileSnapshot({ projectPath, researchSpec, currentTaskId: task.id });
          await writeProtectedFileSnapshot(projectPath, runId, task.id, qualitySnapshot);
          integrityResult = await verifyProtectedFileSnapshot(qualitySnapshot);
          await writeIntegrityResult(projectPath, runId, task.id, integrityResult);
        }

        await appendAutoResearchRunEvent(projectPath, runId, {
          type: 'task_verification_started',
          taskId: String(task.id),
          taskTitle: task.title,
          stage: task.stage || null,
        });
        const verification = await verifyTaskIndependently({
          projectPath,
          runId,
          task,
          tasks: pipelineState.tasks,
          researchSpec: toResearchSpecPromptView(researchSpec),
          taskEnvelope,
          evidenceManifest,
          integrityResult,
          semanticVerify: async (verifierPrompt) => {
            const verifierSnapshot = await captureProtectedFileSnapshot({ projectPath, researchSpec, currentTaskId: task.id });
            const verifierStartedAt = new Date().toISOString();
            runState.sessionId = null;
            autoResearchDb.updateRun(runId, { sessionId: null });
            const verifierWriter = new AutoResearchVerifierWriter((event, sessionId) => {
              if (event?.type === 'session-created' && sessionId) {
                runState.sessionId = sessionId;
                autoResearchDb.updateRun(runId, { sessionId });
                persistTaskSession(runId, task.id, 'verifier', sessionId);
                void syncRunSnapshot(runId, runState);
                void appendAutoResearchRunEvent(projectPath, runId, {
                  type: 'verifier_session_created',
                  taskId: String(task.id),
                  provider,
                  sessionId,
                });
              }
            }, provider);
            runState.modelCalls = Number(runState.modelCalls || 0) + 1;
            persistRunBudgetUsage(runId, runState);
            const verifierSessionContext = await resolveAgentSessionContext();
            await withTimeout(
              executeAgentTurn({
                identity: {
                  ownerKey: String(userId ?? 'local'),
                  projectKey: projectPath,
                  runtimeId,
                  sessionId: `auto-research-verifier-${runId}-${task.id}-${crypto.randomUUID()}`,
                },
                runtimeId,
                command: verifierPrompt,
                options: {
                  cwd: projectPath,
                  projectPath,
                  sessionId: null,
                  env: verifierSessionContext.env,
                  userPreferenceContext: verifierSessionContext.userPreferenceContext,
                  userId,
                  model,
                  modelProviderId: modelSelection.modelProviderId,
                  modelApi: modelSelection.modelApi,
                  permissionMode: 'plan',
                  stageTagKeys: task.stage ? [task.stage] : [],
                  stageTagSource: 'auto_research_verifier',
                },
                modelSelection: {
                  modelProviderId: modelSelection.modelProviderId,
                  modelId: model,
                  modelApi: modelSelection.modelApi,
                },
              }, verifierWriter),
              TASK_TIMEOUT_MS,
              async () => {
                if (runState.sessionId) await abortActiveSession(provider, runState.sessionId);
              },
            );
            recordEstimatedModelCost(runState, verifierWriter);
            persistRunBudgetUsage(runId, runState);
            const verifierIntegrityResult = await verifyProtectedFileSnapshot(verifierSnapshot);
            if (!verifierIntegrityResult.pass) {
              await restoreProtectedFileSnapshot(verifierSnapshot, verifierIntegrityResult);
            }
            return {
              output: verifierWriter.getText(),
              sessionId: verifierWriter.getSessionId(),
              stageTagSource: 'auto_research_verifier',
              createdAt: verifierStartedAt,
              integrityResult: verifierIntegrityResult,
            };
          },
        });

        if (verification.verdict === 'pass') {
          await promoteAcceptedEvidence(projectPath, {
            runId,
            task,
            researchSpec,
            evidenceManifest,
            verification,
          });
          await transitionTaskStatus(projectPath, task.id, 'done', {
            actor: 'verifier',
            runId,
            detail: `Independent verification passed: ${verification.summary || 'all checks passed'}`,
          });
        } else if (verification.verdict === 'revise') {
          await transitionTaskStatus(projectPath, task.id, 'in-progress', {
            actor: 'verifier',
            runId,
            detail: `Independent verification requested revision: ${verification.requiredCorrections.join('; ')}`,
          });
        } else {
          await transitionTaskStatus(projectPath, task.id, 'blocked', {
            actor: 'verifier',
            runId,
            detail: `Independent verification blocked the task: ${verification.summary}`,
          });
        }
        await appendAutoResearchRunEvent(projectPath, runId, {
          type: 'task_verification_completed',
          taskId: String(task.id),
          taskTitle: task.title,
          stage: task.stage || null,
          verdict: verification.verdict,
          verifierSessionId: verification.verifierSessionId,
        });
        if (verification.verdict === 'block') {
          throw new Error(`Task ${task.id} was blocked by independent verification: ${verification.summary}`);
        }
        pipelineState = await readPipelineState(projectPath);
        trackedPipelineState = pipelineState;
        trackedCurrentTask = null;
        if (verification.verdict === 'revise') {
          continue;
        }

        const taskAfterRun = pipelineState.tasks.find((entry) => String(entry.id) === String(task.id));
        autoResearchDb.updateRun(runId, {
          completedTasks: pipelineState.completedTaskCount,
          totalTasks: pipelineState.tasks.length,
          currentTaskId: null,
        });
        await syncRunSnapshot(runId, runState);
        await queueTrackingFlush({ completedTask: taskAfterRun });
        await appendAutoResearchRunEvent(projectPath, runId, {
          type: 'task_completed',
          taskId: String(taskAfterRun.id),
          taskTitle: taskAfterRun.title,
          stage: taskAfterRun.stage || null,
          completedTasks: pipelineState.completedTaskCount,
          totalTasks: pipelineState.tasks.length,
        });
        await executionMemoryTracker.recordTaskCompleted(taskAfterRun, {
          stage: taskAfterRun.stage || null,
          summary: `Independently verified ${taskAfterRun.title}`,
        });

        const completedStageContract = await validateAutoResearchStageContract({
          stage: taskAfterRun.stage,
          projectPath,
          pipelineState,
          currentTask: null,
          runStatus: 'running',
        });
        const stageIsDone = completedStageContract.taskStats.totalTasks > 0
          && completedStageContract.taskStats.completedTasks === completedStageContract.taskStats.totalTasks;
        if (stageIsDone) {
          if (!completedStageContract.completion.satisfied) {
            throw new Error(completedStageContract.completion.summary);
          }
          await appendAutoResearchRunEvent(projectPath, runId, {
            type: 'stage_completed',
            stage: completedStageContract.key,
            completionStatus: completedStageContract.completion.overall,
            issueCodes: completedStageContract.completion.warnings.map((issue) => issue.code),
            summary: completedStageContract.completion.summary,
          });
        }
        continue;
      }

      if (task.status === 'pending' || task.status === 'in-progress') {
        if (Number(task.executionState?.attempt || 0) >= Number(task.maxAttempts || 3)) {
          await transitionTaskStatus(projectPath, task.id, 'blocked', {
            actor: 'server', runId, code: 'MAX_REVISION_ATTEMPTS_EXCEEDED',
            detail: 'Maximum executor revision attempts exceeded.',
          });
          throw new Error(`Task ${task.id} exceeded its executor attempt budget.`);
        }
        task = await transitionTaskStatus(projectPath, task.id, 'in-progress', {
          actor: 'executor',
          runId,
          detail: task.status === 'pending'
            ? 'Auto Research executor started this task in a clean session.'
            : 'Auto Research executor started a clean revision session.',
        });
        pipelineState = await readPipelineState(projectPath);
      }
      const acceptedEvidence = await loadAcceptedDependencyEvidence(projectPath, {
        runId, currentTask: task, tasks: pipelineState.tasks, specHash: researchSpec.specHash,
      });
      const dependencyTaskIds = getTransitiveDependencyIds(task, pipelineState.tasks);
      const missingAcceptedDependencies = findMissingAcceptedDependencies(
        task,
        pipelineState.tasks,
        acceptedEvidence,
      );
      if (missingAcceptedDependencies.length > 0) {
        const error = new Error(`Dependencies lack verifier-pass evidence under the current Research Spec: ${missingAcceptedDependencies.join(', ')}`);
        error.code = 'DEPENDENCY_EVIDENCE_UNVERIFIED';
        throw error;
      }
      const promptContext = await loadTaskPromptContext(projectPath, {
        mode: 'accepted-only',
        specHash: researchSpec.specHash,
        dependencyTaskIds,
        acceptedEvidence,
        acceptedInputFiles: task.acceptedInputFiles || [],
      });
      const enrichedTask = enrichTaskForExecution(task, promptContext);
      const prompt = enrichedTask.nextActionPrompt?.trim();
      if (!prompt) {
        throw new Error(`Task ${task.id} does not have a nextActionPrompt`);
      }
      const taskEnvelope = buildTaskEnvelope({
        task,
        runId,
        researchSpec,
        actor: 'executor',
        acceptedEvidence,
        dependencyTaskIds,
      });
      await writeTaskEnvelope(projectPath, runId, taskEnvelope);
      const integritySnapshot = await captureProtectedFileSnapshot({ projectPath, researchSpec, currentTaskId: task.id });
      await writeProtectedFileSnapshot(projectPath, runId, task.id, integritySnapshot);
      const taskStartedAt = new Date().toISOString();

      await appendAutoResearchRunEvent(projectPath, runId, {
        type: 'task_started',
        taskId: String(task.id),
        taskTitle: task.title,
        stage: task.stage || null,
      });
      await executionMemoryTracker.recordTaskStarted(task, { stage: task.stage || null });
      runState.sessionId = null;
      autoResearchDb.updateRun(runId, { sessionId: null });
      const baseWriter = new AutoResearchWriter((event, sessionId) => {
        if (event?.type === 'session-created' && sessionId) {
          runState.sessionId = sessionId;
          autoResearchDb.updateRun(runId, { sessionId });
          persistTaskSession(runId, task.id, 'executor', sessionId);
          void syncRunSnapshot(runId, runState);
          void queueTrackingFlush();
          void appendAutoResearchRunEvent(projectPath, runId, {
            type: 'executor_session_created',
            taskId: String(task.id),
            provider,
            sessionId,
          });
        }
      }, provider);
      const writer = wrapWriterWithExecutionMemory(baseWriter, executionMemoryTracker);
      const executionAwarePrompt = await buildResearchAwarePromptPrefix(
        {
          scope: 'run',
          projectPath,
          provider,
          runId,
          sessionId: null,
          stage: task.stage || null,
        },
        prompt,
        {
          fallbackCommand: task.title || 'Continue the current Auto Research task.',
          taskContext: taskEnvelope,
          researchSpec: toResearchSpecPromptView(researchSpec),
          includeExecutionMemory: false,
        },
      );
      const executorSessionContext = await resolveAgentSessionContext();
      const agentOptions = {
        cwd: projectPath,
        projectPath,
        sessionId: null,
        env: executorSessionContext.env,
        userPreferenceContext: executorSessionContext.userPreferenceContext,
        userId,
        model,
        modelProviderId: modelSelection.modelProviderId,
        modelApi: modelSelection.modelApi,
        permissionMode: runState.permissionMode || AUTO_RESEARCH_DEFAULT_PERMISSION_MODE,
        stageTagKeys: task.stage ? [task.stage] : [],
        stageTagSource: 'auto_research',
      };
      runState.modelCalls = Number(runState.modelCalls || 0) + 1;
      persistRunBudgetUsage(runId, runState);
      const agentPromise = executeAgentTurn({
        identity: {
          ownerKey: String(userId ?? 'local'),
          projectKey: projectPath,
          runtimeId,
          sessionId: `auto-research-${runId}-${task.id}-${crypto.randomUUID()}`,
        },
        runtimeId,
        command: executionAwarePrompt,
        options: agentOptions,
        modelSelection: {
          modelProviderId: modelSelection.modelProviderId,
          modelId: model,
          modelApi: modelSelection.modelApi,
        },
      }, writer);
      await withTimeout(
        agentPromise,
        TASK_TIMEOUT_MS,
        async () => {
          if (runState.sessionId) await abortActiveSession(provider, runState.sessionId);
        },
      );
      recordEstimatedModelCost(runState, baseWriter);
      persistRunBudgetUsage(runId, runState);
      await executionMemoryTracker.queue;

      const integrityResult = await verifyProtectedFileSnapshot(integritySnapshot);
      await writeIntegrityResult(projectPath, runId, task.id, integrityResult);
      await writeDriftReport(projectPath, runId, task.id, integrityResult);
      if (!integrityResult.pass) {
        await restoreProtectedFileSnapshot(integritySnapshot, integrityResult);
        const changeRequest = await createDriftChangeRequest(projectPath, runId, task, integrityResult);
        await transitionTaskStatus(projectPath, task.id, 'blocked', {
          actor: 'server',
          runId,
          code: 'PROTECTED_STATE_DRIFT',
          executionStatePatch: changeRequest ? { changeRequestId: changeRequest.id } : null,
          detail: 'Protected-file or locked-field drift was detected and restored.',
        });
        throw new Error(`Task ${task.id} changed protected research state and was blocked.`);
      }

      const executionSnapshot = await readExecutionMemorySnapshot({
        scope: 'run',
        projectPath,
        provider,
        runId,
        sessionId: runState.sessionId || null,
      }, { ledgerLimit: 400 });
      const evidenceManifest = await buildEvidenceManifest({
        projectPath,
        runId,
        task,
        researchSpec,
        taskHash: taskEnvelope.taskHash,
        executorSessionId: runState.sessionId,
        snapshot: executionSnapshot,
        startedAt: taskStartedAt,
        finishedAt: new Date().toISOString(),
      });
      await writeEvidenceManifest(projectPath, runId, task.id, evidenceManifest);
      await transitionTaskStatus(projectPath, task.id, 'review', {
        actor: 'server',
        runId,
        detail: 'Executor finished; evidence is awaiting independent verification.',
      });
      const reviewSnapshot = await captureProtectedFileSnapshot({ projectPath, researchSpec, currentTaskId: task.id });
      await writeProtectedFileSnapshot(projectPath, runId, task.id, reviewSnapshot);
      await appendAutoResearchRunEvent(projectPath, runId, {
        type: 'task_awaiting_review',
        taskId: String(task.id),
        taskTitle: task.title,
        stage: task.stage || null,
        executorSessionId: runState.sessionId || null,
      });
      pipelineState = await readPipelineState(projectPath);
      trackedPipelineState = pipelineState;
      trackedCurrentTask = null;
    }

    if (pipelineState.blockedTasks?.length > 0) {
      const blockedSummary = pipelineState.blockedTasks
        .map((task) => `${task.id}: ${task.unresolvedDependencies.join(', ')}`)
        .join('; ');
      throw new Error(`Auto Research stopped because task dependencies are unresolved: ${blockedSummary}`);
    }

    autoResearchDb.updateRun(runId, {
      status: 'completed',
      currentTaskId: null,
      completedTasks: pipelineState.completedTaskCount,
      totalTasks: pipelineState.tasks.length,
      finishedAt: new Date().toISOString(),
    });
    trackedHeartbeatStatus = 'completed';
    trackedCurrentTask = null;
    await syncRunSnapshot(runId, runState);
    await queueTrackingFlush();
    await appendAutoResearchRunEvent(projectPath, runId, {
      type: 'run_completed',
      completedTasks: pipelineState.completedTaskCount,
      totalTasks: pipelineState.tasks.length,
    });
    await executionMemoryTracker.recordRunLifecycle('run_completed', {
      summary: `Completed ${pipelineState.completedTaskCount} Auto Research tasks.`,
      stage: null,
    });
  } catch (error) {
    const isCancelled = runState.cancelRequested || /cancelled by user/i.test(String(error?.message || ''));
    autoResearchDb.updateRun(runId, {
      status: isCancelled ? 'cancelled' : 'failed',
      error: error.message,
      currentTaskId: null,
      finishedAt: new Date().toISOString(),
    });
    trackedHeartbeatStatus = isCancelled ? 'cancelled' : 'failed';
    trackedCurrentTask = null;
    await syncRunSnapshot(runId, runState);
    await queueTrackingFlush();
    await appendAutoResearchRunEvent(projectPath, runId, {
      type: isCancelled ? 'run_cancelled' : 'run_failed',
      error: error.message,
    });
    await executionMemoryTracker.recordRunLifecycle(isCancelled ? 'run_cancelled' : 'run_failed', {
      summary: error.message,
      stage: trackedCurrentTask?.stage || null,
    });
  } finally {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
    }
    activeRuns.delete(runId);
    await deliverCompletionEmail(runId, userId, projectName, runState?.senderEmail);
  }
}

router.get('/:projectName/status', async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectName } = req.params;
    const projectPath = await extractProjectDirectory(projectName);
    const pipelineState = await readPipelineState(projectPath);
    const profile = userDb.getProfile(userId);
    const senderEmail = await resolveAutoResearchSenderEmail(req, userId);
    const activeRun = reconcileActiveRun(autoResearchDb.getActiveRunForProject(userId, projectName));
    const latestRun = autoResearchDb.getLatestRunForProject(userId, projectName);
    const activeRuntime = activeRun ? activeRuns.get(activeRun.id) || null : null;
    const latestRuntime = latestRun ? activeRuns.get(latestRun.id) || null : null;
    const eligibility = buildEligibility(profile, pipelineState, activeRun);
    const [
      activeRunTracking,
      latestRunTracking,
      activeRunExecutionMemory,
      latestRunExecutionMemory,
      researchSpecState,
      latestDrift,
      changeRequests,
    ] = await Promise.all([
      activeRun ? loadRunTrackingForStatus(activeRun) : Promise.resolve(null),
      latestRun && latestRun.id !== activeRun?.id
        ? loadRunTrackingForStatus(latestRun)
        : Promise.resolve(null),
      activeRun ? loadRunExecutionMemoryForStatus(activeRun) : Promise.resolve(null),
      latestRun && latestRun.id !== activeRun?.id
        ? loadRunExecutionMemoryForStatus(latestRun)
        : Promise.resolve(null),
      loadResearchSpec(projectPath),
      latestRun ? readLatestDriftReport(projectPath, latestRun.id) : Promise.resolve(null),
      listResearchSpecChangeRequests(projectPath),
    ]);
    const verificationCoverage = await computeVerificationCoverage(
      projectPath,
      pipelineState.tasks,
      researchSpecState.valid ? researchSpecState.spec?.specHash : null,
    );
    const scientificValidity = pipelineState.tasks.some((task) => task.status === 'blocked') || latestDrift?.status === 'blocked'
      ? 'blocked'
      : verificationCoverage.invalidated > 0
        ? 'invalidated'
        : verificationCoverage.verifiedDone === verificationCoverage.totalRequired && verificationCoverage.totalRequired > 0
          ? 'accepted'
          : verificationCoverage.verifiedDone > 0
            ? 'partial'
            : 'unverified';
    const resume = await loadAutoResearchResumeState({
      run: latestRun,
      pipelineState,
    });
    const currentTask = activeRun?.current_task_id
      ? pipelineState.tasks.find((task) => String(task.id) === String(activeRun.current_task_id)) || pipelineState.nextTask
      : pipelineState.nextTask;
    const pipelineStateMachine = deriveAutoResearchStateMachine({
      pipelineState,
      currentTask,
      runStatus: activeRun?.status || latestRun?.status || 'idle',
    });
    const pipelineContracts = await deriveAutoResearchStageContractSummary({
      projectPath,
      pipelineState,
      currentTask,
      runStatus: activeRun?.status || latestRun?.status || 'idle',
    });

    const activeProvider = 'pi';
    res.json({
      success: true,
      provider: activeProvider,
      eligibility,
      profile: {
        notificationEmail: profile?.notification_email || null,
      },
      mail: {
        senderEmail,
        resendConfigured: Boolean(appSettingsDb.get(AUTO_RESEARCH_RESEND_API_KEY)),
      },
      pipeline: {
        hasResearchBrief: pipelineState.hasResearchBrief,
        researchBriefValid: pipelineState.researchBriefValid,
        researchBriefError: pipelineState.researchBriefError,
        hasTasksFile: pipelineState.hasTasksFile,
        tasksValid: pipelineState.tasksValid,
        tasksError: pipelineState.tasksError,
        actionableTaskCount: pipelineState.actionableTaskCount,
        reviewTaskCount: pipelineState.reviewTaskCount,
        blockedTasks: pipelineState.blockedTasks,
        completedTaskCount: pipelineState.completedTaskCount,
        totalTaskCount: pipelineState.tasks.length,
        executionProgress: {
          executedTaskCount: pipelineState.tasks.filter((task) => ['review', 'done', 'blocked'].includes(task.status)).length,
          totalTaskCount: pipelineState.tasks.length,
        },
        verificationCoverage: {
          verifiedDone: verificationCoverage.verifiedDone,
          legacyDone: verificationCoverage.legacyDone,
          invalidated: verificationCoverage.invalidated,
          totalRequired: verificationCoverage.totalRequired,
          currentSpecHash: verificationCoverage.currentSpecHash,
        },
        scientificValidity,
        taskVerifications: verificationCoverage.latestByTask,
        nextTask: pipelineState.nextTask,
        nextTaskKind: pipelineState.nextTaskKind,
        stateMachine: pipelineStateMachine,
        contracts: pipelineContracts,
      },
      researchSpec: researchSpecState.valid
        ? toResearchSpecPromptView(researchSpecState.spec)
        : {
            valid: false,
            exists: researchSpecState.exists,
            error: researchSpecState.error,
          },
      latestDrift,
      changeRequests,
      resume,
      activeRun: serializeRun(activeRun, activeRuntime),
      activeRunTracking,
      activeRunExecutionMemory,
      latestRun: serializeRun(latestRun, latestRuntime),
      latestRunTracking: latestRun && latestRun.id === activeRun?.id ? activeRunTracking : latestRunTracking,
      latestRunExecutionMemory: latestRun && latestRun.id === activeRun?.id ? activeRunExecutionMemory : latestRunExecutionMemory,
    });
  } catch (error) {
    console.error('[AutoResearch] Failed to get status:', error);
    res.status(500).json({ error: 'Failed to get Auto Research status' });
  }
});

router.post('/:projectName/start', serializeProjectStarts, async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectName } = req.params;
    const {
      provider: rawProvider,
      model: rawModel,
      permissionMode: rawPermissionMode,
      resume: rawResume,
    } = req.body || {};
    const shouldResume = rawResume === true;
    const provider = 'pi';
    const permissionMode = normalizePermissionMode(rawPermissionMode);
    const bypassPermissionsConfirmed = hasBypassPermissionsConfirmation(req.body);
    let requestedModelSelection;
    try {
      requestedModelSelection = resolveAutoResearchModelSelection(userId, rawModel || null);
    } catch (error) {
      return res.status(400).json({ error: error.message, code: error.code || 'PI_PROVIDER_NOT_CONFIGURED' });
    }
    const model = requestedModelSelection.modelId;
    const requestedBudget = normalizeRunBudget(req.body || {});
    const projectPath = await extractProjectDirectory(projectName);
    const profile = userDb.getProfile(userId);
    const senderEmail = await resolveAutoResearchSenderEmail(req, userId);
    const existingRun = reconcileActiveRun(autoResearchDb.getActiveRunForProject(userId, projectName));
    const latestRun = autoResearchDb.getLatestRunForProject(userId, projectName);
    let pipelineState = await readPipelineState(projectPath);
    const eligibility = buildEligibility(profile, pipelineState, existingRun);
    const preflight = await runAutoResearchPreflight({
      userId,
      profile,
      projectPath,
      provider,
      model,
      pipelineState,
      mailConfig: {
        senderEmail,
        resendConfigured: Boolean(appSettingsDb.get(AUTO_RESEARCH_RESEND_API_KEY)),
      },
    });
    let researchSpec = null;

    if (!eligibility.eligible) {
      return res.status(400).json({
        error: preflight.overall === 'fail'
          ? summarizePreflightFailure(preflight)
          : 'Project is not eligible for Auto Research',
        eligibility,
        preflight,
      });
    }

    if (preflight.overall === 'fail') {
      return res.status(400).json({
        error: summarizePreflightFailure(preflight),
        eligibility,
        preflight,
      });
    }

    researchSpec = await ensureResearchSpec(projectPath, pipelineState.researchBriefData);
    pipelineState = await readPipelineState(projectPath);
    const resumeState = await loadAutoResearchResumeState({
      run: latestRun,
      pipelineState,
      promptTemplateVersion: AUTO_RESEARCH_PROMPT_TEMPLATE_VERSION,
      codeCommit: AUTO_RESEARCH_CODE_POLICY_VERSION,
      modelPolicyHash: hashJson({ provider, model, permissionMode }),
    });

    if (permissionMode === 'bypassPermissions' && !bypassPermissionsConfirmed) {
      return res.status(400).json({
        error: 'Full bypass permissions require explicit confirmation before Auto Research can start.',
        code: 'BYPASS_PERMISSION_CONFIRMATION_REQUIRED',
        eligibility,
        preflight,
      });
    }

    if (shouldResume && !resumeState.available) {
      return res.status(400).json({
        error: resumeState.summary || 'Resume is not available for the latest Auto Research run.',
        eligibility,
        preflight,
        resume: resumeState,
      });
    }

    let run;
    let runId;
    let resumed = false;

    if (shouldResume) {
      runId = latestRun.id;
      resumed = true;
      run = autoResearchDb.updateRun(runId, {
        status: 'queued',
        sessionId: null,
        currentTaskId: null,
        completedTasks: pipelineState.completedTaskCount,
        totalTasks: pipelineState.tasks.length,
        error: null,
        finishedAt: null,
        emailSentAt: null,
        metadata: buildAutoResearchResumeMetadata({
          existingMetadata: latestRun.metadata,
          resumeState,
          provider,
          model,
          permissionMode,
          resumedAt: new Date().toISOString(),
        }),
      });
    } else {
      runId = crypto.randomUUID();
      run = autoResearchDb.createRun({
        id: runId,
        userId,
        projectName,
        projectPath,
        provider,
        status: 'queued',
        completedTasks: pipelineState.completedTaskCount,
        totalTasks: pipelineState.tasks.length,
        metadata: {
          mode: 'auto_research_v2',
          autoResearchModel: model,
          autoResearchPermissionMode: permissionMode,
          researchSpecVersion: researchSpec?.specVersion || null,
          researchSpecHash: researchSpec?.specHash || null,
          autoResearchPromptTemplateVersion: AUTO_RESEARCH_PROMPT_TEMPLATE_VERSION,
          autoResearchCodeCommit: AUTO_RESEARCH_CODE_POLICY_VERSION,
          autoResearchModelPolicyHash: hashJson({ provider, model, permissionMode }),
          autoResearchTaskSessions: {},
          autoResearchBudget: requestedBudget,
          autoResearchBudgetUsage: {
            modelCalls: 0,
            estimatedCostUsd: 0,
            tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
          },
          autoResearchPreflight: {
            overall: preflight.overall,
            checkedAt: preflight.checkedAt,
            blockingChecks: preflight.blockingChecks.map((check) => check.name),
            warningChecks: preflight.warningChecks.map((check) => check.name),
          },
        },
      });
    }

    // Register the runtime record before the first await below. A status poll
    // that sees a queued row without a runtime record treats it as an
    // interrupted run and marks it failed (see reconcileActiveRun).
    const runBudget = run.metadata?.autoResearchBudget || requestedBudget;
    const priorBudgetUsage = run.metadata?.autoResearchBudgetUsage || {};
    activeRuns.set(runId, {
      cancelRequested: false,
      sessionId: null,
      provider,
      model,
      permissionMode,
      senderEmail,
      // Agent credentials for a Local Kernel are account-scoped cloud state and
      // must be refreshed per turn, so the run keeps the originating session.
      localKernelSession: req.localKernelSession || null,
      resumeState: resumed ? resumeState : null,
      startedAtMs: Number(runBudget.startedAtMs || Date.now()),
      modelCalls: Number(priorBudgetUsage.modelCalls || 0),
      estimatedCostUsd: Number(priorBudgetUsage.estimatedCostUsd || 0),
      tokenUsage: priorBudgetUsage.tokenUsage
        || { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      budget: runBudget,
    });

    try {
      if (resumed) {
        await writeAutoResearchRunJson(projectPath, runId, 'resume-report.json', {
          resumedAt: new Date().toISOString(),
          resumedFromStatus: latestRun.status,
          nextTaskId: resumeState.nextTaskId || null,
          nextTaskTitle: resumeState.nextTaskTitle || null,
          nextStage: resumeState.nextStage || null,
          checkpointTimestamp: resumeState.checkpoint?.timestamp || null,
          preflightOverall: preflight.overall,
        });
      } else {
        await persistRunBootstrapFiles({
          runId,
          projectPath,
          provider,
          permissionMode,
          preflight,
        });
        await appendAutoResearchRunEvent(projectPath, runId, {
          type: 'run_queued',
          provider,
          permissionMode,
          preflightOverall: preflight.overall,
          totalTasks: pipelineState.tasks.length,
          completedTasks: pipelineState.completedTaskCount,
        });
      }

      await syncRunSnapshot(runId, { provider, sessionId: null });
      await writeRunTrackingArtifacts({
        run,
        runtime: { provider, sessionId: null },
        pipelineState,
        currentTask: null,
        heartbeatStatus: 'queued',
        researchSpec,
      });
      const initialAcceptedInputHashes = await hashProjectFiles(
        projectPath,
        pipelineState.nextTask?.acceptedInputFiles || [],
      );
      await writeAutoResearchCheckpoint(projectPath, runId, buildAutoResearchCheckpoint({
        run,
        pipelineState,
        completedTask: null,
        researchSpec,
        acceptedInputHashes: initialAcceptedInputHashes,
        datasetSnapshotHash: hashJson(initialAcceptedInputHashes),
        promptTemplateVersion: AUTO_RESEARCH_PROMPT_TEMPLATE_VERSION,
        codeCommit: AUTO_RESEARCH_CODE_POLICY_VERSION,
        modelPolicyHash: run.metadata?.autoResearchModelPolicyHash || hashJson({ provider, model, permissionMode }),
      }));
      if (resumed) {
        await appendAutoResearchRunEvent(projectPath, runId, {
          type: 'run_resume_queued',
          provider,
          permissionMode,
          resumedFromStatus: resumeState.status,
          checkpointTimestamp: resumeState.checkpoint?.timestamp || null,
          nextTaskId: resumeState.nextTaskId || null,
          nextTaskTitle: resumeState.nextTaskTitle || null,
          totalTasks: pipelineState.tasks.length,
          completedTasks: pipelineState.completedTaskCount,
        });
      }
    } catch (bootstrapError) {
      activeRuns.delete(runId);
      autoResearchDb.updateRun(runId, {
        status: 'failed',
        error: `Auto Research bootstrap failed: ${bootstrapError.message}`,
        currentTaskId: null,
        finishedAt: new Date().toISOString(),
      });
      throw bootstrapError;
    }

    runAutoResearch(runId, userId, projectName, projectPath, req.app.locals.wss || null)
      .catch((error) => {
        console.error('[AutoResearch] Run terminated unexpectedly:', error);
        activeRuns.delete(runId);
        try {
          autoResearchDb.updateRun(runId, {
            status: 'failed',
            error: error?.message || 'Auto Research run terminated unexpectedly',
            currentTaskId: null,
            finishedAt: new Date().toISOString(),
          });
        } catch (updateError) {
          console.error('[AutoResearch] Failed to record run termination:', updateError);
        }
      });

    res.json({
      success: true,
      run: serializeRun(run),
      preflight,
      resumed,
      resume: resumed ? resumeState : null,
    });
  } catch (error) {
    console.error('[AutoResearch] Failed to start run:', error);
    res.status(500).json({ error: 'Failed to start Auto Research' });
  }
});

router.post('/:projectName/research-spec/draft', async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectName } = req.params;
    if (reconcileActiveRun(autoResearchDb.getActiveRunForProject(userId, projectName))) {
      return res.status(409).json({ error: 'Research Spec cannot be regenerated while Auto Research is running.', code: 'RUN_IN_PROGRESS' });
    }
    const projectPath = await extractProjectDirectory(projectName);
    const spec = await createResearchSpecDraft(projectPath);
    return res.json({ success: true, spec: toResearchSpecPromptView(spec), validation: validateResearchSpecCompleteness(spec) });
  } catch (error) {
    return res.status(400).json({ error: error.message, code: error.code || 'RESEARCH_SPEC_DRAFT_FAILED' });
  }
});

router.post('/:projectName/research-spec/approve', async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectName } = req.params;
    if (reconcileActiveRun(autoResearchDb.getActiveRunForProject(userId, projectName))) {
      return res.status(409).json({ error: 'Research Spec cannot be approved while Auto Research is running.', code: 'RUN_IN_PROGRESS' });
    }
    const projectPath = await extractProjectDirectory(projectName);
    const spec = await approveResearchSpec(projectPath, { approvedBy: `user:${userId}` });
    return res.json({ success: true, spec: toResearchSpecPromptView(spec) });
  } catch (error) {
    return res.status(400).json({ error: error.message, code: error.code || 'RESEARCH_SPEC_APPROVAL_FAILED', validation: error.validation || null });
  }
});

router.get('/:projectName/change-requests', async (req, res) => {
  try {
    const projectPath = await extractProjectDirectory(req.params.projectName);
    const requests = await listResearchSpecChangeRequests(projectPath);
    res.json({ success: true, requests });
  } catch (error) {
    console.error('[AutoResearch] Failed to list change requests:', error);
    res.status(500).json({ error: 'Failed to list Research Spec change requests' });
  }
});

router.post('/:projectName/change-requests', async (req, res) => {
  try {
    const projectPath = await extractProjectDirectory(req.params.projectName);
    const request = await createResearchSpecChangeRequest(projectPath, req.body || {});
    res.status(201).json({ success: true, request });
  } catch (error) {
    console.error('[AutoResearch] Failed to create change request:', error);
    res.status(400).json({ error: error.message, code: error.code || 'CHANGE_REQUEST_CREATE_FAILED' });
  }
});

async function handleChangeRequestResolution(req, res, decision) {
  try {
    const userId = req.user.id;
    const { projectName, id } = req.params;
    if (reconcileActiveRun(autoResearchDb.getActiveRunForProject(userId, projectName))) {
      return res.status(409).json({
        error: 'Research Spec changes cannot be resolved while Auto Research is running.',
        code: 'RUN_IN_PROGRESS',
      });
    }
    const projectPath = await extractProjectDirectory(projectName);
    const result = await resolveResearchSpecChangeRequest(projectPath, id, decision, { resolvedBy: `user:${userId}` });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error(`[AutoResearch] Failed to ${decision} change request:`, error);
    const status = error?.code === 'ENOENT' ? 404 : 400;
    return res.status(status).json({ error: error.message, code: error.code || 'CHANGE_REQUEST_RESOLUTION_FAILED' });
  }
}

router.post('/:projectName/change-requests/:id/approve', (req, res) => (
  handleChangeRequestResolution(req, res, 'approved')
));

router.post('/:projectName/change-requests/:id/reject', (req, res) => (
  handleChangeRequestResolution(req, res, 'rejected')
));

router.post('/:projectName/cancel', async (req, res) => {
  try {
    const userId = req.user.id;
    const { projectName } = req.params;
    const activeRun = reconcileActiveRun(autoResearchDb.getActiveRunForProject(userId, projectName));

    if (!activeRun) {
      return res.status(404).json({ error: 'No active Auto Research run found' });
    }

    const runtime = activeRuns.get(activeRun.id);
    const sessionStillActive = isRunSessionStillActive(activeRun);
    if (runtime) {
      runtime.cancelRequested = true;
      if (runtime.sessionId || activeRun.session_id) {
        await abortActiveSession('pi', runtime.sessionId || activeRun.session_id);
      }
    }

    let updatedRun;
    if (!runtime && !sessionStillActive) {
      updatedRun = autoResearchDb.updateRun(activeRun.id, {
        status: 'cancelled',
        error: activeRun.error || 'Cancelled after recovering stale Auto Research run',
        currentTaskId: null,
        finishedAt: activeRun.finished_at || new Date().toISOString(),
      });
    } else {
      updatedRun = autoResearchDb.updateRun(activeRun.id, {
        status: 'cancelling',
      });
    }

    const pipelineState = await readPipelineState(activeRun.project_path);
    await syncRunSnapshot(activeRun.id, runtime || { provider: activeRun.provider, sessionId: activeRun.session_id });
    await writeRunTrackingArtifacts({
      run: updatedRun,
      runtime: runtime || { provider: activeRun.provider, sessionId: activeRun.session_id },
      pipelineState,
      currentTask: pipelineState.tasks.find((task) => String(task.id) === String(updatedRun.current_task_id)) || null,
      heartbeatStatus: updatedRun.status,
    });
    await appendAutoResearchRunEvent(activeRun.project_path, activeRun.id, {
      type: updatedRun.status === 'cancelled' ? 'run_cancelled' : 'run_cancelling',
      currentTaskId: updatedRun.current_task_id || null,
    });

    res.json({
      success: true,
      run: serializeRun(updatedRun),
    });
  } catch (error) {
    console.error('[AutoResearch] Failed to cancel run:', error);
    res.status(500).json({ error: 'Failed to cancel Auto Research' });
  }
});

export default router;
