import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildLegacyRuntimeEnv,
  createSupervisedLegacyRuntime,
  discoverLegacyRuntime,
  probeLegacyRuntime,
  resolveLegacyRuntimeMode,
} from './legacyRuntime.mjs';

const temporaryDirectories = [];

function createTemporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'medhelp-legacy-runtime-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Legacy Desktop Runtime boundary', () => {
  it('uses the stable supervised boundary by default and keeps embedded as an explicit rollback', () => {
    expect(resolveLegacyRuntimeMode({})).toBe('supervised');
    expect(resolveLegacyRuntimeMode({ MEDHELP_DESKTOP_RUNTIME_MODE: 'supervised' })).toBe('supervised');
    expect(resolveLegacyRuntimeMode({ MEDHELP_DESKTOP_RUNTIME_MODE: 'embedded' })).toBe('embedded');
    expect(resolveLegacyRuntimeMode({ MEDHELP_DESKTOP_RUNTIME_MODE: 'unknown' })).toBe('supervised');
  });

  it('passes only system and Runtime configuration into the child', () => {
    const env = buildLegacyRuntimeEnv({
      PATH: '/runtime/bin',
      HOME: '/users/researcher',
      OPENAI_API_KEY: 'openai-secret',
      JWT_SECRET: 'jwt-secret',
      TENCENT_COS_REGION: 'ap-shanghai',
      MEDHELP_DATA_DIR: '/data/medhelp',
      ELECTRON_INTERNAL_BROWSER_WINDOW: 'must-not-leak',
      UNRELATED_SECRET: 'must-not-leak',
    }, {
      MEDHELP_RUNTIME_FILE: '/data/medhelp/runtime/ports.json',
    });

    expect(env).toMatchObject({
      PATH: '/runtime/bin',
      HOME: '/users/researcher',
      OPENAI_API_KEY: 'openai-secret',
      JWT_SECRET: 'jwt-secret',
      TENCENT_COS_REGION: 'ap-shanghai',
      MEDHELP_DATA_DIR: '/data/medhelp',
      MEDHELP_DESKTOP: '1',
      ELECTRON_RUN_AS_NODE: '1',
    });
    expect(env).not.toHaveProperty('ELECTRON_INTERNAL_BROWSER_WINDOW');
    expect(env).not.toHaveProperty('UNRELATED_SECRET');
  });

  it('reuses a healthy process recorded in the private Runtime file', async () => {
    const directory = createTemporaryDirectory();
    const runtimeFile = path.join(directory, 'ports.json');
    fs.writeFileSync(runtimeFile, JSON.stringify({ backend: { pid: 812, port: 3312 } }));
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ status: 'ok' }),
    }));

    await expect(discoverLegacyRuntime({
      runtimeFile,
      fetchImpl,
      kill: vi.fn(),
    })).resolves.toMatchObject({
      pid: 812,
      baseUrl: 'http://127.0.0.1:3312',
      reused: true,
    });
  });

  it('removes dead records and classifies live but unhealthy records as stale', async () => {
    const directory = createTemporaryDirectory();
    const deadFile = path.join(directory, 'dead.json');
    fs.writeFileSync(deadFile, JSON.stringify({ backend: { pid: 901, port: 3901 } }));
    const deadProcess = vi.fn(() => {
      const error = new Error('not found');
      error.code = 'ESRCH';
      throw error;
    });
    await expect(discoverLegacyRuntime({ runtimeFile: deadFile, kill: deadProcess })).resolves.toBeNull();
    expect(fs.existsSync(deadFile)).toBe(false);

    const staleFile = path.join(directory, 'stale.json');
    fs.writeFileSync(staleFile, JSON.stringify({ backend: { pid: 902, port: 3902 } }));
    await expect(discoverLegacyRuntime({
      runtimeFile: staleFile,
      kill: vi.fn(),
      fetchImpl: vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    })).rejects.toMatchObject({ code: 'RUNTIME_STALE' });
  });

  it('reports a missing packaged Runtime entry before spawning', async () => {
    const directory = createTemporaryDirectory();
    const runtime = createSupervisedLegacyRuntime({
      projectRoot: directory,
      runtimeFile: path.join(directory, 'runtime', 'ports.json'),
      logPath: path.join(directory, 'logs', 'runtime.log'),
      kernelEntry: path.join(directory, 'missing-entry.mjs'),
      spawnImpl: vi.fn(),
    });

    await expect(runtime.start()).rejects.toMatchObject({ code: 'RUNTIME_MISSING' });
  });

  it('reports active work and database recovery through the shared health probe', async () => {
    await expect(probeLegacyRuntime('http://127.0.0.1:3903', {
      fetchImpl: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'ok',
          agentBusy: true,
          database: { recoveredFromCorruption: true },
        }),
      })),
    })).resolves.toMatchObject({
      healthy: true,
      agentBusy: true,
      degradedReason: 'database_recovered',
    });
  });

  it('reclaims a live recorded process even when the child handle was lost', async () => {
    const directory = createTemporaryDirectory();
    const runtimeFile = path.join(directory, 'ports.json');
    fs.writeFileSync(runtimeFile, JSON.stringify({ backend: { pid: 904, port: 3904 } }));
    let processAlive = true;
    const kill = vi.fn((_pid, signal) => {
      if (!processAlive) {
        const error = new Error('gone');
        error.code = 'ESRCH';
        throw error;
      }
      if (signal === 'SIGTERM' || signal === 'SIGKILL') processAlive = false;
    });
    const runtime = createSupervisedLegacyRuntime({
      projectRoot: directory,
      runtimeFile,
      logPath: path.join(directory, 'runtime.log'),
      kernelEntry: new URL('./kernel-entry.mjs', import.meta.url).pathname,
      kill,
    });

    await runtime.stop(null);

    expect(kill).toHaveBeenCalledWith(904, 'SIGTERM');
    expect(fs.existsSync(runtimeFile)).toBe(false);
  });
});
