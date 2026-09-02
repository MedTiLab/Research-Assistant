import path from 'path';
import { promises as fs } from 'fs';
import { hashFile, hashTasksDefinition } from './hash-utils.js';
import { validateTaskGraph } from './task-graph.js';

function getPipelinePaths(projectPath) {
  return {
    researchBriefFile: path.join(projectPath, '.pipeline', 'docs', 'research_brief.json'),
    tasksFile: path.join(projectPath, '.pipeline', 'tasks', 'tasks.json'),
  };
}

function extractTasksFromData(tasksData) {
  let currentTag = 'master';
  let tasks = [];

  if (Array.isArray(tasksData)) {
    tasks = tasksData;
  } else if (tasksData?.tasks) {
    tasks = tasksData.tasks;
  } else if (tasksData && typeof tasksData === 'object') {
    if (tasksData[currentTag]?.tasks) {
      tasks = tasksData[currentTag].tasks;
    } else {
      const firstTag = Object.keys(tasksData).find((key) => Array.isArray(tasksData[key]?.tasks));
      if (firstTag) {
        currentTag = firstTag;
        tasks = tasksData[firstTag].tasks;
      }
    }
  }

  return { currentTag, tasks: Array.isArray(tasks) ? tasks : [] };
}

function normalizeTaskStatus(status) {
  const raw = String(status || '').trim().toLowerCase();
  if (!raw) return 'pending';
  if (raw === 'completed' || raw === 'complete') return 'done';
  if (raw === 'in_progress' || raw === 'inprogress') return 'in-progress';
  if (raw === 'todo' || raw === 'open') return 'pending';
  return raw;
}

function normalizeTaskStage(stage) {
  const raw = String(stage || '').trim().toLowerCase();
  if (raw === 'presentation') return 'promotion';
  if (raw === 'research' || raw === 'survey') return 'literature';
  return raw;
}

function normalizeTask(task = {}) {
  return {
    ...task,
    id: task.id,
    title: task.title || 'Untitled Task',
    description: task.description || '',
    status: normalizeTaskStatus(task.status),
    priority: task.priority || 'medium',
    dependencies: Array.isArray(task.dependencies)
      ? task.dependencies.map((value) => String(value))
      : [],
    details: task.details || '',
    testStrategy: task.testStrategy || task.test_strategy || '',
    subtasks: Array.isArray(task.subtasks) ? task.subtasks : [],
    stage: normalizeTaskStage(task.stage),
    taskType: task.taskType || 'implementation',
    inputsNeeded: Array.isArray(task.inputsNeeded)
      ? task.inputsNeeded.filter(Boolean)
      : [],
    suggestedSkills: Array.isArray(task.suggestedSkills)
      ? task.suggestedSkills.filter(Boolean)
      : [],
    sourceBlueprintId: task.sourceBlueprintId || '',
    nextActionPrompt: typeof task.nextActionPrompt === 'string' ? task.nextActionPrompt : '',
    acceptanceCriteria: Array.isArray(task.acceptanceCriteria)
      ? task.acceptanceCriteria
      : [],
    expectedArtifacts: Array.isArray(task.expectedArtifacts)
      ? task.expectedArtifacts.filter(Boolean)
      : [],
    allowedOutputRoots: Array.isArray(task.allowedOutputRoots)
      ? task.allowedOutputRoots.filter(Boolean)
      : [],
    verificationMode: task.verificationMode || 'standard',
    noArtifactExpected: task.noArtifactExpected === true,
    acceptedInputFiles: Array.isArray(task.acceptedInputFiles)
      ? task.acceptedInputFiles.filter(Boolean)
      : [],
    maxAttempts: Math.max(1, Number(task.maxAttempts || 3)),
    maxVerificationAttempts: Math.max(1, Number(task.maxVerificationAttempts || 3)),
    executionState: task.executionState && typeof task.executionState === 'object'
      ? task.executionState
      : {},
  };
}

function isQualityGateTask(task = {}) {
  return String(task.sourceBlueprintId || '').trim().toLowerCase().endsWith('.quality_gate');
}

function getTaskDependencyState(task, tasks = []) {
  const byId = new Map(tasks.map((item) => [String(item.id), item]));
  const dependencies = Array.isArray(task?.dependencies)
    ? task.dependencies.map(String)
    : [];
  const unresolved = dependencies.filter((id) => {
    const dependency = byId.get(id);
    return !dependency || dependency.status !== 'done';
  });

  return {
    dependencies,
    unresolved,
    ready: unresolved.length === 0,
  };
}

