import { describe, expect, it, vi } from 'vitest';

import { createAgentTurnCoordinator } from '../agent-runtime/turn-coordinator.js';

function createRuntime(id = 'test-runtime', overrides = {}) {
  return {
    id,
    capabilities: {
      provider: id,
      sessionResume: true,
      steering: true,
      turnQueue: true,
    },
    start: vi.fn(async () => 'started'),
    resume: vi.fn(async () => 'resumed'),
    abort: vi.fn(async () => true),
    isActive: vi.fn(() => false),
    getActiveSessions: vi.fn(() => []),
    getStartTime: vi.fn(() => null),
    native: {},
    ...overrides,
  };
}

function identity(overrides = {}) {
  return {
    ownerKey: 'owner-a',
    projectKey: 'project-a',
    runtimeId: 'test-runtime',
    sessionId: 'session-a',
    ...overrides,
  };
}

describe('generic agent turn coordinator', () => {
  it('coordinates validation, immutable snapshots, observations, identity promotion, and cleanup', async () => {
    const events = [];
    const writer = { send: vi.fn() };
    const runtime = createRuntime('test-runtime', {
      start: vi.fn(async (_command, options, runtimeWriter) => {
        expect(Object.isFrozen(options.turnSnapshot)).toBe(true);
        expect(Object.isFrozen(options.turnSnapshot.identity)).toBe(true);
        expect(JSON.stringify(options.turnSnapshot)).not.toContain('top-secret');
        options.onLifecycleEvent({ phase: 'turn_started', sessionId: 'resolved-session' });
        runtimeWriter.send({
          type: 'claude-response',
          data: {
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
          },
        });
        return 'runtime-result';
      }),
    });
    const coordinator = createAgentTurnCoordinator({
      getRuntime: (runtimeId) => {
        expect(runtimeId).toBe(runtime.id);
        return runtime;
      },
      createTurnId: () => 'turn-a',
      now: () => 1_000,
    });

    await expect(coordinator.execute({
      identity: identity(),
      runtimeId: runtime.id,
      command: 'original',
      options: {
        env: { API_KEY: 'top-secret' },
        projectPath: '/workspace/project-a',
        model: 'model-a',
      },
      modelSelection: {
        modelProviderId: 'provider-a',
        modelId: 'model-a',
        catalogRevision: 7,
      },
    }, writer, {
      authorize: async () => {
        events.push('authorize');
        return { allowed: true };
      },
      validate: () => events.push('validate'),
      createWriter: () => {
        events.push('create-writer');
        return writer;
      },
      beginQueue: () => events.push('begin-queue'),
      prepare: () => {
        events.push('prepare');
        return { command: 'prepared' };
      },
      onIdentityResolved: (resolvedIdentity) => {
        events.push(`identity:${resolvedIdentity.sessionId}`);
      },
      persistSession: (resolvedIdentity) => {
        events.push(`persist:${resolvedIdentity.sessionId}`);
      },
      onObservations: (observations) => {
        events.push(`observation:${observations[0].type}`);
      },
      completeQueue: () => events.push('complete-queue'),
      settleReconnect: () => events.push('settle-reconnect'),
      finalize: ({ outcome, identity: resolvedIdentity }) => {
        events.push(`finalize:${outcome}:${resolvedIdentity.sessionId}`);
      },
    })).resolves.toBe('runtime-result');

    expect(runtime.start).toHaveBeenCalledWith(
      'prepared',
      expect.objectContaining({
        turnId: 'turn-a',
        sessionKey: expect.any(String),
        identity: identity(),
      }),
      expect.any(Object),
    );
    expect(writer.send).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      'authorize',
      'validate',
      'create-writer',
      'begin-queue',
      'prepare',
      'identity:resolved-session',
      'persist:resolved-session',
      'observation:assistant_text',
      'complete-queue',
      'settle-reconnect',
      'finalize:completed:resolved-session',
    ]);
    expect(coordinator.list()).toEqual([]);
  });

  it('uses resume for persisted sessions and enforces the declared capability', async () => {
    const runtime = createRuntime();
    const coordinator = createAgentTurnCoordinator({ getRuntime: () => runtime });

    await expect(coordinator.execute({
      identity: identity(),
      runtimeId: runtime.id,
      command: 'continue',
      options: { sessionId: 'session-a' },
    })).resolves.toBe('resumed');
    expect(runtime.resume).toHaveBeenCalledOnce();

    const noResumeRuntime = createRuntime('no-resume', {
      capabilities: { provider: 'no-resume' },
      resume: undefined,
    });
    const unsupported = createAgentTurnCoordinator({ getRuntime: () => noResumeRuntime });
    await expect(unsupported.execute({
      identity: identity({ runtimeId: 'no-resume' }),
      runtimeId: 'no-resume',
      command: 'continue',
      options: { sessionId: 'session-a' },
    })).rejects.toMatchObject({
      code: 'AGENT_RUNTIME_CAPABILITY_UNSUPPORTED',
      runtimeId: 'no-resume',
    });
  });

  it('locks exact composite identities without conflating matching external ids in other projects', async () => {
    const pending = [];
    const runtime = createRuntime('test-runtime', {
      start: vi.fn(() => new Promise((resolve) => pending.push(resolve))),
    });
    const coordinator = createAgentTurnCoordinator({ getRuntime: () => runtime });
    const firstIdentity = identity({ projectKey: 'project-a', sessionId: 'shared-id' });
    const secondIdentity = identity({ projectKey: 'project-b', sessionId: 'shared-id' });

    const first = coordinator.execute({
      identity: firstIdentity,
      runtimeId: runtime.id,
      command: 'first',
    });
    const second = coordinator.execute({
      identity: secondIdentity,
      runtimeId: runtime.id,
      command: 'second',
    });
    await vi.waitFor(() => expect(coordinator.list()).toHaveLength(2));

    await expect(coordinator.execute({
      identity: firstIdentity,
      runtimeId: runtime.id,
      command: 'duplicate',
    })).rejects.toMatchObject({ code: 'AGENT_TURN_ALREADY_ACTIVE' });

    pending.forEach((resolve) => resolve('done'));
    await expect(Promise.all([first, second])).resolves.toEqual(['done', 'done']);
  });

  it('does not fall back when runtime resolution fails and always runs cleanup after errors', async () => {
    const cleanup = [];
    const missing = createAgentTurnCoordinator({
      getRuntime: (runtimeId) => {
        const error = new Error(`Missing ${runtimeId}`);
        error.code = 'AGENT_RUNTIME_NOT_FOUND';
        error.runtimeId = runtimeId;
        throw error;
      },
    });
    await expect(missing.execute({
      identity: identity({ runtimeId: 'missing-runtime' }),
      runtimeId: 'missing-runtime',
      command: 'run',
    })).rejects.toMatchObject({ code: 'AGENT_RUNTIME_NOT_FOUND', runtimeId: 'missing-runtime' });

    const runtime = createRuntime('test-runtime', {
      start: vi.fn(async () => {
        throw new Error('runtime failed');
      }),
    });
    const failing = createAgentTurnCoordinator({ getRuntime: () => runtime });
    await expect(failing.execute({
      identity: identity(),
      runtimeId: runtime.id,
      command: 'run',
    }, null, {
      completeQueue: ({ outcome }) => cleanup.push(`queue:${outcome}`),
      settleReconnect: ({ outcome }) => cleanup.push(`reconnect:${outcome}`),
      finalize: ({ outcome }) => cleanup.push(`finalize:${outcome}`),
    })).rejects.toThrow('runtime failed');
    expect(cleanup).toEqual(['queue:error', 'reconnect:error', 'finalize:error']);
    expect(failing.list()).toEqual([]);
  });
});

