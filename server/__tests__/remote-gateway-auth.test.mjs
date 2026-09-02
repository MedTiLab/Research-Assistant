import express from 'express';
import fs from 'fs/promises';
import jwt from 'jsonwebtoken';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = {
  DATABASE_PATH: process.env.DATABASE_PATH,
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_PREVIOUS_SECRETS: process.env.JWT_PREVIOUS_SECRETS,
  JWT_SECRET_PREVIOUS: process.env.JWT_SECRET_PREVIOUS,
  JWT_ACCESS_TOKEN_TTL: process.env.JWT_ACCESS_TOKEN_TTL,
  JWT_REFRESH_TOKEN_TTL: process.env.JWT_REFRESH_TOKEN_TTL,
  GATEWAY_RATE_LIMIT_MAX: process.env.GATEWAY_RATE_LIMIT_MAX,
  GATEWAY_QUOTA_DATA_EXTRACT_PRO: process.env.GATEWAY_QUOTA_DATA_EXTRACT_PRO,
};

let tempRoot = null;
let server = null;
let baseUrl = null;
let database = null;

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

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function startServer() {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-remote-gateway-auth-'));
  process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.JWT_ACCESS_TOKEN_TTL = '15m';
  process.env.JWT_REFRESH_TOKEN_TTL = '7d';
  process.env.GATEWAY_RATE_LIMIT_MAX = '100';

  vi.resetModules();
  database = await import('../database/db.js');
  await database.initializeDatabase();

  const userA = database.userDb.createUser('gateway-owner', 'hash-a', 'owner@example.com');
  const userB = database.userDb.createUser('gateway-other', 'hash-b', 'other@example.com');
  const refreshedUserA = database.userDb.updateMembershipPlan(userA.id, 'pro');

  const { authenticateToken, generateAuthTokens } = await import('../middleware/auth.js');
  const authRoutes = (await import('../routes/auth.js')).default;
  const gatewayRoutes = (await import('../routes/gateway.js')).default;

  const app = express();
  app.use(express.json());
  app.get('/protected', authenticateToken, (req, res) => {
    res.json({ userId: req.user.id });
  });
  app.use('/api/auth', authRoutes);
  app.use('/api/gateway', authenticateToken, gatewayRoutes);

  server = await new Promise((resolve) => {
    const nextServer = app.listen(0, '127.0.0.1', () => resolve(nextServer));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const tokens = generateAuthTokens(refreshedUserA);
  const authorization = await requestJson('/api/auth/kernel-device/activate', {
    method: 'POST', token: tokens.accessToken, body: {},
  });
  expect(authorization.response.status).toBe(200);

  return {
    userA: refreshedUserA,
    userB,
    tokens,
  };
}

async function requestJson(pathname, { method = 'GET', token = null, body = null } = {}) {
  const headers = {};
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

describe('remote gateway auth hardening', () => {
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

  it('rejects expired access tokens', async () => {
    const { userA } = await startServer();
    const expiredToken = jwt.sign(
      { userId: userA.id, username: userA.username, tokenType: 'access' },
      'test-jwt-secret',
      { expiresIn: -1 },
    );

    const result = await requestJson('/protected', { token: expiredToken });

    expect(result.response.status).toBe(401);
    expect(result.payload).toEqual({ error: 'Invalid or expired token' });
  });

  it('refreshes a valid refresh token into a new access token', async () => {
    const { tokens, userA } = await startServer();

    const refreshed = await requestJson('/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken: tokens.refreshToken },
    });

    expect(refreshed.response.status).toBe(200);
    expect(refreshed.payload.accessToken).toEqual(expect.any(String));
    expect(refreshed.payload.refreshToken).toEqual(expect.any(String));
    expect(refreshed.payload.token).toBe(refreshed.payload.accessToken);

    const protectedResult = await requestJson('/protected', {
      token: refreshed.payload.accessToken,
    });
    expect(protectedResult.response.status).toBe(200);
    expect(protectedResult.payload).toEqual({ userId: userA.id });
  });

  it('denies unknown capabilities by default', async () => {
    const { tokens } = await startServer();

    const result = await requestJson('/api/gateway/authorize', {
      method: 'POST',
      token: tokens.accessToken,
      body: { capability: 'raw.sql' },
    });

    expect(result.response.status).toBe(403);
    expect(result.payload).toMatchObject({
      code: 'UNKNOWN_CAPABILITY',
      capability: 'raw.sql',
    });

    const usage = await requestJson('/api/gateway/usage', {
      token: tokens.accessToken,
    });
    expect(usage.response.status).toBe(200);
    expect(usage.payload.events[0]).toMatchObject({
      capability: 'raw.sql',
      code: 'UNKNOWN_CAPABILITY',
      status: 'denied',
    });
  });

  it('blocks cross-tenant resource access even when the plan includes the capability', async () => {
    const { tokens, userB } = await startServer();

    const result = await requestJson('/api/gateway/authorize', {
      method: 'POST',
      token: tokens.accessToken,
      body: {
        capability: 'data.extract',
        resourceOwnerId: userB.id,
      },
    });

    expect(result.response.status).toBe(403);
    expect(result.payload).toMatchObject({
      code: 'TENANT_FORBIDDEN',
      capability: 'data.extract',
      plan: 'pro',
    });
  });

  it('returns 402 before execution when a gateway quota is exceeded', async () => {
    process.env.GATEWAY_QUOTA_DATA_EXTRACT_PRO = '0';
    const { tokens } = await startServer();

    const result = await requestJson('/api/gateway/extract', {
      method: 'POST',
      token: tokens.accessToken,
      body: { source: 'mimiciv', variables: ['age'] },
    });

    expect(result.response.status).toBe(402);
    expect(result.payload).toMatchObject({
      code: 'QUOTA_EXCEEDED',
      capability: 'data.extract',
      plan: 'pro',
      quota: {
        limit: 0,
        used: 0,
        requestedUnits: 1,
      },
    });

    const usage = await requestJson('/api/gateway/usage', {
      token: tokens.accessToken,
    });
    expect(usage.payload.events[0]).toMatchObject({
      capability: 'data.extract',
      code: 'QUOTA_EXCEEDED',
      status: 'denied',
      source: 'mimiciv',
    });
  });

  it('exposes quota counters for the authenticated user', async () => {
    const { tokens, userA } = await startServer();
    database.gatewayDb.incrementQuotaCounter({
      userId: userA.id,
      capability: 'data.extract',
      units: 3,
    });

    const result = await requestJson('/api/gateway/quota', {
      token: tokens.accessToken,
    });

    expect(result.response.status).toBe(200);
    const extractQuota = result.payload.quota.find((item) => item.capability === 'data.extract');
    expect(extractQuota).toMatchObject({
      capability: 'data.extract',
      plan: 'pro',
      used: 3,
      limit: 10000,
      remaining: 9997,
    });
  });

  it('registers and lists gateway devices without trusting them for authorization', async () => {
    const { tokens } = await startServer();

    const first = await requestJson('/api/gateway/devices/register', {
      method: 'POST',
      token: tokens.accessToken,
      body: {
        deviceFingerprint: 'browser-test-device',
        label: 'Lab Mac',
      },
    });

    expect(first.response.status).toBe(200);
    expect(first.payload.device).toMatchObject({
      deviceFingerprint: 'browser-test-device',
      label: 'Lab Mac',
      isActive: true,
    });

    const updated = await requestJson('/api/gateway/devices/register', {
      method: 'POST',
      token: tokens.accessToken,
      body: {
        deviceFingerprint: 'browser-test-device',
        label: 'Lab Mac Updated',
      },
    });

    expect(updated.response.status).toBe(200);
    expect(updated.payload.device.id).toBe(first.payload.device.id);
    expect(updated.payload.device.label).toBe('Lab Mac Updated');

    const listed = await requestJson('/api/gateway/devices', {
      token: tokens.accessToken,
    });
    expect(listed.response.status).toBe(200);
    expect(listed.payload.devices).toHaveLength(1);
    expect(listed.payload.softLimitExceeded).toBe(false);
  });
});
