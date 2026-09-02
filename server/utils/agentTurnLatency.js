const AGENT_TURN_PHASES = Object.freeze([
  'message_received',
  'preprocessing_completed',
  'turn_started',
  'first_text',
  'completed',
]);

function createAgentTurnLatencyTracker(options = {}) {
  const provider = String(options.provider || 'unknown');
  const commandType = String(options.commandType || `${provider}-command`);
  const writer = options.writer || null;
  const startedAtMs = Number.isFinite(options.receivedAtMs) ? Number(options.receivedAtMs) : Date.now();
  const marks = new Map();
  let sessionId = options.sessionId || options.clientSessionId || null;
  let previousAtMs = startedAtMs;

  const mark = (phase, metadata = {}) => {
    if (!AGENT_TURN_PHASES.includes(phase) || marks.has(phase)) {
      return marks.get(phase) || null;
    }
    const timestampMs = Number.isFinite(metadata.timestampMs) ? Number(metadata.timestampMs) : Date.now();
    const resolvedSessionId = metadata.sessionId || sessionId || null;
    if (resolvedSessionId) sessionId = resolvedSessionId;
    const metric = {
      provider,
      commandType,
      phase,
      timestampMs,
      sinceReceivedMs: Math.max(0, timestampMs - startedAtMs),
      sincePreviousMs: Math.max(0, timestampMs - previousAtMs),
      sessionId: resolvedSessionId,
      outcome: metadata.outcome || null,
      memoryMode: metadata.memoryMode || null,
      memoryChars: Number.isFinite(metadata.memoryChars) ? Number(metadata.memoryChars) : null,
      contextTokens: Number.isFinite(metadata.contextTokens) ? Number(metadata.contextTokens) : null,
    };
    marks.set(phase, metric);
    previousAtMs = timestampMs;
    try {
      writer?.send?.({
        type: 'agent-turn-metric',
        data: metric,
        sessionId: resolvedSessionId,
      });
    } catch {}
    return metric;
  };

  return {
    mark,
    setSessionId(nextSessionId) {
      if (nextSessionId) sessionId = nextSessionId;
    },
    getMarks() {
      return Object.fromEntries(marks);
    },
  };
}

export {
  AGENT_TURN_PHASES,
  createAgentTurnLatencyTracker,
};
