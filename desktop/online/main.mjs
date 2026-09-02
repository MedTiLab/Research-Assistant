import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  powerSaveBlocker,
  safeStorage,
  screen,
  shell,
  Tray,
} from 'electron';

import {
  getDesktopWindowChromeOptions,
  installDesktopApplicationMenu,
  syncDesktopWindowChrome,
} from '../common/windowChrome.mjs';
import { RuntimeSupervisor, RUNTIME_STATUS } from '../common/runtimeSupervisor.mjs';
import { createRendererRecoveryPolicy } from '../common/rendererRecovery.mjs';
import { createRuntimeRestartCoordinator } from '../common/runtimeRestartCoordinator.mjs';
import { createRuntimeStateJournal } from '../common/runtimeStateJournal.mjs';
import { findTrustedClaudeAuthUrl } from '../common/claudeOAuth.mjs';
import { createDesktopAppUpdater } from '../common/appUpdater.mjs';
import { loadCodexPetAsset } from '../common/codexPetAsset.mjs';
import {
  countSkillDirectoriesSync,
  requirePositiveSkillCount,
} from '../common/skillBundleValidation.mjs';
import {
  isHostedHttpUrl,
  isRendererOwnedNavigationUrl,
  resolveLocalDocumentUrl,
  resolveOnlineResourceUrl,
} from './hostedNavigation.mjs';
import { isHostedDesktopPermissionAllowed } from './hostedPermissions.mjs';
import { startOfflineUiServer } from './offlineUiServer.mjs';
import {
  discoverBundledKernel,
  isProcessAlive,
  probeBundledKernel,
} from './kernelLifecycle.mjs';
import {
  clearDesktopAuthSession,
  readDesktopAuthSession,
  saveDesktopAuthSession,
} from './desktopAuthSession.mjs';
import {
  canReadRememberedLogin,
  resolveHostedUiTimeout,
  shouldUseKeychainAuthSession,
} from './desktopStartupPolicy.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '../..');
const RUNTIME_SHELL_PATH = path.join(__dirname, '../common/runtime-shell.html');
const RUNTIME_SHELL_URL = pathToFileURL(RUNTIME_SHELL_PATH).href;

function resolveDesktopAppVersion() {
  if (app.isPackaged) return app.getVersion();
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
    if (typeof packageJson.version === 'string' && packageJson.version) return packageJson.version;
  } catch {
    // Fall through to Electron's reported version so a malformed development
    // checkout still produces a useful startup error instead of crashing here.
  }
  return app.getVersion();
}

const PRODUCT_NAME = 'MedHelp';
const DESKTOP_APP_VERSION = resolveDesktopAppVersion();
const WINDOW_TITLE = 'MedHelp';
const APP_ID = 'com.yzglab.medhelpsec';
const CLOUD_APP_URL = process.env.MEDHELP_CLOUD_APP_URL || 'https://app.medtimehelp.com/';
const CLOUD_APP_ORIGIN = new URL(CLOUD_APP_URL).origin;
const DESKTOP_UI_MODE = process.env.MEDHELP_DESKTOP_UI_MODE === 'offline' ? 'offline' : 'hosted';
const USE_OFFLINE_UI = DESKTOP_UI_MODE === 'offline';
const EXPECTED_AGENT_PACKAGES = Object.freeze({
  '@anthropic-ai/claude-agent-sdk': '0.3.220',
  '@openai/codex': '0.146.0',
  '@openai/codex-sdk': '0.146.0',
});
const START_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 8_000;
const HOSTED_UI_READY_TIMEOUT_MS = 20_000;
const APP_SHELL_FAIL_OPEN_MS = 20_000;
const RENDERER_UNRESPONSIVE_TIMEOUT_MS = 15_000;
const PREPARE_FOR_UPDATE_SWITCH = '--medhelp-prepare-for-update';
const WINDOW_STATE_SAVE_DELAY_MS = 250;
const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 960;
const MIN_WIDTH = 1100;
const MIN_HEIGHT = 720;
const MACOS_TRAY_ICON_SIZE = 18;
const DESKTOP_KERNEL_ENDPOINT_KEY = 'medhelp.localKernel.lastEndpoint';
app.setName(PRODUCT_NAME);
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_ID);
}
app.setPath(
  'userData',
  process.env.MEDHELP_DESKTOP_USER_DATA_DIR
    ? path.resolve(process.env.MEDHELP_DESKTOP_USER_DATA_DIR)
    : path.join(app.getPath('appData'), 'medhelpsec'),
);

let mainWindow = null;
const companionWindows = new Map();
let kernelProcess = null;
let kernelRuntime = null;
let isQuitting = false;
let closeConfirmationPending = false;
let saveWindowStateTimer = null;
let tray = null;
let cliLoginProcess = null;
let desktopUpdater = null;
let pendingDesktopInstall = null;
let offlineUiServer = null;
let runtimeSupervisor = null;
let rendererMode = 'none';
let appNavigationPromise = null;
let keepAwakeBlockerId = null;
let runtimeRestartCoordinator = null;
let runtimeStateJournal = null;
let rendererRecoveryPolicy = null;
let rendererRecoveryInFlight = false;
let rendererUnresponsiveTimer = null;
let appShellFailOpenTimer = null;
let runtimeStartAttempted = false;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock || process.argv.includes(PREPARE_FOR_UPDATE_SWITCH)) {
  app.quit();
  process.exit(0);
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function getLogDirectory() {
  const localAppData = process.env.LOCALAPPDATA || app.getPath('userData');
  return ensureDirectory(path.join(localAppData, PRODUCT_NAME, 'logs'));
}

function getDesktopLogPath() {
  return path.join(getLogDirectory(), 'desktop-online.log');
}

function getKernelLogPath() {
  return path.join(getLogDirectory(), 'kernel.log');
}

function getRuntimeFilePath() {
  return path.join(ensureDirectory(path.join(app.getPath('userData'), 'runtime')), 'desktop-local-kernel.json');
}

function getRuntimeStateJournal() {
  if (!runtimeStateJournal) {
    runtimeStateJournal = createRuntimeStateJournal({
      filePath: path.join(ensureDirectory(path.join(app.getPath('userData'), 'runtime')), 'desktop-runtime-state.json'),
    });
  }
  return runtimeStateJournal;
}

function getRendererRecoveryPolicy() {
  if (!rendererRecoveryPolicy) {
    rendererRecoveryPolicy = createRendererRecoveryPolicy({
      filePath: path.join(ensureDirectory(path.join(app.getPath('userData'), 'runtime')), 'renderer-failures.json'),
    });
  }
  return rendererRecoveryPolicy;
}

function getSavedLoginPath() {
  return path.join(app.getPath('userData'), 'desktop-login-credentials.json');
}

function getDesktopAuthSessionPath() {
  return path.join(app.getPath('userData'), 'desktop-auth-session.json');
}

function getLegacyKernelCloudAuthPath() {
  const dataRoot = process.env.MEDHELP_DATA_DIR || process.env.DR_CLAW_DATA_DIR;
  return path.join(dataRoot ? path.resolve(dataRoot) : path.join(os.homedir(), '.medhelpsec'), 'cloud-auth.json');
}

function isTrustedHostedRenderer(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    return false;
  }
  try {
    return isAppRendererOrigin(event.senderFrame.url);
  } catch {
    return false;
  }
}

function isTrustedDesktopRenderer(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    return false;
  }
  try {
    const rendererUrl = event.senderFrame.url;
    return rendererUrl === RUNTIME_SHELL_URL || isAppRendererOrigin(rendererUrl);
  } catch {
    return false;
  }
}

function isTrustedCompanionRenderer(event) {
  for (const window of companionWindows.values()) {
    if (!window.isDestroyed() && event.sender === window.webContents) {
      try {
        return isAppRendererOrigin(event.senderFrame.url);
      } catch {
        return false;
      }
    }
  }
  return false;
}

function getAppRendererOrigin() {
  return offlineUiServer?.origin || CLOUD_APP_ORIGIN;
}

function isAppRendererOrigin(value) {
  return isHostedHttpUrl(value, getAppRendererOrigin());
}

function readSavedLogin() {
  const saved = readJson(getSavedLoginPath());
  if (!safeStorage.isEncryptionAvailable()) return null;
  if (typeof saved?.username !== 'string' || typeof saved?.encryptedPassword !== 'string') {
    return null;
  }
  try {
    return {
      username: saved.username,
      password: safeStorage.decryptString(Buffer.from(saved.encryptedPassword, 'base64')),
    };
  } catch {
    return null;
  }
}

