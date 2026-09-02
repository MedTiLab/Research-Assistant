import crypto from 'crypto';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

import { resolveAppVersion } from './appVersion.js';
import { resolveAppDataRoot } from './storagePaths.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(MODULE_DIR, '../..');
const PUBLIC_KEY_PATH = path.join(APP_ROOT, 'server', 'assets', 'kernel-update-ed25519-public.pem');
const UPDATER_SOURCE_PATH = path.join(
  APP_ROOT,
  'scripts',
  'packaging',
  'windows',
  'local-engine-self-update.mjs',
);
const MAX_PACKAGE_BYTES = 512 * 1024 * 1024;
let updatePreparationPromise = null;

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

export function compareKernelVersions(leftValue, rightValue) {
  const parse = (value) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(value || '').trim());
    return match ? match.slice(1, 4).map(Number) : null;
  };
  const left = parse(leftValue);
  const right = parse(rightValue);
  if (!left || !right) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return 1;
    if (left[index] < right[index]) return -1;
  }
  return 0;
}

export function getKernelSelfUpdateCapability({
  platform = process.platform,
  appRoot = APP_ROOT,
  entryPoint = process.argv[1] || '',
  secureDistribution = isTruthy(process.env.MEDHELP_SECURE_DISTRIBUTION),
} = {}) {
  const installMode = secureDistribution
    ? 'secure'
    : fs.existsSync(path.join(appRoot, '.git'))
      ? 'git'
      : 'npm';
  const cliEntrypoint = /[\\/]server[\\/]cli\.js$/i.test(String(entryPoint));
  const supported = platform === 'win32' && installMode === 'npm' && cliEntrypoint;
  let reason = null;
  if (platform !== 'win32') reason = 'windows_only';
  else if (installMode !== 'npm') reason = `unsupported_install_mode:${installMode}`;
  else if (!cliEntrypoint) reason = 'unsupported_launcher';

  return { supported, platform, installMode, reason };
}

export function normalizeWindowsKernelRelease(payload, cloudBaseUrl, currentVersion = resolveAppVersion()) {
  const candidate = payload?.update?.windows;
  const version = String(payload?.version || '').trim().replace(/^v/, '');
  const sha256 = String(candidate?.sha256 || '').trim().toLowerCase();
  const signature = String(candidate?.signature || '').trim();
  const bytes = Number(candidate?.bytes);
  if (!candidate || !/^\d+\.\d+\.\d+/.test(version)) {
    throw new Error('The cloud release does not include a Windows Local Engine package');
  }
  if (compareKernelVersions(version, currentVersion) <= 0) {
    const error = new Error(`Local Engine ${currentVersion} is already current`);
    error.code = 'ALREADY_CURRENT';
    throw error;
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('The Windows Local Engine release checksum is invalid');
  }
  if (candidate?.signatureAlgorithm !== 'ed25519-sha256' || !signature) {
    throw new Error('The Windows Local Engine release signature is missing');
  }
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_PACKAGE_BYTES) {
    throw new Error('The Windows Local Engine release size is invalid');
  }

  const cloudUrl = new URL(cloudBaseUrl);
  const packageUrl = new URL(String(candidate.packageUrl || ''), cloudUrl);
  const loopbackCloud = ['localhost', '127.0.0.1', '::1'].includes(cloudUrl.hostname);
  if (packageUrl.origin !== cloudUrl.origin) {
    throw new Error('The Windows Local Engine package must use the configured cloud origin');
  }
  if (!loopbackCloud && packageUrl.protocol !== 'https:') {
    throw new Error('The Windows Local Engine package must use HTTPS');
  }
  if (!packageUrl.pathname.startsWith('/downloads/') || !packageUrl.pathname.endsWith('.tgz')) {
    throw new Error('The Windows Local Engine package URL is not allowed');
  }

  return {
    version,
    packageUrl: packageUrl.href,
    sha256,
    signature,
    signatureAlgorithm: 'ed25519-sha256',
    bytes,
  };
}

