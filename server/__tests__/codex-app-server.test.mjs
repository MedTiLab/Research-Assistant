import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CodexAppServerClient,
  getCodexAppServerClient,
  shutdownCodexAppServers,
} from '../codex-app-server.js';

const clients = [];

function createHarness(onRequest) {
  const requests = [];
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    child.exitCode = 0;
    queueMicrotask(() => child.emit('exit', 0, null));
    return true;
  });

  const send = (message) => {
    child.stdout.write(`${JSON.stringify(message)}\n`);
  };

  let buffered = '';
  child.stdin.on('data', (chunk) => {
    buffered += String(chunk);
    while (buffered.includes('\n')) {
      const newlineIndex = buffered.indexOf('\n');
      const line = buffered.slice(0, newlineIndex);
      buffered = buffered.slice(newlineIndex + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      requests.push(message);
      onRequest?.(message, send);
    }
  });

  const spawnImpl = vi.fn(() => child);
  return { child, requests, send, spawnImpl };
}

function respondToInitialize(message, send) {
  if (message.method === 'initialize' && Object.hasOwn(message, 'id')) {
    send({ id: message.id, result: { userAgent: 'codex-test/0.146.0' } });
    return true;
  }
  return false;
}

async function collect(stream) {
  const values = [];
  for await (const value of stream) values.push(value);
  return values;
}

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  await shutdownCodexAppServers();
});