function saveLogin({ username, password }) {
  const normalizedUsername = typeof username === 'string' ? username.trim() : '';
  const normalizedPassword = typeof password === 'string' ? password : '';
  if (!normalizedUsername || !normalizedPassword || normalizedUsername.length > 320 || normalizedPassword.length > 4096) {
    throw new Error('Invalid login credentials');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows credential encryption is unavailable');
  }
  fs.writeFileSync(getSavedLoginPath(), JSON.stringify({
    username: normalizedUsername,
    encryptedPassword: safeStorage.encryptString(normalizedPassword).toString('base64'),
  }), { encoding: 'utf8', mode: 0o600 });
}

function logDesktop(message, details = null) {
  const suffix = details == null
    ? ''
    : ` ${typeof details === 'string' ? details : JSON.stringify(details)}`;
  const line = `[${new Date().toISOString()}] ${message}${suffix}`;
  console.log(line);
  try {
    fs.appendFileSync(getDesktopLogPath(), `${line}\n`, 'utf8');
  } catch {
    // Logging must never prevent the desktop app from starting.
  }
}

function broadcastDesktopUpdateState(state) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('desktop:update-state', state);
}

function ensureWindowsLaunchShortcuts() {
  if (process.platform !== 'win32' || !app.isPackaged) return;

  const shortcutName = `MedHelp ${DESKTOP_APP_VERSION}.lnk`;
  const versionedShortcutPattern = /^MedHelp(?: \d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)?\.lnk$/i;
  const shortcutRoots = [
    app.getPath('desktop'),
    path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ];
  const options = {
    target: process.execPath,
    cwd: path.dirname(process.execPath),
    icon: process.execPath,
    iconIndex: 0,
    description: PRODUCT_NAME,
    appUserModelId: APP_ID,
  };

  for (const shortcutRoot of shortcutRoots) {
    try {
      ensureDirectory(shortcutRoot);
      for (const entry of fs.readdirSync(shortcutRoot, { withFileTypes: true })) {
        if (
          entry.isFile()
          && entry.name !== shortcutName
          && versionedShortcutPattern.test(entry.name)
        ) {
          fs.rmSync(path.join(shortcutRoot, entry.name), { force: true });
        }
      }
      const shortcutPath = path.join(shortcutRoot, shortcutName);
      const operation = fs.existsSync(shortcutPath) ? 'replace' : 'create';
      if (!shell.writeShortcutLink(shortcutPath, operation, options)) {
        logDesktop('Windows shortcut creation returned false', { shortcutPath });
      }
    } catch (error) {
      logDesktop('Failed to repair Windows shortcut', {
        shortcutRoot,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
    });
  } catch (error) {
    logDesktop('Failed to repair Windows login item', error instanceof Error ? error.message : String(error));
  }
}

function resolveInstalledMacAppPath() {
  const candidate = path.resolve(path.dirname(process.execPath), '../..');
  return candidate.toLowerCase().endsWith('.app') ? candidate : null;
}

function writeMacUpdateHelper() {
  const helperPath = path.join(ensureDirectory(path.join(app.getPath('userData'), 'updates')), 'install-macos-update.sh');
  const script = `#!/bin/sh
set -eu

old_pid="$1"
dmg_path="$2"
target_app="$3"
mount_dir="$(mktemp -d -t medhelp-update-mount.XXXXXX)"
staged_app="${'${target_app}'}.update-new"

cleanup() {
  hdiutil detach "$mount_dir" -quiet >/dev/null 2>&1 || true
  rmdir "$mount_dir" >/dev/null 2>&1 || true
  if [ -d "$target_app" ]; then open "$target_app" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

while kill -0 "$old_pid" >/dev/null 2>&1; do sleep 1; done
hdiutil attach "$dmg_path" -nobrowse -readonly -mountpoint "$mount_dir" -quiet
source_app="$(find "$mount_dir" -maxdepth 2 -type d -name 'MedHelp.app' -print -quit)"
if [ -z "$source_app" ]; then
  source_app="$(find "$mount_dir" -maxdepth 2 -type d -name '*.app' -print -quit)"
fi
test -n "$source_app"
/usr/bin/codesign --verify --deep --strict "$source_app"
if [ -w "$(dirname "$target_app")" ] && [ -w "$target_app" ]; then
  rm -rf "$staged_app"
  ditto "$source_app" "$staged_app"
  rm -rf "$target_app"
  mv "$staged_app" "$target_app"
else
  /usr/bin/osascript - "$source_app" "$target_app" <<'APPLESCRIPT'
on run argv
  set sourceApp to item 1 of argv
  set targetApp to item 2 of argv
  set stagedApp to targetApp & ".update-new"
  set installCommand to "/bin/rm -rf " & quoted form of stagedApp & " && /usr/bin/ditto " & quoted form of sourceApp & " " & quoted form of stagedApp & " && /bin/rm -rf " & quoted form of targetApp & " && /bin/mv " & quoted form of stagedApp & " " & quoted form of targetApp
  do shell script installCommand with administrator privileges
end run
APPLESCRIPT
fi
`;
  fs.writeFileSync(helperPath, script, { encoding: 'utf8', mode: 0o700 });
  fs.chmodSync(helperPath, 0o700);
  return helperPath;
}

function launchPendingDesktopInstaller() {
  if (!pendingDesktopInstall) return;
  const { installerPath } = pendingDesktopInstall;
  pendingDesktopInstall = null;

  if (process.platform === 'win32') {
    const child = spawn(installerPath, ['/S', '--updated', '--force-run'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return;
  }

  if (process.platform === 'darwin') {
    const targetApp = resolveInstalledMacAppPath();
    if (!targetApp) throw new Error('MedHelp 必须从 Applications 中运行才能自动安装更新');
    const helperPath = writeMacUpdateHelper();
    const child = spawn('/bin/sh', [helperPath, String(process.pid), installerPath, targetApp], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return;
  }

  throw new Error(`暂不支持在 ${process.platform} 上自动安装桌面更新`);
}

async function queueDesktopInstaller(update) {
  if (process.platform === 'darwin' && !resolveInstalledMacAppPath()) {
    throw new Error('请先把 MedHelp 拖入 Applications 文件夹，再使用自动更新');
  }
  pendingDesktopInstall = update;
  app.quit();
}

process.on('uncaughtException', (error) => {
  logDesktop('uncaughtException', error instanceof Error
    ? { message: error.message, stack: error.stack }
    : String(error));
});

process.on('unhandledRejection', (reason) => {
  logDesktop('unhandledRejection', reason instanceof Error
    ? { message: reason.message, stack: reason.stack }
    : String(reason));
});

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function resolveKernelRuntimeRoot() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'kernel-runtime')]
    : [
      path.join(appRoot, 'build', 'secure-headless-kernel'),
      path.join(process.resourcesPath, 'kernel-runtime'),
    ];
  const runtimeRoot = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'security-manifest.json')));
  if (!runtimeRoot) {
    const error = new Error(`内置本地引擎缺失，请重新下载安装完整的 MedHelp ${process.platform === 'darwin' ? 'macOS' : 'Windows'} 安装包。`);
    error.code = 'RUNTIME_MISSING';
    throw error;
  }
  return runtimeRoot;
}

function resolveRuntimeAsset(runtimeRoot, relativePath, label) {
  const normalized = String(relativePath || '').replaceAll('/', path.sep);
  const resolved = path.resolve(runtimeRoot, normalized);
  const relative = path.relative(runtimeRoot, resolved);
  if (!normalized || relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(resolved)) {
    const error = new Error(`内置本地引擎的 ${label} 缺失。`);
    error.code = 'RUNTIME_MISSING';
    throw error;
  }
  return resolved;
}

