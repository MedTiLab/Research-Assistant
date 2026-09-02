import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentTerminalSessions } from '../agent-runtime/terminal-sessions.js';
import { createLocalMemoryAdapter } from '../agent-runtime/local-memory.js';
import { createAgentAutomations, listAutomationWork } from '../agent-runtime/automations.js';
import { addPermissionPresets, hasPermissionRule, rememberPermissionRule } from '../agent-runtime/permission-rules.js';
import { serviceStatePath, readServiceState, mutateServiceState } from '../agent-runtime/durable-store.js';
import { createAgentServicesRouter } from '../routes/agent-services.js';
import { authorizePiToolCall } from '../pi-runtime/tool-policy.js';
import { PI_PERMISSION_PRESETS } from '../../shared/piPermissionPresets.js';
import { authorizeServiceTool, AGENT_SERVICE_TOOLS } from '../agent-runtime/service-tools.js';
import { isPublicAddress, resolvePublicUrl } from '../agent-runtime/public-web.js';
import { createAgentToolServices } from '../agent-runtime/tool-services.js';

let root;
let context;
const cleanups = [];
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-services-'));
  context = { identity: { ownerKey: 'owner', projectKey: 'project', sessionId: 'session', runtimeId: 'pi' }, userId: 1, projectRoot: root, storageOptions: { dataDir: root }, permissionMode: 'ask', model: { modelId: 'fixture' } };
});
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); await fs.rm(root, { recursive: true, force: true }); });

