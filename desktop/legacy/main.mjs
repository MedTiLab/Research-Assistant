import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Notification,
  powerMonitor,
  powerSaveBlocker,
  screen,
  shell,
} from 'electron';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  resolveAppDataRoot,
  resolveAppDatabasePath,
  resolveDesktopLogFallbackPath,
  resolveLegacyDatabasePaths,
} from '../../server/utils/storagePaths.js';
import {
  getDesktopWindowChromeOptions,
  installDesktopApplicationMenu,
  syncDesktopWindowChrome,
} from '../common/windowChrome.mjs';
import { RuntimeSupervisor, RUNTIME_STATUS } from '../common/runtimeSupervisor.mjs';
import { createRendererRecoveryPolicy } from '../common/rendererRecovery.mjs';
import { createRuntimeRestartCoordinator } from '../common/runtimeRestartCoordinator.mjs';
import { createRuntimeStateJournal } from '../common/runtimeStateJournal.mjs';
import {
  createSupervisedLegacyRuntime,
  probeLegacyRuntime,
  resolveLegacyRuntimeMode,
} from './legacyRuntime.mjs';
import { isRuntimeAppUrl, resolveRuntimeAppUrl } from './runtimeNavigation.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');
const DESKTOP_ICON_PATH = path.join(projectRoot, 'public', 'icons', 'app-icon.png');
const RUNTIME_SHELL_PATH = path.join(__dirname, '../common/runtime-shell.html');

const PRODUCT_NAME = 'MedHelp';
const APP_ID = 'com.yzglab.medhelpsec';
const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 960;
const MIN_WIDTH = 1100;
const MIN_HEIGHT = 720;
const SERVER_WAIT_TIMEOUT_MS = 30_000;
const WINDOW_STATE_SAVE_DELAY_MS = 250;
const RENDERER_UNRESPONSIVE_TIMEOUT_MS = 15_000;
const LEGACY_WORKSPACE_ROOTS = ['dr-claw', 'vibelab'];

process.env.HOST ??= '127.0.0.1';
process.env.PORT ??= '3001';
process.env.MEDHELP_DESKTOP = '1';

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
let serverModulePromise = null;
let runtimeSupervisor = null;
let isQuitting = false;
let saveWindowStateTimer = null;
let desktopEnvironmentPrepared = false;
let rendererMode = 'none';
let runtimeNavigationPromise = null;
let runtimeRestartCoordinator = null;
let runtimeStateJournal = null;
let rendererRecoveryPolicy = null;
let rendererRecoveryInFlight = false;
let rendererUnresponsiveTimer = null;
let keepAwakeBlockerId = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

ipcMain.handle('desktop:restart-app', async () => {
  logDesktop('Renderer requested app restart');
  app.relaunch();
  app.quit();
});

function assertTrustedRenderer(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    throw new Error('Untrusted desktop IPC sender');
  }
}

ipcMain.handle('desktop:runtime-status', async (event) => {
  assertTrustedRenderer(event);
  return getRuntimeSupervisor().getStatus();
});

ipcMain.handle('desktop:runtime-restart', async (event, options = {}) => {
  assertTrustedRenderer(event);
  const force = options?.force === true;
  logDesktop('Renderer requested Runtime restart', { force });
  return getRuntimeRestartCoordinator().request(
    force ? 'renderer-force-request' : 'renderer-request',
    { force },
  );
});

ipcMain.handle('desktop:runtime-open-diagnostics', async (event) => {
  assertTrustedRenderer(event);
  const status = await getRuntimeSupervisor().getStatus();
  if (status.diagnosticsPath) {
    shell.showItemInFolder(status.diagnosticsPath);
    return true;
  }
  return false;
});

ipcMain.handle('desktop:write-clipboard-text', async (_event, text) => {
  clipboard.writeText(typeof text === 'string' ? text : String(text ?? ''));
  return true;
});

ipcMain.handle('desktop:play-completion-sound', async (event) => {
  assertTrustedRenderer(event);
  if (typeof shell.beep !== 'function') return false;
  shell.beep();
  return true;
});

