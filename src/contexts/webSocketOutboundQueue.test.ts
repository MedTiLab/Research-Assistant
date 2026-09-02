import { describe, expect, it } from 'vitest';

import {
  createOutboundQueueEntry,
  enqueueOutboundMessage,
  pruneExpiredOutboundMessages,
  type OutboundQueueEntry,
} from './webSocketOutboundQueue';

describe('webSocketOutboundQueue', () => {
  it('adds a stable client operation id to replay-sensitive writes', () => {
    const entry = createOutboundQueueEntry(
      { type: 'agent-command', runtimeId: 'claude', command: 'run analysis' },
      { now: 100, operationIdFactory: () => 'operation-1' },
    );

    expect(entry.clientOperationId).toBe('operation-1');
    expect(JSON.parse(entry.payload)).toMatchObject({
      type: 'agent-command',
      runtimeId: 'claude',
      clientOperationId: 'operation-1',
    });
  });

  it('coalesces stale status requests for the same session', () => {
    const queue: OutboundQueueEntry[] = [];
    enqueueOutboundMessage(queue, createOutboundQueueEntry({
      type: 'check-session-status',
      provider: 'claude',
      sessionId: 'session-1',
    }, { now: 100 }), { now: 100 });
    const result = enqueueOutboundMessage(queue, createOutboundQueueEntry({
      type: 'check-session-status',
      provider: 'claude',
      sessionId: 'session-1',
    }, { now: 200 }), { now: 200 });

    expect(result).toMatchObject({ accepted: true, coalesced: 1 });
    expect(queue).toHaveLength(1);
    expect(queue[0].queuedAt).toBe(200);
  });

  it('expires status messages instead of replaying stale state queries', () => {
    const queue = [createOutboundQueueEntry(
      { type: 'get-active-sessions' },
      { now: 1_000 },
    )];

    expect(pruneExpiredOutboundMessages(queue, 31_001)).toBe(1);
    expect(queue).toHaveLength(0);
  });

  it('keeps only the latest offline edit for one queued turn', () => {
    const queue: OutboundQueueEntry[] = [];
    const first = createOutboundQueueEntry({
      type: 'agent-turn-update',
      provider: 'claude',
      sessionId: 'session-1',
      itemId: 'item-1',
      content: 'draft',
    }, { now: 100, operationIdFactory: () => 'operation-1' });
    const latest = createOutboundQueueEntry({
      type: 'agent-turn-update',
      provider: 'claude',
      sessionId: 'session-1',
      itemId: 'item-1',
      content: 'final',
    }, { now: 200, operationIdFactory: () => 'operation-2' });

    enqueueOutboundMessage(queue, first, { now: 100 });
    expect(enqueueOutboundMessage(queue, latest, { now: 200 })).toMatchObject({
      accepted: true,
      coalesced: 1,
    });
    expect(queue).toHaveLength(1);
    expect(JSON.parse(queue[0].payload)).toMatchObject({
      content: 'final',
      clientOperationId: 'operation-2',
    });
  });

  it('keeps mutating messages and rejects overflow rather than dropping them silently', () => {
    const queue: OutboundQueueEntry[] = [];
    const first = createOutboundQueueEntry(
      { type: 'claude-command', command: 'first' },
      { now: 100, operationIdFactory: () => 'operation-1' },
    );
    const second = createOutboundQueueEntry(
      { type: 'codex-command', command: 'second' },
      { now: 200, operationIdFactory: () => 'operation-2' },
    );

    expect(enqueueOutboundMessage(queue, first, { now: 100, maxEntries: 1 }).accepted).toBe(true);
    expect(enqueueOutboundMessage(queue, second, { now: 200, maxEntries: 1 }).accepted).toBe(false);
    expect(JSON.parse(queue[0].payload).clientOperationId).toBe('operation-1');
  });
});
