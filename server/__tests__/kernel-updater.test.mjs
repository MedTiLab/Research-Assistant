import crypto from 'crypto';
import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, describe, expect, it } from 'vitest';

import {
  compareKernelVersions,
  getKernelSelfUpdateCapability,
  normalizeWindowsKernelRelease,
  verifyKernelDigestSignature,
} from '../utils/kernelUpdater.js';

let tempRoot = null;

afterEach(async () => {
  if (tempRoot) {
    await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe('Windows Kernel self updater', () => {
  it('compares Kernel versions', () => {
    expect(compareKernelVersions('1.1.9', '1.1.8')).toBe(1);
    expect(compareKernelVersions('v1.1.9', '1.1.9')).toBe(0);
    expect(compareKernelVersions('1.0.9', '1.1.0')).toBe(-1);
  });

  it('only enables self update for the Windows npm CLI distribution', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-updater-capability-'));
    expect(getKernelSelfUpdateCapability({
      platform: 'win32',
      appRoot: tempRoot,
      entryPoint: 'C:\\Users\\customer\\AppData\\Roaming\\npm\\node_modules\\medhelp\\server\\cli.js',
      secureDistribution: false,
    })).toMatchObject({ supported: true, installMode: 'npm' });

    await fs.mkdir(path.join(tempRoot, '.git'));
    expect(getKernelSelfUpdateCapability({
      platform: 'win32',
      appRoot: tempRoot,
      entryPoint: 'C:\\medhelp\\server\\cli.js',
      secureDistribution: false,
    })).toMatchObject({ supported: false, installMode: 'git' });
  });

  it('accepts only signed-package metadata from the configured HTTPS cloud origin', () => {
    const release = {
      version: '1.1.10',
      update: {
        windows: {
          packageUrl: 'https://app.medtimehelp.com/downloads/medhelp-cli-1.1.10.tgz',
          sha256: 'a'.repeat(64),
          signature: 'signed',
          signatureAlgorithm: 'ed25519-sha256',
          bytes: 1024,
        },
      },
    };
    expect(normalizeWindowsKernelRelease(release, 'https://app.medtimehelp.com', '1.1.9'))
      .toMatchObject({ version: '1.1.10', bytes: 1024 });

    release.update.windows.packageUrl = 'https://attacker.example/downloads/medhelp-cli-1.1.10.tgz';
    expect(() => normalizeWindowsKernelRelease(release, 'https://app.medtimehelp.com', '1.1.9'))
      .toThrow(/configured cloud origin/);
  });

  it('verifies an Ed25519 signature over the package SHA-256 digest', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const sha256 = crypto.createHash('sha256').update('package bytes').digest('hex');
    const signature = crypto.sign(null, Buffer.from(sha256, 'hex'), privateKey).toString('base64');

    expect(verifyKernelDigestSignature(sha256, signature, publicKey)).toBe(true);
    expect(verifyKernelDigestSignature('b'.repeat(64), signature, publicKey)).toBe(false);
  });

  it('installs the update without starting the Kernel in the background', async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-updater-manual-start-'));
    const packagePath = path.join(tempRoot, 'medhelp-cli.tgz');
    const publicKeyPath = path.join(tempRoot, 'public.pem');
    const installerPath = path.join(tempRoot, 'fake-npm-cli.mjs');
    const restartMarkerPath = path.join(tempRoot, 'unexpected-restart.txt');
    const entryPoint = path.join(tempRoot, 'restart-marker.mjs');
    const statusPath = path.join(tempRoot, 'status.json');
    const logPath = path.join(tempRoot, 'update.log');
    const payloadPath = path.join(tempRoot, 'payload.json');
    const packageBytes = Buffer.from('signed test package');
    const sha256 = crypto.createHash('sha256').update(packageBytes).digest('hex');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const signature = crypto.sign(null, Buffer.from(sha256, 'hex'), privateKey).toString('base64');

    await fs.writeFile(packagePath, packageBytes);
    await fs.writeFile(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
    await fs.writeFile(installerPath, 'process.exit(0);\n');
    await fs.writeFile(
      entryPoint,
      `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(restartMarkerPath)}, 'started');\n`,
    );
    await fs.writeFile(payloadPath, JSON.stringify({
      parentPid: 99_999_999,
      packagePath,
      expectedSha256: sha256,
      expectedSignature: signature,
      publicKeyPath,
      targetVersion: '1.1.11',
      currentVersion: '1.1.10',
      nodeExecutable: process.execPath,
      npmCliPath: installerPath,
      entryPoint,
      statusPath,
      logPath,
    }));

    const updaterPath = fileURLToPath(
      new URL('../../scripts/packaging/windows/local-engine-self-update.mjs', import.meta.url),
    );
    execFileSync(process.execPath, [updaterPath, payloadPath]);
    const status = JSON.parse(await fs.readFile(statusPath, 'utf8'));

    expect(status).toMatchObject({
      state: 'awaiting_manual_restart',
      progress: 100,
      targetVersion: '1.1.11',
    });
    await expect(fs.access(restartMarkerPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
