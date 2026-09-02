import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { isUpdateAvailable } from './updateCheck.mjs';

const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

function normalizePlatform(platform) {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  return platform;
}

function isCompatibleArtifact(artifact, platform, arch) {
  if (!artifact || artifact.platform !== normalizePlatform(platform)) return false;
  if (!artifact.version || !artifact.url || !/^[a-f0-9]{64}$/i.test(String(artifact.sha256 || ''))) return false;
  return !artifact.architecture
    || artifact.architecture === arch
    || artifact.architecture === 'universal';
}

function selectLatestArtifact(artifacts, platform, arch) {
  return artifacts
    .filter((artifact) => isCompatibleArtifact(artifact, platform, arch))
    .sort((left, right) => {
      if (isUpdateAvailable(left.version, right.version)) return 1;
      if (isUpdateAvailable(right.version, left.version)) return -1;
      return 0;
    })[0] || null;
}

function safeInstallerName(artifact, platform) {
  const expectedExtension = platform === 'win32' ? '.exe' : '.dmg';
  const fileName = path.basename(String(artifact?.name || `MedHelp-update${expectedExtension}`));
  if (!fileName.toLowerCase().endsWith(expectedExtension)) {
    throw new Error(`更新包格式无效，应为 ${expectedExtension}`);
  }
  return fileName;
}

function publicState(state) {
  const { artifact, installerPath, ...safeState } = state;
  return {
    ...safeState,
    releaseInfo: artifact ? {
      title: `MedHelp v${artifact.version}`,
      body: '',
      htmlUrl: artifact.url,
      publishedAt: artifact.publishedAt || '',
    } : null,
  };
}

