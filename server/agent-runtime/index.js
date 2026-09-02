import { claudeRuntime } from './claude-runtime.js';
import { codexRuntime } from './codex-runtime.js';
import { piRuntime } from './pi-runtime.js';
import { registerAgentRuntime } from './registry.js';
import { db } from '../database/db.js';
import { agentTurnCoordinator } from './turn-coordinator.js';
import { abortAgentRuntimeSession } from './lifecycle-coordinator.js';
import { createAgentRunStore } from './run-store.js';
import { createAgentRunEngine } from './run-engine.js';

registerAgentRuntime(piRuntime.id, piRuntime);

export const agentRunStore = createAgentRunStore(db);
export const agentRunEngine = createAgentRunEngine({
  store: agentRunStore,
  execute: (...args) => agentTurnCoordinator.execute(...args),
  cancelRun: (run) => abortAgentRuntimeSession({
    ownerKey: run.ownerKey,
    projectKey: run.projectKey,
    runtimeId: run.runtimeId,
    sessionId: run.sessionId,
  }),
});

export const executeAgentTurn = (...args) => agentRunEngine.submit(...args);
export const startAgentRunEngine = () => agentRunEngine.start();
export const beginAgentRunEngineDrain = () => agentRunEngine.beginDrain();
export const stopAgentRunEngine = (options) => agentRunEngine.stop(options);
export const getAgentRunEngineStatus = () => agentRunEngine.status();
export const getAgentRun = (runId) => agentRunEngine.get(runId);
export const listAgentRuns = (options) => agentRunEngine.list(options);
export const cancelAgentRun = (runId, ownerKey) => agentRunEngine.cancel(runId, ownerKey);

export { claudeRuntime } from './claude-runtime.js';
export { codexRuntime } from './codex-runtime.js';
export { piRuntime } from './pi-runtime.js';
export { assertAgentRuntime, REQUIRED_RUNTIME_METHODS } from './contract.js';
export {
  createEmptyRuntimeUsage,
  mergeRuntimeUsage,
  normalizeClaudeRuntimeUsage,
  normalizeCodexRuntimeUsage,
  normalizePiRuntimeUsage,
  normalizeRuntimeUsage,
} from './usage.js';
export {
  isRuntimeObservationType,
  normalizeRuntimeObservations,
  normalizeAgentRuntimeEvents,
  RUNTIME_OBSERVATION_TYPES,
} from './observations/index.js';
export {
  getAgentRuntime,
  getRequiredAgentRuntime,
  hasAgentRuntime,
  listAgentRuntimes,
  registerAgentRuntime,
} from './registry.js';
export {
  agentTurnCoordinator,
  createAgentTurnCoordinator,
  findUniqueCoordinatedAgentTurn,
  getCoordinatedAgentTurn,
  listCoordinatedAgentTurns,
} from './turn-coordinator.js';
export {
  abortAgentRuntimeSession,
  abortAllAgentRuntimeSessions,
  createAgentRuntimeErrorPayload,
  getActiveAgentTurnSessions,
  getActiveAgentRuntimeSessions,
  getAgentRuntimeDiagnostics,
  getAgentRuntimeSessionStatus,
  hasActiveAgentRuntimeSessions,
  shutdownAgentRuntimes,
  steerAgentRuntimeSession,
} from './lifecycle-coordinator.js';
export {
  assertRuntimeSessionStore,
  createRuntimeSessionStoreRegistry,
  REQUIRED_SESSION_STORE_METHODS,
} from './session-store-registry.js';
export {
  ClaudeSessionStore,
  CodexSessionStore,
  PiSessionStore,
  claudeSessionStore,
  codexSessionStore,
  piSessionStore,
  runtimeSessionStoreRegistry,
} from './session-stores/index.js';
