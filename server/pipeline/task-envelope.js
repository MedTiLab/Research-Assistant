import path from 'path';
import { promises as fs } from 'fs';

import { hashTaskDefinition } from './hash-utils.js';
import { STAGE_OUTPUT_ROOTS } from './task-prompt-context.js';

const DEFAULT_FORBIDDEN_CHANGES = [
  'research population',
  'primary biomarker/exposure',
  'primary outcome',
  'data source',
  'study design',
  'estimand',
];

function dedupeStrings(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function safeTaskId(taskId) {
  return String(taskId ?? 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function getTaskRunDirectory(projectPath, runId, taskId) {
  return path.join(
    projectPath,
    '.pipeline',
    'runs',
    String(runId),
    'tasks',
    safeTaskId(taskId),
  );
}

function getTaskEnvelopePath(projectPath, runId, taskId) {
  return path.join(getTaskRunDirectory(projectPath, runId, taskId), 'task-envelope.json');
}

function buildTaskEnvelope({
  task = {},
  runId,
  researchSpec = {},
  actor = 'executor',
  acceptedEvidence = [],
  dependencyTaskIds = null,
} = {}) {
  const stage = String(task.stage || '').trim().toLowerCase();
  const stageOutputRoots = STAGE_OUTPUT_ROOTS[stage] || [];
  const allowedOutputRoots = dedupeStrings(
    Array.isArray(task.allowedOutputRoots) && task.allowedOutputRoots.length > 0
      ? task.allowedOutputRoots
      : stageOutputRoots,
  );

  return {
    schemaVersion: '1.0',
    taskId: task.id != null ? String(task.id) : '',
    taskHash: hashTaskDefinition(task),
    runId: String(runId || ''),
    stage,
    actor,
    specVersion: Number(researchSpec.specVersion || 1),
    specHash: researchSpec.specHash || '',
    title: task.title || 'Untitled Task',
    objective: task.objective || task.description || task.nextActionPrompt || task.title || '',
    description: task.description || '',
    details: task.details || '',
    priority: task.priority || 'medium',
    taskType: task.taskType || 'implementation',
    dependencies: dedupeStrings(Array.isArray(task.dependencies) ? task.dependencies : []),
    dependencyClosure: dedupeStrings(Array.isArray(dependencyTaskIds) ? dependencyTaskIds : task.dependencies),
    requiredInputs: dedupeStrings(
      Array.isArray(task.inputsNeeded)
        ? task.inputsNeeded
        : (Array.isArray(task.requiredInputs) ? task.requiredInputs : []),
    ),
    suggestedSkills: dedupeStrings(Array.isArray(task.suggestedSkills) ? task.suggestedSkills : []),
    testStrategy: task.testStrategy || task.test_strategy || '',
    acceptanceCriteria: Array.isArray(task.acceptanceCriteria) ? task.acceptanceCriteria : [],
    expectedArtifacts: dedupeStrings(Array.isArray(task.expectedArtifacts) ? task.expectedArtifacts : []),
    allowedOutputRoots,
    verificationMode: task.verificationMode || 'standard',
    noArtifactExpected: task.noArtifactExpected === true,
    acceptedInputFiles: dedupeStrings(Array.isArray(task.acceptedInputFiles) ? task.acceptedInputFiles : []),
    attempt: Number(task.executionState?.attempt || 0),
    maxAttempts: Math.max(1, Number(task.maxAttempts || 3)),
    verificationAttempt: Number(task.executionState?.verificationAttempt || 0),
    maxVerificationAttempts: Math.max(1, Number(task.maxVerificationAttempts || 3)),
    acceptedEvidence: Array.isArray(acceptedEvidence) ? acceptedEvidence : [],
    sourceBlueprintId: task.sourceBlueprintId || '',
    nextActionPrompt: task.nextActionPrompt || '',
    forbiddenChanges: dedupeStrings([
      ...DEFAULT_FORBIDDEN_CHANGES,
      ...(Array.isArray(researchSpec.forbiddenChanges) ? researchSpec.forbiddenChanges : []),
    ]),
    protectedFiles: [
      '.pipeline/docs/research_spec.json',
      '.pipeline/tasks/tasks.json',
      'instance.json',
      '.pipeline/config.json',
    ],
    sessionIsolation: 'new-session-per-task',
    createdAt: new Date().toISOString(),
  };
}

async function writeTaskEnvelope(projectPath, runId, envelope) {
  const filePath = getTaskEnvelopePath(projectPath, runId, envelope.taskId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
  return filePath;
}

async function readTaskEnvelope(projectPath, runId, taskId) {
  try {
    return JSON.parse(await fs.readFile(getTaskEnvelopePath(projectPath, runId, taskId), 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export {
  DEFAULT_FORBIDDEN_CHANGES,
  buildTaskEnvelope,
  getTaskEnvelopePath,
  getTaskRunDirectory,
  readTaskEnvelope,
  writeTaskEnvelope,
};