function verifyBundledKernel() {
  const runtimeRoot = resolveKernelRuntimeRoot();
  const manifestPath = path.join(runtimeRoot, 'security-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
    throw new Error(`安装包平台不匹配：需要 ${process.platform}/${process.arch}。`);
  }
  if (manifest.version !== DESKTOP_APP_VERSION) {
    throw new Error(`桌面版与本地引擎版本不一致：${DESKTOP_APP_VERSION} / ${manifest.version || 'unknown'}。`);
  }
  if (
    manifest.policy?.hostedApplicationOnly !== true
    || manifest.policy?.skillsBundled !== true
    || manifest.policy?.rawFirstPartySourceBundled !== false
  ) {
    throw new Error('内置本地引擎安全清单无效。');
  }

  const manifestSkillCount = requirePositiveSkillCount(
    manifest.assets?.skillCount,
    'Bundled Kernel manifest',
  );
  const skillsDir = resolveRuntimeAsset(runtimeRoot, manifest.assets?.skillsDir || 'skills', 'skills 目录');
  const actualSkillCount = countSkillDirectoriesSync(skillsDir);
  if (actualSkillCount !== manifestSkillCount) {
    throw new Error(`skills 数量校验失败：清单为 ${manifestSkillCount}，实际为 ${actualSkillCount}。`);
  }

  for (const [packageName, expectedVersion] of Object.entries(EXPECTED_AGENT_PACKAGES)) {
    const declaredVersion = manifest.agentPackages?.[packageName];
    const packageJsonPath = path.join(runtimeRoot, 'node_modules', ...packageName.split('/'), 'package.json');
    const installedVersion = fs.existsSync(packageJsonPath)
      ? JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version
      : null;
    if (declaredVersion !== expectedVersion || installedVersion !== expectedVersion) {
      throw new Error(`${packageName} 版本校验失败：应为 ${expectedVersion}，实际为 ${installedVersion || declaredVersion || 'unknown'}。`);
    }
  }

  const nodeRuntimePath = resolveRuntimeAsset(
    runtimeRoot,
    path.join('bin', process.platform === 'win32' ? 'node.exe' : 'node'),
    'Node 运行时',
  );
  const bundledKernelPath = manifest.assets?.kernelEntry
    ? nodeRuntimePath
    : resolveRuntimeAsset(runtimeRoot, path.join('bin', 'medhelp-kernel'), '本地引擎可执行文件');
  const bundledKernelArgs = manifest.assets?.kernelEntry
    ? [resolveRuntimeAsset(runtimeRoot, manifest.assets.kernelEntry, '启动入口')]
    : [];

  // electron-builder applies the final hardened-runtime signature to Mach-O
  // executables after copying extraResources into the app bundle. That changes
  // their whole-file digest without changing their executable code. The outer
  // app signature seals these nested signatures and macOS verifies them before
  // execution, so retain manifest hashing for every other runtime asset.
  const macPackagedExecutables = new Set(['bin/node', 'bin/medhelp-kernel']);
  for (const [relativePath, expectedHash] of Object.entries(manifest.files || {})) {
    if (
      process.platform === 'darwin'
      && app.isPackaged
      && macPackagedExecutables.has(relativePath.replaceAll('\\', '/'))
    ) {
      continue;
    }
    const assetPath = resolveRuntimeAsset(runtimeRoot, relativePath, relativePath);
    if (sha256(assetPath) !== expectedHash) {
      throw new Error(`内置本地引擎文件校验失败：${relativePath}。`);
    }
  }

  return {
    runtimeRoot,
    manifest,
    nodeRuntimePath,
    bundledKernelPath,
    bundledKernelArgs,
    skillsDir,
    templatesDir: resolveRuntimeAsset(runtimeRoot, manifest.assets?.templatesDir || 'templates', '规则模板目录'),
  };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function waitForBundledKernel({ child, instanceId, runtimeFile }) {
  const startedAt = Date.now();
  let childExit = null;
  let childError = null;
  child.once('error', (error) => {
    childError = error;
  });
  child.once('exit', (code, signal) => {
    childExit = { code, signal };
  });

  while (Date.now() - startedAt < START_TIMEOUT_MS) {
    if (childError) throw childError;
    if (childExit) {
      throw new Error(`内置本地引擎启动后立即退出（${childExit.signal || childExit.code || 'unknown'}），请查看 ${getKernelLogPath()}。`);
    }

    const runtime = readJson(runtimeFile);
    if (Number(runtime?.pid) === Number(child.pid) && runtime?.httpUrl) {
      const probe = await probeBundledKernel(runtime, {
        expectedVersion: DESKTOP_APP_VERSION,
        expectedInstanceId: instanceId,
      });
      if (probe.healthy) {
        return { ...runtime, ...probe };
      }
    }
    await wait(350);
  }

  throw new Error(`内置本地引擎在 ${Math.round(START_TIMEOUT_MS / 1000)} 秒内未启动，请查看 ${getKernelLogPath()}。`);
}

async function startBundledKernel({ onExit } = {}) {
  const verified = verifyBundledKernel();
  const runtimeFile = getRuntimeFilePath();
  try {
    const existing = await discoverBundledKernel({
      runtimeFile,
      expectedVersion: DESKTOP_APP_VERSION,
    });
    if (existing) {
      kernelProcess = null;
      kernelRuntime = existing;
      logDesktop('Adopted existing healthy bundled Kernel', {
        pid: existing.pid,
        url: existing.httpUrl,
      });
      return existing;
    }
  } catch (error) {
    if (error?.code !== 'RUNTIME_STALE' || !error.runtime) throw error;
    logDesktop('Reclaiming stale bundled Kernel before launch', {
      pid: error.runtime.pid,
      url: error.runtime.httpUrl,
      reason: error.message,
    });
    await terminateRecordedKernel(error.runtime);
  }

  fs.rmSync(runtimeFile, { force: true });
  const instanceId = crypto.randomUUID();
  const logFd = fs.openSync(getKernelLogPath(), 'a');

  logDesktop('Starting bundled Kernel', {
    version: verified.manifest.version,
    skills: verified.manifest.assets.skillCount,
    runtimeRoot: verified.runtimeRoot,
  });

  let child;
  try {
    child = spawn(verified.bundledKernelPath, verified.bundledKernelArgs, {
      cwd: verified.runtimeRoot,
      windowsHide: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        NODE_ENV: 'production',
        MEDHELP_ENV: 'production',
        MEDHELP_LOCAL_KERNEL: '1',
        MEDHELP_LOCAL_HOST: '127.0.0.1',
        MEDHELP_LOCAL_PORT: process.env.MEDHELP_LOCAL_PORT || '5055',
        MEDHELP_LOCAL_KERNEL_SERVE_APP: '0',
        MEDHELP_SECURE_DISTRIBUTION: '1',
        MEDHELP_LOCAL_PAIRING_SKIP_CLOUD_TOKEN: '1',
        // A packaged Desktop process already has the environment it needs.
        // Importing an interactive login shell here can block every launch for
        // several seconds when the user's shell startup is slow or unhealthy.
        MEDHELP_DISABLE_LOGIN_SHELL_ENV_IMPORT: '1',
        MEDHELP_KERNEL_ENTRYPOINT: '1',
        MEDHELP_KERNEL_INSTANCE_ID: instanceId,
        MEDHELP_LOCAL_KERNEL_RUNTIME_FILE: runtimeFile,
        MEDHELP_CLOUD_APP_URL: CLOUD_APP_URL,
        MEDHELP_ALLOWED_WEB_ORIGINS: [
          CLOUD_APP_ORIGIN,
          'https://app.medtimehelp.com',
          offlineUiServer?.origin,
          process.env.MEDHELP_ALLOWED_WEB_ORIGINS || '',
        ].filter(Boolean).join(','),
        MEDHELP_RUNTIME_ROOT: verified.runtimeRoot,
        MEDHELP_SKILLS_DIR: verified.skillsDir,
        MEDHELP_TEMPLATES_DIR: verified.templatesDir,
        npm_package_version: DESKTOP_APP_VERSION,
      },
    });
    kernelProcess = child;
  } finally {
    fs.closeSync(logFd);
  }

  let startupComplete = false;
  let exitDetails = null;
  child.once('exit', (code, signal) => {
    exitDetails = { code, signal };
    if (kernelProcess === child) kernelProcess = null;
    if (kernelRuntime?.pid === child.pid) kernelRuntime = null;
    if (startupComplete && typeof onExit === 'function') {
      onExit(exitDetails);
    }
  });

  kernelRuntime = await waitForBundledKernel({
    child,
    instanceId,
    runtimeFile,
  });
  startupComplete = true;
  if (exitDetails && typeof onExit === 'function') {
    queueMicrotask(() => onExit(exitDetails));
  }
  logDesktop('Bundled Kernel is ready', {
    pid: kernelRuntime.pid,
    url: kernelRuntime.httpUrl,
    version: kernelRuntime.version,
  });
  return kernelRuntime;
}

async function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) return true;
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

async function waitForPidExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await wait(200);
  }
  return !isProcessAlive(pid);
}

