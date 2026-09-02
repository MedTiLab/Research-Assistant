import {
  abortCodexSession,
  compactCodexSession,
  getActiveCodexSessions,
  getCodexSessionStartTime,
  isCodexPlaceholderSessionId,
  isCodexSessionActive,
  queryCodex,
  shutdownCodexRuntime,
  steerCodexSession,
} from '../openai-codex.js';

const capabilityDetails = Object.freeze({
  skills: Object.freeze({ mode: 'medhelp-codex-bridge' }),
  steering: Object.freeze({
    mode: 'turn-steer',
    buffersBeforeTurnId: true,
  }),
  reasoning: Object.freeze({
    mode: 'reasoning-effort',
    activityEvents: true,
  }),
  approval: Object.freeze({
    mode: 'app-server',
    interactive: false,
    fallback: 'deny',
  }),
  context: Object.freeze({ compaction: 'native' }),
  process: Object.freeze({ mode: 'persistent-app-server' }),
});

const capabilities = Object.freeze({
  provider: 'codex',
  sessionResume: true,
  steering: true,
  turnQueue: true,
  nativeSkills: true,
  mcp: true,
  interactiveToolApproval: false,
  thinking: false,
  planMode: false,
  nativeContextCompaction: true,
  persistentAppServer: true,
  capabilityDetails,
});

export const codexRuntime = Object.freeze({
  id: 'codex',
  capabilities,
  start: queryCodex,
  resume: queryCodex,
  steer: steerCodexSession,
  abort: abortCodexSession,
  isActive: isCodexSessionActive,
  getActiveSessions: getActiveCodexSessions,
  getStartTime: getCodexSessionStartTime,
  native: Object.freeze({
    compact: compactCodexSession,
    isPlaceholderSessionId: isCodexPlaceholderSessionId,
    shutdown: shutdownCodexRuntime,
  }),
});

export default codexRuntime;
