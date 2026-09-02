import { describe, expect, it } from 'vitest';

import { enqueueRealtimeMessage, mergeAdjacentRealtimeMessages } from './webSocketMessageQueue';

describe('webSocketMessageQueue', () => {
  it('coalesces Pi deltas only within one message, project and event kind', () => {
    const queue: Record<string, any>[] = [];
    const event = (text: string, extra = {}) => ({ type: 'pi-response', sessionId: 'same', projectName: 'project',
      data: { event: 'text_delta', data: { messageId: 'answer', text } }, ...extra });
    for (let index = 0; index < 1000; index++) enqueueRealtimeMessage(queue, event('字'));
    expect(queue).toHaveLength(1);
    expect(queue[0].data.data.text).toBe('字'.repeat(1000));
    enqueueRealtimeMessage(queue, event('other', { projectName: 'other' }));
    enqueueRealtimeMessage(queue, event('next', { data: { event: 'text_delta', data: { messageId: 'next', text: 'next' } } }));
    enqueueRealtimeMessage(queue, event('reason', { data: { event: 'thinking_delta', data: { messageId: 'next', text: 'reason' } } }));
    enqueueRealtimeMessage(queue, { type: 'pi-complete', sessionId: 'same' });
    expect(queue).toHaveLength(5);
  });
  it('combines adjacent Claude text deltas without changing their order', () => {
    const first = {
      type: 'claude-response',
      sessionId: 'session-1',
      data: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } },
    };
    const second = {
      type: 'claude-response',
      sessionId: 'session-1',
      data: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Windows' } },
    };

    expect(mergeAdjacentRealtimeMessages(first, second)).toMatchObject({
      data: { delta: { text: 'Hello Windows' } },
    });
  });

  it('prevents a large Claude stream from growing into a timer backlog', () => {
    const queue: Record<string, any>[] = [];

    for (let index = 0; index < 2_000; index += 1) {
      enqueueRealtimeMessage(queue, {
        type: 'claude-response',
        sessionId: 'session-1',
        data: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } },
      });
    }

    expect(queue).toHaveLength(1);
    expect(queue[0].data.delta.text).toHaveLength(2_000);
  });

  it('keeps stream boundaries and different sessions as separate entries', () => {
    const queue: Record<string, any>[] = [];
    enqueueRealtimeMessage(queue, {
      type: 'claude-response',
      sessionId: 'session-1',
      data: { type: 'content_block_delta', delta: { text: 'one' } },
    });
    enqueueRealtimeMessage(queue, {
      type: 'claude-response',
      sessionId: 'session-2',
      data: { type: 'content_block_delta', delta: { text: 'two' } },
    });
    enqueueRealtimeMessage(queue, {
      type: 'claude-response',
      sessionId: 'session-2',
      data: { type: 'content_block_stop' },
    });

    expect(queue).toHaveLength(3);
  });

  it('keeps only the newest queued Codex update for the same item', () => {
    const queue: Record<string, any>[] = [];
    enqueueRealtimeMessage(queue, {
      type: 'codex-response',
      sessionId: 'session-1',
      data: {
        type: 'item',
        itemType: 'agent_message',
        itemId: 'item-1',
        lifecycle: 'updated',
        message: { content: 'partial' },
      },
    });
    enqueueRealtimeMessage(queue, {
      type: 'codex-response',
      sessionId: 'session-1',
      data: {
        type: 'item',
        itemType: 'agent_message',
        itemId: 'item-1',
        lifecycle: 'completed',
        message: { content: 'final answer' },
      },
    });

    expect(queue).toHaveLength(1);
    expect(queue[0].data.lifecycle).toBe('completed');
    expect(queue[0].data.message.content).toBe('final answer');
  });

  it('drops a stale Codex snapshot even when a project notification is interleaved', () => {
    const queue: Record<string, any>[] = [];
    enqueueRealtimeMessage(queue, {
      type: 'codex-response',
      sessionId: 'session-1',
      data: {
        type: 'item',
        itemType: 'agent_message',
        itemId: 'item-1',
        lifecycle: 'updated',
        message: { content: 'partial' },
      },
    });
    enqueueRealtimeMessage(queue, {
      type: 'projects_updated',
      projects: [],
    });
    enqueueRealtimeMessage(queue, {
      type: 'codex-response',
      sessionId: 'session-1',
      data: {
        type: 'item',
        itemType: 'agent_message',
        itemId: 'item-1',
        lifecycle: 'updated',
        message: { content: 'complete cumulative text' },
      },
    });

    expect(queue).toHaveLength(2);
    expect(queue[0].type).toBe('projects_updated');
    expect(queue[1].data.message.content).toBe('complete cumulative text');
  });

  it('coalesces cumulative Codex reasoning snapshots instead of delaying the final answer', () => {
    const queue: Record<string, any>[] = [];

    for (let index = 1; index <= 2_000; index += 1) {
      enqueueRealtimeMessage(queue, {
        type: 'codex-response',
        sessionId: 'session-1',
        data: {
          type: 'item',
          itemType: 'reasoning',
          itemId: 'reasoning-1',
          lifecycle: 'updated',
          message: { content: 'x'.repeat(index) },
        },
      });
    }

    enqueueRealtimeMessage(queue, {
      type: 'codex-response',
      sessionId: 'session-1',
      data: {
        type: 'item',
        itemType: 'agent_message',
        itemId: 'answer-1',
        lifecycle: 'completed',
        message: { content: '最终回答' },
      },
    });

    expect(queue).toHaveLength(2);
    expect(queue[0].data.message.content).toHaveLength(2_000);
    expect(queue[1].data.message.content).toBe('最终回答');
  });

});
