import { describe, expect, it, vi } from 'vitest';

import {
  abortAgentRuntimeSession,
  createAgentRuntimeErrorPayload,
  getActiveAgentRuntimeSessions,
  getAgentRuntimeSessionStatus,
  registerAgentRuntime,
  steerAgentRuntimeSession,
} from '../agent-runtime/index.js';

function registerTestRuntime(id) {
  const runtime = {
    id,
    capabilities: { provider: id, steering: true },
    start: vi.fn(),
    steer: vi.fn(async () => ({ success: true })),
    abort: vi.fn(async () => true),
    isActive: vi.fn((sessionId) => sessionId === 'shared-session'),
    getActiveSessions: vi.fn(() => ['shared-session']),
    getStartTime: vi.fn(() => 123),
    native: {},
  };
  registerAgentRuntime(id, runtime);
  return runtime;
}

describe('agent runtime lifecycle coordinator', () => {
  it('dispatches status and abort through the registry', async () => {
    const runtime = registerTestRuntime('lifecycle-test-runtime');

    expect(getAgentRuntimeSessionStatus(runtime.id, 'shared-session')).toEqual({
      runtimeId: runtime.id,
      sessionId: 'shared-session',
      isActive: true,
      startTime: 123,
    });
    await expect(abortAgentRuntimeSession(runtime.id, 'shared-session')).resolves.toBe(true);
    expect(runtime.abort).toHaveBeenCalledWith('shared-session');
    expect(getActiveAgentRuntimeSessions()[runtime.id]).toEqual(['shared-session']);
  });

  it('never falls back to Claude for an unknown runtime', async () => {
    let caught;
    try {
      await abortAgentRuntimeSession('unknown-runtime', 'shared-session');
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: 'AGENT_RUNTIME_NOT_FOUND' });
    expect(createAgentRuntimeErrorPayload(caught, 'unknown-runtime')).toMatchObject({
      type: 'agent-runtime-error',
      code: 'AGENT_RUNTIME_NOT_FOUND',
      runtimeId: 'unknown-runtime',
    });
  });

  it('accepts composite identities for status, steer, and abort dispatch', async () => {
    const runtime = registerTestRuntime('composite-lifecycle-runtime');
    const identity = {
      ownerKey: 'owner-a',
      projectKey: 'project-a',
      runtimeId: runtime.id,
      sessionId: 'shared-session',
    };

    expect(getAgentRuntimeSessionStatus(identity)).toMatchObject({
      runtimeId: runtime.id,
      sessionId: 'shared-session',
      projectKey: 'project-a',
      ownerKey: 'owner-a',
      isActive: true,
    });
    await expect(steerAgentRuntimeSession(identity, 'adjust')).resolves.toEqual({ success: true });
    await expect(abortAgentRuntimeSession(identity)).resolves.toBe(true);
    expect(runtime.steer).toHaveBeenCalledWith('shared-session', 'adjust');
    expect(runtime.abort).toHaveBeenCalledWith('shared-session');
  });
});
