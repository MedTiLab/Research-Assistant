import { describe, expect, it } from 'vitest';

import { createClientOperationDeduper } from './clientOperationDeduper.js';

describe('clientOperationDeduper', () => {
  it('rejects a repeated mutating operation for the same owner', () => {
    const deduper = createClientOperationDeduper({ now: () => 100 });
    const message = {
      type: 'agent-command',
      runtimeId: 'claude',
      clientOperationId: 'operation-1',
    };

    expect(deduper.accept('owner-1', message)).toMatchObject({ accepted: true, tracked: true });
    expect(deduper.accept('owner-1', message)).toMatchObject({ accepted: false, tracked: true });
    expect(deduper.accept('owner-2', message)).toMatchObject({ accepted: true, tracked: true });
  });

  it('allows the operation again after its replay-protection window', () => {
    let now = 100;
    const deduper = createClientOperationDeduper({ ttlMs: 50, now: () => now });
    const message = { type: 'abort-session', clientOperationId: 'operation-2' };

    expect(deduper.accept('owner-1', message).accepted).toBe(true);
    now = 151;
    expect(deduper.accept('owner-1', message).accepted).toBe(true);
  });

  it('does not alter compatibility for messages without an operation id', () => {
    const deduper = createClientOperationDeduper();
    expect(deduper.accept('owner-1', { type: 'claude-command' })).toEqual({
      accepted: true,
      tracked: false,
      operationId: null,
    });
  });
});
