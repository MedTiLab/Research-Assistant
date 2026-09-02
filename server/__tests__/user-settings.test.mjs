import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
let tempRoot = null;

async function loadDatabase() {
  vi.resetModules();
  return import('../database/db.js');
}

describe('account-scoped user settings', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-user-settings-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });

  afterEach(async () => {
    vi.resetModules();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  });

  it('isolates connector settings by user', async () => {
    const { initializeDatabase, userDb, userSettingsDb } = await loadDatabase();
    await initializeDatabase();
    const userA = userDb.createUser('settings-user-a', 'hash');
    const userB = userDb.createUser('settings-user-b', 'hash');

    userSettingsDb.set(userA.id, 'auto_research_sender_email', 'a@example.com');
    userSettingsDb.set(userB.id, 'auto_research_sender_email', 'b@example.com');

    expect(userSettingsDb.get(userA.id, 'auto_research_sender_email')).toBe('a@example.com');
    expect(userSettingsDb.get(userB.id, 'auto_research_sender_email')).toBe('b@example.com');
  });

  it('isolates database API credentials by user', async () => {
    const { initializeDatabase, credentialsDb, userDb } = await loadDatabase();
    await initializeDatabase();
    const userA = userDb.createUser('database-user-a', 'hash');
    const userB = userDb.createUser('database-user-b', 'hash');

    credentialsDb.createCredential(
      userA.id,
      'Database API token A',
      'medhelp_database_api_token',
      'token-a',
    );
    credentialsDb.createCredential(
      userB.id,
      'Database API token B',
      'medhelp_database_api_token',
      'token-b',
    );

    expect(credentialsDb.getActiveCredential(userA.id, 'medhelp_database_api_token')).toBe('token-a');
    expect(credentialsDb.getActiveCredential(userB.id, 'medhelp_database_api_token')).toBe('token-b');
  });

  it('safely migrates a legacy sender when exactly one active user owns the database', async () => {
    const { initializeDatabase, userDb, appSettingsDb, userSettingsDb } = await loadDatabase();
    await initializeDatabase();
    const user = userDb.createUser('only-settings-user', 'hash');
    appSettingsDb.set('auto_research_sender_email', 'legacy@example.com');

    await initializeDatabase();

    expect(userSettingsDb.get(user.id, 'auto_research_sender_email')).toBe('legacy@example.com');
    expect(appSettingsDb.get('auto_research_sender_email')).toBeNull();
  });
});
