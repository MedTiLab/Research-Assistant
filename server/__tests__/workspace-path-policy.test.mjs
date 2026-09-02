import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDatabasePath = process.env.DATABASE_PATH;
const originalWorkspacesRoot = process.env.WORKSPACES_ROOT;
const originalMedhelpDataDir = process.env.MEDHELP_DATA_DIR;

let tempRoot = null;
let database = null;

async function loadWorkspaceModules() {
  vi.resetModules();
  database = await import('../database/db.js');
  await database.initializeDatabase();
  const projectsRoutes = await import('../routes/projects.js');
  const projectsModule = await import('../projects.js');
  return { database, projectsRoutes, projectsModule };
}

describe('workspace path policy', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'medhelp-workspace-policy-'));
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;
    process.env.DATABASE_PATH = path.join(tempRoot, '.medhelp', 'auth.db');
    delete process.env.WORKSPACES_ROOT;
    delete process.env.MEDHELP_DATA_DIR;
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

    if (originalWorkspacesRoot === undefined) delete process.env.WORKSPACES_ROOT;
    else process.env.WORKSPACES_ROOT = originalWorkspacesRoot;

    if (originalMedhelpDataDir === undefined) delete process.env.MEDHELP_DATA_DIR;
    else process.env.MEDHELP_DATA_DIR = originalMedhelpDataDir;

    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('defaults customer workspaces to Documents/MedHelpSec without a user subfolder', async () => {
    const { database: db, projectsRoutes } = await loadWorkspaceModules();
    const user = db.userDb.createUser('customer', 'hash');

    const defaultRoot = await projectsRoutes.getDefaultUserWorkspaceRoot(user.id);

    expect(defaultRoot).toBe(path.join(tempRoot, 'Documents', 'MedHelpSec'));
    expect(defaultRoot).not.toContain(`${path.sep}u-`);
  });

  it('allows a customer project anywhere safe under the local home directory', async () => {
    const { database: db, projectsRoutes } = await loadWorkspaceModules();
    const user = db.userDb.createUser('customer', 'hash');
    const configuredRoot = path.join(tempRoot, 'medhelp_workspace', 'custom-root');
    const chosenProject = path.join(tempRoot, 'Desktop', 'customer-project');
    await mkdir(configuredRoot, { recursive: true });
    await mkdir(chosenProject, { recursive: true });
    db.userDb.updateWorkspaceRoot(user.id, configuredRoot);
    const realChosenProject = await realpath(chosenProject);

    const validation = await projectsRoutes.validateUserWorkspacePath(chosenProject, user.id);
    const outsideValidation = await projectsRoutes.validateUserWorkspacePath(path.join(path.dirname(tempRoot), 'outside-project'), user.id);

    expect(validation.valid).toBe(true);
    expect(validation.resolvedPath).toBe(realChosenProject);
    expect(validation.userRoot).toBe(configuredRoot);
    expect(outsideValidation.valid).toBe(false);
  });

  it('rejects a client Windows drive path before resolving it under the hosted working directory', async () => {
    const { projectsRoutes } = await loadWorkspaceModules();

    const validation = await projectsRoutes.validateWorkspacePath('D:\\课题\\公共\\气候');

    expect(validation).toEqual({
      valid: false,
      error: 'Client-local Windows paths cannot be used as hosted server workspaces',
    });
  });

  it('allows workspace-external data folders only after they are allowlisted', async () => {
    const { database: db, projectsRoutes, projectsModule } = await loadWorkspaceModules();
    const user = db.userDb.createUser('customer', 'hash');
    const outsideDataRoot = await mkdtemp(path.join(path.dirname(tempRoot), 'outside-data-'));

    try {
      const beforeAllowlist = await projectsRoutes.validateUserWorkspacePath(outsideDataRoot, user.id);
      expect(beforeAllowlist.valid).toBe(false);

      await projectsModule.setAllowedDataFoldersInConfig([outsideDataRoot]);
      const afterAllowlist = await projectsRoutes.validateUserWorkspacePath(outsideDataRoot, user.id, {
        allowConfiguredDataFolders: true,
      });

      expect(afterAllowlist.valid).toBe(true);
      expect(afterAllowlist.resolvedPath).toBe(await realpath(outsideDataRoot));
    } finally {
      await rm(outsideDataRoot, { recursive: true, force: true });
    }
  });

  it('keeps manually added local project records when this server cannot access the path', async () => {
    const { database: db, projectsModule } = await loadWorkspaceModules();
    const user = db.userDb.createUser('customer', 'hash');
    const missingLocalProjectPath = path.join(tempRoot, 'Desktop', 'customer-project');
    const projectId = 'missing-local-project';

    db.projectDb.upsertProject(
      projectId,
      user.id,
      'Missing local project',
      missingLocalProjectPath,
      0,
      new Date().toISOString(),
      { manuallyAdded: true },
    );

    const projects = await projectsModule.getProjects(user.id);
    const project = projects.find((entry) => entry.name === projectId);

    expect(project).toBeTruthy();
    expect(project.fullPath).toBe(missingLocalProjectPath);
    expect(project.pathExists).toBe(false);
    expect(project.isLocalPathUnavailable).toBe(true);
    expect(db.projectDb.getProjectById(projectId)?.metadata?.trash).toBeUndefined();
  });

  it('adds the visible work-output folder when an existing project is loaded', async () => {
    const { database: db, projectsModule } = await loadWorkspaceModules();
    const user = db.userDb.createUser('customer', 'hash');
    const existingProjectPath = path.join(tempRoot, 'existing-project');
    const projectId = 'existing-project';
    await mkdir(existingProjectPath, { recursive: true });

    db.projectDb.upsertProject(
      projectId,
      user.id,
      'Existing project',
      existingProjectPath,
      0,
      new Date().toISOString(),
      { manuallyAdded: true },
    );

    const projects = await projectsModule.getProjects(user.id);

    expect(projects.some((entry) => entry.name === projectId)).toBe(true);
    await expect(access(path.join(existingProjectPath, 'work-output'))).resolves.toBeUndefined();
  });

  it('repairs initialization when an already registered project is added again', async () => {
    const { database: db, projectsModule } = await loadWorkspaceModules();
    const user = db.userDb.createUser('customer', 'hash');
    const existingProjectPath = path.join(tempRoot, 'legacy-project');
    const projectId = 'legacy-project';
    await mkdir(path.join(existingProjectPath, '.medhelp'), { recursive: true });
    await writeFile(
      path.join(existingProjectPath, '.medhelp', 'MEMORY.md'),
      '# Project Memory\n\n- Preserve this context.\n',
      'utf8',
    );

    db.projectDb.upsertProject(
      projectId,
      user.id,
      'Legacy project',
      existingProjectPath,
      0,
      new Date().toISOString(),
      { manuallyAdded: true },
    );

    await projectsModule.addProjectManually(existingProjectPath, 'Legacy project', user.id);

    await expect(access(path.join(existingProjectPath, 'work-output'))).resolves.toBeUndefined();
    expect(await readFile(path.join(existingProjectPath, '.medhelpsec', 'MEMORY.md'), 'utf8'))
      .toBe('# Project Memory\n\n- Preserve this context.\n');
    await expect(access(path.join(existingProjectPath, '.medhelp'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps a linked folder unchanged on add, refresh, and runtime setup', async () => {
    const { database: db, projectsModule } = await loadWorkspaceModules();
    const user = db.userDb.createUser('linked-folder-owner', 'hash');
    const linkedFolderPath = path.join(tempRoot, 'linked-folder');
    await mkdir(linkedFolderPath, { recursive: true });
    await writeFile(path.join(linkedFolderPath, 'original.txt'), 'keep this folder unchanged', 'utf8');

    await projectsModule.addProjectManually(linkedFolderPath, 'Linked folder', user.id, {
      initializeWorkspace: false,
      metadata: { preserveFolderContents: true },
    });
    expect(await readdir(linkedFolderPath)).toEqual(['original.txt']);

    await projectsModule.getProjects(user.id);
    expect(await readdir(linkedFolderPath)).toEqual(['original.txt']);

    // Runtime identity can differ from the device-local project owner; the
    // preservation marker must still be resolved by the unique folder path.
    await projectsModule.ensureProjectSkillLinks(linkedFolderPath, { userId: user.id + 100 });
    expect(await readdir(linkedFolderPath)).toEqual(['original.txt']);
    await expect(access(path.join(linkedFolderPath, 'work-output'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(path.join(linkedFolderPath, '.medhelpsec'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
