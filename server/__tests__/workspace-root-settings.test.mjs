import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
let root, home, database, server, url, user, token;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-root-settings-'));
  home = path.join(root, 'home'); await fs.mkdir(home);
  vi.spyOn(os, 'homedir').mockReturnValue(home);
  vi.stubEnv('HOME', home); vi.stubEnv('WORKSPACES_ROOT', '');
  vi.stubEnv('MEDHELP_DATA_DIR', path.join(home, '.medhelpsec'));
  vi.stubEnv('DATABASE_PATH', path.join(home, '.medhelpsec', 'auth.db'));
  vi.stubEnv('VITE_IS_PLATFORM', 'false'); vi.resetModules();
  database = await import('../database/db.js'); await database.initializeDatabase();
  user = database.userDb.createUser('workspace-test', 'hash');
  const { authenticateToken, generateAuthTokens } = await import('../middleware/auth.js');
  token = generateAuthTokens(user).accessToken;
  const app = express(); app.use(express.json());
  app.use('/api/projects', authenticateToken, (await import('../routes/projects.js')).default);
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  url = `http://127.0.0.1:${server.address().port}/api/projects/workspace-root`;
});
afterEach(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  database?.closeDatabase(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.resetModules();
  await fs.rm(root, { recursive: true, force: true });
});
async function request(method = 'GET', target) {
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(method === 'PUT' ? { body: JSON.stringify({ path: target }) } : {}) });
  return { status: response.status, body: await response.json() };
}
it('defaults to Documents and persists another directory, then clears the override on reset', async () => {
  const defaultPath = path.join(home, 'Documents', 'medhelp-ukb');
  expect((await request()).body.path).toBe(defaultPath);
  const selected = path.join(root, 'external-storage'); await fs.mkdir(selected);
  expect((await request('PUT', selected)).status).toBe(200);
  expect((await request()).body.path).toBe(selected);
  await fs.rm(defaultPath, { recursive: true });
  const reset = await request('PUT', null);
  expect(reset.status).toBe(200); expect(reset.body.path).toBe(defaultPath);
  expect((await fs.stat(defaultPath)).isDirectory()).toBe(true);
  expect(database.userDb.getWorkspaceRootUser(user.id).workspace_root).toBeNull();
  expect((await request()).body.path).toBe(defaultPath);
});
it('rejects forbidden directories without replacing the saved selection', async () => {
  const original = (await request()).body.path;
  expect((await request('PUT', '/')).status).toBe(400);
  expect((await request()).body.path).toBe(original);
});