export function verifyKernelDigestSignature(sha256, signature, publicKey) {
  if (!/^[a-f0-9]{64}$/i.test(String(sha256 || ''))) {
    return false;
  }
  try {
    return crypto.verify(
      null,
      Buffer.from(sha256, 'hex'),
      publicKey,
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function writeUpdateStatus(statusPath, payload) {
  await fsPromises.mkdir(path.dirname(statusPath), { recursive: true });
  await fsPromises.writeFile(statusPath, `${JSON.stringify({
    updatedAt: new Date().toISOString(),
    ...payload,
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export function resolveKernelUpdateStatusPath() {
  return path.join(resolveAppDataRoot(), 'runtime', 'kernel-update.json');
}

export async function readKernelUpdateStatus() {
  try {
    return JSON.parse(await fsPromises.readFile(resolveKernelUpdateStatusPath(), 'utf8'));
  } catch {
    return null;
  }
}

async function resolveNpmCliPath(nodeExecutable = process.execPath) {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(nodeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(nodeExecutable), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) return resolved;
  }
  return null;
}

async function downloadReleasePackage(release, destinationPath, fetchImpl, onProgress = null) {
  const response = await fetchImpl(release.packageUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Local Engine package download failed with HTTP ${response.status}`);
  }
  const responseLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(responseLength) && responseLength > 0 && responseLength !== release.bytes) {
    throw new Error('Local Engine package size does not match the signed release manifest');
  }

  const readable = typeof response.body.getReader === 'function'
    ? Readable.fromWeb(response.body)
    : response.body;
  let downloadedBytes = 0;
  await pipeline(
    readable,
    async function* trackDownload(source) {
      for await (const chunk of source) {
        downloadedBytes += chunk.length;
        if (onProgress) {
          await onProgress(downloadedBytes, release.bytes);
        }
        yield chunk;
      }
    },
    fs.createWriteStream(destinationPath, { mode: 0o600 }),
  );
}

export async function completeKernelUpdateIfCurrent(currentVersion = resolveAppVersion()) {
  const status = await readKernelUpdateStatus();
  if (
    status?.targetVersion === currentVersion
    && ['ready', 'installing', 'restarting', 'awaiting_manual_restart'].includes(status?.state)
  ) {
    const completed = {
      state: 'completed',
      progress: 100,
      currentVersion,
      targetVersion: currentVersion,
    };
    await writeUpdateStatus(resolveKernelUpdateStatusPath(), completed);
    return completed;
  }
  return status;
}

export async function prepareWindowsKernelUpdate({
  cloudBaseUrl,
  cloudAccessToken,
  fetchImpl = globalThis.fetch,
  currentVersion = resolveAppVersion(),
} = {}) {
  if (updatePreparationPromise) {
    return updatePreparationPromise;
  }

  updatePreparationPromise = (async () => {
    const capability = getKernelSelfUpdateCapability();
    if (!capability.supported) {
      const error = new Error(`One-click update is unavailable (${capability.reason})`);
      error.code = 'SELF_UPDATE_UNSUPPORTED';
      throw error;
    }
    if (typeof fetchImpl !== 'function') {
      throw new Error('Download support is unavailable in this Local Engine version');
    }

    const normalizedCloudBase = String(cloudBaseUrl || 'https://app.medtimehelp.com').replace(/\/+$/, '');
    const statusPath = resolveKernelUpdateStatusPath();
    await writeUpdateStatus(statusPath, {
      state: 'checking',
      progress: 2,
      currentVersion,
    });
    const releaseResponse = await fetchImpl(`${normalizedCloudBase}/api/local-kernel/public-releases`, {
      cache: 'no-store',
      headers: cloudAccessToken ? { Authorization: `Bearer ${cloudAccessToken}` } : {},
      signal: AbortSignal.timeout(15_000),
    });
    const releasePayload = await releaseResponse.json().catch(() => null);
    if (!releaseResponse.ok) {
      throw new Error(releasePayload?.error || `Release check failed with HTTP ${releaseResponse.status}`);
    }
    const release = normalizeWindowsKernelRelease(releasePayload, normalizedCloudBase, currentVersion);
    const publicKey = await fsPromises.readFile(PUBLIC_KEY_PATH, 'utf8');
    if (!verifyKernelDigestSignature(release.sha256, release.signature, publicKey)) {
      throw new Error('The Windows Local Engine release signature is invalid');
    }

    const updateRoot = path.join(resolveAppDataRoot(), 'updates', release.version);
    const packagePath = path.join(updateRoot, `medhelp-cli-${release.version}.tgz`);
    const partialPath = `${packagePath}.download`;
    const updaterPath = path.join(updateRoot, 'windows-kernel-self-update.mjs');
    const payloadPath = path.join(updateRoot, 'update-payload.json');
    await fsPromises.mkdir(updateRoot, { recursive: true });
    await fsPromises.rm(partialPath, { force: true });
    await writeUpdateStatus(statusPath, {
      state: 'downloading',
      progress: 5,
      downloadedBytes: 0,
      totalBytes: release.bytes,
      downloadPercent: 0,
      currentVersion,
      targetVersion: release.version,
    });

    let lastProgressWriteAt = 0;
    let lastDownloadPercent = -1;
    await downloadReleasePackage(release, partialPath, fetchImpl, async (downloadedBytes, totalBytes) => {
      const downloadPercent = Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100));
      const now = Date.now();
      if (downloadPercent === lastDownloadPercent || (downloadPercent < 100 && now - lastProgressWriteAt < 250)) {
        return;
      }
      lastDownloadPercent = downloadPercent;
      lastProgressWriteAt = now;
      await writeUpdateStatus(statusPath, {
        state: 'downloading',
        progress: Math.min(70, 5 + Math.round(downloadPercent * 0.65)),
        downloadedBytes,
        totalBytes,
        downloadPercent,
        currentVersion,
        targetVersion: release.version,
      });
    });
    await writeUpdateStatus(statusPath, {
      state: 'verifying',
      progress: 72,
      downloadedBytes: release.bytes,
      totalBytes: release.bytes,
      downloadPercent: 100,
      currentVersion,
      targetVersion: release.version,
    });
    const stats = await fsPromises.stat(partialPath);
    if (stats.size !== release.bytes) {
      throw new Error('Downloaded Local Engine package size is invalid');
    }
    const downloadedSha256 = await hashFile(partialPath);
    if (downloadedSha256 !== release.sha256) {
      throw new Error('Downloaded Local Engine package checksum is invalid');
    }
    if (!verifyKernelDigestSignature(downloadedSha256, release.signature, publicKey)) {
      throw new Error('Downloaded Local Engine package signature is invalid');
    }
    await fsPromises.rename(partialPath, packagePath);
    await fsPromises.copyFile(UPDATER_SOURCE_PATH, updaterPath);

    const npmCliPath = await resolveNpmCliPath();
    if (!npmCliPath) {
      throw new Error('Unable to locate npm-cli.js for the independent updater');
    }
    const logPath = path.join(resolveAppDataRoot(), 'logs', 'kernel-update.log');
    await fsPromises.mkdir(path.dirname(logPath), { recursive: true });
    await fsPromises.writeFile(payloadPath, `${JSON.stringify({
      parentPid: process.pid,
      packagePath,
      expectedSha256: release.sha256,
      expectedSignature: release.signature,
      publicKeyPath: PUBLIC_KEY_PATH,
      targetVersion: release.version,
      currentVersion,
      nodeExecutable: process.execPath,
      npmCliPath,
      statusPath,
      logPath,
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await writeUpdateStatus(statusPath, {
      state: 'ready',
      progress: 78,
      currentVersion,
      targetVersion: release.version,
    });

    const updater = spawn(process.execPath, [updaterPath, payloadPath], {
      cwd: os.tmpdir(),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    updater.unref();
    return {
      accepted: true,
      currentVersion,
      targetVersion: release.version,
      restartExpected: false,
      manualRestartRequired: true,
    };
  })();

  try {
    return await updatePreparationPromise;
  } catch (error) {
    await writeUpdateStatus(resolveKernelUpdateStatusPath(), {
      state: 'failed',
      progress: 0,
      currentVersion,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
    updatePreparationPromise = null;
    throw error;
  }
}
