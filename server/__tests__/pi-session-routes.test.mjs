import express from 'express';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPiSessionsRouter, createPiSessionProjectResolver } from '../routes/pi-sessions.js';
import { resolvePiSessionPath } from '../pi-runtime/session-store.js';
import { mutateAgentRuntimeState } from '../agent-runtime/state-store.js';
import { piRuntime } from '../agent-runtime/pi-runtime.js';

let root, server, base, runtime, getProject, validatePath, resolveDirectory;
const identity = { ownerKey: '1', projectKey: 'project', runtimeId: 'pi', sessionId: 'saved' };
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-session-routes-'));
  const file = resolvePiSessionPath(identity, { dataDir: root }); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, '{}\n');
  runtime = { native: { sessionState: vi.fn(async (id) => ({ identity: id, tasks: [], toolCalls: ['private trace'], runs: [] })), cancelTask: vi.fn(async () => ({ status: 'cancelled' })), retryTask: vi.fn(async () => ({ status: 'running' })), compact: vi.fn(async () => ({ context: { tokens: 40, contextWindow: 1000 } })), toolServices: { execute: vi.fn(async () => ({ output: 'same PTY' })) } } };
  runtime.native.branches = vi.fn(async () => ({ activeBranchId: 'main', branches: [{ id: 'main' }] }));
  runtime.native.changeBranch = vi.fn(async () => ({ activeBranchId: 'alternate', filesReverted: false }));
  const app = express(); app.use(express.json());
  // This is a test-only identity fixture; production is mounted behind authenticateToken.
  app.use((req, res, next) => {
    if (req.headers['x-test-user']) req.user = { id: req.headers['x-test-user'] };
    if (req.headers['x-test-cloud-user']) {
      req.localKernelSession = { userId: req.headers['x-test-cloud-user'] };
      req.user = { id: null, cloudUserId: req.headers['x-test-cloud-user'] };
    }
    next();
  });
  getProject = vi.fn(async (name) => name === 'project' ? { path: root, user_id: 1 } : null);
  resolveDirectory = vi.fn(async () => root);
  validatePath = vi.fn(async () => ({ valid: true, resolvedPath: root }));
  app.use('/api/pi', createPiSessionsRouter({ runtime, storageOptions: { dataDir: root }, resolveProject: createPiSessionProjectResolver({ getProject, resolveDirectory, validatePath }) }));
  server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/pi/projects/project/sessions/saved`;
});
afterEach(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
const request = (suffix, options = {}) => fetch(`${base}${suffix}`, { ...options, headers: { 'x-test-user': '1', 'content-type': 'application/json', ...options.headers } });

describe('scoped Pi session routes', () => {
  it('uses the verified desktop cloud account while keeping session and workspace boundaries', async () => {
    getProject.mockResolvedValue({ path: root, user_id: 99 });
    const headers = { 'x-test-cloud-user': '1' };
    for (const suffix of ['/state', '/branches', '/terminals']) {
      expect((await request(suffix, { headers })).status).toBe(200);
      expect((await request(suffix, { headers: { 'x-test-cloud-user': '2' } })).status).toBe(404);
    }
    expect(runtime.native.branches).toHaveBeenCalledWith(identity, expect.objectContaining({ userId: '1', projectRoot: root }));
    validatePath.mockResolvedValueOnce({ valid: false });
    expect((await request('/branches', { headers })).status).toBe(404);
    // Hosted requests still enforce the project's database owner.
    expect((await request('/branches')).status).toBe(404);
  });
  it('loads an owned session even when its project has not reached the optional index', async () => {
    getProject.mockResolvedValue(null);
    expect((await request('/state')).status).toBe(200);
    expect(resolveDirectory).toHaveBeenCalledWith('project');
    expect(validatePath).toHaveBeenCalledWith(root, '1');
  });
  it('keeps project ownership and workspace validation enforced for recorded sessions', async () => {
    getProject.mockResolvedValueOnce({ path: root, user_id: 2 });
    expect((await request('/state')).status).toBe(404);
    expect(validatePath).not.toHaveBeenCalled();
    validatePath.mockResolvedValueOnce({ valid: false });
    expect((await request('/state')).status).toBe(404);
    expect(runtime.native.sessionState).not.toHaveBeenCalled();
  });
  it('reads first-turn progress before SDK transcript flush without allowing mutations', async () => {
    await fs.unlink(resolvePiSessionPath(identity, { dataDir: root }));
    await mutateAgentRuntimeState(identity, (state) => ({ ...state, todos: [{ id: 'todo', content: 'First-turn progress', status: 'in_progress' }] }), { dataDir: root });
    runtime.native.sessionState.mockImplementation((...args) => piRuntime.native.sessionState(...args));
    const response = await request('/state');
    expect(response.status).toBe(200);
    expect((await response.json()).todos).toEqual([{ id: 'todo', content: 'First-turn progress', status: 'in_progress' }]);
    expect((await request('/branches/create', { method: 'POST', body: '{"entryId":"entry"}' })).status).toBe(404);
    expect((await request('/compact', { method: 'POST' })).status).toBe(404);
    expect((await request('/state', { headers: { 'x-test-user': '2' } })).status).toBe(404);
    expect(runtime.native.changeBranch).not.toHaveBeenCalled();
    expect(runtime.native.compact).not.toHaveBeenCalled();
  });
  it('rejects anonymous, other-owner, unknown project and unknown-session access', async () => {
    expect((await fetch(`${base}/state`)).status).toBe(401);
    expect((await request('/state', { headers: { 'x-test-user': '2' } })).status).toBe(404);
    expect((await fetch(`${base.replace('/project/', '/other/')}/state`, { headers: { 'x-test-user': '1' } })).status).toBe(404);
    expect((await fetch(`${base.replace('/saved', '/missing')}/state`, { headers: { 'x-test-user': '1' } })).status).toBe(404);
    expect(runtime.native.sessionState).not.toHaveBeenCalled();
  });
  it('returns state without full tool traces and binds actions to the authenticated identity', async () => {
    const response = await request('/state'); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ identity, tasks: [] });
    expect((await request('/tasks/task-id/cancel', { method: 'POST', body: JSON.stringify({ ownerKey: '2', projectPath: '/etc' }) })).status).toBe(200);
    expect(runtime.native.cancelTask).toHaveBeenCalledWith(identity, 'task-id', expect.objectContaining({ projectRoot: root, userId: '1' }));
    expect((await request('/tasks/task-id/delete', { method: 'POST' })).status).toBe(404);
  });
  it('reads and writes the existing scoped terminal without creating a new process', async () => {
    await request('/terminals/terminal-id?cursor=10');
    expect(runtime.native.toolServices.execute).toHaveBeenLastCalledWith('terminal_read', { terminal_id: 'terminal-id', cursor: 10 }, expect.objectContaining({ identity }));
    await request('/terminals/terminal-id/input', { method: 'POST', body: JSON.stringify({ input: 'answer\n' }) });
    expect(runtime.native.toolServices.execute).toHaveBeenLastCalledWith('terminal_write', { terminal_id: 'terminal-id', input: 'answer\n' }, expect.objectContaining({ identity, permissionMode: 'ask' }));
    expect((await request('/terminals/terminal-id/open', { method: 'POST' })).status).toBe(404);
  });
  it('returns a conflict for busy compaction and rejects non-string model selection', async () => {
    runtime.native.compact.mockRejectedValueOnce(Object.assign(new Error('Busy'), { code: 'AGENT_TURN_ALREADY_ACTIVE' }));
    expect((await request('/compact', { method: 'POST' })).status).toBe(409);
    expect((await request('/compact', { method: 'POST', body: '{"model":{}}' })).status).toBe(400);
  });
  it('protects branch reads and mutations with the same authenticated session scope', async () => {
    for (const suffix of ['/branches', '/branches/create']) {
      const init = suffix.endsWith('create') ? { method: 'POST', body: JSON.stringify({ entryId: 'entry' }) } : {};
      expect((await fetch(`${base}${suffix}`, init)).status).toBe(401);
      expect((await request(suffix, { ...init, headers: { 'x-test-user': '2' } })).status).toBe(404);
      expect((await fetch(`${base.replace('/saved', '/missing')}${suffix}`, { ...init, headers: { 'x-test-user': '1' } })).status).toBe(404);
    }
    expect(runtime.native.branches).not.toHaveBeenCalled();
    expect(runtime.native.changeBranch).not.toHaveBeenCalled();
    expect((await request('/branches')).status).toBe(200);
    expect(runtime.native.branches).toHaveBeenCalledWith(identity, expect.objectContaining({ projectRoot: root }));
    expect((await request('/branches/create', { method: 'POST', body: JSON.stringify({ entryId: 'entry', label: 'Alternative', ownerKey: '2', projectPath: '/etc', method: 'prompt' }) })).status).toBe(200);
    expect(runtime.native.changeBranch).toHaveBeenCalledWith(identity, 'create', { entryId: 'entry', branchId: undefined, label: 'Alternative' }, expect.objectContaining({ projectRoot: root, userId: '1' }));
  });
  it('rejects invalid branch ids, unknown operations and concurrent turns', async () => {
    for (const body of [{}, { branchId: {} }, { branchId: '../escape' }, { branchId: 'main', label: 'x'.repeat(101) }]) {
      expect((await request('/branches/switch', { method: 'POST', body: JSON.stringify(body) })).status).toBe(400);
    }
    expect((await request('/branches/delete', { method: 'POST' })).status).toBe(404);
    expect(runtime.native.changeBranch).not.toHaveBeenCalled();
    runtime.native.changeBranch.mockRejectedValueOnce(Object.assign(new Error('Busy'), { code: 'AGENT_TURN_ALREADY_ACTIVE' }));
    expect((await request('/branches/switch', { method: 'POST', body: JSON.stringify({ branchId: 'main' }) })).status).toBe(409);
  });
});
