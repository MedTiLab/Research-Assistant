import { describe, expect, it, vi } from 'vitest';

import '../agent-runtime/index.js';
import { AgentTurnQueueRegistry } from '../utils/agentTurnQueue.js';

function createHarness() {
  const messages = [];
  const dispatched = [];
  const writer = { send: (message) => messages.push(message) };
  const dispatch = vi.fn((payloadValue) => dispatched.push(payloadValue));
  return { messages, dispatched, writer, dispatch };
}

const payload = (sessionId = 'session-1') => ({
  type: 'agent-command',
  runtimeId: 'pi',
  projectKey: 'project-1',
  command: 'original',
  sessionId,
  options: {
    projectKey: 'project-1',
    sessionId,
    clientSessionId: sessionId,
    resume: true,
  },
});

describe('AgentTurnQueueRegistry behavior', () => {
  it('serializes queued turns and resumes the resolved provider session', async () => {
    const registry = new AgentTurnQueueRegistry();
    const harness = createHarness();
    const state = registry.begin({
      ownerKey: 'owner', runtimeId: 'pi', projectKey: 'project-1', payload: payload(), ...harness,
    });

    registry.enqueue({
      ownerKey: 'owner',
      runtimeId: 'pi',
      projectKey: 'project-1',
      sessionId: 'session-1',
      item: { id: 'q1', content: 'follow up', payload: payload(), createdAt: 1 },
      ...harness,
    });
    expect(harness.dispatched).toHaveLength(0);

    registry.complete(state, 'session-1');
    await Promise.resolve();

    expect(harness.dispatched).toHaveLength(1);
    expect(harness.dispatched[0]).toMatchObject({
      queueReplay: true,
      runtimeId: 'pi',
      projectKey: 'project-1',
      sessionId: 'session-1',
      command: 'original',
      options: { sessionId: 'session-1', resume: true },
    });
    expect(harness.messages.some((message) => message.type === 'agent-turn-queue-started')).toBe(true);
  });

  it('migrates a temporary session queue and applies edits before dispatch', async () => {
    const registry = new AgentTurnQueueRegistry();
    const harness = createHarness();
    const temporaryPayload = payload(null);
    temporaryPayload.clientSessionId = 'new-session-1';
    temporaryPayload.options = {
      projectKey: 'project-1',
      clientSessionId: 'new-session-1',
      resume: false,
    };
    const state = registry.begin({
      ownerKey: 'owner', runtimeId: 'pi', projectKey: 'project-1', payload: temporaryPayload, ...harness,
    });
    registry.enqueue({
      ownerKey: 'owner',
      runtimeId: 'pi',
      projectKey: 'project-1',
      sessionId: 'new-session-1',
      item: {
        id: 'q1',
        content: 'draft',
        commandPrefix: 'prefix:',
        commandSuffix: ':suffix',
        payload: { ...temporaryPayload, command: 'prefix:draft:suffix' },
      },
      ...harness,
    });

    expect(registry.update({
      ownerKey: 'owner', runtimeId: 'pi', projectKey: 'project-1', sessionId: 'new-session-1', itemId: 'q1', content: 'edited',
    })).toBe(true);
    registry.resolveSession(state, 'real-session');
    registry.complete(state, 'real-session');
    await Promise.resolve();

    expect(harness.dispatched[0]).toMatchObject({
      sessionId: 'real-session',
      command: 'prefix:edited:suffix',
      visibleUserContent: 'edited',
      options: { sessionId: 'real-session', resume: true },
    });
  });

  it('supports reordering, removing, and clearing queued turns', () => {
    const registry = new AgentTurnQueueRegistry();
    const harness = createHarness();
    registry.begin({
      ownerKey: 'owner', runtimeId: 'pi', projectKey: 'project-1', payload: payload(), ...harness,
    });
    for (const id of ['a', 'b', 'c']) {
      registry.enqueue({
        ownerKey: 'owner', runtimeId: 'pi', projectKey: 'project-1', sessionId: 'session-1',
        item: { id, content: id, payload: payload() }, ...harness,
      });
    }
    registry.reorder({
      ownerKey: 'owner', runtimeId: 'pi', projectKey: 'project-1', sessionId: 'session-1', itemIds: ['c', 'a', 'b'],
    });
    expect(registry.snapshot({
      ownerKey: 'owner', runtimeId: 'pi', projectKey: 'project-1', sessionId: 'session-1', writer: harness.writer,
    }).map((item) => item.id)).toEqual(['c', 'a', 'b']);
    expect(registry.remove({
      ownerKey: 'owner', runtimeId: 'pi', projectKey: 'project-1', sessionId: 'session-1', itemId: 'a',
    })).toBe(true);
    registry.clear({
      ownerKey: 'owner', runtimeId: 'pi', projectKey: 'project-1', sessionId: 'session-1',
    });
    expect(registry.snapshot({
      ownerKey: 'owner', runtimeId: 'pi', projectKey: 'project-1', sessionId: 'session-1', writer: harness.writer,
    })).toEqual([]);
  });
});

describe('agent turn queue composite identity', () => {
  it('isolates identical external ids by owner and project', () => {
    const queues = new AgentTurnQueueRegistry();
    const writer = { send: vi.fn() };
    const ownerA = queues.begin({
      ownerKey: 'owner',
      runtimeId: 'pi',
      projectKey: 'project-a',
      payload: { sessionId: 'shared', projectKey: 'project-a' },
      writer,
    });
    const ownerB = queues.begin({
      ownerKey: 'other-owner',
      runtimeId: 'pi',
      projectKey: 'project-a',
      payload: { sessionId: 'shared', projectKey: 'project-a' },
      writer,
    });
    const projectB = queues.begin({
      ownerKey: 'owner',
      runtimeId: 'pi',
      projectKey: 'project-b',
      payload: { sessionId: 'shared', projectKey: 'project-b' },
      writer,
    });

    expect(ownerA).not.toBe(ownerB);
    expect(ownerA).not.toBe(projectB);
    expect(queues.find('owner', 'pi', 'shared', 'project-a')).toBe(ownerA);
    expect(queues.find('other-owner', 'pi', 'shared', 'project-a')).toBe(ownerB);
    expect(queues.find('owner', 'pi', 'shared')).toBeNull();
  });

  it('uses runtime capabilities and rejects an unknown runtime', () => {
    const queues = new AgentTurnQueueRegistry();
    expect(() => queues.begin({
      ownerKey: 'owner',
      runtimeId: 'unknown-runtime',
      projectKey: 'project',
      payload: { sessionId: 'session', projectKey: 'project' },
    })).toThrowError(expect.objectContaining({ code: 'AGENT_RUNTIME_NOT_FOUND' }));
  });
});
