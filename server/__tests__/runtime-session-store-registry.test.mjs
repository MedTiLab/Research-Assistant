import { describe, expect, it, vi } from 'vitest';
import {
  createRuntimeSessionStoreRegistry,
} from '../agent-runtime/session-store-registry.js';
import { ClaudeSessionStore } from '../agent-runtime/session-stores/claude-session-store.js';
import { PiSessionStore } from '../agent-runtime/session-stores/pi-session-store.js';

function createOperations() {
  return {
    list: vi.fn(async () => []),
    read: vi.fn(async () => ({ messages: [] })),
    rename: vi.fn(async () => true),
    trash: vi.fn(async () => true),
    restore: vi.fn(async () => true),
    delete: vi.fn(async () => true),
    getUsage: vi.fn(async () => null),
    reconcile: vi.fn(async () => null),
    watchRoots: vi.fn(() => []),
  };
}

describe('runtime session store registry', () => {
  it('dispatches an explicit runtime identity to the matching store', async () => {
    const operations = createOperations();
    const store = new ClaudeSessionStore(operations);
    const registry = createRuntimeSessionStoreRegistry([store]);
    const identity = {
      ownerKey: 'owner-a',
      projectKey: 'project-a',
      runtimeId: 'claude',
      sessionId: 'session-a',
    };

    await registry.require('claude').read(identity, { limit: 20 });
    expect(operations.read).toHaveBeenCalledWith(identity, { limit: 20 });
  });

  it('does not register Pi implicitly or fall back to Claude', () => {
    const registry = createRuntimeSessionStoreRegistry([
      new ClaudeSessionStore(createOperations()),
    ]);
    expect(() => registry.require('pi')).toThrowError(
      expect.objectContaining({ code: 'RUNTIME_SESSION_STORE_NOT_FOUND' }),
    );
  });

  it('provides the Pi contract without enabling a concrete host store', async () => {
    const operations = createOperations();
    const store = new PiSessionStore(operations);
    await expect(store.read({
      ownerKey: 'owner-a',
      projectKey: 'project-a',
      runtimeId: 'pi',
      sessionId: 'session-a',
    })).resolves.toEqual({ messages: [] });
  });
});