ipcMain.handle('desktop:show-notification', async (event, payload = {}) => {
  assertTrustedRenderer(event);
  if (!Notification.isSupported()) return false;
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

function sanitizeDesktopDownloadFileName(defaultFileName) {
  const fallbackName = 'download.zip';
  const safeBaseName = path.basename(String(defaultFileName || fallbackName))
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/^\.+/, '')
    .trim();

  return safeBaseName || fallbackName;
}

function bufferFromIpcData(data) {
  if (Buffer.isBuffer(data)) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }

  if (Array.isArray(data)) {
    return Buffer.from(data);
  }

  throw new Error('Invalid file data');
}

ipcMain.handle('desktop:save-file', async (_event, payload = {}) => {
  const defaultFileName = sanitizeDesktopDownloadFileName(payload.defaultFileName);
  const saveResult = await dialog.showSaveDialog(mainWindow || undefined, {
    defaultPath: path.join(app.getPath('downloads'), defaultFileName),
    filters: [
      { name: 'ZIP Archive', extensions: ['zip'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return { canceled: true };
  }

  await fs.promises.writeFile(saveResult.filePath, bufferFromIpcData(payload.data));
  return { canceled: false, filePath: saveResult.filePath };
});

function getDesktopLogPath() {
  const baseDir = app.isReady()
    ? app.getPath('userData')
    : path.dirname(resolveDesktopLogFallbackPath());
  return path.join(baseDir, 'desktop.log');
}

function logDesktop(message, details = null) {
  const suffix = details == null
    ? ''
    : ` ${typeof details === 'string' ? details : JSON.stringify(details)}`;
  const line = `[${new Date().toISOString()}] ${message}${suffix}`;
  console.log(line);

  try {
    fs.mkdirSync(path.dirname(getDesktopLogPath()), { recursive: true });
    fs.appendFileSync(getDesktopLogPath(), `${line}\n`, 'utf8');
  } catch {
    // Ignore log persistence failures.
  }
}

function getRuntimeStateJournal() {
  if (!runtimeStateJournal) {
    runtimeStateJournal = createRuntimeStateJournal({
      filePath: path.join(app.getPath('userData'), 'runtime', 'legacy-runtime-state.json'),
    });
  }
  return runtimeStateJournal;
}

function getRendererRecoveryPolicy() {
  if (!rendererRecoveryPolicy) {
    rendererRecoveryPolicy = createRendererRecoveryPolicy({
      filePath: path.join(app.getPath('userData'), 'runtime', 'legacy-renderer-failures.json'),
    });
  }
  return rendererRecoveryPolicy;
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

function getWindowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try {
    const raw = fs.readFileSync(getWindowStatePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
      return parsed;
    }
  } catch {
    // First launch or invalid state file.
  }

  return null;
}

function saveWindowState(window) {
  if (!window || window.isDestroyed()) {
    return;
  }

  const bounds = window.getBounds();
  const state = {
    ...bounds,
    isMaximized: window.isMaximized(),
  };

  try {
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(state), 'utf8');
  } catch (error) {
    logDesktop('Failed to save window state', error instanceof Error ? error.message : String(error));
  }
}

function scheduleWindowStateSave(window) {
  if (saveWindowStateTimer) {
    clearTimeout(saveWindowStateTimer);
  }

  saveWindowStateTimer = setTimeout(() => {
    saveWindowState(window);
    saveWindowStateTimer = null;
  }, WINDOW_STATE_SAVE_DELAY_MS);
}

function isWindowVisible(bounds) {
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapWidth = Math.max(
      0,
      Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x),
    );
    const overlapHeight = Math.max(
      0,
      Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y),
    );

    return overlapWidth >= 240 && overlapHeight >= 180;
  });
}