async function terminateRecordedKernel(runtime, child = null) {
  const pid = Number(child?.pid || runtime?.pid);
  const canRequestGracefulShutdown = Boolean(runtime?.httpUrl && runtime?.controlToken);
  try {
    if (canRequestGracefulShutdown) {
      await fetch(`${runtime.httpUrl}/api/local/control/shutdown`, {
        method: 'POST',
        headers: { 'X-MedHelp-Control-Token': runtime.controlToken },
        signal: AbortSignal.timeout(2_500),
      });
    }
  } catch (error) {
    logDesktop('Graceful Kernel shutdown request failed', error instanceof Error ? error.message : String(error));
  }

  // A child that failed before publishing its control endpoint cannot respond
  // to the graceful request. Signal it immediately instead of spending the
  // entire shutdown grace period waiting for an endpoint that never existed.
  if (!canRequestGracefulShutdown && child?.exitCode === null && process.platform !== 'win32') {
    try {
      child.kill('SIGTERM');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }

  const exitedGracefully = child
    ? await waitForChildExit(child, STOP_TIMEOUT_MS)
    : await waitForPidExit(pid, STOP_TIMEOUT_MS);
  if (exitedGracefully || !Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;

  logDesktop('Terminating bundled Kernel process tree after shutdown timeout', { pid });
  if (process.platform === 'win32') {
    const taskkill = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    await waitForChildExit(taskkill, 5_000);
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  if (!await waitForPidExit(pid, 2_000)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
    await waitForPidExit(pid, 2_000);
  }
}

async function stopBundledKernel() {
  const child = kernelProcess;
  const runtime = kernelRuntime || readJson(getRuntimeFilePath());
  kernelProcess = null;
  kernelRuntime = null;

  if ((!child || child.exitCode !== null) && !isProcessAlive(runtime?.pid)) {
    fs.rmSync(getRuntimeFilePath(), { force: true });
    return;
  }
  await terminateRecordedKernel(runtime, child);
  fs.rmSync(getRuntimeFilePath(), { force: true });
}

function broadcastRuntimeStatus(status) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('desktop:runtime-status-changed', status);
}

function setKeepAwakeForActiveWork(active) {
  if (!active) {
    if (keepAwakeBlockerId == null) return;
    try {
      if (powerSaveBlocker.isStarted(keepAwakeBlockerId)) {
        powerSaveBlocker.stop(keepAwakeBlockerId);
      }
    } catch (error) {
      logDesktop('Failed to stop active-work power blocker', error instanceof Error ? error.message : String(error));
    }
    keepAwakeBlockerId = null;
    return;
  }

  if (keepAwakeBlockerId != null && powerSaveBlocker.isStarted(keepAwakeBlockerId)) return;
  try {
    keepAwakeBlockerId = powerSaveBlocker.start('prevent-app-suspension');
  } catch (error) {
    keepAwakeBlockerId = null;
    logDesktop('Failed to start active-work power blocker', error instanceof Error ? error.message : String(error));
  }
}

async function isRuntimeBusy(status) {
  if (!status?.baseUrl) return false;
  const probe = await probeBundledKernel({ httpUrl: status.baseUrl }, {
    expectedVersion: DESKTOP_APP_VERSION,
  });
  return probe.healthy && probe.agentBusy === true;
}

function getRuntimeRestartCoordinator() {
  if (!runtimeRestartCoordinator) {
    runtimeRestartCoordinator = createRuntimeRestartCoordinator({
      getSupervisor: getRuntimeSupervisor,
      isRuntimeBusy,
      log: logDesktop,
    });
  }
  return runtimeRestartCoordinator;
}

async function ensureDesktopAppRendererServer() {
  if (!USE_OFFLINE_UI || offlineUiServer) return offlineUiServer;
  offlineUiServer = await startOfflineUiServer({
    distRoot: path.join(appRoot, 'dist'),
    cloudAppUrl: CLOUD_APP_URL,
    getLocalKernelUrl: () => kernelRuntime?.httpUrl || null,
    log: logDesktop,
  });
  return offlineUiServer;
}

function getRuntimeSupervisor() {
  if (runtimeSupervisor) return runtimeSupervisor;

  runtimeSupervisor = new RuntimeSupervisor({
    diagnosticsPath: getKernelLogPath(),
    startRuntime: async ({ onExit }) => {
      try {
        await ensureDesktopAppRendererServer();
        const runtime = await startBundledKernel({ onExit });
        return {
          pid: runtime.pid,
          baseUrl: runtime.httpUrl,
          startedAt: runtime.startedAt,
          lastHealthyAt: runtime.lastHealthyAt,
          reused: runtime.reused === true,
          controlToken: runtime.controlToken,
          degradedReason: runtime.degradedReason,
          degradedMessage: runtime.degradedMessage,
        };
      } catch (error) {
        await stopBundledKernel();
        throw error;
      }
    },
    stopRuntime: () => stopBundledKernel(),
    probeRuntime: (runtime) => probeBundledKernel({ httpUrl: runtime.baseUrl }, {
      expectedVersion: DESKTOP_APP_VERSION,
    }),
    onHealth: (health) => {
      if (health?.healthy) {
        setKeepAwakeForActiveWork(health.agentBusy === true);
      }
    },
  });
  runtimeSupervisor.onStatus((status) => {
    logDesktop('Runtime status changed', {
      status: status.status,
      reasonCode: status.reasonCode,
      message: status.message,
      pid: status.pid,
      restartCount: status.restartCount,
    });
    try {
      getRuntimeStateJournal().recordStatus(status);
    } catch (error) {
      logDesktop('Failed to persist Runtime status journal', error instanceof Error ? error.message : String(error));
    }
    broadcastRuntimeStatus(status);
    if ([RUNTIME_STATUS.RUNNING, RUNTIME_STATUS.DEGRADED].includes(status.status) && status.baseUrl) {
      void navigateToDesktopApp(status.baseUrl);
    } else if (
      runtimeStartAttempted
      && [RUNTIME_STATUS.ERROR, RUNTIME_STATUS.MISSING].includes(status.status)
    ) {
      void failOpenToDesktopApp(status.reasonCode);
    }
    if (![RUNTIME_STATUS.RUNNING, RUNTIME_STATUS.DEGRADED].includes(status.status)) {
      setKeepAwakeForActiveWork(false);
    }
  });
  return runtimeSupervisor;
}

function getWindowStatePath() {
  return path.join(app.getPath('userData'), 'window-state-online.json');
}

function loadWindowState() {
  const state = readJson(getWindowStatePath());
  return typeof state?.width === 'number' && typeof state?.height === 'number' ? state : null;
}

function saveWindowState(window) {
  if (!window || window.isDestroyed()) return;
  try {
    fs.writeFileSync(getWindowStatePath(), JSON.stringify({
      ...window.getBounds(),
      isMaximized: window.isMaximized(),
    }), 'utf8');
  } catch (error) {
    logDesktop('Failed to save window state', error instanceof Error ? error.message : String(error));
  }
}

function scheduleWindowStateSave(window) {
  clearTimeout(saveWindowStateTimer);
  saveWindowStateTimer = setTimeout(() => saveWindowState(window), WINDOW_STATE_SAVE_DELAY_MS);
}

function ensureWindowVisible(window) {
  const bounds = window.getBounds();
  const visible = screen.getAllDisplays().some(({ workArea }) => {
    const overlapWidth = Math.max(0, Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x));
    const overlapHeight = Math.max(0, Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y));
    return overlapWidth >= 240 && overlapHeight >= 180;
  });
  if (!visible) window.center();
}

function isCloudAppOrigin(value) {
  return isHostedHttpUrl(value, CLOUD_APP_ORIGIN);
}

function getSystemBrowserUrl(value) {
  const rendererOrigin = getAppRendererOrigin();
  return resolveOnlineResourceUrl(value, {
    cloudAppOrigin: CLOUD_APP_ORIGIN,
    rendererOrigin,
  }) || resolveLocalDocumentUrl(value, { rendererOrigin });
}

function isHostedAppPermissionRequest(webContents, requestingOrigin, details = {}) {
  return [
    requestingOrigin,
    details.requestingOrigin,
    details.requestingUrl,
    details.embeddingOrigin,
    details.securityOrigin,
    details.url,
    webContents?.getURL?.(),
  ].some(isAppRendererOrigin);
}

function installHostedAppPermissionHandlers(browserSession) {
  browserSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details = {}) => (
    isHostedDesktopPermissionAllowed(permission, details)
    && isHostedAppPermissionRequest(webContents, requestingOrigin, details)
  ));
  browserSession.setPermissionRequestHandler((webContents, permission, callback, details = {}) => {
    callback(
      isHostedDesktopPermissionAllowed(permission, details)
      && isHostedAppPermissionRequest(webContents, details.requestingOrigin, details),
    );
  });
}

