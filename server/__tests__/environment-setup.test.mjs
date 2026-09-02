import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildEnvironmentSetupRuntimeEnv,
  applyEnvironmentSetupRuntimeEnv,
  displayEnvironmentSetupPath,
  expandEnvironmentSetupPath,
  getEnvironmentSetupConfigPath,
  getEnvironmentSetupStatus,
  saveEnvironmentSetup,
  validateEnvironmentSetup,
} from '../utils/environmentSetup.js';

const temporaryRoots = [];

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-environment-setup-'));
  temporaryRoots.push(root);
  const homeDir = path.join(root, 'home');
  const dataDir = path.join(root, 'app-data');
  const workspaceRoot = path.join(homeDir, 'workspace');
  const dataPath = path.join(homeDir, 'datasets');
  const binDir = path.join(root, 'bin');
  await Promise.all([
    fs.mkdir(workspaceRoot, { recursive: true }),
    fs.mkdir(dataPath, { recursive: true }),
    fs.mkdir(binDir, { recursive: true }),
  ]);

  const pythonExecutable = path.join(binDir, 'python3');
  const rExecutable = path.join(binDir, 'R');
  await fs.writeFile(pythonExecutable, '#!/bin/sh\necho "Python 3.12.0"\n');
  await fs.writeFile(rExecutable, '#!/bin/sh\necho "R version 4.4.0"\n');
  await Promise.all([fs.chmod(pythonExecutable, 0o755), fs.chmod(rExecutable, 0o755)]);

  return {
    root,
    homeDir,
    dataDir,
    workspaceRoot,
    dataPath,
    pythonExecutable,
    rExecutable,
    env: { PATH: binDir },
  };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('environment setup', () => {
  it('expands and displays home-relative paths', async () => {
    const fixture = await makeFixture();
    expect(
      expandEnvironmentSetupPath('~/.cc-switch', fixture),
    ).toBe(path.join(fixture.homeDir, '.cc-switch'));
    expect(
      displayEnvironmentSetupPath(path.join(fixture.homeDir, '.codex'), fixture),
    ).toBe(`~${path.sep}.codex`);
  });

  it('persists a complete device-local setup and applies its runtime environment', async () => {
    const fixture = await makeFixture();
    const targetEnv = {
      PATH: fixture.env.PATH,
      HOME: fixture.homeDir,
      CLAUDE_CONFIG_DIR: path.join(fixture.homeDir, '.claude'),
      CODEX_HOME: path.join(fixture.homeDir, '.codex'),
    };
    const status = await saveEnvironmentSetup({
      ccSwitchDataDir: '~/.cc-switch',
      pythonExecutable: fixture.pythonExecutable,
      rExecutable: fixture.rExecutable,
      workspaceRoot: fixture.workspaceRoot,
      dataPath: fixture.dataPath,
    }, { ...fixture, targetEnv });

    expect(status.completed).toBe(true);
    expect(status.config.pythonExecutable).toBe(fixture.pythonExecutable);
    expect(targetEnv.MEDHELP_PYTHON_EXECUTABLE).toBe(fixture.pythonExecutable);
    expect(targetEnv.MEDHELP_R_EXECUTABLE).toBe(fixture.rExecutable);
    expect(targetEnv.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(targetEnv.CODEX_HOME).toBeUndefined();
    expect(status.config).not.toHaveProperty('claudeConfigDir');
    expect(status.config).not.toHaveProperty('codexConfigDir');

    const saved = JSON.parse(await fs.readFile(getEnvironmentSetupConfigPath(fixture), 'utf8'));
    expect(saved.completed).toBe(true);
    expect(saved.workspaceRoot).toBe(fixture.workspaceRoot);
    expect((await fs.stat(path.join(fixture.homeDir, '.cc-switch'))).isDirectory()).toBe(true);

    const reloaded = await getEnvironmentSetupStatus({ ...fixture, targetEnv: {} });
    expect(reloaded.completed).toBe(true);
  });

  it('rejects an invalid configured runtime while allowing an unconfigured runtime', async () => {
    const fixture = await makeFixture();
    const result = await validateEnvironmentSetup({
      ccSwitchDataDir: fixture.homeDir,
      pythonExecutable: path.join(fixture.root, 'missing-python'),
      rExecutable: '',
      workspaceRoot: fixture.workspaceRoot,
      dataPath: '',
    }, fixture);

    expect(result.valid).toBe(false);
    expect(result.errors.pythonExecutable).toMatch(/Python/);
    expect(result.errors.rExecutable).toBeUndefined();
  });

  it('builds runtime variables without discarding the existing PATH', async () => {
    const fixture = await makeFixture();
    const runtimeEnv = buildEnvironmentSetupRuntimeEnv({
      pythonExecutable: fixture.pythonExecutable,
      rExecutable: fixture.rExecutable,
    }, { PATH: '/system/bin', HOME: fixture.homeDir });

    expect(runtimeEnv.PATH.split(path.delimiter)).toContain('/system/bin');
    expect(runtimeEnv.PATH.split(path.delimiter)).toContain(path.dirname(fixture.pythonExecutable));
    expect(runtimeEnv.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(runtimeEnv.CODEX_HOME).toBeUndefined();
  });

  it('removes legacy provider-home overrides from the shared runtime environment', () => {
    const targetEnv = {
      PATH: '/system/bin',
      CLAUDE_CONFIG_DIR: '/tmp/legacy-claude-home',
      CODEX_HOME: '/tmp/legacy-codex-home',
    };

    applyEnvironmentSetupRuntimeEnv({}, targetEnv);

    expect(targetEnv.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(targetEnv.CODEX_HOME).toBeUndefined();
  });
});
