import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import { createAgentSessionIdentity } from '../utils/agentSessionIdentity.js';
import { getRuntimeSessionDataRoot, getRuntimeSessionFilePath } from '../utils/storagePaths.js';
import { canonicalAgentToolName } from '../../shared/agentRuntimeEvents.js';

export const AGENT_RUNTIME_STATE_VERSION = 1;

const mutationQueues = new Map();

function nowIso() {
  return new Date().toISOString();
}

function normalizeArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function normalizeState(identity, value = {}) {
  const normalizedIdentity = createAgentSessionIdentity(identity);
  return {
    version: AGENT_RUNTIME_STATE_VERSION,
    identity: normalizedIdentity,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
    runs: normalizeArray(value.runs),
    toolCalls: normalizeArray(value.toolCalls),
    tasks: normalizeArray(value.tasks),
    todos: normalizeArray(value.todos),
    artifacts: normalizeArray(value.artifacts),
    contextItems: normalizeArray(value.contextItems),
    permissionRequests: normalizeArray(value.permissionRequests),
    plan: value.plan && typeof value.plan === 'object' ? value.plan : null,
  };
}

export function resolveAgentRuntimeStatePath(identity, options = {}) {
  return getRuntimeSessionFilePath(createAgentSessionIdentity(identity), {
    ...options,
    extension: 'agent-state.json',
  });
}

export async function readAgentRuntimeState(identity, options = {}) {
  const normalizedIdentity = createAgentSessionIdentity(identity);
  const statePath = options.statePath || resolveAgentRuntimeStatePath(normalizedIdentity, options);
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    return normalizeState(normalizedIdentity, JSON.parse(raw));
  } catch (error) {
    if (error?.code === 'ENOENT') return normalizeState(normalizedIdentity);
    throw error;
  }
}

async function writeAgentRuntimeState(identity, state, options = {}) {
  const normalizedIdentity = createAgentSessionIdentity(identity);
  const statePath = options.statePath || resolveAgentRuntimeStatePath(normalizedIdentity, options);
  const next = normalizeState(normalizedIdentity, {
    ...state,
    updatedAt: nowIso(),
  });
  await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${statePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fs.rename(temporaryPath, statePath);
  return next;
}

export function mutateAgentRuntimeState(identity, mutator, options = {}) {
  const normalizedIdentity = createAgentSessionIdentity(identity);
  const statePath = options.statePath || resolveAgentRuntimeStatePath(normalizedIdentity, options);
  const previous = mutationQueues.get(statePath) || Promise.resolve();
  const operation = previous.then(async () => {
    const state = await readAgentRuntimeState(normalizedIdentity, { ...options, statePath });
    const result = await mutator(state);
    return writeAgentRuntimeState(normalizedIdentity, result || state, { ...options, statePath });
  });
  const settled = operation.then(() => undefined, () => undefined);
  mutationQueues.set(statePath, settled);
  settled.then(() => {
    if (mutationQueues.get(statePath) === settled) mutationQueues.delete(statePath);
  });
  return operation;
}

// Managed Pi hosts share this writer with background tasks and API actions.
// Never accept identity or filesystem paths from a host operation's payload.
export async function applyAgentRuntimeStateOperation(identity, operation, args = [], options = {}) {
  if (!Array.isArray(args)) throw new Error('Invalid agent state arguments');
  if (operation === 'read') {
    await mutationQueues.get(options.statePath || resolveAgentRuntimeStatePath(identity, options));
    return readAgentRuntimeState(identity, options);
  }
  const collections = {
    updateRun: ['runs', 100], updateToolCall: ['toolCalls', 1000],
    upsertTask: ['tasks', null], updatePermission: ['permissionRequests', 200],
    addArtifact: ['artifacts', 500], addContextItem: ['contextItems', 500],
  };
  if (!Object.hasOwn(collections, operation) && !['replaceTodos', 'updatePlan'].includes(operation)) {
    throw new Error('Unknown agent state operation');
  }
  let entry;
  const state = await mutateAgentRuntimeState(identity, (current) => {
    const timestamp = nowIso();
    if (operation === 'updatePlan') {
      current.plan = args[0];
    } else if (operation === 'replaceTodos') {
      if (!Array.isArray(args[0])) throw new Error('Invalid todo snapshot');
      let inProgress = false;
      current.todos = args[0].map((todo, index) => {
        let status = ['pending', 'in_progress', 'completed'].includes(todo?.status) ? todo.status : 'pending';
        if (status === 'in_progress') { if (inProgress) status = 'pending'; inProgress = true; }
        return { id: String(todo?.id || `todo-${index + 1}`), content: String(todo?.content || todo?.text || '').slice(0, 4000), status,
          activeForm: typeof todo?.activeForm === 'string' ? todo.activeForm.slice(0, 1000) : null, updatedAt: timestamp };
      }).filter((todo) => todo.content);
    } else {
      const [collection, limit] = collections[operation];
      const add = operation.startsWith('add');
      const changes = add ? args[0] : args[1];
      if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Invalid agent state update');
      const id = String(add ? changes.id || `${collection}-${crypto.randomUUID()}` : args[0] || '');
      if (!id) throw new Error('Agent state id required');
      const index = current[collection].findIndex((item) => String(item.id) === id);
      entry = { ...(index < 0 ? { createdAt: timestamp } : current[collection][index]), ...changes, id, updatedAt: timestamp };
      if (index < 0) current[collection].push(entry);
      else current[collection][index] = entry;
      if (limit) current[collection] = current[collection].slice(-limit);
    }
    return current;
  }, options);
  return ['upsertTask', 'addArtifact', 'addContextItem', 'updatePermission'].includes(operation) ? entry : state;
}

export async function updateAgentRuntimeTask(identity, taskId, changes, options = {}) {
  return mutateAgentRuntimeState(identity, (state) => {
    const timestamp = nowIso();
    const index = state.tasks.findIndex((task) => String(task.id) === String(taskId));
    if (index === -1) {
      state.tasks.push({
        id: String(taskId),
        title: changes?.title || 'Agent task',
        status: changes?.status || 'queued',
        createdAt: timestamp,
        updatedAt: timestamp,
        ...changes,
      });
    } else {
      state.tasks[index] = { ...state.tasks[index], ...changes, updatedAt: timestamp };
    }
    return state;
  }, options);
}

export async function updateAgentRuntimeRun(identity, runId, changes, options = {}) {
  return mutateAgentRuntimeState(identity, (state) => {
    const timestamp = nowIso();
    const index = state.runs.findIndex((run) => String(run.id) === String(runId));
    if (index === -1) {
      state.runs.push({
        id: String(runId),
        status: changes?.status || 'running',
        createdAt: timestamp,
        updatedAt: timestamp,
        ...changes,
      });
    } else {
      state.runs[index] = { ...state.runs[index], ...changes, updatedAt: timestamp };
    }
    state.runs = state.runs.slice(-100);
    return state;
  }, options);
}

export async function listAgentRuntimeStates(projectIdentity, options = {}) {
  const normalized = createAgentSessionIdentity({
    ...projectIdentity,
    sessionId: projectIdentity?.sessionId || 'list-placeholder',
  });
  const root = getRuntimeSessionDataRoot(normalized, options);
  let entries = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const states = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.agent-state.json')) continue;
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(root, entry.name), 'utf8'));
      if (!parsed?.identity?.sessionId) continue;
      states.push(normalizeState({
        ...normalized,
        sessionId: parsed.identity.sessionId,
      }, parsed));
    } catch (error) {
      console.warn('[AgentRuntimeState] Ignoring invalid state file:', entry.name, error?.message || error);
    }
  }
  return states.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
}

