import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDatabasePath = process.env.DATABASE_PATH;
const originalDefaultConversationWorkspace = process.env.MEDHELP_DEFAULT_CONVERSATION_WORKSPACE;
const originalWorkspacesRoot = process.env.WORKSPACES_ROOT;

let tempRoot = null;
let database = null;

async function loadModules() {
  vi.resetModules();
  const projects = await import('../projects.js');
  database = await import('../database/db.js');
  await database.initializeDatabase();
  return { projects, database };
}

describe('default conversation workspace', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'medhelp-general-workspace-'));
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;
    process.env.DATABASE_PATH = path.join(tempRoot, 'db', 'auth.db');
    delete process.env.MEDHELP_DEFAULT_CONVERSATION_WORKSPACE;
    delete process.env.WORKSPACES_ROOT;
  });

  afterEach(async () => {
    if (database?.db?.open) {
      database.db.close();
    }
    database = null;
    vi.resetModules();

    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;

    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;

    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;

    if (originalDefaultConversationWorkspace === undefined) {
      delete process.env.MEDHELP_DEFAULT_CONVERSATION_WORKSPACE;
    } else {
      process.env.MEDHELP_DEFAULT_CONVERSATION_WORKSPACE = originalDefaultConversationWorkspace;
    }

    if (originalWorkspacesRoot === undefined) delete process.env.WORKSPACES_ROOT;
    else process.env.WORKSPACES_ROOT = originalWorkspacesRoot;

    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('uses the backend default root directly when no custom setting exists', async () => {
    const { projects } = await loadModules();

    const listedProjects = await projects.getProjects(null);
    const general = listedProjects.find((project) => project.isDefaultWorkspace);

    expect(general).toMatchObject({
      name: 'general-local',
      fullPath: path.join(tempRoot, 'Documents', 'MedHelpSec'),
      path: path.join(tempRoot, 'Documents', 'MedHelpSec'),
      pathExists: true,
    });
  });

  it('uses the configured local workspace root and follows later setting changes', async () => {
    const firstRoot = path.join(tempRoot, 'configured-workspace');
    const secondRoot = path.join(tempRoot, 'replacement-workspace');
    const environmentFallback = path.join(tempRoot, 'environment-fallback');
    await Promise.all([
      mkdir(firstRoot, { recursive: true }),
      mkdir(secondRoot, { recursive: true }),
      mkdir(environmentFallback, { recursive: true }),
    ]);
    process.env.MEDHELP_DEFAULT_CONVERSATION_WORKSPACE = environmentFallback;

    const { projects, database: db } = await loadModules();
    await projects.setWorkspaceRootInConfig(firstRoot);

    const initialProjects = await projects.getProjects(null);
    const initialGeneral = initialProjects.find((project) => project.isDefaultWorkspace);
    expect(initialGeneral).toMatchObject({
      name: 'general-local',
      fullPath: firstRoot,
      path: firstRoot,
      pathExists: true,
    });
    expect(db.projectDb.getProjectById('general-local')?.path).toBe(firstRoot);
    expect(await projects.extractProjectDirectory('general-local')).toBe(firstRoot);

    await projects.setWorkspaceRootInConfig(secondRoot);
    const refreshedProjects = await projects.getProjects(null);
    const refreshedGeneral = refreshedProjects.find((project) => project.isDefaultWorkspace);
    expect(refreshedGeneral).toMatchObject({
      name: 'general-local',
      fullPath: secondRoot,
      path: secondRoot,
      pathExists: true,
    });
    expect(db.projectDb.getProjectById('general-local')?.path).toBe(secondRoot);
    expect(await projects.extractProjectDirectory('general-local')).toBe(secondRoot);
  });

  it('uses an account workspace setting without adding a dated or user subfolder', async () => {
    const configuredRoot = path.join(tempRoot, 'account-workspace');
    await mkdir(configuredRoot, { recursive: true });
    const { projects, database: db } = await loadModules();
    const user = db.userDb.createUser('workspace-owner', 'hash');
    db.userDb.updateWorkspaceRoot(user.id, configuredRoot);

    const listedProjects = await projects.getProjects(user.id);
    const general = listedProjects.find((project) => project.isDefaultWorkspace);

    expect(general).toMatchObject({
      name: `general-${user.id}`,
      fullPath: configuredRoot,
      path: configuredRoot,
      pathExists: true,
    });
    expect(path.basename(general.fullPath)).toBe('account-workspace');
    expect(await projects.extractProjectDirectory(general.name)).toBe(configuredRoot);
  });

  it('creates each conversation in its own dated Codex-style folder without project memory', async () => {
    const configuredRoot = path.join(tempRoot, 'Codex');
    await mkdir(configuredRoot, { recursive: true });
    const { projects } = await loadModules();
    const now = new Date(2026, 8, 1, 21, 2, 2);

    const first = await projects.createConversationWorkspace(configuredRoot, null, { now });
    const second = await projects.createConversationWorkspace(configuredRoot, null, { now });

    expect(first).toMatchObject({
      fullPath: path.join(configuredRoot, '2026-09-01', 'conversation-21-02-02'),
      isConversationWorkspace: true,
    });
    expect(second.fullPath).toBe(
      path.join(configuredRoot, '2026-09-01', 'conversation-21-02-02-2'),
    );
    await projects.ensureProjectSkillLinks(first.fullPath);
    const listedProjects = await projects.getProjects(null);
    expect(listedProjects.find((project) => project.name === first.name)).toMatchObject({
      fullPath: first.fullPath,
      isConversationWorkspace: true,
    });
    expect((await readdir(first.fullPath)).sort()).toEqual(['outputs', 'work']);
  });

  it('removes only stale auto-generated conversation folders that have no session or user files', async () => {
    const configuredRoot = path.join(tempRoot, 'workspace');
    await mkdir(configuredRoot, { recursive: true });
    const { projects, database: db } = await loadModules();
    const createdAt = new Date(2026, 8, 1, 21, 2, 2);
    const cleanupAt = new Date(Date.now() + 60_000);

    const unused = await projects.createConversationWorkspace(configuredRoot, null, { now: createdAt });
    const withFile = await projects.createConversationWorkspace(configuredRoot, null, { now: createdAt });
    const withSession = await projects.createConversationWorkspace(configuredRoot, null, { now: createdAt });
    await writeFile(path.join(withFile.fullPath, 'work', 'notes.txt'), 'keep me', 'utf8');
    db.sessionDb.upsertSessionFromSource('session-1', withSession.name, 'pi', {
      ownerKey: 'local',
      runtimeId: 'pi',
      displayName: 'Saved conversation',
    });

    const removed = await projects.cleanupUnusedConversationWorkspaces(configuredRoot, null, {
      now: cleanupAt,
      staleMs: 0,
    });

    expect(removed).toEqual([unused.fullPath]);
    await expect(access(unused.fullPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(withFile.fullPath)).resolves.toBeUndefined();
    await expect(access(withSession.fullPath)).resolves.toBeUndefined();
    expect(db.projectDb.getProjectById(unused.name)).toBeFalsy();
  });
});
