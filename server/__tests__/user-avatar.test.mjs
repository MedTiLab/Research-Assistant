import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
const originalJwtSecret = process.env.JWT_SECRET;
const originalDataDir = process.env.MEDHELP_DATA_DIR;

let tempRoot = null;
let server = null;
let database = null;
let baseUrl = null;

async function closeServer() {
  if (!server) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  server = null;
  baseUrl = null;
}

async function startServer() {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-user-avatar-'));
  process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  process.env.MEDHELP_DATA_DIR = tempRoot;
  process.env.JWT_SECRET = 'test-jwt-secret';

  vi.resetModules();
  database = await import('../database/db.js');
  await database.initializeDatabase();
  database.appSettingsDb.set('require_registration_approval', 'false');

  const authRoutes = (await import('../routes/auth.js')).default;
  const userRoutes = (await import('../routes/user.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.use('/api/user', userRoutes);

  server = await new Promise((resolve) => {
    const nextServer = app.listen(0, '127.0.0.1', () => resolve(nextServer));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function requestJson(method, pathname, payload = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: payload == null ? undefined : JSON.stringify(payload),
  });
  const body = await response.json();
  return { response, body };
}

async function requestAvatarUpload(token) {
  const formData = new FormData();
  const pngBytes = Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
    0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0,
    9, 251, 3, 253, 160, 147, 129, 240, 0, 0, 0, 0, 73, 69, 78, 68,
    174, 66, 96, 130,
  ]);
  formData.append('avatar', new Blob([pngBytes], { type: 'image/png' }), 'avatar.png');

  const response = await fetch(`${baseUrl}/api/user/avatar`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });
  const body = await response.json();
  return { response, body };
}

describe('user avatars', () => {
  afterEach(async () => {
    await closeServer();

    if (database?.db?.open) {
      database.db.close();
    }
    database = null;

    vi.resetModules();

    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;

    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;

    if (originalDataDir === undefined) delete process.env.MEDHELP_DATA_DIR;
    else process.env.MEDHELP_DATA_DIR = originalDataDir;

    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('assigns a generated avatar and allows selecting a valid avatar', async () => {
    await startServer();

    const registration = await requestJson('POST', '/api/auth/register', {
      username: 'avatar-user',
      password: 'avatar-password',
      notificationEmail: 'avatar@example.com',
      acceptedLegalTerms: true,
    });

    expect(registration.response.status).toBe(200);
    expect(registration.body.user.avatarId).toEqual(expect.stringMatching(/^avatar-\d{2}$/));

    const token = registration.body.token;
    const rejected = await requestJson('PUT', '/api/user/profile', { avatarId: 'unknown-avatar' }, token);

    expect(rejected.response.status).toBe(400);
    expect(rejected.body).toEqual({ error: 'Invalid avatar selection' });

    const updated = await requestJson('PUT', '/api/user/profile', { avatarId: 'avatar-12' }, token);

    expect(updated.response.status).toBe(200);
    expect(updated.body.profile.avatarId).toBe('avatar-12');

    const currentUser = await requestJson('GET', '/api/auth/user', null, token);

    expect(currentUser.response.status).toBe(200);
    expect(currentUser.body.user.avatarId).toBe('avatar-12');
  });

  it('allows uploading a custom avatar and clears it when selecting a generated avatar', async () => {
    await startServer();

    const registration = await requestJson('POST', '/api/auth/register', {
      username: 'avatar-upload-user',
      password: 'avatar-password',
      notificationEmail: 'avatar-upload@example.com',
      acceptedLegalTerms: true,
    });

    expect(registration.response.status).toBe(200);

    const token = registration.body.token;
    const uploaded = await requestAvatarUpload(token);

    expect(uploaded.response.status).toBe(200);
    expect(uploaded.body.profile.avatarUrl).toEqual(expect.stringMatching(/^\/user-avatars\/user-\d+-.*\.webp$/));

    const selected = await requestJson('PUT', '/api/user/profile', { avatarId: 'avatar-08' }, token);

    expect(selected.response.status).toBe(200);
    expect(selected.body.profile.avatarId).toBe('avatar-08');
    expect(selected.body.profile.avatarUrl).toBeNull();
  });
});
