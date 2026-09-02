import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  buildMedHelpCodexEnvironment,
  ensureMedHelpCodexSessionAvailable,
  prepareMedHelpCodexHome,
} from '../utils/codexHome.js';
import { resolveMedHelpCodexHome } from '../utils/storagePaths.js';

const temporaryRoots = [];

async function makeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'medhelp-codex-home-'));
  temporaryRoots.push(root);
  return {
    root,
    homeDir: path.join(root, 'home'),
    dataDir: path.join(root, 'app-data'),
  };
}

async function writeSession(filePath, { id, cwd, originator, message = null }) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, [
    JSON.stringify({
      type: 'session_meta',
      timestamp: '2026-08-23T00:00:00.000Z',
      payload: { id, cwd, originator, source: 'exec', timestamp: '2026-08-23T00:00:00.000Z' },
    }),
    ...(message ? [JSON.stringify({
      type: 'event_msg',
      timestamp: '2026-08-23T00:00:01.000Z',
      payload: { type: 'user_message', message },
    })] : []),
    '',
  ].join('\n'), 'utf8');
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('MedHelp Codex home', () => {
  it('uses a dedicated codex_home directory under the MedHelp data root', async () => {
    const fixture = await makeFixture();
    expect(resolveMedHelpCodexHome(fixture)).toBe(path.join(fixture.dataDir, 'codex_home'));
  });

  it('inherits local auth and API config while preserving the caller environment', async () => {
    const fixture = await makeFixture();
    const systemCodexHome = path.join(fixture.homeDir, '.codex');
    await mkdir(systemCodexHome, { recursive: true });
    await writeFile(path.join(systemCodexHome, 'auth.json'), '{"OPENAI_API_KEY":"local-key"}\n', 'utf8');
    await writeFile(path.join(systemCodexHome, 'config.toml'), 'model_provider = "local"\n', 'utf8');

    const environment = await buildMedHelpCodexEnvironment({
      OPENAI_API_KEY: 'environment-key',
      OPENAI_BASE_URL: 'https://example.test/v1',
    }, fixture);
    const codexHome = path.join(fixture.dataDir, 'codex_home');

    expect(environment).toMatchObject({
      CODEX_HOME: codexHome,
      OPENAI_API_KEY: 'environment-key',
      OPENAI_BASE_URL: 'https://example.test/v1',
    });
    await expect(readFile(path.join(codexHome, 'auth.json'), 'utf8'))
      .resolves.toContain('local-key');
    await expect(readFile(path.join(codexHome, 'config.toml'), 'utf8'))
      .resolves.toContain('model_provider = "local"');
  });

  it('copies only legacy MedHelp sessions and leaves the system Codex home untouched', async () => {
    const fixture = await makeFixture();
    const projectPath = path.join(fixture.homeDir, 'workspace');
    const legacySessionsDir = path.join(fixture.homeDir, '.codex', 'sessions', '2026', '08', '23');
    const medhelpSession = path.join(legacySessionsDir, 'rollout-medhelp.jsonl');
    const sdkSession = path.join(legacySessionsDir, 'rollout-sdk.jsonl');
    const desktopSession = path.join(legacySessionsDir, 'rollout-desktop.jsonl');

    await writeSession(medhelpSession, { id: 'medhelp-session', cwd: projectPath, originator: 'medhelp' });
    await writeSession(sdkSession, { id: 'sdk-session', cwd: projectPath, originator: 'codex_sdk_ts' });
    await writeSession(desktopSession, { id: 'desktop-session', cwd: projectPath, originator: 'Codex Desktop' });

    const result = await prepareMedHelpCodexHome(fixture);
    const migratedSessionsDir = path.join(result.codexHome, 'sessions', '2026', '08', '23');

    expect(result.migration.migrated).toBe(2);
    await expect(stat(path.join(migratedSessionsDir, 'rollout-medhelp.jsonl'))).resolves.toBeTruthy();
    await expect(stat(path.join(migratedSessionsDir, 'rollout-sdk.jsonl'))).resolves.toBeTruthy();
    await expect(stat(path.join(migratedSessionsDir, 'rollout-desktop.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(medhelpSession)).resolves.toBeTruthy();
    await expect(stat(sdkSession)).resolves.toBeTruthy();
    await expect(stat(desktopSession)).resolves.toBeTruthy();
  });

  it('recognizes MedHelp prompt scaffolding when Codex mislabeled the originator as Desktop', async () => {
    const fixture = await makeFixture();
    const legacySession = path.join(
      fixture.homeDir,
      '.codex',
      'sessions',
      '2026',
      '08',
      '23',
      'rollout-mislabeled-medhelp.jsonl',
    );
    await writeSession(legacySession, {
      id: 'mislabeled-medhelp',
      cwd: path.join(fixture.homeDir, 'workspace'),
      originator: 'Codex Desktop',
      message: '# MedHelp Skills (available outside the project workspace)\n\nUser request:\nContinue',
    });

    const result = await prepareMedHelpCodexHome(fixture);
    expect(result.migration.migrated).toBe(1);
    await expect(stat(path.join(
      result.codexHome,
      'sessions',
      '2026',
      '08',
      '23',
      'rollout-mislabeled-medhelp.jsonl',
    ))).resolves.toBeTruthy();
  });

  it('promotes an archived legacy MedHelp rollout before attempting thread resume', async () => {
    const fixture = await makeFixture();
    const sessionId = 'archived-medhelp-session';
    const archivedSession = path.join(
      fixture.homeDir,
      '.codex',
      'archived_sessions',
      `rollout-2026-08-23T00-00-00-${sessionId}.jsonl`,
    );
    await writeSession(archivedSession, {
      id: sessionId,
      cwd: path.join(fixture.homeDir, 'workspace'),
      originator: 'Codex Desktop',
      message: '# MedHelp Skills (available outside the project workspace)',
    });

    const result = await ensureMedHelpCodexSessionAvailable(sessionId, fixture);

    expect(result).toMatchObject({ available: true, archived: true, migrated: false });
    expect(result.filePath).toContain(`${path.sep}codex_home${path.sep}archived_sessions${path.sep}`);
    await expect(stat(result.filePath)).resolves.toBeTruthy();
    await expect(stat(archivedSession)).resolves.toBeTruthy();
  });
});
