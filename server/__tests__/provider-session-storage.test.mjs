import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
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

describe('provider session storage', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'medhelp-provider-session-'));
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

  it('reads OpenRouter session messages from the home-scoped MedHelp data directory', async () => {
    const { projects, database } = await loadTestModules();
    const projectPath = path.join(tempRoot, 'workspace-openrouter-history');
    const projectName = '-Users-test-workspace-openrouter-history';
    const sessionId = 'openrouter-project-local-history';
    const { getProviderSessionFilePath } = await import('../utils/storagePaths.js');
    const sessionFile = getProviderSessionFilePath(projectPath, 'openrouter-sessions', sessionId);

    await mkdir(path.dirname(sessionFile), { recursive: true });
    await writeFile(sessionFile, [
      JSON.stringify({ role: 'user', content: 'hello', ts: '2026-04-01T10:00:00.000Z' }),
      JSON.stringify({
        role: 'assistant',
        content: 'hi there',
        tool_calls: [{ id: 'tool-1', function: { name: 'Read', arguments: '{}' } }],
        ts: '2026-04-01T10:01:00.000Z',
      }),
      JSON.stringify({ role: 'tool', tool_call_id: 'tool-1', content: 'tool output', ts: '2026-04-01T10:01:30.000Z' }),
      '',
    ].join('\n'), 'utf8');

    database.projectDb.upsertProject(projectName, null, 'Workspace OpenRouter History', projectPath);
    database.sessionDb.upsertSessionPlaceholder(sessionId, projectName, 'openrouter', 'OpenRouter Session', null, {
      projectPath,
    });

    const messages = await projects.getSessionMessages(projectName, sessionId, null, 0, 'openrouter');

    expect(messages).toHaveLength(4);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'hello' });
    expect(messages[1]).toMatchObject({ role: 'assistant', content: 'hi there' });
    expect(messages[2]).toMatchObject({ type: 'tool_use', toolName: 'Read' });
    expect(messages[3]).toMatchObject({ role: 'tool', output: 'tool output' });
  });

  it('migrates legacy project-local OpenRouter session files into ~/.medhelpsec on write-path access', async () => {
    const { projects, database } = await loadTestModules();
    const projectPath = path.join(tempRoot, 'workspace-openrouter-legacy');
    const projectName = '-Users-test-workspace-openrouter-legacy';
    const sessionId = 'openrouter-legacy-history';
    const legacySessionFile = path.join(projectPath, '.med-help', 'openrouter-sessions', `${sessionId}.jsonl`);
    const { ensureProjectProviderSessionFile, getProviderSessionFilePath } = await import('../utils/storagePaths.js');
    const migratedSessionFile = getProviderSessionFilePath(projectPath, 'openrouter-sessions', sessionId);

    await mkdir(path.dirname(legacySessionFile), { recursive: true });
    await writeFile(legacySessionFile, [
      JSON.stringify({ role: 'user', content: 'legacy hello', ts: '2026-04-01T10:00:00.000Z' }),
      JSON.stringify({ role: 'assistant', content: 'legacy hi', ts: '2026-04-01T10:01:00.000Z' }),
      '',
    ].join('\n'), 'utf8');

    database.projectDb.upsertProject(projectName, null, 'Workspace OpenRouter Legacy', projectPath);
    database.sessionDb.upsertSessionPlaceholder(sessionId, projectName, 'openrouter', 'OpenRouter Legacy Session', null, {
      projectPath,
    });

    const messages = await projects.getSessionMessages(projectName, sessionId, null, 0, 'openrouter');
    const ensuredPath = await ensureProjectProviderSessionFile({
      projectPath,
      providerDirName: 'openrouter-sessions',
      sessionId,
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'legacy hello' });
    expect(ensuredPath).toBe(migratedSessionFile);
    await expect(access(migratedSessionFile)).resolves.toBeUndefined();
    expect(await readFile(migratedSessionFile, 'utf8')).toContain('legacy hello');
  });
});
