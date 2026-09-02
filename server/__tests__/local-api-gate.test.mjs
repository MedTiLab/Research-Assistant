import express from 'express';
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

let tempRoot = null;
let server = null;
let baseUrl = null;
let database = null;
let activeSessionOwner = null;

const originalEnv = {
  DATABASE_PATH: process.env.DATABASE_PATH,
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  MEDHELP_LOCAL_KERNEL: process.env.MEDHELP_LOCAL_KERNEL,
  MEDHELP_LOCAL_HOST: process.env.MEDHELP_LOCAL_HOST,
  MEDHELP_LOCAL_PAIRING_SKIP_CLOUD_TOKEN: process.env.MEDHELP_LOCAL_PAIRING_SKIP_CLOUD_TOKEN,
  VITE_IS_PLATFORM: process.env.VITE_IS_PLATFORM,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function closeServer() {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    server = null;
  }
}

async function startServer() {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-local-api-gate-'));
  process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  process.env.HOME = tempRoot;
  process.env.USERPROFILE = tempRoot;
  process.env.MEDHELP_LOCAL_KERNEL = '1';
  process.env.MEDHELP_LOCAL_HOST = '127.0.0.1';
  process.env.MEDHELP_LOCAL_PAIRING_SKIP_CLOUD_TOKEN = '1';
  process.env.VITE_IS_PLATFORM = 'true';

  vi.resetModules();
  database = await import('../database/db.js');
  await database.initializeDatabase();
  database.userDb.createUser('local-user', 'hash');
  const localKernel = await import('../routes/localKernel.js');
  const { authenticateToken } = await import('../middleware/auth.js');
  const { createLocalApiGate } = await import('../utils/localApiGate.js');
  const projectsRoutes = (await import('../routes/projects.js')).default;
  const { getProjects } = await import('../projects.js');
  const { resolveRequestUserId } = await import('../utils/userScope.js');
  const { createPiSessionsRouter, createPiSessionProjectResolver } = await import('../routes/pi-sessions.js');

  const { createSessionManagementRouter } = await import('../routes/session-management.js');
  const { runtimeSessionStoreRegistry } = await import('../agent-runtime/session-stores/index.js');
  activeSessionOwner = null;
  const app = express();
  app.use(express.json());
  app.use('/api/local', localKernel.default);
  app.post('/api/gateway/authorize', (req, res) => {
    if (req.headers.authorization === 'Bearer pro-cloud-token' && req.body?.capability === 'compute.resources') {
      return res.json({ success: true, capability: 'compute.resources', plan: 'pro' });
    }
    return res.status(403).json({
      error: 'Membership plan does not include this capability',
      code: 'CAPABILITY_DENIED',
      plan: 'free',
    });
  });
  app.use(createLocalApiGate());
  app.get('/api/auth/status', (_req, res) => res.json({ ok: true, open: true }));
  app.get('/api/local-kernel/releases', (_req, res) => res.json({ ok: true, open: true }));
  app.get('/api/projects', authenticateToken, async (req, res) => {
    res.json(await getProjects(req.user?.id ?? null, null, { sessionOwnerKey: resolveRequestUserId(req) }));
  });
  app.use('/api/pi', authenticateToken, createPiSessionsRouter({
    runtime: { native: {
      branches: async (identity) => ({ identity, activeBranchId: 'main', branches: [] }),
      sessionState: async (identity) => ({ identity, todos: [], tasks: [] }),
    } },
    resolveProject: createPiSessionProjectResolver({
      getProject: async () => ({ path: tempRoot, user_id: 1 }),
      resolveDirectory: async () => tempRoot,
      validatePath: async () => ({ valid: true, resolvedPath: tempRoot }),
    }),
  }));
  app.use('/api/projects', authenticateToken, createSessionManagementRouter({
    registry: runtimeSessionStoreRegistry,
    getSessionStatus: (identity) => ({ isActive: identity.ownerKey === activeSessionOwner }),
  }));
  app.use('/api/projects', authenticateToken, projectsRoutes);
  app.get('/api/authenticated-projects', authenticateToken, (req, res) => {
    res.json({ ok: true, userId: req.user?.id || null });
  });

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function req(pathname, { token = null, origin = 'http://localhost:5173', method = 'GET', body } = {}) {
  const headers = {};
  if (origin) {
    headers.Origin = origin;
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${pathname}`, {
    headers, method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

async function createLocalSession(cloudAccessToken = 'x', cloudUserId = 'u1') {
  const response = await fetch(`${baseUrl}/api/local/session/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({
      cloudUserId,
      cloudAccessToken,
      cloudBaseUrl: baseUrl,
      browserNonce: 'n1',
      requestedPermissionMode: 'analysis',
    }),
  });
  const payload = await response.json();
  return payload.sessionToken;
}

