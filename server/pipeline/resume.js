import path from 'path';
import { promises as fs } from 'fs';

import { readAutoResearchRunSummary } from './run-files.js';
import { normalizeAutoResearchStage } from './state-machine.js';
import {
  hashFile,
  hashJson,
  hashProjectFiles,
  hashTaskDefinition,
  hashTasksDefinition,
} from './hash-utils.js';
import { loadResearchSpec } from './research-spec.js';

const RESUMABLE_AUTO_RESEARCH_RUN_STATUSES = new Set(['failed', 'cancelled']);

async function fsReadJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function isAutoResearchRunResumableStatus(status) {
  return RESUMABLE_AUTO_RESEARCH_RUN_STATUSES.has(String(status || '').trim().toLowerCase());
}

function buildAutoResearchResumeState({
  run = null,
  pipelineState = null,
  runTracking = null,
  currentIntegrity = null,
} = {}) {
  const checkpoint = runTracking?.checkpoint || null;
  const nextTask = pipelineState?.nextTask || null;

  if (!run) {
    return {
      available: false,
      reason: 'no_previous_run',
      summary: 'No previous Auto Research run is available to resume.',
    };
  }

  if (!isAutoResearchRunResumableStatus(run.status)) {
    return {
      available: false,
      reason: 'run_not_resumable',
      runId: run.id,
      status: run.status,
      summary: `Latest run status ${run.status} is not resumable.`,
    };
  }

  if (!pipelineState?.tasksValid) {
    return {
      available: false,
      reason: 'tasks_invalid',
      runId: run.id,
      status: run.status,
      summary: 'Resume is blocked because tasks.json is missing or invalid.',
    };
  }

  if (!checkpoint) {
    return {
      available: false,
      reason: 'checkpoint_missing',
      runId: run.id,
      status: run.status,
      summary: 'Resume is unavailable because checkpoint.json is missing.',
    };
  }

  if (checkpoint.invalidated) {
    return {
      available: false,
      reason: 'checkpoint_invalidated',
      code: 'CHECKPOINT_STALE',
      runId: run.id,
      status: run.status,
      checkpoint,
      summary: 'Resume is blocked because a Research Spec change invalidated this checkpoint.',
    };
  }

  if (!nextTask || pipelineState.actionableTaskCount === 0) {
    return {
      available: false,
      reason: 'no_actionable_tasks',
      runId: run.id,
      status: run.status,
      checkpoint,
      summary: 'Resume is unavailable because there is no pending task left to continue.',
    };
  }

  const checkpointNextTaskId = checkpoint.nextTaskId != null ? String(checkpoint.nextTaskId) : null;
  const currentNextTaskId = nextTask.id != null ? String(nextTask.id) : null;

  if (!checkpointNextTaskId) {
    return {
      available: false,
      reason: 'checkpoint_incomplete',
      runId: run.id,
      status: run.status,
      checkpoint,
      summary: 'Resume is unavailable because checkpoint.json does not record the next task.',
    };
  }

  if (!currentNextTaskId) {
    return {
      available: false,
      reason: 'next_task_missing',
      runId: run.id,
      status: run.status,
      checkpoint,
      summary: 'Resume is unavailable because the current pipeline next task could not be identified.',
    };
  }

  if (checkpointNextTaskId !== currentNextTaskId) {
    return {
      available: false,
      reason: 'task_order_changed',
      code: 'TASK_ORDER_CHANGED',
      runId: run.id,
      status: run.status,
      checkpoint,
      currentNextTaskId,
      currentNextTaskTitle: nextTask.title || null,
      summary: 'Resume is unavailable because the checkpoint no longer matches the current pipeline task order.',
    };
  }

  const matchedTask = (pipelineState.tasks || []).find((task) => String(task.id) === checkpointNextTaskId) || nextTask;
  if (!matchedTask || !['pending', 'in-progress', 'review'].includes(matchedTask.status)) {
    return {
      available: false,
      reason: 'checkpoint_task_not_actionable',
      runId: run.id,
      status: run.status,
      checkpoint,
      summary: 'Resume is unavailable because the checkpoint task is no longer actionable.',
    };
  }

  if (matchedTask.status === 'review' && currentIntegrity?.reviewArtifactsValid !== true) {
    return {
      available: false,
      reason: 'checkpoint_stale',
      code: 'CHECKPOINT_STALE',
      runId: run.id,
      status: run.status,
      checkpoint,
      summary: 'Resume is blocked because the review task integrity snapshot, result, or evidence manifest is missing or invalid.',
    };
  }

  const requiredHashes = [
    checkpoint.researchSpecHash,
    checkpoint.nextTaskHash,
    checkpoint.tasksFileHash,
  ];
  if (requiredHashes.some((value) => !value) || !currentIntegrity) {
    return {
      available: false,
      reason: 'checkpoint_stale',
      code: 'CHECKPOINT_STALE',
      runId: run.id,
      status: run.status,
      checkpoint,
      summary: 'Resume is unavailable because the checkpoint predates integrity-hash validation.',
    };
  }

  if (checkpoint.researchSpecHash !== currentIntegrity.researchSpecHash) {
    return {
      available: false,
      reason: 'spec_hash_mismatch',
      code: 'SPEC_HASH_MISMATCH',
      runId: run.id,
      status: run.status,
      checkpoint,
      summary: 'Resume is blocked because the frozen Research Spec changed.',
    };
  }

  if (checkpoint.nextTaskHash !== currentIntegrity.nextTaskHash) {
    return {
      available: false,
      reason: 'task_hash_mismatch',
      code: 'TASK_HASH_MISMATCH',
      runId: run.id,
      status: run.status,
      checkpoint,
      summary: 'Resume is blocked because the next task body changed.',
    };
  }

  const tasksFileCompatible = checkpoint.tasksFileHash === currentIntegrity.tasksFileHash
    || (
      checkpoint.tasksDefinitionHash
      && checkpoint.tasksDefinitionHash === currentIntegrity.tasksDefinitionHash
    );
  if (!tasksFileCompatible) {
    return {
      available: false,
      reason: 'checkpoint_stale',
      code: 'CHECKPOINT_STALE',
      runId: run.id,
      status: run.status,
      checkpoint,
      summary: 'Resume is blocked because tasks.json changed incompatibly.',
    };
  }

  const changedInputs = Object.entries(checkpoint.acceptedInputHashes || {})
    .filter(([inputPath, inputHash]) => currentIntegrity.acceptedInputHashes?.[inputPath] !== inputHash)
    .map(([inputPath]) => inputPath);
  if (changedInputs.length > 0) {
    return {
      available: false,
      reason: 'input_hash_mismatch',
      code: 'INPUT_HASH_MISMATCH',
      runId: run.id,
      status: run.status,
      checkpoint,
      changedInputs,
      summary: `Resume is blocked because accepted inputs changed: ${changedInputs.join(', ')}`,
    };
  }


  const integrityComparisons = [
    ['datasetSnapshotHash', 'DATASET_SNAPSHOT_MISMATCH', 'dataset snapshot'],
    ['promptTemplateVersion', 'PROMPT_TEMPLATE_VERSION_MISMATCH', 'prompt template version'],
    ['codeCommit', 'CODE_COMMIT_MISMATCH', 'code commit'],
    ['modelPolicyHash', 'MODEL_POLICY_MISMATCH', 'model policy'],
  ];
  for (const [field, code, label] of integrityComparisons) {
    if (!checkpoint[field] || !currentIntegrity[field]) {
      return {
        available: false,
        reason: 'checkpoint_stale',
        code: 'CHECKPOINT_STALE',
        runId: run.id,
        status: run.status,
        checkpoint,
        summary: `Resume is unavailable because ${label} integrity metadata is missing.`,
      };
    }
    if (checkpoint[field] !== currentIntegrity[field]) {
      return {
        available: false,
        reason: `${field}_mismatch`,
        code,
        runId: run.id,
        status: run.status,
        checkpoint,
        summary: `Resume is blocked because the ${label} changed.`,
      };
    }
  }
  if (checkpoint.lastCompletedTaskId) {
    if (!checkpoint.verificationArtifactHash || checkpoint.verificationArtifactHash !== currentIntegrity.verificationArtifactHash) {
      return {
        available: false,
        reason: 'verification_artifact_mismatch',
        code: 'VERIFICATION_ARTIFACT_MISMATCH',
        runId: run.id,
        status: run.status,
        checkpoint,
        summary: 'Resume is blocked because the last accepted verification artifact changed or is missing.',
      };
    }
  }

  const nextStage = checkpoint.nextStage
    ? normalizeAutoResearchStage(checkpoint.nextStage)
    : normalizeAutoResearchStage(matchedTask.stage);

  return {
    available: true,
    reason: 'ready',
    runId: run.id,
    status: run.status,
    checkpoint,
    nextTaskId: String(matchedTask.id),
    nextTaskTitle: matchedTask.title || checkpoint.nextTaskTitle || null,
    nextStage,
    lastCompletedTaskId: checkpoint.lastCompletedTaskId || null,
    lastCompletedTaskTitle: checkpoint.lastCompletedTaskTitle || null,
    lastCompletedStage: checkpoint.lastCompletedStage || null,
    summary: `Resume is ready from ${matchedTask.title || checkpoint.nextTaskTitle || 'the next task'}.`,
  };
}