function decorateHostedDesktopUrl(value, localKernelUrl = null, { limited = !localKernelUrl } = {}) {
  const rendererOrigin = getAppRendererOrigin();
  const url = new URL(value, rendererOrigin);
  if (!isAppRendererOrigin(url.href)) return url.href;
  if (localKernelUrl) {
    url.searchParams.set('local', localKernelUrl);
  } else {
    url.searchParams.delete('local');
  }
  url.searchParams.set('desktopKernel', '1');
  url.searchParams.set('desktopRuntimeLimited', limited ? '1' : '0');
  url.searchParams.set('desktopPlatform', process.platform);
  url.searchParams.set('desktopKernelVersion', DESKTOP_APP_VERSION);
  url.searchParams.set('desktopUiMode', DESKTOP_UI_MODE);
  return url.href;
}

function wireNavigation(window) {
  window.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;

    try {
      const protocol = new URL(params.src).protocol;
      if (protocol !== 'http:' && protocol !== 'https:') {
        event.preventDefault();
      }
    } catch {
      event.preventDefault();
    }
  });
  window.webContents.on('did-attach-webview', (_event, guestContents) => {
    guestContents.setWindowOpenHandler(({ url }) => {
      try {
        const protocol = new URL(url).protocol;
        if (protocol === 'http:' || protocol === 'https:') {
          setImmediate(() => {
            if (!guestContents.isDestroyed()) {
              void guestContents.loadURL(url);
            }
          });
        }
      } catch {
        // Ignore malformed URLs emitted by a guest page.
      }
      return { action: 'deny' };
    });
    guestContents.on('will-navigate', (event, url) => {
      try {
        const targetUrl = typeof url === 'string' ? url : event?.url;
        const protocol = new URL(targetUrl).protocol;
        if (protocol !== 'http:' && protocol !== 'https:') {
          event.preventDefault();
        }
      } catch {
        event.preventDefault();
      }
    });
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    const localKernelUrl = kernelRuntime?.httpUrl;
    const systemBrowserUrl = getSystemBrowserUrl(url);
    if (isRendererOwnedNavigationUrl(url)) {
      // blob: and data: resources belong to the renderer that created them.
      // Never replace the hosted application window with an ephemeral image URL.
    } else if (systemBrowserUrl) {
      void shell.openExternal(systemBrowserUrl);
    } else if (isAppRendererOrigin(url)) {
      void window.loadURL(decorateHostedDesktopUrl(url, localKernelUrl));
    } else {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url === window.webContents.getURL()) return;
    const localKernelUrl = kernelRuntime?.httpUrl;
    const systemBrowserUrl = getSystemBrowserUrl(url);
    if (isRendererOwnedNavigationUrl(url)) {
      event.preventDefault();
      return;
    }
    if (systemBrowserUrl) {
      event.preventDefault();
      void shell.openExternal(systemBrowserUrl);
      return;
    }
    if (!isAppRendererOrigin(url)) {
      event.preventDefault();
      void shell.openExternal(url);
      return;
    }
    const decoratedUrl = decorateHostedDesktopUrl(url, localKernelUrl);
    if (decoratedUrl !== url) {
      event.preventDefault();
      void window.loadURL(decoratedUrl);
    }
  });
}

function buildHostedAppUrl(localKernelUrl = null) {
  const appUrl = USE_OFFLINE_UI ? `${getAppRendererOrigin()}/` : CLOUD_APP_URL;
  const url = new URL(decorateHostedDesktopUrl(appUrl, localKernelUrl));
  url.searchParams.set('desktopKernelLaunch', String(Date.now()));
  return url.href;
}

async function syncKernelEndpointToWindow(window, localKernelUrl) {
  if (!localKernelUrl || !window || window.isDestroyed() || !isAppRendererOrigin(window.webContents.getURL())) return;
  const script = `(() => {
    const endpoint = ${JSON.stringify(localKernelUrl)};
    try { window.localStorage.setItem(${JSON.stringify(DESKTOP_KERNEL_ENDPOINT_KEY)}, endpoint); } catch {}
    window.dispatchEvent(new CustomEvent('medhelp-local-kernel-endpoint-updated', {
      detail: { endpoint, source: 'desktop-kernel' }
    }));
  })();`;
  try {
    await window.webContents.executeJavaScript(script, true);
  } catch (error) {
    logDesktop('Failed to sync Kernel endpoint into hosted app', error instanceof Error ? error.message : String(error));
  }
}

async function waitForHostedUiReady(window, timeoutMs = HOSTED_UI_READY_TIMEOUT_MS) {
  const startedAt = Date.now();
  let lastState = null;

  while (!window.isDestroyed() && Date.now() - startedAt < timeoutMs) {
    try {
      lastState = await window.webContents.executeJavaScript(`(() => {
        const cloudAuthenticated = Boolean(window.localStorage.getItem('auth-token'));
        const loginVisible = Boolean(document.querySelector('input[type="password"]'));
        const workbenchVisible = Boolean(document.querySelector('.medical-workbench-shell'));
        const initialSetupVisible = Boolean(document.querySelector('[data-medhelp-initial-setup="true"]'));
        const desktopReadyVisible = Boolean(document.querySelector('[data-medhelp-desktop-ready="true"]'));
        return {
          cloudAuthenticated,
          loginVisible,
          workbenchVisible,
          initialSetupVisible,
          desktopReadyVisible,
          ready: workbenchVisible
            || initialSetupVisible
            || desktopReadyVisible
            || (!cloudAuthenticated && loginVisible),
        };
      })()`, true);
      if (lastState?.ready) {
        logDesktop('Hosted UI is ready', lastState);
        return lastState;
      }
    } catch {
      // The renderer can be between navigations while the cloud app initializes.
    }
    await wait(200);
  }

  logDesktop('Hosted UI readiness wait timed out', lastState);
  return lastState;
}

function sanitizeDownloadFileName(defaultFileName) {
  return path.basename(String(defaultFileName || 'download.zip'))
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/^\.+/, '')
    .trim() || 'download.zip';
}

function bufferFromIpcData(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return Buffer.from(data);
  throw new Error('Invalid file data');
}

ipcMain.handle('desktop:restart-app', async () => {
  app.relaunch();
  app.quit();
});

ipcMain.handle('desktop:runtime-status', async (event) => {
  if (!isTrustedDesktopRenderer(event)) {
    throw new Error('Untrusted desktop Runtime status request');
  }
  return getRuntimeSupervisor().getStatus();
});

ipcMain.handle('desktop:runtime-restart', async (event, options = {}) => {
  if (!isTrustedDesktopRenderer(event)) {
    throw new Error('Untrusted desktop Runtime restart request');
  }
  const force = options?.force === true;
  logDesktop('Renderer requested Runtime restart', { force });
  return getRuntimeRestartCoordinator().request(
    force ? 'renderer-force-request' : 'renderer-request',
    { force },
  );
});

ipcMain.handle('desktop:runtime-open-diagnostics', async (event) => {
  if (!isTrustedDesktopRenderer(event)) return false;
  const status = await getRuntimeSupervisor().getStatus();
  if (!status.diagnosticsPath) return false;
  shell.showItemInFolder(status.diagnosticsPath);
  return true;
});

ipcMain.handle('desktop:close-confirmation-response', (event, shouldClose) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    return false;
  }

  closeConfirmationPending = false;
  if (shouldClose === true) {
    app.quit();
  }
  return true;
});

ipcMain.handle('desktop:get-saved-login', (event) => {
  if (!canReadRememberedLogin({
    trustedRenderer: isTrustedHostedRenderer(event),
    mainWindowVisible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
  })) return null;
  return readSavedLogin();
});

ipcMain.handle('desktop:is-main-window-visible', (event) => {
  if (!isTrustedHostedRenderer(event)) return false;
  return Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
});

ipcMain.handle('desktop:save-login', (event, credentials = {}) => {
  if (!isTrustedHostedRenderer(event)) return false;
  saveLogin(credentials);
  return true;
});

ipcMain.handle('desktop:clear-saved-login', (event) => {
  if (!isTrustedHostedRenderer(event)) return false;
  fs.rmSync(getSavedLoginPath(), { force: true });
  return true;
});

ipcMain.handle('desktop:restore-auth-session', (event) => {
  if (!isTrustedHostedRenderer(event)) return null;
  if (!shouldUseKeychainAuthSession(DESKTOP_UI_MODE)) return null;
  const sessionPath = getDesktopAuthSessionPath();
  const encryptedSession = readDesktopAuthSession(sessionPath, safeStorage);
  if (encryptedSession) return encryptedSession;

  // 1.1.18 builds written before encrypted desktop-session persistence already
  // synchronized their verified cloud token to the local Kernel auth store.
  // Migrate that record once so the upgrade itself does not require another click.
  const legacySession = readJson(getLegacyKernelCloudAuthPath());
  if (!legacySession?.accessToken) return null;
  try {
    saveDesktopAuthSession(sessionPath, safeStorage, legacySession);
    return readDesktopAuthSession(sessionPath, safeStorage);
  } catch {
    return null;
  }
});

