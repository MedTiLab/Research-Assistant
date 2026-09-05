import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { stripInternalContextPrefix } from '../utils/sessionFormatting.js';
import { resolveAppDatabasePath } from '../utils/storagePaths.js';
import { getDefaultAvatarId, isValidAvatarId } from '../../shared/avatarCatalog.js';
import { ensurePreMigrationBackup, openManagedDatabase } from './databaseLifecycle.js';
import {
  createAgentSessionIdentity,
  createAgentSessionKey,
} from '../utils/agentSessionIdentity.js';
import {
  assertSafeLongTermMemoryContent,
  isSafeLongTermMemoryContent,
  normalizeLongTermMemoryContent,
} from '../user-memory/memory-policy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m',
};

const c = {
    info: (text) => `${colors.cyan}${text}${colors.reset}`,
    bright: (text) => `${colors.bright}${text}${colors.reset}`,
    dim: (text) => `${colors.dim}${text}${colors.reset}`,
};

const DEFAULT_STAGE_TAGS = [
  { tagKey: 'literature', label: 'Literature', color: 'sky', sortOrder: 10 },
  { tagKey: 'ideation', label: 'Ideation', color: 'amber', sortOrder: 20 },
  { tagKey: 'experiment', label: 'Experiment', color: 'cyan', sortOrder: 30 },
  { tagKey: 'publication', label: 'Publication', color: 'purple', sortOrder: 40 },
  { tagKey: 'promotion', label: 'Promotion', color: 'pink', sortOrder: 50 },
];
const STAGE_TAG_DECISIONS_KEY = 'stageTagDecisions';
const USER_PREFERENCE_MEMORY_MAX_ITEMS = 20;
const USER_PREFERENCE_MEMORY_CATEGORIES = new Set(['general', 'preference', 'context', 'workflow']);
const USER_PREFERENCE_MEMORY_SCOPES = new Set(['user', 'project']);
const USER_PROFILE_COLUMNS = [
  ['display_name', 'TEXT'],
  ['full_name', 'TEXT'],
  ['institution', 'TEXT'],
  ['organization', 'TEXT'],
  ['academic_title', 'TEXT'],
  ['research_field', 'TEXT'],
  ['usage_purpose', 'TEXT'],
  ['google_scholar_url', 'TEXT'],
  ['website_url', 'TEXT'],
  ['orcid', 'TEXT'],
  ['about_you', 'TEXT'],
  ['analysis_language_preference', "TEXT DEFAULT 'auto'"],
];
const USER_PROFILE_SELECT_COLUMNS = `
  id, username, avatar_id, avatar_url, notification_email,
  display_name, full_name, institution, organization, academic_title,
  research_field, usage_purpose, google_scholar_url, website_url,
  orcid, about_you, analysis_language_preference,
  membership_plan, membership_expires_at, trial_started_at, trial_expires_at, workspace_root,
  device_limit_override, device_overflow_policy,
  accepted_legal_terms, accepted_legal_terms_at, accepted_legal_terms_version
`;
const USER_PROFILE_UPDATE_COLUMNS = {
  displayName: 'display_name',
  fullName: 'full_name',
  institution: 'institution',
  organization: 'organization',
  academicTitle: 'academic_title',
  researchField: 'research_field',
  usagePurpose: 'usage_purpose',
  googleScholarUrl: 'google_scholar_url',
  websiteUrl: 'website_url',
  orcid: 'orcid',
  aboutYou: 'about_you',
  analysisLanguagePreference: 'analysis_language_preference',
};
const PROJECT_ACTIVITY_DEFAULT_DAYS = 365;
const PROJECT_ACTIVITY_MAX_DAYS = 366;
const PROJECT_ACTIVITY_MS_PER_DAY = 24 * 60 * 60 * 1000;

// Use DATABASE_PATH if provided, otherwise default to the home-scoped app data directory.
const DB_PATH = process.env.DATABASE_PATH || resolveAppDatabasePath();
const INIT_SQL_PATH = path.join(__dirname, 'init.sql');
const EMBEDDED_INIT_SQL = typeof globalThis.__MEDHELP_EMBEDDED_INIT_SQL__ === 'string'
  ? globalThis.__MEDHELP_EMBEDDED_INIT_SQL__
  : null;

// Ensure the chosen database directory exists before we attempt migrations or open the DB.
const dbDir = path.dirname(DB_PATH);
try {
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log(`Created database directory: ${dbDir}`);
  }
} catch (error) {
  console.error(`Failed to create database directory ${dbDir}:`, error.message);
  throw error;
}

// Migrate the legacy repo-local DB into the selected runtime location when present.
const LEGACY_DB_PATH = path.join(__dirname, 'auth.db');
const SHOULD_COPY_LEGACY_DB = !process.env.VITEST && process.env.NODE_ENV !== 'test';
if (SHOULD_COPY_LEGACY_DB && DB_PATH !== LEGACY_DB_PATH && !fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_DB_PATH)) {
  try {
    fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
    console.log(`[MIGRATION] Copied database from ${LEGACY_DB_PATH} to ${DB_PATH}`);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(LEGACY_DB_PATH + suffix)) {
        fs.copyFileSync(LEGACY_DB_PATH + suffix, DB_PATH + suffix);
      }
    }
  } catch (err) {
    console.warn(`[MIGRATION] Could not copy legacy database: ${err.message}`);
  }
}

// Create one crash-aware connection. Tests intentionally skip the cross-process
// owner lock because Vitest workers can import this singleton in parallel.
const managedDatabase = openManagedDatabase({
  Database,
  databasePath: DB_PATH,
  enableCrashGuard: !process.env.VITEST && process.env.NODE_ENV !== 'test',
});
const db = managedDatabase.db;
const databaseLifecycleStatus = Object.freeze({ ...managedDatabase.status });
let databaseClosed = false;

if (databaseLifecycleStatus.recoveredFromCorruption) {
  console.error(
    `[DATABASE RECOVERY] The previous database failed integrity checks and was preserved at ${databaseLifecycleStatus.quarantinePath}. A clean database has been started.`,
  );
}

export function getDatabaseLifecycleStatus() {
  return {
    priorRunUnclean: databaseLifecycleStatus.priorRunUnclean,
    recoveredFromCorruption: databaseLifecycleStatus.recoveredFromCorruption,
  };
}

export function closeDatabase() {
  if (databaseClosed) return;
  databaseClosed = true;
  managedDatabase.close();
}

if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
  process.once('exit', closeDatabase);
}

// Show app installation path prominently
const appInstallPath = path.join(__dirname, '../..');
console.log('');
console.log(c.dim('═'.repeat(60)));
console.log(`${c.info('[INFO]')} App Installation: ${c.bright(appInstallPath)}`);
console.log(`${c.info('[INFO]')} Database: ${c.dim(path.relative(appInstallPath, DB_PATH))}`);
if (process.env.DATABASE_PATH) {
  console.log(`       ${c.dim('(Using custom DATABASE_PATH from environment)')}`);
}
console.log(c.dim('═'.repeat(60)));
console.log('');

function normalizeLegacySessionProvider(provider) {
  const normalized = typeof provider === 'string' ? provider.trim().toLowerCase() : '';
  return normalized || 'claude';
}

function mapLegacyProviderToSessionPersistence(provider) {
  const legacyProvider = normalizeLegacySessionProvider(provider);
  if (legacyProvider === 'codex') {
    return { runtimeId: 'codex', modelProviderId: 'openai', legacyProvider };
  }
  if (legacyProvider === 'pi') {
    return { runtimeId: 'pi', modelProviderId: null, legacyProvider };
  }
  if (legacyProvider === 'openrouter') {
    return { runtimeId: 'claude', modelProviderId: 'byok-openai-compatible', legacyProvider };
  }
  if (legacyProvider === 'local') {
    return { runtimeId: 'claude', modelProviderId: 'local-openai-compatible', legacyProvider };
  }
  if (legacyProvider === 'claude') {
    return { runtimeId: 'claude', modelProviderId: 'anthropic', legacyProvider };
  }
  return { runtimeId: legacyProvider, modelProviderId: null, legacyProvider };
}

function tableColumns(tableName) {
  return db.prepare(`PRAGMA table_info("${tableName}")`).all().map((column) => column.name);
}

function tableExists(tableName) {
  return Boolean(db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(tableName));
}

function ensureTableColumn(tableName, columnName, definition) {
  if (!tableExists(tableName) || tableColumns(tableName).includes(columnName)) {
    return;
  }
  db.exec(`ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${definition}`);
}

function isSessionPersistenceV2Table(tableName) {
  if (!tableExists(tableName)) return false;
  const columns = tableColumns(tableName);
  return columns.includes('session_key')
    && columns.includes('external_session_id')
    && columns.includes('runtime_id');
}

// Session Persistence v2 originally replaced the 1.1.20 tables in place. That
// made the still-installed 1.1.20 kernel fail before its server could start,
// because its embedded init SQL creates indexes on project_name/provider. Move
// an already-migrated table to a sidecar name and restore the preserved v1
// tables before either version executes its normal schema bootstrap.
function restoreLegacySessionTableNamesForCompatibility() {
  if (!isSessionPersistenceV2Table('session_metadata')) return;

  const previousForeignKeys = Number(db.pragma('foreign_keys', { simple: true })) === 1;
  if (previousForeignKeys) db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`
        DROP INDEX IF EXISTS idx_session_metadata_project;
        DROP INDEX IF EXISTS idx_session_metadata_provider;
        DROP INDEX IF EXISTS idx_session_metadata_runtime;
        DROP INDEX IF EXISTS idx_session_metadata_external_id;
        DROP INDEX IF EXISTS idx_session_tag_links_session;
        DROP INDEX IF EXISTS idx_session_tag_links_tag;
      `);

      if (tableExists('session_metadata_v2')) {
        throw new Error('Cannot restore 1.1.20 compatibility while both session_metadata tables contain v2 schemas');
      }
      db.exec('ALTER TABLE session_metadata RENAME TO session_metadata_v2');
      if (tableExists('session_tag_links') && tableColumns('session_tag_links').includes('session_key')) {
        if (tableExists('session_tag_links_v2')) {
          throw new Error('Cannot restore 1.1.20 compatibility while both session tag tables contain v2 schemas');
        }
        db.exec('ALTER TABLE session_tag_links RENAME TO session_tag_links_v2');
      }

      if (tableExists('session_metadata_v1_backup')) {
        db.exec('ALTER TABLE session_metadata_v1_backup RENAME TO session_metadata');
      } else {
        db.exec(`
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
        `);
        const insertLegacy = db.prepare(`
          INSERT OR REPLACE INTO session_metadata (
            id, project_name, provider, display_name, last_activity,
            message_count, is_starred, metadata, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const v2Rows = db.prepare('SELECT * FROM session_metadata_v2 ORDER BY created_at ASC').all();
        for (const row of v2Rows) {
          let legacyProvider = row.runtime_id || 'claude';
          try {
            legacyProvider = JSON.parse(row.metadata || '{}').legacyProvider || legacyProvider;
          } catch {
            // Keep the runtime id when legacy metadata is malformed.
          }
          insertLegacy.run(
            row.external_session_id,
            row.project_key,
            legacyProvider,
            row.display_name || null,
            row.last_activity || null,
            Number(row.message_count || 0),
            Number(row.is_starred || 0),
            row.metadata || null,
            row.created_at || null,
          );
        }
      }

      if (tableExists('session_tag_links_v1_backup')) {
        db.exec('ALTER TABLE session_tag_links_v1_backup RENAME TO session_tag_links');
      } else if (!tableExists('session_tag_links')) {
        db.exec(`
          CREATE TABLE session_tag_links (
            session_id TEXT NOT NULL,
            tag_id INTEGER NOT NULL,
            linked_by TEXT,
            source TEXT,
            metadata TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(session_id, tag_id),
            FOREIGN KEY (session_id) REFERENCES session_metadata(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES project_tags(id) ON DELETE CASCADE
          );
          INSERT OR IGNORE INTO session_tag_links (
            session_id, tag_id, linked_by, source, metadata, created_at
          )
          SELECT sm.external_session_id, stl.tag_id, stl.linked_by,
                 stl.source, stl.metadata, stl.created_at
          FROM session_tag_links_v2 stl
          JOIN session_metadata_v2 sm ON sm.session_key = stl.session_key;
        `);
      }
    })();
  } finally {
    if (previousForeignKeys) db.pragma('foreign_keys = ON');
  }
}

function createSessionPersistenceV2Tables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_metadata_v2 (
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(owner_key, project_key, runtime_id, external_session_id)
    );
    CREATE TABLE IF NOT EXISTS session_tag_links_v2 (
      session_key TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      linked_by TEXT,
      source TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(session_key, tag_id),
      FOREIGN KEY (session_key) REFERENCES session_metadata_v2(session_key) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES project_tags(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_session_metadata_v2_project
      ON session_metadata_v2(owner_key, project_key);
    CREATE INDEX IF NOT EXISTS idx_session_metadata_v2_runtime
      ON session_metadata_v2(runtime_id);
    CREATE INDEX IF NOT EXISTS idx_session_metadata_v2_external_id
      ON session_metadata_v2(external_session_id);
    CREATE INDEX IF NOT EXISTS idx_session_tag_links_v2_session
      ON session_tag_links_v2(session_key);
    CREATE INDEX IF NOT EXISTS idx_session_tag_links_v2_tag
      ON session_tag_links_v2(tag_id);
  `);
}

function createSessionPersistenceCompatibilityTriggers() {
  db.exec(`
    DROP TRIGGER IF EXISTS trg_session_metadata_v2_legacy_insert;
    DROP TRIGGER IF EXISTS trg_session_metadata_v2_legacy_update;
    DROP TRIGGER IF EXISTS trg_session_metadata_v2_legacy_delete;
    DROP TRIGGER IF EXISTS trg_session_tag_links_v2_legacy_insert;
    DROP TRIGGER IF EXISTS trg_session_tag_links_v2_legacy_delete;

    CREATE TRIGGER trg_session_metadata_v2_legacy_insert
    AFTER INSERT ON session_metadata_v2
    BEGIN
      INSERT INTO session_metadata (
        id, project_name, provider, display_name, last_activity,
        message_count, is_starred, metadata, created_at
      ) VALUES (
        NEW.external_session_id,
        NEW.project_key,
        CASE WHEN json_valid(NEW.metadata)
          THEN COALESCE(json_extract(NEW.metadata, '$.legacyProvider'), NEW.runtime_id)
          ELSE NEW.runtime_id END,
        NEW.display_name, NEW.last_activity, NEW.message_count,
        NEW.is_starred, NEW.metadata, NEW.created_at
      )
      ON CONFLICT(id) DO UPDATE SET
        project_name = excluded.project_name,
        provider = excluded.provider,
        display_name = excluded.display_name,
        last_activity = excluded.last_activity,
        message_count = excluded.message_count,
        is_starred = excluded.is_starred,
        metadata = excluded.metadata;
    END;

    CREATE TRIGGER trg_session_metadata_v2_legacy_update
    AFTER UPDATE ON session_metadata_v2
    BEGIN
      INSERT INTO session_metadata (
        id, project_name, provider, display_name, last_activity,
        message_count, is_starred, metadata, created_at
      ) VALUES (
        NEW.external_session_id,
        NEW.project_key,
        CASE WHEN json_valid(NEW.metadata)
          THEN COALESCE(json_extract(NEW.metadata, '$.legacyProvider'), NEW.runtime_id)
          ELSE NEW.runtime_id END,
        NEW.display_name, NEW.last_activity, NEW.message_count,
        NEW.is_starred, NEW.metadata, NEW.created_at
      )
      ON CONFLICT(id) DO UPDATE SET
        project_name = excluded.project_name,
        provider = excluded.provider,
        display_name = excluded.display_name,
        last_activity = excluded.last_activity,
        message_count = excluded.message_count,
        is_starred = excluded.is_starred,
        metadata = excluded.metadata;
    END;

    CREATE TRIGGER trg_session_metadata_v2_legacy_delete
    AFTER DELETE ON session_metadata_v2
    WHEN NOT EXISTS (
      SELECT 1 FROM session_metadata_v2
      WHERE external_session_id = OLD.external_session_id
    )
    BEGIN
      DELETE FROM session_metadata WHERE id = OLD.external_session_id;
    END;

    CREATE TRIGGER trg_session_tag_links_v2_legacy_insert
    AFTER INSERT ON session_tag_links_v2
    BEGIN
      INSERT OR IGNORE INTO session_tag_links (
        session_id, tag_id, linked_by, source, metadata, created_at
      )
      SELECT external_session_id, NEW.tag_id, NEW.linked_by,
             NEW.source, NEW.metadata, NEW.created_at
      FROM session_metadata_v2 WHERE session_key = NEW.session_key;
    END;

    CREATE TRIGGER trg_session_tag_links_v2_legacy_delete
    AFTER DELETE ON session_tag_links_v2
    BEGIN
      DELETE FROM session_tag_links
      WHERE session_id = (
        SELECT external_session_id FROM session_metadata_v2
        WHERE session_key = OLD.session_key
      ) AND tag_id = OLD.tag_id;
    END;
  `);
}

function resolveMigratedSessionOwnerKey(projectKey, fallbackUserId = null) {
  const project = projectKey && tableExists('projects')
    ? db.prepare('SELECT user_id FROM projects WHERE id = ?').get(projectKey)
    : null;
  const ownerId = project?.user_id ?? fallbackUserId;
  return ownerId === null || ownerId === undefined || ownerId === ''
    ? 'local'
    : String(ownerId);
}

function migrateRelatedSessionIdentityColumns() {
  const relatedTables = [
    'conversation_share_links',
    'account_conversations',
    'feedback_submissions',
    'auto_research_runs',
  ];
  for (const tableName of relatedTables) {
    ensureTableColumn(tableName, 'session_key', 'TEXT');
    ensureTableColumn(tableName, 'owner_key', 'TEXT');
    ensureTableColumn(tableName, 'project_key', 'TEXT');
    ensureTableColumn(tableName, 'runtime_id', 'TEXT');
  }

  const findPersistedSession = db.prepare(`
    SELECT session_key, owner_key, project_key, runtime_id
    FROM session_metadata_v2
    WHERE external_session_id = ?
      AND (? IS NULL OR project_key = ?)
      AND runtime_id = ?
      AND (? IS NULL OR owner_key = ?)
    ORDER BY CASE WHEN project_key = ? THEN 0 ELSE 1 END, created_at ASC
  `);

  const backfillTable = ({ tableName, projectColumn, userColumn = 'user_id' }) => {
    if (!tableExists(tableName)) return;
    const columns = new Set(tableColumns(tableName));
    if (!columns.has('session_id')) return;

    const rows = db.prepare(`
      SELECT rowid AS persistence_rowid, *
      FROM "${tableName}"
      WHERE session_id IS NOT NULL
        AND trim(session_id) != ''
        AND (session_key IS NULL OR session_key = '')
    `).all();
    const update = db.prepare(`
      UPDATE "${tableName}"
      SET session_key = ?, owner_key = ?, project_key = ?, runtime_id = ?
      WHERE rowid = ?
    `);

    for (const row of rows) {
      const provider = row.provider || 'claude';
      const { runtimeId } = mapLegacyProviderToSessionPersistence(provider);
      const projectKey = projectColumn && row[projectColumn]
        ? String(row[projectColumn])
        : null;
      const fallbackOwner = userColumn && row[userColumn] !== null && row[userColumn] !== undefined
        ? String(row[userColumn])
        : null;
      const ownerKey = resolveMigratedSessionOwnerKey(projectKey, fallbackOwner);
      const matches = findPersistedSession.all(
        String(row.session_id),
        projectKey,
        projectKey,
        runtimeId,
        ownerKey,
        ownerKey,
        projectKey,
      );
      const persisted = matches.length === 1 ? matches[0] : null;
      const resolvedProjectKey = persisted?.project_key || projectKey || 'account';
      const resolvedOwnerKey = persisted?.owner_key || ownerKey;
      const identity = createAgentSessionIdentity({
        ownerKey: resolvedOwnerKey,
        projectKey: resolvedProjectKey,
        runtimeId: persisted?.runtime_id || runtimeId,
        sessionId: String(row.session_id),
      });
      update.run(
        persisted?.session_key || createAgentSessionKey(identity),
        identity.ownerKey,
        identity.projectKey,
        identity.runtimeId,
        row.persistence_rowid,
      );
    }
  };

  backfillTable({ tableName: 'conversation_share_links', projectColumn: 'project_name' });
  backfillTable({ tableName: 'account_conversations', projectColumn: 'project_label' });
  backfillTable({ tableName: 'feedback_submissions', projectColumn: 'project_name' });
  backfillTable({ tableName: 'auto_research_runs', projectColumn: 'project_name' });

  const accountConversationSchema = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'account_conversations'
  `).get()?.sql || '';
  if (!/UNIQUE\s*\(\s*user_id\s*,\s*session_key\s*\)/i.test(accountConversationSchema)) {
    db.exec(`
      ALTER TABLE account_conversations RENAME TO account_conversations_v1_migration;
      CREATE TABLE account_conversations (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'claude',
        session_key TEXT,
        owner_key TEXT,
        project_key TEXT,
        runtime_id TEXT,
        title TEXT NOT NULL,
        project_label TEXT,
        messages_json TEXT NOT NULL,
        message_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, session_key),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      INSERT INTO account_conversations (
        id, user_id, session_id, provider, session_key, owner_key, project_key, runtime_id,
        title, project_label, messages_json, message_count, created_at, updated_at
      )
      SELECT
        id, user_id, session_id, provider, session_key, owner_key, project_key, runtime_id,
        title, project_label, messages_json, message_count, created_at, updated_at
      FROM account_conversations_v1_migration;
      DROP TABLE account_conversations_v1_migration;
      CREATE INDEX IF NOT EXISTS idx_account_conversations_user_updated
        ON account_conversations(user_id, updated_at);
    `);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_conversation_share_links_session_key
      ON conversation_share_links(session_key);
    CREATE INDEX IF NOT EXISTS idx_account_conversations_session_key
      ON account_conversations(user_id, session_key);
    CREATE INDEX IF NOT EXISTS idx_feedback_submissions_session_key
      ON feedback_submissions(session_key);
    CREATE INDEX IF NOT EXISTS idx_auto_research_runs_session_key
      ON auto_research_runs(session_key);
  `);
}

