import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
let tempRoot = null;

async function loadModules() {
  vi.resetModules();
  const dbModule = await import('../database/db.js');
  const memoryModule = await import('../utils/userPreferenceMemory.js');
  return { ...dbModule, ...memoryModule };
}

describe('user preference memory', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-user-memory-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });

  afterEach(async () => {
    vi.resetModules();

    if (originalDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = originalDatabasePath;
    }

    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('builds a hidden prompt block from enabled memories', async () => {
    const {
      initializeDatabase,
      userDb,
      userPreferenceMemoryDb,
      buildUserPreferenceMemoryBlock,
      prependUserPreferenceMemoryToPrompt,
    } = await loadModules();

    await initializeDatabase();
    const createdUser = userDb.createUser('memory-test-user', 'hashed-password');

    userPreferenceMemoryDb.create(createdUser.id, 'Prefer concise answers', 'preference');
    userPreferenceMemoryDb.create(createdUser.id, 'Use Python unless I ask otherwise', 'workflow');

    const block = buildUserPreferenceMemoryBlock(createdUser.id, { maxItems: 5 });
    expect(block).toContain('<user_preferences>');
    expect(block).toContain('[workflow] Use Python unless I ask otherwise');
    expect(block).toContain('[preference] Prefer concise answers');

    const prompt = prependUserPreferenceMemoryToPrompt('请继续分析数据。', createdUser.id);
    expect(prompt).toContain('<user_preferences>');
    expect(prompt).toContain('请继续分析数据。');
  });

  it('injects all five saved preferences by default for every provider caller', async () => {
    const {
      initializeDatabase,
      userDb,
      userPreferenceMemoryDb,
      buildUserPreferenceMemoryBlock,
    } = await loadModules();

    await initializeDatabase();
    const createdUser = userDb.createUser('five-memory-user', 'hashed-password');
    for (let index = 1; index <= 5; index += 1) {
      userPreferenceMemoryDb.create(createdUser.id, `Saved rule ${index}`, 'workflow');
    }

    const block = buildUserPreferenceMemoryBlock(createdUser.id);
    for (let index = 1; index <= 5; index += 1) {
      expect(block).toContain(`Saved rule ${index}`);
    }
  });

  it('respects the user-level memory toggle and avoids duplicate injection', async () => {
    const {
      initializeDatabase,
      userDb,
      userPreferenceMemoryDb,
      prependUserPreferenceMemoryToPrompt,
    } = await loadModules();

    await initializeDatabase();
    const createdUser = userDb.createUser('memory-disabled-user', 'hashed-password');
    userPreferenceMemoryDb.create(createdUser.id, '# Prefer bullet summaries', 'preference');

    userPreferenceMemoryDb.setMemoryEnabled(createdUser.id, false);
    expect(prependUserPreferenceMemoryToPrompt('继续', createdUser.id)).toBe('继续');

    userPreferenceMemoryDb.setMemoryEnabled(createdUser.id, true);
    const once = prependUserPreferenceMemoryToPrompt('继续', createdUser.id);
    const twice = prependUserPreferenceMemoryToPrompt(once, createdUser.id);
    expect(twice).toBe(once);
    expect(once).not.toContain('# Prefer bullet summaries');
    expect(once).toContain('Prefer bullet summaries');
  });

  it('injects the selected analysis language as hidden prompt context', async () => {
    const {
      initializeDatabase,
      userDb,
      prependUserPreferenceMemoryToPrompt,
    } = await loadModules();

    await initializeDatabase();
    const createdUser = userDb.createUser('analysis-language-user', 'hashed-password');

    const prompt = prependUserPreferenceMemoryToPrompt('继续分析数据。', createdUser.id, {
      analysisLanguage: 'r',
    });

    expect(prompt).toContain('<analysis_preferences>');
    expect(prompt).toContain('Prefer R for statistical analysis code');
    expect(prompt).toContain('继续分析数据。');

    const duplicated = prependUserPreferenceMemoryToPrompt(prompt, createdUser.id, {
      analysisLanguage: 'r',
    });
    expect(duplicated).toBe(prompt);
  });

  it('prefers project-scoped memories when building a prompt for that project', async () => {
    const {
      initializeDatabase,
      userDb,
      userPreferenceMemoryDb,
      buildUserPreferenceMemoryBlock,
      prependUserPreferenceMemoryToPrompt,
    } = await loadModules();

    await initializeDatabase();
    const createdUser = userDb.createUser('project-memory-user', 'hashed-password');
    const projectPath = '/tmp/demo-project';

    userPreferenceMemoryDb.create(createdUser.id, 'Use concise summaries', 'preference');
    userPreferenceMemoryDb.create(createdUser.id, 'This project targets Vancouver citations', 'workflow', 'project', projectPath);

    const projectBlock = buildUserPreferenceMemoryBlock(createdUser.id, {
      projectPath,
      maxItems: 5,
    });
    expect(projectBlock).toContain('[project] [workflow] This project targets Vancouver citations');
    expect(projectBlock).toContain('Use concise summaries');

    const otherProjectBlock = buildUserPreferenceMemoryBlock(createdUser.id, {
      projectPath: '/tmp/other-project',
      maxItems: 5,
    });
    expect(otherProjectBlock).not.toContain('This project targets Vancouver citations');

    const prompt = prependUserPreferenceMemoryToPrompt('继续写 discussion。', createdUser.id, { projectPath });
    expect(prompt).toContain('This project targets Vancouver citations');
  });

  it('injects freshly synced cloud context without requiring a local user row', async () => {
    const { prependUserPreferenceMemoryToPrompt } = await loadModules();

    const prompt = prependUserPreferenceMemoryToPrompt('继续分析。', null, {
      projectPath: '/different-machine/demo-project',
      preferenceContext: {
        enabled: true,
        aboutYou: 'I work in clinical epidemiology',
        analysisLanguagePreference: 'r',
        memories: [
          {
            content: 'Use the cohort-specific endpoint definition',
            category: 'context',
            scope: 'project',
            projectPath: '/old-machine/demo-project',
            projectKey: 'demo-project',
          },
        ],
      },
    });

    expect(prompt).toContain('[about_you] I work in clinical epidemiology');
    expect(prompt).toContain('Use the cohort-specific endpoint definition');
    expect(prompt).toContain('Prefer R for statistical analysis code');
  });

  it('does not add a project MEMORY.md reminder to every turn', async () => {
    const { prependUserPreferenceMemoryToPrompt } = await loadModules();
    const projectPath = path.join(tempRoot, 'project-with-memory');
    await fs.mkdir(projectPath, { recursive: true });
    await fs.writeFile(path.join(projectPath, 'MEMORY.md'), '# Project Memory\n\nPrivate project details.\n', 'utf8');

    const prompt = prependUserPreferenceMemoryToPrompt('继续工作。', null, { projectPath });

    expect(prompt).toBe('继续工作。');
    expect(prompt).not.toContain('<project_memory_file>');
    expect(prompt).not.toContain('Private project details.');
  });

  it('migrates legacy project memories before creating the project-key index', async () => {
    const { default: Database } = await import('better-sqlite3');
    const legacyDb = new Database(process.env.DATABASE_PATH);
    legacyDb.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        is_active BOOLEAN DEFAULT 1
      );
      CREATE TABLE user_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        scope TEXT DEFAULT 'user',
        project_path TEXT,
        is_enabled BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users (username, password_hash) VALUES ('legacy-project-user', 'hash');
      INSERT INTO user_memories (user_id, content, scope, project_path)
      VALUES (1, 'Legacy project preference', 'project', '/old-machine/demo-project');
    `);
    legacyDb.close();

    const { initializeDatabase, userPreferenceMemoryDb } = await loadModules();
    await initializeDatabase();

    expect(userPreferenceMemoryDb.getAll(1)[0].project_key).toBe('demo-project');
  });
});