function getSchedulingDependencyState(task, tasks = []) {
  const explicit = getTaskDependencyState(task, tasks);
  if (!isQualityGateTask(task)) {
    return explicit;
  }

  const taskIndex = tasks.findIndex((item) => String(item.id) === String(task.id));
  const priorStageDependencies = tasks
    .slice(0, taskIndex < 0 ? 0 : taskIndex)
    .filter((item) => item.stage === task.stage && !isQualityGateTask(item))
    .filter((item) => !['cancelled', 'deferred'].includes(item.status))
    .map((item) => String(item.id));
  const dependencies = [...new Set([...explicit.dependencies, ...priorStageDependencies])];
  const byId = new Map(tasks.map((item) => [String(item.id), item]));
  const unresolved = dependencies.filter((id) => byId.get(id)?.status !== 'done');

  return {
    dependencies,
    unresolved,
    ready: unresolved.length === 0,
  };
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return {
      exists: true,
      valid: true,
      data: JSON.parse(raw),
      error: null,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        exists: false,
        valid: false,
        data: null,
        error: null,
      };
    }

    return {
      exists: true,
      valid: false,
      data: null,
      error: error.message,
    };
  }
}

async function readPipelineState(projectPath) {
  const paths = getPipelinePaths(projectPath);
  const [researchBriefResult, tasksResult, tasksFileHash] = await Promise.all([
    readJsonIfExists(paths.researchBriefFile),
    readJsonIfExists(paths.tasksFile),
    hashFile(paths.tasksFile),
  ]);

  const tasks = tasksResult.valid
    ? extractTasksFromData(tasksResult.data).tasks.map(normalizeTask)
    : [];
  const taskGraph = tasksResult.valid
    ? validateTaskGraph(tasks)
    : { valid: false, errors: [] };

  const candidates = tasks.filter((task) => (
    task.status === 'pending'
    || task.status === 'in-progress'
    || task.status === 'review'
  ));
  const dependencyStateById = new Map(tasks.map((task) => [
    String(task.id),
    getSchedulingDependencyState(task, tasks),
  ]));
  const isReady = (task) => dependencyStateById.get(String(task.id))?.ready === true;
  const readyInProgressTask = tasks.find((task) => (
    task.status === 'in-progress' && !isQualityGateTask(task) && isReady(task)
  )) || null;
  const readyReviewTask = tasks.find((task) => task.status === 'review' && isReady(task)) || null;
  const firstReadyPendingTask = tasks.find((task) => task.status === 'pending' && isReady(task)) || null;
  const readyQualityGateTask = firstReadyPendingTask && isQualityGateTask(firstReadyPendingTask)
    ? firstReadyPendingTask
    : tasks.find((task) => (
      task.status === 'in-progress' && isQualityGateTask(task) && isReady(task)
    )) || null;
  const nextReviewTask = readyReviewTask || readyQualityGateTask;
  const nextExecutionTask = readyInProgressTask
    || (firstReadyPendingTask && !isQualityGateTask(firstReadyPendingTask) ? firstReadyPendingTask : null);
  const nextTask = readyInProgressTask || nextReviewTask || nextExecutionTask || null;
  const nextTaskKind = nextTask
    ? (nextTask === nextReviewTask ? 'verify' : 'execute')
    : null;
  const blockedTasks = candidates
    .filter((task) => !isReady(task))
    .map((task) => ({
      ...task,
      unresolvedDependencies: dependencyStateById.get(String(task.id))?.unresolved || [],
    }));
  const actionableTasks = candidates.filter(isReady);

  return {
    ...paths,
    hasResearchBrief: researchBriefResult.exists,
    researchBriefValid: researchBriefResult.exists ? researchBriefResult.valid : false,
    researchBriefError: researchBriefResult.error,
    researchBriefData: researchBriefResult.valid ? researchBriefResult.data : null,
    hasTasksFile: tasksResult.exists,
    tasksValid: tasksResult.exists ? tasksResult.valid : false,
    tasksError: tasksResult.error,
    tasks,
    taskGraph,
    tasksFileHash,
    tasksDefinitionHash: hashTasksDefinition(tasks),
    nextExecutionTask,
    nextReviewTask,
    nextTask,
    nextTaskKind,
    blockedTasks,
    actionableTaskCount: actionableTasks.length,
    reviewTaskCount: tasks.filter((task) => task.status === 'review').length,
    completedTaskCount: tasks.filter((task) => task.status === 'done').length,
  };
}

export {
  extractTasksFromData,
  getTaskDependencyState,
  getPipelinePaths,
  isQualityGateTask,
  normalizeTask,
  normalizeTaskStage,
  normalizeTaskStatus,
  readPipelineState,
};