function ensureWindowVisible(window) {
  if (!window || window.isDestroyed()) {
    return;
  }

  const bounds = window.getBounds();
  if (isWindowVisible(bounds)) {
    return;
  }

  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.min(Math.max(bounds.width || DEFAULT_WIDTH, MIN_WIDTH), Math.max(workArea.width - 48, MIN_WIDTH));
  const height = Math.min(Math.max(bounds.height || DEFAULT_HEIGHT, MIN_HEIGHT), Math.max(workArea.height - 64, MIN_HEIGHT));

  window.setBounds({
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = SERVER_WAIT_TIMEOUT_MS) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        return;
      }
      lastError = new Error(`Unexpected health status ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await wait(500);
  }

  throw new Error(`Timed out waiting for local server at ${url}${lastError ? `: ${lastError.message}` : ''}`);
}

function resolveSharedDatabasePath(workspacesRoot) {
  const currentDbPath = resolveAppDatabasePath({
    dataDir: resolveAppDataRoot({ workspacesRoot }),
  });
  const currentSidecars = [`${currentDbPath}-shm`, `${currentDbPath}-wal`];

  if (fs.existsSync(currentDbPath)) {
    return currentDbPath;
  }

  const legacyDbPath = resolveLegacyDatabasePaths(app.getPath('home'))
    .find((candidatePath) => fs.existsSync(candidatePath));

  if (!legacyDbPath) {
    return currentDbPath;
  }

  const legacySidecars = [`${legacyDbPath}-shm`, `${legacyDbPath}-wal`];

  try {
    fs.mkdirSync(path.dirname(currentDbPath), { recursive: true });
    fs.copyFileSync(legacyDbPath, currentDbPath);

    legacySidecars.forEach((legacySidecar, index) => {
      if (fs.existsSync(legacySidecar) && !fs.existsSync(currentSidecars[index])) {
        fs.copyFileSync(legacySidecar, currentSidecars[index]);
      }
    });

    logDesktop('Migrated legacy auth database', { from: legacyDbPath, to: currentDbPath });
    return currentDbPath;
  } catch (error) {
    logDesktop('Failed to migrate legacy auth DB, using legacy path', error instanceof Error ? error.message : String(error));
    return legacyDbPath;
  }
}

function resolveSharedWorkspacesRoot() {
  const homeDir = app.getPath('home');
  const currentRoot = path.join(homeDir, 'medhelpsec');

  if (fs.existsSync(currentRoot)) {
    return currentRoot;
  }

  const legacyRoot = LEGACY_WORKSPACE_ROOTS
    .map((legacyRootName) => path.join(homeDir, legacyRootName))
    .find((candidatePath) => fs.existsSync(candidatePath));

  return legacyRoot || currentRoot;
}

function bootstrapDesktopEnvironment() {
  if (desktopEnvironmentPrepared) {
    return;
  }

  const workspacesRoot = process.env.WORKSPACES_ROOT || resolveSharedWorkspacesRoot();
  const dataRoot = resolveAppDataRoot({ workspacesRoot });
  const runtimeDir = path.join(dataRoot, 'runtime');
  const databasePath = process.env.DATABASE_PATH || resolveSharedDatabasePath(workspacesRoot);

  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  fs.mkdirSync(workspacesRoot, { recursive: true });

  process.env.DATABASE_PATH = databasePath;
  process.env.WORKSPACES_ROOT = workspacesRoot;
  process.env.MEDHELP_DATA_DIR = process.env.MEDHELP_DATA_DIR || dataRoot;
  process.env.MEDHELP_RUNTIME_DIR = process.env.MEDHELP_RUNTIME_DIR || runtimeDir;
  process.env.DR_CLAW_RUNTIME_DIR = process.env.DR_CLAW_RUNTIME_DIR || process.env.MEDHELP_RUNTIME_DIR;
  desktopEnvironmentPrepared = true;

  logDesktop('Desktop environment prepared', {
    databasePath,
    dataRoot,
    workspacesRoot,
    runtimeDir: process.env.MEDHELP_RUNTIME_DIR,
  });
}

async function loadServerModule() {
  if (!serverModulePromise) {
    bootstrapDesktopEnvironment();
    serverModulePromise = import(pathToFileURL(path.join(projectRoot, 'server/index.js')).href);
  }

  return serverModulePromise;
}

function getRuntimeSupervisor() {
  if (runtimeSupervisor) {
    return runtimeSupervisor;
  }

  bootstrapDesktopEnvironment();
  const runtimeMode = resolveLegacyRuntimeMode(process.env);
  const supervisedLogPath = path.join(app.getPath('userData'), 'legacy-runtime.log');
  let runtimeController;

  if (runtimeMode === 'supervised') {
    runtimeController = createSupervisedLegacyRuntime({
      projectRoot,
      runtimeFile: path.join(process.env.MEDHELP_RUNTIME_DIR, 'legacy-supervised-ports.json'),
      logPath: supervisedLogPath,
    });
  } else {
    runtimeController = {
      async start() {
        const serverModule = await loadServerModule();
        const { activePort } = await serverModule.startServer();
        const baseUrl = `http://127.0.0.1:${activePort}`;
        await waitForServer(`${baseUrl}/health`);
        return {
          pid: process.pid,
          baseUrl,
          startedAt: new Date().toISOString(),
        };
      },
      async stop() {
        const serverModule = await loadServerModule();
        await serverModule.stopServer?.();
      },
    };
  }

  runtimeSupervisor = new RuntimeSupervisor({
    startRuntime: (options) => runtimeController.start(options),
    stopRuntime: (runtime, options) => runtimeController.stop(runtime, options),
    probeRuntime: (runtime) => probeLegacyRuntime(runtime),
    onHealth: (health) => {
      if (health?.healthy) {
        setKeepAwakeForActiveWork(health.agentBusy === true);
      }
    },
    diagnosticsPath: runtimeMode === 'supervised' ? supervisedLogPath : getDesktopLogPath(),
  });
  runtimeSupervisor.onStatus((status) => {
    logDesktop('Runtime status changed', status);
    try {
      getRuntimeStateJournal().recordStatus(status);
    } catch (error) {
      logDesktop('Failed to persist Runtime status journal', error instanceof Error ? error.message : String(error));
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('desktop:runtime-status-changed', status);
      if ([RUNTIME_STATUS.RUNNING, RUNTIME_STATUS.DEGRADED].includes(status.status) && status.baseUrl) {
        void navigateToRuntimeApp(status.baseUrl, { preserveRoute: rendererMode === 'app' });
      }
    }
    if (![RUNTIME_STATUS.RUNNING, RUNTIME_STATUS.DEGRADED].includes(status.status)) {
      setKeepAwakeForActiveWork(false);
    }
  });
  logDesktop('Runtime Supervisor initialized', { mode: runtimeMode });
  return runtimeSupervisor;
}

