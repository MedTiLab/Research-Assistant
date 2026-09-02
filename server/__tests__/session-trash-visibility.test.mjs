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

describe('trashed sessions stay out of active project lists', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'medhelp-session-trash-'));
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

  it.each([false, true])('re-adding a hidden existing folder clears suppression (index removed: %s)', async (removeIndex) => {
    const { projects, database } = await loadTestModules();
    const projectPath = path.join(tempRoot, 'external', 'IBD2');
    await mkdir(projectPath, { recursive: true });
    await writeFile(path.join(projectPath, 'research.txt'), 'keep original research');
    const projectName = projects.encodeProjectPath(projectPath);
    const user = database.userDb.createUser('import-owner', 'hash');
    if (!removeIndex) {
      database.projectDb.upsertProject(projectName, user.id, 'Original', projectPath, 1, null, {
        trash: { trashedAt: '2026-08-27T00:00:00Z' }, custom: 'keep',
      });
      database.sessionDb.upsertSessionFromSource('old-session', projectName, 'claude', { displayName: 'Old history', messageCount: 2 });
    }
    const configFile = path.join(tempRoot, '.medhelpsec', 'project-config.json');
    await mkdir(path.dirname(configFile), { recursive: true });
    await writeFile(configFile, JSON.stringify({
      _workspacesRoot: path.join(tempRoot, 'different-root'),
      _deletedProjects: { [projectName]: { deletedAt: '2026-08-27T00:00:00Z' }, 'keep-hidden': { deletedAt: '2026-08-27T00:00:00Z' } },
      [projectName]: { deleted: { deletedAt: '2026-08-27T00:00:00Z' }, trash: { trashedAt: '2026-08-27T00:00:00Z' }, ownerUserId: user.id },
    }));
    const imported = await projects.addProjectManually(projectPath, 'Imported', null);
    expect(imported.name).toBe(projectName);
    const listed = await projects.getProjects(null, null, { sessionOwnerKey: '7001' });
    expect(listed.filter((p) => p.name === projectName)).toHaveLength(1);
    expect(listed.find((p) => p.name === projectName).displayName).toBe('Imported');
    expect(await readFile(path.join(projectPath, 'research.txt'), 'utf8')).toBe('keep original research');
    expect((await projects.getTrashedProjects()).some((p) => p.name === projectName)).toBe(false);
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    expect(config._deletedProjects?.[projectName]).toBeUndefined();
    expect(config._deletedProjects['keep-hidden']).toBeTruthy();
    if (!removeIndex) {
      expect(database.sessionDb.getSessionsByProject(projectName).map((s) => s.id)).toEqual(['old-session']);
      expect(database.projectDb.getProjectById(projectName)).toMatchObject({ user_id: user.id, is_starred: 1, metadata: { custom: 'keep', manuallyAdded: true } });
    }
  });

  it('excludes trashed Codex sessions from getProjects while keeping them in trash', async () => {
    const { projects, database } = await loadTestModules();
    const projectPath = path.join(tempRoot, 'medhelp_workspace', 'workspace');
    const projectName = '-Users-test-workspace';
    const activeSessionId = '019d5000-0000-7000-8000-000000000010';
    const trashedSessionId = '019d5000-0000-7000-8000-000000000011';

    await mkdir(projectPath, { recursive: true });

    const user = database.userDb.createUser('tester', 'hash');

    database.projectDb.upsertProject(projectName, user.id, 'Workspace', projectPath);
    database.sessionDb.upsertSessionFromSource(activeSessionId, projectName, 'codex', {
      displayName: 'Active Codex Session',
      lastActivity: '2026-03-31T10:00:00.000Z',
      messageCount: 4,
    });
    database.sessionDb.upsertSessionFromSource(trashedSessionId, projectName, 'codex', {
      displayName: 'Deleted Codex Session',
      lastActivity: '2026-03-31T09:00:00.000Z',
      messageCount: 2,
    });
    database.sessionDb.setSessionTrash(trashedSessionId, {
      trashedAt: '2026-03-31T10:30:00.000Z',
      projectName,
      provider: 'codex',
    });

    const activeProjects = await projects.getProjects(user.id);
    const workspace = activeProjects.find((entry) => entry.name === projectName);
    const trashedSessions = await projects.getTrashedSessions(user.id);

    expect(workspace).toBeTruthy();
    expect((workspace?.codexSessions || []).map((session) => session.id)).toEqual([activeSessionId]);
    expect(trashedSessions.map((session) => session.id)).toContain(trashedSessionId);
  });

  it('clears trash-only project metadata when restoring a project', async () => {
    const { projects, database } = await loadTestModules();
    const projectPath = path.join(tempRoot, 'medhelp_workspace', 'publication-paper');
    const projectName = '-Users-test-publication-paper';
    const trashedAt = '2026-03-31T10:30:00.000Z';

    await mkdir(projectPath, { recursive: true });

    const user = database.userDb.createUser('restore-tester', 'hash');
    const trashMetadata = {
      trashedAt,
      originalPath: projectPath,
      trashPath: '',
      claudeTrashPath: '',
      sessionCount: 0,
      displayName: 'publication-paper',
      filesExist: true,
      ownerUserId: user.id,
      instanceId: null,
    };

    database.projectDb.upsertProject(projectName, user.id, 'publication-paper', projectPath, 0, null, {
      trash: trashMetadata,
    });

    const claudeDir = path.join(tempRoot, '.claude');
    const medHelpConfigPath = path.join(tempRoot, '.medhelpsec', 'project-config.json');
    await mkdir(claudeDir, { recursive: true });
    await writeFile(
      path.join(claudeDir, 'project-config.json'),
      JSON.stringify({
        [projectName]: {
          originalPath: projectPath,
          ownerUserId: user.id,
          trash: trashMetadata,
        },
        _deletedProjects: {
          [projectName]: {
            deletedAt: trashedAt,
            ownerUserId: user.id,
            originalPath: projectPath,
            displayName: 'publication-paper',
          },
        },
      }, null, 2),
      'utf8',
    );

    await projects.restoreProject(projectName, user.id);

    const restoredProject = database.projectDb.getProjectById(projectName);
    expect(restoredProject?.metadata).toBeNull();

    const config = JSON.parse(await readFile(medHelpConfigPath, 'utf8'));
    expect(config[projectName]?.trash).toBeUndefined();
    expect(config._deletedProjects?.[projectName]).toBeUndefined();

    const activeProjects = await projects.getProjects(user.id);
    expect(activeProjects.some((entry) => entry.name === projectName)).toBe(true);
  });

  it('lists only the paired account Pi index without deleting legacy or other account records', async () => {
    const { projects, database } = await loadTestModules();
    const projectPath = path.join(tempRoot, 'medhelp_workspace', 'pi-workspace');
    const projectName = '-Users-test-pi-workspace';
    await mkdir(projectPath, { recursive: true });
    const user = database.userDb.createUser('pi-tester', 'hash');
    database.projectDb.upsertProject(projectName, user.id, 'Pi workspace', projectPath);
    for (const ownerKey of [String(user.id), 'cloud-4', 'local']) {
      database.sessionDb.upsertSessionFromSource('same-pi-session', projectName, 'pi', {
        ownerKey, displayName: 'Hello', messageCount: 19, lastActivity: '2026-08-27T17:51:19.182Z',
      });
    }
    const visible = await projects.getProjects(null, null, { sessionOwnerKey: 'cloud-4' });
    const workspace = visible.find((entry) => entry.name === projectName);
    expect(workspace.piSessions).toHaveLength(1);
    expect(workspace.piSessions[0]).toMatchObject({ id: 'same-pi-session', ownerKey: 'cloud-4' });
    expect(workspace.runtimeSessions.filter((session) => session.__provider === 'pi')).toHaveLength(1);
    expect(database.sessionDb.getSessionsByProject(projectName)).toHaveLength(3);
  });
});
