import express from 'express';
import fs from 'fs/promises';
import http from 'http';
import os from 'os';
import path from 'path';
import { WebSocketServer, WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = {
  DATABASE_PATH: process.env.DATABASE_PATH,
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  MEDHELP_LOCAL_KERNEL: process.env.MEDHELP_LOCAL_KERNEL,
  MEDHELP_LOCAL_HOST: process.env.MEDHELP_LOCAL_HOST,
  MEDHELP_KERNEL_INSTANCE_ID: process.env.MEDHELP_KERNEL_INSTANCE_ID,
  MEDHELP_LOCAL_PAIRING_SKIP_CLOUD_TOKEN: process.env.MEDHELP_LOCAL_PAIRING_SKIP_CLOUD_TOKEN,
  MEDHELP_SECURE_DISTRIBUTION: process.env.MEDHELP_SECURE_DISTRIBUTION,
  MEDHELP_CLOUD_APP_URL: process.env.MEDHELP_CLOUD_APP_URL,
  VITE_IS_PLATFORM: process.env.VITE_IS_PLATFORM,
  WORKSPACES_ROOT: process.env.WORKSPACES_ROOT,
};

let tempRoot = null;
let server = null;
let wss = null;
let baseUrl = null;
let wsUrl = null;
let database = null;
let routeModule = null;
let cloudAuthServer = null;

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
  if (wss) {
    await new Promise((resolve) => wss.close(resolve));
    wss = null;
  }
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    server = null;
  }
  if (cloudAuthServer) {
    await new Promise((resolve, reject) => {
      cloudAuthServer.close((error) => (error ? reject(error) : resolve()));
    });
    cloudAuthServer = null;
  }
}

async function startCloudAuthServer(authorization = {}) {
  cloudAuthServer = http.createServer((req, res) => {
    authorization.requests?.push({ path: req.url, method: req.method, authorization: req.headers.authorization });
    if (req.url === '/api/auth/user' && req.method === 'GET') {
      const status = authorization.profileStatus ?? 200;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status === 200
        ? { user: { id: authorization.profileUserId ?? 'cloud-user-1' } }
        : { error: 'Profile authorization rejected' }));
      return;
    }
    if (req.url !== '/api/auth/kernel-device/activate' || req.method !== 'POST') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    if (req.headers.authorization !== 'Bearer valid-cloud-token') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid or revoked online session' }));
      return;
    }
    if (authorization.status === 409) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Device limit reached', code: 'DEVICE_LIMIT_REACHED', maxDevices: 1 }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ...(authorization.legacyResponse ? {} : { user: { id: 'cloud-user-1', username: 'researcher' } }),
      countedAsDevice: authorization.countedAsDevice ?? true,
    }));
  });
  await new Promise((resolve) => cloudAuthServer.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${cloudAuthServer.address().port}`;
}

async function startLocalKernelTestServer({ isPlatform = true } = {}) {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-local-kernel-'));
  process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  process.env.HOME = tempRoot;
  process.env.USERPROFILE = tempRoot;
  process.env.MEDHELP_LOCAL_KERNEL = '1';
  process.env.MEDHELP_LOCAL_HOST = '127.0.0.1';
  process.env.MEDHELP_LOCAL_PAIRING_SKIP_CLOUD_TOKEN = '1';
  process.env.VITE_IS_PLATFORM = String(isPlatform);
  delete process.env.WORKSPACES_ROOT;

  vi.resetModules();
  database = await import('../database/db.js');
  await database.initializeDatabase();
  routeModule = await import('../routes/localKernel.js');

  const app = express();
  app.use(express.json());
  app.use('/api/local', routeModule.default);
  app.use('/api/local-kernel', routeModule.localKernelPublicRouter);

  server = http.createServer(app);
  wss = new WebSocketServer({
    server,
    verifyClient: (info) => {
      const requestUrl = new URL(info.req.url || '/', 'http://localhost');
      const token = requestUrl.searchParams.get('token');
      const session = routeModule.verifyLocalSessionToken(token, info.origin || null);
      if (!session) {
        return false;
      }
      info.req.localKernelSession = session;
      return true;
    },
  });
  wss.on('connection', routeModule.handleLocalKernelWebSocket);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  wsUrl = `ws://127.0.0.1:${port}/ws/local`;
}