async function isRuntimeBusy(status) {
  if (!status?.baseUrl) return false;
  const health = await probeLegacyRuntime(status.baseUrl);
  return health.healthy && health.agentBusy === true;
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

async function stopBackend() {
  try {
    await runtimeSupervisor?.stop('desktop-quit');
  } catch (error) {
    logDesktop('Failed to stop backend cleanly', error instanceof Error ? error.message : String(error));
  }
}

function wireExternalNavigation(window) {
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
    shell.openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
}

async function loadRuntimeShell() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  await mainWindow.loadFile(RUNTIME_SHELL_PATH);
  rendererMode = 'boot';
}

async function navigateToRuntimeApp(baseUrl, { preserveRoute = false } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (runtimeNavigationPromise) {
    await runtimeNavigationPromise;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const currentUrl = mainWindow.webContents.getURL();
  if (rendererMode === 'app' && isRuntimeAppUrl(currentUrl, baseUrl)) {
    return;
  }
  const targetUrl = resolveRuntimeAppUrl(baseUrl, currentUrl, { preserveRoute });
  const navigation = (async () => {
    try {
      logDesktop('Loading Runtime application', { url: targetUrl, preserveRoute });
      await mainWindow.loadURL(targetUrl);
      rendererMode = 'app';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logDesktop('Failed to load Runtime application; returning to recovery shell', message);
      await loadRuntimeShell();
      runtimeSupervisor?.degrade('renderer_load_failed', `Runtime is healthy, but the application UI failed to load: ${message}`);
    }
  })();
  const trackedNavigation = navigation.finally(() => {
    if (runtimeNavigationPromise === trackedNavigation) {
      runtimeNavigationPromise = null;
    }
  });
  runtimeNavigationPromise = trackedNavigation;
  await runtimeNavigationPromise;
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
    // Recovery must not depend on journal persistence.
  }

  try {
    await loadRuntimeShell();
    if (!decision.autoReloadAllowed || isQuitting) return;
    setTimeout(async () => {
      if (isQuitting || !mainWindow || mainWindow.isDestroyed()) return;
      const status = await getRuntimeSupervisor().getStatus();
      if ([RUNTIME_STATUS.RUNNING, RUNTIME_STATUS.DEGRADED].includes(status.status) && status.baseUrl) {
        await navigateToRuntimeApp(status.baseUrl, { preserveRoute: false });
      }
    }, 750).unref?.();
  } catch (error) {
    logDesktop('Static Renderer recovery shell failed to load', error instanceof Error ? error.message : String(error));
  } finally {
    rendererRecoveryInFlight = false;
  }
}

