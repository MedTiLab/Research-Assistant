import { describe, expect, it } from 'vitest';

import {
  assertAgentRuntime,
  codexRuntime,
  piRuntime,
  registerAgentRuntime,
} from '../agent-runtime/index.js';

function createRuntime(overrides = {}) {
  const {
    capabilities: capabilityOverrides = {},
    ...runtimeOverrides
  } = overrides;
  const id = runtimeOverrides.id || 'contract-test';
  return {
    id,
    capabilities: { provider: id, ...capabilityOverrides },
    start() {},
    abort() { return true; },
    isActive() { return false; },
    getActiveSessions() { return []; },
    getStartTime() { return null; },
    native: {},
    ...runtimeOverrides,
  };
}

describe('agent runtime contract', () => {
  it('accepts the built-in Codex and Pi runtimes', () => {
    expect(assertAgentRuntime(codexRuntime)).toBe(codexRuntime);
    expect(assertAgentRuntime(piRuntime)).toBe(piRuntime);
  });

  it.each(['start', 'abort', 'isActive', 'getActiveSessions', 'getStartTime'])(
    'rejects a runtime without %s()',
    (methodName) => {
      expect(() => assertAgentRuntime(createRuntime({ [methodName]: undefined }))).toThrow(
        `must implement ${methodName}()`,
      );
    },
  );

  it('enforces methods declared by conditional capabilities', () => {
    expect(() => assertAgentRuntime(createRuntime({
      capabilities: { steering: true },
    }))).toThrow('declares steering but does not implement steer()');
    expect(() => assertAgentRuntime(createRuntime({
      capabilities: { sessionResume: true },
    }))).toThrow('declares sessionResume but does not implement resume()');
  });

  it('requires capabilities.provider to match the runtime id', () => {
    expect(() => assertAgentRuntime(createRuntime({
      capabilities: { provider: 'another-provider' },
    }))).toThrow('capabilities.provider must match the runtime id');
  });

  it('does not constrain synchronous and asynchronous abort return semantics', async () => {
    const syncRuntime = createRuntime({ id: 'sync-contract-runtime', abort: () => true });
    const asyncRuntime = createRuntime({ id: 'async-contract-runtime', abort: async () => true });

    registerAgentRuntime(syncRuntime.id, syncRuntime);
    registerAgentRuntime(asyncRuntime.id, asyncRuntime);

    expect(syncRuntime.abort()).toBe(true);
    await expect(asyncRuntime.abort()).resolves.toBe(true);
  });

  it('rejects registration names that do not match the runtime id', () => {
    expect(() => registerAgentRuntime('different-name', createRuntime())).toThrowError(
      expect.objectContaining({ code: 'AGENT_RUNTIME_ID_MISMATCH' }),
    );
  });

  it('does not silently replace an existing runtime registration', () => {
    const runtime = createRuntime({ id: 'duplicate-contract-runtime' });
    registerAgentRuntime(runtime.id, runtime);

    expect(() => registerAgentRuntime(runtime.id, createRuntime({ id: runtime.id }))).toThrowError(
      expect.objectContaining({ code: 'AGENT_RUNTIME_ALREADY_REGISTERED' }),
    );
  });
});
