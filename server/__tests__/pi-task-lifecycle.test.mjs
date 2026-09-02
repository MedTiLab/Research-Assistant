import http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPiRuntime } from '../agent-runtime/pi-runtime.js';
import { createPiHostManager } from '../pi-runtime/host-manager.js';
import { readAgentRuntimeState, updateAgentRuntimeTask } from '../agent-runtime/state-store.js';
import { createPiHostSessionStore } from '../pi-runtime/session-store.js';

const runtimeRoot = process.env.MEDHELP_PI_TEST_RUNTIME_ROOT;
const suite = runtimeRoot ? describe : describe.skip;
let root, server, runtime, options;
const identity = { ownerKey: 'lifecycle-test', projectKey: 'project', runtimeId: 'pi', sessionId: 'parent' };
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-task-lifecycle-')); await fs.writeFile(path.join(root, 'note.txt'), 'child input'); });
afterEach(async () => {
  await runtime?.native.shutdown();
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  await fs.rm(root, { recursive: true, force: true }); runtime = null; server = null;
});

function reply(response, tool, text = 'Done') {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: tool.id || 'call', type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.input) } }] } : { role: 'assistant', content: text };
  for (const choice of [{ index: 0, delta, finish_reason: null }, { index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }]) response.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [choice] })}\n\n`);
  response.end('data: [DONE]\n\n');
}
async function setup(handler) {
  server = http.createServer((request, response) => {
    let body = ''; request.setEncoding('utf8'); request.on('data', (chunk) => body += chunk);
    request.on('end', () => handler(JSON.parse(body), response));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  runtime = createPiRuntime({ hostManager: createPiHostManager({ hostPath: path.join(runtimeRoot, 'sdk-host.mjs'), configRoot: path.join(root, 'config') }), resourceResolver: async () => ({ skills: [], mcpServers: [] }) });
  options = { identity, projectPath: root, storageOptions: { dataDir: root }, permissionMode: 'readOnly', piProviderEnv: { MEDHELP_PI_PROVIDER: 'local-openai-compatible', MEDHELP_PI_MODEL: 'test-model', MEDHELP_PI_BASE_URL: `http://127.0.0.1:${server.address().port}/v1` } };
}
const delegate = { id: 'delegate', name: 'task', input: { description: 'Inspect note', prompt: 'Read note.txt' } };
const readState = () => readAgentRuntimeState(identity, options.storageOptions);