describe('Agent services policy and persistence', () => {
  it('blocks every mutating service in Plan and readOnly, including hidden gateway targets', () => {
    for (const tool of AGENT_SERVICE_TOOLS) {
      for (const mode of ['plan', 'readOnly']) {
        if (tool.mutation) expect(() => authorizeServiceTool(tool.name, {}, mode)).toThrow();
        else expect(authorizeServiceTool(tool.name, {}, mode).allowed).toBe(true);
      }
    }
  });
  it('remembers exact inputs, not frontend wildcard rules, isolated by owner and project', async () => {
    const input = { command: 'git status', timeout: 10 };
    await rememberPermissionRule(context.identity, 'bash', input, context.storageOptions);
    expect(await hasPermissionRule(context.identity, 'bash', { timeout: 10, command: 'git status' }, context.storageOptions)).toBe(true);
    expect(await hasPermissionRule(context.identity, 'bash', { command: 'git push', timeout: 10 }, context.storageOptions)).toBe(false);
    expect(await hasPermissionRule({ ...context.identity, ownerKey: 'other' }, 'bash', input, context.storageOptions)).toBe(false);
    expect(await hasPermissionRule({ ...context.identity, projectKey: 'other' }, 'bash', input, context.storageOptions)).toBe(false);
    expect(await fs.readFile(serviceStatePath(context.identity, 'permissions', context.storageOptions), 'utf8')).not.toContain('git status');
    await rememberPermissionRule(context.identity, 'exit_plan_mode', {}, context.storageOptions);
    expect(await hasPermissionRule(context.identity, 'exit_plan_mode', {}, context.storageOptions)).toBe(false);
  });
  it('adds common commands without widening exact command or project boundaries', async () => {
    const ids = PI_PERMISSION_PRESETS.map((preset) => preset.id);
    expect(await addPermissionPresets(context.identity, ids, context.storageOptions)).toEqual({ addedCount: ids.length });
    const rules = await readServiceState(serviceStatePath(context.identity, 'permissions', context.storageOptions));
    expect(await addPermissionPresets(context.identity, ids, context.storageOptions)).toEqual({ addedCount: 0 });
    expect(await readServiceState(serviceStatePath(context.identity, 'permissions', context.storageOptions))).toEqual(rules);
    for (const preset of PI_PERMISSION_PRESETS) {
      const authorization = await authorizePiToolCall('bash', { command: preset.command, timeout: 1000 }, context);
      expect(authorization.requiresApproval).toBe(true);
      expect(await hasPermissionRule(context.identity, 'bash', authorization.input, context.storageOptions)).toBe(true);
    }
    for (const command of ['git status --short', 'git status; git push', 'git status\nrm file', 'git status && whoami', 'git push', 'git status > output.txt', 'git status $(whoami)']) {
      expect(await hasPermissionRule(context.identity, 'bash', { command }, context.storageOptions)).toBe(false);
    }
    for (const input of [{ command: 'git status', cwd: '/elsewhere' }, { command: 'git status', timeout: -1 }, { command: 'git status', timeout: '1000' }]) {
      expect(await hasPermissionRule(context.identity, 'bash', input, context.storageOptions)).toBe(false);
    }
    expect(await hasPermissionRule(context.identity, 'terminal_open', { command: 'git status' }, context.storageOptions)).toBe(false);
    for (const identity of [{ ...context.identity, ownerKey: 'other' }, { ...context.identity, projectKey: 'other' }]) {
      expect(await hasPermissionRule(identity, 'bash', { command: 'git status' }, context.storageOptions)).toBe(false);
    }
    for (const permissionMode of ['plan', 'readOnly']) {
      await expect(authorizePiToolCall('bash', { command: 'git status' }, { ...context, permissionMode })).rejects.toThrow();
    }
  });
  it('rejects invalid batches atomically and does not evict existing permissions at the limit', async () => {
    for (const ids of [[], ['git-status', '*'], ['bash'], 'git-status', [null]]) {
      await expect(addPermissionPresets(context.identity, ids, context.storageOptions)).rejects.toThrow('valid');
    }
    const file = serviceStatePath(context.identity, 'permissions', context.storageOptions);
    expect(await readServiceState(file)).toEqual([]);
    const existing = Array.from({ length: 200 }, (_, i) => ({ id: `existing-${i}`, tool: 'write', fingerprint: `digest-${i}` }));
    await mutateServiceState(file, () => existing);
    await expect(addPermissionPresets(context.identity, ['git-status'], context.storageOptions)).rejects.toThrow('limit');
    expect(await readServiceState(file)).toEqual(existing);
  });
  it('supports project-scoped batch add, reload and revoke through the settings API', async () => {
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: context.identity.ownerKey }; next(); });
    app.use(createAgentServicesRouter({ services: {}, storageOptions: context.storageOptions }));
    const server = app.listen(0, '127.0.0.1');
    cleanups.push(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (suffix, method = 'GET', body, project = 'project') => fetch(`${base}/permissions${suffix}?projectKey=${project}`, {
      method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    expect((await request('/presets', 'POST', { presetIds: ['git-status'] }, '')).status).toBe(400);
    expect((await request('/presets', 'POST', { presetIds: ['git-status', '*'] })).status).toBe(400);
    expect(await (await request('')).json()).toEqual([]);
    const results = await Promise.all([
      request('/presets', 'POST', { presetIds: ['git-status', 'git-diff'] }).then((response) => response.json()),
      request('/presets', 'POST', { presetIds: ['git-status'] }).then((response) => response.json()),
    ]);
    expect(results.reduce((sum, result) => sum + result.addedCount, 0)).toBe(2);
    const entries = await (await request('')).json();
    expect(entries.map((entry) => entry.presetId).sort()).toEqual(['git-diff', 'git-status']);
    expect(await (await request('', 'GET', undefined, 'other')).json()).toEqual([]);
    const statusRule = entries.find((entry) => entry.presetId === 'git-status');
    await request(`/${statusRule.id}`, 'DELETE', undefined, 'other');
    expect(await hasPermissionRule(context.identity, 'bash', { command: 'git status' }, context.storageOptions)).toBe(true);
    expect((await request(`/${statusRule.id}`, 'DELETE')).status).toBe(200);
    expect(await hasPermissionRule(context.identity, 'bash', { command: 'git status' }, context.storageOptions)).toBe(false);
    expect((await (await request('')).json()).map((entry) => entry.presetId)).toEqual(['git-diff']);
  });
  it('reuses existing memories, separates recall from explicit saves, and honors project boundaries', async () => {
    await fs.mkdir(path.join(root, '.medhelpsec'), { recursive: true });
    await fs.writeFile(path.join(root, '.medhelpsec', 'MEMORY.md'), '# Existing\nKeep this remembered fact.\n');
    const db = { getSettings: vi.fn(() => ({ enabled: true, autoCaptureEnabled: true })), getAll: vi.fn(() => [{ id: 7, content: 'Existing memory', source: 'automatic' }]), create: vi.fn(() => ({ memory: { id: 8 } })) };
    const memory = createLocalMemoryAdapter({ getDb: async () => db, authorize: async () => true });
    expect(await memory.execute('memory_retrieve', {}, context)).toMatchObject({ memories: [{ id: 7 }], projectMemory: expect.stringContaining('Keep this') });
    expect(db.getAll).toHaveBeenCalledWith(1, { limit: 300 });
    await memory.execute('remember', { content: 'User requested this fact', scope: 'project' }, context);
    expect(await fs.readFile(path.join(root, '.medhelpsec', 'MEMORY.md'), 'utf8')).toContain('Keep this remembered fact');
    expect(await fs.readFile(path.join(root, '.medhelpsec', 'MEMORY.md'), 'utf8')).toContain('User requested this fact');
    db.getSettings.mockReturnValue({ enabled: false, autoCaptureEnabled: true });
    expect(await memory.execute('memory_retrieve', {}, context)).toMatchObject({ enabled: false });
    expect(await memory.execute('remember', { content: 'Explicitly saved', scope: 'user' }, context)).toMatchObject({ memory: { id: 8 } });
    expect(db.create).toHaveBeenCalledWith(1, 'Explicitly saved', { source: 'manual' });
  });
  it('rejects memory symlinks outside the project', async () => {
    const project = path.join(root, 'project'); await fs.mkdir(project);
    await fs.writeFile(path.join(root, 'outside.md'), 'private');
    await fs.mkdir(path.join(project, '.medhelpsec'));
    await fs.symlink(path.join(root, 'outside.md'), path.join(project, '.medhelpsec', 'MEMORY.md'));
    const memory = createLocalMemoryAdapter({ getDb: async () => ({ getSettings: () => ({ enabled: true }), getAll: () => [] }), authorize: async () => true });
    await expect(memory.execute('memory_retrieve', {}, { ...context, projectRoot: project })).rejects.toThrow('outside');
  });
  it('uses the paired account memory context without opening a separate local database', async () => {
    const getDb = vi.fn(() => { throw new Error('must not fork user memory'); });
    const saveUserMemory = vi.fn(async (content) => ({ id: 4, content, source: 'manual' }));
    const memory = createLocalMemoryAdapter({ getDb, authorize: async () => true });
    const paired = { ...context, userId: null, memoryContext: { enabled: true, autoCaptureEnabled: true, memories: [{ id: 1, content: 'Existing account memory', source: 'automatic' }] }, saveUserMemory };
    expect((await memory.execute('memory_retrieve', {}, paired)).memories).toEqual([expect.objectContaining({ id: 1 })]);
    await memory.execute('remember', { scope: 'user', content: 'Keep in existing account' }, paired);
    expect(saveUserMemory).toHaveBeenCalledWith('Keep in existing account');
    expect(getDb).not.toHaveBeenCalled();
  });
  it('runs an actual PTY across reads and writes and preserves history without restarting on recovery', async () => {
    const sessions = new Map();
    const terminal = createAgentTerminalSessions({ sessions }); cleanups.push(() => terminal.shutdown());
    const started = await terminal.execute('terminal_open', { command: 'read value; printf "PTY:%s" "$value"' }, context);
    expect(started.status).toBe('running');
    await expect(terminal.execute('terminal_read', { terminal_id: started.id }, { ...context, identity: { ...context.identity, sessionId: 'different' } })).rejects.toThrow('not found');
    await terminal.execute('terminal_write', { terminal_id: started.id, input: 'hello\n' }, context);
    await vi.waitFor(async () => {
      const output = await terminal.execute('terminal_read', { terminal_id: started.id }, context);
      expect(output.output).toContain('PTY:hello'); expect(output.status).toBe('exited');
    });
    const recovered = createAgentTerminalSessions({ sessions: new Map(), spawn: () => { throw new Error('must not restart'); } });
    expect((await recovered.execute('terminal_read', { terminal_id: started.id }, context)).output).toContain('PTY:hello');
  });
  it('registers project artifacts and refuses path escapes', async () => {
    const services = createAgentToolServices(); cleanups.push(() => services.shutdown());
    const file = path.join(root, 'result.txt'); await fs.writeFile(file, 'result');
    expect(await services.execute('artifact_publish', { path: 'result.txt' }, context)).toMatchObject({ artifact: { path: 'result.txt', size: 6 } });
    await expect(services.execute('artifact_publish', { path: '../secret.txt' }, context)).rejects.toThrow('inside');
  });
});