ipcMain.handle('desktop:save-auth-session', (event, payload = {}) => {
  if (!isTrustedHostedRenderer(event)) return false;
  if (!shouldUseKeychainAuthSession(DESKTOP_UI_MODE)) return false;
  return saveDesktopAuthSession(getDesktopAuthSessionPath(), safeStorage, payload);
});

ipcMain.handle('desktop:clear-auth-session', (event) => {
  if (!isTrustedHostedRenderer(event)) return false;
  clearDesktopAuthSession(getDesktopAuthSessionPath());
  return true;
});

ipcMain.handle('desktop:get-update-state', (event) => {
  if (!isTrustedHostedRenderer(event)) return null;
  return desktopUpdater?.getState() || null;
});

ipcMain.handle('desktop:check-for-updates', async (event) => {
  if (!isTrustedHostedRenderer(event)) {
    throw new Error('不受信任的页面无法检查桌面更新');
  }
  return desktopUpdater?.check() || null;
});

ipcMain.handle('desktop:download-and-install-update', async (event) => {
  if (!isTrustedHostedRenderer(event)) {
    throw new Error('不受信任的页面无法安装桌面更新');
  }
  if (!desktopUpdater) throw new Error('桌面更新器尚未初始化');
  return desktopUpdater.downloadAndInstall();
});

function resolveBundledClaudeExecutable() {
  const { runtimeRoot } = verifyBundledKernel();
  const executableName = process.platform === 'win32' ? 'claude.exe' : 'claude';
  return resolveRuntimeAsset(
    runtimeRoot,
    path.join(
      'node_modules',
      '@anthropic-ai',
      `claude-agent-sdk-${process.platform}-${process.arch}`,
      executableName,
    ),
    'Claude CLI',
  );
}

async function startBundledClaudeLogin() {
  if (cliLoginProcess && cliLoginProcess.exitCode === null) {
    return { ok: false, error: 'Claude 登录正在进行中，请在浏览器中完成授权。' };
  }

  const executablePath = resolveBundledClaudeExecutable();
  const child = spawn(executablePath, ['auth', 'login', '--claudeai'], {
    cwd: app.getPath('home'),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CLAUDECODE: '',
      ...(process.platform === 'darwin' ? { BROWSER: 'true' } : {}),
    },
  });
  cliLoginProcess = child;
  logDesktop('Starting bundled Claude OAuth login', { pid: child.pid });

  let outputBuffer = '';
  let openedAuthUrl = false;
  const inspectOutput = (chunk) => {
    outputBuffer = `${outputBuffer}${chunk.toString()}`.slice(-16_384);
    if (openedAuthUrl) return;
    const authUrl = findTrustedClaudeAuthUrl(outputBuffer);
    if (!authUrl) return;
    openedAuthUrl = true;
    void shell.openExternal(authUrl).catch((error) => {
      logDesktop('Failed to open Claude OAuth URL', error instanceof Error ? error.message : String(error));
    });
  };
  child.stdout?.on('data', inspectOutput);
  child.stderr?.on('data', inspectOutput);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (cliLoginProcess === child) cliLoginProcess = null;
      resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish({ ok: false, error: 'Claude 登录等待超时，请重试。' });
    }, 10 * 60 * 1000);

    child.once('error', (error) => {
      logDesktop('Bundled Claude OAuth login failed to start', error instanceof Error ? error.message : String(error));
      finish({ ok: false, error: `无法启动 Claude 登录：${error.message || error}` });
    });
    child.once('exit', (code, signal) => {
      const ok = code === 0;
      logDesktop('Bundled Claude OAuth login finished', { code, signal, openedAuthUrl });
      finish(ok
        ? { ok: true }
        : { ok: false, error: `Claude 登录未完成（${signal || code || 'unknown'}）。` });
    });
  });
}

ipcMain.handle('desktop:start-cli-login', async (event, provider) => {
  if (!isTrustedHostedRenderer(event)) {
    return { ok: false, error: '不受信任的页面无法启动 CLI 登录。' };
  }
  if (provider !== 'claude') {
    return { ok: false, error: `暂不支持此登录方式：${provider || 'unknown'}` };
  }
  try {
    return await startBundledClaudeLogin();
  } catch (error) {
    logDesktop('Bundled Claude OAuth login failed', error instanceof Error ? error.message : String(error));
    return { ok: false, error: error.message || String(error) };
  }
});

function getDesktopNavigationState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { canGoBack: false, canGoForward: false };
  }
  const { navigationHistory } = mainWindow.webContents;
  return {
    canGoBack: navigationHistory.canGoBack(),
    canGoForward: navigationHistory.canGoForward(),
  };
}

function syncDesktopNavigationState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('desktop:navigation-state', getDesktopNavigationState());
}

ipcMain.handle('desktop:navigate-history', (event, direction) => {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    return { canGoBack: false, canGoForward: false };
  }

  const { navigationHistory } = mainWindow.webContents;
  if (direction === 'back' && navigationHistory.canGoBack()) {
    navigationHistory.goBack();
  } else if (direction === 'forward' && navigationHistory.canGoForward()) {
    navigationHistory.goForward();
  }
  return getDesktopNavigationState();
});

ipcMain.handle('desktop:write-clipboard-text', async (_event, text) => {
  clipboard.writeText(typeof text === 'string' ? text : String(text ?? ''));
  return true;
});

ipcMain.handle('desktop:play-completion-sound', async (event) => {
  if (!isTrustedDesktopRenderer(event)) return false;
  if (typeof shell.beep !== 'function') return false;
  shell.beep();
  return true;
});

ipcMain.handle('desktop:show-notification', async (event, payload = {}) => {
  if (!isTrustedDesktopRenderer(event) || !Notification.isSupported()) return false;
  const title = String(payload.title || PRODUCT_NAME).trim().slice(0, 120) || PRODUCT_NAME;
  const body = String(payload.body || '').trim().slice(0, 500);
  const notification = new Notification({ title, body });
  notification.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
  });
  notification.show();
  return true;
});

ipcMain.handle('desktop:save-file', async (_event, payload = {}) => {
  const defaultFileName = sanitizeDownloadFileName(payload.defaultFileName);
  const saveResult = await dialog.showSaveDialog(mainWindow || undefined, {
    defaultPath: path.join(app.getPath('downloads'), defaultFileName),
    filters: [
      { name: 'ZIP Archive', extensions: ['zip'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (saveResult.canceled || !saveResult.filePath) return { canceled: true };
  await fs.promises.writeFile(saveResult.filePath, bufferFromIpcData(payload.data));
  return { canceled: false, filePath: saveResult.filePath };
});

function companionWindowUrl(companionId) {
  const currentUrl = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents.getURL() : getAppRendererOrigin();
  const url = new URL('/desktop-companion', currentUrl || getAppRendererOrigin());
  url.searchParams.set('companionId', companionId);
  return url.toString();
}

function petDirectoryAuthorizationPath() {
  return path.join(app.getPath('userData'), 'pets', 'authorized-directories.json');
}

function readAuthorizedPetDirectories() {
  try {
    const parsed = JSON.parse(fs.readFileSync(petDirectoryAuthorizationPath(), 'utf8'));
    return new Set(Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : []);
  } catch {
    return new Set();
  }
}

function authorizePetDirectory(directory) {
  const authorized = readAuthorizedPetDirectories();
  authorized.add(directory);
  const filePath = petDirectoryAuthorizationPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify([...authorized].sort(), null, 2), 'utf8');
}

async function loadAuthorizedPetAsset(directory) {
  const resolved = await fs.promises.realpath(String(directory || ''));
  if (!readAuthorizedPetDirectories().has(resolved)) {
    throw new Error('请先从桌面伙伴设置中选择并授权这个宠物目录。');
  }
  return loadCodexPetAsset(resolved);
}

function createCompanionWindow(spec, index) {
  const window = new BrowserWindow({
    width: 210,
    height: 250,
    x: 36 + (index % 5) * 42,
    y: 96 + (index % 5) * 36,
    minWidth: 180,
    minHeight: 220,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    show: false,
    title: spec.name || 'MedHelp Companion',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      additionalArguments: [
        `--medhelp-app-version=${DESKTOP_APP_VERSION}`,
        `--medhelp-cloud-app-origin=${CLOUD_APP_ORIGIN}`,
        `--medhelp-desktop-ui-mode=${DESKTOP_UI_MODE}`,
      ],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });
  companionWindows.set(spec.id, window);
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, targetUrl) => {
    const target = new URL(targetUrl);
    if (!isAppRendererOrigin(target.toString()) || target.pathname !== '/desktop-companion') {
      event.preventDefault();
    }
  });
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.showInactive();
  });
  window.on('closed', () => companionWindows.delete(spec.id));
  void window.loadURL(companionWindowUrl(spec.id));
  return window;
}

