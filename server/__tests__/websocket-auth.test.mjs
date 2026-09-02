import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = {
  DATABASE_PATH: process.env.DATABASE_PATH,
  JWT_SECRET: process.env.JWT_SECRET,
  VITE_IS_PLATFORM: process.env.VITE_IS_PLATFORM,
};

let tempRoot = null;
let database = null;

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('WebSocket authentication', () => {
  afterEach(async () => {
    if (database?.db?.open) database.db.close();
    database = null;
    vi.resetModules();
    restoreEnv();
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  });

  it('accepts a valid local account session without throwing during policy checks', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-websocket-auth-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
    process.env.JWT_SECRET = 'websocket-auth-test-secret';
    delete process.env.VITE_IS_PLATFORM;

    vi.resetModules();
    database = await import('../database/db.js');
    await database.initializeDatabase();
    const user = database.userDb.createUser('websocket-user', 'hash');

    const { authenticateWebSocket, generateAuthTokens } = await import('../middleware/auth.js');
    const tokens = generateAuthTokens(user);
    const authenticated = authenticateWebSocket(tokens.accessToken, { clients: new Set() });

    expect(authenticated).toMatchObject({
      userId: user.id,
      username: user.username,
      sessionId: tokens.sessionId,
    });
  });
});