describe('durable automations', () => {
  it('claims once, persists next run, resumes from disk and exposes Scheduled work', async () => {
    let clock = Date.parse('2030-01-01T00:00:00Z');
    const run = vi.fn(async () => {});
    const service = createAgentAutomations({ run, now: () => clock, storageOptions: context.storageOptions });
    cleanups.push(() => service.stop());
    const record = await service.execute('automation_create', { title: 'Check', prompt: 'Read status', at: '2030-01-01T00:01:00Z', interval_minutes: 5 }, context);
    expect(await listAutomationWork(context.identity, context.storageOptions)).toEqual([expect.objectContaining({ id: record.id, status: 'scheduled' })]);
    clock += 60_000;
    await Promise.all([service.tick(), service.tick()]);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => expect((await service.execute('automation_list', {}, context))[0].lastStatus).toBe('completed'));
    const restored = createAgentAutomations({ run, now: () => clock, storageOptions: context.storageOptions });
    cleanups.push(() => restored.stop());
    await restored.tick(); expect(run).toHaveBeenCalledTimes(1);
    expect((await restored.execute('automation_list', {}, context))[0].nextRunAt).toBe('2030-01-01T00:06:00.000Z');
    await restored.execute('automation_update', { automation_id: record.id, status: 'paused' }, context);
    clock += 600_000; await restored.tick(); expect(run).toHaveBeenCalledTimes(1);
    expect(await readServiceState(serviceStatePath(context.identity, 'automations', context.storageOptions))).toHaveLength(1);
  });
  it('validates explicit times and disallows cross-owner updates', async () => {
    const service = createAgentAutomations({ now: () => 1 });
    await expect(service.execute('automation_create', { title: 't', prompt: 'p', at: '2030-01-01 12:00' }, context)).rejects.toThrow('ISO');
    const task = await service.execute('automation_create', { title: 't', prompt: 'p', at: '2030-01-01T00:00:00Z' }, context);
    await expect(service.execute('automation_update', { automation_id: task.id, status: 'cancelled' }, { ...context, identity: { ...context.identity, ownerKey: 'other' } })).rejects.toThrow('not found');
  });
  it('supports manual runs, renames and guarded deletion', async () => {
    let clock = Date.parse('2030-01-01T00:00:00Z');
    const run = vi.fn(async () => {});
    const service = createAgentAutomations({ run, now: () => clock, storageOptions: context.storageOptions });
    cleanups.push(() => service.stop());
    const initialModel = { modelId: 'provider/alpha', modelProviderId: 'byok-openai-compatible', modelApi: 'openai-completions' };
    const nextModel = { modelId: 'provider/beta', modelProviderId: 'byok-openai-compatible', modelApi: 'openai-completions' };
    const task = await service.execute('automation_create', { title: 'Draft', prompt: 'Build report', at: '2030-01-02T00:00:00Z', interval_minutes: 60, model: initialModel }, context);
    expect(task.model).toEqual(initialModel);
    expect(await service.execute('automation_update', {
      automation_id: task.id,
      title: 'Weekly report',
      prompt: 'Build the revised report',
      at: '2030-01-03T08:30:00Z',
      interval_minutes: 10080,
      model: nextModel,
    }, context)).toMatchObject({
      title: 'Weekly report',
      prompt: 'Build the revised report',
      nextRunAt: '2030-01-03T08:30:00.000Z',
      intervalMinutes: 10080,
      model: nextModel,
      status: 'active',
    });
    await service.execute('automation_run', { automation_id: task.id }, context);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    await expect(service.execute('automation_delete', { automation_id: task.id }, context)).rejects.toThrow('Cancel');
    await service.execute('automation_update', { automation_id: task.id, status: 'cancelled' }, context);
    expect(await service.execute('automation_delete', { automation_id: task.id }, context)).toEqual({ success: true });
    expect(await service.execute('automation_list', {}, context)).toEqual([]);
  });
});

describe('public network boundary', () => {
  it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '100.64.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2002:7f00:1::'])('rejects private or transition address %s', (value) => expect(isPublicAddress(value)).toBe(false));
  it('rejects mixed DNS answers and credential-bearing URLs before network access', async () => {
    await expect(resolvePublicUrl('https://public.example', async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }])).rejects.toThrow('blocked');
    await expect(resolvePublicUrl('https://user:pass@example.com')).rejects.toThrow('credentials');
    await expect(resolvePublicUrl('file:///tmp/private')).rejects.toThrow('HTTP');
    expect((await resolvePublicUrl('https://public.example', async () => [{ address: '8.8.8.8', family: 4 }])).address.address).toBe('8.8.8.8');
  });
});