export function summarizeAgentWork(states = [], options = {}) {
  const recentLimit = Number.isFinite(options.recentLimit) ? Math.max(1, options.recentLimit) : 12;
  const tasks = states.flatMap((state) => state.tasks.map((task) => ({
    ...task,
    kind: 'task',
    sessionId: task.sessionId || state.identity.sessionId,
    runtimeId: task.runtimeId || state.identity.runtimeId,
    projectKey: task.projectKey || state.identity.projectKey,
  })));
  const runs = states.flatMap((state) => state.runs.map((run) => ({
    ...run,
    kind: 'run',
    sessionId: run.sessionId || state.identity.sessionId,
    runtimeId: run.runtimeId || state.identity.runtimeId,
    projectKey: run.projectKey || state.identity.projectKey,
  })));
  const permissions = states.flatMap((state) => state.permissionRequests.map((request) => ({
    ...request,
    kind: 'permission',
    toolName: canonicalAgentToolName(request.toolName),
    sessionId: request.sessionId || state.identity.sessionId,
    runtimeId: request.runtimeId || state.identity.runtimeId,
    projectKey: request.projectKey || state.identity.projectKey,
  })));
  const needsAttention = [
    ...tasks.filter((task) => ['waiting_on_user', 'blocked', 'failed', 'interrupted'].includes(task.status)),
    ...runs.filter((run) => ['failed', 'interrupted'].includes(run.status)),
    ...permissions.filter((request) => request.status === 'pending'),
  ];
  const active = [
    ...tasks.filter((task) => ['queued', 'running', 'in_progress'].includes(task.status)),
    ...runs.filter((run) => ['queued', 'running'].includes(run.status)),
  ];
  const scheduled = tasks.filter((task) => task.status === 'scheduled' || task.schedule);
  const recent = [
    ...tasks.filter((task) => ['completed', 'cancelled'].includes(task.status)),
    ...runs.filter((run) => ['completed', 'failed', 'cancelled'].includes(run.status)),
  ]
    .sort((left, right) => String(right.updatedAt || right.completedAt || '').localeCompare(String(left.updatedAt || left.completedAt || '')))
    .slice(0, recentLimit);
  return { states, tasks, runs, permissions, needsAttention, active, scheduled, recent };
}

export function agentStateTokenUsage(state) {
  const usage = state?.runs?.at(-1)?.usage;
  const context = usage?.context;
  return { used: Number.isFinite(context?.tokens) ? context.tokens : null, total: Number(context?.contextWindow) || null,
    estimated: Boolean(context?.estimated), unsupportedContext: !context?.contextWindow,
    model: usage?.model || state?.runs?.at(-1)?.model?.modelId || null,
    breakdown: usage?.tokens ? { input: usage.tokens.input, output: usage.tokens.output, cacheRead: usage.tokens.cacheRead, cacheCreation: usage.tokens.cacheWrite } : undefined };
}
