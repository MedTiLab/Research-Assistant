import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { createAgentRunStore } from '../agent-runtime/run-store.js';

const databases = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function fixture() {
  let current = 1_000;
  const database = new Database(':memory:');
  databases.push(database);
  return {
    database,
    store: createAgentRunStore(database, { now: () => current }),
    advance: (ms) => { current += ms; },
  };
}

function createRun(store, overrides = {}) {
  return store.create({
    ownerKey: 'owner-a',
    projectKey: 'project-a',
    runtimeId: 'pi',
    sessionKey: 'owner-a\0project-a\0pi\0session-a',
    sessionId: 'session-a',
    commandPreview: 'do work',
    request: { command: 'do work' },
    maxAttempts: 3,
    ...overrides,
  });
}

describe('agent run store', () => {
  it('atomically claims, heartbeats, and completes a durable run', () => {
    const { store, advance } = fixture();
    const created = createRun(store);
    const claimed = store.claim('worker-1', 2_000);

    expect(claimed).toMatchObject({
      id: created.id,
      status: 'running',
      workerId: 'worker-1',
      attempts: 1,
    });
    expect(store.claim('worker-2', 2_000)).toBeNull();

    advance(500);
    expect(store.heartbeat(created.id, claimed.leaseToken, 2_000)).toBe(true);
    expect(store.complete(created.id, claimed.leaseToken, { reply: 'done' })).toBe(true);
    expect(store.get(created.id)).toMatchObject({
      status: 'completed',
      result: { reply: 'done' },
      leaseToken: null,
    });
  });

  it('requeues retryable failures until max attempts and then fails', () => {
    const { store } = fixture();
    const created = createRun(store, { maxAttempts: 2 });

    const first = store.claim('worker-1', 2_000);
    expect(store.fail(created.id, first.leaseToken, { code: 'TEMP', message: 'temporary' }, { retry: true }))
      .toMatchObject({ requeued: true });

    const second = store.claim('worker-2', 2_000);
    expect(second.attempts).toBe(2);
    expect(store.fail(created.id, second.leaseToken, { code: 'TEMP', message: 'again' }, { retry: true }))
      .toMatchObject({ requeued: false });
    expect(store.get(created.id)).toMatchObject({
      status: 'failed',
      errorCode: 'TEMP',
      attempts: 2,
    });
  });

  it('requeues only explicitly recoverable expired leases and parks private interactive runs', () => {
    const { store, advance } = fixture();
    const retry = createRun(store, {
      sessionKey: 'retry',
      sessionId: 'retry',
      recoveryPolicy: 'retry',
    });
    const park = createRun(store, {
      sessionKey: 'park',
      sessionId: 'park',
      recoveryPolicy: 'park',
    });
    store.claim('worker-1', 1_000);
    store.claim('worker-2', 1_000);
    advance(1_001);

    expect(store.reapExpired()).toEqual({ scanned: 2, requeued: 1, parked: 1 });
    expect(store.get(retry.id).status).toBe('queued');
    expect(store.get(park.id).status).toBe('parked');
  });

  it('scopes listings and cancellation by owner', () => {
    const { store } = fixture();
    const mine = createRun(store);
    createRun(store, {
      ownerKey: 'owner-b',
      sessionKey: 'owner-b-session',
      sessionId: 'owner-b-session',
    });

    expect(store.list({ ownerKey: 'owner-a' })).toHaveLength(1);
    expect(store.cancel(mine.id, 'owner-b')).toBe(false);
    expect(store.cancel(mine.id, 'owner-a')).toBe(true);
    expect(store.get(mine.id).status).toBe('cancelled');
  });
});

