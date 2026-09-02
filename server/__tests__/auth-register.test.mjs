import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
const originalJwtSecret = process.env.JWT_SECRET;

let tempRoot = null;
let server = null;
let database = null;
let baseUrl = null;

async function startAuthServer() {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-local-auth-'));
  process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  process.env.JWT_SECRET = 'test-jwt-secret';
  vi.resetModules();
  database = await import('../database/db.js');
  await database.initializeDatabase();
  const authRoutes = (await import('../routes/auth.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  server = await new Promise((resolve) => {
    const nextServer = app.listen(0, '127.0.0.1', () => resolve(nextServer));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function requestJson(pathname, { method = 'GET', token = null, payload = null } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (payload !== null) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: payload === null ? undefined : JSON.stringify(payload),
  });
  return { response, body: await response.json() };
}

async function register(overrides = {}) {
  return requestJson('/api/auth/register', {
    method: 'POST',
    payload: {
      username: 'local-user',
      password: 'correct-horse-battery-staple',
      notificationEmail: 'local@example.com',
      acceptedLegalTerms: true,
      deviceFingerprint: 'local-device',
      ...overrides,
    },
  });
}

describe('local-only auth registration', () => {
  afterEach(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    server = null;
    if (database?.db?.open) database.db.close();
    database = null;
    vi.resetModules();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  });

  it('advertises immediate local registration without approval or email verification', async () => {
    await startAuthServer();
    const status = await requestJson('/api/auth/status');
    expect(status.body).toMatchObject({
      registrationEnabled: true,
      requireApproval: false,
      registrationEmailVerificationRequired: false,
    });
  });

  it('registers immediately with every product capability', async () => {
    await startAuthServer();
    const result = await register();
    expect(result.response.status).toBe(200);
    expect(result.body.pendingReview).toBe(false);
    expect(result.body.token).toEqual(expect.any(String));
    expect(result.body.user.effectivePlan).toBe('pro');
    expect(result.body.user.capabilities).toEqual(expect.arrayContaining([
      'agent.pi',
      'agent.claude',
      'agent.codex',
      'research.tasks',
      'conversations.archive',
    ]));
    expect(database.userDb.getUserByUsername('local-user').membership_plan).toBe('pro');
  });

  it('requires legal acceptance and keeps username/email uniqueness local', async () => {
    await startAuthServer();
    const missingLegal = await register({ acceptedLegalTerms: false });
    expect(missingLegal.response.status).toBe(400);
    expect(missingLegal.body.error).toContain('Legal terms');

    expect((await register()).response.status).toBe(200);
    const duplicate = await register({ username: 'another-user' });
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.body.error).toBe('Email is already registered');
  });

  it('logs in locally by username or email', async () => {
    await startAuthServer();
    expect((await register()).response.status).toBe(200);
    const login = await requestJson('/api/auth/login', {
      method: 'POST',
      payload: {
        username: 'LOCAL@example.com',
        password: 'correct-horse-battery-staple',
        deviceFingerprint: 'local-device',
      },
    });
    expect(login.response.status).toBe(200);
    expect(login.body.user.username).toBe('local-user');
    expect(login.body.user.effectivePlan).toBe('pro');
  });

  it('does not expose administrator endpoints', async () => {
    await startAuthServer();
    const result = await requestJson('/api/auth/admin/status');
    expect(result.response.status).toBe(404);
    expect(result.body.error).toContain('not available');
  });
});
