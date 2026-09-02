import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { createAgentSessionKey } from '../utils/agentSessionIdentity.js';

const originalDatabasePath = process.env.DATABASE_PATH;
let tempRoot;
let databasePath;
let databaseModule;

async function initializeTestDatabase() {
  vi.resetModules();
  databaseModule = await import('../database/db.js');
  await databaseModule.initializeDatabase();
  return databaseModule;
}

describe('Session Persistence v2', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'medhelp-session-persistence-v2-'));
    databasePath = path.join(tempRoot, 'db', 'auth.db');
    await mkdir(path.dirname(databasePath), { recursive: true });
    process.env.DATABASE_PATH = databasePath;
  });

  afterEach(async () => {
    databaseModule?.closeDatabase?.();
    databaseModule = null;
    vi.resetModules();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('transactionally migrates legacy metadata, tags, and share references', async () => {
    const legacyDb = new Database(databasePath);
    legacyDb.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users (id, username, password_hash) VALUES (17, 'legacy-owner', 'hash');
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        user_id INTEGER,
        display_name TEXT,
        path TEXT NOT NULL,
        is_starred BOOLEAN DEFAULT 0,
        last_accessed DATETIME,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO projects (id, user_id, path) VALUES ('project-a', 17, '/tmp/project-a');
      CREATE TABLE session_metadata (
        id TEXT PRIMARY KEY,
        project_name TEXT NOT NULL,
        provider TEXT NOT NULL,
        display_name TEXT,
        last_activity DATETIME,
        message_count INTEGER DEFAULT 0,
        is_starred BOOLEAN DEFAULT 0,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO session_metadata (
        id, project_name, provider, display_name, message_count, metadata
      ) VALUES ('shared-id', 'project-a', 'codex', 'Legacy title', 4, '{"source":"legacy"}');
      CREATE TABLE project_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        tag_key TEXT NOT NULL,
        tag_type TEXT NOT NULL,
        label TEXT NOT NULL,
        color TEXT,
        sort_order INTEGER DEFAULT 0,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_name, tag_type, tag_key)
      );
      INSERT INTO project_tags (id, project_name, tag_key, tag_type, label)
      VALUES (1, 'project-a', 'literature', 'stage', 'Literature');
      CREATE TABLE session_tag_links (
        session_id TEXT NOT NULL,
        tag_id INTEGER NOT NULL,
        linked_by TEXT,
        source TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, tag_id)
      );
      INSERT INTO session_tag_links (session_id, tag_id, source)
      VALUES ('shared-id', 1, 'legacy');
      CREATE TABLE conversation_share_links (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        project_name TEXT NOT NULL,
        session_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'claude',
        visibility TEXT NOT NULL DEFAULT 'public',
        title TEXT,
        snapshot_json TEXT NOT NULL,
        message_count INTEGER DEFAULT 0,
        expires_at DATETIME,
        revoked_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_accessed_at DATETIME
      );
      INSERT INTO conversation_share_links (
        token, user_id, project_name, session_id, provider, snapshot_json
      ) VALUES ('share-a', 17, 'project-a', 'shared-id', 'codex', '{}');
      CREATE TABLE account_conversations (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'claude',
        title TEXT NOT NULL,
        project_label TEXT,
        messages_json TEXT NOT NULL,
        message_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, provider, session_id)
      );
      INSERT INTO account_conversations (
        id, user_id, session_id, provider, title, project_label, messages_json
      ) VALUES ('conversation-a', 17, 'shared-id', 'codex', 'Legacy archive', 'project-a', '[]');
    `);
    legacyDb.close();

    const database = await initializeTestDatabase();
    const expectedSessionKey = createAgentSessionKey({
      ownerKey: '17',
      projectKey: 'project-a',
      runtimeId: 'codex',
      sessionId: 'shared-id',
    });

    const legacyColumns = database.db.prepare('PRAGMA table_info(session_metadata)').all().map((row) => row.name);
    expect(legacyColumns).toEqual(expect.arrayContaining([
      'id',
      'project_name',
      'provider',
    ]));
    const v2Columns = database.db.prepare('PRAGMA table_info(session_metadata_v2)').all().map((row) => row.name);
    expect(v2Columns).toEqual(expect.arrayContaining([
      'session_key',
      'external_session_id',
      'owner_key',
      'project_key',
      'runtime_id',
    ]));
    expect(database.sessionDb.getSessionByKey(expectedSessionKey)).toMatchObject({
      id: 'shared-id',
      ownerKey: '17',
      projectKey: 'project-a',
      runtimeId: 'codex',
      display_name: 'Legacy title',
    });
    expect(database.db.prepare('SELECT session_key FROM session_tag_links_v2').get()).toEqual({
      session_key: expectedSessionKey,
    });
    expect(database.conversationShareDb.getByToken('share-a')).toMatchObject({
      sessionKey: expectedSessionKey,
      ownerKey: '17',
      projectKey: 'project-a',
      runtimeId: 'codex',
    });
    expect(database.accountConversationDb.getForUser(17, 'conversation-a')).toMatchObject({
      sessionKey: expectedSessionKey,
      ownerKey: '17',
      projectKey: 'project-a',
      runtimeId: 'codex',
    });
    expect(database.db.prepare('SELECT provider FROM session_metadata WHERE id = ?').get('shared-id')).toEqual({
      provider: 'codex',
    });
  });

  it('keeps the 1.1.20 bootstrap and legacy session CRUD usable after migration', async () => {
    let database = await initializeTestDatabase();

    expect(() => database.db.exec(`
      CREATE TABLE IF NOT EXISTS session_metadata (
        id TEXT PRIMARY KEY,
        project_name TEXT NOT NULL,
        provider TEXT NOT NULL,
        display_name TEXT,
        last_activity DATETIME,
        message_count INTEGER DEFAULT 0,
        is_starred BOOLEAN DEFAULT 0,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_session_metadata_project ON session_metadata(project_name);
      CREATE INDEX IF NOT EXISTS idx_session_metadata_provider ON session_metadata(provider);
      CREATE TABLE IF NOT EXISTS session_tag_links (
        session_id TEXT NOT NULL,
        tag_id INTEGER NOT NULL,
        linked_by TEXT,
        source TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, tag_id)
      );
      CREATE INDEX IF NOT EXISTS idx_session_tag_links_session ON session_tag_links(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_tag_links_tag ON session_tag_links(tag_id);
    `)).not.toThrow();

    database.db.prepare(`
      INSERT INTO session_metadata (id, project_name, provider, display_name)
      VALUES ('legacy-after-upgrade', 'project-legacy', 'claude', 'Written by 1.1.20')
    `).run();
    database.db.prepare(`
      UPDATE session_metadata SET display_name = 'Updated by 1.1.20'
      WHERE id = 'legacy-after-upgrade'
    `).run();
    database.closeDatabase();
    databaseModule = null;

    database = await initializeTestDatabase();
    expect(database.sessionDb.getSessionById('legacy-after-upgrade')).toMatchObject({
      id: 'legacy-after-upgrade',
      projectKey: 'project-legacy',
      runtimeId: 'claude',
      display_name: 'Updated by 1.1.20',
    });
  });

  it('repairs databases already migrated in place before the compatibility fix', async () => {
    const brokenDb = new Database(databasePath);
    brokenDb.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users (id, username, password_hash) VALUES (9, 'owner', 'hash');
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        user_id INTEGER,
        path TEXT NOT NULL
      );
      INSERT INTO projects (id, user_id, path) VALUES ('project-a', 9, '/tmp/project-a');
      CREATE TABLE project_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        tag_key TEXT NOT NULL,
        tag_type TEXT NOT NULL,
        label TEXT NOT NULL,
        UNIQUE(project_name, tag_type, tag_key)
      );
      CREATE TABLE session_metadata (
        session_key TEXT PRIMARY KEY,
        external_session_id TEXT NOT NULL,
        owner_key TEXT NOT NULL,
        project_key TEXT NOT NULL,
        runtime_id TEXT NOT NULL,
        display_name TEXT,
        last_activity DATETIME,
        message_count INTEGER DEFAULT 0,
        is_starred BOOLEAN DEFAULT 0,
        model_provider_id TEXT,
        model_id TEXT,
        catalog_revision INTEGER,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO session_metadata (
        session_key, external_session_id, owner_key, project_key, runtime_id, display_name
      ) VALUES ('v2-key', 'session-a', '9', 'project-a', 'codex', 'V2 title');
      CREATE TABLE session_tag_links (
        session_key TEXT NOT NULL,
        tag_id INTEGER NOT NULL,
        linked_by TEXT,
        source TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_key, tag_id)
      );
      CREATE TABLE session_metadata_v1_backup (
        id TEXT PRIMARY KEY,
        project_name TEXT NOT NULL,
        provider TEXT NOT NULL,
        display_name TEXT,
        last_activity DATETIME,
        message_count INTEGER DEFAULT 0,
        is_starred BOOLEAN DEFAULT 0,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO session_metadata_v1_backup (
        id, project_name, provider, display_name
      ) VALUES ('session-a', 'project-a', 'codex', 'Legacy title');
      CREATE TABLE session_tag_links_v1_backup (
        session_id TEXT NOT NULL,
        tag_id INTEGER NOT NULL,
        UNIQUE(session_id, tag_id)
      );
    `);
    brokenDb.close();

    const database = await initializeTestDatabase();
    const legacyColumns = database.db.prepare('PRAGMA table_info(session_metadata)').all().map((row) => row.name);
    expect(legacyColumns).toEqual(expect.arrayContaining(['id', 'project_name', 'provider']));
    expect(database.db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_session_metadata_provider'
    `).get()).toEqual({ name: 'idx_session_metadata_provider' });
    expect(database.db.prepare('SELECT external_session_id FROM session_metadata_v2').get()).toEqual({
      external_session_id: 'session-a',
    });
  });

  it('isolates identical external ids and rejects ambiguous legacy lookup', async () => {
    const database = await initializeTestDatabase();
    database.db.prepare(`
      INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)
    `).run(11, 'owner-11', 'hash');
    database.db.prepare(`
      INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)
    `).run(22, 'owner-22', 'hash');
    database.projectDb.upsertProject('project-a', 11, 'A', '/tmp/project-a');
    database.projectDb.upsertProject('project-b', 22, 'B', '/tmp/project-b');

    database.sessionDb.upsertSessionPlaceholder('same-id', 'project-a', 'claude');
    database.sessionDb.upsertSessionPlaceholder('same-id', 'project-a', 'codex');
    database.sessionDb.upsertSessionPlaceholder('same-id', 'project-b', 'claude');

    expect(database.sessionDb.findSessionsByExternalId('same-id')).toHaveLength(3);
    expect(() => database.sessionDb.getSessionById('same-id')).toThrowError(
      expect.objectContaining({ code: 'AGENT_SESSION_IDENTITY_CONFLICT' }),
    );
    expect(database.sessionDb.getSessionById('same-id', {
      ownerKey: '11',
      projectName: 'project-a',
      runtimeId: 'codex',
    })).toMatchObject({
      ownerKey: '11',
      projectKey: 'project-a',
      runtimeId: 'codex',
    });
  });
});
