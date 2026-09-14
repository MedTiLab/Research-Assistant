import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let tempRoot;
let database;
let server;
let baseUrl;
let owner;
let ownerToken;
let otherToken;

async function request(route, { method = 'GET', token = ownerToken } = {}) {
  const response = await fetch(`${baseUrl}/api/projects${route}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, payload: await response.json() };
}

async function seedTrash({ filesExist = true, indexed = false, instanceId = 'original-instance' } = {}) {
  // The stored ID may still refer to a previous computer/user after migration.
  const name = '-Users-old-user-Desktop-旧项目';
  const originalPath = path.join(tempRoot, 'Desktop', 'project');
  if (filesExist) {
    await fs.mkdir(originalPath, { recursive: true });
    await fs.writeFile(path.join(originalPath, 'research.txt'), 'keep research');
    await fs.writeFile(path.join(originalPath, 'instance.json'), JSON.stringify({ instance_id: 'original-instance' }));
  }
  const trash = {
    trashedAt: '2026-04-17T01:51:52.434Z', originalPath,
    ownerUserId: owner.id, filesExist, instanceId, displayName: '旧项目',
  };
  const legacyPath = path.join(tempRoot, '.claude', 'project-config.json');
  await fs.mkdir(path.dirname(legacyPath), { recursive: true });
  await fs.writeFile(legacyPath, JSON.stringify({
    [name]: { originalPath, ownerUserId: owner.id, trash },
  }));
  if (indexed) database.projectDb.upsertProject(name, owner.id, '旧项目', originalPath, 0, null, { trash });
  return { name, originalPath, route: `/trash/${encodeURIComponent(name)}` };
}

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-project-trash-api-'));
  vi.spyOn(os, 'homedir').mockReturnValue(tempRoot);
  vi.stubEnv('MEDHELP_DATA_DIR', path.join(tempRoot, '.medhelpsec'));
  vi.stubEnv('DATABASE_PATH', path.join(tempRoot, 'auth.db'));
  vi.stubEnv('VITE_IS_PLATFORM', 'false');
  vi.stubEnv('MEDHELP_EXPOSE_PROJECT_AGENT_ASSETS', 'false');
  vi.resetModules();
  database = await import('../database/db.js');
  await database.initializeDatabase();
  owner = database.userDb.createUser('trash-owner', 'hash');
  const other = database.userDb.createUser('other-owner', 'hash');
  const { authenticateToken, generateAuthTokens } = await import('../middleware/auth.js');
  ownerToken = generateAuthTokens(owner).accessToken;
  otherToken = generateAuthTokens(other).accessToken;
  const projectsRoutes = (await import('../routes/projects.js')).default;

  const app = express();
  app.use('/api/projects', authenticateToken, projectsRoutes);
  // Match server/index.js: ordinary project APIs still require a database row,
  // even though the param callback is registered after the trash router.
  app.param('projectName', (req, res, next, projectName) => {
    const record = database.projectDb.getProjectById(projectName);
    if (!record || (record.user_id != null && record.user_id !== req.user?.id)) {
      return res.status(404).json({ error: 'Project not found' });
    }
    next();
  });
  app.get('/api/projects/:projectName/file', (_req, res) => res.json({ success: true }));
  app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  server = null;
  database?.closeDatabase();
  database = null;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
});

describe('project trash HTTP API', () => {
  it.each([
    { filesExist: false, indexed: false },
    { filesExist: true, indexed: false },
    { filesExist: true, indexed: true },
  ])('removes a listed record without deleting files: %j', async (options) => {
    const project = await seedTrash(options);
    const before = await request('/trash');
    expect(before).toMatchObject({ status: 200, payload: [{ name: project.name, filesExist: options.filesExist }] });
    expect(Boolean(database.projectDb.getProjectById(project.name))).toBe(options.indexed);
    expect(await request(`${project.route}?mode=logical`, { method: 'DELETE' }))
      .toEqual({ status: 200, payload: { success: true } });
    expect(await request('/trash')).toEqual({ status: 200, payload: [] });
    expect(database.projectDb.getProjectById(project.name)).toBeFalsy();
    const config = JSON.parse(await fs.readFile(path.join(tempRoot, '.medhelpsec', 'project-config.json'), 'utf8'));
    expect(config[project.name]).toBeUndefined();
    expect(config._deletedProjects[project.name].deletedAt).toBeTruthy();
    if (options.filesExist) expect(await fs.readFile(path.join(project.originalPath, 'research.txt'), 'utf8')).toBe('keep research');
  });

  it.each([false, true])('physically removes config-only trash (files exist: %s)', async (filesExist) => {
    const project = await seedTrash({ filesExist });
    expect(await request(`${project.route}?mode=physical`, { method: 'DELETE' }))
      .toEqual({ status: 200, payload: { success: true } });
    expect((await request('/trash')).payload).toEqual([]);
    await expect(fs.access(project.originalPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([null, 'different-instance'])('preserves files when physical deletion cannot verify identity: %s', async (instanceId) => {
    const project = await seedTrash({ instanceId });
    const result = await request(`${project.route}?mode=physical`, { method: 'DELETE' });
    expect(result.status).toBe(500);
    expect(result.payload.error).toMatch(/instance identity|no longer match/);
    expect(await fs.readFile(path.join(project.originalPath, 'research.txt'), 'utf8')).toBe('keep research');
    expect((await request('/trash')).payload).toHaveLength(1);
  });

  it('restores a config-only project and recreates its database record', async () => {
    const project = await seedTrash();
    expect(await request(`${project.route}/restore`, { method: 'POST' }))
      .toEqual({ status: 200, payload: { success: true } });
    expect(database.projectDb.getProjectById(project.name)).toMatchObject({ user_id: owner.id, path: project.originalPath });
    expect((await request('/trash')).payload).toEqual([]);
    expect(await fs.readFile(path.join(project.originalPath, 'research.txt'), 'utf8')).toBe('keep research');
  });

  it('rejects restoring missing files while still allowing record removal', async () => {
    const project = await seedTrash({ filesExist: false });
    expect((await request(`${project.route}/restore`, { method: 'POST' })).payload.error).toMatch(/files are missing/);
    expect((await request(`${project.route}?mode=logical`, { method: 'DELETE' })).status).toBe(200);
  });

  it('requires authentication and keeps another account from restoring or deleting legacy trash', async () => {
    const project = await seedTrash();
    expect((await request('/trash', { token: otherToken })).payload).toEqual([]);
    for (const [suffix, method] of [['?mode=logical', 'DELETE'], ['?mode=physical', 'DELETE'], ['/restore', 'POST']]) {
      expect((await request(project.route + suffix, { method, token: null })).status).toBe(401);
      const denied = await request(project.route + suffix, { method, token: otherToken });
      expect(denied.status).toBe(500);
      expect(denied.payload.error).toMatch(/permission/);
    }
    expect((await request('/trash')).payload).toHaveLength(1);
    expect(await fs.readFile(path.join(project.originalPath, 'research.txt'), 'utf8')).toBe('keep research');
  });

  it('keeps normal project checks and rejects records that are not in trash', async () => {
    const project = await seedTrash();
    expect((await request(`/${encodeURIComponent(project.name)}/file`)).status).toBe(404);
    database.projectDb.upsertProject('active-project', owner.id, 'Active', project.originalPath);
    for (const name of ['active-project', 'missing-project']) {
      const result = await request(`/trash/${name}?mode=logical`, { method: 'DELETE' });
      expect(result.status).toBe(500);
      expect(result.payload.error).toBe('Project is not in trash');
    }
    expect(database.projectDb.getProjectById('active-project')).toBeTruthy();
  });
});