function migrateSessionPersistenceV2() {
  const alreadyV2 = isSessionPersistenceV2Table('session_metadata_v2');
  createSessionPersistenceV2Tables();
  const legacySessions = db.prepare(`
    SELECT sm.*, p.user_id AS project_owner_user_id
    FROM session_metadata sm
    LEFT JOIN projects p ON p.id = sm.project_name
  `).all();
  const legacyTagLinks = tableExists('session_tag_links')
    ? db.prepare('SELECT * FROM session_tag_links').all()
    : [];

  if (!alreadyV2) {
    console.log('Running migration: Session Persistence v2 sidecar');
  }

  db.transaction(() => {
    const upsertSession = db.prepare(`
      INSERT INTO session_metadata_v2 (
        session_key, external_session_id, owner_key, project_key, runtime_id,
        display_name, last_activity, message_count, is_starred,
        model_provider_id, model_id, catalog_revision, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET
        display_name = excluded.display_name,
        last_activity = excluded.last_activity,
        message_count = excluded.message_count,
        is_starred = excluded.is_starred,
        metadata = excluded.metadata
    `);
    const keyByLegacyId = new Map();

    for (const row of legacySessions) {
      const { runtimeId, modelProviderId, legacyProvider } = mapLegacyProviderToSessionPersistence(row.provider);
      const ownerKey = row.project_owner_user_id === null || row.project_owner_user_id === undefined
        ? 'local'
        : String(row.project_owner_user_id);
      const identity = createAgentSessionIdentity({
        ownerKey,
        projectKey: row.project_name,
        runtimeId,
        sessionId: row.id,
      });
      let metadata = {};
      try {
        metadata = row.metadata ? JSON.parse(row.metadata) : {};
      } catch {
        metadata = {};
      }
      if (legacyProvider !== runtimeId) metadata.legacyProvider = legacyProvider;
      const sessionKey = createAgentSessionKey(identity);
      upsertSession.run(
        sessionKey,
        identity.sessionId,
        identity.ownerKey,
        identity.projectKey,
        identity.runtimeId,
        row.display_name || null,
        row.last_activity || null,
        Number(row.message_count || 0),
        Number(row.is_starred || 0),
        modelProviderId,
        null,
        null,
        Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
        row.created_at || null,
      );
      keyByLegacyId.set(String(row.id), sessionKey);
    }

    const insertTagLink = db.prepare(`
      INSERT OR IGNORE INTO session_tag_links_v2 (
        session_key, tag_id, linked_by, source, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const link of legacyTagLinks) {
      const sessionKey = keyByLegacyId.get(String(link.session_id));
      if (!sessionKey) continue;
      insertTagLink.run(
        sessionKey,
        link.tag_id,
        link.linked_by || null,
        link.source || null,
        link.metadata || null,
        link.created_at || null,
      );
    }
  })();

  const migratedLegacyCount = Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM session_metadata legacy
    WHERE EXISTS (
      SELECT 1 FROM session_metadata_v2 current
      WHERE current.external_session_id = legacy.id
        AND current.project_key = legacy.project_name
    )
  `).get().count);
  if (migratedLegacyCount !== legacySessions.length) {
    throw new Error(`Session Persistence v2 row-count mismatch: expected ${legacySessions.length}, got ${migratedLegacyCount}`);
  }
  const sessionTagForeignKeyViolations = db.pragma('foreign_key_check(session_tag_links_v2)');
  if (sessionTagForeignKeyViolations.length > 0) {
    throw new Error(`Session Persistence v2 foreign-key validation failed for ${sessionTagForeignKeyViolations.length} tag link(s)`);
  }

  createSessionPersistenceCompatibilityTriggers();
  db.transaction(migrateRelatedSessionIdentityColumns)();
}

function migrateMeetingLoopV1() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      meeting_date TEXT NOT NULL,
      meeting_type TEXT NOT NULL CHECK(meeting_type IN ('group', 'one_on_one', 'journal_club', 'progress')),
      my_role TEXT NOT NULL CHECK(my_role IN ('presenter', 'attendee')),
      location TEXT,
      project_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('upcoming', 'in_progress', 'done')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_meetings_user_date ON meetings(user_id, meeting_date);
    CREATE INDEX IF NOT EXISTS idx_meetings_user_status ON meetings(user_id, status);

    CREATE TABLE IF NOT EXISTS meeting_agenda_items (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('my_report', 'carryover_action', 'question_for_advisor', 'literature')),
      title TEXT NOT NULL,
      detail TEXT,
      source_ref TEXT,
      order_index INTEGER NOT NULL DEFAULT 0,
      done INTEGER NOT NULL DEFAULT 0 CHECK(done IN (0, 1)),
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_meeting_agenda_meeting_order ON meeting_agenda_items(meeting_id, order_index);

    CREATE TABLE IF NOT EXISTS meeting_transcript_segments (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      segment_index INTEGER NOT NULL,
      start_ms INTEGER NOT NULL DEFAULT 0,
      end_ms INTEGER NOT NULL DEFAULT 0,
      text TEXT NOT NULL DEFAULT '',
      speaker TEXT,
      status TEXT NOT NULL CHECK(status IN ('pending', 'transcribing', 'done', 'failed')),
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(meeting_id, segment_index),
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS meeting_notes (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      speaker TEXT,
      content TEXT NOT NULL,
      note_type TEXT NOT NULL CHECK(note_type IN ('feedback', 'decision', 'question', 'idea')),
      source_segment_id TEXT,
      promoted_action_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (source_segment_id) REFERENCES meeting_transcript_segments(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_meeting_notes_meeting ON meeting_notes(meeting_id, created_at);

    CREATE TABLE IF NOT EXISTS meeting_action_items (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      source_note_id TEXT,
      content TEXT NOT NULL,
      due_date TEXT,
      status TEXT NOT NULL CHECK(status IN ('open', 'in_progress', 'done', 'dropped')),
      owner TEXT NOT NULL DEFAULT 'me',
      task_id TEXT,
      project_id TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (source_note_id) REFERENCES meeting_notes(id) ON DELETE SET NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_meeting_actions_user_status_due ON meeting_action_items(user_id, status, due_date);

    CREATE TABLE IF NOT EXISTS meeting_attachments (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('recording', 'slides', 'transcript', 'handout')),
      file_path TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER,
      duration_ms INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_meeting_attachments_meeting ON meeting_attachments(meeting_id, created_at);

    CREATE TABLE IF NOT EXISTS meeting_reminder_deliveries (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      source_type TEXT NOT NULL CHECK(source_type IN ('meeting', 'action')),
      source_id TEXT NOT NULL,
      reminder_key TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'delivered')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      delivered_at TEXT,
      read_at TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, source_type, source_id, reminder_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_meeting_reminders_user_status_schedule
    ON meeting_reminder_deliveries(user_id, status, scheduled_for);
  `);

  ensureTableColumn('meeting_notes', 'promoted_action_id', 'TEXT');
  ensureTableColumn('meeting_reminder_deliveries', 'read_at', 'TEXT');
}

function migrateWorkbenchNotesV1() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workbench_calendar_todos (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
      project_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_workbench_calendar_user_date
      ON workbench_calendar_todos(user_id, date);

    CREATE TABLE IF NOT EXISTS workbench_notes (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('inbox', 'daily_focus', 'daily_goal')),
      content TEXT NOT NULL,
      day TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_workbench_notes_user_kind
      ON workbench_notes(user_id, kind, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workbench_notes_user_kind_day
      ON workbench_notes(user_id, kind, day) WHERE day IS NOT NULL;
  `);
}

function migrateResearchTrackingV1() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS research_theses (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      project_id TEXT,
      title TEXT NOT NULL,
      degree TEXT NOT NULL DEFAULT '博士',
      target_date TEXT,
      status TEXT NOT NULL DEFAULT 'planning' CHECK(status IN ('planning', 'writing', 'review', 'submitted', 'completed')),
      completion INTEGER NOT NULL DEFAULT 0 CHECK(completion BETWEEN 0 AND 100),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_research_theses_user_updated
      ON research_theses(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS research_thesis_chapters (
      id TEXT PRIMARY KEY,
      thesis_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'not_started' CHECK(status IN ('not_started', 'drafting', 'review', 'done')),
      completion INTEGER NOT NULL DEFAULT 0 CHECK(completion BETWEEN 0 AND 100),
      order_index INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (thesis_id) REFERENCES research_theses(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_research_thesis_chapters_order
      ON research_thesis_chapters(thesis_id, order_index, created_at);

    CREATE TABLE IF NOT EXISTS research_thesis_milestones (
      id TEXT PRIMARY KEY,
      thesis_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'done')),
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (thesis_id) REFERENCES research_theses(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_research_thesis_milestones_due
      ON research_thesis_milestones(thesis_id, status, due_date);

    CREATE TABLE IF NOT EXISTS research_thesis_logs (
      id TEXT PRIMARY KEY,
      thesis_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      minutes INTEGER NOT NULL DEFAULT 0 CHECK(minutes >= 0),
      words INTEGER NOT NULL DEFAULT 0 CHECK(words >= 0),
      note TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (thesis_id) REFERENCES research_theses(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_research_thesis_logs_date
      ON research_thesis_logs(thesis_id, date DESC, created_at DESC);

    CREATE TABLE IF NOT EXISTS research_manuscripts (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      project_id TEXT,
      title TEXT NOT NULL,
      short_title TEXT,
      status TEXT NOT NULL DEFAULT 'drafting' CHECK(status IN ('drafting', 'internal_review', 'ready', 'submitted', 'revision', 'published')),
      target_journal TEXT,
      completion INTEGER NOT NULL DEFAULT 0 CHECK(completion BETWEEN 0 AND 100),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_research_manuscripts_user_updated
      ON research_manuscripts(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS research_submissions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      manuscript_id TEXT NOT NULL,
      project_id TEXT,
      journal TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'journal_selected', 'presubmission_check', 'submitted', 'with_editor', 'under_review', 'minor_revision', 'major_revision', 'rejected', 'resubmitted', 'accepted', 'proof', 'published')),
      previous_status TEXT,
      submitted_at TEXT,
      status_changed_at TEXT,
      deadline TEXT,
      tracking_code TEXT,
      next_action TEXT,
      documents_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (manuscript_id) REFERENCES research_manuscripts(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_research_submissions_user_status_deadline
      ON research_submissions(user_id, status, deadline);

    CREATE TABLE IF NOT EXISTS workbench_attendance_logs (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_workbench_attendance_user_date
      ON workbench_attendance_logs(user_id, date, started_at);

    CREATE TABLE IF NOT EXISTS workbench_focus_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      task_title TEXT,
      started_at TEXT,
      ended_at TEXT,
      minutes INTEGER NOT NULL DEFAULT 0 CHECK(minutes >= 0),
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_workbench_focus_user_date
      ON workbench_focus_sessions(user_id, date, created_at);

    CREATE TABLE IF NOT EXISTS workbench_habits (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_workbench_habits_user_enabled
      ON workbench_habits(user_id, enabled, created_at);

    CREATE TABLE IF NOT EXISTS workbench_habit_entries (
      id TEXT PRIMARY KEY,
      habit_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
      value TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (habit_id) REFERENCES workbench_habits(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(habit_id, date)
    );
    CREATE INDEX IF NOT EXISTS idx_workbench_habit_entries_user_date
      ON workbench_habit_entries(user_id, date);

    CREATE TABLE IF NOT EXISTS workbench_daily_reviews (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      accomplishments TEXT NOT NULL DEFAULT '',
      obstacles TEXT NOT NULL DEFAULT '',
      insights TEXT NOT NULL DEFAULT '',
      tomorrow_priorities_json TEXT NOT NULL DEFAULT '[]',
      mood INTEGER CHECK(mood BETWEEN 1 AND 5),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, date)
    );
    CREATE INDEX IF NOT EXISTS idx_workbench_daily_reviews_user_date
      ON workbench_daily_reviews(user_id, date DESC);
  `);
}

const runMigrations = () => {
  try {
    migrateMeetingLoopV1();
    migrateWorkbenchNotesV1();
    migrateResearchTrackingV1();
    db.exec(`
      CREATE TABLE IF NOT EXISTS admin_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL CHECK(category IN ('login', 'operation', 'system')),
        level TEXT NOT NULL DEFAULT 'info' CHECK(level IN ('info', 'warning', 'error')),
        event TEXT NOT NULL,
        actor_name TEXT,
        target_type TEXT,
        target_id TEXT,
        ip_address TEXT,
        user_agent TEXT,
        message TEXT NOT NULL,
        metadata_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_category_created
      ON admin_audit_logs(category, created_at DESC, id DESC);
    `);

    const tableInfo = db.prepare("PRAGMA table_info(users)").all();
    const columnNames = tableInfo.map(col => col.name);

    if (!columnNames.includes('git_name')) {
      console.log('Running migration: Adding git_name column');
      db.exec('ALTER TABLE users ADD COLUMN git_name TEXT');
    }

    if (!columnNames.includes('git_email')) {
      console.log('Running migration: Adding git_email column');
      db.exec('ALTER TABLE users ADD COLUMN git_email TEXT');
    }

    if (!columnNames.includes('has_completed_onboarding')) {
      console.log('Running migration: Adding has_completed_onboarding column');
      db.exec('ALTER TABLE users ADD COLUMN has_completed_onboarding BOOLEAN DEFAULT 1');
    }

    // Onboarding is optional, so never block access on legacy/local installs.
    db.exec('UPDATE users SET has_completed_onboarding = 1 WHERE COALESCE(has_completed_onboarding, 0) = 0');

    if (!columnNames.includes('notification_email')) {
      console.log('Running migration: Adding notification_email column');
      db.exec('ALTER TABLE users ADD COLUMN notification_email TEXT');
    }

    if (!columnNames.includes('avatar_id')) {
      console.log('Running migration: Adding avatar_id column');
      db.exec('ALTER TABLE users ADD COLUMN avatar_id TEXT');
    }

    if (!columnNames.includes('avatar_url')) {
      console.log('Running migration: Adding avatar_url column');
      db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT');
    }

    if (!columnNames.includes('membership_plan')) {
      console.log('Running migration: Adding membership_plan column');
      db.exec("ALTER TABLE users ADD COLUMN membership_plan TEXT DEFAULT 'free'");
    }

    if (!columnNames.includes('membership_expires_at')) {
      console.log('Running migration: Adding membership_expires_at column');
      db.exec('ALTER TABLE users ADD COLUMN membership_expires_at DATETIME');
    }

    if (!columnNames.includes('device_limit_override')) {
      console.log('Running migration: Adding device_limit_override column');
      db.exec('ALTER TABLE users ADD COLUMN device_limit_override INTEGER');
    }

    if (!columnNames.includes('device_overflow_policy')) {
      console.log('Running migration: Adding device_overflow_policy column');
      db.exec('ALTER TABLE users ADD COLUMN device_overflow_policy TEXT');
    }

    if (!columnNames.includes('current_project_count')) {
      console.log('Running migration: Adding current_project_count column');
      db.exec('ALTER TABLE users ADD COLUMN current_project_count INTEGER');
    }

    if (!columnNames.includes('current_project_count_updated_at')) {
      console.log('Running migration: Adding current_project_count_updated_at column');
      db.exec('ALTER TABLE users ADD COLUMN current_project_count_updated_at DATETIME');
    }

    db.exec("UPDATE users SET membership_plan = 'pro' WHERE membership_plan NOT IN ('free', 'pro')");

    if (!columnNames.includes('trial_started_at')) {
      console.log('Running migration: Adding trial_started_at column');
      db.exec('ALTER TABLE users ADD COLUMN trial_started_at DATETIME');
    }

    if (!columnNames.includes('trial_expires_at')) {
      console.log('Running migration: Adding trial_expires_at column');
      db.exec('ALTER TABLE users ADD COLUMN trial_expires_at DATETIME');
    }

    const usersWithMissingAvatars = db.prepare(`
      SELECT id, username, avatar_id
      FROM users
      WHERE avatar_id IS NULL OR avatar_id = ''
    `).all();

    const usersWithInvalidAvatars = db.prepare(`
      SELECT id, username, avatar_id
      FROM users
      WHERE avatar_id IS NOT NULL AND avatar_id != ''
    `).all().filter((user) => !isValidAvatarId(user.avatar_id));

    const avatarUpdateStmt = db.prepare('UPDATE users SET avatar_id = ? WHERE id = ?');
    for (const user of [...usersWithMissingAvatars, ...usersWithInvalidAvatars]) {
      avatarUpdateStmt.run(getDefaultAvatarId(`${user.id}:${user.username}`), user.id);
    }

    if (!columnNames.includes('memory_enabled')) {
      console.log('Running migration: Adding memory_enabled column');
      db.exec('ALTER TABLE users ADD COLUMN memory_enabled BOOLEAN DEFAULT 1');
    }

    if (!columnNames.includes('workspace_root')) {
      console.log('Running migration: Adding workspace_root column');
      db.exec('ALTER TABLE users ADD COLUMN workspace_root TEXT');
    }

    if (!columnNames.includes('accepted_legal_terms')) {
      console.log('Running migration: Adding accepted_legal_terms column');
      db.exec('ALTER TABLE users ADD COLUMN accepted_legal_terms BOOLEAN DEFAULT 0');
    }

    if (!columnNames.includes('accepted_legal_terms_at')) {
      console.log('Running migration: Adding accepted_legal_terms_at column');
      db.exec('ALTER TABLE users ADD COLUMN accepted_legal_terms_at DATETIME');
    }

    if (!columnNames.includes('accepted_legal_terms_version')) {
      console.log('Running migration: Adding accepted_legal_terms_version column');
      db.exec('ALTER TABLE users ADD COLUMN accepted_legal_terms_version TEXT');
    }

    for (const [columnName, columnType] of USER_PROFILE_COLUMNS) {
      if (!columnNames.includes(columnName)) {
        console.log(`Running migration: Adding ${columnName} column`);
        db.exec(`ALTER TABLE users ADD COLUMN ${columnName} ${columnType}`);
      }
    }

    let registrationRequestsInfo = db.prepare("PRAGMA table_info(registration_requests)").all();
    let registrationRequestsColumns = registrationRequestsInfo.map((column) => column.name);
    if (registrationRequestsInfo.length > 0 && !registrationRequestsColumns.includes('accepted_legal_terms')) {
      console.log('Running migration: Adding accepted_legal_terms column to registration_requests');
      db.exec('ALTER TABLE registration_requests ADD COLUMN accepted_legal_terms BOOLEAN DEFAULT 0');
    }
    if (registrationRequestsInfo.length > 0 && !registrationRequestsColumns.includes('accepted_legal_terms_at')) {
      console.log('Running migration: Adding accepted_legal_terms_at column to registration_requests');
      db.exec('ALTER TABLE registration_requests ADD COLUMN accepted_legal_terms_at DATETIME');
    }
    if (registrationRequestsInfo.length > 0 && !registrationRequestsColumns.includes('accepted_legal_terms_version')) {
      console.log('Running migration: Adding accepted_legal_terms_version column to registration_requests');
      db.exec('ALTER TABLE registration_requests ADD COLUMN accepted_legal_terms_version TEXT');
    }

    registrationRequestsInfo = db.prepare("PRAGMA table_info(registration_requests)").all();
    registrationRequestsColumns = registrationRequestsInfo.map((column) => column.name);
    const registrationRequestsColumnSet = new Set(registrationRequestsColumns);

    const registrationRequestsSchema = db.prepare(`
      SELECT sql
      FROM sqlite_master
      WHERE type = 'table' AND name = 'registration_requests'
    `).get()?.sql || '';
    const hasLegacyRegistrationRequestUniqueness = (
      /UNIQUE\s*\(\s*username\s*,\s*status\s*\)/i.test(registrationRequestsSchema)
      || /UNIQUE\s*\(\s*notification_email\s*,\s*status\s*\)/i.test(registrationRequestsSchema)
    );
    const requiredRegistrationRequestColumns = [
      'id',
      'username',
      'notification_email',
      'password_hash',
      'status',
      'accepted_legal_terms',
      'accepted_legal_terms_at',
      'accepted_legal_terms_version',
      'review_note',
      'reviewed_by',
      'created_at',
      'reviewed_at',
    ];
    const hasLegacyRegistrationRequestShape = requiredRegistrationRequestColumns.some(
      (columnName) => !registrationRequestsColumnSet.has(columnName),
    );

    if (hasLegacyRegistrationRequestUniqueness || hasLegacyRegistrationRequestShape) {
      console.log('Running migration: Normalizing registration request history');
      const selectRegistrationRequestColumn = (columnName, fallback = 'NULL') => (
        registrationRequestsColumnSet.has(columnName) ? `"${columnName}"` : fallback
      );
      const reviewNoteExpression = registrationRequestsColumnSet.has('review_note')
        ? '"review_note"'
        : selectRegistrationRequestColumn('reviewer_note');
      const reviewedByExpression = registrationRequestsColumnSet.has('reviewed_by')
        ? '"reviewed_by"'
        : registrationRequestsColumnSet.has('approved_user_id')
          ? 'CAST("approved_user_id" AS TEXT)'
          : 'NULL';
      const createdAtExpression = registrationRequestsColumnSet.has('created_at')
        ? '"created_at"'
        : selectRegistrationRequestColumn('requested_at', 'CURRENT_TIMESTAMP');

      db.transaction(() => {
        db.exec(`
          ALTER TABLE registration_requests RENAME TO registration_requests_legacy_unique;

          CREATE TABLE registration_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            notification_email TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            accepted_legal_terms BOOLEAN DEFAULT 0,
            accepted_legal_terms_at DATETIME,
            accepted_legal_terms_version TEXT,
            review_note TEXT,
            reviewed_by TEXT,
            review_token_hash TEXT,
            request_ip TEXT,
            user_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            reviewed_at DATETIME
          );

          INSERT INTO registration_requests (
            id, username, notification_email, password_hash, status,
            accepted_legal_terms, accepted_legal_terms_at, accepted_legal_terms_version,
            review_note, reviewed_by, review_token_hash, request_ip, user_agent,
            created_at, reviewed_at
          )
          SELECT
            id, username, notification_email, password_hash, status,
            accepted_legal_terms, accepted_legal_terms_at, accepted_legal_terms_version,
            ${reviewNoteExpression}, ${reviewedByExpression},
            ${selectRegistrationRequestColumn('review_token_hash')},
            ${selectRegistrationRequestColumn('request_ip')},
            ${selectRegistrationRequestColumn('user_agent')},
            ${createdAtExpression}, ${selectRegistrationRequestColumn('reviewed_at')}
          FROM registration_requests_legacy_unique;

          DROP TABLE registration_requests_legacy_unique;
        `);
      })();
    }

    db.exec(`
      DROP INDEX IF EXISTS idx_registration_requests_pending_username;
      DROP INDEX IF EXISTS idx_registration_requests_pending_email;
      CREATE INDEX IF NOT EXISTS idx_registration_requests_status ON registration_requests(status);
      CREATE INDEX IF NOT EXISTS idx_registration_requests_username ON registration_requests(username);
      CREATE INDEX IF NOT EXISTS idx_registration_requests_email ON registration_requests(notification_email);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_registration_requests_pending_username
        ON registration_requests(username) WHERE status = 'pending';
      CREATE UNIQUE INDEX IF NOT EXISTS ux_registration_requests_pending_email
        ON registration_requests(notification_email) WHERE status = 'pending';
    `);

    const userMemoriesInfo = db.prepare("PRAGMA table_info(user_memories)").all();
    const userMemoriesColumns = userMemoriesInfo.map((column) => column.name);
    if (userMemoriesInfo.length > 0 && !userMemoriesColumns.includes('scope')) {
      console.log('Running migration: Adding scope column to user_memories');
      db.exec("ALTER TABLE user_memories ADD COLUMN scope TEXT DEFAULT 'user'");
    }
    if (userMemoriesInfo.length > 0 && !userMemoriesColumns.includes('project_path')) {
      console.log('Running migration: Adding project_path column to user_memories');
      db.exec('ALTER TABLE user_memories ADD COLUMN project_path TEXT');
    }
    if (userMemoriesInfo.length > 0 && !userMemoriesColumns.includes('project_key')) {
      console.log('Running migration: Adding project_key column to user_memories');
      db.exec('ALTER TABLE user_memories ADD COLUMN project_key TEXT');
    }

    const projectMemoryRows = db.prepare(`
      SELECT id, project_path
      FROM user_memories
      WHERE scope = 'project'
        AND (project_key IS NULL OR project_key = '')
        AND project_path IS NOT NULL
        AND project_path != ''
    `).all();
    const updateProjectMemoryKey = db.prepare('UPDATE user_memories SET project_key = ? WHERE id = ?');
    for (const row of projectMemoryRows) {
      const projectKey = String(row.project_path).split(/[\\/]+/).filter(Boolean).pop() || null;
      if (projectKey) {
        updateProjectMemoryKey.run(projectKey, row.id);
      }
    }

    // Migration: add FK from project_references.project_id → projects(id)
    const prInfo = db.prepare("PRAGMA table_info(project_references)").all();
    if (prInfo.length > 0) {
      const fkList = db.prepare("PRAGMA foreign_key_list(project_references)").all();
      const hasProjectFk = fkList.some(fk => fk.table === 'projects');
      if (!hasProjectFk) {
        console.log('Running migration: Recreating project_references with FK to projects');
        db.exec(`
          CREATE TABLE IF NOT EXISTS project_references_new (
            project_id TEXT NOT NULL,
            reference_id TEXT NOT NULL,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(project_id, reference_id),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (reference_id) REFERENCES references_library(id) ON DELETE CASCADE
          );
          INSERT OR IGNORE INTO project_references_new (project_id, reference_id, added_at)
            SELECT project_id, reference_id, added_at FROM project_references;
          DROP TABLE project_references;
          ALTER TABLE project_references_new RENAME TO project_references;
          CREATE INDEX IF NOT EXISTS idx_project_references_project ON project_references(project_id);
        `);
      }
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS registration_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        notification_email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        accepted_legal_terms BOOLEAN DEFAULT 0,
        accepted_legal_terms_at DATETIME,
        accepted_legal_terms_version TEXT,
        review_note TEXT,
        reviewed_by TEXT,
        review_token_hash TEXT,
        request_ip TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        reviewed_at DATETIME
      );
      CREATE INDEX IF NOT EXISTS idx_registration_requests_status ON registration_requests(status);
      CREATE INDEX IF NOT EXISTS idx_registration_requests_username ON registration_requests(username);
      CREATE INDEX IF NOT EXISTS idx_registration_requests_email ON registration_requests(notification_email);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_registration_requests_pending_username
        ON registration_requests(username) WHERE status = 'pending';
      CREATE UNIQUE INDEX IF NOT EXISTS ux_registration_requests_pending_email
        ON registration_requests(notification_email) WHERE status = 'pending';

      CREATE TABLE IF NOT EXISTS user_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        scope TEXT DEFAULT 'user',
        project_path TEXT,
        project_key TEXT,
        is_enabled BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_user_memories_user_id ON user_memories(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_memories_enabled ON user_memories(user_id, is_enabled);
      CREATE INDEX IF NOT EXISTS idx_user_memories_project_scope ON user_memories(user_id, scope, project_path);
      CREATE INDEX IF NOT EXISTS idx_user_memories_project_key ON user_memories(user_id, scope, project_key);

      CREATE TABLE IF NOT EXISTS user_long_term_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        content_key TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'automatic' CHECK(source IN ('automatic', 'manual')),
        conversation_id TEXT,
        is_pinned BOOLEAN NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, content_key)
      );
      CREATE INDEX IF NOT EXISTS idx_user_long_term_memories_user_updated
        ON user_long_term_memories(user_id, updated_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, key),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_user_settings_user ON user_settings(user_id);

      CREATE TABLE IF NOT EXISTS project_tags (
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
      CREATE INDEX IF NOT EXISTS idx_project_tags_project ON project_tags(project_name);
      CREATE INDEX IF NOT EXISTS idx_project_tags_type ON project_tags(tag_type);
      CREATE TABLE IF NOT EXISTS session_tag_links_v2 (
        session_key TEXT NOT NULL,
        tag_id INTEGER NOT NULL,
        linked_by TEXT,
        source TEXT,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_key, tag_id),
        FOREIGN KEY (session_key) REFERENCES session_metadata_v2(session_key) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES project_tags(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS project_activity_events (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        project_id TEXT NOT NULL,
        project_path TEXT,
        event_type TEXT NOT NULL DEFAULT 'project_open',
        occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        metadata_json TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_project_activity_user_time ON project_activity_events(user_id, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_project_activity_user_project ON project_activity_events(user_id, project_id);

      CREATE TABLE IF NOT EXISTS gateway_usage_events (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        capability TEXT NOT NULL,
        plan TEXT,
        status TEXT NOT NULL,
        code TEXT,
        resource_owner_id TEXT,
        source TEXT,
        units INTEGER DEFAULT 0,
        device_id TEXT,
        ip_address TEXT,
        user_agent TEXT,
        metadata_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_gateway_usage_user_time ON gateway_usage_events(user_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_gateway_usage_capability_time ON gateway_usage_events(capability, created_at);

      CREATE TABLE IF NOT EXISTS gateway_quota_counters (
        user_id INTEGER NOT NULL,
        capability TEXT NOT NULL,
        period_key TEXT NOT NULL,
        used_units INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, capability, period_key),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_gateway_quota_user ON gateway_quota_counters(user_id, period_key);

      CREATE TABLE IF NOT EXISTS gateway_devices (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        device_fingerprint TEXT NOT NULL,
        label TEXT,
        first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        user_agent TEXT,
        ip_address TEXT,
        is_active BOOLEAN DEFAULT 1,
        UNIQUE(user_id, device_fingerprint),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_gateway_devices_user ON gateway_devices(user_id, is_active);

      CREATE TABLE IF NOT EXISTS auth_device_sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        device_fingerprint_hash TEXT NOT NULL,
        device_label TEXT,
        refresh_token_hash TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        refresh_expires_at DATETIME,
        revoked_at DATETIME,
        revoked_reason TEXT,
        ip_address TEXT,
        user_agent TEXT,
        counts_as_device INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_auth_device_sessions_user_active
      ON auth_device_sessions(user_id, revoked_at, refresh_expires_at);
      CREATE INDEX IF NOT EXISTS idx_auth_device_sessions_fingerprint
      ON auth_device_sessions(user_id, device_fingerprint_hash);

      CREATE TABLE IF NOT EXISTS med_library_report_preview (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        project_name TEXT NOT NULL,
        project_display_name TEXT,
        relative_path TEXT NOT NULL,
        title TEXT,
        kb_upload_relative_path TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, project_name, relative_path),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ml_report_preview_user ON med_library_report_preview(user_id);

      CREATE TABLE IF NOT EXISTS med_library_core_rules (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        rule_slug TEXT NOT NULL,
        title TEXT NOT NULL,
        category TEXT,
        summary TEXT,
        trigger TEXT,
        correct_pattern TEXT,
        stage_hints_json TEXT,
        severity TEXT DEFAULT 'medium',
        status TEXT DEFAULT 'confirmed',
        source_kind TEXT DEFAULT 'lesson',
        metadata_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, rule_slug),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ml_core_rules_user ON med_library_core_rules(user_id);
      CREATE INDEX IF NOT EXISTS idx_ml_core_rules_status ON med_library_core_rules(user_id, status);

      CREATE TABLE IF NOT EXISTS med_library_operating_assets (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        asset_type TEXT NOT NULL,
        title TEXT NOT NULL,
        stage_key TEXT,
        stage_label TEXT,
        description TEXT,
        content_json TEXT NOT NULL,
        metadata_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ml_operating_assets_user ON med_library_operating_assets(user_id);
      CREATE INDEX IF NOT EXISTS idx_ml_operating_assets_type ON med_library_operating_assets(user_id, asset_type);

      CREATE TABLE IF NOT EXISTS pubmed_discovery_state (
        user_id INTEGER NOT NULL,
        state_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, state_key),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_pubmed_discovery_state_user ON pubmed_discovery_state(user_id);

      CREATE TABLE IF NOT EXISTS conversation_share_links (
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
        last_accessed_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_conversation_share_links_user ON conversation_share_links(user_id);
      CREATE INDEX IF NOT EXISTS idx_conversation_share_links_session ON conversation_share_links(project_name, session_id);
      CREATE INDEX IF NOT EXISTS idx_conversation_share_links_visibility ON conversation_share_links(visibility);

      CREATE TABLE IF NOT EXISTS account_conversations (
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
        UNIQUE(user_id, provider, session_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_account_conversations_user_updated
      ON account_conversations(user_id, updated_at);

      CREATE TABLE IF NOT EXISTS feedback_submissions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        project_name TEXT,
        project_path TEXT,
        session_id TEXT,
        provider TEXT,
        message TEXT NOT NULL,
        contact TEXT,
        page_url TEXT,
        user_agent TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        metadata_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        email_notified_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_feedback_submissions_user ON feedback_submissions(user_id);
      CREATE INDEX IF NOT EXISTS idx_feedback_submissions_status ON feedback_submissions(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_feedback_submissions_session ON feedback_submissions(project_name, session_id);
    `);

    migrateSessionPersistenceV2();

    const authSessionColumns = db.prepare("PRAGMA table_info(auth_device_sessions)").all().map((column) => column.name);
    if (!authSessionColumns.includes('client_type')) {
      console.log('Running migration: Adding auth device client_type column');
      db.exec('ALTER TABLE auth_device_sessions ADD COLUMN client_type TEXT');
    }
    if (!authSessionColumns.includes('client_version')) {
      console.log('Running migration: Adding auth device client_version column');
      db.exec('ALTER TABLE auth_device_sessions ADD COLUMN client_version TEXT');
    }
    if (!authSessionColumns.includes('client_platform')) {
      console.log('Running migration: Adding auth device client_platform column');
      db.exec('ALTER TABLE auth_device_sessions ADD COLUMN client_platform TEXT');
    }
    if (!authSessionColumns.includes('counts_as_device')) {
      console.log('Running migration: Adding auth device counts_as_device column');
      db.exec('ALTER TABLE auth_device_sessions ADD COLUMN counts_as_device INTEGER NOT NULL DEFAULT 1');
    }
    // Older releases revoked authentication sessions without releasing their
    // device flag. Preserve logout/expiry registrations, but never resurrect a
    // device that was explicitly removed or evicted from the allowed set.
    db.exec(`
      UPDATE auth_device_sessions
      SET counts_as_device = 0
      WHERE counts_as_device = 1
        AND revoked_reason IN (
          'admin-revoked',
          'user-revoked',
          'device-limit-evicted',
          'device-limit-changed'
        )
    `);

    // The legacy Auto Research sender was a process-wide setting. Preserve it only
    // when ownership is unambiguous, then remove the global value to prevent leaks.
    const legacySenderEmail = db.prepare(`
      SELECT value
      FROM app_settings
      WHERE key = 'auto_research_sender_email'
        AND value IS NOT NULL
        AND value != ''
    `).get();
    if (legacySenderEmail?.value) {
      const activeUsers = db.prepare('SELECT id FROM users WHERE is_active = 1 ORDER BY id').all();
      if (activeUsers.length === 1) {
        db.prepare(`
          INSERT INTO user_settings (user_id, key, value, updated_at)
          VALUES (?, 'auto_research_sender_email', ?, CURRENT_TIMESTAMP)
          ON CONFLICT(user_id, key) DO NOTHING
        `).run(activeUsers[0].id, legacySenderEmail.value);
        db.prepare("DELETE FROM app_settings WHERE key = 'auto_research_sender_email'").run();
        console.log('Running migration: Moved Auto Research sender email to the only active user');
      } else if (activeUsers.length > 1) {
        console.warn('Skipped legacy Auto Research sender migration because multiple active users exist');
      }
    }

    ensureTableColumn('user_long_term_memories', 'is_pinned', 'BOOLEAN NOT NULL DEFAULT 0');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_long_term_memories_user_pinned
        ON user_long_term_memories(user_id, is_pinned DESC, updated_at DESC, id DESC)
    `);

    console.log('Database migrations completed successfully');
  } catch (error) {
    console.error('Error running migrations:', error.message);
    throw error;
  }
};

// Initialize database with schema
const initializeDatabase = async () => {
  try {
    const usersTable = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = 'users'
      LIMIT 1
    `).get();

    if (usersTable) {
      const backupPath = await ensurePreMigrationBackup({
        db,
        databasePath: DB_PATH,
        version: process.env.npm_package_version || 'unknown',
        enabled: !process.env.VITEST
          && process.env.NODE_ENV !== 'test'
          && (process.env.NODE_ENV === 'production' || process.env.MEDHELP_DESKTOP === '1'),
      });
      if (backupPath) {
        console.log(`[MIGRATION] Verified pre-migration database backup: ${backupPath}`);
      }
    }

    restoreLegacySessionTableNamesForCompatibility();
    const initSQL = EMBEDDED_INIT_SQL || fs.readFileSync(INIT_SQL_PATH, 'utf8');
    db.exec(initSQL);

    if (!usersTable) {
      console.log('Database initialized successfully');
    } else {
      console.log('Database schema already exists, ensured base schema and applying migrations');
    }

    runMigrations();
  } catch (error) {
    console.error('Error initializing database:', error.message);
    throw error;
  }
};

// User database operations
const userDb = {
  // Check if any users exist
  hasUsers: () => {
    try {
      const row = db.prepare('SELECT COUNT(*) as count FROM users').get();
      return row.count > 0;
    } catch (err) {
      throw err;
    }
  },

  // Create a new user
  createUser: (username, passwordHash, notificationEmail = null, options = {}) => {
    try {
      const avatarId = getDefaultAvatarId(username);
      const trialDays = Number(options?.trialDays);
      const trialHours = Number(options?.trialHours);
      const trialDurationMs = (
        (Number.isFinite(trialDays) && trialDays > 0 ? trialDays * 24 : 0)
        + (Number.isFinite(trialHours) && trialHours > 0 ? trialHours : 0)
      ) * 60 * 60 * 1000;
      const trialExpiresAt = trialDurationMs > 0
        ? new Date(Date.now() + Math.round(trialDurationMs)).toISOString()
        : null;
      const acceptedLegalTerms = options?.acceptedLegalTerms === true ? 1 : 0;
      const acceptedLegalTermsAt = acceptedLegalTerms
        ? (options?.acceptedLegalTermsAt || new Date().toISOString())
        : null;
      const acceptedLegalTermsVersion = acceptedLegalTerms
        ? (options?.acceptedLegalTermsVersion || null)
        : null;
      const stmt = db.prepare(`
        INSERT INTO users (
          username, password_hash, avatar_id, notification_email, membership_plan,
          trial_started_at, trial_expires_at, has_completed_onboarding,
          accepted_legal_terms, accepted_legal_terms_at, accepted_legal_terms_version
        )
        VALUES (?, ?, ?, ?, 'free', CURRENT_TIMESTAMP, ?, 1, ?, ?, ?)
      `);
      const result = stmt.run(
        username,
        passwordHash,
        avatarId,
        notificationEmail,
        trialExpiresAt,
        acceptedLegalTerms,
        acceptedLegalTermsAt,
        acceptedLegalTermsVersion,
      );
      return {
        id: result.lastInsertRowid,
        username,
        avatar_id: avatarId,
        notification_email: notificationEmail,
        membership_plan: 'free',
        trial_started_at: new Date().toISOString(),
        trial_expires_at: trialExpiresAt,
        accepted_legal_terms: acceptedLegalTerms,
        accepted_legal_terms_at: acceptedLegalTermsAt,
        accepted_legal_terms_version: acceptedLegalTermsVersion,
      };
    } catch (err) {
      throw err;
    }
  },

  // Get user by username
  getUserByUsername: (username) => {
    try {
      const row = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
      return row;
    } catch (err) {
      throw err;
    }
  },

  getUserByLoginIdentifier: (identifier) => {
    try {
      const normalized = String(identifier || '').trim();
      if (normalized.includes('@')) {
        return db.prepare(`
          SELECT *
          FROM users
          WHERE LOWER(notification_email) = LOWER(?) AND is_active = 1
          ORDER BY id DESC
          LIMIT 1
        `).get(normalized);
      }
      return userDb.getUserByUsername(normalized);
    } catch (err) {
      throw err;
    }
  },

  resetSingleUser: () => {
    try {
      db.prepare('DELETE FROM users').run();
    } catch (err) {
      throw err;
    }
  },

  // Update last login time (non-fatal)
  updateLastLogin: (userId) => {
    try {
      db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
    } catch (err) {
      console.warn('Failed to update last login:', err.message);
    }
  },

  // Get user by ID
  getUserById: (userId) => {
    try {
      const row = db.prepare(`SELECT ${USER_PROFILE_SELECT_COLUMNS}, created_at, last_login FROM users WHERE id = ? AND is_active = 1`).get(userId);
      return row;
    } catch (err) {
      throw err;
    }
  },

  getUserAuthById: (userId) => {
    try {
      const row = db.prepare('SELECT id, username, password_hash FROM users WHERE id = ? AND is_active = 1').get(userId);
      return row;
    } catch (err) {
      throw err;
    }
  },

  getFirstUser: () => {
    try {
      const row = db.prepare(`SELECT ${USER_PROFILE_SELECT_COLUMNS}, created_at, last_login FROM users WHERE is_active = 1 LIMIT 1`).get();
      return row;
    } catch (err) {
      throw err;
    }
  },

  getWorkspaceRootUser: (userId) => {
    try {
      return db.prepare('SELECT id, username, workspace_root FROM users WHERE id = ? AND is_active = 1').get(userId);
    } catch (err) {
      throw err;
    }
  },

  updateWorkspaceRoot: (userId, workspaceRoot) => {
    try {
      db.prepare('UPDATE users SET workspace_root = ? WHERE id = ? AND is_active = 1').run(workspaceRoot || null, userId);
      return userDb.getWorkspaceRootUser(userId);
    } catch (err) {
      throw err;
    }
  },

  updateGitConfig: (userId, gitName, gitEmail) => {
    try {
      const stmt = db.prepare('UPDATE users SET git_name = ?, git_email = ? WHERE id = ?');
      stmt.run(gitName, gitEmail, userId);
    } catch (err) {
      throw err;
    }
  },

  getGitConfig: (userId) => {
    try {
      const row = db.prepare('SELECT git_name, git_email FROM users WHERE id = ?').get(userId);
      return row;
    } catch (err) {
      throw err;
    }
  },

  completeOnboarding: (userId) => {
    try {
      const stmt = db.prepare('UPDATE users SET has_completed_onboarding = 1 WHERE id = ?');
      stmt.run(userId);
    } catch (err) {
      throw err;
    }
  },

  hasCompletedOnboarding: (userId) => {
    try {
      const row = db.prepare('SELECT has_completed_onboarding FROM users WHERE id = ?').get(userId);
      return row?.has_completed_onboarding === 1;
    } catch (err) {
      throw err;
    }
  },

  getProfile: (userId) => {
    try {
      return db.prepare(`SELECT ${USER_PROFILE_SELECT_COLUMNS} FROM users WHERE id = ? AND is_active = 1`).get(userId);
    } catch (err) {
      throw err;
    }
  },

  updateProfile: (userId, updates = {}) => {
    try {
      const fields = [];
      const values = [];

      if (Object.prototype.hasOwnProperty.call(updates, 'notificationEmail')) {
        fields.push('notification_email = ?');
        values.push(updates.notificationEmail);
      }

      if (Object.prototype.hasOwnProperty.call(updates, 'avatarId')) {
        fields.push('avatar_id = ?');
        values.push(updates.avatarId);
      }

      if (Object.prototype.hasOwnProperty.call(updates, 'avatarUrl')) {
        fields.push('avatar_url = ?');
        values.push(updates.avatarUrl || null);
      }

      for (const [updateKey, columnName] of Object.entries(USER_PROFILE_UPDATE_COLUMNS)) {
        if (Object.prototype.hasOwnProperty.call(updates, updateKey)) {
          fields.push(`${columnName} = ?`);
          values.push(updates[updateKey] || null);
        }
      }

      if (fields.length > 0) {
        db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values, userId);
      }

      return userDb.getProfile(userId);
    } catch (err) {
      throw err;
    }
  },

  updatePassword: (userId, passwordHash) => {
    try {
      const result = db.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND is_active = 1').run(passwordHash, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  updatePasswordByUsername: (username, passwordHash) => {
    try {
      const result = db.prepare('UPDATE users SET password_hash = ? WHERE username = ?').run(passwordHash, username);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  countActiveUsers: () => {
    try {
      const row = db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_active = 1').get();
      return Number(row?.count || 0);
    } catch (err) {
      throw err;
    }
  },

  listAdminUsers: (includeInactive = false) => {
    try {
      return db.prepare(`
        SELECT
          u.*,
          COALESCE(
            u.current_project_count,
            (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id)
          ) AS project_count
        FROM users u
        ${includeInactive ? '' : 'WHERE u.is_active = 1'}
        ORDER BY u.is_active DESC, u.created_at DESC, u.id DESC
      `).all();
    } catch (err) {
      throw err;
    }
  },

  updateMembershipPlan: (userId, membershipPlan, membershipExpiresAt = undefined) => {
    try {
      if (membershipPlan === 'free') {
        db.prepare(`
          UPDATE users
          SET membership_plan = ?, membership_expires_at = NULL
          WHERE id = ? AND is_active = 1
        `).run(membershipPlan, userId);
      } else if (membershipExpiresAt === undefined) {
        db.prepare('UPDATE users SET membership_plan = ? WHERE id = ? AND is_active = 1').run(membershipPlan, userId);
      } else {
        db.prepare(`
          UPDATE users
          SET membership_plan = ?, membership_expires_at = ?
          WHERE id = ? AND is_active = 1
        `).run(membershipPlan, membershipExpiresAt, userId);
      }
      return userDb.getUserById(userId);
    } catch (err) {
      throw err;
    }
  },

  updateDevicePolicy: (userId, { maxDevices = null, overflowPolicy = null } = {}) => {
    try {
      db.prepare(`
        UPDATE users
        SET device_limit_override = ?, device_overflow_policy = ?
        WHERE id = ? AND is_active = 1
      `).run(maxDevices, overflowPolicy, userId);
      return userDb.getUserById(userId);
    } catch (err) {
      throw err;
    }
  },

  updateCurrentProjectCount: (userId, projectCount) => {
    try {
      const normalizedCount = Math.max(0, Math.min(10000, Math.floor(Number(projectCount))));
      if (!Number.isFinite(normalizedCount)) return false;
      const result = db.prepare(`
        UPDATE users
        SET current_project_count = ?, current_project_count_updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND is_active = 1
      `).run(normalizedCount, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  disableUser: (userId) => {
    try {
      const result = db.prepare('UPDATE users SET is_active = 0 WHERE id = ? AND is_active = 1').run(userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  enableUser: (userId) => {
    try {
      const result = db.prepare('UPDATE users SET is_active = 1 WHERE id = ? AND is_active = 0').run(userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  updateTrial: (userId, trialPatch = {}) => {
    try {
      const fields = [];
      const values = [];
      if (Object.prototype.hasOwnProperty.call(trialPatch, 'trialStartedAt')) {
        fields.push('trial_started_at = ?');
        values.push(trialPatch.trialStartedAt);
      }
      if (Object.prototype.hasOwnProperty.call(trialPatch, 'trialExpiresAt')) {
        fields.push('trial_expires_at = ?');
        values.push(trialPatch.trialExpiresAt);
      }
      if (fields.length === 0) {
        return userDb.getUserById(userId);
      }
      db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ? AND is_active = 1`).run(...values, userId);
      return userDb.getUserById(userId);
    } catch (err) {
      throw err;
    }
  },

  deleteUser: (userId) => {
    try {
      const result = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  listProjectIdsForUser: (userId) => {
    try {
      return db.prepare('SELECT id FROM projects WHERE user_id = ?').all(userId).map((row) => row.id);
    } catch (err) {
      throw err;
    }
  },

  deleteUsersProjects: (userId) => {
    try {
      const projectIds = db.prepare('SELECT id FROM projects WHERE user_id = ?').all(userId).map((row) => row.id);
      db.prepare('DELETE FROM session_metadata_v2 WHERE project_key IN (SELECT id FROM projects WHERE user_id = ?)').run(userId);
      db.prepare('DELETE FROM project_references WHERE project_id IN (SELECT id FROM projects WHERE user_id = ?)').run(userId);
      db.prepare('DELETE FROM projects WHERE user_id = ?').run(userId);
      return projectIds;
    } catch (err) {
      throw err;
    }
  },

  preserveUsersProjects: (userId) => {
    try {
      db.prepare('UPDATE projects SET user_id = NULL WHERE user_id = ?').run(userId);
      return true;
    } catch (err) {
      throw err;
    }
  },

  getAdminUserById: (userId) => {
    try {
      return db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    } catch (err) {
      throw err;
    }
  },

  isRegistrationClosed: () => false,
};

function mapAuthDeviceSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: Number(row.user_id),
    deviceFingerprintHash: row.device_fingerprint_hash,
    deviceLabel: row.device_label || null,
    createdAt: row.device_registered_at || row.created_at || null,
    lastSeenAt: row.last_seen_at || null,
    refreshExpiresAt: row.refresh_expires_at || null,
    revokedAt: row.revoked_at || null,
    revokedReason: row.revoked_reason || null,
    ipAddress: row.ip_address || null,
    userAgent: row.user_agent || null,
    clientType: row.client_type || null,
    clientVersion: row.client_version || null,
    clientPlatform: row.client_platform || null,
    countsAsDevice: row.counts_as_device !== 0,
    activeSessionId: row.active_session_id || null,
    activeLastSeenAt: row.active_last_seen_at || null,
    registrationOrder: Number(row.device_registration_order || 0),
  };
}

function activeAuthSessionWhere(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return `${prefix}revoked_at IS NULL
    AND (${prefix}refresh_expires_at IS NULL OR datetime(${prefix}refresh_expires_at) > datetime('now'))`;
}

function listCountedDeviceRows(userId) {
  return db.prepare(`
    SELECT representative.*,
      (
        SELECT MIN(registered.created_at)
        FROM auth_device_sessions registered
        WHERE registered.user_id = representative.user_id
          AND registered.device_fingerprint_hash = representative.device_fingerprint_hash
          AND registered.counts_as_device = 1
      ) AS device_registered_at,
      (
        SELECT MIN(registered.rowid)
        FROM auth_device_sessions registered
        WHERE registered.user_id = representative.user_id
          AND registered.device_fingerprint_hash = representative.device_fingerprint_hash
          AND registered.counts_as_device = 1
      ) AS device_registration_order,
      (
        SELECT active.id
        FROM auth_device_sessions active
        WHERE active.user_id = representative.user_id
          AND active.device_fingerprint_hash = representative.device_fingerprint_hash
          AND active.counts_as_device = 1
          AND ${activeAuthSessionWhere('active')}
        ORDER BY datetime(active.last_seen_at) DESC, datetime(active.created_at) DESC, active.id DESC
        LIMIT 1
      ) AS active_session_id,
      (
        SELECT active.last_seen_at
        FROM auth_device_sessions active
        WHERE active.user_id = representative.user_id
          AND active.device_fingerprint_hash = representative.device_fingerprint_hash
          AND active.counts_as_device = 1
          AND ${activeAuthSessionWhere('active')}
        ORDER BY datetime(active.last_seen_at) DESC, datetime(active.created_at) DESC, active.id DESC
        LIMIT 1
      ) AS active_last_seen_at
    FROM auth_device_sessions representative
    WHERE representative.user_id = ?
      AND representative.counts_as_device = 1
      AND representative.id = (
        SELECT latest.id
        FROM auth_device_sessions latest
        WHERE latest.user_id = representative.user_id
          AND latest.device_fingerprint_hash = representative.device_fingerprint_hash
          AND latest.counts_as_device = 1
        ORDER BY datetime(latest.last_seen_at) DESC, datetime(latest.created_at) DESC, latest.id DESC
        LIMIT 1
      )
    ORDER BY datetime(representative.last_seen_at) DESC,
      datetime(device_registered_at) DESC,
      representative.id DESC
  `).all(userId);
}

function releaseCountedDevice(userId, fingerprintHash, reason) {
  const activeRows = db.prepare(`
    SELECT id
    FROM auth_device_sessions
    WHERE user_id = ? AND device_fingerprint_hash = ?
      AND counts_as_device = 1 AND ${activeAuthSessionWhere()}
  `).all(userId, fingerprintHash);

  const result = db.prepare(`
    UPDATE auth_device_sessions
    SET counts_as_device = 0,
        revoked_at = CASE WHEN revoked_at IS NULL THEN CURRENT_TIMESTAMP ELSE revoked_at END,
        revoked_reason = CASE WHEN revoked_at IS NULL THEN ? ELSE revoked_reason END
    WHERE user_id = ? AND device_fingerprint_hash = ? AND counts_as_device = 1
  `).run(reason, userId, fingerprintHash);

  return {
    released: result.changes > 0,
    revokedSessionIds: activeRows.map((row) => row.id),
  };
}

const authSessionDb = {
  generateId: () => `auth_sess_${crypto.randomBytes(18).toString('base64url')}`,

  hashDeviceFingerprint: (fingerprint) => crypto
    .createHash('sha256')
    .update(String(fingerprint || ''))
    .digest('hex'),

  hashRefreshToken: (token) => crypto
    .createHash('sha256')
    .update(String(token || ''))
    .digest('hex'),

  pruneExpired: (userId = null) => {
    const whereUser = userId == null ? '' : 'AND user_id = ?';
    const params = userId == null ? [] : [userId];
    return db.prepare(`
      UPDATE auth_device_sessions
      SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP),
          revoked_reason = COALESCE(revoked_reason, 'expired')
      WHERE revoked_at IS NULL
        AND refresh_expires_at IS NOT NULL
        AND datetime(refresh_expires_at) <= datetime('now')
        ${whereUser}
    `).run(...params).changes;
  },

  createWithLimit: (input = {}) => {
    const create = db.transaction(() => {
      authSessionDb.pruneExpired(input.userId);
      const fingerprintHash = String(input.deviceFingerprintHash || '').trim();
      if (!fingerprintHash) {
        throw new Error('Device fingerprint hash is required');
      }

      const sameDeviceSessions = db.prepare(`
        SELECT id
        FROM auth_device_sessions
        WHERE user_id = ? AND device_fingerprint_hash = ? AND ${activeAuthSessionWhere()}
      `).all(input.userId, fingerprintHash);

      const revokedSessionIds = sameDeviceSessions.map((session) => session.id);
      if (revokedSessionIds.length > 0) {
        const placeholders = revokedSessionIds.map(() => '?').join(', ');
        db.prepare(`
          UPDATE auth_device_sessions
          SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'same-device-login'
          WHERE id IN (${placeholders})
        `).run(...revokedSessionIds);
      }

      const countsAsDevice = input.countsAsDevice !== false;
      const registeredDevice = countsAsDevice
        ? db.prepare(`
          SELECT id
          FROM auth_device_sessions
          WHERE user_id = ? AND device_fingerprint_hash = ? AND counts_as_device = 1
          LIMIT 1
        `).get(input.userId, fingerprintHash)
        : null;
      const registeredDevices = countsAsDevice && !registeredDevice
        ? listCountedDeviceRows(input.userId)
        : [];

      const maxDevices = input.maxDevices == null ? null : Math.max(1, Math.floor(Number(input.maxDevices)));
      if (maxDevices !== null && registeredDevices.length >= maxDevices) {
        if (input.overflowPolicy !== 'evict-oldest') {
          const error = new Error(`This account is limited to ${maxDevices} device${maxDevices === 1 ? '' : 's'}`);
          error.code = 'DEVICE_LIMIT_REACHED';
          error.maxDevices = maxDevices;
          throw error;
        }

        const evictCount = registeredDevices.length - maxDevices + 1;
        const evictedDevices = [...registeredDevices]
          .sort((left, right) => new Date(left.device_registered_at || 0) - new Date(right.device_registered_at || 0)
            || left.device_registration_order - right.device_registration_order)
          .slice(0, evictCount);
        for (const evictedDevice of evictedDevices) {
          const released = releaseCountedDevice(
            input.userId,
            evictedDevice.device_fingerprint_hash,
            'device-limit-evicted',
          );
          revokedSessionIds.push(...released.revokedSessionIds);
        }
      }

      const id = input.id || authSessionDb.generateId();
      db.prepare(`
        INSERT INTO auth_device_sessions (
          id, user_id, device_fingerprint_hash, device_label, ip_address, user_agent,
          client_type, client_version, client_platform, counts_as_device
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.userId,
        fingerprintHash,
        input.deviceLabel || null,
        input.ipAddress || null,
        input.userAgent || null,
        input.clientType || null,
        input.clientVersion || null,
        input.clientPlatform || null,
        countsAsDevice ? 1 : 0,
      );

      return {
        session: mapAuthDeviceSession(db.prepare('SELECT * FROM auth_device_sessions WHERE id = ?').get(id)),
        revokedSessionIds,
      };
    });

    return create();
  },

  activateForDeviceLimit: ({
    sessionId,
    userId,
    maxDevices = null,
    overflowPolicy = 'reject',
  } = {}) => {
    const activate = db.transaction(() => {
      authSessionDb.pruneExpired(userId);
      const current = db.prepare(`
        SELECT *
        FROM auth_device_sessions
        WHERE id = ? AND user_id = ? AND ${activeAuthSessionWhere()}
        LIMIT 1
      `).get(sessionId, userId);
      if (!current) {
        const error = new Error('Active authentication session not found');
        error.code = 'AUTH_SESSION_NOT_FOUND';
        throw error;
      }
      if (current.counts_as_device !== 0) {
        return { session: mapAuthDeviceSession(current), revokedSessionIds: [], newlyActivated: false };
      }

      const registeredDevice = db.prepare(`
        SELECT id
        FROM auth_device_sessions
        WHERE user_id = ? AND device_fingerprint_hash = ? AND counts_as_device = 1
        LIMIT 1
      `).get(userId, current.device_fingerprint_hash);
      const registeredDevices = registeredDevice ? [] : listCountedDeviceRows(userId);
      const normalizedLimit = maxDevices == null
        ? null
        : Math.max(1, Math.floor(Number(maxDevices)));
      const revokedSessionIds = [];
      if (normalizedLimit !== null && registeredDevices.length >= normalizedLimit) {
        if (overflowPolicy !== 'evict-oldest') {
          const error = new Error(`This account is limited to ${normalizedLimit} device${normalizedLimit === 1 ? '' : 's'}`);
          error.code = 'DEVICE_LIMIT_REACHED';
          error.maxDevices = normalizedLimit;
          throw error;
        }

        const evictCount = registeredDevices.length - normalizedLimit + 1;
        const evictedDevices = [...registeredDevices]
          .sort((left, right) => new Date(left.device_registered_at || 0) - new Date(right.device_registered_at || 0)
            || left.device_registration_order - right.device_registration_order)
          .slice(0, evictCount);
        for (const evictedDevice of evictedDevices) {
          const released = releaseCountedDevice(
            userId,
            evictedDevice.device_fingerprint_hash,
            'device-limit-evicted',
          );
          revokedSessionIds.push(...released.revokedSessionIds);
        }
      }

      db.prepare(`
        UPDATE auth_device_sessions
        SET counts_as_device = 1, last_seen_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND ${activeAuthSessionWhere()}
      `).run(sessionId, userId);
      return {
        session: mapAuthDeviceSession(db.prepare('SELECT * FROM auth_device_sessions WHERE id = ?').get(sessionId)),
        revokedSessionIds,
        newlyActivated: !registeredDevice,
      };
    });

    return activate();
  },

  setRefreshToken: (sessionId, tokenHash, refreshExpiresAt) => {
    const result = db.prepare(`
      UPDATE auth_device_sessions
      SET refresh_token_hash = ?, refresh_expires_at = ?, last_seen_at = CURRENT_TIMESTAMP
      WHERE id = ? AND revoked_at IS NULL
    `).run(tokenHash, refreshExpiresAt, sessionId);
    return result.changes > 0;
  },

  getActiveById: (sessionId, userId = null) => {
    const userClause = userId == null ? '' : 'AND user_id = ?';
    const params = userId == null ? [sessionId] : [sessionId, userId];
    return mapAuthDeviceSession(db.prepare(`
      SELECT * FROM auth_device_sessions
      WHERE id = ? ${userClause} AND ${activeAuthSessionWhere()}
      LIMIT 1
    `).get(...params));
  },

  verifyRefreshToken: ({ sessionId, userId, tokenHash, deviceFingerprintHash = null }) => {
    const row = db.prepare(`
      SELECT * FROM auth_device_sessions
      WHERE id = ? AND user_id = ? AND refresh_token_hash = ?
        AND ${activeAuthSessionWhere()}
      LIMIT 1
    `).get(sessionId, userId, tokenHash);
    if (!row) return null;
    if (deviceFingerprintHash && row.device_fingerprint_hash !== deviceFingerprintHash) return null;
    return mapAuthDeviceSession(row);
  },

  touch: (sessionId, {
    ipAddress = null,
    userAgent = null,
    clientType = null,
    clientVersion = null,
    clientPlatform = null,
    force = false,
  } = {}) => {
    if (!sessionId) return false;
    const result = db.prepare(`
      UPDATE auth_device_sessions
      SET last_seen_at = CURRENT_TIMESTAMP,
          ip_address = COALESCE(?, ip_address),
          user_agent = COALESCE(?, user_agent),
          client_type = COALESCE(?, client_type),
          client_version = COALESCE(?, client_version),
          client_platform = COALESCE(?, client_platform)
      WHERE id = ? AND ${activeAuthSessionWhere()}
        ${force ? '' : "AND datetime(last_seen_at) <= datetime('now', '-30 seconds')"}
    `).run(ipAddress, userAgent, clientType, clientVersion, clientPlatform, sessionId);
    return result.changes > 0;
  },

  listActiveForUser: (userId) => {
    authSessionDb.pruneExpired(userId);
    return db.prepare(`
      SELECT * FROM auth_device_sessions
      WHERE user_id = ? AND ${activeAuthSessionWhere()}
      ORDER BY datetime(last_seen_at) DESC, datetime(created_at) DESC
    `).all(userId).map(mapAuthDeviceSession);
  },

  listCountedActiveForUser: (userId) => {
    authSessionDb.pruneExpired(userId);
    return listCountedDeviceRows(userId).map(mapAuthDeviceSession);
  },

  getLatestForUser: (userId) => mapAuthDeviceSession(db.prepare(`
    SELECT * FROM auth_device_sessions
    WHERE user_id = ?
    ORDER BY datetime(last_seen_at) DESC, datetime(created_at) DESC
    LIMIT 1
  `).get(userId)),

  revoke: (sessionId, userId = null, reason = 'revoked') => {
    const userClause = userId == null ? '' : 'AND user_id = ?';
    const params = userId == null
      ? [reason, sessionId]
      : [reason, sessionId, userId];
    const result = db.prepare(`
      UPDATE auth_device_sessions
      SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = ?
      WHERE id = ? ${userClause} AND revoked_at IS NULL
    `).run(...params);
    return result.changes > 0;
  },

  revokeDevice: (sessionId, userId, reason = 'device-revoked') => {
    const device = db.prepare(`
      SELECT *
      FROM auth_device_sessions
      WHERE id = ? AND user_id = ? AND counts_as_device = 1
      LIMIT 1
    `).get(sessionId, userId);
    if (!device) return null;
    return {
      device: mapAuthDeviceSession(device),
      ...releaseCountedDevice(userId, device.device_fingerprint_hash, reason),
    };
  },

  revokeAllForUser: (userId, reason = 'revoked', exceptSessionId = null) => {
    const exceptClause = exceptSessionId ? 'AND id != ?' : '';
    const params = exceptSessionId
      ? [reason, userId, exceptSessionId]
      : [reason, userId];
    const rows = db.prepare(`
      SELECT id FROM auth_device_sessions
      WHERE user_id = ? AND revoked_at IS NULL ${exceptClause}
    `).all(userId, ...(exceptSessionId ? [exceptSessionId] : []));
    if (rows.length === 0) return [];
    db.prepare(`
      UPDATE auth_device_sessions
      SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = ?
      WHERE user_id = ? AND revoked_at IS NULL ${exceptClause}
    `).run(...params);
    return rows.map((row) => row.id);
  },
};

const registrationRequestDb = {
  create: ({ username, notificationEmail, passwordHash, acceptedLegalTerms = false, acceptedLegalTermsAt = null, acceptedLegalTermsVersion = null }) => {
    const stmt = db.prepare(`
      INSERT INTO registration_requests (
        username, notification_email, password_hash,
        accepted_legal_terms, accepted_legal_terms_at, accepted_legal_terms_version
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      username,
      notificationEmail,
      passwordHash,
      acceptedLegalTerms ? 1 : 0,
      acceptedLegalTermsAt,
      acceptedLegalTermsVersion,
    );
    return registrationRequestDb.getById(result.lastInsertRowid);
  },
  list: (status = 'pending') => db.prepare(`
      SELECT *
      FROM registration_requests
      ${status ? 'WHERE status = ?' : ''}
      ORDER BY datetime(created_at) DESC, id DESC
    `).all(status ? [status] : []),
  getById: (id) => db.prepare('SELECT * FROM registration_requests WHERE id = ?').get(id),
  getPendingByUsernameOrEmail: (username, notificationEmail) => db.prepare(`
      SELECT *
      FROM registration_requests
      WHERE status = 'pending' AND (username = ? OR notification_email = ?)
      LIMIT 1
    `).get(username, notificationEmail),
  approve: (id, userId) => {
    db.prepare(`
      UPDATE registration_requests
      SET status = 'approved', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(String(userId || ''), id);
    return registrationRequestDb.getById(id);
  },
  reject: (id, note = 'Rejected by administrator') => {
    db.prepare(`
      UPDATE registration_requests
      SET status = 'rejected', review_note = ?, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(note, id);
    return registrationRequestDb.getById(id);
  },
};

function normalizeUserPreferenceMemoryCategory(category) {
  const normalized = typeof category === 'string' ? category.trim().toLowerCase() : '';
  return USER_PREFERENCE_MEMORY_CATEGORIES.has(normalized) ? normalized : 'general';
}

function normalizeUserPreferenceMemoryScope(scope) {
  const normalized = typeof scope === 'string' ? scope.trim().toLowerCase() : '';
  return USER_PREFERENCE_MEMORY_SCOPES.has(normalized) ? normalized : 'user';
}

function normalizeUserPreferenceProjectKey(projectKey, projectPath = null) {
  const explicitKey = typeof projectKey === 'string' ? projectKey.trim() : '';
  if (explicitKey) {
    return explicitKey;
  }

  const normalizedPath = typeof projectPath === 'string' ? projectPath.trim() : '';
  return normalizedPath.split(/[\\/]+/).filter(Boolean).pop() || null;
}

function mapUserPreferenceMemoryRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    id: Number(row.id),
    user_id: Number(row.user_id),
    is_enabled: row.is_enabled === 1,
    scope: normalizeUserPreferenceMemoryScope(row.scope),
    project_path: row.project_path || null,
    project_key: normalizeUserPreferenceProjectKey(row.project_key, row.project_path),
  };
}

const userPreferenceMemoryDb = {
  getAll: (userId) => {
    try {
      const rows = db.prepare(`
        SELECT *
        FROM user_memories
        WHERE user_id = ?
        ORDER BY
          is_enabled DESC,
          CASE WHEN scope = 'project' THEN 0 ELSE 1 END,
          updated_at DESC,
          id DESC
      `).all(userId);
      return rows.map(mapUserPreferenceMemoryRow);
    } catch (err) {
      throw err;
    }
  },

  getById: (userId, memoryId) => {
    try {
      const row = db.prepare(`
        SELECT *
        FROM user_memories
        WHERE user_id = ? AND id = ?
      `).get(userId, memoryId);
      return mapUserPreferenceMemoryRow(row);
    } catch (err) {
      throw err;
    }
  },

  getEnabled: (userId, options = {}) => {
    try {
      const safeLimit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(Number(options.limit))) : 4;
      const normalizedProjectPath = typeof options.projectPath === 'string' && options.projectPath.trim()
        ? options.projectPath.trim()
        : null;
      const normalizedProjectKey = normalizeUserPreferenceProjectKey(options.projectKey, normalizedProjectPath);

      const rows = db.prepare(`
        SELECT *
        FROM user_memories
        WHERE user_id = ?
          AND is_enabled = 1
        ORDER BY
          CASE WHEN scope = 'project' THEN 0 ELSE 1 END,
          updated_at DESC,
          id DESC
      `).all(userId).map(mapUserPreferenceMemoryRow);

      return rows.filter((memory) => {
        if (memory.scope !== 'project') {
          return true;
        }
        if (!normalizedProjectKey && !normalizedProjectPath) {
          return false;
        }
        return Boolean(
          (normalizedProjectKey && memory.project_key === normalizedProjectKey)
          || (normalizedProjectPath && memory.project_path === normalizedProjectPath)
        );
      }).slice(0, safeLimit);
    } catch (err) {
      throw err;
    }
  },

  create: (userId, content, category = 'general', scope = 'user', projectPath = null, projectKey = null) => {
    try {
      const totalRow = db.prepare(`
        SELECT COUNT(*) AS count
        FROM user_memories
        WHERE user_id = ?
      `).get(userId);

      if ((totalRow?.count || 0) >= USER_PREFERENCE_MEMORY_MAX_ITEMS) {
        throw new Error(`Maximum of ${USER_PREFERENCE_MEMORY_MAX_ITEMS} memories allowed`);
      }

      const result = db.prepare(`
        INSERT INTO user_memories (user_id, content, category, scope, project_path, project_key)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        String(content || '').trim(),
        normalizeUserPreferenceMemoryCategory(category),
        normalizeUserPreferenceMemoryScope(scope),
        normalizeUserPreferenceMemoryScope(scope) === 'project'
          ? (typeof projectPath === 'string' ? projectPath.trim() : null)
          : null,
        normalizeUserPreferenceMemoryScope(scope) === 'project'
          ? normalizeUserPreferenceProjectKey(projectKey, projectPath)
          : null,
      );

      return userPreferenceMemoryDb.getById(userId, result.lastInsertRowid);
    } catch (err) {
      throw err;
    }
  },

  update: (userId, memoryId, updates = {}) => {
    try {
      const existing = userPreferenceMemoryDb.getById(userId, memoryId);
      if (!existing) {
        return null;
      }

      const nextContent = updates.content !== undefined
        ? String(updates.content || '').trim()
        : existing.content;
      const nextCategory = updates.category !== undefined
        ? normalizeUserPreferenceMemoryCategory(updates.category)
        : existing.category;
      const nextScope = updates.scope !== undefined
        ? normalizeUserPreferenceMemoryScope(updates.scope)
        : existing.scope;
      const nextProjectPath = nextScope === 'project'
        ? (
          updates.projectPath !== undefined
            ? (typeof updates.projectPath === 'string' ? updates.projectPath.trim() : null)
            : existing.project_path
        )
        : null;
      const nextProjectKey = nextScope === 'project'
        ? (
          updates.projectKey !== undefined
            ? normalizeUserPreferenceProjectKey(updates.projectKey, nextProjectPath)
            : normalizeUserPreferenceProjectKey(existing.project_key, nextProjectPath)
        )
        : null;
      const nextEnabled = updates.isEnabled !== undefined
        ? (updates.isEnabled ? 1 : 0)
        : (existing.is_enabled ? 1 : 0);

      db.prepare(`
        UPDATE user_memories
        SET
          content = ?,
          category = ?,
          scope = ?,
          project_path = ?,
          project_key = ?,
          is_enabled = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND id = ?
      `).run(
        nextContent,
        nextCategory,
        nextScope,
        nextProjectPath,
        nextProjectKey,
        nextEnabled,
        userId,
        memoryId,
      );

      return userPreferenceMemoryDb.getById(userId, memoryId);
    } catch (err) {
      throw err;
    }
  },

  toggle: (userId, memoryId, isEnabled) => {
    try {
      const existing = userPreferenceMemoryDb.getById(userId, memoryId);
      if (!existing) {
        return null;
      }

      const nextEnabled = typeof isEnabled === 'boolean'
        ? isEnabled
        : !existing.is_enabled;

      return userPreferenceMemoryDb.update(userId, memoryId, { isEnabled: nextEnabled });
    } catch (err) {
      throw err;
    }
  },

  delete: (userId, memoryId) => {
    try {
      const result = db.prepare(`
        DELETE FROM user_memories
        WHERE user_id = ? AND id = ?
      `).run(userId, memoryId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  getMemoryEnabled: (userId) => {
    try {
      const row = db.prepare('SELECT memory_enabled FROM users WHERE id = ?').get(userId);
      return row?.memory_enabled !== 0;
    } catch (err) {
      throw err;
    }
  },

  setMemoryEnabled: (userId, enabled) => {
    try {
      db.prepare('UPDATE users SET memory_enabled = ? WHERE id = ?').run(enabled ? 1 : 0, userId);
      return userPreferenceMemoryDb.getMemoryEnabled(userId);
    } catch (err) {
      throw err;
    }
  },
};

const autoResearchDb = {
  createRun: (input) => {
    try {
      const sessionIdentity = input.sessionId
        ? buildSessionPersistenceIdentity({
            sessionId: input.sessionId,
            projectKey: input.projectKey || input.projectName,
            runtimeId: input.runtimeId,
            provider: input.provider,
            ownerKey: input.ownerKey || input.userId,
          })
        : null;
      db.prepare(`
        INSERT INTO auto_research_runs (
          id, user_id, project_name, project_path, provider, status, session_id,
          session_key, owner_key, project_key, runtime_id,
          current_task_id, completed_tasks, total_tasks, error, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.userId,
        input.projectName,
        input.projectPath,
        input.provider || 'claude',
        input.status || 'queued',
        input.sessionId || null,
        sessionIdentity ? createAgentSessionKey(sessionIdentity) : null,
        sessionIdentity?.ownerKey || null,
        sessionIdentity?.projectKey || null,
        sessionIdentity?.runtimeId || null,
        input.currentTaskId || null,
        input.completedTasks || 0,
        input.totalTasks || 0,
        input.error || null,
        input.metadata ? JSON.stringify(input.metadata) : null
      );
      return autoResearchDb.getRunById(input.id);
    } catch (err) {
      throw err;
    }
  },

  getRunById: (runId) => {
    try {
      const row = db.prepare('SELECT * FROM auto_research_runs WHERE id = ?').get(runId);
      return row ? {
        ...row,
        sessionKey: row.session_key || null,
        ownerKey: row.owner_key || null,
        projectKey: row.project_key || row.project_name || null,
        runtimeId: row.runtime_id || (row.provider ? mapLegacyProviderToSessionPersistence(row.provider).runtimeId : null),
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      } : null;
    } catch (err) {
      throw err;
    }
  },

  getLatestRunForProject: (userId, projectName) => {
    try {
      const row = db.prepare(`
        SELECT * FROM auto_research_runs
        WHERE user_id = ? AND project_name = ?
        ORDER BY started_at DESC
        LIMIT 1
      `).get(userId, projectName);
      return row ? {
        ...row,
        sessionKey: row.session_key || null,
        ownerKey: row.owner_key || null,
        projectKey: row.project_key || row.project_name || null,
        runtimeId: row.runtime_id || (row.provider ? mapLegacyProviderToSessionPersistence(row.provider).runtimeId : null),
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      } : null;
    } catch (err) {
      throw err;
    }
  },

  getActiveRunForProject: (userId, projectName) => {
    try {
      const row = db.prepare(`
        SELECT * FROM auto_research_runs
        WHERE user_id = ? AND project_name = ? AND status IN ('queued', 'running', 'cancelling')
        ORDER BY started_at DESC
        LIMIT 1
      `).get(userId, projectName);
      return row ? {
        ...row,
        sessionKey: row.session_key || null,
        ownerKey: row.owner_key || null,
        projectKey: row.project_key || row.project_name || null,
        runtimeId: row.runtime_id || (row.provider ? mapLegacyProviderToSessionPersistence(row.provider).runtimeId : null),
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      } : null;
    } catch (err) {
      throw err;
    }
  },

  updateRun: (runId, updates = {}) => {
    try {
      const existing = autoResearchDb.getRunById(runId);
      if (!existing) {
        return null;
      }

      const resolveValue = (updateKey, existingValue) => (
        Object.prototype.hasOwnProperty.call(updates, updateKey) ? updates[updateKey] : existingValue
      );
      const mergedMetadata = Object.prototype.hasOwnProperty.call(updates, 'metadata')
        ? updates.metadata
        : existing.metadata;
      const nextSessionId = resolveValue('sessionId', existing.session_id);
      const nextIdentity = nextSessionId
        ? buildSessionPersistenceIdentity({
            sessionId: nextSessionId,
            projectKey: resolveValue('projectKey', existing.project_key || existing.project_name),
            runtimeId: resolveValue('runtimeId', existing.runtime_id),
            provider: existing.provider,
            ownerKey: resolveValue('ownerKey', existing.owner_key || existing.user_id),
          })
        : null;

      db.prepare(`
        UPDATE auto_research_runs
        SET
          status = ?,
          session_id = ?,
          session_key = ?,
          owner_key = ?,
          project_key = ?,
          runtime_id = ?,
          current_task_id = ?,
          completed_tasks = ?,
          total_tasks = ?,
          error = ?,
          metadata = ?,
          finished_at = ?,
          email_sent_at = ?
        WHERE id = ?
      `).run(
        resolveValue('status', existing.status),
        nextSessionId,
        nextIdentity ? createAgentSessionKey(nextIdentity) : null,
        nextIdentity?.ownerKey || null,
        nextIdentity?.projectKey || null,
        nextIdentity?.runtimeId || null,
        resolveValue('currentTaskId', existing.current_task_id),
        resolveValue('completedTasks', existing.completed_tasks),
        resolveValue('totalTasks', existing.total_tasks),
        resolveValue('error', existing.error),
        mergedMetadata ? JSON.stringify(mergedMetadata) : null,
        resolveValue('finishedAt', existing.finished_at),
        resolveValue('emailSentAt', existing.email_sent_at),
        runId
      );

      return autoResearchDb.getRunById(runId);
    } catch (err) {
      throw err;
    }
  },
};

const appSettingsDb = {
  get: (key) => {
    try {
      const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
      return row ? row.value : null;
    } catch (err) {
      throw err;
    }
  },

  set: (key, value) => {
    try {
      db.prepare(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(key, value);
      return appSettingsDb.get(key);
    } catch (err) {
      throw err;
    }
  },
};

const auditLogDb = {
  create: ({
    category,
    level = 'info',
    event,
    actorName = null,
    targetType = null,
    targetId = null,
    ipAddress = null,
    userAgent = null,
    message,
    metadata = null,
  }) => {
    try {
      const result = db.prepare(`
        INSERT INTO admin_audit_logs (
          category, level, event, actor_name, target_type, target_id,
          ip_address, user_agent, message, metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        category,
        level,
        event,
        actorName,
        targetType,
        targetId == null ? null : String(targetId),
        ipAddress,
        userAgent,
        message,
        metadata == null ? null : JSON.stringify(metadata),
      );
      return Number(result.lastInsertRowid);
    } catch (err) {
      console.error('[AUDIT] Failed to persist log:', err.message);
      return null;
    }
  },

  list: ({ category, page = 1, pageSize = 50, search = '' } = {}) => {
    const safeCategory = ['login', 'operation', 'system'].includes(category) ? category : 'system';
    const safePage = Math.max(1, Number.parseInt(String(page), 10) || 1);
    const safePageSize = Math.min(100, Math.max(10, Number.parseInt(String(pageSize), 10) || 50));
    const keyword = String(search || '').trim();
    const searchClause = keyword
      ? 'AND (message LIKE ? OR event LIKE ? OR actor_name LIKE ? OR target_id LIKE ? OR ip_address LIKE ?)'
      : '';
    const searchValues = keyword ? Array(5).fill(`%${keyword}%`) : [];
    const count = db.prepare(`
      SELECT COUNT(*) AS count
      FROM admin_audit_logs
      WHERE category = ? ${searchClause}
    `).get(safeCategory, ...searchValues);
    const rows = db.prepare(`
      SELECT *
      FROM admin_audit_logs
      WHERE category = ? ${searchClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(safeCategory, ...searchValues, safePageSize, (safePage - 1) * safePageSize);
    return {
      logs: rows.map((row) => ({
        id: Number(row.id),
        category: row.category,
        level: row.level,
        event: row.event,
        actorName: row.actor_name || null,
        targetType: row.target_type || null,
        targetId: row.target_id || null,
        ipAddress: row.ip_address || null,
        userAgent: row.user_agent || null,
        message: row.message,
        metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
        createdAt: row.created_at,
      })),
      total: Number(count?.count || 0),
      page: safePage,
      pageSize: safePageSize,
    };
  },
};

const userSettingsDb = {
  get: (userId, key) => {
    try {
      const row = db.prepare(`
        SELECT value
        FROM user_settings
        WHERE user_id = ? AND key = ?
      `).get(userId, key);
      return row ? row.value : null;
    } catch (err) {
      throw err;
    }
  },

  set: (userId, key, value) => {
    try {
      db.prepare(`
        INSERT INTO user_settings (user_id, key, value, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, key) DO UPDATE SET
          value = excluded.value,
          updated_at = CURRENT_TIMESTAMP
      `).run(userId, key, value);
      return userSettingsDb.get(userId, key);
    } catch (err) {
      throw err;
    }
  },

  delete: (userId, key) => {
    try {
      const result = db.prepare(`
        DELETE FROM user_settings
        WHERE user_id = ? AND key = ?
      `).run(userId, key);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },
};

const LONG_TERM_MEMORY_ENABLED_KEY = 'long_term_memory_enabled';
const LONG_TERM_MEMORY_AUTO_CAPTURE_KEY = 'long_term_memory_auto_capture';
const LONG_TERM_MEMORY_MAX_ITEMS = 300;

function longTermMemoryContentKey(content) {
  return normalizeLongTermMemoryContent(content).toLocaleLowerCase();
}

function mapLongTermMemoryRow(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    user_id: Number(row.user_id),
    source: row.source === 'manual' ? 'manual' : 'automatic',
    conversation_id: row.conversation_id || null,
    pinned: row.is_pinned === 1 || row.is_pinned === true,
    safe: isSafeLongTermMemoryContent(row.content),
  };
}

const userLongTermMemoryDb = {
  getSettings: (userId) => ({
    enabled: userSettingsDb.get(userId, LONG_TERM_MEMORY_ENABLED_KEY) !== 'false',
    autoCaptureEnabled: userSettingsDb.get(userId, LONG_TERM_MEMORY_AUTO_CAPTURE_KEY) !== 'false',
  }),

  setSettings: (userId, updates = {}) => {
    if (typeof updates.enabled === 'boolean') {
      userSettingsDb.set(userId, LONG_TERM_MEMORY_ENABLED_KEY, String(updates.enabled));
    }
    if (typeof updates.autoCaptureEnabled === 'boolean') {
      userSettingsDb.set(userId, LONG_TERM_MEMORY_AUTO_CAPTURE_KEY, String(updates.autoCaptureEnabled));
    }
    return userLongTermMemoryDb.getSettings(userId);
  },

  getAll: (userId, options = {}) => {
    const limit = Number.isFinite(options.limit)
      ? Math.max(1, Math.min(LONG_TERM_MEMORY_MAX_ITEMS, Math.floor(options.limit)))
      : LONG_TERM_MEMORY_MAX_ITEMS;
    return db.prepare(`
      SELECT *
      FROM user_long_term_memories
      WHERE user_id = ?
      ORDER BY is_pinned DESC, datetime(updated_at) DESC, id DESC
      LIMIT ?
    `).all(userId, limit).map(mapLongTermMemoryRow);
  },

  getById: (userId, memoryId) => mapLongTermMemoryRow(db.prepare(`
    SELECT * FROM user_long_term_memories WHERE user_id = ? AND id = ?
  `).get(userId, memoryId)),

  getStats: (userId) => {
    const row = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN source = 'manual' THEN 1 ELSE 0 END) AS manual,
        SUM(CASE WHEN source = 'automatic' THEN 1 ELSE 0 END) AS automatic,
        SUM(CASE WHEN is_pinned = 1 THEN 1 ELSE 0 END) AS pinned
      FROM user_long_term_memories
      WHERE user_id = ?
    `).get(userId) || {};
    return {
      total: Number(row.total) || 0,
      manual: Number(row.manual) || 0,
      automatic: Number(row.automatic) || 0,
      pinned: Number(row.pinned) || 0,
      limit: LONG_TERM_MEMORY_MAX_ITEMS,
    };
  },

  create: (userId, content, options = {}) => {
    const normalized = assertSafeLongTermMemoryContent(content);
    const contentKey = longTermMemoryContentKey(normalized);
    const existing = db.prepare(`
      SELECT * FROM user_long_term_memories WHERE user_id = ? AND content_key = ?
    `).get(userId, contentKey);
    if (existing) {
      const requestedConversationId = typeof options.conversationId === 'string' && options.conversationId.trim()
        ? options.conversationId.trim()
        : null;
      db.prepare(`
        UPDATE user_long_term_memories
        SET source = CASE WHEN ? = 'manual' THEN 'manual' ELSE source END,
            conversation_id = COALESCE(?, conversation_id),
            is_pinned = CASE WHEN ? = 1 THEN 1 ELSE is_pinned END,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND id = ?
      `).run(
        options.source === 'manual' ? 'manual' : 'automatic',
        requestedConversationId,
        options.pinned === true ? 1 : 0,
        userId,
        existing.id,
      );
      return { memory: userLongTermMemoryDb.getById(userId, existing.id), created: false };
    }

    const transaction = db.transaction(() => {
      const count = db.prepare(`
        SELECT COUNT(*) AS count FROM user_long_term_memories WHERE user_id = ?
      `).get(userId)?.count || 0;
      if (count >= LONG_TERM_MEMORY_MAX_ITEMS) {
        const eviction = db.prepare(`
          DELETE FROM user_long_term_memories
          WHERE id = (
            SELECT id FROM user_long_term_memories
            WHERE user_id = ?
              AND source = 'automatic'
              AND is_pinned = 0
            ORDER BY datetime(updated_at) ASC, id ASC
            LIMIT 1
          )
        `).run(userId);
        if (eviction.changes === 0) {
          if (options.source === 'manual') {
            const error = new Error('Long-term memory is full. Unpin or delete an existing memory first');
            error.code = 'MEMORY_LIMIT_REACHED';
            throw error;
          }
          return null;
        }
      }
      const result = db.prepare(`
        INSERT INTO user_long_term_memories (user_id, content, content_key, source, conversation_id, is_pinned)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        normalized,
        contentKey,
        options.source === 'manual' ? 'manual' : 'automatic',
        typeof options.conversationId === 'string' && options.conversationId.trim()
          ? options.conversationId.trim()
          : null,
        options.pinned === true ? 1 : 0,
      );
      return userLongTermMemoryDb.getById(userId, result.lastInsertRowid);
    });
    const memory = transaction();
    return { memory, created: Boolean(memory), limitReached: !memory };
  },

  capture: (userId, facts, options = {}) => {
    const memories = [];
    let added = 0;
    let rejected = 0;
    let limitReached = false;
    for (const fact of Array.isArray(facts) ? facts.slice(0, 5) : []) {
      if (!isSafeLongTermMemoryContent(fact)) {
        rejected += 1;
        continue;
      }
      const result = userLongTermMemoryDb.create(userId, fact, {
        source: 'automatic',
        conversationId: options.conversationId,
      });
      if (result.created) added += 1;
      if (result.limitReached) limitReached = true;
      if (result.memory) memories.push(result.memory);
    }
    return { added, rejected, limitReached, memories };
  },

  update: (userId, memoryId, content) => {
    const existing = userLongTermMemoryDb.getById(userId, memoryId);
    if (!existing) return null;
    const normalized = assertSafeLongTermMemoryContent(content);
    const contentKey = longTermMemoryContentKey(normalized);
    const duplicate = db.prepare(`
      SELECT id FROM user_long_term_memories
      WHERE user_id = ? AND content_key = ? AND id != ?
    `).get(userId, contentKey, memoryId);
    if (duplicate) throw new Error('An identical memory already exists');
    db.prepare(`
      UPDATE user_long_term_memories
      SET content = ?, content_key = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND id = ?
    `).run(normalized, contentKey, userId, memoryId);
    return userLongTermMemoryDb.getById(userId, memoryId);
  },

  setPinned: (userId, memoryId, pinned) => {
    const result = db.prepare(`
      UPDATE user_long_term_memories
      SET is_pinned = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND id = ?
    `).run(pinned ? 1 : 0, userId, memoryId);
    return result.changes > 0 ? userLongTermMemoryDb.getById(userId, memoryId) : null;
  },

  delete: (userId, memoryId) => db.prepare(`
    DELETE FROM user_long_term_memories WHERE user_id = ? AND id = ?
  `).run(userId, memoryId).changes > 0,

  clear: (userId, options = {}) => {
    if (options.source === 'automatic') {
      return db.prepare(`
        DELETE FROM user_long_term_memories
        WHERE user_id = ? AND source = 'automatic' AND is_pinned = 0
      `).run(userId).changes;
    }
    return db.prepare(`
      DELETE FROM user_long_term_memories WHERE user_id = ?
    `).run(userId).changes;
  },
};

function parseGatewayMetadata(value) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function mapGatewayUsageEvent(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: Number(row.user_id),
    capability: row.capability,
    plan: row.plan || null,
    status: row.status,
    code: row.code || null,
    resourceOwnerId: row.resource_owner_id || null,
    source: row.source || null,
    units: Number(row.units || 0),
    deviceId: row.device_id || null,
    ipAddress: row.ip_address || null,
    userAgent: row.user_agent || null,
    metadata: parseGatewayMetadata(row.metadata_json),
    createdAt: row.created_at || null,
  };
}

function mapGatewayQuotaCounter(row) {
  if (!row) {
    return null;
  }

  return {
    userId: Number(row.user_id),
    capability: row.capability,
    periodKey: row.period_key,
    usedUnits: Number(row.used_units || 0),
    updatedAt: row.updated_at || null,
  };
}

function mapGatewayDevice(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: Number(row.user_id),
    deviceFingerprint: row.device_fingerprint,
    label: row.label || null,
    firstSeenAt: row.first_seen_at || null,
    lastSeenAt: row.last_seen_at || null,
    userAgent: row.user_agent || null,
    ipAddress: row.ip_address || null,
    isActive: row.is_active !== 0,
  };
}

function normalizeGatewayLimit(value, fallback = 50) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.min(Math.floor(parsed), 500);
  }
  return fallback;
}

const gatewayDb = {
  generateId: (prefix = 'gw') => `${prefix}_${crypto.randomBytes(16).toString('base64url')}`,

  periodKey: (date = new Date()) => {
    const parsed = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(parsed.getTime())) {
      return new Date().toISOString().slice(0, 7);
    }
    return parsed.toISOString().slice(0, 7);
  },

  recordUsageEvent: (input = {}) => {
    try {
      const id = input.id || gatewayDb.generateId('gw_evt');
      db.prepare(`
        INSERT INTO gateway_usage_events (
          id, user_id, capability, plan, status, code, resource_owner_id, source,
          units, device_id, ip_address, user_agent, metadata_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.userId,
        input.capability,
        input.plan || null,
        input.status,
        input.code || null,
        input.resourceOwnerId == null ? null : String(input.resourceOwnerId),
        input.source || null,
        Number.isFinite(Number(input.units)) ? Math.max(0, Math.floor(Number(input.units))) : 0,
        input.deviceId || null,
        input.ipAddress || null,
        input.userAgent || null,
        input.metadata ? JSON.stringify(input.metadata) : null,
      );

      return mapGatewayUsageEvent(
        db.prepare('SELECT * FROM gateway_usage_events WHERE id = ?').get(id),
      );
    } catch (err) {
      throw err;
    }
  },

  listUsageEvents: (userId, { limit = 50 } = {}) => {
    try {
      return db.prepare(`
        SELECT *
        FROM gateway_usage_events
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `).all(userId, normalizeGatewayLimit(limit)).map(mapGatewayUsageEvent);
    } catch (err) {
      throw err;
    }
  },

  getQuotaCounter: (userId, capability, periodKey) => {
    try {
      return mapGatewayQuotaCounter(
        db.prepare(`
          SELECT *
          FROM gateway_quota_counters
          WHERE user_id = ? AND capability = ? AND period_key = ?
        `).get(userId, capability, periodKey),
      );
    } catch (err) {
      throw err;
    }
  },

  incrementQuotaCounter: (input = {}) => {
    try {
      const units = Number.isFinite(Number(input.units))
        ? Math.max(0, Math.floor(Number(input.units)))
        : 0;
      const periodKey = input.periodKey || gatewayDb.periodKey();
      db.prepare(`
        INSERT INTO gateway_quota_counters (user_id, capability, period_key, used_units, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, capability, period_key)
        DO UPDATE SET
          used_units = gateway_quota_counters.used_units + excluded.used_units,
          updated_at = CURRENT_TIMESTAMP
      `).run(input.userId, input.capability, periodKey, units);

      return gatewayDb.getQuotaCounter(input.userId, input.capability, periodKey);
    } catch (err) {
      throw err;
    }
  },

  listQuotaCounters: (userId, { periodKey = gatewayDb.periodKey() } = {}) => {
    try {
      return db.prepare(`
        SELECT *
        FROM gateway_quota_counters
        WHERE user_id = ? AND period_key = ?
        ORDER BY capability ASC
      `).all(userId, periodKey).map(mapGatewayQuotaCounter);
    } catch (err) {
      throw err;
    }
  },

  registerDevice: (input = {}) => {
    try {
      const fingerprint = String(input.deviceFingerprint || '').trim();
      if (!fingerprint) {
        throw new Error('Device fingerprint is required');
      }

      const existing = db.prepare(`
        SELECT *
        FROM gateway_devices
        WHERE user_id = ? AND device_fingerprint = ?
      `).get(input.userId, fingerprint);

      if (existing) {
        db.prepare(`
          UPDATE gateway_devices
          SET label = COALESCE(?, label),
              last_seen_at = CURRENT_TIMESTAMP,
              user_agent = COALESCE(?, user_agent),
              ip_address = COALESCE(?, ip_address),
              is_active = 1
          WHERE id = ?
        `).run(
          input.label || null,
          input.userAgent || null,
          input.ipAddress || null,
          existing.id,
        );
        return mapGatewayDevice(db.prepare('SELECT * FROM gateway_devices WHERE id = ?').get(existing.id));
      }

      const id = input.id || gatewayDb.generateId('gw_dev');
      db.prepare(`
        INSERT INTO gateway_devices (
          id, user_id, device_fingerprint, label, user_agent, ip_address
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.userId,
        fingerprint,
        input.label || null,
        input.userAgent || null,
        input.ipAddress || null,
      );

      return mapGatewayDevice(db.prepare('SELECT * FROM gateway_devices WHERE id = ?').get(id));
    } catch (err) {
      throw err;
    }
  },

  listDevices: (userId) => {
    try {
      return db.prepare(`
        SELECT *
        FROM gateway_devices
        WHERE user_id = ? AND is_active = 1
        ORDER BY last_seen_at DESC, first_seen_at DESC
      `).all(userId).map(mapGatewayDevice);
    } catch (err) {
      throw err;
    }
  },
};

function normalizeConversationShareVisibility(visibility) {
  const normalized = typeof visibility === 'string' ? visibility.trim().toLowerCase() : '';
  return normalized === 'private' ? 'private' : 'public';
}

function mapConversationShareRow(row) {
  if (!row) {
    return null;
  }

  return {
    token: row.token,
    userId: Number(row.user_id),
    projectName: row.project_name,
    sessionId: row.session_id,
    provider: row.provider || 'claude',
    sessionKey: row.session_key || null,
    ownerKey: row.owner_key || null,
    projectKey: row.project_key || row.project_name || null,
    runtimeId: row.runtime_id || mapLegacyProviderToSessionPersistence(row.provider).runtimeId,
    visibility: normalizeConversationShareVisibility(row.visibility),
    title: row.title || null,
    snapshot: row.snapshot_json ? JSON.parse(row.snapshot_json) : null,
    messageCount: Number(row.message_count || 0),
    expiresAt: row.expires_at || null,
    revokedAt: row.revoked_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    lastAccessedAt: row.last_accessed_at || null,
  };
}

const conversationShareDb = {
  generateToken: () => `conv_${crypto.randomBytes(24).toString('base64url')}`,

  create: (input = {}) => {
    try {
      const token = input.token || conversationShareDb.generateToken();
      const visibility = normalizeConversationShareVisibility(input.visibility);
      const snapshot = input.snapshot && typeof input.snapshot === 'object' ? input.snapshot : {};
      const messageCount = Number.isFinite(Number(input.messageCount))
        ? Math.max(0, Math.floor(Number(input.messageCount)))
        : (Array.isArray(snapshot.messages) ? snapshot.messages.length : 0);
      const persistenceIdentity = buildSessionPersistenceIdentity({
        sessionId: input.sessionId,
        projectKey: input.projectKey || input.projectName,
        runtimeId: input.runtimeId,
        provider: input.provider,
        ownerKey: input.ownerKey || input.userId,
      });
      const sessionKey = input.sessionKey || createAgentSessionKey(persistenceIdentity);

      db.prepare(`
        INSERT INTO conversation_share_links (
          token, user_id, project_name, session_id, provider,
          session_key, owner_key, project_key, runtime_id, visibility, title,
          snapshot_json, message_count, expires_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        token,
        input.userId,
        input.projectName,
        input.sessionId,
        input.provider || 'claude',
        sessionKey,
        persistenceIdentity.ownerKey,
        persistenceIdentity.projectKey,
        persistenceIdentity.runtimeId,
        visibility,
        input.title || null,
        JSON.stringify(snapshot),
        messageCount,
        input.expiresAt || null,
      );

      return conversationShareDb.getByToken(token);
    } catch (err) {
      throw err;
    }
  },

  getByToken: (token) => {
    try {
      const normalizedToken = typeof token === 'string' ? token.trim() : '';
      if (!normalizedToken) {
        return null;
      }

      return mapConversationShareRow(
        db.prepare('SELECT * FROM conversation_share_links WHERE token = ?').get(normalizedToken),
      );
    } catch (err) {
      throw err;
    }
  },

  listForSession: (userId, projectName, sessionId, options = {}) => {
    try {
      const runtimeInput = options.runtimeId || options.provider || null;
      const rows = runtimeInput
        ? db.prepare(`
            SELECT * FROM conversation_share_links
            WHERE user_id = ? AND project_name = ? AND session_id = ? AND runtime_id = ?
            ORDER BY datetime(created_at) DESC
          `).all(
            userId,
            projectName,
            sessionId,
            mapLegacyProviderToSessionPersistence(runtimeInput).runtimeId,
          )
        : db.prepare(`
            SELECT * FROM conversation_share_links
            WHERE user_id = ? AND project_name = ? AND session_id = ?
            ORDER BY datetime(created_at) DESC
          `).all(userId, projectName, sessionId);
      return rows.map(mapConversationShareRow).filter(Boolean);
    } catch (err) {
      throw err;
    }
  },

  markAccessed: (token) => {
    try {
      db.prepare(`
        UPDATE conversation_share_links
        SET last_accessed_at = CURRENT_TIMESTAMP
        WHERE token = ?
      `).run(token);
    } catch (err) {
      console.warn('Failed to update conversation share access time:', err.message);
    }
  },

  revoke: (token, userId) => {
    try {
      const result = db.prepare(`
        UPDATE conversation_share_links
        SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE token = ? AND user_id = ? AND revoked_at IS NULL
      `).run(token, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },
};

function mapAccountConversationRow(row, { includeMessages = true } = {}) {
  if (!row) {
    return null;
  }

  let messages = [];
  if (includeMessages && row.messages_json) {
    try {
      const parsed = JSON.parse(row.messages_json);
      messages = Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      messages = [];
    }
  }

  return {
    id: row.id,
    sessionId: row.session_id,
    provider: row.provider || 'claude',
    sessionKey: row.session_key || null,
    ownerKey: row.owner_key || null,
    projectKey: row.project_key || null,
    runtimeId: row.runtime_id || mapLegacyProviderToSessionPersistence(row.provider).runtimeId,
    title: row.title || 'Conversation',
    projectLabel: row.project_label || null,
    messageCount: Number(row.message_count || 0),
    ...(includeMessages ? { messages } : {}),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

const accountConversationDb = {
  upsert: ({
    userId,
    sessionId,
    provider,
    runtimeId = null,
    ownerKey = null,
    projectKey = null,
    sessionKey = null,
    title,
    projectLabel = null,
    messages = [],
  }) => {
    const normalizedProvider = provider || 'claude';
    const identity = buildSessionPersistenceIdentity({
      sessionId,
      projectKey: projectKey || projectLabel || 'account',
      runtimeId,
      provider: normalizedProvider,
      ownerKey: ownerKey || userId,
    });
    const resolvedSessionKey = sessionKey || createAgentSessionKey(identity);
    const existing = db.prepare(`
      SELECT id FROM account_conversations
      WHERE user_id = ? AND session_key = ?
    `).get(userId, resolvedSessionKey);
    const id = existing?.id || crypto.randomUUID();

    db.prepare(`
      INSERT INTO account_conversations (
        id, user_id, session_id, provider, session_key, owner_key, project_key, runtime_id,
        title, project_label, messages_json, message_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, session_key) DO UPDATE SET
        title = excluded.title,
        project_label = excluded.project_label,
        messages_json = excluded.messages_json,
        message_count = excluded.message_count,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      id,
      userId,
      sessionId,
      normalizedProvider,
      resolvedSessionKey,
      identity.ownerKey,
      identity.projectKey,
      identity.runtimeId,
      title,
      projectLabel,
      JSON.stringify(messages),
      messages.length,
    );

    return accountConversationDb.getForUser(userId, id);
  },

  getForUser: (userId, id) => mapAccountConversationRow(
    db.prepare('SELECT * FROM account_conversations WHERE user_id = ? AND id = ?').get(userId, id),
  ),

  listForUser: (userId, { limit = 50, offset = 0, search = '' } = {}) => {
    const normalizedSearch = String(search || '').trim();
    const searchPattern = `%${normalizedSearch.replace(/[\\%_]/g, '\\$&')}%`;
    const whereSearch = normalizedSearch
      ? " AND (title LIKE ? ESCAPE '\\' OR project_label LIKE ? ESCAPE '\\')"
      : '';
    const params = normalizedSearch
      ? [userId, searchPattern, searchPattern]
      : [userId];
    const total = Number(db.prepare(`
      SELECT COUNT(*) AS count
      FROM account_conversations
      WHERE user_id = ?${whereSearch}
    `).get(...params)?.count || 0);
    const rows = db.prepare(`
      SELECT id, session_id, provider, session_key, owner_key, project_key, runtime_id,
             title, project_label, message_count, created_at, updated_at
      FROM account_conversations
      WHERE user_id = ?${whereSearch}
      ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return {
      conversations: rows.map((row) => mapAccountConversationRow(row, { includeMessages: false })),
      total,
      hasMore: offset + rows.length < total,
    };
  },

  deleteForUser: (userId, id) => {
    const result = db.prepare('DELETE FROM account_conversations WHERE user_id = ? AND id = ?').run(userId, id);
    return result.changes > 0;
  },
};

function mapFeedbackSubmissionRow(row) {
  if (!row) {
    return null;
  }

  let metadata = null;
  if (row.metadata_json) {
    try {
      metadata = JSON.parse(row.metadata_json);
    } catch (_) {
      metadata = null;
    }
  }

  return {
    id: row.id,
    userId: Number(row.user_id),
    projectName: row.project_name || null,
    projectPath: row.project_path || null,
    sessionId: row.session_id || null,
    provider: row.provider || null,
    sessionKey: row.session_key || null,
    ownerKey: row.owner_key || null,
    projectKey: row.project_key || row.project_name || null,
    runtimeId: row.runtime_id || (row.provider ? mapLegacyProviderToSessionPersistence(row.provider).runtimeId : null),
    message: row.message,
    contact: row.contact || null,
    pageUrl: row.page_url || null,
    userAgent: row.user_agent || null,
    status: row.status || 'new',
    metadata,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    emailNotifiedAt: row.email_notified_at || null,
  };
}

const feedbackDb = {
  generateId: () => `fb_${crypto.randomBytes(16).toString('hex')}`,

  create: (input = {}) => {
    try {
      const id = input.id || feedbackDb.generateId();
      const metadataJson = input.metadata && typeof input.metadata === 'object'
        ? JSON.stringify(input.metadata)
        : null;
      const hasSessionIdentity = Boolean(input.sessionId && (input.projectKey || input.projectName));
      const identity = hasSessionIdentity
        ? buildSessionPersistenceIdentity({
            sessionId: input.sessionId,
            projectKey: input.projectKey || input.projectName,
            runtimeId: input.runtimeId,
            provider: input.provider,
            ownerKey: input.ownerKey || input.userId,
          })
        : null;

      db.prepare(`
        INSERT INTO feedback_submissions (
          id, user_id, project_name, project_path, session_id, provider,
          session_key, owner_key, project_key, runtime_id,
          message, contact, page_url, user_agent, status, metadata_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.userId,
        input.projectName || null,
        input.projectPath || null,
        input.sessionId || null,
        input.provider || null,
        identity ? (input.sessionKey || createAgentSessionKey(identity)) : null,
        identity?.ownerKey || null,
        identity?.projectKey || null,
        identity?.runtimeId || null,
        input.message,
        input.contact || null,
        input.pageUrl || null,
        input.userAgent || null,
        input.status || 'new',
        metadataJson,
      );

      return feedbackDb.getById(id);
    } catch (err) {
      throw err;
    }
  },

  getById: (id) => {
    try {
      const normalizedId = typeof id === 'string' ? id.trim() : '';
      if (!normalizedId) {
        return null;
      }

      return mapFeedbackSubmissionRow(
        db.prepare('SELECT * FROM feedback_submissions WHERE id = ?').get(normalizedId),
      );
    } catch (err) {
      throw err;
    }
  },

  listForUser: (userId, limit = 50) => {
    try {
      const safeLimit = Number.isFinite(Number(limit))
        ? Math.min(200, Math.max(1, Math.floor(Number(limit))))
        : 50;
      const rows = db.prepare(`
        SELECT *
        FROM feedback_submissions
        WHERE user_id = ?
        ORDER BY datetime(created_at) DESC
        LIMIT ?
      `).all(userId, safeLimit);
      return rows.map(mapFeedbackSubmissionRow).filter(Boolean);
    } catch (err) {
      throw err;
    }
  },
};

// API Keys database operations
const apiKeysDb = {
  // Generate a new API key
  generateApiKey: () => {
    return 'ck_' + crypto.randomBytes(32).toString('hex');
  },

  // Create a new API key
  createApiKey: (userId, keyName) => {
    try {
      const apiKey = apiKeysDb.generateApiKey();
      const stmt = db.prepare('INSERT INTO api_keys (user_id, key_name, api_key) VALUES (?, ?, ?)');
      const result = stmt.run(userId, keyName, apiKey);
      return { id: result.lastInsertRowid, keyName, apiKey };
    } catch (err) {
      throw err;
    }
  },

  // Get all API keys for a user
  getApiKeys: (userId) => {
    try {
      const rows = db.prepare('SELECT id, key_name, api_key, created_at, last_used, is_active FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(userId);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Validate API key and get user
  validateApiKey: (apiKey) => {
    try {
      const row = db.prepare(`
        SELECT u.id, u.username, ak.id as api_key_id
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        WHERE ak.api_key = ? AND ak.is_active = 1 AND u.is_active = 1
      `).get(apiKey);

      if (row) {
        // Update last_used timestamp
        db.prepare('UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE id = ?').run(row.api_key_id);
      }

      return row;
    } catch (err) {
      throw err;
    }
  },

  // Delete an API key
  deleteApiKey: (userId, apiKeyId) => {
    try {
      const stmt = db.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ?');
      const result = stmt.run(apiKeyId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Toggle API key active status
  toggleApiKey: (userId, apiKeyId, isActive) => {
    try {
      const stmt = db.prepare('UPDATE api_keys SET is_active = ? WHERE id = ? AND user_id = ?');
      const result = stmt.run(isActive ? 1 : 0, apiKeyId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  }
};

// Pi settings in a Local Kernel belong to authenticated cloud accounts, not
// local login rows. Keep that namespace separate from hosted user settings.
const localPiProviderDb = {
  getStore: (cloudUserId) => db.prepare(
    'SELECT value FROM local_pi_provider_settings WHERE cloud_user_id = ?',
  ).get(cloudUserId)?.value || null,

  setStore: (cloudUserId, value) => db.prepare(`
    INSERT INTO local_pi_provider_settings (cloud_user_id, value)
    VALUES (?, ?)
    ON CONFLICT(cloud_user_id) DO UPDATE SET
      value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(cloudUserId, value),

  getCredential: (cloudUserId, providerId) => db.prepare(`
    SELECT credential_value FROM local_pi_provider_credentials
    WHERE cloud_user_id = ? AND provider_id = ?
  `).get(cloudUserId, providerId)?.credential_value || null,

  setCredential: (cloudUserId, providerId, value) => db.prepare(`
    INSERT INTO local_pi_provider_credentials (cloud_user_id, provider_id, credential_value)
    VALUES (?, ?, ?)
    ON CONFLICT(cloud_user_id, provider_id) DO UPDATE SET
      credential_value = excluded.credential_value, updated_at = CURRENT_TIMESTAMP
  `).run(cloudUserId, providerId, value),

  deleteCredential: (cloudUserId, providerId) => db.prepare(`
    DELETE FROM local_pi_provider_credentials WHERE cloud_user_id = ? AND provider_id = ?
  `).run(cloudUserId, providerId).changes > 0,
};

// User credentials database operations (for GitHub tokens, GitLab tokens, etc.)
const credentialsDb = {
  // Create a new credential
  createCredential: (userId, credentialName, credentialType, credentialValue, description = null) => {
    try {
      const stmt = db.prepare('INSERT INTO user_credentials (user_id, credential_name, credential_type, credential_value, description) VALUES (?, ?, ?, ?, ?)');
      const result = stmt.run(userId, credentialName, credentialType, credentialValue, description);
      return { id: result.lastInsertRowid, credentialName, credentialType };
    } catch (err) {
      throw err;
    }
  },

  // Get all credentials for a user, optionally filtered by type
  getCredentials: (userId, credentialType = null) => {
    try {
      let query = 'SELECT id, credential_name, credential_type, description, created_at, is_active FROM user_credentials WHERE user_id = ?';
      const params = [userId];

      if (credentialType) {
        query += ' AND credential_type = ?';
        params.push(credentialType);
      }

      query += ' ORDER BY created_at DESC';

      const rows = db.prepare(query).all(...params);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Get active credential value for a user by type (returns most recent active)
  getActiveCredential: (userId, credentialType) => {
    try {
      const row = db.prepare('SELECT credential_value FROM user_credentials WHERE user_id = ? AND credential_type = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1').get(userId, credentialType);
      return row?.credential_value || null;
    } catch (err) {
      throw err;
    }
  },

  // Delete a credential
  deleteCredential: (userId, credentialId) => {
    try {
      const stmt = db.prepare('DELETE FROM user_credentials WHERE id = ? AND user_id = ?');
      const result = stmt.run(credentialId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Toggle credential active status
  toggleCredential: (userId, credentialId, isActive) => {
    try {
      const stmt = db.prepare('UPDATE user_credentials SET is_active = ? WHERE id = ? AND user_id = ?');
      const result = stmt.run(isActive ? 1 : 0, credentialId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  }
};

// Backward compatibility - keep old names pointing to new system
const githubTokensDb = {
  createGithubToken: (userId, tokenName, githubToken, description = null) => {
    return credentialsDb.createCredential(userId, tokenName, 'github_token', githubToken, description);
  },
  getGithubTokens: (userId) => {
    return credentialsDb.getCredentials(userId, 'github_token');
  },
  getActiveGithubToken: (userId) => {
    return credentialsDb.getActiveCredential(userId, 'github_token');
  },
  deleteGithubToken: (userId, tokenId) => {
    return credentialsDb.deleteCredential(userId, tokenId);
  },
  toggleGithubToken: (userId, tokenId, isActive) => {
    return credentialsDb.toggleCredential(userId, tokenId, isActive);
  }
};

// Session metadata index operations
function parseSessionRow(row) {
  if (!row) {
    return null;
  }

  let metadata = null;
  try {
    metadata = row.metadata ? JSON.parse(row.metadata) : null;
  } catch (_) {
    metadata = null;
  }
  const sessionKey = row.session_key || row.sessionKey || null;
  const sessionId = row.external_session_id || row.externalSessionId || row.id || null;
  const projectKey = row.project_key || row.projectKey || row.project_name || null;
  const runtimeId = row.runtime_id || row.runtimeId || row.provider || null;
  const provider = metadata?.legacyProvider || row.provider || runtimeId;

  return {
    ...row,
    sessionKey,
    session_key: sessionKey,
    id: sessionId,
    sessionId,
    externalSessionId: sessionId,
    external_session_id: sessionId,
    ownerKey: row.owner_key || row.ownerKey || null,
    projectKey,
    project_name: projectKey,
    runtimeId,
    provider,
    modelProviderId: row.model_provider_id || null,
    modelId: row.model_id || null,
    catalogRevision: row.catalog_revision ?? null,
    metadata,
    tags: Array.isArray(row.tags) ? row.tags : [],
  };
}

function parseTagRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    projectName: row.project_name,
    tagKey: row.tag_key,
    tagType: row.tag_type,
    label: row.label,
    color: row.color ?? null,
    sortOrder: row.sort_order,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    createdAt: row.created_at,
    source: row.source ?? null,
    linkedBy: row.linked_by ?? null,
    linkedAt: row.linked_at ?? null,
    linkMetadata: row.link_metadata ? JSON.parse(row.link_metadata) : null,
  };
}

function normalizeSessionDisplayName(displayName) {
  if (displayName === null || displayName === undefined) {
    return null;
  }

  return stripInternalContextPrefix(displayName);
}

function normalizeSessionTimestamp(timestamp) {
  if (!timestamp) {
    return null;
  }

  const value = timestamp instanceof Date ? timestamp.toISOString() : String(timestamp).trim();
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

// Returns "YYYY-MM-DD HH:MM:SS" format for SQLite created_at column convention
function normalizeSessionCreatedAt(timestamp) {
  if (!timestamp) {
    return null;
  }

  const value = timestamp instanceof Date ? timestamp.toISOString() : String(timestamp).trim();
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().replace('T', ' ').slice(0, 19);
  }

  return value;
}

function mergeSessionMetadata(existingMetadata, incomingMetadata) {
  const base = existingMetadata && typeof existingMetadata === 'object' ? existingMetadata : {};
  const incoming = incomingMetadata && typeof incomingMetadata === 'object' ? incomingMetadata : {};
  return {
    ...base,
    ...incoming,
  };
}

function resolveLatestActivity(existingActivity, incomingActivity) {
  const normalizedExisting = normalizeSessionTimestamp(existingActivity);
  const normalizedIncoming = normalizeSessionTimestamp(incomingActivity);
  if (!normalizedExisting) {
    return normalizedIncoming;
  }
  if (!normalizedIncoming) {
    return normalizedExisting;
  }

  const existingTime = new Date(normalizedExisting).getTime();
  const incomingTime = new Date(normalizedIncoming).getTime();
  if (Number.isNaN(existingTime)) {
    return normalizedIncoming;
  }
  if (Number.isNaN(incomingTime)) {
    return normalizedExisting;
  }

  return incomingTime >= existingTime ? normalizedIncoming : normalizedExisting;
}

function resolveMessageCount(existingCount, incomingCount) {
  const normalizedExisting = Number(existingCount || 0);
  const normalizedIncoming = Number(incomingCount || 0);
  return Math.max(normalizedExisting, normalizedIncoming);
}

function normalizeMetadataObject(metadata) {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...metadata }
    : {};
}

function serializeMetadata(metadata) {
  const normalized = normalizeMetadataObject(metadata);
  return Object.keys(normalized).length > 0 ? JSON.stringify(normalized) : null;
}

function getStageTagDecisions(metadata) {
  const metadataObject = normalizeMetadataObject(metadata);
  const decisions = metadataObject[STAGE_TAG_DECISIONS_KEY];
  return decisions && typeof decisions === 'object' && !Array.isArray(decisions)
    ? { ...decisions }
    : {};
}

function applyManualStageTagDecisions(existingMetadata, projectStageTags = [], selectedTags = []) {
  const metadataObject = normalizeMetadataObject(existingMetadata);
  const decisions = getStageTagDecisions(metadataObject);
  const selectedStageKeys = new Set(
    (Array.isArray(selectedTags) ? selectedTags : [])
      .filter((tag) => tag?.tagType === 'stage')
      .map((tag) => tag.tagKey)
      .filter(Boolean)
  );
  const timestamp = new Date().toISOString();

  (Array.isArray(projectStageTags) ? projectStageTags : []).forEach((tag) => {
    const tagKey = tag?.tagKey || tag?.tag_key;
    if (!tagKey) {
      return;
    }

    decisions[tagKey] = {
      decision: selectedStageKeys.has(tagKey) ? 'selected' : 'excluded',
      source: 'manual',
      updatedAt: timestamp,
    };
  });

  metadataObject[STAGE_TAG_DECISIONS_KEY] = decisions;
  return metadataObject;
}

function isAutomaticStageTagBlocked(metadata, tagType, tagKey, source) {
  if (tagType !== 'stage' || !tagKey || source === 'manual') {
    return false;
  }

  const decisions = getStageTagDecisions(metadata);
  const decision = decisions[tagKey];
  return decision?.decision === 'excluded' && decision?.source === 'manual';
}

function hydrateSessionRowsWithTags(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  const sessionKeys = Array.from(new Set(rows.map((row) => row?.session_key).filter(Boolean)));
  if (sessionKeys.length === 0) {
    return rows.map(parseSessionRow).filter(Boolean);
  }

  // SQLite default SQLITE_MAX_VARIABLE_NUMBER is 999; use 900 to leave headroom.
  const chunkSize = 900;
  const tagsBySessionKey = new Map();

  for (let index = 0; index < sessionKeys.length; index += chunkSize) {
    const chunk = sessionKeys.slice(index, index + chunkSize);
    const placeholders = chunk.map(() => '?').join(', ');
    const tagRows = db.prepare(`
      SELECT
        stl.session_key,
        pt.id,
        pt.project_name,
        pt.tag_key,
        pt.tag_type,
        pt.label,
        pt.color,
        pt.sort_order,
        pt.metadata,
        pt.created_at,
        stl.linked_by,
        stl.source,
        stl.metadata AS link_metadata,
        stl.created_at AS linked_at
      FROM session_tag_links_v2 stl
      JOIN project_tags pt ON pt.id = stl.tag_id
      WHERE stl.session_key IN (${placeholders})
      ORDER BY pt.sort_order ASC, pt.label COLLATE NOCASE ASC, pt.id ASC
    `).all(...chunk);

    tagRows.forEach((tagRow) => {
      const parsed = parseTagRow(tagRow);
      if (!parsed) {
        return;
      }

      const existing = tagsBySessionKey.get(tagRow.session_key) || [];
      existing.push(parsed);
      tagsBySessionKey.set(tagRow.session_key, existing);
    });
  }

  return rows.map((row) => parseSessionRow({
    ...row,
    tags: tagsBySessionKey.get(row.session_key) || [],
  })).filter(Boolean);
}

function createSessionIdentityConflictError(sessionId, matchCount) {
  const error = new Error(
    `Session id "${sessionId}" matches ${matchCount} persisted sessions; projectKey and runtimeId are required.`,
  );
  error.code = 'AGENT_SESSION_IDENTITY_CONFLICT';
  error.sessionId = sessionId;
  error.matchCount = matchCount;
  return error;
}

function normalizeSessionLookupOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return {};
  }
  return options;
}

function resolveSessionOwnerKey(projectKey, requestedOwnerKey = null) {
  if (requestedOwnerKey !== null && requestedOwnerKey !== undefined && String(requestedOwnerKey).trim()) {
    return String(requestedOwnerKey).trim();
  }
  return resolveMigratedSessionOwnerKey(projectKey);
}

function buildSessionPersistenceIdentity({ sessionId, projectKey, runtimeId, provider, ownerKey }) {
  const mappedRuntimeId = runtimeId
    ? String(runtimeId).trim().toLowerCase()
    : mapLegacyProviderToSessionPersistence(provider).runtimeId;
  return createAgentSessionIdentity({
    ownerKey: resolveSessionOwnerKey(projectKey, ownerKey),
    projectKey,
    runtimeId: mappedRuntimeId,
    sessionId,
  });
}

function findSessionRows(selector, options = {}) {
  if (!tableExists('session_metadata_v2')) return [];
  if (selector && typeof selector === 'object' && !Array.isArray(selector)) {
    const explicitKey = selector.sessionKey || selector.session_key;
    if (explicitKey) {
      const row = db.prepare('SELECT * FROM session_metadata_v2 WHERE session_key = ?').get(String(explicitKey));
      return row ? [row] : [];
    }
    options = { ...options, ...selector };
    selector = selector.sessionId || selector.externalSessionId || selector.external_session_id || selector.id;
  }

  const sessionId = typeof selector === 'string' ? selector.trim() : '';
  if (!sessionId) return [];

  const normalizedOptions = normalizeSessionLookupOptions(options);
  const projectKey = normalizedOptions.projectKey || normalizedOptions.projectName || null;
  const ownerKey = normalizedOptions.ownerKey === null || normalizedOptions.ownerKey === undefined
    ? null
    : String(normalizedOptions.ownerKey).trim();
  const runtimeInput = normalizedOptions.runtimeId || normalizedOptions.provider || null;
  const runtimeId = runtimeInput
    ? mapLegacyProviderToSessionPersistence(runtimeInput).runtimeId
    : null;
  const clauses = ['external_session_id = ?'];
  const params = [sessionId];
  if (projectKey) {
    clauses.push('project_key = ?');
    params.push(String(projectKey));
  }
  if (runtimeId) {
    clauses.push('runtime_id = ?');
    params.push(runtimeId);
  }
  if (ownerKey) {
    clauses.push('owner_key = ?');
    params.push(ownerKey);
  }
  return db.prepare(`
    SELECT * FROM session_metadata_v2
    WHERE ${clauses.join(' AND ')}
    ORDER BY datetime(created_at) ASC, session_key ASC
  `).all(...params);
}

function resolveUniqueSessionRow(selector, options = {}) {
  const rows = findSessionRows(selector, options);
  if (rows.length > 1) {
    const sessionId = typeof selector === 'object'
      ? selector?.sessionId || selector?.externalSessionId || selector?.id
      : selector;
    throw createSessionIdentityConflictError(sessionId, rows.length);
  }
  return rows[0] || null;
}

function resolveSessionKey(selector, options = {}) {
  if (selector && typeof selector === 'object') {
    const explicitKey = selector.sessionKey || selector.session_key;
    if (explicitKey) return String(explicitKey);
  }
  return resolveUniqueSessionRow(selector, options)?.session_key || null;
}

const sessionDb = {
  upsertSession: (id, projectName, provider, displayName, lastActivity, messageCount = 0, metadata = null, options = {}) => (
    sessionDb.upsertSessionFromSource(id, projectName, provider, {
      ...options,
      displayName,
      lastActivity,
      messageCount,
      metadata,
    })
  ),

  upsertSessionPlaceholder: (id, projectName, provider, displayName = null, lastActivity = null, metadata = null, options = {}) => {
    if (!tableExists('session_metadata_v2')) return null;
    const existing = sessionDb.getSessionByIdentity(buildSessionPersistenceIdentity({
      sessionId: id,
      projectKey: projectName,
      provider,
      runtimeId: options.runtimeId,
      ownerKey: options.ownerKey,
    }));
    return sessionDb.upsertSessionFromSource(id, projectName, provider, {
      ...options,
      displayName: existing?.display_name || displayName,
      lastActivity,
      messageCount: existing?.message_count || 0,
      metadata,
      createdAt: existing?.created_at || lastActivity,
      isStarred: existing?.is_starred || 0,
    });
  },

  upsertSessionFromSource: (id, projectName, provider, payload = {}) => {
    if (!tableExists('session_metadata_v2')) return null;
    const providerMapping = mapLegacyProviderToSessionPersistence(provider || payload.runtimeId);
    const identity = buildSessionPersistenceIdentity({
      sessionId: id,
      projectKey: projectName,
      provider,
      runtimeId: payload.runtimeId,
      ownerKey: payload.ownerKey,
    });
    const sessionKey = createAgentSessionKey(identity);
    const existing = parseSessionRow(db.prepare(
      'SELECT * FROM session_metadata_v2 WHERE session_key = ?',
    ).get(sessionKey));
    const incomingDisplayName = normalizeSessionDisplayName(payload.displayName);
    const identityMetadata = providerMapping.legacyProvider !== identity.runtimeId
      ? { legacyProvider: providerMapping.legacyProvider }
      : null;
    const mergedMetadata = mergeSessionMetadata(
      mergeSessionMetadata(existing?.metadata, identityMetadata),
      payload.metadata,
    );
    const normalizedLastActivity = resolveLatestActivity(existing?.last_activity, payload.lastActivity);
    const resolvedMessageCount = resolveMessageCount(existing?.message_count, payload.messageCount);
    const createdAt = existing?.created_at
      || normalizeSessionCreatedAt(payload.createdAt)
      || normalizeSessionCreatedAt(payload.lastActivity)
      || normalizeSessionCreatedAt(new Date());
    const resolvedStarred = Number(payload.isStarred ?? existing?.is_starred ?? 0);
    const modelSelection = payload.modelSelection && typeof payload.modelSelection === 'object'
      ? payload.modelSelection
      : {};
    const modelProviderId = modelSelection.modelProviderId
      || payload.modelProviderId
      || existing?.model_provider_id
      || providerMapping.modelProviderId;
    const modelId = modelSelection.modelId || payload.modelId || existing?.model_id || null;
    const catalogRevision = modelSelection.catalogRevision
      ?? payload.catalogRevision
      ?? existing?.catalog_revision
      ?? null;

    db.prepare(`
      INSERT INTO session_metadata_v2 (
        session_key, external_session_id, owner_key, project_key, runtime_id,
        display_name, last_activity, message_count, is_starred,
        model_provider_id, model_id, catalog_revision, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_key) DO UPDATE SET
        display_name = COALESCE(excluded.display_name, session_metadata_v2.display_name),
        last_activity = excluded.last_activity,
        message_count = excluded.message_count,
        is_starred = excluded.is_starred,
        model_provider_id = COALESCE(excluded.model_provider_id, session_metadata_v2.model_provider_id),
        model_id = COALESCE(excluded.model_id, session_metadata_v2.model_id),
        catalog_revision = COALESCE(excluded.catalog_revision, session_metadata_v2.catalog_revision),
        metadata = excluded.metadata
    `).run(
      sessionKey,
      identity.sessionId,
      identity.ownerKey,
      identity.projectKey,
      identity.runtimeId,
      incomingDisplayName || existing?.display_name || null,
      normalizedLastActivity,
      resolvedMessageCount,
      resolvedStarred,
      modelProviderId,
      modelId,
      catalogRevision,
      serializeMetadata(mergedMetadata),
      createdAt,
    );
    return sessionDb.getSessionByIdentity(identity);
  },

  updateSessionName: (selector, displayName, options = {}) => {
    const sessionKey = resolveSessionKey(selector, options);
    if (!sessionKey) return null;
    const existing = parseSessionRow(db.prepare(
      'SELECT * FROM session_metadata_v2 WHERE session_key = ?',
    ).get(sessionKey));
    const metadata = mergeSessionMetadata(existing?.metadata, { displayNameSource: 'manual' });
    db.prepare(`
      UPDATE session_metadata_v2 SET display_name = ?, metadata = ? WHERE session_key = ?
    `).run(normalizeSessionDisplayName(displayName), serializeMetadata(metadata), sessionKey);
    return sessionDb.getSessionByKey(sessionKey);
  },

  migrateSessionId: (oldId, newId, provider = null, projectName = null, options = {}) => {
    if (!oldId || !newId || oldId === newId) return null;
    const lookupOptions = {
      ...options,
      projectName,
      provider,
    };
    const oldRow = parseSessionRow(resolveUniqueSessionRow(oldId, lookupOptions));
    if (!oldRow) return null;
    const nextIdentity = createAgentSessionIdentity({
      ownerKey: oldRow.ownerKey,
      projectKey: oldRow.projectKey,
      runtimeId: oldRow.runtimeId,
      sessionId: newId,
    });
    const nextSessionKey = createAgentSessionKey(nextIdentity);
    const newRow = parseSessionRow(db.prepare(
      'SELECT * FROM session_metadata_v2 WHERE session_key = ?',
    ).get(nextSessionKey));
    const mergedMetadata = mergeSessionMetadata(oldRow.metadata, newRow?.metadata);
    const mergedLastActivity = resolveLatestActivity(oldRow.last_activity, newRow?.last_activity);
    const mergedMessageCount = resolveMessageCount(oldRow.message_count, newRow?.message_count);

    db.transaction(() => {
      db.prepare(`
        INSERT INTO session_metadata_v2 (
          session_key, external_session_id, owner_key, project_key, runtime_id,
          display_name, last_activity, message_count, is_starred,
          model_provider_id, model_id, catalog_revision, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_key) DO UPDATE SET
          display_name = COALESCE(session_metadata_v2.display_name, excluded.display_name),
          last_activity = excluded.last_activity,
          message_count = excluded.message_count,
          is_starred = excluded.is_starred,
          model_provider_id = COALESCE(session_metadata_v2.model_provider_id, excluded.model_provider_id),
          model_id = COALESCE(session_metadata_v2.model_id, excluded.model_id),
          catalog_revision = COALESCE(session_metadata_v2.catalog_revision, excluded.catalog_revision),
          metadata = excluded.metadata
      `).run(
        nextSessionKey,
        nextIdentity.sessionId,
        nextIdentity.ownerKey,
        nextIdentity.projectKey,
        nextIdentity.runtimeId,
        newRow?.display_name || oldRow.display_name || null,
        mergedLastActivity,
        mergedMessageCount,
        Number(newRow?.is_starred || oldRow.is_starred || 0),
        newRow?.model_provider_id || oldRow.model_provider_id || null,
        newRow?.model_id || oldRow.model_id || null,
        newRow?.catalog_revision ?? oldRow.catalog_revision ?? null,
        serializeMetadata(mergedMetadata),
        newRow?.created_at || oldRow.created_at || normalizeSessionCreatedAt(new Date()),
      );
      db.prepare(`
        INSERT OR IGNORE INTO session_tag_links_v2 (
          session_key, tag_id, linked_by, source, metadata, created_at
        )
        SELECT ?, tag_id, linked_by, source, metadata, created_at
        FROM session_tag_links_v2 WHERE session_key = ?
      `).run(nextSessionKey, oldRow.sessionKey);
      db.prepare('DELETE FROM session_tag_links_v2 WHERE session_key = ?').run(oldRow.sessionKey);
      for (const tableName of [
        'conversation_share_links',
        'account_conversations',
        'feedback_submissions',
        'auto_research_runs',
      ]) {
        if (!tableExists(tableName) || !tableColumns(tableName).includes('session_key')) continue;
        db.prepare(`
          UPDATE "${tableName}"
          SET session_key = ?, session_id = ?, owner_key = ?, project_key = ?, runtime_id = ?
          WHERE session_key = ?
        `).run(
          nextSessionKey,
          nextIdentity.sessionId,
          nextIdentity.ownerKey,
          nextIdentity.projectKey,
          nextIdentity.runtimeId,
          oldRow.sessionKey,
        );
      }
      db.prepare('DELETE FROM session_metadata_v2 WHERE session_key = ?').run(oldRow.sessionKey);
    })();
    return sessionDb.getSessionByIdentity(nextIdentity);
  },

  getSessionsByProject: (projectName, options = {}) => {
    if (!tableExists('session_metadata_v2')) return [];
    const clauses = ['project_key = ?'];
    const params = [projectName];
    if (options.ownerKey !== null && options.ownerKey !== undefined) {
      clauses.push('owner_key = ?');
      params.push(String(options.ownerKey));
    }
    if (options.runtimeId || options.provider) {
      clauses.push('runtime_id = ?');
      params.push(mapLegacyProviderToSessionPersistence(options.runtimeId || options.provider).runtimeId);
    }
    const rows = db.prepare(`
      SELECT * FROM session_metadata_v2
      WHERE ${clauses.join(' AND ')}
      ORDER BY datetime(last_activity) DESC, datetime(created_at) DESC
    `).all(...params);
    return hydrateSessionRowsWithTags(rows);
  },

  getSessionsByProjects: (projectNames = [], options = {}) => {
    if (!tableExists('session_metadata_v2')) return [];
    if (!Array.isArray(projectNames) || projectNames.length === 0) return [];
    const chunkSize = 900;
    const allRows = [];
    for (let index = 0; index < projectNames.length; index += chunkSize) {
      const chunk = projectNames.slice(index, index + chunkSize);
      const placeholders = chunk.map(() => '?').join(', ');
      const clauses = [`project_key IN (${placeholders})`];
      const params = [...chunk];
      if (options.ownerKey !== null && options.ownerKey !== undefined) {
        clauses.push('owner_key = ?');
        params.push(String(options.ownerKey));
      }
      const rows = db.prepare(`
        SELECT * FROM session_metadata_v2 WHERE ${clauses.join(' AND ')}
        ORDER BY datetime(last_activity) DESC, datetime(created_at) DESC
      `).all(...params);
      allRows.push(...rows);
    }
    return hydrateSessionRowsWithTags(allRows);
  },

  getSessionByKey: (sessionKey) => {
    if (!tableExists('session_metadata_v2')) return null;
    return hydrateSessionRowsWithTags([
      db.prepare('SELECT * FROM session_metadata_v2 WHERE session_key = ?').get(sessionKey),
    ])[0] || null;
  },

  getSessionByIdentity: (identity) => {
    const normalized = createAgentSessionIdentity(identity);
    return sessionDb.getSessionByKey(createAgentSessionKey(normalized));
  },

  getSessionById: (id, options = {}) => hydrateSessionRowsWithTags([
    resolveUniqueSessionRow(id, options),
  ])[0] || null,

  findSessionsByExternalId: (id, options = {}) => hydrateSessionRowsWithTags(
    findSessionRows(id, options),
  ),

  updateSessionMetadata: (selector, updater, options = {}) => {
    const sessionKey = resolveSessionKey(selector, options);
    if (!sessionKey) return null;
    const row = db.prepare('SELECT metadata FROM session_metadata_v2 WHERE session_key = ?').get(sessionKey);
    if (!row) return null;
    let currentMetadata = null;
    try {
      currentMetadata = row.metadata ? JSON.parse(row.metadata) : null;
    } catch (_) {
      currentMetadata = null;
    }
    const nextMetadata = typeof updater === 'function'
      ? updater(normalizeMetadataObject(currentMetadata))
      : mergeSessionMetadata(currentMetadata, updater);
    db.prepare('UPDATE session_metadata_v2 SET metadata = ? WHERE session_key = ?').run(
      serializeMetadata(nextMetadata),
      sessionKey,
    );
    return sessionDb.getSessionByKey(sessionKey);
  },

  getSessionContextReview: (selector, options = {}) => {
    const session = sessionDb.getSessionById(selector, options);
    const files = session?.metadata?.contextReview?.files;
    return files && typeof files === 'object' ? files : {};
  },

  updateSessionContextReview: (selector, reviews = {}, options = {}) => {
    const existingReviews = sessionDb.getSessionContextReview(selector, options);
    const sanitizedReviews = Object.entries(reviews || {}).reduce((acc, [filePath, value]) => {
      if (!filePath || typeof filePath !== 'string') return acc;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return acc;
      acc[filePath] = {
        reviewedAt: typeof value.reviewedAt === 'string' ? value.reviewedAt : null,
        lastSeenAt: typeof value.lastSeenAt === 'string' ? value.lastSeenAt : null,
        lastReviewedSeenAt: typeof value.lastReviewedSeenAt === 'string' ? value.lastReviewedSeenAt : null,
      };
      return acc;
    }, {});
    const nextFiles = { ...existingReviews, ...sanitizedReviews };
    sessionDb.updateSessionMetadata(selector, {
      contextReview: { files: nextFiles, updatedAt: new Date().toISOString() },
    }, options);
    return nextFiles;
  },

  deleteSession: (selector, options = {}) => {
    const sessionKey = resolveSessionKey(selector, options);
    if (!sessionKey) return false;
    return db.prepare('DELETE FROM session_metadata_v2 WHERE session_key = ?').run(sessionKey).changes > 0;
  },

  deleteSessionsByProject: (projectName, options = {}) => {
    if (options.ownerKey !== null && options.ownerKey !== undefined) {
      return db.prepare(`
        DELETE FROM session_metadata_v2 WHERE project_key = ? AND owner_key = ?
      `).run(projectName, String(options.ownerKey)).changes;
    }
    return db.prepare('DELETE FROM session_metadata_v2 WHERE project_key = ?').run(projectName).changes;
  },

  listTrashedSessions: (userId = null) => {
    const ownerKey = userId === null || userId === undefined ? null : String(userId);
    const ownerClause = ownerKey ? 'owner_key = ? AND ' : '';
    const params = ownerKey ? [ownerKey] : [];
    let rows = [];
    try {
      rows = db.prepare(`
        SELECT * FROM session_metadata_v2
        WHERE ${ownerClause}json_extract(metadata, '$.trash.trashedAt') IS NOT NULL
        ORDER BY datetime(json_extract(metadata, '$.trash.trashedAt')) DESC,
                 datetime(last_activity) DESC, datetime(created_at) DESC
      `).all(...params);
    } catch (_) {
      rows = db.prepare(`
        SELECT * FROM session_metadata_v2 ${ownerKey ? 'WHERE owner_key = ?' : ''}
      `).all(...params).filter((row) => {
        try {
          return Boolean(JSON.parse(row.metadata || '{}')?.trash?.trashedAt);
        } catch {
          return false;
        }
      });
    }
    return hydrateSessionRowsWithTags(rows);
  },

  setSessionTrash: (selector, trashPatch = {}, options = {}) => sessionDb.updateSessionMetadata(
    selector,
    (current) => ({
      ...(current || {}),
      trash: { ...(current?.trash || {}), ...trashPatch },
    }),
    options,
  ),

  clearSessionTrash: (selector, options = {}) => sessionDb.updateSessionMetadata(
    selector,
    (current) => {
      const next = { ...(current || {}) };
      delete next.trash;
      return next;
    },
    options,
  ),
};

const tagDb = {
  ensureDefaultStageTags: (projectName) => {
    if (!projectName) {
      return [];
    }

    const insert = db.prepare(`
      INSERT OR IGNORE INTO project_tags (
        project_name, tag_key, tag_type, label, color, sort_order, metadata
      ) VALUES (?, ?, 'stage', ?, ?, ?, ?)
    `);

    const run = db.transaction(() => {
      DEFAULT_STAGE_TAGS.forEach((tag) => {
        insert.run(
          projectName,
          tag.tagKey,
          tag.label,
          tag.color,
          tag.sortOrder,
          null
        );
      });
    });

    try {
      run();
    } catch (err) {
      console.error('Error ensuring default stage tags:', err.message);
    }

    return tagDb.listProjectTags(projectName, 'stage');
  },

  listProjectTags: (projectName, tagType = null) => {
    try {
      const rows = tagType
        ? db.prepare(`
            SELECT * FROM project_tags
            WHERE project_name = ? AND tag_type = ?
            ORDER BY sort_order ASC, label COLLATE NOCASE ASC, id ASC
          `).all(projectName, tagType)
        : db.prepare(`
            SELECT * FROM project_tags
            WHERE project_name = ?
            ORDER BY tag_type COLLATE NOCASE ASC, sort_order ASC, label COLLATE NOCASE ASC, id ASC
          `).all(projectName);
      return rows.map(parseTagRow).filter(Boolean);
    } catch (err) {
      console.error('Error listing project tags:', err.message);
      return [];
    }
  },

  getTagByProjectAndKey: (projectName, tagType, tagKey) => {
    try {
      return parseTagRow(db.prepare(`
        SELECT * FROM project_tags
        WHERE project_name = ? AND tag_type = ? AND tag_key = ?
      `).get(projectName, tagType, tagKey));
    } catch (err) {
      console.error('Error getting project tag:', err.message);
      return null;
    }
  },

  getTagsByIds: (projectName, tagIds = []) => {
    try {
      if (!Array.isArray(tagIds) || tagIds.length === 0) {
        return [];
      }

      const normalizedIds = Array.from(new Set(
        tagIds
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0)
      ));

      if (normalizedIds.length === 0) {
        return [];
      }

      const placeholders = normalizedIds.map(() => '?').join(', ');
      const rows = db.prepare(`
        SELECT * FROM project_tags
        WHERE project_name = ? AND id IN (${placeholders})
        ORDER BY sort_order ASC, label COLLATE NOCASE ASC, id ASC
      `).all(projectName, ...normalizedIds);
      return rows.map(parseTagRow).filter(Boolean);
    } catch (err) {
      console.error('Error getting project tags by ids:', err.message);
      return [];
    }
  },

  listTagsForSession: (sessionSelector, options = {}) => {
    try {
      const sessionKey = resolveSessionKey(sessionSelector, options);
      if (!sessionKey) return [];
      const rows = db.prepare(`
        SELECT
          pt.id,
          pt.project_name,
          pt.tag_key,
          pt.tag_type,
          pt.label,
          pt.color,
          pt.sort_order,
          pt.metadata,
          pt.created_at,
          stl.linked_by,
          stl.source,
          stl.metadata AS link_metadata,
          stl.created_at AS linked_at
        FROM session_tag_links_v2 stl
        JOIN project_tags pt ON pt.id = stl.tag_id
        WHERE stl.session_key = ?
        ORDER BY pt.sort_order ASC, pt.label COLLATE NOCASE ASC, pt.id ASC
      `).all(sessionKey);
      return rows.map(parseTagRow).filter(Boolean);
    } catch (err) {
      console.error('Error listing session tags:', err.message);
      return [];
    }
  },

  listSessionIdsForTag: (projectName, tagType, tagKey) => {
    try {
      const rows = db.prepare(`
        SELECT sm.external_session_id
        FROM session_tag_links_v2 stl
        JOIN project_tags pt ON pt.id = stl.tag_id
        JOIN session_metadata_v2 sm ON sm.session_key = stl.session_key
        WHERE pt.project_name = ? AND pt.tag_type = ? AND pt.tag_key = ?
        ORDER BY datetime(stl.created_at) DESC
      `).all(projectName, tagType, tagKey);
      return rows.map((row) => row.external_session_id).filter(Boolean);
    } catch (err) {
      console.error('Error listing session ids for tag:', err.message);
      return [];
    }
  },

  replaceSessionTags: (sessionSelector, projectName, tagIds = [], options = {}) => {
    try {
      const sessionKey = resolveSessionKey(sessionSelector, {
        ...options,
        projectName,
      });
      if (!sessionKey) return [];
      const selectedTags = tagDb.getTagsByIds(projectName, tagIds);
      const projectStageTags = tagDb.listProjectTags(projectName, 'stage');
      const normalizedTagIds = selectedTags.map((tag) => tag.id);
      const linkedBy = options.linkedBy || null;
      const source = options.source || null;
      const metadata = options.metadata && typeof options.metadata === 'object'
        ? JSON.stringify(options.metadata)
        : null;

      const replace = db.transaction(() => {
        db.prepare(`
          DELETE FROM session_tag_links_v2
          WHERE session_key = ?
            AND tag_id IN (SELECT id FROM project_tags WHERE project_name = ?)
        `).run(sessionKey, projectName);

        const insert = db.prepare(`
          INSERT OR IGNORE INTO session_tag_links_v2 (
            session_key, tag_id, linked_by, source, metadata
          ) VALUES (?, ?, ?, ?, ?)
        `);

        normalizedTagIds.forEach((tagId) => {
          insert.run(sessionKey, tagId, linkedBy, source, metadata);
        });

        if (source === 'manual') {
          const session = parseSessionRow(db.prepare(
            'SELECT * FROM session_metadata_v2 WHERE session_key = ?',
          ).get(sessionKey));
          if (session) {
            const nextMetadata = applyManualStageTagDecisions(session.metadata, projectStageTags, selectedTags);
            db.prepare('UPDATE session_metadata_v2 SET metadata = ? WHERE session_key = ?').run(
              serializeMetadata(nextMetadata),
              sessionKey,
            );
          }
        }
      });

      replace();
      return tagDb.listTagsForSession({ sessionKey });
    } catch (err) {
      console.error('Error replacing session tags:', err.message);
      return [];
    }
  },

  appendSessionTagsByKeys: (sessionSelector, projectName, tagType, tagKeys = [], options = {}) => {
    try {
      const sessionKey = resolveSessionKey(sessionSelector, {
        ...options,
        projectName,
      });
      if (!sessionKey) return [];
      const normalizedKeys = Array.from(new Set(
        (Array.isArray(tagKeys) ? tagKeys : [])
          .map((value) => String(value || '').trim())
          .filter(Boolean)
      ));

      if (normalizedKeys.length === 0) {
        return tagDb.listTagsForSession({ sessionKey });
      }

      const session = parseSessionRow(db.prepare(
        'SELECT * FROM session_metadata_v2 WHERE session_key = ?',
      ).get(sessionKey));
      const linkedBy = options.linkedBy || null;
      const source = options.source || null;
      const metadata = options.metadata && typeof options.metadata === 'object'
        ? JSON.stringify(options.metadata)
        : null;
      const insert = db.prepare(`
        INSERT OR IGNORE INTO session_tag_links_v2 (
          session_key, tag_id, linked_by, source, metadata
        ) VALUES (?, ?, ?, ?, ?)
      `);

      const append = db.transaction(() => {
        normalizedKeys.forEach((tagKey) => {
          if (isAutomaticStageTagBlocked(session?.metadata, tagType, tagKey, source)) {
            return;
          }

          const tag = tagDb.getTagByProjectAndKey(projectName, tagType, tagKey);
          if (tag) {
            insert.run(sessionKey, tag.id, linkedBy, source, metadata);
          }
        });
      });

      append();
      return tagDb.listTagsForSession({ sessionKey });
    } catch (err) {
      console.error('Error appending session tags:', err.message);
      return [];
    }
  },
};

// Project index operations
const projectDb = {
  // Upsert project (insert if not exists, update if exists)
  upsertProject: (id, userId, displayName, path, isStarred = 0, lastAccessed = null, metadata = null) => {
    try {
      const stmt = db.prepare(`
        INSERT INTO projects (id, user_id, display_name, path, is_starred, last_accessed, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = COALESCE(excluded.display_name, projects.display_name),
          path = COALESCE(excluded.path, projects.path),
          user_id = CASE WHEN projects.user_id IS NULL THEN excluded.user_id ELSE projects.user_id END,
          is_starred = COALESCE(excluded.is_starred, projects.is_starred),
          last_accessed = COALESCE(excluded.last_accessed, projects.last_accessed),
          metadata = COALESCE(excluded.metadata, projects.metadata)
      `);
      stmt.run(id, userId, displayName, path, isStarred, lastAccessed, metadata ? JSON.stringify(metadata) : null);
    } catch (err) {
      console.error('Error upserting project metadata:', err.message);
    }
  },

  // Update project name ONLY
  updateProjectName: (id, displayName) => {
    try {
      db.prepare('UPDATE projects SET display_name = ? WHERE id = ?').run(displayName, id);
    } catch (err) {
      console.error('Error updating project name:', err.message);
    }
  },

  // Merge + update project metadata JSON
  updateProjectMetadata: (id, patch = {}) => {
    try {
      const row = projectDb.getProjectById(id);
      const current = row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      const next = { ...current, ...(patch && typeof patch === 'object' ? patch : {}) };
      db.prepare('UPDATE projects SET metadata = ? WHERE id = ?').run(
        Object.keys(next).length > 0 ? JSON.stringify(next) : null,
        id,
      );
      return next;
    } catch (err) {
      console.error('Error updating project metadata:', err.message);
      return null;
    }
  },

  // Replace project metadata JSON entirely
  setProjectMetadata: (id, metadata = null) => {
    try {
      const payload =
        metadata && typeof metadata === 'object' && Object.keys(metadata).length > 0
          ? JSON.stringify(metadata)
          : null;
      db.prepare('UPDATE projects SET metadata = ? WHERE id = ?').run(payload, id);
    } catch (err) {
      console.error('Error setting project metadata:', err.message);
    }
  },

  // Get all projects (can filter by userId later)
  getAllProjects: (userId = null) => {
    try {
      const query = userId ? 'SELECT * FROM projects WHERE user_id = ?' : 'SELECT * FROM projects';
      const rows = userId ? db.prepare(query).all(userId) : db.prepare(query).all();
      return rows.map(row => ({
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null
      }));
    } catch (err) {
      console.error('Error getting projects:', err.message);
      return [];
    }
  },

  // Get project by its encoded ID
  getProjectById: (id) => {
    try {
      const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
      if (row && row.metadata) {
        row.metadata = JSON.parse(row.metadata);
      }
      return row;
    } catch (err) {
      console.error('Error getting project metadata:', err.message);
      return null;
    }
  },

  // Get project by its file-system path (uses idx_projects_path index)
  getProjectByPath: (projectPath, userId = null) => {
    try {
      const query = userId
        ? 'SELECT * FROM projects WHERE path = ? AND user_id = ?'
        : 'SELECT * FROM projects WHERE path = ?';
      const row = userId
        ? db.prepare(query).get(projectPath, userId)
        : db.prepare(query).get(projectPath);
      if (row && row.metadata) {
        row.metadata = JSON.parse(row.metadata);
      }
      return row || null;
    } catch (err) {
      console.error('Error getting project by path:', err.message);
      return null;
    }
  },

  toggleStar: (id, isStarred) => {
    try {
      db.prepare('UPDATE projects SET is_starred = ? WHERE id = ?').run(isStarred ? 1 : 0, id);
    } catch (err) {
      console.error('Error toggling project star:', err.message);
    }
  },

  deleteProject: (id) => {
    try {
      db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    } catch (err) {
      console.error('Error deleting project metadata:', err.message);
    }
  },

  updateProjectPath: (id, projectPath) => {
    try {
      db.prepare('UPDATE projects SET path = ? WHERE id = ?').run(projectPath, id);
    } catch (err) {
      console.error('Error updating project path:', err.message);
    }
  },

  migrateProjectIdentity: (oldId, newId, projectPath) => {
    const migrate = db.transaction(() => {
      const oldProject = db.prepare('SELECT * FROM projects WHERE id = ?').get(oldId);
      if (!oldProject) {
        return;
      }

      const existingNewProject = db.prepare('SELECT id FROM projects WHERE id = ?').get(newId);
      if (!existingNewProject) {
        db.prepare(`
          INSERT INTO projects (id, user_id, display_name, path, is_starred, last_accessed, metadata, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          newId,
          oldProject.user_id,
          oldProject.display_name,
          projectPath,
          oldProject.is_starred,
          oldProject.last_accessed,
          oldProject.metadata,
          oldProject.created_at,
        );
      } else {
        db.prepare('UPDATE projects SET path = COALESCE(?, path) WHERE id = ?').run(projectPath, newId);
      }

      db.prepare(`
        INSERT OR IGNORE INTO project_references (project_id, reference_id, added_at)
        SELECT ?, reference_id, added_at
        FROM project_references
        WHERE project_id = ?
      `).run(newId, oldId);
      db.prepare('DELETE FROM project_references WHERE project_id = ?').run(oldId);
      const sessionRows = db.prepare('SELECT * FROM session_metadata_v2 WHERE project_key = ?').all(oldId);
      for (const row of sessionRows) {
        const nextIdentity = createAgentSessionIdentity({
          ownerKey: row.owner_key,
          projectKey: newId,
          runtimeId: row.runtime_id,
          sessionId: row.external_session_id,
        });
        const nextKey = createAgentSessionKey(nextIdentity);
        db.prepare(`
          INSERT OR IGNORE INTO session_metadata_v2 (
            session_key, external_session_id, owner_key, project_key, runtime_id,
            display_name, last_activity, message_count, is_starred,
            model_provider_id, model_id, catalog_revision, metadata, created_at
          )
          SELECT ?, external_session_id, owner_key, ?, runtime_id,
                 display_name, last_activity, message_count, is_starred,
                 model_provider_id, model_id, catalog_revision, metadata, created_at
          FROM session_metadata_v2 WHERE session_key = ?
        `).run(nextKey, newId, row.session_key);
        db.prepare(`
          INSERT OR IGNORE INTO session_tag_links_v2 (
            session_key, tag_id, linked_by, source, metadata, created_at
          )
          SELECT ?, tag_id, linked_by, source, metadata, created_at
          FROM session_tag_links_v2 WHERE session_key = ?
        `).run(nextKey, row.session_key);
        db.prepare('DELETE FROM session_tag_links_v2 WHERE session_key = ?').run(row.session_key);
        for (const tableName of [
          'conversation_share_links',
          'account_conversations',
          'feedback_submissions',
          'auto_research_runs',
        ]) {
          db.prepare(`
            UPDATE "${tableName}" SET session_key = ?, project_key = ? WHERE session_key = ?
          `).run(nextKey, newId, row.session_key);
        }
        db.prepare('DELETE FROM session_metadata_v2 WHERE session_key = ?').run(row.session_key);
      }
      db.prepare('DELETE FROM projects WHERE id = ?').run(oldId);
    });

    try {
      migrate();
    } catch (err) {
      console.error('Error migrating project identity:', err.message);
      throw err;
    }
  }
};

function normalizeProjectActivityText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function normalizeProjectActivityTimestamp(value, fallback = new Date()) {
  const candidate = value instanceof Date ? value : new Date(value || fallback);
  if (Number.isNaN(candidate.getTime())) {
    return new Date(fallback).toISOString();
  }
  return candidate.toISOString();
}

function mapProjectActivityEventRow(row) {
  if (!row) {
    return null;
  }

  return {
    ...row,
    metadata: parseJsonObject(row.metadata_json),
  };
}

const projectActivityDb = {
  recordProjectOpen: (userId, event = {}) => {
    try {
      const projectId = normalizeProjectActivityText(
        event?.projectId || event?.project_id || event?.projectName || event?.project_name,
      );
      if (!userId || !projectId) {
        return null;
      }

      const id = `project_activity_${crypto.randomUUID()}`;
      const occurredAt = normalizeProjectActivityTimestamp(event?.occurredAt || event?.occurred_at || new Date());
      const metadata = event?.metadata && typeof event.metadata === 'object' ? event.metadata : null;

      db.prepare(`
        INSERT INTO project_activity_events (
          id, user_id, project_id, project_path, event_type, occurred_at, metadata_json
        )
        VALUES (?, ?, ?, ?, 'project_open', ?, ?)
      `).run(
        id,
        userId,
        projectId,
        normalizeProjectActivityText(event?.projectPath || event?.project_path) || null,
        occurredAt,
        serializeJsonValue(metadata),
      );

      return mapProjectActivityEventRow(
        db.prepare('SELECT * FROM project_activity_events WHERE id = ? AND user_id = ?').get(id, userId),
      );
    } catch (err) {
      throw err;
    }
  },

  getActivity: (userId, { days = PROJECT_ACTIVITY_DEFAULT_DAYS, timezoneOffsetMinutes = 0, now = new Date() } = {}) => {
    try {
      const normalizedDays = normalizeProjectActivityDays(days);
      const normalizedOffset = normalizeProjectActivityTimezoneOffset(timezoneOffsetMinutes);
      const dateKeys = buildProjectActivityDateKeys(normalizedDays, normalizedOffset, now);
      const startDate = dateKeys[0];
      const endDate = dateKeys[dateKeys.length - 1];
      const localDateShiftMinutes = -normalizedOffset;
      const localDateModifier = `${localDateShiftMinutes >= 0 ? '+' : ''}${localDateShiftMinutes} minutes`;

      const rows = db.prepare(`
        SELECT
          activity_date AS date,
          COUNT(*) AS open_count,
          COUNT(DISTINCT project_key) AS project_count
        FROM (
          SELECT
            date(datetime(occurred_at, ?)) AS activity_date,
            COALESCE(NULLIF(project_id, ''), NULLIF(project_path, ''), id) AS project_key
          FROM project_activity_events
          WHERE user_id = ?
            AND event_type = 'project_open'
            AND occurred_at IS NOT NULL
        )
        WHERE activity_date BETWEEN ? AND ?
        GROUP BY activity_date
        ORDER BY activity_date ASC
      `).all(localDateModifier, userId, startDate, endDate);

      const totalProjectsRow = db.prepare(`
        SELECT COUNT(DISTINCT COALESCE(NULLIF(project_id, ''), NULLIF(project_path, ''), id)) AS total_projects
        FROM project_activity_events
        WHERE user_id = ?
          AND event_type = 'project_open'
          AND occurred_at IS NOT NULL
          AND date(datetime(occurred_at, ?)) BETWEEN ? AND ?
      `).get(userId, localDateModifier, startDate, endDate);

      const rowsByDate = new Map(rows.map((row) => [
        row.date,
        {
          date: row.date,
          open_count: Number(row.open_count || 0),
          project_count: Number(row.project_count || 0),
        },
      ]));

      const activityDays = dateKeys.map((date) => (
        rowsByDate.get(date) || {
          date,
          open_count: 0,
          project_count: 0,
        }
      ));

      const totals = activityDays.reduce((acc, day) => {
        acc.total_opens += day.open_count;
        if (day.open_count > 0 || day.project_count > 0) {
          acc.active_days += 1;
        }
        return acc;
      }, {
        total_opens: 0,
        total_projects: Number(totalProjectsRow?.total_projects || 0),
        active_days: 0,
      });

      return {
        days: activityDays,
        totals,
        range: {
          start_date: startDate,
          end_date: endDate,
          day_count: normalizedDays,
        },
        timezone_offset_minutes: normalizedOffset,
        generated_at: now.toISOString(),
      };
    } catch (err) {
      throw err;
    }
  },
};

function normalizeConceptString(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = normalizeConceptString(value);
    if (!normalized) {
      continue;
    }
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    result.push(normalized);
  }
  return result;
}

function parseJsonArray(value) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function serializeJsonValue(value) {
  if (value == null) {
    return null;
  }

  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }

  if (typeof value === 'object') {
    return Object.keys(value).length > 0 ? JSON.stringify(value) : null;
  }

  return null;
}

function mapConceptRow(row) {
  if (!row) {
    return null;
  }

  const {
    aliases_json,
    metadata_json,
    evidence_count,
    ...rest
  } = row;

  return {
    ...rest,
    aliases: normalizeStringList(parseJsonArray(aliases_json)),
    metadata: parseJsonObject(metadata_json),
    evidence_count: Number(evidence_count || 0),
  };
}

function mapConceptEvidenceRow(row) {
  if (!row) {
    return null;
  }

  const {
    metadata_json,
    extraction_confidence,
    ...rest
  } = row;

  return {
    ...rest,
    metadata: parseJsonObject(metadata_json),
    extraction_confidence: extraction_confidence == null ? null : Number(extraction_confidence),
  };
}

function mapMonitorRunRow(row) {
  if (!row) {
    return null;
  }

  const {
    metadata_json,
    candidate_count,
    ...rest
  } = row;

  return {
    ...rest,
    metadata: parseJsonObject(metadata_json),
    candidate_count: Number(candidate_count || 0),
  };
}

function mapMonitorCandidateRow(row) {
  if (!row) {
    return null;
  }

  const {
    metadata_json,
    confidence,
    reference_year,
    evidence_count,
    ...rest
  } = row;

  return {
    ...rest,
    metadata: parseJsonObject(metadata_json),
    confidence: confidence == null ? null : Number(confidence),
    reference_year: reference_year == null ? null : Number(reference_year),
    evidence_count: evidence_count == null ? undefined : Number(evidence_count),
  };
}

function normalizeProjectActivityDays(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return PROJECT_ACTIVITY_DEFAULT_DAYS;
  }
  return Math.min(Math.max(parsed, 1), PROJECT_ACTIVITY_MAX_DAYS);
}

function normalizeProjectActivityTimezoneOffset(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.min(Math.max(parsed, -14 * 60), 14 * 60);
}

function formatProjectActivityDateKey(value) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildProjectActivityDateKeys(days, timezoneOffsetMinutes, now = new Date()) {
  const normalizedDays = normalizeProjectActivityDays(days);
  const normalizedOffset = normalizeProjectActivityTimezoneOffset(timezoneOffsetMinutes);
  const localNowMs = now.getTime() - (normalizedOffset * 60 * 1000);
  const localToday = new Date(localNowMs);
  const todayUtcMidnightMs = Date.UTC(
    localToday.getUTCFullYear(),
    localToday.getUTCMonth(),
    localToday.getUTCDate(),
  );
  const firstDayMs = todayUtcMidnightMs - ((normalizedDays - 1) * PROJECT_ACTIVITY_MS_PER_DAY);

  return Array.from({ length: normalizedDays }, (_, index) => (
    formatProjectActivityDateKey(new Date(firstDayMs + (index * PROJECT_ACTIVITY_MS_PER_DAY)))
  ));
}

// Structured concept + evidence operations
const conceptsDb = {
  findConceptByCanonical: (userId, conceptType, canonicalName, { excludeId } = {}) => {
    try {
      const normalizedType = normalizeConceptString(conceptType);
      const normalizedName = normalizeConceptString(canonicalName);
      if (!normalizedType || !normalizedName) {
        return null;
      }

      const clauses = [
        'user_id = ?',
        'concept_type = ?',
        'LOWER(canonical_name) = LOWER(?)',
      ];
      const params = [userId, normalizedType, normalizedName];

      if (excludeId) {
        clauses.push('id != ?');
        params.push(excludeId);
      }

      const row = db.prepare(`
        SELECT c.*, (
          SELECT COUNT(*)
          FROM concept_evidence e
          WHERE e.concept_id = c.id
        ) AS evidence_count
        FROM clinical_concepts c
        WHERE ${clauses.join(' AND ')}
        LIMIT 1
      `).get(...params);

      return mapConceptRow(row);
    } catch (err) {
      throw err;
    }
  },

  createConcept: (userId, concept) => {
    try {
      const id = `concept_${crypto.randomUUID()}`;
      const canonicalName = normalizeConceptString(concept?.canonical_name);
      const displayName = normalizeConceptString(concept?.display_name || canonicalName);
      const aliases = normalizeStringList(concept?.aliases);
      const metadata = concept?.metadata && typeof concept.metadata === 'object' ? concept.metadata : null;

      db.prepare(`
        INSERT INTO clinical_concepts (
          id, user_id, concept_type, canonical_name, display_name, aliases_json,
          description, ontology_source, ontology_id, status, source_strategy,
          metadata_json, first_seen_at, last_seen_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        id,
        userId,
        normalizeConceptString(concept?.concept_type),
        canonicalName,
        displayName || null,
        serializeJsonValue(aliases),
        normalizeConceptString(concept?.description) || null,
        normalizeConceptString(concept?.ontology_source) || null,
        normalizeConceptString(concept?.ontology_id) || null,
        normalizeConceptString(concept?.status || 'reviewed'),
        normalizeConceptString(concept?.source_strategy || 'manual'),
        serializeJsonValue(metadata),
        normalizeConceptString(concept?.first_seen_at) || null,
        normalizeConceptString(concept?.last_seen_at) || null,
      );

      return conceptsDb.getConcept(userId, id);
    } catch (err) {
      throw err;
    }
  },

  listConcepts: (userId, { search, conceptTypes, statuses, limit = 50, offset = 0 } = {}) => {
    try {
      const clauses = ['c.user_id = ?'];
      const params = [userId];

      if (search) {
        const term = `%${search}%`;
        clauses.push('(c.canonical_name LIKE ? OR c.display_name LIKE ? OR c.aliases_json LIKE ? OR c.description LIKE ?)');
        params.push(term, term, term, term);
      }

      if (Array.isArray(conceptTypes) && conceptTypes.length > 0) {
        clauses.push(`c.concept_type IN (${conceptTypes.map(() => '?').join(',')})`);
        params.push(...conceptTypes.map((value) => normalizeConceptString(value)).filter(Boolean));
      }

      if (Array.isArray(statuses) && statuses.length > 0) {
        clauses.push(`c.status IN (${statuses.map(() => '?').join(',')})`);
        params.push(...statuses.map((value) => normalizeConceptString(value)).filter(Boolean));
      }

      params.push(limit, offset);

      const rows = db.prepare(`
        SELECT
          c.*,
          COUNT(e.id) AS evidence_count
        FROM clinical_concepts c
        LEFT JOIN concept_evidence e ON e.concept_id = c.id
        WHERE ${clauses.join(' AND ')}
        GROUP BY c.id
        ORDER BY c.updated_at DESC, c.created_at DESC
        LIMIT ? OFFSET ?
      `).all(...params);

      return rows.map(mapConceptRow);
    } catch (err) {
      throw err;
    }
  },

  getConcept: (userId, conceptId) => {
    try {
      const row = db.prepare(`
        SELECT
          c.*,
          COUNT(e.id) AS evidence_count
        FROM clinical_concepts c
        LEFT JOIN concept_evidence e ON e.concept_id = c.id
        WHERE c.user_id = ? AND c.id = ?
        GROUP BY c.id
        LIMIT 1
      `).get(userId, conceptId);

      return mapConceptRow(row);
    } catch (err) {
      throw err;
    }
  },

  updateConcept: (userId, conceptId, updates = {}) => {
    try {
      const fields = [];
      const params = [];

      if (Object.prototype.hasOwnProperty.call(updates, 'concept_type')) {
        fields.push('concept_type = ?');
        params.push(normalizeConceptString(updates.concept_type));
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'canonical_name')) {
        fields.push('canonical_name = ?');
        params.push(normalizeConceptString(updates.canonical_name));
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'display_name')) {
        fields.push('display_name = ?');
        params.push(normalizeConceptString(updates.display_name) || null);
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'aliases')) {
        fields.push('aliases_json = ?');
        params.push(serializeJsonValue(normalizeStringList(updates.aliases)));
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'description')) {
        fields.push('description = ?');
        params.push(normalizeConceptString(updates.description) || null);
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'ontology_source')) {
        fields.push('ontology_source = ?');
        params.push(normalizeConceptString(updates.ontology_source) || null);
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'ontology_id')) {
        fields.push('ontology_id = ?');
        params.push(normalizeConceptString(updates.ontology_id) || null);
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
        fields.push('status = ?');
        params.push(normalizeConceptString(updates.status));
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'source_strategy')) {
        fields.push('source_strategy = ?');
        params.push(normalizeConceptString(updates.source_strategy));
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'metadata')) {
        const metadata = updates.metadata && typeof updates.metadata === 'object' ? updates.metadata : null;
        fields.push('metadata_json = ?');
        params.push(serializeJsonValue(metadata));
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'first_seen_at')) {
        fields.push('first_seen_at = ?');
        params.push(normalizeConceptString(updates.first_seen_at) || null);
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'last_seen_at')) {
        fields.push('last_seen_at = ?');
        params.push(normalizeConceptString(updates.last_seen_at) || null);
      }

      if (fields.length === 0) {
        return conceptsDb.getConcept(userId, conceptId);
      }

      fields.push('updated_at = CURRENT_TIMESTAMP');
      params.push(conceptId, userId);

      const result = db.prepare(`
        UPDATE clinical_concepts
        SET ${fields.join(', ')}
        WHERE id = ? AND user_id = ?
      `).run(...params);

      if (result.changes === 0) {
        return null;
      }

      return conceptsDb.getConcept(userId, conceptId);
    } catch (err) {
      throw err;
    }
  },

  deleteConcept: (userId, conceptId) => {
    try {
      const result = db.prepare(`
        DELETE FROM clinical_concepts
        WHERE id = ? AND user_id = ?
      `).run(conceptId, userId);

      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  createConceptEvidence: (userId, conceptId, evidence) => {
    try {
      const id = `evidence_${crypto.randomUUID()}`;
      const metadata = evidence?.metadata && typeof evidence.metadata === 'object' ? evidence.metadata : null;

      db.prepare(`
        INSERT INTO concept_evidence (
          id, concept_id, user_id, reference_id, project_id, evidence_type,
          evidence_text, evidence_location, direction, evidence_level,
          extraction_confidence, review_status, review_note, metadata_json, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        id,
        conceptId,
        userId,
        normalizeConceptString(evidence?.reference_id) || null,
        normalizeConceptString(evidence?.project_id) || null,
        normalizeConceptString(evidence?.evidence_type),
        normalizeConceptString(evidence?.evidence_text),
        normalizeConceptString(evidence?.evidence_location) || null,
        normalizeConceptString(evidence?.direction || 'supporting'),
        normalizeConceptString(evidence?.evidence_level || 'moderate'),
        evidence?.extraction_confidence == null ? null : Number(evidence.extraction_confidence),
        normalizeConceptString(evidence?.review_status || 'accepted'),
        normalizeConceptString(evidence?.review_note) || null,
        serializeJsonValue(metadata),
      );

      return conceptsDb.getConceptEvidenceById(userId, id);
    } catch (err) {
      throw err;
    }
  },

  getConceptEvidenceById: (userId, evidenceId) => {
    try {
      const row = db.prepare(`
        SELECT
          e.*,
          r.title AS reference_title,
          r.year AS reference_year,
          r.journal AS reference_journal
        FROM concept_evidence e
        LEFT JOIN references_library r ON r.id = e.reference_id
        WHERE e.user_id = ? AND e.id = ?
        LIMIT 1
      `).get(userId, evidenceId);

      return mapConceptEvidenceRow(row);
    } catch (err) {
      throw err;
    }
  },

  getConceptEvidence: (userId, conceptId, { limit = 100, offset = 0 } = {}) => {
    try {
      const rows = db.prepare(`
        SELECT
          e.*,
          r.title AS reference_title,
          r.year AS reference_year,
          r.journal AS reference_journal
        FROM concept_evidence e
        LEFT JOIN references_library r ON r.id = e.reference_id
        WHERE e.user_id = ? AND e.concept_id = ?
        ORDER BY e.created_at DESC, e.updated_at DESC
        LIMIT ? OFFSET ?
      `).all(userId, conceptId, limit, offset);

      return rows.map(mapConceptEvidenceRow);
    } catch (err) {
      throw err;
    }
  },

  getOverviewStats: (userId) => {
    try {
      const conceptStats = db.prepare(`
        SELECT
          COUNT(*) AS total_concepts,
          COALESCE(SUM(CASE WHEN status = 'stable' THEN 1 ELSE 0 END), 0) AS stable_concepts,
          COALESCE(SUM(CASE WHEN status = 'reviewed' THEN 1 ELSE 0 END), 0) AS reviewed_concepts,
          COALESCE(SUM(CASE WHEN status = 'candidate' THEN 1 ELSE 0 END), 0) AS candidate_concepts
        FROM clinical_concepts
        WHERE user_id = ?
      `).get(userId);

      const evidenceStats = db.prepare(`
        SELECT COUNT(*) AS total_evidence
        FROM concept_evidence
        WHERE user_id = ?
      `).get(userId);

      return {
        total_concepts: Number(conceptStats?.total_concepts || 0),
        stable_concepts: Number(conceptStats?.stable_concepts || 0),
        reviewed_concepts: Number(conceptStats?.reviewed_concepts || 0),
        candidate_concepts: Number(conceptStats?.candidate_concepts || 0),
        total_evidence: Number(evidenceStats?.total_evidence || 0),
      };
    } catch (err) {
      throw err;
    }
  },
};

const monitorDb = {
  createRun: (userId, run) => {
    try {
      const id = `monitor_run_${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO monitor_runs (
          id, user_id, source_key, trigger_type, status, item_title,
          reference_id, project_id, candidate_count, metadata_json,
          started_at, finished_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
      `).run(
        id,
        userId,
        normalizeConceptString(run?.source_key || 'news'),
        normalizeConceptString(run?.trigger_type || 'news_ingest'),
        normalizeConceptString(run?.status || 'completed'),
        normalizeConceptString(run?.item_title) || null,
        normalizeConceptString(run?.reference_id) || null,
        normalizeConceptString(run?.project_id) || null,
        Number(run?.candidate_count || 0),
        serializeJsonValue(run?.metadata && typeof run.metadata === 'object' ? run.metadata : null),
        normalizeConceptString(run?.finished_at) || new Date().toISOString(),
      );

      return monitorDb.getRun(userId, id);
    } catch (err) {
      throw err;
    }
  },

  getRun: (userId, runId) => {
    try {
      const row = db.prepare(`
        SELECT *
        FROM monitor_runs
        WHERE user_id = ? AND id = ?
        LIMIT 1
      `).get(userId, runId);

      return mapMonitorRunRow(row);
    } catch (err) {
      throw err;
    }
  },

  createCandidates: (userId, runId, candidates = []) => {
    try {
      const insert = db.prepare(`
        INSERT OR IGNORE INTO monitor_candidates (
          id, user_id, run_id, reference_id, project_id, source_key, candidate_type,
          normalized_name, display_name, summary, rationale, confidence, status,
          merged_concept_id, review_note, metadata_json, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);

      const selectById = db.prepare(`
        SELECT
          mc.*,
          r.title AS reference_title,
          r.year AS reference_year,
          r.journal AS reference_journal
        FROM monitor_candidates mc
        LEFT JOIN references_library r ON r.id = mc.reference_id
        WHERE mc.user_id = ? AND mc.id = ?
        LIMIT 1
      `);

      const tx = db.transaction((rows) => {
        const inserted = [];

        for (const row of rows) {
          const id = `monitor_candidate_${crypto.randomUUID()}`;
          const result = insert.run(
            id,
            userId,
            runId || null,
            normalizeConceptString(row?.reference_id) || null,
            normalizeConceptString(row?.project_id) || null,
            normalizeConceptString(row?.source_key) || null,
            normalizeConceptString(row?.candidate_type),
            normalizeConceptString(row?.normalized_name),
            normalizeConceptString(row?.display_name) || null,
            normalizeConceptString(row?.summary) || null,
            normalizeConceptString(row?.rationale) || null,
            row?.confidence == null ? null : Number(row.confidence),
            normalizeConceptString(row?.status || 'pending'),
            normalizeConceptString(row?.merged_concept_id) || null,
            normalizeConceptString(row?.review_note) || null,
            serializeJsonValue(row?.metadata && typeof row.metadata === 'object' ? row.metadata : null),
          );

          if (result.changes > 0) {
            inserted.push(mapMonitorCandidateRow(selectById.get(userId, id)));
          }
        }

        return inserted;
      });

      const inserted = tx(candidates);
      if (runId) {
        db.prepare(`
          UPDATE monitor_runs
          SET candidate_count = ?, finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP), status = COALESCE(status, 'completed')
          WHERE id = ? AND user_id = ?
        `).run(inserted.length, runId, userId);
      }
      return inserted;
    } catch (err) {
      throw err;
    }
  },

  deletePendingCandidatesByReferenceIds: (userId, referenceIds = []) => {
    try {
      const normalizedIds = Array.from(new Set(
        (Array.isArray(referenceIds) ? referenceIds : [])
          .map((value) => normalizeConceptString(value))
          .filter(Boolean),
      ));

      if (normalizedIds.length === 0) {
        return 0;
      }

      const placeholders = normalizedIds.map(() => '?').join(',');
      const result = db.prepare(`
        DELETE FROM monitor_candidates
        WHERE user_id = ?
          AND status = 'pending'
          AND reference_id IN (${placeholders})
      `).run(userId, ...normalizedIds);

      return Number(result?.changes || 0);
    } catch (err) {
      throw err;
    }
  },

  listCandidates: (userId, { statuses, candidateTypes, limit = 50, offset = 0 } = {}) => {
    try {
      const clauses = ['mc.user_id = ?'];
      const params = [userId];

      if (Array.isArray(statuses) && statuses.length > 0) {
        clauses.push(`mc.status IN (${statuses.map(() => '?').join(',')})`);
        params.push(...statuses.map((value) => normalizeConceptString(value)).filter(Boolean));
      }

      if (Array.isArray(candidateTypes) && candidateTypes.length > 0) {
        clauses.push(`mc.candidate_type IN (${candidateTypes.map(() => '?').join(',')})`);
        params.push(...candidateTypes.map((value) => normalizeConceptString(value)).filter(Boolean));
      }

      params.push(limit, offset);

      const rows = db.prepare(`
        SELECT
          mc.*,
          r.title AS reference_title,
          r.year AS reference_year,
          r.journal AS reference_journal
        FROM monitor_candidates mc
        LEFT JOIN references_library r ON r.id = mc.reference_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY
          CASE mc.status
            WHEN 'pending' THEN 0
            WHEN 'accepted' THEN 1
            WHEN 'merged' THEN 2
            WHEN 'rejected' THEN 3
            ELSE 4
          END,
          mc.created_at DESC,
          mc.updated_at DESC
        LIMIT ? OFFSET ?
      `).all(...params);

      return rows.map(mapMonitorCandidateRow);
    } catch (err) {
      throw err;
    }
  },

  getCandidate: (userId, candidateId) => {
    try {
      const row = db.prepare(`
        SELECT
          mc.*,
          r.title AS reference_title,
          r.year AS reference_year,
          r.journal AS reference_journal
        FROM monitor_candidates mc
        LEFT JOIN references_library r ON r.id = mc.reference_id
        WHERE mc.user_id = ? AND mc.id = ?
        LIMIT 1
      `).get(userId, candidateId);

      return mapMonitorCandidateRow(row);
    } catch (err) {
      throw err;
    }
  },

  updateCandidateStatus: (userId, candidateId, updates = {}) => {
    try {
      const fields = [];
      const params = [];

      if (Object.prototype.hasOwnProperty.call(updates, 'status')) {
        fields.push('status = ?');
        params.push(normalizeConceptString(updates.status));
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'merged_concept_id')) {
        fields.push('merged_concept_id = ?');
        params.push(normalizeConceptString(updates.merged_concept_id) || null);
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'review_note')) {
        fields.push('review_note = ?');
        params.push(normalizeConceptString(updates.review_note) || null);
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'metadata')) {
        fields.push('metadata_json = ?');
        params.push(serializeJsonValue(updates.metadata && typeof updates.metadata === 'object' ? updates.metadata : null));
      }

      if (fields.length === 0) {
        return monitorDb.getCandidate(userId, candidateId);
      }

      fields.push('updated_at = CURRENT_TIMESTAMP');
      params.push(candidateId, userId);

      const result = db.prepare(`
        UPDATE monitor_candidates
        SET ${fields.join(', ')}
        WHERE id = ? AND user_id = ?
      `).run(...params);

      if (result.changes === 0) {
        return null;
      }

      return monitorDb.getCandidate(userId, candidateId);
    } catch (err) {
      throw err;
    }
  },

  getOverviewStats: (userId) => {
    try {
      const stats = db.prepare(`
        SELECT
          COUNT(*) AS total_candidates,
          COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_candidates,
          COALESCE(SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END), 0) AS accepted_candidates,
          COALESCE(SUM(CASE WHEN status = 'merged' THEN 1 ELSE 0 END), 0) AS merged_candidates,
          COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_candidates
        FROM monitor_candidates
        WHERE user_id = ?
      `).get(userId);

      return {
        total_candidates: Number(stats?.total_candidates || 0),
        pending_candidates: Number(stats?.pending_candidates || 0),
        accepted_candidates: Number(stats?.accepted_candidates || 0),
        merged_candidates: Number(stats?.merged_candidates || 0),
        rejected_candidates: Number(stats?.rejected_candidates || 0),
      };
    } catch (err) {
      throw err;
    }
  },
};

function normalizeReferenceDoi(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .trim()
    .replace(/[\s.,;]+$/g, '')
    .toLowerCase();
  return normalized || null;
}

function normalizeReferenceAuthors(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((author) => {
      if (typeof author === 'string') {
        return { family: author.trim(), given: '' };
      }
      if (!author || typeof author !== 'object') return null;
      return {
        family: String(author.family || author.lastName || author.name || '').trim(),
        given: String(author.given || author.firstName || '').trim(),
      };
    })
    .filter((author) => author && (author.family || author.given));
}

function normalizeReferenceKeywords(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((keyword) => String(keyword || '').trim()).filter(Boolean))];
}

function findReferenceByDoi(userId, doi) {
  if (!doi) return null;
  return db.prepare(`
    SELECT id
    FROM references_library
    WHERE user_id = ? AND LOWER(TRIM(doi)) = ?
    ORDER BY created_at ASC
    LIMIT 1
  `).get(userId, doi) || null;
}

// References (literature library) database operations
const referencesDb = {
  /**
   * Batch upsert references from Zotero or other sources.
   * Deduplicates by source_id for the given user.
   */
  syncFromZotero: (userId, items) => {
    const upsert = db.prepare(`
      INSERT INTO references_library (id, user_id, title, authors, year, abstract, doi, url, journal, item_type, source, source_id, keywords, citation_key, raw_data, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'zotero', ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        authors = excluded.authors,
        year = excluded.year,
        abstract = excluded.abstract,
        doi = excluded.doi,
        url = excluded.url,
        journal = excluded.journal,
        item_type = excluded.item_type,
        source = 'zotero',
        source_id = excluded.source_id,
        keywords = excluded.keywords,
        citation_key = excluded.citation_key,
        raw_data = excluded.raw_data,
        updated_at = CURRENT_TIMESTAMP
    `);

    const insertTag = db.prepare(`
      INSERT OR IGNORE INTO reference_tags (reference_id, tag) VALUES (?, ?)
    `);

    const tx = db.transaction((rows) => {
      const ids = new Set();
      for (const item of rows) {
        // Prefer an existing DOI-backed row so that Zotero/BibTeX/PubMed
        // imports converge on one stable library entity.
        const doi = normalizeReferenceDoi(item.doi);
        const deterministicId = `zotero_${userId}_${item.sourceId}`;
        const id = findReferenceByDoi(userId, doi)?.id || deterministicId;
        const authors = normalizeReferenceAuthors(item.authors);
        const keywords = normalizeReferenceKeywords(item.keywords);
        upsert.run(
          id,
          userId,
          item.title,
          JSON.stringify(authors),
          item.year,
          item.abstract,
          doi,
          item.url,
          item.journal,
          item.itemType || 'article',
          item.sourceId,
          JSON.stringify(keywords),
          item.citationKey,
          item.rawData ? JSON.stringify(item.rawData) : null,
        );
        // Keep tags already curated in MedHelp when Zotero metadata refreshes.
        for (const tag of keywords) {
          insertTag.run(id, tag);
        }
        ids.add(id);
      }
      return [...ids];
    });

    try {
      return tx(items);
    } catch (err) {
      throw err;
    }
  },

  /**
   * Import references from BibTeX (or other non-Zotero sources).
   */
  importReferences: (userId, items, source = 'bibtex') => {
    const upsert = db.prepare(`
      INSERT INTO references_library (id, user_id, title, authors, year, abstract, doi, url, journal, item_type, source, source_id, keywords, citation_key, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        title = CASE WHEN excluded.title IS NOT NULL AND excluded.title != '' AND excluded.title != 'Untitled' THEN excluded.title ELSE references_library.title END,
        authors = CASE WHEN excluded.authors IS NOT NULL AND excluded.authors != '[]' THEN excluded.authors ELSE references_library.authors END,
        year = COALESCE(excluded.year, references_library.year),
        abstract = COALESCE(NULLIF(excluded.abstract, ''), references_library.abstract),
        doi = COALESCE(NULLIF(excluded.doi, ''), references_library.doi),
        url = COALESCE(NULLIF(excluded.url, ''), references_library.url),
        journal = COALESCE(NULLIF(excluded.journal, ''), references_library.journal),
        item_type = COALESCE(NULLIF(excluded.item_type, ''), references_library.item_type),
        keywords = CASE WHEN excluded.keywords IS NOT NULL AND excluded.keywords != '[]' THEN excluded.keywords ELSE references_library.keywords END,
        citation_key = COALESCE(NULLIF(excluded.citation_key, ''), references_library.citation_key),
        updated_at = CURRENT_TIMESTAMP
    `);

    const insertTag = db.prepare(`
      INSERT OR IGNORE INTO reference_tags (reference_id, tag) VALUES (?, ?)
    `);

    const tx = db.transaction((rows) => {
      const ids = new Set();
      for (const item of rows) {
        // When no citationKey, generate deterministic ID from content
        let key = item.citationKey;
        if (!key) {
          const hash = crypto.createHash('sha256')
            .update(`${item.title || ''}|${JSON.stringify(item.authors || [])}|${item.year || ''}`)
            .digest('hex')
            .slice(0, 16);
          key = hash;
        }
        const doi = normalizeReferenceDoi(item.doi);
        const deterministicId = `${source}_${userId}_${key}`;
        const id = findReferenceByDoi(userId, doi)?.id || deterministicId;
        const authors = normalizeReferenceAuthors(item.authors);
        const keywords = normalizeReferenceKeywords(item.keywords);
        upsert.run(
          id,
          userId,
          item.title,
          JSON.stringify(authors),
          item.year,
          item.abstract,
          doi,
          item.url,
          item.journal,
          item.itemType || 'article',
          source,
          item.citationKey || null,
          JSON.stringify(keywords),
          item.citationKey || null,
        );
        // Imported keywords are additive. Do not erase user-curated tags when
        // the same DOI is refreshed from another source.
        for (const tag of keywords) {
          insertTag.run(id, tag);
        }
        ids.add(id);
      }
      return [...ids];
    });

    try {
      return tx(items);
    } catch (err) {
      throw err;
    }
  },

  /** List user references with optional search and pagination. */
  getUserReferences: (userId, { search, tags, folderId, limit = 50, offset = 0 } = {}) => {
    try {
      let query = 'SELECT * FROM references_library WHERE user_id = ?';
      const params = [userId];

      if (search) {
        query += ' AND (title LIKE ? OR authors LIKE ? OR journal LIKE ? OR abstract LIKE ? OR doi LIKE ? OR citation_key LIKE ? OR keywords LIKE ?)';
        const term = `%${search}%`;
        params.push(term, term, term, term, term, term, term);
      }

      if (tags && tags.length > 0) {
        query += ` AND id IN (SELECT reference_id FROM reference_tags WHERE tag IN (${tags.map(() => '?').join(',')}))`;
        params.push(...tags);
      }

      if (folderId === 'unfiled') {
        query += ' AND id NOT IN (SELECT reference_id FROM reference_folder_items)';
      } else if (folderId) {
        query += ` AND id IN (
          SELECT rfi.reference_id
          FROM reference_folder_items rfi
          JOIN reference_folders rf ON rf.id = rfi.folder_id
          WHERE rfi.folder_id = ? AND rf.user_id = ?
        )`;
        params.push(folderId, userId);
      }

      query += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const rows = db.prepare(query).all(...params);
      return rows.map((r) => ({
        ...r,
        authors: r.authors ? JSON.parse(r.authors) : [],
        keywords: r.keywords ? JSON.parse(r.keywords) : [],
        raw_data: undefined, // Don't send raw_data in list
      }));
    } catch (err) {
      throw err;
    }
  },

  /** Count references using the same filters as the paginated library query. */
  countUserReferences: (userId, { search, tags, folderId } = {}) => {
    try {
      let query = 'SELECT COUNT(*) AS count FROM references_library WHERE user_id = ?';
      const params = [userId];

      if (search) {
        query += ' AND (title LIKE ? OR authors LIKE ? OR journal LIKE ? OR abstract LIKE ? OR doi LIKE ? OR citation_key LIKE ? OR keywords LIKE ?)';
        const term = `%${search}%`;
        params.push(term, term, term, term, term, term, term);
      }

      if (tags && tags.length > 0) {
        query += ` AND id IN (SELECT reference_id FROM reference_tags WHERE tag IN (${tags.map(() => '?').join(',')}))`;
        params.push(...tags);
      }

      if (folderId === 'unfiled') {
        query += ' AND id NOT IN (SELECT reference_id FROM reference_folder_items)';
      } else if (folderId) {
        query += ` AND id IN (
          SELECT rfi.reference_id
          FROM reference_folder_items rfi
          JOIN reference_folders rf ON rf.id = rfi.folder_id
          WHERE rfi.folder_id = ? AND rf.user_id = ?
        )`;
        params.push(folderId, userId);
      }

      return Number(db.prepare(query).get(...params)?.count || 0);
    } catch (err) {
      throw err;
    }
  },

  /** Single reference detail. */
  getReference: (id, userId) => {
    try {
      const row = db.prepare('SELECT * FROM references_library WHERE id = ? AND user_id = ?').get(id, userId);
      if (!row) return null;
      return {
        ...row,
        authors: row.authors ? JSON.parse(row.authors) : [],
        keywords: row.keywords ? JSON.parse(row.keywords) : [],
        raw_data: row.raw_data ? JSON.parse(row.raw_data) : null,
      };
    } catch (err) {
      throw err;
    }
  },

  /** Compact Zotero source index used to preview local-library sync changes. */
  getZoteroSourceIndex: (userId) => {
    const rows = db.prepare(`
      SELECT id, source_id, raw_data, updated_at
      FROM references_library
      WHERE user_id = ? AND source = 'zotero' AND source_id IS NOT NULL
    `).all(userId);
    return rows.map((row) => ({
      id: row.id,
      source_id: row.source_id,
      raw_data: row.raw_data ? (() => {
        try { return JSON.parse(row.raw_data); } catch { return null; }
      })() : null,
      updated_at: row.updated_at,
    }));
  },

  /** Update user-editable bibliographic metadata without changing identity. */
  updateReference: (userId, id, patch) => {
    const current = referencesDb.getReference(id, userId);
    if (!current) return { status: 'not_found', reference: null };

    const doi = Object.prototype.hasOwnProperty.call(patch, 'doi')
      ? normalizeReferenceDoi(patch.doi)
      : current.doi;
    const doiOwner = findReferenceByDoi(userId, doi);
    if (doiOwner && doiOwner.id !== id) {
      return { status: 'duplicate_doi', reference: null, duplicateId: doiOwner.id };
    }

    const next = {
      title: Object.prototype.hasOwnProperty.call(patch, 'title') ? String(patch.title || '').trim() : current.title,
      authors: Object.prototype.hasOwnProperty.call(patch, 'authors') ? normalizeReferenceAuthors(patch.authors) : current.authors,
      year: Object.prototype.hasOwnProperty.call(patch, 'year') ? patch.year : current.year,
      abstract: Object.prototype.hasOwnProperty.call(patch, 'abstract') ? String(patch.abstract || '').trim() || null : current.abstract,
      doi,
      url: Object.prototype.hasOwnProperty.call(patch, 'url') ? String(patch.url || '').trim() || null : current.url,
      journal: Object.prototype.hasOwnProperty.call(patch, 'journal') ? String(patch.journal || '').trim() || null : current.journal,
      itemType: Object.prototype.hasOwnProperty.call(patch, 'item_type') ? String(patch.item_type || '').trim() || 'article' : current.item_type,
      keywords: Object.prototype.hasOwnProperty.call(patch, 'keywords') ? normalizeReferenceKeywords(patch.keywords) : current.keywords,
      citationKey: Object.prototype.hasOwnProperty.call(patch, 'citation_key') ? String(patch.citation_key || '').trim() || null : current.citation_key,
    };
    if (!next.title) return { status: 'invalid_title', reference: null };

    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE references_library
        SET title = ?, authors = ?, year = ?, abstract = ?, doi = ?, url = ?,
            journal = ?, item_type = ?, keywords = ?, citation_key = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `).run(
        next.title,
        JSON.stringify(next.authors),
        next.year,
        next.abstract,
        next.doi,
        next.url,
        next.journal,
        next.itemType,
        JSON.stringify(next.keywords),
        next.citationKey,
        id,
        userId,
      );
      db.prepare('DELETE FROM reference_tags WHERE reference_id = ?').run(id);
      const insertTag = db.prepare('INSERT OR IGNORE INTO reference_tags (reference_id, tag) VALUES (?, ?)');
      for (const keyword of next.keywords) insertTag.run(id, keyword);
    });
    tx();
    return { status: 'updated', reference: referencesDb.getReference(id, userId) };
  },

  /** Batch reference detail lookup preserving the requested id order. */
  getReferencesByIds: (userId, referenceIds) => {
    try {
      if (!Array.isArray(referenceIds) || referenceIds.length === 0) {
        return [];
      }

      const placeholders = referenceIds.map(() => '?').join(',');
      const rows = db.prepare(
        `SELECT * FROM references_library WHERE user_id = ? AND id IN (${placeholders})`
      ).all(userId, ...referenceIds);

      const byId = new Map(rows.map((row) => [
        row.id,
        {
          ...row,
          authors: row.authors ? JSON.parse(row.authors) : [],
          keywords: row.keywords ? JSON.parse(row.keywords) : [],
          raw_data: row.raw_data ? JSON.parse(row.raw_data) : null,
        },
      ]));

      return referenceIds
        .map((id) => byId.get(id) || null)
        .filter(Boolean);
    } catch (err) {
      throw err;
    }
  },

  /** Get references linked to a project. */
  getProjectReferences: (projectId, userId) => {
    try {
      const rows = db.prepare(`
        SELECT r.*, pr.added_at AS linked_at
        FROM references_library r
        JOIN project_references pr ON pr.reference_id = r.id
        WHERE pr.project_id = ? AND r.user_id = ?
        ORDER BY pr.added_at DESC
      `).all(projectId, userId);
      return rows.map((r) => ({
        ...r,
        authors: r.authors ? JSON.parse(r.authors) : [],
        keywords: r.keywords ? JSON.parse(r.keywords) : [],
        raw_data: undefined,
      }));
    } catch (err) {
      throw err;
    }
  },

  /** Get project-reference links for a set of references owned by a user. */
  getReferenceProjectLinks: (userId, referenceIds) => {
    try {
      if (!Array.isArray(referenceIds) || referenceIds.length === 0) {
        return [];
      }

      const placeholders = referenceIds.map(() => '?').join(',');
      return db.prepare(`
        SELECT
          pr.project_id,
          pr.reference_id,
          pr.added_at
        FROM project_references pr
        JOIN references_library r ON r.id = pr.reference_id
        WHERE r.user_id = ?
          AND pr.reference_id IN (${placeholders})
        ORDER BY pr.added_at DESC
      `).all(userId, ...referenceIds);
    } catch (err) {
      throw err;
    }
  },

  /** Link a reference to a project (verifies ownership). */
  linkToProject: (projectId, referenceId, userId) => {
    try {
      const ref = db.prepare('SELECT id FROM references_library WHERE id = ? AND user_id = ?').get(referenceId, userId);
      if (!ref) return false;
      db.prepare('INSERT OR IGNORE INTO project_references (project_id, reference_id) VALUES (?, ?)').run(projectId, referenceId);
      return true;
    } catch (err) {
      throw err;
    }
  },

  /** Unlink a reference from a project (verifies ownership). */
  unlinkFromProject: (projectId, referenceId, userId) => {
    try {
      const ref = db.prepare('SELECT id FROM references_library WHERE id = ? AND user_id = ?').get(referenceId, userId);
      if (!ref) return false;
      const result = db.prepare('DELETE FROM project_references WHERE project_id = ? AND reference_id = ?').run(projectId, referenceId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  /** Bulk-link an array of reference IDs to a project. */
  bulkLinkIds: (projectId, referenceIds) => {
    const insert = db.prepare('INSERT OR IGNORE INTO project_references (project_id, reference_id) VALUES (?, ?)');
    const tx = db.transaction((ids) => {
      let count = 0;
      for (const id of ids) {
        count += insert.run(projectId, id).changes;
      }
      return count;
    });
    return tx(referenceIds);
  },

  /** Bulk-unlink an array of reference IDs from a project. */
  bulkUnlinkIds: (projectId, referenceIds) => {
    if (!Array.isArray(referenceIds) || referenceIds.length === 0) {
      return 0;
    }

    const remove = db.prepare('DELETE FROM project_references WHERE project_id = ? AND reference_id = ?');
    const tx = db.transaction((ids) => {
      let count = 0;
      for (const id of ids) {
        count += remove.run(projectId, id).changes;
      }
      return count;
    });

    return tx(referenceIds);
  },

  /** Get all unique tags for a user. */
  getTags: (userId) => {
    try {
      const rows = db.prepare(`
        SELECT DISTINCT rt.tag, COUNT(*) as count
        FROM reference_tags rt
        JOIN references_library r ON r.id = rt.reference_id
        WHERE r.user_id = ?
        GROUP BY rt.tag
        ORDER BY count DESC
      `).all(userId);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  /** List user folders with reference counts and library-wide totals. */
  getFolders: (userId) => {
    const folders = db.prepare(`
      SELECT
        rf.id,
        rf.name,
        rf.parent_id,
        rf.created_at,
        rf.updated_at,
        COUNT(rfi.reference_id) AS reference_count
      FROM reference_folders rf
      LEFT JOIN reference_folder_items rfi ON rfi.folder_id = rf.id
      WHERE rf.user_id = ?
      GROUP BY rf.id
      ORDER BY LOWER(rf.name), rf.created_at
    `).all(userId).map((folder) => ({
      ...folder,
      reference_count: Number(folder.reference_count || 0),
    }));
    const totals = db.prepare(`
      SELECT
        COUNT(*) AS total_count,
        COALESCE(SUM(CASE WHEN NOT EXISTS (
          SELECT 1 FROM reference_folder_items rfi WHERE rfi.reference_id = r.id
        ) THEN 1 ELSE 0 END), 0) AS unfiled_count
      FROM references_library r
      WHERE r.user_id = ?
    `).get(userId);
    return {
      folders,
      total_count: Number(totals?.total_count || 0),
      unfiled_count: Number(totals?.unfiled_count || 0),
    };
  },

  getFolder: (userId, folderId) => db.prepare(`
    SELECT id, name, parent_id, created_at, updated_at
    FROM reference_folders
    WHERE id = ? AND user_id = ?
  `).get(folderId, userId) || null,

  createFolder: (userId, name, parentId = null) => {
    if (parentId) {
      const parent = db.prepare('SELECT id FROM reference_folders WHERE id = ? AND user_id = ?').get(parentId, userId);
      if (!parent) return null;
    }
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO reference_folders (id, user_id, name, parent_id)
      VALUES (?, ?, ?, ?)
    `).run(id, userId, name, parentId || null);
    return db.prepare(`
      SELECT id, name, parent_id, created_at, updated_at, 0 AS reference_count
      FROM reference_folders WHERE id = ? AND user_id = ?
    `).get(id, userId);
  },

  /** Reuse or create a nested literature-folder path. */
  getOrCreateFolderPath: (userId, segments) => {
    const normalized = (Array.isArray(segments) ? segments : [])
      .map((segment) => String(segment || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    if (normalized.length === 0) return null;

    const find = db.prepare(`
      SELECT id, name, parent_id FROM reference_folders
      WHERE user_id = ? AND name = ? AND COALESCE(parent_id, '') = COALESCE(?, '')
      LIMIT 1
    `);
    const insert = db.prepare(`
      INSERT OR IGNORE INTO reference_folders (id, user_id, name, parent_id)
      VALUES (?, ?, ?, ?)
    `);
    const tx = db.transaction((parts) => {
      let parentId = null;
      for (const name of parts) {
        let folder = find.get(userId, name, parentId);
        if (!folder) {
          insert.run(crypto.randomUUID(), userId, name, parentId);
          folder = find.get(userId, name, parentId);
        }
        parentId = folder.id;
      }
      return parentId ? referencesDb.getFolder(userId, parentId) : null;
    });
    return tx(normalized);
  },

  renameFolder: (userId, folderId, name) => {
    const result = db.prepare(`
      UPDATE reference_folders
      SET name = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(name, folderId, userId);
    if (result.changes === 0) return null;
    return db.prepare(`
      SELECT rf.id, rf.name, rf.parent_id, rf.created_at, rf.updated_at,
             COUNT(rfi.reference_id) AS reference_count
      FROM reference_folders rf
      LEFT JOIN reference_folder_items rfi ON rfi.folder_id = rf.id
      WHERE rf.id = ? AND rf.user_id = ?
      GROUP BY rf.id
    `).get(folderId, userId);
  },

  deleteFolder: (userId, folderId) => {
    const result = db.prepare('DELETE FROM reference_folders WHERE id = ? AND user_id = ?').run(folderId, userId);
    return result.changes > 0;
  },

  addReferencesToFolder: (userId, folderId, referenceIds) => {
    const folder = db.prepare('SELECT id FROM reference_folders WHERE id = ? AND user_id = ?').get(folderId, userId);
    if (!folder) return null;
    const findReference = db.prepare('SELECT id FROM references_library WHERE id = ? AND user_id = ?');
    const insert = db.prepare('INSERT OR IGNORE INTO reference_folder_items (folder_id, reference_id) VALUES (?, ?)');
    const tx = db.transaction((ids) => {
      let added = 0;
      for (const referenceId of ids) {
        if (findReference.get(referenceId, userId)) {
          added += insert.run(folderId, referenceId).changes;
        }
      }
      return added;
    });
    return tx(referenceIds);
  },

  removeReferenceFromFolder: (userId, folderId, referenceId) => {
    const result = db.prepare(`
      DELETE FROM reference_folder_items
      WHERE folder_id = ? AND reference_id = ?
        AND folder_id IN (SELECT id FROM reference_folders WHERE user_id = ?)
    `).run(folderId, referenceId, userId);
    return result.changes > 0;
  },

  removeReferenceFromAllFolders: (userId, referenceId) => {
    const reference = db.prepare('SELECT id FROM references_library WHERE id = ? AND user_id = ?').get(referenceId, userId);
    if (!reference) return null;
    const result = db.prepare('DELETE FROM reference_folder_items WHERE reference_id = ?').run(referenceId);
    return result.changes;
  },

  /** Aggregate high-level library stats for the global research library view. */
  getLibraryOverview: (userId) => {
    try {
      const referenceStats = db.prepare(`
        SELECT
          COUNT(*) AS total_references,
          COALESCE(SUM(CASE WHEN source = 'zotero' THEN 1 ELSE 0 END), 0) AS zotero_references,
          COALESCE(SUM(CASE WHEN source = 'bibtex' THEN 1 ELSE 0 END), 0) AS bibtex_references,
          COALESCE(SUM(CASE WHEN source = 'news_monitor' THEN 1 ELSE 0 END), 0) AS news_references,
          COALESCE(SUM(CASE WHEN pdf_cached > 0 THEN 1 ELSE 0 END), 0) AS pdf_cached_references,
          MAX(updated_at) AS latest_reference_update
        FROM references_library
        WHERE user_id = ?
      `).get(userId);

      const linkStats = db.prepare(`
        SELECT
          COUNT(DISTINCT pr.reference_id) AS linked_references,
          COUNT(DISTINCT pr.project_id) AS linked_projects
        FROM project_references pr
        JOIN references_library r ON r.id = pr.reference_id
        WHERE r.user_id = ?
      `).get(userId);

      return {
        total_references: Number(referenceStats?.total_references || 0),
        zotero_references: Number(referenceStats?.zotero_references || 0),
        bibtex_references: Number(referenceStats?.bibtex_references || 0),
        news_references: Number(referenceStats?.news_references || 0),
        pdf_cached_references: Number(referenceStats?.pdf_cached_references || 0),
        latest_reference_update: referenceStats?.latest_reference_update || null,
        linked_references: Number(linkStats?.linked_references || 0),
        linked_projects: Number(linkStats?.linked_projects || 0),
      };
    } catch (err) {
      throw err;
    }
  },

  /** Mark a reference as having its PDF cached. */
  setPdfCached: (id, cached = true) => {
    try {
      db.prepare('UPDATE references_library SET pdf_cached = ? WHERE id = ?').run(cached ? 1 : 0, id);
    } catch (err) {
      throw err;
    }
  },

  /** Delete a reference. */
  deleteReference: (userId, referenceId) => {
    try {
      const tx = db.transaction(() => {
        db.prepare('DELETE FROM monitor_candidates WHERE user_id = ? AND reference_id = ?').run(userId, referenceId);
        db.prepare('DELETE FROM monitor_runs WHERE user_id = ? AND reference_id = ?').run(userId, referenceId);
        return db.prepare('DELETE FROM references_library WHERE id = ? AND user_id = ?').run(referenceId, userId);
      });
      const result = tx();
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  /** Bulk-delete references by id list. Returns number of deleted rows. */
  bulkDeleteReferences: (userId, referenceIds) => {
    if (!referenceIds || referenceIds.length === 0) return 0;
    // Chunk to avoid SQLite parameter limit
    const CHUNK_SIZE = 500;
    let total = 0;
    const tx = db.transaction(() => {
      for (let i = 0; i < referenceIds.length; i += CHUNK_SIZE) {
        const chunk = referenceIds.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => '?').join(',');
        db.prepare(
          `DELETE FROM monitor_candidates WHERE user_id = ? AND reference_id IN (${placeholders})`
        ).run(userId, ...chunk);
        db.prepare(
          `DELETE FROM monitor_runs WHERE user_id = ? AND reference_id IN (${placeholders})`
        ).run(userId, ...chunk);
        const result = db.prepare(
          `DELETE FROM references_library WHERE user_id = ? AND id IN (${placeholders})`
        ).run(userId, ...chunk);
        total += result.changes;
      }
    });
    tx();
    return total;
  },
};

const medLibraryReportPreviewDb = {
  listForUser: (userId) => {
    try {
      return db.prepare(`
        SELECT m.*, p.display_name AS live_display_name
        FROM med_library_report_preview m
        LEFT JOIN projects p ON p.id = m.project_name AND p.user_id = m.user_id
        WHERE m.user_id = ?
          AND m.kb_upload_relative_path IS NOT NULL
          AND trim(m.kb_upload_relative_path) <> ''
        ORDER BY datetime(m.created_at) DESC
      `).all(userId);
    } catch (err) {
      console.error('medLibraryReportPreviewDb.listForUser:', err.message);
      return [];
    }
  },

  getById: (userId, id) => {
    try {
      return db.prepare(
        'SELECT * FROM med_library_report_preview WHERE user_id = ? AND id = ?',
      ).get(userId, id);
    } catch (err) {
      console.error('medLibraryReportPreviewDb.getById:', err.message);
      return null;
    }
  },

  findByPath: (userId, projectName, relativePath) => {
    try {
      return db.prepare(`
        SELECT * FROM med_library_report_preview
        WHERE user_id = ? AND project_name = ? AND relative_path = ?
      `).get(userId, projectName, relativePath);
    } catch (err) {
      console.error('medLibraryReportPreviewDb.findByPath:', err.message);
      return null;
    }
  },

  insert: ({
    id,
    userId,
    projectName,
    projectDisplayName,
    relativePath,
    title,
    kbUploadRelativePath,
  }) => {
    try {
      db.prepare(`
        INSERT INTO med_library_report_preview (
          id, user_id, project_name, project_display_name, relative_path, title, kb_upload_relative_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        userId,
        projectName,
        projectDisplayName || null,
        relativePath,
        title || null,
        kbUploadRelativePath || null,
      );
      return true;
    } catch (err) {
      console.error('medLibraryReportPreviewDb.insert:', err.message);
      return false;
    }
  },

  deleteForUser: (userId, id) => {
    try {
      const result = db.prepare(
        'DELETE FROM med_library_report_preview WHERE user_id = ? AND id = ?',
      ).run(userId, id);
      return result.changes > 0;
    } catch (err) {
      console.error('medLibraryReportPreviewDb.deleteForUser:', err.message);
      return false;
    }
  },

  upgradeLegacyEntryToCurated: (userId, id, kbUploadRelativePath, title) => {
    try {
      const result = db.prepare(`
        UPDATE med_library_report_preview
        SET
          kb_upload_relative_path = ?,
          title = COALESCE(NULLIF(trim(?), ''), title)
        WHERE user_id = ? AND id = ?
      `).run(
        kbUploadRelativePath,
        title || null,
        userId,
        id,
      );
      return result.changes > 0;
    } catch (err) {
      console.error('medLibraryReportPreviewDb.upgradeLegacyEntryToCurated:', err.message);
      return false;
    }
  },
};

function safeParseDbJson(value, fallback) {
  if (value == null || value === '') {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapOperatingAssetRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    userId: row.user_id,
    assetType: row.asset_type,
    title: row.title,
    stageKey: row.stage_key || null,
    stageLabel: row.stage_label || null,
    description: row.description || null,
    content: safeParseDbJson(row.content_json, {}),
    metadata: safeParseDbJson(row.metadata_json, null),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

const medLibraryOperatingAssetDb = {
  listForUser: (userId, assetType = null) => {
    try {
      const rows = assetType
        ? db.prepare(`
          SELECT *
          FROM med_library_operating_assets
          WHERE user_id = ? AND asset_type = ?
          ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
        `).all(userId, assetType)
        : db.prepare(`
          SELECT *
          FROM med_library_operating_assets
          WHERE user_id = ?
          ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
        `).all(userId);
      return rows.map(mapOperatingAssetRow).filter(Boolean);
    } catch (err) {
      console.error('medLibraryOperatingAssetDb.listForUser:', err.message);
      return [];
    }
  },

  getById: (userId, id) => {
    try {
      const row = db.prepare(`
        SELECT *
        FROM med_library_operating_assets
        WHERE user_id = ? AND id = ?
      `).get(userId, id);
      return mapOperatingAssetRow(row);
    } catch (err) {
      console.error('medLibraryOperatingAssetDb.getById:', err.message);
      return null;
    }
  },

  save: ({
    id,
    userId,
    assetType,
    title,
    stageKey,
    stageLabel,
    description,
    content,
    metadata = null,
  }) => {
    try {
      const nextId = id || crypto.randomUUID();
      const existing = id ? medLibraryOperatingAssetDb.getById(userId, id) : null;
      if (existing) {
        db.prepare(`
          UPDATE med_library_operating_assets
          SET
            asset_type = ?,
            title = ?,
            stage_key = ?,
            stage_label = ?,
            description = ?,
            content_json = ?,
            metadata_json = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND id = ?
        `).run(
          assetType,
          title,
          stageKey || null,
          stageLabel || null,
          description || null,
          JSON.stringify(content || {}),
          metadata ? JSON.stringify(metadata) : null,
          userId,
          nextId,
        );
      } else {
        db.prepare(`
          INSERT INTO med_library_operating_assets (
            id, user_id, asset_type, title, stage_key, stage_label, description, content_json, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          nextId,
          userId,
          assetType,
          title,
          stageKey || null,
          stageLabel || null,
          description || null,
          JSON.stringify(content || {}),
          metadata ? JSON.stringify(metadata) : null,
        );
      }
      return medLibraryOperatingAssetDb.getById(userId, nextId);
    } catch (err) {
      console.error('medLibraryOperatingAssetDb.save:', err.message);
      return null;
    }
  },

  deleteForUser: (userId, id) => {
    try {
      const result = db.prepare(`
        DELETE FROM med_library_operating_assets
        WHERE user_id = ? AND id = ?
      `).run(userId, id);
      return result.changes > 0;
    } catch (err) {
      console.error('medLibraryOperatingAssetDb.deleteForUser:', err.message);
      return false;
    }
  },
};

export {
  db,
  initializeDatabase,
  userDb,
  authSessionDb,
  registrationRequestDb,
  userPreferenceMemoryDb,
  userLongTermMemoryDb,
  autoResearchDb,
  appSettingsDb,
  auditLogDb,
  userSettingsDb,
  gatewayDb,
  conversationShareDb,
  accountConversationDb,
  feedbackDb,
  apiKeysDb,
  credentialsDb,
  localPiProviderDb,
  githubTokensDb, // Backward compatibility
  sessionDb,
  tagDb,
  projectDb,
  projectActivityDb,
  conceptsDb,
  monitorDb,
  referencesDb,
  medLibraryReportPreviewDb,
  medLibraryOperatingAssetDb,
  normalizeSessionTimestamp
};
