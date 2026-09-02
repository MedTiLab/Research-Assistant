import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
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

describe('Codex session rename', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'medhelp-codex-rename-'));
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

  it('persists renamed Codex titles in both the index and raw jsonl session file', async () => {
    const { projects, database } = await loadTestModules();
    const projectPath = path.join(tempRoot, 'medhelp', 'proj-rename');
    const projectName = '-Users-test-proj-rename';
    const sessionId = '019d6000-0000-7000-8000-000000000001';
    const renamedTitle = 'Renamed Codex Session';
    const codexDir = path.join(tempRoot, '.medhelpsec', 'codex_home', 'sessions', '2026', '03', '31');
    const sessionFile = path.join(codexDir, `rollout-2026-03-31T13-04-36-${sessionId}.jsonl`);

    await mkdir(projectPath, { recursive: true });
    await mkdir(codexDir, { recursive: true });

    await writeFile(sessionFile, [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-03-31T13:04:36.000Z',
        payload: {
          id: sessionId,
          cwd: projectPath,
          model: 'gpt-5.4',
        },
      }),
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-03-31T13:05:00.000Z',
        payload: {
          type: 'user_message',
          message: 'Original Codex prompt that would normally become the fallback title',
        },
      }),
      '',
    ].join('\n'));

    const user = database.userDb.createUser('tester', 'hash');
    database.projectDb.upsertProject(projectName, user.id, 'Rename Workspace', projectPath);
    database.sessionDb.upsertSessionFromSource(sessionId, projectName, 'codex', {
      displayName: 'Original Codex Session',
      lastActivity: '2026-03-31T13:05:00.000Z',
      messageCount: 1,
    });

    await expect(projects.renameSession(projectName, sessionId, renamedTitle, 'codex', user.id)).resolves.toBe(true);

    const indexedSession = database.sessionDb.getSessionById(sessionId);
    const rawFile = await readFile(sessionFile, 'utf8');
    const codexSessions = await projects.getCodexSessions(projectPath, { limit: 10, projectName });

    expect(indexedSession?.display_name).toBe(renamedTitle);
    expect(indexedSession?.metadata?.displayNameSource).toBe('manual');
    expect(rawFile).toContain(`"type":"summary"`);
    expect(rawFile).toContain(`"summary":"${renamedTitle}"`);
    expect(rawFile).toContain(`"source":"medhelp-user-rename"`);
    expect(codexSessions.find((session) => session.id === sessionId)?.summary).toBe(renamedTitle);
  });
});
