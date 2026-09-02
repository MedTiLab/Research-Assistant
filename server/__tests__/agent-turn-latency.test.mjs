import { describe, expect, it } from 'vitest';

import { createAgentTurnLatencyTracker } from '../utils/agentTurnLatency.js';

describe('agent turn latency metrics', () => {
  it('emits each of the five phases once from one server clock', () => {
    const messages = [];
    const tracker = createAgentTurnLatencyTracker({
      provider: 'codex',
      commandType: 'codex-command',
      sessionId: 'thread-1',
      receivedAtMs: 1_000,
      writer: { send: (message) => messages.push(message) },
    });

    tracker.mark('message_received', { timestampMs: 1_000 });
    tracker.mark('preprocessing_completed', { timestampMs: 1_040, memoryMode: 'delta', memoryChars: 420 });
    tracker.mark('turn_started', { timestampMs: 1_120 });
    tracker.mark('first_text', { timestampMs: 1_360 });
    tracker.mark('first_text', { timestampMs: 1_500 });
    tracker.mark('completed', { timestampMs: 2_000, outcome: 'completed', contextTokens: 70_000 });

    expect(messages.map((message) => message.data.phase)).toEqual([
      'message_received',
      'preprocessing_completed',
      'turn_started',
      'first_text',
      'completed',
    ]);
    expect(messages[1].data).toMatchObject({
      sinceReceivedMs: 40,
      sincePreviousMs: 40,
      memoryMode: 'delta',
      memoryChars: 420,
    });
    expect(messages.at(-1).data).toMatchObject({
      sinceReceivedMs: 1_000,
      sincePreviousMs: 640,
      outcome: 'completed',
      contextTokens: 70_000,
    });
  });
});
