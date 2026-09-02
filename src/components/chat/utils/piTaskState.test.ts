import { describe, expect, it } from 'vitest';
import { applyPiTaskState, discardPiFailedAttempt } from './piTaskState';

describe('Pi task snapshots and retries', () => {
  it('removes only failed-attempt text and reasoning, preserving completed tools and previous replies', () => {
    const messages = [
      { type: 'assistant', content: 'Valid', piMessageId: 'old', timestamp: 1 },
      { type: 'assistant', isToolUse: true, toolId: 'tool', timestamp: 2 },
      { type: 'assistant', content: 'partial reasoning', isThinking: true, piMessageId: 'retry', timestamp: 3 },
      { type: 'assistant', content: 'partial text', piMessageId: 'retry', timestamp: 4 },
    ];
    expect(discardPiFailedAttempt(messages, 'retry')).toEqual(messages.slice(0, 2));
  });
  it('updates matching containers from persisted task state after a missed websocket event', () => {
    const messages = [{ type: 'assistant', timestamp: 1, isSubagentContainer: true, toolId: 'call' }];
    expect(applyPiTaskState(messages, [{ id: 'task', toolCallId: 'call', status: 'failed', error: { message: 'Interrupted upstream' }, childTools: [] }])[0])
      .toMatchObject({ subagentState: { isComplete: true, status: 'failed' }, toolResult: { isError: true } });
    expect(applyPiTaskState(messages, [{ id: 'other', toolCallId: 'different', status: 'completed' }])).toEqual(messages);
  });
  it('does not replace a newer task outcome with an older polling response', () => {
    const messages = applyPiTaskState([{ type: 'assistant', timestamp: 1, isSubagentContainer: true, toolId: 'call' }], [
      { id: 'task', toolCallId: 'call', status: 'completed', updatedAt: '2026-08-27T01:02:00Z' },
    ]);
    expect(applyPiTaskState(messages, [{ id: 'task', toolCallId: 'call', status: 'running', updatedAt: '2026-08-27T01:01:00Z' }])).toEqual(messages);
  });
});