describe('local API gate', () => {
  it.each(['pi'])('deletes, restores and removes indexed %s sessions with a legacy local project owner', async (provider) => {
    await startServer();
    const token = await createLocalSession('x', '7001');
    const other = await createLocalSession('x', '7002');
    const projectName = 'bone-zheer';
    const sessionId = 'saved-session';
    const ownerKey = provider === 'pi' ? '7001' : '1';
    const lookup = { projectName, provider, ownerKey };
    database.projectDb.upsertProject(projectName, 1, 'bone-zheer', tempRoot, 0, null, { manuallyAdded: true });
    database.sessionDb.upsertSessionFromSource(sessionId, projectName, provider, { ownerKey, displayName: 'Saved', messageCount: 2 });
    const endpoint = `/api/projects/${projectName}/sessions/${sessionId}`;
    let sessionFile;
    if (provider === 'pi') {
      const { resolvePiSessionPath } = await import('../pi-runtime/session-store.js');
      sessionFile = resolvePiSessionPath({ ownerKey, projectKey: projectName, runtimeId: provider, sessionId });
      await fs.mkdir(path.dirname(sessionFile), { recursive: true });
      await fs.writeFile(sessionFile, '{}\n');
      expect((await req(`${endpoint}?provider=pi`, { token: other, method: 'DELETE' })).status).toBe(404);
    }
    activeSessionOwner = '7001';
    expect((await req(`${endpoint}?provider=${provider}`, { token, method: 'DELETE' })).status).toBe(409);
    expect(database.sessionDb.getSessionById(sessionId, lookup).metadata?.trash).toBeUndefined();
    activeSessionOwner = null;
    const deleted = await req(`${endpoint}?provider=${provider}`, { token, method: 'DELETE' });
    expect(deleted, JSON.stringify(deleted)).toMatchObject({ status: 200, payload: { success: true } });
    if (sessionFile) expect(await fs.readFile(sessionFile, 'utf8')).toBe('{}\n');
    expect(database.sessionDb.getSessionById(sessionId, lookup).metadata.trash.trashedAt).toBeTruthy();
    expect((await req('/api/projects/trash/sessions', { token })).payload).toEqual([
      expect.objectContaining({ id: sessionId, provider, ownerKey }),
    ]);
    if (provider === 'pi') expect((await req('/api/projects/trash/sessions', { token: other })).payload).toEqual([]);
    expect((await req(`${endpoint}/restore`, { token, method: 'POST', body: { provider } })).status).toBe(200);
    expect(database.sessionDb.getSessionById(sessionId, lookup).metadata?.trash).toBeUndefined();
    // Index-only history must remain removable after a user manually removes its file.
    if (sessionFile) await fs.rm(sessionFile);
    expect((await req(`${endpoint}?provider=${provider}`, { token, method: 'DELETE' })).status).toBe(200);
    expect((await req(`${endpoint}?provider=${provider}&mode=physical`, { token, method: 'DELETE' })).status).toBe(200);
    expect(database.sessionDb.getSessionById(sessionId, lookup)).toBeNull();
    expect(database.db.prepare('SELECT COUNT(*) AS n FROM users WHERE id = 7001').get().n).toBe(0);
    expect(database.db.pragma('foreign_key_check')).toEqual([]);
  });

  it('only removes the paired account Pi identity when accounts share an external session id', async () => {
    await startServer();
    const token = await createLocalSession('x', '7001');
    const { resolvePiSessionPath } = await import('../pi-runtime/session-store.js');
    database.projectDb.upsertProject('shared', 1, 'Shared', tempRoot);
    const identities = ['7001', '7002'].map((ownerKey) => ({ ownerKey, projectKey: 'shared', runtimeId: 'pi', sessionId: 'same-id' }));
    for (const identity of identities) {
      database.sessionDb.upsertSessionFromSource(identity.sessionId, identity.projectKey, 'pi', { ownerKey: identity.ownerKey, displayName: 'Keep scope' });
      const file = resolvePiSessionPath(identity);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, 'original transcript');
    }
    const endpoint = '/api/projects/shared/sessions/same-id';
    expect((await req(`${endpoint}?provider=pi`, { token, method: 'DELETE' })).status).toBe(200);
    // Older clients omit provider on restore. Resolve only among visible owners.
    expect((await req(`${endpoint}/restore`, { token, method: 'POST' })).status).toBe(200);
    expect((await req(`${endpoint}?provider=pi&mode=physical`, { token, method: 'DELETE' })).status).toBe(200);
    await expect(fs.access(resolvePiSessionPath(identities[0]))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(resolvePiSessionPath(identities[1]), 'utf8')).toBe('original transcript');
    expect(database.sessionDb.getSessionByIdentity(identities[1])).toBeTruthy();
    expect((await req(`${endpoint}?provider=pi`, { token, method: 'DELETE' })).status).toBe(404);
  });

  it('shows an explicitly re-added desktop folder in the project API after it was hidden', async () => {
    await startServer();
    const token = await createLocalSession('x', '7001');
    const { encodeProjectPath, deleteProject } = await import('../projects.js');
    let folder = path.join(tempRoot, 'medhelp_workspace', 'IBD2');
    await fs.mkdir(folder, { recursive: true });
    folder = await fs.realpath(folder);
    await fs.writeFile(path.join(folder, 'research.txt'), 'keep');
    const projectName = encodeProjectPath(folder);
    database.projectDb.upsertProject(projectName, 1, 'IBD2', folder, 0, null, { manuallyAdded: true });
    await deleteProject(projectName, true, null);
    const before = await req('/api/projects', { token });
    expect(before.payload.some((p) => p.name === projectName)).toBe(false);
    const imported = await req('/api/projects/create-workspace', { token, method: 'POST', body: {
      workspaceType: 'existing', path: folder, displayName: 'IBD2 imported',
    } });
    expect(imported, JSON.stringify(imported)).toMatchObject({ status: 200, payload: { success: true } });
    for (let i = 0; i < 2; i += 1) {
      const listed = await req('/api/projects', { token });
      expect(listed.payload.filter((p) => p.name === projectName)).toEqual([
        expect.objectContaining({ displayName: 'IBD2 imported', path: folder }),
      ]);
    }
    expect(await fs.readFile(path.join(folder, 'research.txt'), 'utf8')).toBe('keep');
  });

  it('keeps hosted project ownership enforcement when resolving session mutations', async () => {
    await startServer();
    database.projectDb.upsertProject('private', 1, 'Private', tempRoot);
    const { resolveApiSessionTarget } = await import('../utils/apiSessionTarget.js');
    expect(() => resolveApiSessionTarget({ user: { id: 7001 }, localKernelSession: { userId: 7001 } }, 'missing', 'saved', 'pi'))
      .toThrow(expect.objectContaining({ status: 404 }));
    expect(() => resolveApiSessionTarget({ user: { id: 7001 } }, 'private', 'saved', 'pi'))
      .toThrow(expect.objectContaining({ status: 403 }));
  });

  it('authorizes Pi progress and branches using the paired account without a local login row', async () => {
    await startServer();
    const { resolvePiSessionPath } = await import('../pi-runtime/session-store.js');
    const identity = { ownerKey: '7001', projectKey: 'project', runtimeId: 'pi', sessionId: 'saved' };
    const file = resolvePiSessionPath(identity);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{}\n');
    const token = await createLocalSession('x', '7001');
    const other = await createLocalSession('x', '7002');
    for (const operation of ['state', 'branches']) {
      const endpoint = `/api/pi/projects/project/sessions/saved/${operation}`;
      const result = await req(endpoint, { token });
      expect(result.status).toBe(200);
      expect(result.payload.identity).toEqual(identity);
      expect((await req(endpoint, { token: other })).status).toBe(404);
      expect((await req(endpoint)).status).toBe(401);
    }
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM users WHERE id = 7001').get().count).toBe(0);
  });
  it('saves Pi settings for the paired cloud account without a local user row or caller-selected owner', async () => {
    await startServer();
    const body = {
      name: 'Desktop Pi',
      providerType: 'byok-openai-compatible',
      baseUrl: 'https://models.example.test/v1',
      apiKey: 'desktop-route-secret-1234',
      userId: 7002,
    };
    expect((await req('/api/local/pi/providers', { method: 'POST', body })).status).toBe(401);
    const token = await createLocalSession('x', '7001');
    const saved = await req('/api/local/pi/providers', { token, method: 'POST', body });
    expect(saved.status).toBe(201);
    expect(saved.payload.provider).toMatchObject({ keyConfigured: true, keyLast4: '1234' });
    expect(JSON.stringify(saved.payload)).not.toContain('desktop-route-secret');
    const models = await req(`/api/local/pi/providers/${saved.payload.provider.id}/models`, {
      token, method: 'PUT', body: { models: [{ id: 'desktop-model' }] },
    });
    expect(models.status).toBe(200);
    expect((await req('/api/local/pi/providers', { token })).payload.providers).toHaveLength(1);
    const otherToken = await createLocalSession('x', '7002');
    expect((await req('/api/local/pi/providers', { token: otherToken })).payload.providers).toEqual([]);
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM users WHERE id IN (7001, 7002)').get().count).toBe(0);
    expect(database.db.pragma('foreign_key_check')).toEqual([]);
  });

  afterEach(async () => {
    await closeServer();
    if (database?.db?.open) {
      database.db.close();
    }
    database = null;
    vi.resetModules();
    restoreEnv();
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('lets auth paths through without a local session', async () => {
    await startServer();
    const res = await req('/api/auth/status', { token: null });
    expect(res.status).toBe(200);
    expect(res.payload).toMatchObject({ open: true });
  });

  it('lets local-kernel cloud handshake paths through without a local session', async () => {
    await startServer();
    const res = await req('/api/local-kernel/releases', { token: null });
    expect(res.status).toBe(200);
    expect(res.payload).toMatchObject({ open: true });
  });

  it('rejects work paths without a local session token', async () => {
    await startServer();
    const res = await req('/api/projects', { token: null });
    expect(res.status).toBe(401);
  });

  it('allows work paths with a valid local session token', async () => {
    await startServer();
    const token = await createLocalSession();
    const res = await req('/api/projects', { token });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.payload)).toBe(true);
  });

  it('requires Pro before exposing local compute resources', async () => {
    await startServer();

    const freeSession = await createLocalSession('free-cloud-token');
    const denied = await req('/api/local/compute/nodes', { token: freeSession });
    expect(denied.status).toBe(403);
    expect(denied.payload).toMatchObject({
      code: 'CAPABILITY_DENIED',
      capability: 'compute.resources',
    });

    const proSession = await createLocalSession('pro-cloud-token');
    const allowed = await req('/api/local/compute/nodes', { token: proSession });
    expect(allowed.status).toBe(200);
    expect(allowed.payload).toMatchObject({ nodes: [] });
  });

  it('keeps online authorization separate from the device-local database owner', async () => {
    await startServer();
    const token = await createLocalSession();
    const res = await req('/api/authenticated-projects', { token });
    expect(res.status).toBe(200);
    expect(res.payload).toMatchObject({ ok: true, userId: null });
  });

  it('creates projects in the device-local scope so refresh can list them again', async () => {
    await startServer();
    const token = await createLocalSession();
    const projectPath = path.join(tempRoot, 'WindowsCustomerProject');

    const created = await fetch(`${baseUrl}/api/projects/create-workspace`, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workspaceType: 'new',
        path: projectPath,
        displayName: 'Windows Customer Project',
      }),
    });
    const createdPayload = await created.json();
    expect(created.status).toBe(200);
    expect(createdPayload.project.displayName).toBe('Windows Customer Project');

    const listed = await req('/api/projects', { token });
    expect(listed.status).toBe(200);
    expect(listed.payload).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          displayName: 'Windows Customer Project',
          fullPath: await fs.realpath(projectPath),
        }),
      ]),
    );
    const localProject = database.projectDb.getAllProjects()
      .find((project) => project.display_name === 'Windows Customer Project');
    expect(localProject?.user_id).toBeNull();
  });

  it('shows the same device-local projects after switching online accounts', async () => {
    await startServer();
    const firstToken = await createLocalSession('x', 'account-one');
    const secondToken = await createLocalSession('x', 'account-two');
    const projectPath = path.join(tempRoot, 'AccountOneProject');

    const created = await fetch(`${baseUrl}/api/projects/create-workspace`, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        Authorization: `Bearer ${firstToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workspaceType: 'new',
        path: projectPath,
        displayName: 'Account One Project',
      }),
    });
    expect(created.status).toBe(200);

    const firstList = await req('/api/projects', { token: firstToken });
    const secondList = await req('/api/projects', { token: secondToken });
    expect(firstList.payload).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayName: 'Account One Project' }),
    ]));
    expect(secondList.payload).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayName: 'Account One Project' }),
    ]));
  });

  it('keeps legacy locally-owned projects visible after online authorization changes', async () => {
    await startServer();
    const legacyUser = database.userDb.createUser('legacy-local-user', 'hash');
    const legacyProjectPath = path.join(tempRoot, 'LegacyProject');
    await fs.mkdir(legacyProjectPath, { recursive: true });
    database.projectDb.upsertProject(
      'legacy-project',
      legacyUser.id,
      'Legacy Project',
      legacyProjectPath,
    );

    const token = await createLocalSession('x', 'new-cloud-account');
    const listed = await req('/api/projects', { token });

    expect(listed.status).toBe(200);
    expect(listed.payload).toEqual(expect.arrayContaining([
      expect.objectContaining({ displayName: 'Legacy Project' }),
    ]));
  });

  it('rejects disallowed origins even with a token', async () => {
    await startServer();
    const token = await createLocalSession();
    const res = await req('/api/projects', { token, origin: 'http://evil.example.com' });
    expect(res.status).toBe(403);
  });
});