export function createDesktopAppUpdater({
  app,
  baseUrl,
  platform = process.platform,
  arch = process.arch,
  fetchImpl = globalThis.fetch,
  log = () => {},
  onStateChange = () => {},
  install,
}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Desktop updater requires fetch support');
  }

  let state = {
    status: app.isPackaged ? 'idle' : 'unsupported',
    currentVersion: app.getVersion(),
    latestVersion: null,
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    error: null,
    artifact: null,
    installerPath: null,
  };
  let activeCheck = null;
  let activeInstall = null;
  let checkTimer = null;

  const emit = (patch = {}) => {
    state = { ...state, ...patch };
    const snapshot = publicState(state);
    onStateChange(snapshot);
    return snapshot;
  };

  const resolveDownloadUrl = (value) => {
    const resolved = new URL(String(value || ''), baseUrl);
    if (app.isPackaged && resolved.protocol !== 'https:') {
      throw new Error('桌面更新包必须通过 HTTPS 下载');
    }
    return resolved.href;
  };

  const check = async ({ quiet = false } = {}) => {
    if (!app.isPackaged) return publicState(state);
    if (activeInstall) return publicState(state);
    if (activeCheck) return activeCheck;

    activeCheck = (async () => {
      if (!quiet || state.status === 'idle' || state.status === 'error') {
        emit({ status: 'checking', error: null });
      }
      try {
        const catalogUrl = new URL('/api/public-downloads', baseUrl).href;
        const response = await fetchImpl(catalogUrl, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`更新检查失败（HTTP ${response.status}）`);
        const catalog = await response.json();
        const artifact = selectLatestArtifact(
          Array.isArray(catalog?.medhelpDesktop) ? catalog.medhelpDesktop : [],
          platform,
          arch,
        );
        const updateAvailable = Boolean(
          artifact && isUpdateAvailable(app.getVersion(), artifact.version),
        );
        return emit({
          status: updateAvailable ? 'available' : 'idle',
          latestVersion: artifact?.version || null,
          progress: 0,
          downloadedBytes: 0,
          totalBytes: Number(artifact?.bytes || 0),
          error: null,
          artifact,
          installerPath: null,
        });
      } catch (error) {
        log('Desktop update check failed', error instanceof Error ? error.message : String(error));
        if (!quiet || !['available', 'downloading', 'verifying', 'installing'].includes(state.status)) {
          return emit({
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return publicState(state);
      } finally {
        activeCheck = null;
      }
    })();
    return activeCheck;
  };

  const downloadAndInstall = async () => {
    if (!app.isPackaged) throw new Error('开发模式不执行桌面自动更新');
    if (activeInstall) return activeInstall;

    activeInstall = (async () => {
      try {
        if (!state.artifact || !isUpdateAvailable(app.getVersion(), state.artifact.version)) {
          await check();
        }
        const artifact = state.artifact;
        if (!artifact || !isUpdateAvailable(app.getVersion(), artifact.version)) {
          throw new Error('当前已是最新版本');
        }

        const installerName = safeInstallerName(artifact, platform);
        const updateDirectory = path.join(app.getPath('userData'), 'updates', artifact.version);
        const installerPath = path.join(updateDirectory, installerName);
        const temporaryPath = `${installerPath}.download`;
        fs.mkdirSync(updateDirectory, { recursive: true });
        fs.rmSync(temporaryPath, { force: true });
        fs.rmSync(installerPath, { force: true });

        const response = await fetchImpl(resolveDownloadUrl(artifact.url), {
          cache: 'no-store',
          redirect: 'follow',
        });
        if (!response.ok || !response.body) {
          throw new Error(`更新包下载失败（HTTP ${response.status}）`);
        }
        if (app.isPackaged && response.url && new URL(response.url).protocol !== 'https:') {
          throw new Error('更新下载被重定向到不安全地址');
        }

        const totalBytes = Number(response.headers.get('content-length') || artifact.bytes || 0);
        let downloadedBytes = 0;
        let lastProgressEventAt = 0;
        const hash = crypto.createHash('sha256');
        const tracker = new Transform({
          transform(chunk, _encoding, callback) {
            hash.update(chunk);
            downloadedBytes += chunk.length;
            const now = Date.now();
            if (now - lastProgressEventAt >= 120 || downloadedBytes === totalBytes) {
              lastProgressEventAt = now;
              emit({
                status: 'downloading',
                progress: totalBytes > 0 ? Math.min(94, Math.round(downloadedBytes / totalBytes * 94)) : 0,
                downloadedBytes,
                totalBytes,
                error: null,
              });
            }
            callback(null, chunk);
          },
        });

        emit({ status: 'downloading', progress: 0, downloadedBytes: 0, totalBytes, error: null });
        await pipeline(response.body, tracker, fs.createWriteStream(temporaryPath, { mode: 0o700 }));
        emit({ status: 'verifying', progress: 96, downloadedBytes, totalBytes });

        const actualSha256 = hash.digest('hex');
        if (!crypto.timingSafeEqual(
          Buffer.from(actualSha256, 'hex'),
          Buffer.from(String(artifact.sha256).toLowerCase(), 'hex'),
        )) {
          throw new Error('更新包 SHA-256 校验失败，已停止安装');
        }
        fs.renameSync(temporaryPath, installerPath);
        if (platform === 'win32') fs.chmodSync(installerPath, 0o700);

        emit({ status: 'installing', progress: 100, installerPath, error: null });
        log('Desktop update verified; handing off to installer', {
          version: artifact.version,
          installerPath,
        });
        await install({ installerPath, artifact });
        return publicState(state);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log('Desktop update failed', message);
        emit({ status: 'error', error: message });
        throw error;
      } finally {
        activeInstall = null;
      }
    })();
    return activeInstall;
  };

  const start = () => {
    if (!app.isPackaged || checkTimer) return;
    void check({ quiet: true });
    checkTimer = setInterval(() => void check({ quiet: true }), UPDATE_CHECK_INTERVAL_MS);
    checkTimer.unref?.();
  };

  const stop = () => {
    if (checkTimer) clearInterval(checkTimer);
    checkTimer = null;
  };

  return {
    getState: () => publicState(state),
    check,
    downloadAndInstall,
    start,
    stop,
  };
}

export const __testables = {
  isCompatibleArtifact,
  normalizePlatform,
  selectLatestArtifact,
};