describe('getCodexAppServerClient', () => {
  it('reuses the same app-server when only the minute-scale verification timestamp changes', async () => {
    const harness = createHarness((message, send) => {
      respondToInitialize(message, send);
    });
    const clientOptions = {
      executablePath: '/fake/codex',
      spawnImpl: harness.spawnImpl,
      requestTimeoutMs: 1_000,
    };
    const first = await getCodexAppServerClient({
      userId: 'mac-reuse-user',
      env: {
        CODEX_ACCESS_TOKEN: 'stable-token',
        MEDHELP_DATABASE_API_CONNECTION_STATUS: 'connected',
        MEDHELP_DATABASE_API_CONNECTION_VERIFIED_AT: '2026-08-02T00:00:00.000Z',
      },
      clientOptions,
    });
    const second = await getCodexAppServerClient({
      userId: 'mac-reuse-user',
      env: {
        CODEX_ACCESS_TOKEN: 'stable-token',
        MEDHELP_DATABASE_API_CONNECTION_STATUS: 'connected',
        MEDHELP_DATABASE_API_CONNECTION_VERIFIED_AT: '2026-08-02T00:01:01.000Z',
      },
      clientOptions,
    });

    expect(second).toBe(first);
    expect(harness.spawnImpl).toHaveBeenCalledTimes(1);
  });

  it('restarts the app-server when a credential that affects Codex changes', async () => {
    const harnesses = [];
    const spawnImpl = vi.fn(() => {
      const harness = createHarness((message, send) => {
        respondToInitialize(message, send);
      });
      harnesses.push(harness);
      return harness.child;
    });
    const clientOptions = {
      executablePath: '/fake/codex',
      spawnImpl,
      requestTimeoutMs: 1_000,
    };
    const first = await getCodexAppServerClient({
      userId: 'credential-change-user',
      env: { CODEX_ACCESS_TOKEN: 'first-token' },
      clientOptions,
    });
    const second = await getCodexAppServerClient({
      userId: 'credential-change-user',
      env: { CODEX_ACCESS_TOKEN: 'second-token' },
      clientOptions,
    });

    expect(second).not.toBe(first);
    expect(spawnImpl).toHaveBeenCalledTimes(2);
    expect(harnesses[0].child.kill).toHaveBeenCalledTimes(1);
  });

  it('shares one app-server across Local Kernel windows and background requests', async () => {
    const harness = createHarness((message, send) => {
      respondToInitialize(message, send);
    });
    const clientOptions = {
      executablePath: '/fake/codex',
      spawnImpl: harness.spawnImpl,
      requestTimeoutMs: 1_000,
    };
    const env = {
      MEDHELP_LOCAL_KERNEL: '1',
      CODEX_ACCESS_TOKEN: 'stable-token',
    };

    const anonymousBackgroundClient = await getCodexAppServerClient({
      env,
      clientOptions,
    });
    const authenticatedWindowClient = await getCodexAppServerClient({
      userId: 'desktop-user',
      env,
      clientOptions,
    });
    const secondWindowClient = await getCodexAppServerClient({
      userId: 'desktop-user',
      env,
      clientOptions,
    });

    expect(authenticatedWindowClient).toBe(anonymousBackgroundClient);
    expect(secondWindowClient).toBe(anonymousBackgroundClient);
    expect(harness.spawnImpl).toHaveBeenCalledTimes(1);
  });

  it('does not let background work replace the interactive Local Kernel app-server', async () => {
    const spawnImpl = vi.fn(() => {
      const harness = createHarness((message, send) => {
        respondToInitialize(message, send);
      });
      return harness.child;
    });
    const clientOptions = {
      executablePath: '/fake/codex',
      spawnImpl,
      requestTimeoutMs: 1_000,
    };
    const baseEnv = { MEDHELP_LOCAL_KERNEL: '1' };

    const interactive = await getCodexAppServerClient({
      userId: 'desktop-user',
      env: { ...baseEnv, CODEX_ACCESS_TOKEN: 'interactive-token' },
      clientOptions,
    });
    const extraction = await getCodexAppServerClient({
      userId: 'desktop-user',
      env: { ...baseEnv, CODEX_ACCESS_TOKEN: 'background-token' },
      reuseExistingOnEnvMismatch: true,
      clientOptions,
    });
    const interactiveAgain = await getCodexAppServerClient({
      userId: 'desktop-user',
      env: { ...baseEnv, CODEX_ACCESS_TOKEN: 'interactive-token' },
      clientOptions,
    });

    expect(extraction).toBe(interactive);
    expect(interactiveAgain).toBe(interactive);
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(interactive.process.kill).not.toHaveBeenCalled();
  });

  it('serializes concurrent Local Kernel replacements without orphaning a process', async () => {
    const harnesses = [];
    const spawnImpl = vi.fn(() => {
      const harness = createHarness((message, send) => {
        respondToInitialize(message, send);
      });
      harnesses.push(harness);
      return harness.child;
    });
    const clientOptions = {
      executablePath: '/fake/codex',
      spawnImpl,
      requestTimeoutMs: 1_000,
    };
    const baseEnv = { MEDHELP_LOCAL_KERNEL: '1' };

    const original = await getCodexAppServerClient({
      userId: 'desktop-user',
      env: { ...baseEnv, CODEX_ACCESS_TOKEN: 'first-token' },
      clientOptions,
    });
    const [firstWindow, secondWindow] = await Promise.all([
      getCodexAppServerClient({
        userId: 'desktop-user',
        env: { ...baseEnv, CODEX_ACCESS_TOKEN: 'second-token' },
        clientOptions,
      }),
      getCodexAppServerClient({
        userId: 'desktop-user',
        env: { ...baseEnv, CODEX_ACCESS_TOKEN: 'second-token' },
        clientOptions,
      }),
    ]);

    expect(firstWindow).toBe(secondWindow);
    expect(firstWindow).not.toBe(original);
    expect(spawnImpl).toHaveBeenCalledTimes(2);
    expect(harnesses[0].child.kill).toHaveBeenCalledTimes(1);
    expect(harnesses[1].child.kill).not.toHaveBeenCalled();
  });
});

