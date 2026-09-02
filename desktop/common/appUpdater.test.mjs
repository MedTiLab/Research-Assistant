import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDesktopAppUpdater, __testables } from './appUpdater.mjs';

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function artifact(overrides = {}) {
  return {
    name: 'MedHelp-Online-1.2.0-win-x64.exe',
    url: '/api/public-downloads/object/downloads/MedHelp-Online-1.2.0-win-x64.exe',
    platform: 'windows',
    architecture: 'x64',
    version: '1.2.0',
    bytes: 9,
    sha256: 'a'.repeat(64),
    ...overrides,
  };
}

describe('desktop app updater', () => {
  it('selects the newest compatible signed artifact', () => {
    const selected = __testables.selectLatestArtifact([
      artifact({ version: '1.1.9' }),
      artifact({ version: '1.3.0', architecture: 'arm64' }),
      artifact({ version: '1.2.0', sha256: null }),
      artifact({ version: '1.2.1' }),
    ], 'win32', 'x64');

    expect(selected?.version).toBe('1.2.1');
  });

  it('downloads, hashes, and hands a verified installer to the platform installer', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'medhelp-app-update-'));
    temporaryDirectories.push(userData);
    const installerBytes = Buffer.from('installer');
    const releaseArtifact = artifact({
      bytes: installerBytes.length,
      sha256: crypto.createHash('sha256').update(installerBytes).digest('hex'),
    });
    const install = vi.fn().mockResolvedValue(undefined);
    const fetchImpl = vi.fn(async (url) => {
      if (String(url).endsWith('/api/public-downloads')) {
        return new Response(JSON.stringify({ medhelpDesktop: [releaseArtifact] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(installerBytes, {
        status: 200,
        headers: { 'content-length': String(installerBytes.length) },
      });
    });
    const app = {
      isPackaged: true,
      getVersion: () => '1.1.15',
      getPath: (name) => name === 'userData' ? userData : '',
    };
    const updater = createDesktopAppUpdater({
      app,
      baseUrl: 'https://app.medtimehelp.com',
      platform: 'win32',
      arch: 'x64',
      fetchImpl,
      install,
    });

    expect((await updater.check()).status).toBe('available');
    await updater.downloadAndInstall();

    expect(install).toHaveBeenCalledOnce();
    const { installerPath } = install.mock.calls[0][0];
    expect(fs.readFileSync(installerPath)).toEqual(installerBytes);
    expect(updater.getState()).toMatchObject({ status: 'installing', progress: 100 });
  });

  it('rejects a package whose checksum does not match', async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'medhelp-app-update-'));
    temporaryDirectories.push(userData);
    const releaseArtifact = artifact();
    const install = vi.fn();
    const fetchImpl = vi.fn(async (url) => String(url).endsWith('/api/public-downloads')
      ? new Response(JSON.stringify({ medhelpDesktop: [releaseArtifact] }), { status: 200 })
      : new Response('installer', { status: 200 }));
    const updater = createDesktopAppUpdater({
      app: {
        isPackaged: true,
        getVersion: () => '1.1.15',
        getPath: () => userData,
      },
      baseUrl: 'https://app.medtimehelp.com',
      platform: 'win32',
      arch: 'x64',
      fetchImpl,
      install,
    });

    await expect(updater.downloadAndInstall()).rejects.toThrow(/SHA-256/);
    expect(install).not.toHaveBeenCalled();
    expect(updater.getState().status).toBe('error');
  });
});
