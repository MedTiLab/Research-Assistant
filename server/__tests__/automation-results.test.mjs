import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentAutomations } from '../agent-runtime/automations.js';
import { readAutomationResult, saveAutomationResult } from '../agent-runtime/automation-results.js';
import { getRuntimeSessionFilePath } from '../utils/storagePaths.js';
import { mutateServiceState, serviceStatePath } from '../agent-runtime/durable-store.js';

let root, context, service, clock, server;
async function transcript(sessionId, messages) {
  const file = getRuntimeSessionFilePath({ ...context.identity, sessionId }, context.storageOptions);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, messages.map((message) => JSON.stringify({ type: 'message', message })).join('\n') + '\n');
  return file;
}
const assistant = (text) => ({ role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' });
const create = () => service.execute('automation_create', { title: 'Weekly report', prompt: 'Read and report', at: '2030-01-02T00:00:00Z', interval_minutes: 60 }, context);
const act = (name, task, extra = {}, scope = context) => service.execute(name, { automation_id: task.id, ...extra }, scope);
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-automation-results-'));
  context = { identity: { ownerKey: '1', projectKey: 'project', runtimeId: 'pi', sessionId: 'settings' }, userId: 1, storageOptions: { dataDir: root } };
  clock = Date.parse('2030-01-01T00:00:00Z');
  service = createAgentAutomations({ now: () => clock, storageOptions: context.storageOptions, run: async (record) => {
    await transcript(record.lastSessionId, [{ role: 'user', content: 'Read and report' }, assistant(`# Report ${record.lastRunAt}`)]);
  } });
});
afterEach(async () => {
  service.stop();
  if (server) await new Promise((resolve) => server.close(resolve));
  server = null;
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});

