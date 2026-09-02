import {
  getRequiredAgentRuntime,
  listAgentRuntimes,
} from './registry.js';
import {
  findUniqueCoordinatedAgentTurn,
  getCoordinatedAgentTurn,
  listCoordinatedAgentTurns,
} from './turn-coordinator.js';
import {
  createAgentSessionIdentity,
  createAgentSessionKey,
  normalizeRuntimeId,
} from '../utils/agentSessionIdentity.js';

function requireRuntimeId(value) {
  const runtimeId = normalizeRuntimeId(value);
  if (!runtimeId) {
    const error = new Error('A runtimeId is required for agent lifecycle operations.');
    error.code = 'AGENT_RUNTIME_NOT_FOUND';
    error.runtimeId = null;
    throw error;
  }
  return runtimeId;
}

function normalizeLifecycleTarget(runtimeOrIdentity, legacySessionId = null) {
  if (runtimeOrIdentity && typeof runtimeOrIdentity === 'object') {
    const identity = createAgentSessionIdentity(runtimeOrIdentity);
    return {
      identity,
      runtimeId: identity.runtimeId,
      sessionId: identity.sessionId,
      coordinatedTurn: getCoordinatedAgentTurn(identity),
      isComposite: true,
    };
  }
  const runtimeId = requireRuntimeId(runtimeOrIdentity);
  const sessionId = typeof legacySessionId === 'string' ? legacySessionId.trim() : '';
  return {
    identity: null,
    runtimeId,
    sessionId,
    coordinatedTurn: findUniqueCoordinatedAgentTurn(runtimeId, sessionId),
    isComposite: false,
  };
}

function runtimeSessionIdForTarget(target) {
  return target.coordinatedTurn?.runtimeSessionKey || target.sessionId;
}

export function getAgentRuntimeSessionStatus(runtimeOrIdentity, legacySessionId = null) {
  const target = normalizeLifecycleTarget(runtimeOrIdentity, legacySessionId);
  const runtime = getRequiredAgentRuntime(target.runtimeId);
  const runtimeSessionId = runtimeSessionIdForTarget(target);
  const status = {
    runtimeId: target.runtimeId,
    sessionId: target.coordinatedTurn?.identity?.sessionId || target.sessionId,
    isActive: Boolean(target.coordinatedTurn && target.coordinatedTurn.status !== 'settled')
      || Boolean(runtime.isActive(runtimeSessionId)),
    startTime: target.coordinatedTurn?.startedAt
      ?? runtime.getStartTime(runtimeSessionId)
      ?? null,
  };
  if (!target.isComposite) return status;
  return {
    ...status,
    sessionKey: target.coordinatedTurn?.sessionKey || createAgentSessionKey(target.identity),
    projectKey: target.coordinatedTurn?.identity.projectKey || target.identity.projectKey,
    ownerKey: target.coordinatedTurn?.identity.ownerKey || target.identity.ownerKey,
    turnId: target.coordinatedTurn?.turnId || null,
  };
}

export async function abortAgentRuntimeSession(runtimeOrIdentity, legacySessionId = null) {
  const target = normalizeLifecycleTarget(runtimeOrIdentity, legacySessionId);
  const runtime = getRequiredAgentRuntime(target.runtimeId);
  return Boolean(await runtime.abort(runtimeSessionIdForTarget(target)));
}

export async function steerAgentRuntimeSession(runtimeOrIdentity, command, legacyCommand = null) {
  const isComposite = runtimeOrIdentity && typeof runtimeOrIdentity === 'object';
  const target = normalizeLifecycleTarget(
    runtimeOrIdentity,
    isComposite ? null : command,
  );
  const normalizedCommand = isComposite ? command : legacyCommand;
  const runtime = getRequiredAgentRuntime(target.runtimeId, { capability: 'steering' });
  return runtime.steer(runtimeSessionIdForTarget(target), normalizedCommand);
}

export function getActiveAgentTurnSessions() {
  return listCoordinatedAgentTurns().map((record) => ({
    ...record.identity,
    sessionKey: record.sessionKey,
    turnId: record.turnId,
    startTime: record.startedAt,
    status: record.status,
  }));
}

export function getActiveAgentRuntimeSessions() {
  const active = Object.fromEntries(listAgentRuntimes().map((runtimeId) => {
    const runtime = getRequiredAgentRuntime(runtimeId);
    return [runtimeId, [...runtime.getActiveSessions()]];
  }));
  for (const record of listCoordinatedAgentTurns()) {
    const sessionIds = active[record.runtimeId] || (active[record.runtimeId] = []);
    const runtimeHandleIndex = sessionIds.indexOf(record.runtimeSessionKey);
    if (runtimeHandleIndex >= 0) sessionIds.splice(runtimeHandleIndex, 1);
    if (!sessionIds.includes(record.identity.sessionId)) sessionIds.push(record.identity.sessionId);
  }
  return active;
}

export function hasActiveAgentRuntimeSessions() {
  if (listCoordinatedAgentTurns().length > 0) return true;
  return listAgentRuntimes().some((runtimeId) => (
    getRequiredAgentRuntime(runtimeId).getActiveSessions().length > 0
  ));
}

export async function abortAllAgentRuntimeSessions() {
  const abortTasks = [];
  const scheduled = new Set();
  for (const record of listCoordinatedAgentTurns()) {
    const key = `${record.runtimeId}\0${record.runtimeSessionKey}`;
    scheduled.add(key);
    abortTasks.push(Promise.resolve(record.runtime.abort(record.runtimeSessionKey)));
  }
  for (const runtimeId of listAgentRuntimes()) {
    const runtime = getRequiredAgentRuntime(runtimeId);
    for (const sessionId of runtime.getActiveSessions()) {
      const key = `${runtimeId}\0${sessionId}`;
      if (scheduled.has(key)) continue;
      scheduled.add(key);
      abortTasks.push(Promise.resolve(runtime.abort(sessionId)));
    }
  }
  return Promise.allSettled(abortTasks);
}

export async function getAgentRuntimeDiagnostics(runtimeId = null) {
  const runtimeIds = runtimeId ? [requireRuntimeId(runtimeId)] : listAgentRuntimes();
  return Promise.all(runtimeIds.map(async (id) => {
    const runtime = getRequiredAgentRuntime(id);
    const nativeDiagnostics = typeof runtime.native?.diagnostics === 'function'
      ? await runtime.native.diagnostics()
      : runtime.native?.diagnostics ?? null;
    return {
      runtimeId: id,
      capabilities: runtime.capabilities,
      activeSessions: getActiveAgentRuntimeSessions()[id] || [],
      coordinatedTurns: getActiveAgentTurnSessions().filter((turn) => turn.runtimeId === id),
      native: nativeDiagnostics,
    };
  }));
}

export async function shutdownAgentRuntimes() {
  await abortAllAgentRuntimeSessions();
  const results = [];
  for (const runtimeId of listAgentRuntimes()) {
    const runtime = getRequiredAgentRuntime(runtimeId);
    if (typeof runtime.native?.shutdown !== 'function') continue;
    results.push(Promise.resolve(runtime.native.shutdown()));
  }
  return Promise.allSettled(results);
}

export function createAgentRuntimeErrorPayload(error, runtimeId) {
  return {
    type: 'agent-runtime-error',
    code: error?.code || 'AGENT_RUNTIME_ERROR',
    runtimeId: normalizeRuntimeId(runtimeId),
    error: error instanceof Error ? error.message : String(error || 'Agent runtime error'),
  };
}
