import express from 'express';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
let root;
let server;
let base;
let database;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'medhelp-companion-miniapps-'));
  process.env.DATABASE_PATH = path.join(root, 'auth.db');
  vi.resetModules();
  database = await import('../database/db.js');
  await database.initializeDatabase();
  database.userDb.createUser('feature-user', 'hash');

  const companionsRouter = (await import('../routes/companions.js')).default;
  const miniAppsRouter = (await import('../routes/mini-apps.js')).default;
  const app = express();
  app.use(express.json({ limit: '3mb' }));
  app.use((req, _res, next) => { req.user = { id: 1 }; next(); });
  app.use('/api/companions', companionsRouter);
  app.use('/api/mini-apps', miniAppsRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  database?.closeDatabase();
  vi.resetModules();
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
  await rm(root, { recursive: true, force: true });
});

function request(pathname, method = 'GET', body) {
  return fetch(`${base}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('desktop companion API', () => {
  it('creates independent companions and cascades their private memories', async () => {
    const firstResponse = await request('/companions', 'POST', { name: '小墨', avatar: 'ink' });
    expect(firstResponse.status).toBe(201);
    const first = (await firstResponse.json()).companion;
    expect(first).toMatchObject({ name: '小墨', avatar: 'ink', isDefault: true, desktopEnabled: false });

    const second = (await (await request('/companions', 'POST', { name: '团子', avatar: 'mochi' })).json()).companion;
    expect(second.isDefault).toBe(false);
    expect((await request(`/companions/${first.id}/memories`, 'POST', { content: '偏好简洁的结果表' })).status).toBe(201);
    expect((await (await request(`/companions/${first.id}/memories`)).json()).memories).toHaveLength(1);
    expect((await (await request(`/companions/${second.id}/memories`)).json()).memories).toHaveLength(0);

    expect((await request(`/companions/${first.id}`, 'DELETE')).status).toBe(200);
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM companion_memories').get().count).toBe(0);
    const remaining = (await (await request('/companions')).json()).companions;
    expect(remaining).toEqual([expect.objectContaining({ id: second.id, isDefault: true })]);
  });
});

describe('mini app API', () => {
  it('rejects fragments and persists a complete single-file HTML app', async () => {
    const invalid = await request('/mini-apps', 'POST', { name: '坏文档', html: '<div>fragment</div>' });
    expect(invalid.status).toBe(400);

    const html = '<!doctype html><html><body><button onclick="this.textContent=\'ok\'">run</button></body></html>';
    const createdResponse = await request('/mini-apps', 'POST', {
      name: '随机分组器', description: '本地研究工具', icon: '🧪', html,
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()).app;
    expect(created).toMatchObject({ name: '随机分组器', description: '本地研究工具', html });

    const listed = (await (await request('/mini-apps')).json()).apps;
    expect(listed).toEqual([expect.objectContaining({ id: created.id, name: '随机分组器' })]);
    expect(listed[0]).not.toHaveProperty('html');

    const updated = await request(`/mini-apps/${created.id}`, 'PUT', { name: '新版分组器' });
    expect((await updated.json()).app).toMatchObject({ name: '新版分组器', html });
    expect((await request(`/mini-apps/${created.id}`, 'DELETE')).status).toBe(200);
    expect((await request(`/mini-apps/${created.id}`)).status).toBe(404);
  });

  it('publishes an agent-built HTML file into My Apps', async () => {
    const appPath = path.join(root, 'literature-board.html');
    await writeFile(appPath, '<!doctype html><html><body><main>Literature board</main></body></html>');
    const { createAgentToolServices } = await import('../agent-runtime/tool-services.js');
    const services = createAgentToolServices({
      terminal: { shutdown: async () => {} },
      browser: { shutdown: async () => {} },
      integrations: { shutdown: async () => {} },
      automations: { stop: () => {} },
    });
    const context = {
      identity: { ownerKey: '1', projectKey: 'project-a', runtimeId: 'pi', sessionId: 'session-a' },
      userId: 1,
      projectRoot: root,
      permissionMode: 'auto',
    };
    const published = await services.execute('app_publish', {
      path: 'literature-board.html', name: '文献看板', description: '每周文献追踪', icon: '📚',
    }, context);
    expect(published).toMatchObject({ destination: 'My Apps', app: { name: '文献看板', icon: '📚' } });
    const listed = (await (await request('/mini-apps')).json()).apps;
    expect(listed).toEqual([expect.objectContaining({ id: published.app.id, name: '文献看板' })]);
  });
});