async function loadAutoResearchResumeState({
  run = null,
  pipelineState = null,
  promptTemplateVersion = 'auto-research-v2.1',
  codeCommit = process.env.MEDHELP_GIT_COMMIT || 'workspace:1.1.21',
  modelPolicyHash = null,
} = {}) {
  if (!run?.project_path || !run?.id) {
    return buildAutoResearchResumeState({ run, pipelineState, runTracking: null });
  }

  const runTracking = await readAutoResearchRunSummary(run.project_path, run.id, { eventLimit: 1 });
  const checkpoint = runTracking?.checkpoint || null;
  const researchSpecState = await loadResearchSpec(run.project_path);
  const nextTask = pipelineState?.nextTask || null;
  const acceptedInputHashes = checkpoint?.acceptedInputHashes
    ? await hashProjectFiles(run.project_path, Object.keys(checkpoint.acceptedInputHashes))
    : {};
  const verificationArtifactHash = checkpoint?.lastCompletedTaskId
    ? await hashFile(path.join(
        run.project_path,
        '.pipeline',
        'runs',
        String(run.id),
        'tasks',
        String(checkpoint.lastCompletedTaskId),
        'verification.json',
      ))
    : null;
  let reviewArtifactsValid = true;
  if (nextTask?.status === 'review') {
    const taskDir = path.join(run.project_path, '.pipeline', 'runs', String(run.id), 'tasks', String(nextTask.id));
    try {
      const [snapshot, result, evidence] = await Promise.all([
        fsReadJson(path.join(taskDir, 'protected-snapshot.json')),
        fsReadJson(path.join(taskDir, 'integrity-result.json')),
        fsReadJson(path.join(taskDir, 'evidence-manifest.json')),
      ]);
      reviewArtifactsValid = Boolean(snapshot && result?.pass === true && evidence);
    } catch {
      reviewArtifactsValid = false;
    }
  }
  const currentIntegrity = {
    researchSpecHash: researchSpecState.valid ? researchSpecState.spec?.specHash : null,
    nextTaskHash: nextTask ? hashTaskDefinition(nextTask) : null,
    tasksFileHash: pipelineState?.tasksFileHash
      || (pipelineState?.tasksFile ? await hashFile(pipelineState.tasksFile) : null),
    tasksDefinitionHash: pipelineState?.tasksDefinitionHash
      || hashTasksDefinition(pipelineState?.tasks || []),
    acceptedInputHashes,
    datasetSnapshotHash: hashJson(acceptedInputHashes),
    promptTemplateVersion,
    codeCommit,
    modelPolicyHash: modelPolicyHash || run.metadata?.autoResearchModelPolicyHash || null,
    verificationArtifactHash,
    reviewArtifactsValid,
  };
  return buildAutoResearchResumeState({
    run,
    pipelineState,
    runTracking,
    currentIntegrity,
  });
}

function buildAutoResearchResumeMetadata({
  existingMetadata = null,
  resumeState,
  provider,
  model,
  permissionMode,
  resumedAt = new Date().toISOString(),
} = {}) {
  const resumeCount = Math.max(0, Number(existingMetadata?.autoResearchResume?.resumeCount || 0)) + 1;

  return {
    ...(existingMetadata || {}),
    autoResearchModel: model,
    autoResearchPermissionMode: permissionMode,
    autoResearchResume: {
      resumeCount,
      resumedAt,
      resumedFromStatus: resumeState?.status || null,
      checkpointTimestamp: resumeState?.checkpoint?.timestamp || null,
      checkpointNextTaskId: resumeState?.checkpoint?.nextTaskId || null,
      checkpointNextStage: resumeState?.checkpoint?.nextStage || null,
    },
  };
}

export {
  buildAutoResearchResumeMetadata,
  buildAutoResearchResumeState,
  isAutoResearchRunResumableStatus,
  loadAutoResearchResumeState,
};
