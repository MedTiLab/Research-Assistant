import {
  abortClaudeSDKSession,
  getActiveClaudeSDKSessions,
  getClaudeSDKSessionStartTime,
  isClaudeSDKSessionActive,
  queryClaudeSDK,
  resolveToolApproval,
  steerClaudeSDKSession,
} from '../claude-sdk.js';

const capabilityDetails = Object.freeze({
  skills: Object.freeze({ mode: 'claude-native-plugin' }),
  steering: Object.freeze({ mode: 'live-input' }),
  reasoning: Object.freeze({
    mode: 'thinking-control',
    activityEvents: true,
  }),
  approval: Object.freeze({ mode: 'sdk-callback' }),
  context: Object.freeze({ compaction: 'provider-managed' }),
  process: Object.freeze({ mode: 'sdk-query' }),
});

const capabilities = Object.freeze({
  provider: 'claude',
  sessionResume: true,
  steering: true,
  turnQueue: true,
  nativeSkills: true,
  mcp: true,
  interactiveToolApproval: true,
  thinking: true,
  planMode: true,
  nativeContextCompaction: false,
  persistentAppServer: false,
  capabilityDetails,
});

export const claudeRuntime = Object.freeze({
  id: 'claude',
  capabilities,
  start: queryClaudeSDK,
  resume: queryClaudeSDK,
  steer: steerClaudeSDKSession,
  abort: abortClaudeSDKSession,
  isActive: isClaudeSDKSessionActive,
  getActiveSessions: getActiveClaudeSDKSessions,
  getStartTime: getClaudeSDKSessionStartTime,
  native: Object.freeze({
    resolveToolApproval,
  }),
});

export default claudeRuntime;
