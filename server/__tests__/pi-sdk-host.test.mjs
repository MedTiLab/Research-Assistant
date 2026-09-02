import http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPiRuntime } from '../agent-runtime/pi-runtime.js';
import { createPiHostManager } from '../pi-runtime/host-manager.js';
import { resolvePiProviderConfig } from '../pi-runtime/provider-config.js';
import { createPiHostSessionStore, readPiSessionRecords } from '../pi-runtime/session-store.js';
import { readAgentRuntimeState } from '../agent-runtime/state-store.js';
import { createPiPermissionBridge } from '../pi-runtime/permission-bridge.js';

const preparedRuntimeRoot = process.env.MEDHELP_PI_TEST_RUNTIME_ROOT || null;
const describePrepared = preparedRuntimeRoot ? describe : describe.skip;
let testRoot;
let upstream;
let manager;

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-pi-sdk-'));
});

afterEach(async () => {
  await manager?.shutdown();
  if (upstream) await close(upstream);
  await fs.rm(testRoot, { recursive: true, force: true });
  manager = null;
  upstream = null;
});

describePrepared('Pi SDK Host integration', () => {
  it('streams through the isolated SDK with only read-only tools and resumes its native JSONL', async () => {
    const requests = [];
    upstream = http.createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        requests.push(JSON.parse(body));
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(`data: ${JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'test-model',
          choices: [{ index: 0, delta: { role: 'assistant', content: '真实 Pi' }, finish_reason: null }],
        })}\n\n`);
        response.write(`data: ${JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'test-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
        })}\n\n`);
        response.end('data: [DONE]\n\n');
      });
    });
    const address = await listen(upstream);
    const projectRoot = path.join(testRoot, 'project');
    await fs.mkdir(projectRoot);
    await fs.writeFile(path.join(projectRoot, 'AGENTS.md'), '# Project instructions\nPROJECT_CONTEXT_SENTINEL\n');
    const imagePath = path.join(projectRoot, 'tiny.png');
    await fs.writeFile(
      imagePath,
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    );
    const pdfPath = path.join(projectRoot, 'paper.pdf');
    const largePath = path.join(projectRoot, 'large.png');
    await fs.writeFile(pdfPath, 'PDF fixture');
    await fs.writeFile(largePath, Buffer.alloc(8 * 1024 * 1024 + 1));
    manager = createPiHostManager({
      hostPath: path.join(preparedRuntimeRoot, 'sdk-host.mjs'),
      configRoot: path.join(testRoot, 'config'),
      requestTimeoutMs: 10_000,
    });
    const runtime = createPiRuntime({ hostManager: manager });
    const identity = {
      ownerKey: 'owner-sdk',
      projectKey: 'project-sdk',
      runtimeId: 'pi',
      sessionId: 'session-sdk',
    };
    const providerEnv = {
      MEDHELP_PI_PROVIDER: 'local-openai-compatible',
      MEDHELP_PI_MODEL: 'test-model',
      MEDHELP_PI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      MEDHELP_PI_API_KEY: 'test-key',
      MEDHELP_PI_VISION: 'true',
    };
    const writerPayloads = [];

    await expect(runtime.start('inspect the project', {
      identity,
      projectPath: projectRoot,
      storageOptions: { dataDir: testRoot },
      piProviderEnv: providerEnv,
      attachments: [
        { name: 'tiny.png', kind: 'image', mimeType: 'image/png', path: imagePath },
        { name: 'paper.pdf', kind: 'pdf', mimeType: 'application/pdf', path: pdfPath },
        { name: 'large.png', kind: 'image', mimeType: 'image/png', path: largePath },
      ],
    }, { send: (payload) => writerPayloads.push(payload) })).resolves.toMatchObject({
      sessionId: 'session-sdk',
      status: 'completed',
    });
    await expect(runtime.resume('continue', {
      identity,
      projectPath: projectRoot,
      storageOptions: { dataDir: testRoot },
      piProviderEnv: providerEnv,
    }, { send: (payload) => writerPayloads.push(payload) })).resolves.toMatchObject({
      sessionId: 'session-sdk',
    });

    expect(requests).toHaveLength(2);
    expect(requests[0].tools.map((tool) => tool.function.name).sort())
      .toEqual([
        'ask_user',
        'exit_plan_mode',
        'find',
        'grep',
        'ls',
        'plan_read',
        'plan_update',
        'read',
        'system_info',
        'task',
        'task_create',
        'task_get',
        'task_list',
        'task_update',
        'todo_read',
        'todo_write',
        'tool_call',
        'tool_describe',
        'tool_search',
      ]);
    expect(requests[0].tools.map((tool) => tool.function.name))
      .not.toEqual(expect.arrayContaining(['bash', 'edit', 'write']));
    expect(JSON.stringify(requests[0].messages)).toContain('data:image/png;base64,');
    const delivery = writerPayloads.find((event) => event.data?.event === 'attachment_delivery')?.data.data.attachments;
    expect(delivery).toEqual([
      expect.objectContaining({ name: 'tiny.png', status: 'sent' }),
      expect.objectContaining({ name: 'paper.pdf', status: 'not_sent', reason: 'unsupported_type' }),
      expect.objectContaining({ name: 'large.png', status: 'not_sent', reason: 'image_decode_failed' }),
    ]);
    const restored = await createPiHostSessionStore({ dataDir: testRoot }).read(identity);
    const context = writerPayloads.filter((event) => event.data?.event === 'usage').at(-1).data.data.context;
    expect(context.tokens).toBeGreaterThan(0);
    expect(context.contextWindow).toBeGreaterThan(0);
    expect(restored.tokenUsage).toMatchObject({ used: context.tokens, total: context.contextWindow });
    expect(restored.messages.find((message) => message.role === 'user').attachmentDelivery).toEqual(delivery);
    expect(JSON.stringify(requests[0].messages.filter((message) => message.role === 'system')))
      .toContain('PROJECT_CONTEXT_SENTINEL');
    expect(JSON.stringify(requests[0].messages.filter((message) => message.role === 'user')))
      .not.toContain('PROJECT_CONTEXT_SENTINEL');
    expect(writerPayloads).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'pi-response', data: expect.objectContaining({ event: 'text_delta' }) }),
    ]));
    const transcript = await readPiSessionRecords(identity, { dataDir: testRoot });
    expect(transcript.records[0]).toMatchObject({ type: 'session', id: 'session-sdk' });
    expect(transcript.records.filter((record) => record.type === 'message')).toHaveLength(4);
  }, 15_000);

  it('exposes computer resources and full tools without approval in Auto mode', async () => {
    const requests = [];
    upstream = http.createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        requests.push(JSON.parse(body));
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        if (requests.length === 1) {
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-system-info', object: 'chat.completion.chunk', created: 1, model: 'test-model',
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: 0,
                  id: 'call-system-info',
                  type: 'function',
                  function: { name: 'system_info', arguments: '{}' },
                }],
              },
              finish_reason: null,
            }],
          })}\n\n`);
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-system-info', object: 'chat.completion.chunk', created: 1, model: 'test-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
          })}\n\n`);
        } else {
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-system-info-final', object: 'chat.completion.chunk', created: 1, model: 'test-model',
            choices: [{ index: 0, delta: { role: 'assistant', content: 'resources inspected' }, finish_reason: null }],
          })}\n\n`);
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-system-info-final', object: 'chat.completion.chunk', created: 1, model: 'test-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`);
        }
        response.end('data: [DONE]\n\n');
      });
    });
    const address = await listen(upstream);
    const projectRoot = path.join(testRoot, 'project');
    await fs.mkdir(projectRoot);
    manager = createPiHostManager({
      hostPath: path.join(preparedRuntimeRoot, 'sdk-host.mjs'),
      configRoot: path.join(testRoot, 'config'),
      requestTimeoutMs: 15_000,
    });
    const runtime = createPiRuntime({ hostManager: manager });
    const writerPayloads = [];

    await runtime.start('inspect computer resources', {
      identity: {
        ownerKey: 'owner-system-info', projectKey: 'project-system-info', runtimeId: 'pi', sessionId: 'session-system-info',
      },
      projectPath: projectRoot,
      storageOptions: { dataDir: testRoot },
      piProviderEnv: {
        MEDHELP_PI_PROVIDER: 'local-openai-compatible',
        MEDHELP_PI_MODEL: 'test-model',
        MEDHELP_PI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      },
      turnSnapshot: { permissionMode: 'auto' },
    }, { send: (payload) => writerPayloads.push(payload) });

    expect(requests[0].tools.map((tool) => tool.function.name))
      .toEqual(expect.arrayContaining(['bash', 'edit', 'find', 'grep', 'ls', 'read', 'system_info', 'write']));
    const toolMessage = requests[1].messages.find((message) => message.role === 'tool');
    expect(JSON.stringify(toolMessage)).toContain('logicalCores');
    expect(JSON.stringify(toolMessage)).toContain('totalBytes');
    expect(writerPayloads).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'agent-permission-request' }),
    ]));
  }, 20_000);

  it('runs ask_user and todo_write through the renderer and restores their persistent state', async () => {
    const requests = [];
    upstream = http.createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        const payload = JSON.parse(body);
        requests.push(payload);
        const toolMessages = payload.messages.filter((message) => message.role === 'tool');
        const toolCall = toolMessages.length === 0
          ? {
            id: 'call-ask-user',
            name: 'ask_user',
            arguments: JSON.stringify({
              questions: [{
                header: 'Choice',
                question: 'Continue?',
                options: [{ label: 'Yes', description: 'Continue the task.' }],
              }],
            }),
          }
          : toolMessages.length === 1
            ? {
              id: 'call-todo-write',
              name: 'todo_write',
              arguments: JSON.stringify({
                todos: [{ id: 'todo-a', content: 'Finish the task', status: 'in_progress' }],
              }),
            }
            : null;
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        if (toolCall) {
          response.write(`data: ${JSON.stringify({
            id: `chatcmpl-${toolCall.id}`, object: 'chat.completion.chunk', created: 1, model: 'test-model',
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: 0,
                  id: toolCall.id,
                  type: 'function',
                  function: { name: toolCall.name, arguments: toolCall.arguments },
                }],
              },
              finish_reason: null,
            }],
          })}\n\n`);
          response.write(`data: ${JSON.stringify({
            id: `chatcmpl-${toolCall.id}`, object: 'chat.completion.chunk', created: 1, model: 'test-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
          })}\n\n`);
        } else {
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-coordination-final', object: 'chat.completion.chunk', created: 1, model: 'test-model',
            choices: [{ index: 0, delta: { role: 'assistant', content: 'continued' }, finish_reason: 'stop' }],
          })}\n\n`);
        }
        response.end('data: [DONE]\n\n');
      });
    });
    const address = await listen(upstream);
    const projectRoot = path.join(testRoot, 'project');
    await fs.mkdir(projectRoot);
    manager = createPiHostManager({
      hostPath: path.join(preparedRuntimeRoot, 'sdk-host.mjs'),
      configRoot: path.join(testRoot, 'config'),
      requestTimeoutMs: 15_000,
    });
    const runtime = createPiRuntime({ hostManager: manager });
    const identity = {
      ownerKey: 'owner-coordination', projectKey: 'project-coordination', runtimeId: 'pi', sessionId: 'session-coordination',
    };
    const approvals = [];
    await runtime.start('ask and plan', {
      identity,
      projectPath: projectRoot,
      storageOptions: { dataDir: testRoot },
      piProviderEnv: {
        MEDHELP_PI_PROVIDER: 'local-openai-compatible',
        MEDHELP_PI_MODEL: 'test-model',
        MEDHELP_PI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      },
    }, {
      send: (payload) => {
        if (payload.type !== 'agent-permission-request') return;
        approvals.push(payload);
        queueMicrotask(() => runtime.native.resolveToolApproval(payload.requestId, {
          allow: true,
          updatedInput: { ...payload.input, answers: { 'Continue?': 'Yes' } },
        }, { ownerKey: identity.ownerKey }));
      },
    });

    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ toolName: 'AskUserQuestion' });
    expect(JSON.stringify(requests[1].messages)).toContain('User has answered your questions');
    const state = await readAgentRuntimeState(identity, { dataDir: testRoot });
    expect(state.todos).toEqual([expect.objectContaining({
      id: 'todo-a', content: 'Finish the task', status: 'in_progress',
    })]);
    expect(state.permissionRequests).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName: 'ask_user', status: 'approved' }),
    ]));
  }, 20_000);

  it.each(['timeout', 'skipped', 'blank', 'declined', 'write-timeout', 'bash-timeout', 'plan-timeout', 'aborted'])(
    'handles %s without leaving a stale interaction or granting missing approval', async (scenario) => {
      const requests = [];
      let finalResponse;
      const calls = scenario === 'write-timeout'
        ? [{ name: 'write', input: { path: 'must-not-exist.txt', content: 'not authorized' } }]
        : scenario === 'bash-timeout'
          ? [{ name: 'bash', input: { command: 'touch must-not-exist.txt' } }]
        : scenario === 'plan-timeout'
          ? [{ name: 'plan_update', input: { title: 'Draft', plan: 'Write a file after confirmation.' } }, { name: 'exit_plan_mode', input: {} }]
          : [{ name: 'ask_user', input: { questions: [{ question: 'Which scope?', options: [{ label: 'Small' }, { label: 'Large' }] }] } }];
      const sendChunk = (response, delta, finishReason = null) => response.write(`data: ${JSON.stringify({
        id: 'chatcmpl-interaction', object: 'chat.completion.chunk', created: 1, model: 'test-model',
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })}\n\n`);
      upstream = http.createServer((request, response) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => { body += chunk; });
        request.on('end', () => {
          const payload = JSON.parse(body);
          requests.push(payload);
          const index = payload.messages.filter((message) => message.role === 'tool').length;
          response.writeHead(200, { 'content-type': 'text/event-stream' });
          if (index < calls.length) {
            const tool = calls[index];
            sendChunk(response, { role: 'assistant', tool_calls: [{
              index: 0, id: `call-${index}`, type: 'function',
              function: { name: tool.name, arguments: JSON.stringify(tool.input) },
            }] });
            sendChunk(response, {}, 'tool_calls');
            response.end('data: [DONE]\n\n');
          } else {
            // Keep the assistant streaming: turn-finally cleanup must not be
            // what makes the expired renderer request disappear.
            finalResponse = response;
            sendChunk(response, { role: 'assistant', content: '建议先' });
          }
        });
      });
      const address = await listen(upstream);
      const projectRoot = path.join(testRoot, 'project');
      await fs.mkdir(projectRoot);
      manager = createPiHostManager({ hostPath: path.join(preparedRuntimeRoot, 'sdk-host.mjs'), configRoot: path.join(testRoot, 'config') });
      const runTurn = manager.runTurn.bind(manager);
      vi.spyOn(manager, 'runTurn').mockImplementation((context) => runTurn({ ...context, approvalTimeoutMs: 200 }));
      const bridge = createPiPermissionBridge();
      const runtime = createPiRuntime({ hostManager: manager, permissionBridge: bridge });
      const identity = { ownerKey: 'interaction-owner', projectKey: 'interaction-project', runtimeId: 'pi', sessionId: `interaction-${scenario}` };
      const events = [];
      const controller = new AbortController();
      const pending = runtime.start('ask before acting; do not guess', {
        identity, projectPath: projectRoot, permissionMode: 'ask', storageOptions: { dataDir: testRoot }, signal: controller.signal,
        piProviderEnv: { MEDHELP_PI_PROVIDER: 'local-openai-compatible', MEDHELP_PI_MODEL: 'test-model', MEDHELP_PI_BASE_URL: `http://127.0.0.1:${address.port}/v1` },
      }, { send: (event) => {
        events.push(event);
        if (event.type === 'agent-permission-request' && !scenario.includes('timeout')) {
          if (scenario === 'aborted') {
            queueMicrotask(() => controller.abort());
            return;
          }
          queueMicrotask(() => runtime.native.resolveToolApproval(event.requestId, {
            allow: scenario !== 'declined',
            updatedInput: { ...event.input, answers: scenario === 'blank' ? { 'Which scope?': '  ' } : {} },
          }, { ownerKey: identity.ownerKey }));
        }
      } });
      if (scenario === 'aborted') {
        await expect(pending).rejects.toMatchObject({ name: 'AbortError', code: 'PI_TURN_ABORTED' });
        expect(bridge.size()).toBe(0);
        expect(requests).toHaveLength(1);
        expect(events.filter((event) => event.type === 'agent-permission-cancelled')).toEqual([
          expect.objectContaining({ reason: 'aborted' }),
        ]);
        expect(finalResponse).toBeUndefined();
        return;
      }
      try {
        await vi.waitFor(() => {
          expect(finalResponse).toBeDefined();
          expect(events.some((event) => event.data?.event === 'text_delta')).toBe(true);
        }, { timeout: 10000 });
        expect(bridge.size()).toBe(0);
        const cancellations = events.filter((event) => event.type === 'agent-permission-cancelled');
        expect(cancellations).toHaveLength(scenario.includes('timeout') ? 1 : 0);
        if (scenario.includes('timeout')) {
          expect(cancellations[0].reason).toBe('timeout');
          expect(runtime.native.resolveToolApproval(cancellations[0].requestId, { allow: true }, { ownerKey: identity.ownerKey })).toBe(false);
        }
        const result = JSON.stringify(requests.at(-1).messages.filter((message) => message.role === 'tool').at(-1));
        if (scenario === 'write-timeout' || scenario === 'bash-timeout') {
          expect(result).toContain('Tool approval timed out');
          await expect(fs.stat(path.join(projectRoot, 'must-not-exist.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
        } else if (scenario === 'plan-timeout') {
          expect(result).toContain('Remain in Plan mode');
          const state = await readAgentRuntimeState(identity, { dataDir: testRoot });
          expect(state.plan).toMatchObject({ status: 'rejected', approvedAt: null });
          expect(events.some((event) => event.data?.event === 'permission_mode_changed')).toBe(false);
        } else {
          expect(result).toContain('No user answer was received');
          expect(result).toContain('not confirmation or authorization');
          expect(result).toContain('Do not invent missing facts');
          expect(result).not.toContain('Continue using reasonable assumptions');
          const toolResults = events.filter((event) => event.data?.event === 'tool_completed');
          expect(toolResults.at(-1).data.data.isError).not.toBe(true);
        }
      } finally {
        if (finalResponse) {
          sendChunk(finalResponse, { content: '确认范围。' });
          sendChunk(finalResponse, {}, 'stop');
          finalResponse.end('data: [DONE]\n\n');
        } else await manager.shutdown();
        await pending;
      }
      expect(events.filter((event) => event.data?.event === 'text_delta').map((event) => event.data.data.text).join('')).toBe('建议先确认范围。');
      expect(events.filter((event) => event.type === 'agent-permission-cancelled')).toHaveLength(scenario.includes('timeout') ? 1 : 0);
    }, 20000,
  );

  it('executes a delegated task in an independent background Pi session and persists completion', async () => {
    const requests = [];
    upstream = http.createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        const payload = JSON.parse(body);
        requests.push(payload);
        const serialized = JSON.stringify(payload.messages);
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        if (serialized.includes('<background_agent_task>')) {
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-child-final', object: 'chat.completion.chunk', created: 1, model: 'test-model',
            choices: [{ index: 0, delta: { role: 'assistant', content: 'background result' }, finish_reason: 'stop' }],
          })}\n\n`);
        } else if (!payload.messages.some((message) => message.role === 'tool')) {
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-task', object: 'chat.completion.chunk', created: 1, model: 'test-model',
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: 0,
                  id: 'call-task',
                  type: 'function',
                  function: {
                    name: 'task',
                    arguments: JSON.stringify({ description: 'Inspect', prompt: 'Inspect the project' }),
                  },
                }],
              },
              finish_reason: null,
            }],
          })}\n\n`);
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-task', object: 'chat.completion.chunk', created: 1, model: 'test-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
          })}\n\n`);
        } else {
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-parent-final', object: 'chat.completion.chunk', created: 1, model: 'test-model',
            choices: [{ index: 0, delta: { role: 'assistant', content: 'task queued' }, finish_reason: 'stop' }],
          })}\n\n`);
        }
        response.end('data: [DONE]\n\n');
      });
    });
    const address = await listen(upstream);
    const projectRoot = path.join(testRoot, 'project');
    await fs.mkdir(projectRoot);
    manager = createPiHostManager({
      hostPath: path.join(preparedRuntimeRoot, 'sdk-host.mjs'),
      configRoot: path.join(testRoot, 'config'),
      requestTimeoutMs: 15_000,
    });
    const runtime = createPiRuntime({ hostManager: manager });
    const identity = {
      ownerKey: 'owner-background', projectKey: 'project-background', runtimeId: 'pi', sessionId: 'session-background',
    };
    await runtime.start('delegate the inspection', {
      identity,
      projectPath: projectRoot,
      storageOptions: { dataDir: testRoot },
      piProviderEnv: {
        MEDHELP_PI_PROVIDER: 'local-openai-compatible',
        MEDHELP_PI_MODEL: 'test-model',
        MEDHELP_PI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      },
    });

    await vi.waitFor(async () => {
      const state = await readAgentRuntimeState(identity, { dataDir: testRoot });
      expect(state.tasks).toEqual(expect.arrayContaining([
        expect.objectContaining({ status: 'completed', result: 'background result' }),
      ]));
    }, { timeout: 5_000 });
    expect(requests.some((payload) => JSON.stringify(payload.messages).includes('<background_agent_task>'))).toBe(true);
    const transcript = await createPiHostSessionStore({ dataDir: testRoot }).read(identity);
    expect(transcript.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool_result',
        toolCallId: 'call-task',
        output: expect.stringContaining('background result'),
      }),
    ]));
  }, 20_000);

  it('passes only approved MedHelp connector variables into the Pi bash tool', async () => {
    const requests = [];
    upstream = http.createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        requests.push(JSON.parse(body));
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        if (requests.length === 1) {
          const command = [
            'if [ "$MEDHELP_MANAGED_AGENT_SESSION" = "1" ]',
            '&& [ "$MEDHELP_DATABASE_API_CONNECTION_STATUS" = "connected" ]',
            '&& [ "$MEDHELP_DATABASE_API_URL" = "https://api.medtimehelp.com" ]',
            '&& [ -n "$MEDHELP_DATABASE_API_TOKEN" ]',
            '&& [ -z "$UNRELATED_SECRET" ];',
            'then printf connector-ready; else printf connector-missing; fi',
          ].join(' ');
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-connector', object: 'chat.completion.chunk', created: 1, model: 'test-model',
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: 0,
                  id: 'call-connector',
                  type: 'function',
                  function: { name: 'bash', arguments: JSON.stringify({ command }) },
                }],
              },
              finish_reason: null,
            }],
          })}\n\n`);
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-connector', object: 'chat.completion.chunk', created: 1, model: 'test-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
          })}\n\n`);
        } else {
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-connector-final', object: 'chat.completion.chunk', created: 1, model: 'test-model',
            choices: [{ index: 0, delta: { role: 'assistant', content: 'connector visible' }, finish_reason: null }],
          })}\n\n`);
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-connector-final', object: 'chat.completion.chunk', created: 1, model: 'test-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`);
        }
        response.end('data: [DONE]\n\n');
      });
    });
    const address = await listen(upstream);
    const projectRoot = path.join(testRoot, 'project');
    await fs.mkdir(projectRoot);
    manager = createPiHostManager({
      hostPath: path.join(preparedRuntimeRoot, 'sdk-host.mjs'),
      configRoot: path.join(testRoot, 'config'),
      requestTimeoutMs: 15_000,
    });
    const runtime = createPiRuntime({ hostManager: manager });
    const databaseToken = 'database-secret-must-not-leak';
    const unrelatedSecret = 'unrelated-secret-must-not-leak';

    await runtime.start('check the MedHelp database connector', {
      identity: {
        ownerKey: 'owner-connector', projectKey: 'project-connector', runtimeId: 'pi', sessionId: 'session-connector',
      },
      projectPath: projectRoot,
      storageOptions: { dataDir: testRoot },
      piProviderEnv: {
        MEDHELP_PI_PROVIDER: 'local-openai-compatible',
        MEDHELP_PI_MODEL: 'test-model',
        MEDHELP_PI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      },
      env: {
        MEDHELP_MANAGED_AGENT_SESSION: '1',
        MEDHELP_DATABASE_API_CONNECTION_STATUS: 'connected',
        MEDHELP_DATABASE_API_URL: 'https://api.medtimehelp.com',
        MEDHELP_DATABASE_API_TOKEN: databaseToken,
        UNRELATED_SECRET: unrelatedSecret,
      },
      turnSnapshot: { permissionMode: 'auto' },
    }, { send: () => {} });

    expect(requests).toHaveLength(2);
    const toolMessage = requests[1].messages.find((message) => message.role === 'tool');
    expect(JSON.stringify(toolMessage)).toContain('connector-ready');
    expect(JSON.stringify(requests)).not.toContain(databaseToken);
    expect(JSON.stringify(requests)).not.toContain(unrelatedSecret);
  }, 20_000);

  it('blocks a model-requested read outside the project before filesystem access', async () => {
    const requests = [];
    upstream = http.createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        requests.push(JSON.parse(body));
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        if (requests.length === 1) {
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-tool',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'test-model',
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: 0,
                  id: 'call-outside',
                  type: 'function',
                  function: { name: 'read', arguments: '{"path":"../secret.txt"}' },
                }],
              },
              finish_reason: null,
            }],
          })}\n\n`);
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-tool',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'test-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
          })}\n\n`);
        } else {
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-final',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'test-model',
            choices: [{ index: 0, delta: { role: 'assistant', content: 'blocked safely' }, finish_reason: null }],
          })}\n\n`);
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-final',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'test-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`);
        }
        response.end('data: [DONE]\n\n');
      });
    });
    const address = await listen(upstream);
    const projectRoot = path.join(testRoot, 'project');
    await fs.mkdir(projectRoot);
    await fs.writeFile(path.join(testRoot, 'secret.txt'), 'must-not-leak');
    manager = createPiHostManager({
      hostPath: path.join(preparedRuntimeRoot, 'sdk-host.mjs'),
      configRoot: path.join(testRoot, 'config'),
      requestTimeoutMs: 10_000,
    });
    const identity = {
      ownerKey: 'owner-boundary',
      projectKey: 'project-boundary',
      runtimeId: 'pi',
      sessionId: 'session-boundary',
    };

    const providerConfig = resolvePiProviderConfig({
      modelProviderId: 'local-openai-compatible',
      modelId: 'test-model',
    }, {
      env: {
        MEDHELP_PI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      },
    });
    await manager.runTurn({
      method: 'prompt',
      prompt: 'read the secret',
      identity,
      sessionKey: 'pi-boundary-session',
      turnId: 'pi-boundary-turn',
      sessionPath: path.join(testRoot, 'session-boundary.jsonl'),
      projectRoot,
      modelId: providerConfig.modelId,
      providerConfig,
    });

    expect(requests).toHaveLength(2);
    const toolMessage = requests[1].messages.find((message) => message.role === 'tool');
    expect(JSON.stringify(toolMessage)).toContain('must stay inside the project');
    expect(JSON.stringify(requests)).not.toContain('must-not-leak');
  }, 15_000);

  it('executes an Ask-mode write only after the renderer approves it', async () => {
    const requests = [];
    upstream = http.createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        requests.push(JSON.parse(body));
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        if (requests.length === 1) {
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-write',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'test-model',
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: 0,
                  id: 'call-write',
                  type: 'function',
                  function: {
                    name: 'write',
                    arguments: '{"path":"approved.md","content":"approved by user\\n"}',
                  },
                }],
              },
              finish_reason: null,
            }],
          })}\n\n`);
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-write',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'test-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
          })}\n\n`);
        } else {
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-write-final',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'test-model',
            choices: [{ index: 0, delta: { role: 'assistant', content: 'write complete' }, finish_reason: null }],
          })}\n\n`);
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-write-final',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'test-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`);
        }
        response.end('data: [DONE]\n\n');
      });
    });
    const address = await listen(upstream);
    const projectRoot = path.join(testRoot, 'project');
    await fs.mkdir(projectRoot);
    manager = createPiHostManager({
      hostPath: path.join(preparedRuntimeRoot, 'sdk-host.mjs'),
      configRoot: path.join(testRoot, 'config'),
      requestTimeoutMs: 15_000,
    });
    const runtime = createPiRuntime({ hostManager: manager });
    const approvalRequests = [];
    const identity = {
      ownerKey: 'owner-write',
      projectKey: 'project-write',
      runtimeId: 'pi',
      sessionId: 'session-write',
    };
    const writer = {
      send: (payload) => {
        if (payload.type !== 'agent-permission-request') return;
        approvalRequests.push(payload);
        queueMicrotask(() => runtime.native.resolveToolApproval(payload.requestId, { allow: true }, {
          ownerKey: identity.ownerKey,
        }));
      },
    };

    await expect(runtime.start('write the approved file', {
      identity,
      projectPath: projectRoot,
      storageOptions: { dataDir: testRoot },
      piProviderEnv: {
        MEDHELP_PI_PROVIDER: 'local-openai-compatible',
        MEDHELP_PI_MODEL: 'test-model',
        MEDHELP_PI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      },
      turnSnapshot: { permissionMode: 'ask' },
    }, writer)).resolves.toMatchObject({ status: 'completed' });

    expect(approvalRequests).toHaveLength(1);
    expect(approvalRequests[0]).toMatchObject({
      toolName: 'Write',
      input: { path: 'approved.md' },
    });
    expect(await fs.readFile(path.join(projectRoot, 'approved.md'), 'utf8'))
      .toBe('approved by user\n');
    expect(requests[0].tools.map((tool) => tool.function.name))
      .toEqual(expect.arrayContaining(['bash', 'edit', 'find', 'grep', 'ls', 'read', 'system_info', 'write']));
  }, 20_000);

  it('loads only explicitly projected skills and keeps project/global Pi discovery disabled', async () => {
    const requests = [];
    let projectedSkillPath = null;
    upstream = http.createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        requests.push(JSON.parse(body));
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        if (requests.length === 1) {
          const systemText = requests[0].messages
            .filter((message) => message.role === 'system')
            .map((message) => message.content)
            .join('\n');
          projectedSkillPath = systemText.match(/<location>([^<]*trusted-analysis\/SKILL\.md)<\/location>/)?.[1] || null;
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-skill',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'test-model',
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: 0,
                  id: 'call-skill-read',
                  type: 'function',
                  function: { name: 'read', arguments: JSON.stringify({ path: projectedSkillPath }) },
                }],
              },
              finish_reason: null,
            }],
          })}\n\n`);
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-skill', object: 'chat.completion.chunk', created: 1, model: 'test-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
          })}\n\n`);
        } else {
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-skill-final', object: 'chat.completion.chunk', created: 1, model: 'test-model',
            choices: [{ index: 0, delta: { role: 'assistant', content: 'skill visible' }, finish_reason: null }],
          })}\n\n`);
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-skill-final', object: 'chat.completion.chunk', created: 1, model: 'test-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`);
        }
        response.end('data: [DONE]\n\n');
      });
    });
    const address = await listen(upstream);
    const projectRoot = path.join(testRoot, 'project');
    const trustedSkillDir = path.join(testRoot, 'trusted-skills', 'trusted-analysis');
    const untrustedSkillDir = path.join(projectRoot, '.pi', 'skills', 'project-injection');
    await Promise.all([
      fs.mkdir(projectRoot, { recursive: true }),
      fs.mkdir(trustedSkillDir, { recursive: true }),
      fs.mkdir(untrustedSkillDir, { recursive: true }),
    ]);
    await fs.writeFile(path.join(trustedSkillDir, 'SKILL.md'), [
      '---',
      'name: trusted-analysis',
      'description: TRUSTED_SKILL_SENTINEL',
      '---',
      '',
      '# Trusted analysis',
      '',
    ].join('\n'));
    await fs.writeFile(path.join(untrustedSkillDir, 'SKILL.md'), [
      '---',
      'name: project-injection',
      'description: UNTRUSTED_SKILL_SENTINEL',
      '---',
      '',
    ].join('\n'));
    manager = createPiHostManager({
      hostPath: path.join(preparedRuntimeRoot, 'sdk-host.mjs'),
      configRoot: path.join(testRoot, 'config'),
      requestTimeoutMs: 10_000,
    });
    const runtime = createPiRuntime({
      hostManager: manager,
      resourceResolver: async () => ({
        skills: [{
          name: 'trusted-analysis',
          source: 'system',
          sourceDir: trustedSkillDir,
          origin: 'system',
        }],
        mcpServers: [],
        diagnostics: { skills: [], mcp: [] },
        secretValues: [],
      }),
    });

    await runtime.start('use trusted instructions', {
      identity: {
        ownerKey: 'owner-skill', projectKey: 'project-skill', runtimeId: 'pi', sessionId: 'session-skill',
      },
      projectPath: projectRoot,
      storageOptions: { dataDir: testRoot },
      piProviderEnv: {
        MEDHELP_PI_PROVIDER: 'local-openai-compatible',
        MEDHELP_PI_MODEL: 'test-model',
        MEDHELP_PI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      },
    });

    expect(requests).toHaveLength(2);
    expect(projectedSkillPath).toContain('trusted-analysis/SKILL.md');
    expect(JSON.stringify(requests[0])).toContain('TRUSTED_SKILL_SENTINEL');
    expect(JSON.stringify(requests[0])).not.toContain('UNTRUSTED_SKILL_SENTINEL');
    expect(JSON.stringify(requests[1].messages)).toContain('# Trusted analysis');
  }, 15_000);

  it('projects an MCP server as an Ask-only tool and executes it after approval', async () => {
    const requests = [];
    upstream = http.createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        requests.push(JSON.parse(body));
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        if (requests.length === 1) {
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-mcp',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'test-model',
            choices: [{
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [{
                  index: 0,
                  id: 'call-mcp',
                  type: 'function',
                  function: { name: 'tool_call', arguments: JSON.stringify({ name: 'mcp__fixture__echo', arguments: { value: 'hello' } }) },
                }],
              },
              finish_reason: null,
            }],
          })}\n\n`);
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-mcp', object: 'chat.completion.chunk', created: 1, model: 'test-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
          })}\n\n`);
        } else {
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-mcp-final', object: 'chat.completion.chunk', created: 1, model: 'test-model',
            choices: [{ index: 0, delta: { role: 'assistant', content: 'mcp complete' }, finish_reason: null }],
          })}\n\n`);
          response.write(`data: ${JSON.stringify({
            id: 'chatcmpl-mcp-final', object: 'chat.completion.chunk', created: 1, model: 'test-model',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`);
        }
        response.end('data: [DONE]\n\n');
      });
    });
    const address = await listen(upstream);
    const projectRoot = path.join(testRoot, 'project');
    await fs.mkdir(projectRoot);
    manager = createPiHostManager({
      hostPath: path.join(preparedRuntimeRoot, 'sdk-host.mjs'),
      configRoot: path.join(testRoot, 'config'),
      requestTimeoutMs: 20_000,
    });
    const fixturePath = fileURLToPath(new URL('./fixtures/pi-mcp-echo-server.mjs', import.meta.url));
    const runtime = createPiRuntime({
      hostManager: manager,
      resourceResolver: async () => ({
        skills: [],
        mcpServers: [{
          name: 'fixture',
          version: '1.0.0',
          server: { type: 'stdio', command: process.execPath, args: [fixturePath], env: {} },
        }],
        diagnostics: { skills: [], mcp: [] },
        secretValues: [],
      }),
    });
    const approvalRequests = [];
    const identity = {
      ownerKey: 'owner-mcp', projectKey: 'project-mcp', runtimeId: 'pi', sessionId: 'session-mcp',
    };
    const writer = {
      send: (payload) => {
        if (payload.type !== 'agent-permission-request') return;
        approvalRequests.push(payload);
        queueMicrotask(() => runtime.native.resolveToolApproval(payload.requestId, { allow: true }, {
          ownerKey: identity.ownerKey,
        }));
      },
    };

    await runtime.start('use the MCP echo tool', {
      identity,
      projectPath: projectRoot,
      storageOptions: { dataDir: testRoot },
      piProviderEnv: {
        MEDHELP_PI_PROVIDER: 'local-openai-compatible',
        MEDHELP_PI_MODEL: 'test-model',
        MEDHELP_PI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
      },
      turnSnapshot: { permissionMode: 'ask' },
    }, writer);

    expect(approvalRequests).toHaveLength(1);
    expect(approvalRequests[0]).toMatchObject({
      toolName: 'mcp__fixture__echo',
      input: { value: 'hello' },
    });
    expect(requests[0].tools.map((tool) => tool.function.name)).not.toContain('mcp__fixture__echo');
    expect(requests[0].tools.map((tool) => tool.function.name)).toContain('tool_call');
    expect(JSON.stringify(requests[1].messages)).toContain('MCP echo: hello');
  }, 25_000);
});