suite('Pi task lifecycle', () => {
  it.each(['explore', 'research'])('waits for a foreground %s subagent and exposes only its read-only profile', async (type) => {
    let childTools, parentResult, taskSchema;
    await setup((payload, response) => {
      if (JSON.stringify(payload.messages).includes('<background_agent_task>')) {
        childTools = payload.tools.map((tool) => tool.function.name);
        reply(response, null, `Foreground ${type} evidence`);
      } else if (!payload.messages.some((message) => message.role === 'tool')) { taskSchema = payload.tools.find((tool) => tool.function.name === 'task').function; reply(response, { ...delegate, input: { ...delegate.input, subagent_type: type, run_in_background: false } }); }
      else { parentResult = payload.messages.find((message) => message.role === 'tool').content; reply(response); }
    });
    await runtime.start('Wait for evidence', options);
    expect(parentResult).toContain(`Foreground ${type} evidence`);
    expect((await readState()).tasks[0]).toMatchObject({ background: false, status: 'completed', subagentType: type });
    expect(childTools).not.toEqual(expect.arrayContaining(['write', 'bash', 'task', 'ask_user', 'exit_plan_mode']));
    expect(childTools.includes('grep')).toBe(type === 'explore');
    expect(childTools.includes('tool_search')).toBe(type === 'research');
    expect(taskSchema.description).toContain('180 seconds');
    expect(taskSchema.parameters.properties.timeout_ms.description).toContain('180000');
  }, 15000);

  it('returns timed-out research partial results with a full cache file and an incomplete error status', async () => {
    const partial = 'PARTIAL_EVIDENCE '.repeat(5000);
    let parentResult;
    await setup((payload, response) => {
      if (JSON.stringify(payload.messages).includes('<background_agent_task>')) {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write(`data: ${JSON.stringify({ id: 'partial', object: 'chat.completion.chunk', model: 'test-model', choices: [{ index: 0, delta: { role: 'assistant', content: partial }, finish_reason: null }] })}\n\n`);
      } else if (!payload.messages.some((message) => message.role === 'tool')) reply(response, { ...delegate, input: { ...delegate.input, subagent_type: 'research', run_in_background: false, timeout_ms: 1000 } });
      else { parentResult = payload.messages.find((message) => message.role === 'tool').content; reply(response); }
    });
    await runtime.start('Find evidence with deadline', options);
    const task = (await readState()).tasks[0];
    expect(task).toMatchObject({ status: 'interrupted', error: { code: 'PI_SUBAGENT_TIMEOUT' } });
    expect(parentResult).toContain('Partial results (incomplete)');
    expect(parentResult).toContain('PARTIAL_EVIDENCE');
    const file = task.result.match(/Full content: (.+?)\. Use read/)[1];
    expect(await fs.readFile(file, 'utf8')).toBe(partial);
    expect(runtime.getActiveSessions()).toHaveLength(0);
  }, 15000);

  it.each(['timeout', 'cancel'])('ends a foreground child cleanly on %s', async (action) => {
    let childStarted = false;
    await setup((payload, response) => {
      if (JSON.stringify(payload.messages).includes('<background_agent_task>')) childStarted = true;
      else if (!payload.messages.some((message) => message.role === 'tool')) reply(response, { ...delegate, input: { ...delegate.input, run_in_background: false, timeout_ms: action === 'timeout' ? 1000 : 10000 } });
      else reply(response);
    });
    const controller = new AbortController();
    const parent = runtime.start('Wait', { ...options, signal: controller.signal }).catch((error) => error);
    await vi.waitFor(() => expect(childStarted).toBe(true), { timeout: 6000 });
    if (action === 'cancel') controller.abort();
    await parent;
    await vi.waitFor(async () => expect((await readState()).tasks[0].status).toBe(action === 'timeout' ? 'interrupted' : 'cancelled'), { timeout: 6000 });
    expect(runtime.getActiveSessions()).toHaveLength(0);
  }, 15000);
  it('preserves a large foreground result in a readable project file', async () => {
    const evidence = `${'Long evidence. '.repeat(7000)}FINAL_SENTINEL`;
    let parentResult;
    await setup((payload, response) => {
      if (JSON.stringify(payload.messages).includes('<background_agent_task>')) reply(response, null, evidence);
      else if (!payload.messages.some((message) => message.role === 'tool')) reply(response, { ...delegate, input: { ...delegate.input, run_in_background: false } });
      else { parentResult = payload.messages.find((message) => message.role === 'tool').content; reply(response); }
    });
    await runtime.start('Read all evidence', options);
    expect(parentResult).toContain('Subagent output truncated');
    const task = (await readState()).tasks[0];
    expect(task.status).toBe('completed');
    const file = task.result.match(/Full content: (.+?)\. Use read/)[1];
    expect(file.startsWith(`${await fs.realpath(root)}/.medhelpsec/tool-output/`)).toBe(true);
    expect(await fs.readFile(file, 'utf8')).toBe(evidence);
  }, 15000);
  it('returns child results and trace while the parent is still running, including task_get', async () => {
    let releaseParent, finalParentPayload, settled = false;
    await setup((payload, response) => {
      const tools = payload.messages.filter((message) => message.role === 'tool');
      if (JSON.stringify(payload.messages).includes('<background_agent_task>')) {
        if (!tools.length) reply(response, { id: 'read-child', name: 'read', input: { path: 'note.txt' } });
        else reply(response, null, 'background result');
      } else if (!tools.length) reply(response, delegate);
      else if (tools.length === 1) releaseParent = (taskId) => reply(response, { id: 'get-child', name: 'task_get', input: { task_id: taskId } });
      else { finalParentPayload = payload; reply(response); }
    });
    const events = [];
    const parent = runtime.start('Inspect', options, { send: (event) => events.push(event) }).finally(() => settled = true);
    let state;
    try {
      await vi.waitFor(async () => { state = await readState(); expect(state.tasks[0]?.status).toBe('completed'); expect(releaseParent).toBeTypeOf('function'); }, { timeout: 8000 });
      expect(settled).toBe(false);
      expect(state.tasks[0]).toMatchObject({ result: 'background result', childTools: [{ toolName: 'Read', toolResult: { isError: false } }] });
      expect(state.tasks[0].childTools[0].toolResult.content).toContain('child input');
      await expect(runtime.native.compact(identity, options)).rejects.toMatchObject({ code: 'AGENT_TURN_ALREADY_ACTIVE' });
      await expect(runtime.native.changeBranch(identity, 'switch', { branchId: 'main' }, options)).rejects.toMatchObject({ code: 'AGENT_TURN_ALREADY_ACTIVE' });
      releaseParent(state.tasks[0].id); releaseParent = null;
      await parent;
      expect(JSON.stringify(finalParentPayload.messages)).toContain('background result');
      expect(events.some((event) => event.data?.event === 'agent_state_requested')).toBe(false);
      const transcript = await createPiHostSessionStore(options.storageOptions).read(identity);
      expect(transcript.messages.find((message) => message.toolCallId === 'delegate' && message.type === 'tool_result').subagentTools).toHaveLength(1);
    } finally { releaseParent?.(state?.tasks[0]?.id || 'missing'); await parent.catch(() => {}); }
  }, 20000);

  it('cancels a live child, retries in a new read-only session, and rejects duplicate retries', async () => {
    let childStarted = false, holdChild = true;
    await setup((payload, response) => {
      if (JSON.stringify(payload.messages).includes('<background_agent_task>')) {
        childStarted = true;
        if (!holdChild) reply(response, null, 'retry result');
      } else if (!payload.messages.some((message) => message.role === 'tool')) reply(response, delegate);
      else reply(response);
    });
    await runtime.start('Inspect', options);
    await vi.waitFor(() => expect(childStarted).toBe(true), { timeout: 6000 });
    const task = (await readState()).tasks[0];
    const cancelled = await runtime.native.cancelTask(identity, task.id, options);
    expect(cancelled.status).toBe('cancelled');
    holdChild = false;
    await runtime.native.retryTask(identity, task.id, options);
    await expect(runtime.native.retryTask(identity, task.id, options)).rejects.toBeTruthy();
    await vi.waitFor(async () => expect((await readState()).tasks[0]).toMatchObject({ status: 'completed', result: 'retry result' }), { timeout: 6000 });
    const retried = (await readState()).tasks[0];
    expect(retried.childSessionId).not.toBe(task.childSessionId);
    await expect(runtime.native.cancelTask({ ...identity, ownerKey: 'other' }, task.id, options)).rejects.toMatchObject({ code: 'PI_TASK_NOT_FOUND' });
    const child = await createPiHostSessionStore(options.storageOptions).read({ ...identity, sessionId: retried.childSessionId });
    expect(JSON.stringify(child.messages)).toContain('retry result');
  }, 20000);

  it('recovers stale tasks as interrupted rather than silently restarting them', async () => {
    await setup((payload, response) => reply(response));
    await updateAgentRuntimeTask(identity, 'old-child', { title: 'Old child', status: 'running', background: true, description: 'read only', childSessionId: 'old-session' }, options.storageOptions);
    expect((await runtime.native.sessionState(identity, options)).tasks[0].status).toBe('interrupted');
    expect((await runtime.native.sessionState(identity, options)).tasks[0].status).toBe('interrupted');
  });
});
