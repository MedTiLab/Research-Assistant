import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDatabasePath = process.env.DATABASE_PATH;

let tempRoot = null;

async function loadTestModules() {
  vi.resetModules();
  const projects = await import('../projects.js');
  const database = await import('../database/db.js');
  await database.initializeDatabase();
  return { projects, database };
}

describe('session deletion fallbacks', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dr-claw-session-delete-'));
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;
    process.env.DATABASE_PATH = path.join(tempRoot, 'db', 'auth.db');
  });

  afterEach(async () => {
    vi.resetModules();

    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;

    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;

    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;

    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('deletes a Claude session from the index when the project directory is missing', async () => {
    const { projects, database } = await loadTestModules();
    const projectName = 'tmp-project';
    const sessionId = 'claude-session-missing-file';

    database.sessionDb.upsertSessionPlaceholder(sessionId, projectName, 'claude');
    expect(database.sessionDb.getSessionById(sessionId)?.provider).toBe('claude');

    await expect(projects.deleteSession(projectName, sessionId, 'claude')).resolves.toBe(true);
    expect(database.sessionDb.getSessionById(sessionId)).toBeNull();
  });

  it('deletes a Codex session from the index when the jsonl file is missing', async () => {
    const { projects, database } = await loadTestModules();
    const projectName = 'tmp-project';
    const sessionId = 'codex-session-missing-file';

    database.sessionDb.upsertSessionPlaceholder(sessionId, projectName, 'codex');
    expect(database.sessionDb.getSessionById(sessionId)?.provider).toBe('codex');

    await expect(projects.deleteCodexSession(sessionId)).resolves.toBe(true);
    expect(database.sessionDb.getSessionById(sessionId)).toBeNull();
  });

  it('deletes an OpenRouter session from the home-scoped MedHelp data directory', async () => {
    const { projects, database } = await loadTestModules();
    const projectPath = path.join(tempRoot, 'workspace-openrouter');
    const projectName = '-Users-test-workspace-openrouter';
    const sessionId = 'openrouter-session-local-file';
    const { getProviderSessionFilePath } = await import('../utils/storagePaths.js');
    const sessionFile = getProviderSessionFilePath(projectPath, 'openrouter-sessions', sessionId);

    await mkdir(path.dirname(sessionFile), { recursive: true });
    await writeFile(sessionFile, '{"role":"user","content":"hello"}\n', 'utf8');

    database.projectDb.upsertProject(projectName, null, 'Workspace OpenRouter', projectPath);
    database.sessionDb.upsertSessionPlaceholder(sessionId, projectName, 'openrouter', 'OpenRouter Session', null, {
      projectPath,
    });

    await expect(projects.deleteSession(projectName, sessionId, 'openrouter')).resolves.toBe(true);
    await expect(access(sessionFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(database.sessionDb.getSessionById(sessionId)).toBeNull();
  });

  it('deletes an OpenRouter session from the legacy project-local .med-help directory as a fallback', async () => {
    const { projects, database } = await loadTestModules();
    const projectPath = path.join(tempRoot, 'workspace-openrouter-legacy');
    const projectName = '-Users-test-workspace-openrouter-legacy';
    const sessionId = 'openrouter-session-legacy-file';
    const sessionFile = path.join(projectPath, '.med-help', 'openrouter-sessions', `${sessionId}.jsonl`);

    await mkdir(path.dirname(sessionFile), { recursive: true });
    await writeFile(sessionFile, '{"role":"user","content":"hello"}\n', 'utf8');

    database.projectDb.upsertProject(projectName, null, 'Workspace OpenRouter Legacy', projectPath);
    database.sessionDb.upsertSessionPlaceholder(sessionId, projectName, 'openrouter', 'OpenRouter Session', null, {
      projectPath,
    });

    await expect(projects.deleteSession(projectName, sessionId, 'openrouter')).resolves.toBe(true);
    await expect(access(sessionFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(database.sessionDb.getSessionById(sessionId)).toBeNull();
  });

  it('deletes a Local GPU session from the legacy shared directory as a fallback', async () => {
    const { projects, database } = await loadTestModules();
    const projectPath = path.join(tempRoot, 'workspace-localgpu');
    const projectName = '-Users-test-workspace-localgpu';
    const sessionId = 'localgpu-session-legacy-file';
    const sessionFile = path.join(tempRoot, '.medhelpsec', 'localgpu-sessions', `${sessionId}.jsonl`);

    await mkdir(path.dirname(sessionFile), { recursive: true });
    await writeFile(sessionFile, '{"role":"user","content":"hello"}\n', 'utf8');

    database.projectDb.upsertProject(projectName, null, 'Workspace Local GPU', projectPath);
    database.sessionDb.upsertSessionPlaceholder(sessionId, projectName, 'local', 'Local Session', null, {
      projectPath,
    });

    await expect(projects.deleteSession(projectName, sessionId, 'local')).resolves.toBe(true);
    await expect(access(sessionFile)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(database.sessionDb.getSessionById(sessionId)).toBeNull();
  });
});