describe('automation result delivery', () => {
  it('persists the selected background mode and rejects modes requiring user interaction', async () => {
    const task = await create();
    expect(task.permissionMode).toBe('readOnly');
    expect((await act('automation_update', task, { permission_mode: 'auto' })).permissionMode).toBe('auto');
    for (const mode of ['ask', 'plan', 'bypassPermissions']) {
      await expect(act('automation_update', task, { permission_mode: mode })).rejects.toThrow('Background automations support');
    }
    await act('automation_run', task);
    await vi.waitFor(async () => expect((await act('automation_runs', task))[0]).toMatchObject({ status: 'completed', permissionMode: 'auto' }));
    const restored = createAgentAutomations({ storageOptions: context.storageOptions });
    expect((await restored.execute('automation_list', {}, context))[0].permissionMode).toBe('auto');
  });

  it('retains each run, delivers unread results, and acknowledges only the selected run', async () => {
    const task = await create();
    await act('automation_run', task);
    await vi.waitFor(async () => expect((await act('automation_runs', task))[0]?.status).toBe('completed'));
    clock += 61 * 60000;
    await service.tick();
    await vi.waitFor(async () => expect((await act('automation_runs', task))).toMatchObject([{ status: 'completed' }, { status: 'completed' }]));
    const runs = await act('automation_runs', task);
    expect(new Set(runs.map((run) => run.sessionId)).size).toBe(2);
    expect(await service.inbox('1')).toHaveLength(2);
    expect(await service.inbox('2')).toEqual([]);
    const result = await act('automation_result', task, { session_id: runs[1].sessionId });
    expect(result.markdown).toContain('# Report');
    await act('automation_ack', task, { session_id: runs[1].sessionId });
    expect((await service.inbox('1')).map((run) => run.sessionId)).toEqual([runs[0].sessionId]);
    const restored = createAgentAutomations({ storageOptions: context.storageOptions });
    expect((await restored.execute('automation_runs', { automation_id: task.id }, context))).toHaveLength(2);
    expect(await restored.inbox('1')).toHaveLength(1);
  });

  it('freezes the report so follow-up conversation does not replace it', async () => {
    const task = await create();
    await act('automation_run', task);
    await vi.waitFor(async () => expect((await act('automation_runs', task))[0]?.status).toBe('completed'));
    const run = (await act('automation_runs', task))[0];
    const original = await act('automation_result', task, { session_id: run.sessionId });
    const file = getRuntimeSessionFilePath({ ...context.identity, sessionId: run.sessionId }, context.storageOptions);
    await fs.appendFile(file, JSON.stringify({ type: 'message', message: assistant('A later chat reply') }) + '\n');
    expect((await act('automation_result', task, { session_id: run.sessionId })).markdown).toBe(original.markdown);
    expect((await readAutomationResult({ ...context.identity, sessionId: run.sessionId }, { ...context.storageOptions, live: true })).markdown).toBe('A later chat reply');
  });

  it('recovers a legacy latest run and enforces owner, project and run scope', async () => {
    const task = await create();
    await transcript('old-run', [assistant('Legacy report')]);
    await mutateServiceState(serviceStatePath(context.identity, 'automations', context.storageOptions), (rows) => rows.map((row) => ({ ...row, lastSessionId: 'old-run', lastRunAt: '2029-12-31T00:00:00Z', lastStatus: 'completed' })));
    expect((await act('automation_runs', task))[0].sessionId).toBe('old-run');
    expect((await act('automation_result', task, { session_id: 'old-run' })).markdown).toBe('Legacy report');
    for (const identity of [{ ...context.identity, ownerKey: '2' }, { ...context.identity, projectKey: 'other' }]) {
      await expect(act('automation_result', task, { session_id: 'old-run' }, { ...context, identity })).rejects.toThrow('not found');
      await expect(act('automation_ack', task, { session_id: 'old-run' }, { ...context, identity })).rejects.toThrow('not found');
    }
    await expect(act('automation_result', task, { session_id: 'unrelated-session' })).rejects.toThrow('run not found');
    await act('automation_ack', task, { session_id: 'old-run' });
    expect(await service.inbox('1')).toEqual([]);
  });

  it('shows tool errors as limitations and does not mistake a tool-step preamble for a final report', async () => {
    const identity = { ...context.identity, sessionId: 'warnings' };
    await transcript('warnings', [
      { role: 'assistant', content: [{ type: 'text', text: 'I will run a search' }, { type: 'toolCall', name: 'search' }], stopReason: 'toolUse' },
      { role: 'toolResult', toolName: 'search', isError: true, content: [{ type: 'text', text: 'Source unavailable' }] },
    ]);
    const result = await readAutomationResult(identity, context.storageOptions);
    expect(result.markdown).toBe('');
    expect(result.warnings).toEqual([{ tool: 'search', message: 'Source unavailable' }]);
    await saveAutomationResult(identity, result, context.storageOptions);
    await saveAutomationResult(identity, { ...result, markdown: 'Must not replace' }, context.storageOptions);
    expect((await readAutomationResult(identity, context.storageOptions)).markdown).toBe('');
  });

  it('records failures and interrupted runs as unread instead of losing them', async () => {
    service.stop();
    service = createAgentAutomations({ now: () => clock, storageOptions: context.storageOptions, run: async () => { throw new Error('Provider unavailable'); } });
    const task = await create();
    await act('automation_run', task);
    await vi.waitFor(async () => expect((await service.inbox('1'))[0]).toMatchObject({ status: 'failed', error: 'Provider unavailable' }));
    await mutateServiceState(serviceStatePath(context.identity, 'automations', context.storageOptions), (rows) => rows.map((row) => ({ ...row, status: 'paused', lastStatus: 'running', lastSessionId: 'interrupted-run', lastRunAt: new Date(clock).toISOString() })));
    await service.tick();
    expect((await service.inbox('1')).map((run) => run.status)).toContain('interrupted');
  });

  it('serves result APIs and runs session indexing only within the authenticated owner scope', async () => {
    vi.stubEnv('DATABASE_PATH', path.join(root, 'api.db'));
    vi.stubEnv('MEDHELP_DATA_DIR', root);
    const { createAgentServicesRouter } = await import('../routes/agent-services.js');
    const indexRun = vi.fn(async () => {});
    const app = express();
    app.use((req, _res, next) => { req.user = req.headers['x-test-owner'] ? { id: req.headers['x-test-owner'] } : null; next(); });
    app.use('/api/agent-services', createAgentServicesRouter({ services: { automations: service }, storageOptions: context.storageOptions, indexRun }));
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/agent-services/automations`;
    const task = await create();
    await act('automation_run', task);
    await vi.waitFor(async () => expect((await act('automation_runs', task))[0]?.status).toBe('completed'));
    const run = (await act('automation_runs', task))[0];
    expect((await fetch(`${base}/inbox`)).status).toBe(401);
    expect(await (await fetch(`${base}/inbox`, { headers: { 'x-test-owner': '2' } })).json()).toEqual([]);
    expect(indexRun).not.toHaveBeenCalled();
    const url = `${base}/${task.id}/runs/${run.sessionId}?projectKey=project`;
    expect((await fetch(url, { headers: { 'x-test-owner': '2' } })).status).toBe(400);
    const result = await fetch(url, { headers: { 'x-test-owner': '1' } });
    expect(result.status).toBe(200);
    expect((await result.json()).markdown).toContain('# Report');
    expect(indexRun).toHaveBeenCalledOnce();
  });
});