async function requestJson(pathname, { method = 'GET', token = null, body = null } = {}) {
  const headers = { Origin: 'http://localhost:5173' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === null ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

async function createLocalSession(overrides = {}) {
  const started = await requestJson('/api/local/session/start', {
    method: 'POST',
    body: {
      cloudUserId: 'user-1',
      cloudAccessToken: 'cloud-token',
      origin: 'http://localhost:5173',
      browserNonce: 'nonce-1',
      requestedPermissionMode: 'analysis',
      ...overrides,
    },
  });

  expect(started.response.status).toBe(200);
  expect(started.payload.sessionToken).toEqual(expect.stringMatching(/^mh_loc_/));
  expect(started.payload.permissionMode).toBe('analysis');
  return started.payload.sessionToken;
}

function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => {
      try {
        resolve(JSON.parse(String(data)));
      } catch (error) {
        reject(error);
      }
    });
    socket.once('error', reject);
  });
}

describe('local Kernel API', () => {
  it('reports the launcher instance ID in the health payload', async () => {
    process.env.MEDHELP_KERNEL_INSTANCE_ID = 'kernel-instance-1';
    await startLocalKernelTestServer();

    expect(routeModule.getLocalKernelHealthPayload()).toMatchObject({
      ok: true,
      product: 'MedHelp Kernel',
      instanceId: 'kernel-instance-1',
    });
  });

  afterEach(async () => {
    delete globalThis.__MEDHELP_LOCAL_KERNEL_CONTROL_TOKEN__;
    delete globalThis.__MEDHELP_REQUEST_LOCAL_KERNEL_SHUTDOWN__;
    await closeServer();
    if (database?.db?.open) {
      database.db.close();
    }
    database = null;
    routeModule = null;
    vi.resetModules();
    restoreEnv();
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('serves public releases without a local session', async () => {
    await startLocalKernelTestServer();

    const res = await requestJson('/api/local/public-releases?platform=mac');
    expect(res.response.status).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      product: 'MedHelp',
      platform: 'mac',
      distribution: 'desktop-only',
      desktopDownloadPath: '/download',
      version: expect.any(String),
    });
  });

  it('serves cloud public releases without auth', async () => {
    await startLocalKernelTestServer();

    const res = await requestJson('/api/local-kernel/public-releases?platform=windows');
    expect(res.response.status).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      product: 'MedHelp',
      platform: 'windows',
      distribution: 'desktop-only',
      desktopDownloadPath: '/download',
      version: expect.any(String),
    });
  });

  it('does not allow an unauthenticated browser to trigger a Kernel update', async () => {
    await startLocalKernelTestServer();

    const res = await requestJson('/api/local/update', {
      method: 'POST',
      body: {},
    });
    expect(res.response.status).toBe(401);
    expect(res.payload.error).toMatch(/session token/i);
  });

  it('only accepts authenticated shutdown requests', async () => {
    await startLocalKernelTestServer();
    const shutdown = vi.fn().mockResolvedValue(undefined);
    globalThis.__MEDHELP_REQUEST_LOCAL_KERNEL_SHUTDOWN__ = shutdown;

    const unauthenticated = await requestJson('/api/local/shutdown', {
      method: 'POST',
      body: {},
    });
    expect(unauthenticated.response.status).toBe(401);

    const token = await createLocalSession();
    const authenticated = await requestJson('/api/local/shutdown', {
      method: 'POST',
      token,
      body: {},
    });
    expect(authenticated.response.status).toBe(202);
    expect(authenticated.payload).toMatchObject({ ok: true, shuttingDown: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(shutdown).toHaveBeenCalledOnce();
  });

  it('requires the runtime control token for CLI shutdown', async () => {
    await startLocalKernelTestServer();
    globalThis.__MEDHELP_LOCAL_KERNEL_CONTROL_TOKEN__ = 'control-token';

    const denied = await fetch(`${baseUrl}/api/local/control/shutdown`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(denied.status).toBe(401);

    const accepted = await fetch(`${baseUrl}/api/local/control/shutdown`, {
      method: 'POST',
      headers: {
        Origin: 'http://localhost:5173',
        'X-MedHelp-Control-Token': 'control-token',
      },
    });
    expect(accepted.status).toBe(202);
    await expect(accepted.json()).resolves.toMatchObject({ ok: true, shuttingDown: true });
  });

  it('starts, reports active status, and revokes the local session', async () => {
    await startLocalKernelTestServer();
    const token = await createLocalSession();

    const status = await requestJson('/api/local/status', { token });
    expect(status.response.status).toBe(200);
    expect(status.payload).toMatchObject({
      ok: true,
      product: 'MedHelp Kernel',
      sessionActive: true,
      permissionMode: 'analysis',
    });

    const revoked = await requestJson('/api/local/session/revoke', {
      method: 'POST',
      token,
      body: {},
    });
    expect(revoked.response.status).toBe(200);

    const afterRevoke = await requestJson('/api/local/status', { token });
    expect(afterRevoke.payload.sessionActive).toBe(false);
  });

  it('requires a live online authorization before a secure desktop session is issued', async () => {
    await startLocalKernelTestServer();
    process.env.MEDHELP_SECURE_DISTRIBUTION = '1';
    delete process.env.MEDHELP_LOCAL_PAIRING_SKIP_CLOUD_TOKEN;
    process.env.MEDHELP_CLOUD_APP_URL = await startCloudAuthServer();

    const rejected = await requestJson('/api/local/session/start', {
      method: 'POST',
      body: {
        cloudUserId: 'cloud-user-1',
        cloudAccessToken: 'forged-token',
        cloudBaseUrl: 'http://127.0.0.1:1',
        origin: 'http://localhost:5173',
        browserNonce: 'secure-nonce-1',
        requestedPermissionMode: 'analysis',
      },
    });
    expect(rejected.response.status).toBe(401);
    expect(rejected.payload.code).toBe('CLOUD_AUTH_REJECTED');
    expect(rejected.payload).not.toHaveProperty('sessionToken');

    const accepted = await requestJson('/api/local/session/start', {
      method: 'POST',
      body: {
        cloudUserId: 'cloud-user-1',
        cloudAccessToken: 'valid-cloud-token',
        cloudBaseUrl: 'http://127.0.0.1:1',
        origin: 'http://localhost:5173',
        browserNonce: 'secure-nonce-2',
        requestedPermissionMode: 'analysis',
      },
    });
    expect(accepted.response.status).toBe(200);
    expect(accepted.payload.sessionToken).toEqual(expect.stringMatching(/^mh_loc_/));
  });

  it('rejects a valid online token when its user does not match the local session claim', async () => {
    await startLocalKernelTestServer();
    process.env.MEDHELP_SECURE_DISTRIBUTION = '1';
    delete process.env.MEDHELP_LOCAL_PAIRING_SKIP_CLOUD_TOKEN;
    process.env.MEDHELP_CLOUD_APP_URL = await startCloudAuthServer();

    const mismatch = await requestJson('/api/local/session/start', {
      method: 'POST',
      body: {
        cloudUserId: 'different-user',
        cloudAccessToken: 'valid-cloud-token',
        origin: 'http://localhost:5173',
        browserNonce: 'secure-nonce-3',
        requestedPermissionMode: 'analysis',
      },
    });

    expect(mismatch.response.status).toBe(403);
    expect(mismatch.payload.code).toBe('CLOUD_USER_MISMATCH');
    expect(mismatch.payload).not.toHaveProperty('sessionToken');
  });

  it.each(['/api/local/session/start', '/api/local/desktop-auth/sync'])(
    'rejects %s when the cloud denies device authorization even if the renderer skips activation',
    async (pathname) => {
      await startLocalKernelTestServer();
      process.env.MEDHELP_SECURE_DISTRIBUTION = '1';
      delete process.env.MEDHELP_LOCAL_PAIRING_SKIP_CLOUD_TOKEN;
      process.env.MEDHELP_CLOUD_APP_URL = await startCloudAuthServer({ status: 409 });
      const rejected = await requestJson(pathname, {
        method: 'POST',
        body: {
          cloudUserId: 'cloud-user-1', cloudAccessToken: 'valid-cloud-token',
          user: { id: 'cloud-user-1' }, accessToken: 'valid-cloud-token',
          browserNonce: 'skip-activation', countedAsDevice: true,
        },
      });
      expect(rejected.response.status).toBe(409);
      expect(rejected.payload).toMatchObject({ code: 'DEVICE_LIMIT_REACHED', maxDevices: 1 });
      expect(rejected.payload).not.toHaveProperty('sessionToken');
      expect(rejected.payload).not.toHaveProperty('saved');
    },
  );

  it('requires explicit device authorization rather than just a cloud user profile', async () => {
    await startLocalKernelTestServer();
    process.env.MEDHELP_SECURE_DISTRIBUTION = '1';
    delete process.env.MEDHELP_LOCAL_PAIRING_SKIP_CLOUD_TOKEN;
    process.env.MEDHELP_CLOUD_APP_URL = await startCloudAuthServer({ countedAsDevice: false });
    const rejected = await requestJson('/api/local/session/start', {
      method: 'POST',
      body: {
        cloudUserId: 'cloud-user-1', cloudAccessToken: 'valid-cloud-token', browserNonce: 'no-device-proof',
      },
    });
    expect(rejected.response.status).toBe(502);
    expect(rejected.payload).not.toHaveProperty('sessionToken');
  });

  it('pairs and renews against the deployed activation response without a user field', async () => {
    await startLocalKernelTestServer();
    process.env.MEDHELP_SECURE_DISTRIBUTION = '1';
    delete process.env.MEDHELP_LOCAL_PAIRING_SKIP_CLOUD_TOKEN;
    const authorization = { legacyResponse: true, requests: [] };
    process.env.MEDHELP_CLOUD_APP_URL = await startCloudAuthServer(authorization);
    const token = await createLocalSession({ cloudUserId: 'cloud-user-1', cloudAccessToken: 'valid-cloud-token' });
    const renewed = await requestJson('/api/local/session/cloud-auth', {
      method: 'POST', token,
      body: { cloudUserId: 'cloud-user-1', cloudAccessToken: 'valid-cloud-token' },
    });
    expect(renewed.response.status).toBe(200);
    expect(authorization.requests.map(({ path }) => path)).toEqual([
      '/api/auth/kernel-device/activate', '/api/auth/user',
      '/api/auth/kernel-device/activate', '/api/auth/user',
    ]);
    expect(authorization.requests.every((request) => request.authorization === 'Bearer valid-cloud-token')).toBe(true);
    expect(routeModule.verifyLocalSessionToken(token).userId).toBe('cloud-user-1');
  });

  it.each([
    [{ status: 409 }, 409, false],
    [{ countedAsDevice: false }, 502, false],
    [{ profileUserId: 'another-account' }, 403, true],
    [{ profileStatus: 401 }, 401, true],
    [{ profileStatus: 500 }, 502, true],
  ])('never bypasses device or identity checks for legacy responses: %j', async (scenario, expectedStatus, profileRequested) => {
    await startLocalKernelTestServer();
    process.env.MEDHELP_SECURE_DISTRIBUTION = '1';
    delete process.env.MEDHELP_LOCAL_PAIRING_SKIP_CLOUD_TOKEN;
    const authorization = { legacyResponse: true, requests: [], ...scenario };
    process.env.MEDHELP_CLOUD_APP_URL = await startCloudAuthServer(authorization);
    const result = await requestJson('/api/local/session/start', {
      method: 'POST',
      body: { cloudUserId: 'cloud-user-1', cloudAccessToken: 'valid-cloud-token', browserNonce: 'legacy-proof' },
    });
    expect(result.response.status).toBe(expectedStatus);
    expect(result.payload).not.toHaveProperty('sessionToken');
    expect(authorization.requests.some(({ path }) => path === '/api/auth/user')).toBe(profileRequested);
  });

  it('invalidates the paired local session immediately when device authorization is withdrawn', async () => {
    await startLocalKernelTestServer();
    process.env.MEDHELP_SECURE_DISTRIBUTION = '1';
    delete process.env.MEDHELP_LOCAL_PAIRING_SKIP_CLOUD_TOKEN;
    const authorization = { status: 200 };
    process.env.MEDHELP_CLOUD_APP_URL = await startCloudAuthServer(authorization);
    const token = await createLocalSession({ cloudUserId: 'cloud-user-1', cloudAccessToken: 'valid-cloud-token' });
    authorization.status = 409;
    const rejected = await requestJson('/api/local/session/cloud-auth', {
      method: 'POST', token,
      body: { cloudUserId: 'cloud-user-1', cloudAccessToken: 'valid-cloud-token' },
    });
    expect(rejected.response.status).toBe(409);
    expect(routeModule.verifyLocalSessionToken(token)).toBeNull();
    expect((await requestJson('/api/local/permissions', { token })).response.status).toBe(401);
  });

  it('rejects the removed Claude MCP endpoint through the authenticated local Kernel', async () => {
    await startLocalKernelTestServer();
    await fs.writeFile(path.join(tempRoot, '.claude.json'), JSON.stringify({
      mcpServers: {
        'windows-local-tools': {
          command: 'node.exe',
          args: ['C:\\Tools\\mcp-server.js'],
          env: { LOCAL_ONLY: '1' },
        },
      },
    }));

    const denied = await requestJson('/api/local/mcp/config/read');
    expect(denied.response.status).toBe(401);

    const token = await createLocalSession();
    const result = await requestJson('/api/local/mcp/config/read', { token });

    expect(result.response.status).toBe(410);
    expect(result.payload).toMatchObject({
      error: expect.stringContaining('removed'),
      piEndpoint: '/api/local/pi/services/integrations',
    });
  });

  it('refreshes cloud auth on an active local session and clears stale caches', async () => {
    await startLocalKernelTestServer();
    const token = await createLocalSession();
    const session = routeModule.verifyLocalSessionToken(token, 'http://localhost:5173');
    session.agentRuntimeEnvCache = { env: {}, expiresAtMs: Date.now() + 60_000 };
    session.userPreferenceContextCache = { context: {}, expiresAtMs: Date.now() + 60_000 };

    const refreshed = await requestJson('/api/local/session/cloud-auth', {
      method: 'POST',
      token,
      body: {
        cloudUserId: 'user-1',
        cloudAccessToken: 'cloud-token-new',
        cloudBaseUrl: 'https://app.medtimehelp.com',
      },
    });

    expect(refreshed.response.status).toBe(200);
    expect(refreshed.payload).toMatchObject({ ok: true, updated: true });
    expect(session.cloudAccessToken).toBe('cloud-token-new');
    expect(session.agentRuntimeEnvCache).toBeUndefined();
    expect(session.userPreferenceContextCache).toBeUndefined();
  });

  it('marks a cloud-auth refresh from another account as requiring re-pairing', async () => {
    await startLocalKernelTestServer();
    const token = await createLocalSession();

    const mismatch = await requestJson('/api/local/session/cloud-auth', {
      method: 'POST',
      token,
      body: {
        cloudUserId: 'another-user',
        cloudAccessToken: 'another-cloud-token',
        cloudBaseUrl: 'https://app.medtimehelp.com',
      },
    });

    expect(mismatch.response.status).toBe(403);
    expect(mismatch.payload).toMatchObject({
      code: 'CLOUD_USER_MISMATCH',
    });
  });

  it('exports legacy device memories only through an authenticated local session', async () => {
    await startLocalKernelTestServer();
    const localUser = database.userDb.createUser('legacy-memory-user', 'hash');
    database.userPreferenceMemoryDb.create(
      localUser.id,
      'Keep answers concise',
      'preference',
      'user',
    );

    const denied = await requestJson('/api/local/preferences/export');
    expect(denied.response.status).toBe(401);

    const token = await createLocalSession();
    const exported = await requestJson('/api/local/preferences/export', { token });

    expect(exported.response.status).toBe(200);
    expect(exported.payload.memories).toEqual([
      expect.objectContaining({ content: 'Keep answers concise', category: 'preference' }),
    ]);
  });

  it('stores default project paths through the local Kernel filesystem', async () => {
    await startLocalKernelTestServer();
    const token = await createLocalSession();
    const customerProjectRoot = path.join(tempRoot, 'CustomerProject');
    await fs.mkdir(customerProjectRoot, { recursive: true });
    const realCustomerProjectRoot = await fs.realpath(customerProjectRoot);

    const initialRoot = await requestJson('/api/local/projects/workspace-root', { token });
    expect(initialRoot.response.status).toBe(200);
    expect(initialRoot.payload.path).toBe(tempRoot);
    expect(initialRoot.payload.displayPath).toBe('~');

    const savedRoot = await requestJson('/api/local/projects/workspace-root', {
      method: 'PUT',
      token,
      body: { path: '~/CustomerProject' },
    });
    expect(savedRoot.response.status).toBe(200);
    expect(savedRoot.payload.path).toBe(customerProjectRoot);
    expect(savedRoot.payload.displayPath).toBe('~/CustomerProject');

    const browsedRoot = await requestJson('/api/local/browse-filesystem', { token });
    expect(browsedRoot.response.status).toBe(200);
    expect(browsedRoot.payload.displayPath).toBe('~/CustomerProject');

    const browsedHome = await requestJson(`/api/local/browse-filesystem?path=${encodeURIComponent('~')}`, { token });
    expect(browsedHome.response.status).toBe(200);
    expect(browsedHome.payload.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'CustomerProject',
          path: realCustomerProjectRoot,
          displayPath: '~/CustomerProject',
        }),
      ]),
    );

    const createdFolder = await requestJson('/api/local/create-folder', {
      method: 'POST',
      token,
      body: { path: '~/CreatedByBrowser' },
    });
    expect(createdFolder.response.status).toBe(200);
    expect(createdFolder.payload.path).toBe(await fs.realpath(path.join(tempRoot, 'CreatedByBrowser')));
    expect(createdFolder.payload.displayPath).toBe('~/CreatedByBrowser');

    const resetRoot = await requestJson('/api/local/projects/workspace-root', {
      method: 'PUT',
      token,
      body: { path: null },
    });
    expect(resetRoot.response.status).toBe(200);
    expect(resetRoot.payload.path).toBe(tempRoot);
  });

  it('creates and lists projects through the local Kernel project index', async () => {
    await startLocalKernelTestServer();
    const token = await createLocalSession();
    const existingProjectPath = path.join(tempRoot, 'ExistingProject');
    await fs.mkdir(existingProjectPath, { recursive: true });
    await fs.writeFile(path.join(existingProjectPath, 'original.txt'), 'preserve me', 'utf8');
    const realExistingProjectPath = await fs.realpath(existingProjectPath);

    const imported = await requestJson('/api/local/projects/create-workspace', {
      method: 'POST',
      token,
      body: {
        workspaceType: 'existing',
        path: '~/ExistingProject',
        displayName: 'Existing Project',
        connectionMode: 'localFolder',
      },
    });
    expect(imported.response.status).toBe(200);
    expect(imported.payload.project.fullPath).toBe(realExistingProjectPath);
    expect(await fs.readdir(realExistingProjectPath)).toEqual(['original.txt']);

    const created = await requestJson('/api/local/projects/create-workspace', {
      method: 'POST',
      token,
      body: {
        workspaceType: 'new',
        path: '~/NewProject',
        displayName: 'New Project',
      },
    });
    expect(created.response.status).toBe(200);
    const realNewProjectPath = await fs.realpath(path.join(tempRoot, 'NewProject'));
    expect(created.payload.project.fullPath).toBe(realNewProjectPath);
    expect((await fs.stat(realNewProjectPath)).isDirectory()).toBe(true);

    const listed = await requestJson('/api/local/projects', { token });
    expect(listed.response.status).toBe(200);
    expect(await fs.readdir(realExistingProjectPath)).toEqual(['original.txt']);
    expect(listed.payload).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fullPath: realExistingProjectPath,
          displayName: 'Existing Project',
        }),
        expect.objectContaining({
          fullPath: realNewProjectPath,
          displayName: 'New Project',
        }),
      ]),
    );
  });

  it('allows only known /ws/local message types', async () => {
    await startLocalKernelTestServer();
    const token = await createLocalSession();

    const socket = new WebSocket(`${wsUrl}?token=${encodeURIComponent(token)}`, {
      headers: { Origin: 'http://localhost:5173' },
    });

    const connected = await nextMessage(socket);
    expect(connected.type).toBe('status.connected');

    socket.send(JSON.stringify({ type: 'status.ping', requestId: 'ping-1' }));
    const pong = await nextMessage(socket);
    expect(pong).toMatchObject({ type: 'status.pong', requestId: 'ping-1' });

    socket.send(JSON.stringify({ type: 'shell.exec', requestId: 'bad-1' }));
    const rejected = await nextMessage(socket);
    expect(rejected).toMatchObject({
      type: 'local.error',
      requestId: 'bad-1',
      code: 'UNKNOWN_MESSAGE_TYPE',
    });

    socket.close();
  });

  it('requires a local session for session reads', async () => {
    await startLocalKernelTestServer();
    const unauth = await requestJson('/api/local/projects/Any/sessions');
    expect(unauth.response.status).toBe(401);
  });

  it('lists sessions for a created project through the local Kernel', async () => {
    await startLocalKernelTestServer();
    const token = await createLocalSession();
    const existingProjectPath = path.join(tempRoot, 'HistoryProject');
    await fs.mkdir(existingProjectPath, { recursive: true });

    const imported = await requestJson('/api/local/projects/create-workspace', {
      method: 'POST',
      token,
      body: { workspaceType: 'existing', path: '~/HistoryProject', displayName: 'History Project' },
    });
    expect(imported.response.status).toBe(200);
    const projectName = imported.payload.project.name;

    const listed = await requestJson(
      `/api/local/projects/${encodeURIComponent(projectName)}/sessions`,
      { token },
    );
    expect(listed.response.status).toBe(200);
    const sessions = Array.isArray(listed.payload) ? listed.payload : listed.payload.sessions;
    expect(Array.isArray(sessions)).toBe(true);
  });

});
