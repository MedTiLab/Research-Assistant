import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  discoverBundledKernel,
  isLoopbackRuntimeUrl,
  probeBundledKernel,
} from './kernelLifecycle.mjs';

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function runtimeFile(payload) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'medhelp-kernel-lifecycle-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'runtime.json');
  fs.writeFileSync(filePath, JSON.stringify(payload));
  return filePath;
}

describe('bundled Kernel lifecycle ownership', () => {
  it('accepts loopback HTTP endpoints only', () => {
    expect(isLoopbackRuntimeUrl('http://127.0.0.1:5055')).toBe(true);
    expect(isLoopbackRuntimeUrl('http://[::1]:5055')).toBe(true);
    expect(isLoopbackRuntimeUrl('https://127.0.0.1:5055')).toBe(false);
    expect(isLoopbackRuntimeUrl('http://example.com:5055')).toBe(false);
  });

  it('adopts a healthy recorded Kernel with the expected version', async () => {
    const filePath = runtimeFile({
      product: 'MedHelp Kernel',
      pid: 801,
      httpUrl: 'http://127.0.0.1:5055',
      controlToken: 'private-token',
    });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', version: '1.1.19', instanceId: 'old-launch' }),
    }));

    await expect(discoverBundledKernel({
      runtimeFile: filePath,
      expectedVersion: '1.1.19',
      fetchImpl,
      kill: vi.fn(),
    })).resolves.toMatchObject({
      pid: 801,
      httpUrl: 'http://127.0.0.1:5055',
      reused: true,
      healthy: true,
    });
  });

  it('removes dead records but preserves live stale ownership for reclamation', async () => {
    const deadFile = runtimeFile({ pid: 802, httpUrl: 'http://127.0.0.1:5055' });
    const deadKill = vi.fn(() => {
      const error = new Error('gone');
      error.code = 'ESRCH';
      throw error;
    });
    await expect(discoverBundledKernel({ runtimeFile: deadFile, kill: deadKill })).resolves.toBeNull();
    expect(fs.existsSync(deadFile)).toBe(false);

    const staleFile = runtimeFile({ pid: 803, httpUrl: 'http://127.0.0.1:5055' });
    await expect(discoverBundledKernel({
      runtimeFile: staleFile,
      expectedVersion: '1.1.19',
      kill: vi.fn(),
      fetchImpl: vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
    })).rejects.toMatchObject({
      code: 'RUNTIME_STALE',
      runtime: expect.objectContaining({ pid: 803 }),
    });
    expect(fs.existsSync(staleFile)).toBe(true);
  });

  it('surfaces database recovery as a persistent degraded health result', async () => {
    await expect(probeBundledKernel({ httpUrl: 'http://127.0.0.1:5055' }, {
      expectedVersion: '1.1.19',
      fetchImpl: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'ok',
          version: '1.1.19',
          database: { recoveredFromCorruption: true },
        }),
      })),
    })).resolves.toMatchObject({
      healthy: true,
      degradedReason: 'database_recovered',
    });
  });
});