async function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }

  const savedState = loadWindowState();
  const windowOptions = {
    width: savedState?.width || DEFAULT_WIDTH,
    height: savedState?.height || DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    autoHideMenuBar: true,
    show: false,
    center: !savedState,
    title: 'MedHelp',
    icon: DESKTOP_ICON_PATH,
    ...getDesktopWindowChromeOptions(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      additionalArguments: [`--medhelp-app-version=${app.getVersion()}`],
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
  if (savedState?.isMaximized) {
    mainWindow.maximize();
  }

  ensureWindowVisible(mainWindow);
  wireExternalNavigation(mainWindow);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('move', () => scheduleWindowStateSave(mainWindow));
  mainWindow.on('resize', () => scheduleWindowStateSave(mainWindow));
  mainWindow.on('maximize', () => scheduleWindowStateSave(mainWindow));
  mainWindow.on('unmaximize', () => scheduleWindowStateSave(mainWindow));
  mainWindow.on('close', () => saveWindowState(mainWindow));
  mainWindow.on('closed', () => {
    mainWindow = null;
    rendererMode = 'none';
  });
  mainWindow.webContents.on('did-finish-load', clearRendererUnresponsiveTimer);
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
    rendererUnresponsiveTimer = setTimeout(() => {
      rendererUnresponsiveTimer = null;
      if (!mainWindow || mainWindow.isDestroyed()) return;
      logDesktop('Desktop Renderer remained unresponsive; forcing bounded recovery');
      mainWindow.webContents.forcefullyCrashRenderer();
    }, RENDERER_UNRESPONSIVE_TIMEOUT_MS);
    rendererUnresponsiveTimer.unref?.();
  });
  mainWindow.on('responsive', clearRendererUnresponsiveTimer);

  logDesktop('Loading stable Runtime shell', { path: RUNTIME_SHELL_PATH });
  await loadRuntimeShell();

  const runtimeStatus = await getRuntimeSupervisor().start('desktop-bootstrap');
  if (runtimeStatus.status === RUNTIME_STATUS.RUNNING && runtimeStatus.baseUrl) {
    await navigateToRuntimeApp(runtimeStatus.baseUrl);
  } else {
    logDesktop('Runtime unavailable; keeping recovery shell visible', runtimeStatus);
  }
  return mainWindow;
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

async function bootstrap() {
  try {
    await app.whenReady();
    installDesktopApplicationMenu();
    await createMainWindow();
    powerMonitor.on('resume', () => {
      logDesktop('System resumed; rechecking Runtime health');
      void getRuntimeSupervisor().checkHealth('system-resume');
    });

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createMainWindow();
        return;
      }

      focusMainWindow();
    });
  } catch (error) {
    logDesktop('Failed to start desktop app', error instanceof Error ? {
      message: error.message,
      stack: error.stack,
    } : String(error));
    dialog.showErrorBox(
      'MedHelp Desktop Failed to Start',
      error?.stack || error?.message || String(error)
    );
    await stopBackend();
    app.exit(1);
  }
}

app.on('second-instance', () => {
  focusMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (isQuitting) {
    return;
  }

  event.preventDefault();
  isQuitting = true;
  clearRendererUnresponsiveTimer();
  runtimeRestartCoordinator?.dispose();
  setKeepAwakeForActiveWork(false);
  saveWindowState(mainWindow);

  stopBackend().finally(() => {
    app.exit(0);
  });
});

bootstrap();