describe('CodexAppServerClient', () => {
  it('unarchives a stored thread through the official app-server method', async () => {
    const harness = createHarness((message, send) => {
      if (respondToInitialize(message, send)) return;
      if (message.method === 'thread/unarchive') {
        send({ id: message.id, result: { thread: { id: message.params.threadId } } });
      }
    });
    const client = new CodexAppServerClient({
      executablePath: '/fake/codex',
      spawnImpl: harness.spawnImpl,
      requestTimeoutMs: 1_000,
    });
    clients.push(client);
    await client.start();

    await expect(client.unarchiveThread('thread-archived'))
      .resolves.toEqual({ id: 'thread-archived' });
    expect(harness.requests.find((request) => request.method === 'thread/unarchive')?.params)
      .toEqual({ threadId: 'thread-archived' });
  });

  it('steers an active turn without starting or interrupting another turn', async () => {
    const harness = createHarness((message, send) => {
      if (respondToInitialize(message, send)) return;
      if (message.method === 'turn/steer') {
        send({ id: message.id, result: { turnId: message.params.expectedTurnId } });
      }
    });
    const client = new CodexAppServerClient({
      executablePath: '/fake/codex',
      spawnImpl: harness.spawnImpl,
      requestTimeoutMs: 1_000,
    });
    clients.push(client);
    await client.start();

    const turnId = await client.steerTurn({
      threadId: 'thread-active',
      turnId: 'turn-active',
      input: [{ type: 'text', text: 'Use the new requirement now.' }],
    });

    expect(turnId).toBe('turn-active');
    expect(harness.requests.find((request) => request.method === 'turn/steer')?.params).toEqual({
      threadId: 'thread-active',
      expectedTurnId: 'turn-active',
      input: [{ type: 'text', text: 'Use the new requirement now.' }],
    });
    expect(harness.requests.some((request) => request.method === 'turn/start')).toBe(false);
    expect(harness.requests.some((request) => request.method === 'turn/interrupt')).toBe(false);
  });

  it('reuses one initialized process across thread and turn requests', async () => {
    let turnNumber = 0;
    const harness = createHarness((message, send) => {
      if (respondToInitialize(message, send)) return;
      if (message.method === 'thread/start') {
        send({ id: message.id, result: { thread: { id: 'thread-1' } } });
      } else if (message.method === 'thread/resume') {
        send({ id: message.id, result: { thread: { id: message.params.threadId } } });
      } else if (message.method === 'thread/read') {
        send({ id: message.id, result: { thread: { id: message.params.threadId, turns: [{ id: 'turn-1' }] } } });
      } else if (message.method === 'thread/fork') {
        send({ id: message.id, result: { thread: { id: 'thread-fork' } } });
      } else if (message.method === 'turn/start') {
        turnNumber += 1;
        const turnId = `turn-${turnNumber}`;
        send({ id: message.id, result: { turn: { id: turnId } } });
        queueMicrotask(() => {
          send({
            method: 'turn/started',
            params: {
              threadId: message.params.threadId,
              turn: { id: turnId, items: [], status: 'inProgress' },
            },
          });
          send({
            method: 'turn/completed',
            params: {
              threadId: message.params.threadId,
              turn: { id: turnId, items: [], status: 'completed' },
            },
          });
        });
      }
    });
    const client = new CodexAppServerClient({
      executablePath: '/fake/codex',
      spawnImpl: harness.spawnImpl,
      requestTimeoutMs: 1_000,
    });
    clients.push(client);

    await client.start();
    await client.start();
    expect((await client.startThread({ cwd: '/tmp/project' }))?.id).toBe('thread-1');
    expect((await client.resumeThread('thread-1', { model: 'gpt-5.6-sol' }))?.id).toBe('thread-1');
    expect((await client.readThread('thread-1'))?.turns).toEqual([{ id: 'turn-1' }]);
    expect((await client.forkThread('thread-1', { lastTurnId: 'turn-1' }))?.id).toBe('thread-fork');

    const firstTurn = await client.runTurn({
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'first' }],
    });
    const secondTurn = await client.runTurn({
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'second' }],
    });
    await Promise.all([collect(firstTurn.events), collect(secondTurn.events)]);

    expect(harness.spawnImpl).toHaveBeenCalledTimes(1);
    expect(harness.spawnImpl).toHaveBeenCalledWith(
      '/fake/codex',
      ['app-server', '--listen', 'stdio://'],
      expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
    );
    expect(harness.requests.filter((request) => request.method === 'initialize')).toHaveLength(1);
    expect(harness.requests.find((request) => request.method === 'initialize').params)
      .not.toHaveProperty('capabilities');
    expect(harness.requests.filter((request) => request.method === 'turn/start')).toHaveLength(2);
    expect(harness.requests.some((request) => request.method === 'initialized' && !Object.hasOwn(request, 'id'))).toBe(true);
  });

  it('maps streaming text, final items, and token usage to the existing event format', async () => {
    const harness = createHarness((message, send) => {
      if (respondToInitialize(message, send)) return;
      if (message.method !== 'turn/start') return;
      send({ id: message.id, result: { turn: { id: 'turn-stream' } } });
      queueMicrotask(() => {
        const base = { threadId: 'thread-stream', turnId: 'turn-stream' };
        send({ method: 'turn/started', params: { threadId: base.threadId, turn: { id: base.turnId, items: [], status: 'inProgress' } } });
        send({ method: 'item/started', params: { ...base, item: { id: 'message-1', type: 'agentMessage', text: '' } } });
        send({ method: 'item/agentMessage/delta', params: { ...base, itemId: 'message-1', delta: 'Hel' } });
        send({ method: 'item/agentMessage/delta', params: { ...base, itemId: 'message-1', delta: 'lo' } });
        send({ method: 'item/completed', params: { ...base, item: { id: 'message-1', type: 'agentMessage', text: 'Hello' } } });
        send({
          method: 'thread/tokenUsage/updated',
          params: {
            ...base,
            tokenUsage: {
              last: {
                cachedInputTokens: 3,
                inputTokens: 10,
                outputTokens: 4,
                reasoningOutputTokens: 2,
                totalTokens: 14,
              },
              total: {
                cachedInputTokens: 3,
                inputTokens: 10,
                outputTokens: 4,
                reasoningOutputTokens: 2,
                totalTokens: 14,
              },
              modelContextWindow: 258_400,
            },
          },
        });
        send({ method: 'turn/completed', params: { threadId: base.threadId, turn: { id: base.turnId, items: [], status: 'completed' } } });
      });
    });
    const client = new CodexAppServerClient({
      executablePath: '/fake/codex',
      spawnImpl: harness.spawnImpl,
      requestTimeoutMs: 1_000,
    });
    clients.push(client);
    await client.start();

    const turn = await client.runTurn({
      threadId: 'thread-stream',
      input: [{ type: 'text', text: 'hello' }],
    });
    const events = await collect(turn.events);

    expect(events.filter((event) => event.type === 'item.updated').map((event) => event.item.text)).toEqual(['Hel', 'Hello']);
    expect(events.find((event) => event.type === 'item.completed')?.item.text).toBe('Hello');
    expect(events.at(-1)).toMatchObject({
      type: 'turn.completed',
      usage: {
        input_tokens: 10,
        cached_input_tokens: 3,
        output_tokens: 4,
        reasoning_output_tokens: 2,
        current_context_usage: { total_tokens: 14 },
        model_context_window: 258_400,
      },
    });
  });

  it('maps turn/plan/updated notifications to Codex todo-list items', async () => {
    const harness = createHarness((message, send) => {
      if (respondToInitialize(message, send)) return;
      if (message.method !== 'turn/start') return;
      send({ id: message.id, result: { turn: { id: 'turn-plan' } } });
      queueMicrotask(() => {
        const base = { threadId: 'thread-plan', turnId: 'turn-plan' };
        send({
          method: 'turn/plan/updated',
          params: {
            ...base,
            plan: [
              { step: 'Inspect the cohort', status: 'completed' },
              { step: 'Run the model', status: 'inProgress' },
            ],
          },
        });
        send({
          method: 'turn/completed',
          params: {
            threadId: base.threadId,
            turn: { id: base.turnId, items: [], status: 'completed' },
          },
        });
      });
    });
    const client = new CodexAppServerClient({
      executablePath: '/fake/codex',
      spawnImpl: harness.spawnImpl,
      requestTimeoutMs: 1_000,
    });
    clients.push(client);
    await client.start();

    const turn = await client.runTurn({
      threadId: 'thread-plan',
      input: [{ type: 'text', text: 'make a plan' }],
    });
    const events = await collect(turn.events);

    expect(events.find((event) => event.item?.type === 'todo_list')).toEqual({
      type: 'item.updated',
      item: {
        id: 'plan:turn-plan',
        type: 'todo_list',
        items: [
          { text: 'Inspect the cohort', status: 'completed', completed: true },
          { text: 'Run the model', status: 'in_progress', completed: false },
        ],
      },
    });
  });

  it('interrupts the active turn when its abort signal fires', async () => {
    const harness = createHarness((message, send) => {
      if (respondToInitialize(message, send)) return;
      if (message.method === 'turn/start') {
        send({ id: message.id, result: { turn: { id: 'turn-abort' } } });
      } else if (message.method === 'turn/interrupt') {
        send({ id: message.id, result: {} });
        queueMicrotask(() => send({
          method: 'turn/completed',
          params: {
            threadId: message.params.threadId,
            turn: { id: message.params.turnId, items: [], status: 'interrupted' },
          },
        }));
      }
    });
    const client = new CodexAppServerClient({
      executablePath: '/fake/codex',
      spawnImpl: harness.spawnImpl,
      requestTimeoutMs: 1_000,
    });
    clients.push(client);
    await client.start();

    const controller = new AbortController();
    const turn = await client.runTurn({
      threadId: 'thread-abort',
      input: [{ type: 'text', text: 'stop' }],
      signal: controller.signal,
    });
    controller.abort();
    await expect(collect(turn.events)).rejects.toMatchObject({ name: 'AbortError' });

    expect(harness.requests.find((request) => request.method === 'turn/interrupt')?.params).toEqual({
      threadId: 'thread-abort',
      turnId: 'turn-abort',
    });
  });

  it('interrupts and fails a turn that stops producing app-server events', async () => {
    const harness = createHarness((message, send) => {
      if (respondToInitialize(message, send)) return;
      if (message.method === 'turn/start') {
        send({ id: message.id, result: { turn: { id: 'turn-idle' } } });
      } else if (message.method === 'turn/interrupt') {
        send({ id: message.id, result: {} });
      }
    });
    const client = new CodexAppServerClient({
      executablePath: '/fake/codex',
      spawnImpl: harness.spawnImpl,
      requestTimeoutMs: 1_000,
      turnIdleTimeoutMs: 20,
    });
    clients.push(client);
    await client.start();

    const turn = await client.runTurn({
      threadId: 'thread-idle',
      input: [{ type: 'text', text: 'wait forever' }],
    });

    await expect(collect(turn.events)).rejects.toMatchObject({
      name: 'TimeoutError',
      code: 'TURN_IDLE_TIMEOUT',
    });
    expect(harness.requests.find((request) => request.method === 'turn/interrupt')?.params).toEqual({
      threadId: 'thread-idle',
      turnId: 'turn-idle',
    });
  });

  it('suspends the turn idle timeout while an MCP tool call is active', async () => {
    const base = { threadId: 'thread-tool', turnId: 'turn-tool' };
    const harness = createHarness((message, send) => {
      if (respondToInitialize(message, send)) return;
      if (message.method === 'turn/start') {
        send({ id: message.id, result: { turn: { id: 'turn-tool' } } });
        queueMicrotask(() => send({
          method: 'item/started',
          params: {
            ...base,
            item: { id: 'tool-1', type: 'mcpToolCall', server: 'compute', tool: 'sync' },
          },
        }));
      } else if (message.method === 'turn/interrupt') {
        send({ id: message.id, result: {} });
      }
    });
    const client = new CodexAppServerClient({
      executablePath: '/fake/codex',
      spawnImpl: harness.spawnImpl,
      requestTimeoutMs: 1_000,
      turnIdleTimeoutMs: 20,
    });
    clients.push(client);
    await client.start();

    const turn = await client.runTurn({
      threadId: 'thread-tool',
      input: [{ type: 'text', text: 'run a slow tool' }],
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(harness.requests.find((request) => request.method === 'turn/interrupt')).toBeUndefined();

    harness.send({
      method: 'item/completed',
      params: {
        ...base,
        item: {
          id: 'tool-1',
          type: 'mcpToolCall',
          server: 'compute',
          tool: 'sync',
          status: 'failed',
          error: { message: 'tool timed out' },
        },
      },
    });
    harness.send({
      method: 'turn/completed',
      params: { ...base, turn: { id: 'turn-tool', items: [], status: 'completed' } },
    });

    await expect(collect(turn.events)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'item.completed',
        item: expect.objectContaining({ id: 'tool-1', status: 'failed' }),
      }),
      expect.objectContaining({ type: 'turn.completed' }),
    ]));
  });

  it('restarts the turn idle timeout after an active MCP tool call completes', async () => {
    const base = { threadId: 'thread-tool-idle', turnId: 'turn-tool-idle' };
    const harness = createHarness((message, send) => {
      if (respondToInitialize(message, send)) return;
      if (message.method === 'turn/start') {
        send({ id: message.id, result: { turn: { id: 'turn-tool-idle' } } });
        queueMicrotask(() => send({
          method: 'item/started',
          params: {
            ...base,
            item: { id: 'tool-idle-1', type: 'mcpToolCall', server: 'compute', tool: 'sync' },
          },
        }));
      } else if (message.method === 'turn/interrupt') {
        send({ id: message.id, result: {} });
      }
    });
    const client = new CodexAppServerClient({
      executablePath: '/fake/codex',
      spawnImpl: harness.spawnImpl,
      requestTimeoutMs: 1_000,
      turnIdleTimeoutMs: 20,
    });
    clients.push(client);
    await client.start();

    const turn = await client.runTurn({
      threadId: 'thread-tool-idle',
      input: [{ type: 'text', text: 'finish a slow tool, then hang' }],
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(harness.requests.find((request) => request.method === 'turn/interrupt')).toBeUndefined();

    harness.send({
      method: 'item/completed',
      params: {
        ...base,
        item: {
          id: 'tool-idle-1',
          type: 'mcpToolCall',
          server: 'compute',
          tool: 'sync',
          status: 'completed',
        },
      },
    });

    await expect(collect(turn.events)).rejects.toMatchObject({
      name: 'TimeoutError',
      code: 'TURN_IDLE_TIMEOUT',
    });
    expect(harness.requests.find((request) => request.method === 'turn/interrupt')?.params).toEqual({
      threadId: 'thread-tool-idle',
      turnId: 'turn-tool-idle',
    });
  });

  it('declines server-initiated approvals when no interactive approval UI is attached', async () => {
    const harness = createHarness((message, send) => {
      respondToInitialize(message, send);
    });
    const client = new CodexAppServerClient({
      executablePath: '/fake/codex',
      spawnImpl: harness.spawnImpl,
      requestTimeoutMs: 1_000,
    });
    clients.push(client);
    await client.start();

    harness.send({
      id: 91,
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'thread-approval', turnId: 'turn-approval', itemId: 'item-approval' },
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(harness.requests.find((request) => request.id === 91 && !request.method)).toEqual({
      id: 91,
      result: { decision: 'decline' },
    });
  });
});
