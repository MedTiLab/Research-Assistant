import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDataDir = process.env.MEDHELP_DATA_DIR;
const originalLegacyDataDir = process.env.DR_CLAW_DATA_DIR;

let tempRoot = null;

async function loadStoragePaths() {
  vi.resetModules();
  return import('../utils/storagePaths.js');
}

describe('storage path defaults', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'medhelp-storage-paths-'));
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;
    delete process.env.MEDHELP_DATA_DIR;
    delete process.env.DR_CLAW_DATA_DIR;
  });

  afterEach(async () => {
    vi.resetModules();

    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;

    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;

    if (originalDataDir === undefined) delete process.env.MEDHELP_DATA_DIR;
    else process.env.MEDHELP_DATA_DIR = originalDataDir;

    if (originalLegacyDataDir === undefined) delete process.env.DR_CLAW_DATA_DIR;
    else process.env.DR_CLAW_DATA_DIR = originalLegacyDataDir;

    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('defaults the app data root to ~/.medhelpsec', async () => {
    const {
      resolveAppDataRoot,
      resolveAppDatabasePath,
      resolveDesktopLogFallbackPath,
      resolveAppRuntimeDir,
      resolveMedLibraryArchiveDir,
      resolveProjectChatAttachmentsDir,
      resolveProjectConfigPath,
    } = await loadStoragePaths();
    const projectChatAttachmentsDir = resolveProjectChatAttachmentsDir(path.join(tempRoot, 'workspace-demo'));

    expect(resolveAppDataRoot()).toBe(path.join(tempRoot, '.medhelpsec'));
    expect(resolveAppDatabasePath()).toBe(path.join(tempRoot, '.medhelpsec', 'auth.db'));
    expect(resolveProjectConfigPath()).toBe(path.join(tempRoot, '.medhelpsec', 'project-config.json'));
    expect(resolveDesktopLogFallbackPath()).toBe(path.join(tempRoot, '.medhelpsec', 'desktop', 'desktop.log'));
    expect(resolveAppRuntimeDir()).toBe(path.join(tempRoot, '.medhelpsec', 'runtime'));
    expect(resolveMedLibraryArchiveDir()).toBe(path.join(tempRoot, '.medhelpsec', 'med-library', 'report-preview-archive'));
    expect(projectChatAttachmentsDir).toContain(path.join('.medhelpsec', 'projects'));
    expect(projectChatAttachmentsDir).not.toContain(path.join('workspace-demo', '.med-help'));
  });

  it('keeps project-scoped provider state under ~/.medhelpsec/projects', async () => {
    const { getProjectDataRoot, getProviderSessionFilePath } = await loadStoragePaths();
    const projectPath = path.join(tempRoot, 'workspace-demo');
    const sessionFile = getProviderSessionFilePath(projectPath, 'openrouter-sessions', 'session-1');

    expect(getProjectDataRoot(projectPath)).toMatch(new RegExp(`^${path.join(tempRoot, '.medhelpsec', 'projects').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    expect(sessionFile).toContain(path.join('.medhelpsec', 'projects'));
    expect(sessionFile).not.toContain(path.join('workspace-demo', '.med-help'));
  });

  it('uses hashed owner/project/session segments for runtime session storage', async () => {
    const { getRuntimeSessionFilePath } = await loadStoragePaths();
    const sessionFile = getRuntimeSessionFilePath({
      ownerKey: 'private-user@example.com',
      projectKey: '/Users/private/oncology-study',
      runtimeId: 'pi',
      sessionId: 'external-session-id',
    });

    expect(sessionFile).toContain(path.join('.medhelpsec', 'runtime-sessions', 'pi'));
    expect(sessionFile).not.toContain('private-user@example.com');
    expect(sessionFile).not.toContain('oncology-study');
    expect(sessionFile).not.toContain('external-session-id');
    expect(() => getRuntimeSessionFilePath({
      ownerKey: 'owner',
      projectKey: 'project',
      runtimeId: '../pi',
      sessionId: 'session',
    })).toThrow('safe runtime id');
  });

  it('includes the legacy repo-local .med-help directory in database migration candidates', async () => {
    const { resolveLegacyDatabasePaths } = await loadStoragePaths();
    const projectPath = path.join(tempRoot, 'workspace-demo');
    const legacyCandidates = resolveLegacyDatabasePaths(tempRoot, projectPath);

    expect(legacyCandidates).toContain(path.join(projectPath, '.med-help', 'auth.db'));
    expect(legacyCandidates).toContain(path.join(tempRoot, '.medhelp', 'auth.db'));
  });
});