ipcMain.handle('desktop:sync-companion-windows', async (event, specs = []) => {
  if (!isTrustedHostedRenderer(event) || !Array.isArray(specs)) return false;
  const enabled = specs.filter((spec) => (
    spec && spec.enabled === true && typeof spec.id === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(spec.id)
  ));
  const desiredIds = new Set(enabled.map((spec) => spec.id));
  for (const [id, window] of companionWindows) {
    if (!desiredIds.has(id)) {
      companionWindows.delete(id);
      if (!window.isDestroyed()) window.close();
    }
  }
  enabled.forEach((spec, index) => {
    const existing = companionWindows.get(spec.id);
    if (existing && !existing.isDestroyed()) {
      existing.setTitle(String(spec.name || 'MedHelp Companion'));
      existing.webContents.reloadIgnoringCache();
      if (!existing.isVisible()) existing.showInactive();
      return;
    }
    createCompanionWindow(spec, index);
  });
  return true;
});

ipcMain.handle('desktop:choose-pet-directory', async (event) => {
  if (!isTrustedHostedRenderer(event)) throw new Error('Untrusted pet directory request.');
  const result = await dialog.showOpenDialog(mainWindow || undefined, {
    title: '选择 Codex v2 桌面宠物目录',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const directory = await fs.promises.realpath(result.filePaths[0]);
  const asset = await loadCodexPetAsset(directory);
  authorizePetDirectory(directory);
  return { canceled: false, directory, asset };
});

ipcMain.handle('desktop:load-pet-asset', async (event, directory) => {
  if (!isTrustedHostedRenderer(event) && !isTrustedCompanionRenderer(event)) {
    throw new Error('Untrusted pet asset request.');
  }
  return loadAuthorizedPetAsset(directory);
});

ipcMain.handle('desktop:focus-main-window', async (event, tab = 'companions') => {
  if (!isTrustedHostedRenderer(event) && !isTrustedCompanionRenderer(event)) return false;
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (tab === 'companions' || tab === 'miniApps') {
    mainWindow.webContents.send('desktop:open-app-tab', tab);
  }
  return true;
});

function resolveIconPath() {
  const candidates = [
    path.join(appRoot, 'assets', 'app-icon.png'),
    path.join(appRoot, 'public', 'icons', 'app-icon.png'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function resolveTrayIconPath() {
  const candidates = [
    path.join(appRoot, 'assets', 'app-icon.ico'),
    path.join(appRoot, 'assets', 'app-icon.png'),
    path.join(appRoot, 'public', 'icons', 'app-icon.ico'),
    path.join(appRoot, 'public', 'icons', 'app-icon.png'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

function createTrayIcon(iconPath) {
  if (process.platform !== 'darwin') return iconPath;

  const sourceIcon = nativeImage.createFromPath(iconPath);
  if (sourceIcon.isEmpty()) return null;

  // macOS uses the image's intrinsic size for menu bar tray items. Passing the
  // 1024px application artwork directly makes it overflow across the menu bar.
  return sourceIcon.resize({
    width: MACOS_TRAY_ICON_SIZE,
    height: MACOS_TRAY_ICON_SIZE,
    quality: 'best',
  });
}

function createDesktopTray() {
  if (tray) return tray;
  const iconPath = resolveTrayIconPath();
  if (!iconPath) {
    logDesktop('Desktop tray icon is missing');
    return null;
  }

  const trayIcon = createTrayIcon(iconPath);
  if (!trayIcon) {
    logDesktop(`Desktop tray icon could not be loaded: ${iconPath}`);
    return null;
  }

  tray = new Tray(trayIcon);
  tray.setToolTip(`MedHelp v${DESKTOP_APP_VERSION}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `MedHelp v${DESKTOP_APP_VERSION}`, enabled: false },
    { type: 'separator' },
    { label: '打开 MedHelp', click: () => focusMainWindow() },
    { label: '退出 MedHelp', click: () => requestDesktopCloseConfirmation() },
  ]));
  tray.on('click', () => focusMainWindow());
  tray.on('double-click', () => focusMainWindow());
  return tray;
}

async function createMainWindow() {
  const savedState = loadWindowState();
  const windowOptions = {
    width: savedState?.width || DEFAULT_WIDTH,
    height: savedState?.height || DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    autoHideMenuBar: true,
    show: false,
    center: !savedState,
    title: WINDOW_TITLE,
    icon: resolveIconPath(),
    ...getDesktopWindowChromeOptions(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      additionalArguments: [
        `--medhelp-app-version=${DESKTOP_APP_VERSION}`,
        `--medhelp-cloud-app-origin=${CLOUD_APP_ORIGIN}`,
        `--medhelp-desktop-ui-mode=${DESKTOP_UI_MODE}`,
      ],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      backgroundThrottling: false,
    },
  };
  if (savedState?.x != null && savedState?.y != null) {
    windowOptions.x = savedState.x;
    windowOptions.y = savedState.y;
  }

  mainWindow = new BrowserWindow(windowOptions);
  syncDesktopWindowChrome(mainWindow);
  if (savedState?.isMaximized) mainWindow.maximize();
  ensureWindowVisible(mainWindow);
  wireNavigation(mainWindow);
  installHostedAppPermissionHandlers(mainWindow.webContents.session);

  mainWindow.on('move', () => scheduleWindowStateSave(mainWindow));
  mainWindow.on('resize', () => scheduleWindowStateSave(mainWindow));
  mainWindow.on('maximize', () => scheduleWindowStateSave(mainWindow));
  mainWindow.on('unmaximize', () => scheduleWindowStateSave(mainWindow));
  mainWindow.webContents.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow.setTitle('MedHelp');
  });
  mainWindow.on('close', (event) => {
    saveWindowState(mainWindow);
    if (!isQuitting) {
      event.preventDefault();
      closeConfirmationPending = false;
      mainWindow.webContents.send('desktop:dismiss-close-confirmation');
      mainWindow.setSkipTaskbar(true);
      mainWindow.hide();
      logDesktop('Main window hidden to system tray from close button');
    }
  });
  mainWindow.on('closed', () => {
    closeConfirmationPending = false;
    rendererMode = 'none';
    mainWindow = null;
  });
  mainWindow.webContents.on('did-finish-load', () => {
    clearRendererUnresponsiveTimer();
    closeConfirmationPending = false;
    syncDesktopNavigationState();
    if (kernelRuntime?.httpUrl) {
      void syncKernelEndpointToWindow(mainWindow, kernelRuntime.httpUrl);
    }
  });
  mainWindow.webContents.on('did-navigate', syncDesktopNavigationState);
  mainWindow.webContents.on('did-navigate-in-page', syncDesktopNavigationState);
  mainWindow.webContents.on('did-fail-load', (
    _event,
    errorCode,
    errorDescription,
    validatedURL,
    isMainFrame,
  ) => {
    if (errorCode === -3 || isMainFrame === false) return;
    void recoverMainRenderer('did-fail-load', {
      errorCode,
      errorDescription,
      url: validatedURL,
    });
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    void recoverMainRenderer('render-process-gone', {
      crashReason: details?.reason || 'unknown',
      exitCode: details?.exitCode ?? null,
    });
  });
  mainWindow.on('unresponsive', () => {
    if (rendererUnresponsiveTimer) return;
    logDesktop('Desktop Renderer became unresponsive');
    rendererUnresponsiveTimer = setTimeout(() => {
      rendererUnresponsiveTimer = null;
      if (!mainWindow || mainWindow.isDestroyed()) return;
      logDesktop('Desktop Renderer remained unresponsive; forcing bounded recovery');
      mainWindow.webContents.forcefullyCrashRenderer();
    }, RENDERER_UNRESPONSIVE_TIMEOUT_MS);
    rendererUnresponsiveTimer.unref?.();
  });
  mainWindow.on('responsive', clearRendererUnresponsiveTimer);

  rendererMode = 'shell';
  await mainWindow.loadFile(RUNTIME_SHELL_PATH);
  if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
  return mainWindow;
}

async function loadDesktopApp(localKernelUrl) {
  if (isQuitting || !mainWindow || mainWindow.isDestroyed()) return null;
  const hostedUrl = buildHostedAppUrl(localKernelUrl);
  rendererMode = 'loading-app';
  logDesktop(`Loading ${DESKTOP_UI_MODE} MedHelp app`, { url: hostedUrl, kernelUrl: localKernelUrl });
  try {
    await mainWindow.loadURL(hostedUrl);
    if (isQuitting || !mainWindow || mainWindow.isDestroyed()) return null;
    await syncKernelEndpointToWindow(mainWindow, localKernelUrl);
    const readiness = await waitForHostedUiReady(mainWindow);
    if (!readiness?.ready) {
      const timeoutAction = resolveHostedUiTimeout({
        kernelReady: Boolean(localKernelUrl),
        rendererLoaded: !mainWindow.webContents.isLoadingMainFrame(),
        allowRuntimeUnavailable: !localKernelUrl,
      });
      if (timeoutAction !== 'show-loaded-app') {
        throw new Error(`MedHelp 页面加载未完成：${timeoutAction}`);
      }
      // startBundledKernel() has already completed its own health check. A slow
      // renderer must not be replaced with a false "local engine failed" page;
      // show the loaded app and let its normal background checks finish.
      logDesktop('Hosted UI is still initializing; showing the loaded app', readiness);
    }
    rendererMode = 'app';
    clearTimeout(appShellFailOpenTimer);
    appShellFailOpenTimer = null;
  } catch (error) {
    logDesktop('Hosted MedHelp app failed to load', error instanceof Error ? error.message : String(error));
    if (isQuitting || !mainWindow || mainWindow.isDestroyed()) return null;
    getRuntimeSupervisor().degrade(
      'renderer_load_failed',
      `应用页面加载失败：${error instanceof Error ? error.message : String(error)}`,
    );
    rendererMode = 'shell';
    await mainWindow.loadFile(RUNTIME_SHELL_PATH);
  }
  return mainWindow;
}

function navigateToDesktopApp(localKernelUrl) {
  if (isQuitting || !mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve(null);
  }
  if (rendererMode === 'app') {
    return syncKernelEndpointToWindow(mainWindow, localKernelUrl).then(() => mainWindow);
  }
  if (appNavigationPromise) return appNavigationPromise;

  const navigation = loadDesktopApp(localKernelUrl);
  const trackedNavigation = navigation.finally(() => {
    if (appNavigationPromise === trackedNavigation) {
      appNavigationPromise = null;
    }
  });
  appNavigationPromise = trackedNavigation;
  return trackedNavigation;
}

async function failOpenToDesktopApp(reason = 'runtime-unavailable') {
  if (isQuitting || !mainWindow || mainWindow.isDestroyed() || rendererMode === 'app') return mainWindow;
  try {
    await ensureDesktopAppRendererServer();
    logDesktop('Entering fail-open desktop AppShell', { reason, mode: DESKTOP_UI_MODE });
    getRuntimeStateJournal().recordEvent('app_shell_fail_open', { reason, mode: DESKTOP_UI_MODE });
    return await navigateToDesktopApp(null);
  } catch (error) {
    logDesktop('Fail-open AppShell could not be loaded; keeping static recovery shell', error instanceof Error
      ? error.message
      : String(error));
    return mainWindow;
  }
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setSkipTaskbar(false);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function requestDesktopCloseConfirmation() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    app.quit();
    return;
  }

  focusMainWindow();
  if (closeConfirmationPending) return;
  closeConfirmationPending = true;
  mainWindow.webContents.send('desktop:confirm-close-requested');
  logDesktop('Tray exit requested; showing confirmation in the desktop page');
}

function clearRendererUnresponsiveTimer() {
  clearTimeout(rendererUnresponsiveTimer);
  rendererUnresponsiveTimer = null;
}

async function recoverMainRenderer(reason, details = {}) {
  if (isQuitting || rendererRecoveryInFlight || !mainWindow || mainWindow.isDestroyed()) return;
  rendererRecoveryInFlight = true;
  clearRendererUnresponsiveTimer();
  const decision = getRendererRecoveryPolicy().registerFailure();
  logDesktop('Recovering failed desktop Renderer', { reason, ...details, ...decision });
  try {
    getRuntimeStateJournal().recordEvent('renderer_failed', { reason, ...details, ...decision });
  } catch {
    // The static recovery shell must still be attempted if journaling fails.
  }

  try {
    rendererMode = 'shell';
    await mainWindow.loadFile(RUNTIME_SHELL_PATH);
    if (isQuitting || !decision.autoReloadAllowed) return;
    setTimeout(async () => {
      if (isQuitting || !mainWindow || mainWindow.isDestroyed()) return;
      const status = await getRuntimeSupervisor().getStatus();
      if ([RUNTIME_STATUS.RUNNING, RUNTIME_STATUS.DEGRADED].includes(status.status) && status.baseUrl) {
        await navigateToDesktopApp(status.baseUrl);
      } else {
        await failOpenToDesktopApp('renderer-auto-recovery');
      }
    }, 750).unref?.();
  } catch (error) {
    logDesktop('Static Renderer recovery shell failed to load', error instanceof Error ? error.message : String(error));
  } finally {
    rendererRecoveryInFlight = false;
  }
}

async function bootstrap() {
  try {
    await app.whenReady();
    await createMainWindow();
    appShellFailOpenTimer = setTimeout(() => {
      void failOpenToDesktopApp('boot-deadline-exceeded');
    }, APP_SHELL_FAIL_OPEN_MS);
    appShellFailOpenTimer.unref?.();
    ensureWindowsLaunchShortcuts();
    setTimeout(ensureWindowsLaunchShortcuts, 5_000).unref();
    setTimeout(ensureWindowsLaunchShortcuts, 15_000).unref();
    desktopUpdater = createDesktopAppUpdater({
      app,
      baseUrl: CLOUD_APP_ORIGIN,
      log: logDesktop,
      onStateChange: broadcastDesktopUpdateState,
      install: queueDesktopInstaller,
    });
    installDesktopApplicationMenu();
    createDesktopTray();
    powerMonitor.on('resume', () => {
      logDesktop('System resumed; rechecking Runtime health');
      void getRuntimeSupervisor().checkHealth('system-resume');
      if (rendererMode === 'app' && kernelRuntime?.httpUrl) {
        void syncKernelEndpointToWindow(mainWindow, kernelRuntime.httpUrl);
      }
    });
    runtimeStartAttempted = true;
    await getRuntimeSupervisor().start('app-start');
    if (isQuitting) return;
    desktopUpdater.start();
    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createMainWindow();
        const status = await getRuntimeSupervisor().getStatus();
        if ([RUNTIME_STATUS.RUNNING, RUNTIME_STATUS.DEGRADED].includes(status.status) && status.baseUrl) {
          await navigateToDesktopApp(status.baseUrl);
        } else if ([RUNTIME_STATUS.STOPPED, RUNTIME_STATUS.ERROR, RUNTIME_STATUS.MISSING].includes(status.status)) {
          await getRuntimeSupervisor().start('app-activate');
        }
      } else {
        focusMainWindow();
      }
    });
  } catch (error) {
    logDesktop('Failed to start MedHelp Desktop', error instanceof Error
      ? { message: error.message, stack: error.stack }
      : String(error));
    dialog.showErrorBox('MedHelp 启动失败', `${error?.message || error}\n\n日志：${getDesktopLogPath()}`);
    await runtimeSupervisor?.stop('bootstrap-failed');
    await offlineUiServer?.close();
    offlineUiServer = null;
    app.exit(1);
  }
}

app.on('second-instance', (_event, commandLine) => {
  if (commandLine.includes(PREPARE_FOR_UPDATE_SWITCH)) {
    logDesktop('Installer requested a graceful desktop shutdown');
    app.quit();
    return;
  }
  focusMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;
  clearTimeout(appShellFailOpenTimer);
  appShellFailOpenTimer = null;
  clearRendererUnresponsiveTimer();
  runtimeRestartCoordinator?.dispose();
  setKeepAwakeForActiveWork(false);
  saveWindowState(mainWindow);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  if (cliLoginProcess && cliLoginProcess.exitCode === null) {
    cliLoginProcess.kill();
    cliLoginProcess = null;
  }
  desktopUpdater?.stop();
  Promise.all([
    runtimeSupervisor?.stop('app-quit') || stopBundledKernel(),
    offlineUiServer?.close(),
  ]).finally(() => {
    offlineUiServer = null;
    try {
      launchPendingDesktopInstaller();
    } catch (error) {
      logDesktop('Failed to launch desktop installer', error instanceof Error ? error.message : String(error));
    }
    app.exit(0);
  });
});

bootstrap();
