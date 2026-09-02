import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
  abortCodex: vi.fn(),
  compactCodex: vi.fn(),
  getActiveCodex: vi.fn(),
  getCodexStartTime: vi.fn(),
  isCodexActive: vi.fn(),
  isCodexPlaceholder: vi.fn(),
  queryCodex: vi.fn(),
  shutdownCodex: vi.fn(),
  steerCodex: vi.fn(),
}));

vi.mock('../openai-codex.js', () => ({
  abortCodexSession: runtimeMocks.abortCodex,
  compactCodexSession: runtimeMocks.compactCodex,
  getActiveCodexSessions: runtimeMocks.getActiveCodex,
  getCodexSessionStartTime: runtimeMocks.getCodexStartTime,
  isCodexPlaceholderSessionId: runtimeMocks.isCodexPlaceholder,
  isCodexSessionActive: runtimeMocks.isCodexActive,
  queryCodex: runtimeMocks.queryCodex,
  shutdownCodexRuntime: runtimeMocks.shutdownCodex,
  steerCodexSession: runtimeMocks.steerCodex,
}));

import {
  codexRuntime,
  piRuntime,
  getAgentRuntime,
  getRequiredAgentRuntime,
  hasAgentRuntime,
  listAgentRuntimes,
  registerAgentRuntime,
} from '../agent-runtime/index.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('agent runtime registry', () => {
  it('registers only Pi and returns null for removed or unknown providers', () => {
    expect(getAgentRuntime('pi')).toBe(piRuntime);
    expect(getAgentRuntime('claude')).toBeNull();
    expect(getAgentRuntime('codex')).toBeNull();
    expect(hasAgentRuntime('pi')).toBe(true);
    expect(hasAgentRuntime('claude')).toBe(false);
    expect(hasAgentRuntime('codex')).toBe(false);
    expect(listAgentRuntimes()).toEqual(['pi']);
    expect(getAgentRuntime('unknown')).toBeNull();
  });

  it('allows a provider runtime to be registered without provider-specific logic', () => {
    const runtime = {
      id: 'test-runtime',
      capabilities: { provider: 'test-runtime' },
      start() {},
      abort() {},
      isActive() { return false; },
      getActiveSessions() { return []; },
      getStartTime() { return null; },
      native: {},
    };

    registerAgentRuntime(runtime.id, runtime);

    expect(getAgentRuntime(runtime.id)).toBe(runtime);
    expect(hasAgentRuntime(runtime.id)).toBe(true);
    expect(listAgentRuntimes()).toContain(runtime.id);
  });

  it('keeps the original runtime when duplicate registration is attempted', () => {
    const replacement = { ...piRuntime };

    expect(() => registerAgentRuntime('pi', replacement)).toThrowError(
      expect.objectContaining({ code: 'AGENT_RUNTIME_ALREADY_REGISTERED' }),
    );
    expect(getAgentRuntime('pi')).toBe(piRuntime);
  });

  it('requires registered runtimes when execution has already validated the provider', () => {
    expect(getRequiredAgentRuntime('pi')).toBe(piRuntime);
    expect(() => getRequiredAgentRuntime('claude')).toThrowError(
      expect.objectContaining({ code: 'AGENT_RUNTIME_NOT_FOUND' }),
    );
    expect(() => getRequiredAgentRuntime('missing-runtime')).toThrowError(
      expect.objectContaining({ code: 'AGENT_RUNTIME_NOT_FOUND' }),
    );
    expect(() => getRequiredAgentRuntime('pi', { capability: 'persistentAppServer' })).toThrowError(
      expect.objectContaining({ code: 'AGENT_RUNTIME_CAPABILITY_UNSUPPORTED' }),
    );
  });
});

describe('Codex runtime adapter', () => {
  it('delegates lifecycle calls without changing synchronous abort behavior', async () => {
    const writer = { send: vi.fn() };
    const options = { sessionId: 'codex-session' };
    runtimeMocks.queryCodex.mockResolvedValue('query-result');
    runtimeMocks.steerCodex.mockResolvedValue({ success: true });
    runtimeMocks.abortCodex.mockReturnValue(true);
    runtimeMocks.isCodexActive.mockReturnValue(true);
    runtimeMocks.getActiveCodex.mockReturnValue(['codex-session']);
    runtimeMocks.getCodexStartTime.mockReturnValue(456);

    await expect(codexRuntime.start('start', options, writer)).resolves.toBe('query-result');
    await expect(codexRuntime.resume('resume', options, writer)).resolves.toBe('query-result');
    await expect(codexRuntime.steer('codex-session', 'adjust')).resolves.toEqual({ success: true });
    expect(codexRuntime.abort('codex-session')).toBe(true);
    expect(codexRuntime.isActive('codex-session')).toBe(true);
    expect(codexRuntime.getActiveSessions()).toEqual(['codex-session']);
    expect(codexRuntime.getStartTime('codex-session')).toBe(456);

    expect(runtimeMocks.queryCodex).toHaveBeenNthCalledWith(1, 'start', options, writer);
    expect(runtimeMocks.queryCodex).toHaveBeenNthCalledWith(2, 'resume', options, writer);
    expect(runtimeMocks.steerCodex).toHaveBeenCalledWith('codex-session', 'adjust');
    expect(runtimeMocks.abortCodex).toHaveBeenCalledWith('codex-session');
  });

  it('keeps Codex capabilities and native extensions provider-specific', () => {
    expect(codexRuntime.capabilities).toMatchObject({
      provider: 'codex',
      thinking: false,
      interactiveToolApproval: false,
      planMode: false,
      nativeContextCompaction: true,
      persistentAppServer: true,
    });
    expect(codexRuntime.native).toMatchObject({
      compact: runtimeMocks.compactCodex,
      isPlaceholderSessionId: runtimeMocks.isCodexPlaceholder,
      shutdown: runtimeMocks.shutdownCodex,
    });
  });
});
