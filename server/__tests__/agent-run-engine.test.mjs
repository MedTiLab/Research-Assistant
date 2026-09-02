import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentRunEngine } from '../agent-runtime/run-engine.js';
import { createAgentRunStore } from '../agent-runtime/run-store.js';

const resources = [];

afterEach(async () => {
  for (const resource of resources.splice(0)) {
    await resource.engine?.stop({ drainMs: 500 });
    resource.database.close();
  }
});

function fixture(execute, options = {}) {
  const database = new Database(':memory:');
  const store = createAgentRunStore(database);
  const engine = createAgentRunEngine({
    store,
    execute,
    workers: options.workers || 3,
    leaseMs: 2_000,
    heartbeatMs: 50,
    reaperMs: 100,
    pollMs: 5,
  });
  resources.push({ database, engine });
  return { database, store, engine };
}

function request(sessionId) {
  return {
    identity: {
      ownerKey: 'owner-a',
      projectKey: 'project-a',
      runtimeId: 'pi',
      sessionId,
    },
    runtimeId: 'pi',
    command: `work ${sessionId}`,
  };
}

describe('agent run engine', () => {
  it('limits concurrent turns to the configured three workers', async () => {
    let active = 0;
    let peak = 0;
    const releases = [];
    const execute = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => releases.push(resolve));
      active -= 1;
      return { ok: true };
    });
    const { engine } = fixture(execute, { workers: 3 });

    const promises = ['a', 'b', 'c', 'd'].map((id) => engine.submit(request(id)));
    await vi.waitFor(() => expect(active).toBe(3));
    expect(peak).toBe(3);
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(4));
    releases.splice(0).forEach((release) => release());
    await expect(Promise.all(promises)).resolves.toHaveLength(4);
    expect(peak).toBe(3);
  });

  it('retries an explicitly retryable provider failure and preserves one caller promise', async () => {
    let attempts = 0;
    const execute = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('temporary provider outage');
        error.isRetryable = true;
        throw error;
      }
      return 'done';
    });
    const { engine, store } = fixture(execute, { workers: 1 });

    const promise = engine.submit(request('retry'));
    await expect(promise).resolves.toBe('done');
    expect(execute).toHaveBeenCalledTimes(2);
    expect(store.get(promise.runId)).toMatchObject({ status: 'completed', attempts: 2 });
  });

  it('parks a persisted run when its private execution context is unavailable', async () => {
    const { engine, store } = fixture(vi.fn(), { workers: 1 });
    const orphan = store.create({
      ownerKey: 'owner-a',
      projectKey: 'project-a',
      runtimeId: 'claude',
      sessionKey: 'orphan',
      sessionId: 'orphan',
      commandPreview: 'private work',
      request: { command: 'redacted' },
      recoveryPolicy: 'park',
    });

    engine.start();
    await vi.waitFor(() => expect(store.get(orphan.id).status).toBe('parked'));
    expect(store.get(orphan.id).errorCode).toBe('AGENT_RUN_PAYLOAD_UNAVAILABLE');
  });

  it('rejects a second queued turn for the same composite session', async () => {
    let release;
    const { engine } = fixture(() => new Promise((resolve) => { release = resolve; }), { workers: 1 });
    const first = engine.submit(request('same'));
    await expect(engine.submit(request('same'))).rejects.toMatchObject({
      code: 'AGENT_TURN_ALREADY_ACTIVE',
    });
    await vi.waitFor(() => expect(typeof release).toBe('function'));
    release('done');
    await expect(first).resolves.toBe('done');
  });

  it('can restart cleanly after all workers have drained', async () => {
    const execute = vi.fn(async () => 'done');
    const { engine } = fixture(execute, { workers: 1 });
    engine.start();
    await engine.submit(request('before-restart'));
    await engine.stop({ drainMs: 500 });

    expect(engine.status()).toMatchObject({ started: false, stopping: false });

    engine.start();
    await engine.submit(request('after-restart'));
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('stops accepting and claiming queued work while active work drains', async () => {
    let release;
    const execute = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const { engine, store } = fixture(execute, { workers: 1 });
    const active = engine.submit(request('active'));
    const queued = engine.submit(request('queued'));
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));

    expect(engine.beginDrain()).toMatchObject({ accepting: false, stopping: true });
    await expect(engine.submit(request('rejected'))).rejects.toMatchObject({
      code: 'AGENT_RUN_ENGINE_STOPPING',
    });
    release('done');
    await expect(active).resolves.toBe('done');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.get(queued.runId).status).toBe('queued');

    await engine.stop({ drainMs: 500 });
    await expect(queued).rejects.toMatchObject({ code: 'AGENT_RUN_ENGINE_STOPPED' });
  });
});
