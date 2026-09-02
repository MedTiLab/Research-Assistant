import crypto from 'crypto';
import express from 'express';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { gatewayDb, userDb, userPreferenceMemoryDb } from '../database/db.js';
import { authenticateToken } from '../middleware/auth.js';
import {
  addProjectManually,
  cleanupUnusedConversationWorkspaces,
  createConversationWorkspace,
  getAllowedDataFolderEntriesFromConfig,
  getProjects,
  getSessions,
  getTrashedProjects,
  getWorkspaceRootFromConfig,
  setAllowedDataFoldersInConfig,
  setWorkspaceRootInConfig,
} from '../projects.js';
import { getCliAuthStatus } from './cli-auth.js';
import piModelsRoutes from './pi-models.js';
import {
  expandWorkspaceInputPath,
  getWorkspaceDisplayPath,
  validateWorkspacePath,
  WORKSPACES_ROOT,
} from './projects.js';
import { resolveAppVersion } from '../utils/appVersion.js';
import {
  WINDOWS_DRIVES_ROOT,
  getFilesystemBrowserDisplayPath,
  getFilesystemBrowserParentPath,
  getWindowsDriveSuggestions,
  isWindowsDriveListPath,
} from '../utils/filesystemBrowser.js';
import { getLocalKernelConfig } from '../utils/webShellMode.js';
import {
  isAllowedLocalKernelOrigin,
  isLocalKernelMode,
  isLoopbackHost,
  resolveLocalKernelHost,
} from '../utils/localKernelRuntime.js';
import { resolveAppDataRoot } from '../utils/storagePaths.js';
import {
  readKernelReleaseManifest,
  resolvePublishedMacKernelUpdate,
  resolvePublishedWindowsKernelUpdate,
} from '../utils/kernelRelease.js';
import {
  getKernelSelfUpdateCapability,
  prepareWindowsKernelUpdate,
  readKernelUpdateStatus,
} from '../utils/kernelUpdater.js';
import {
  authorizeCloudCapability,
  resolveCloudAgentRuntimeEnv,
  resolveCloudUserMemoryContext,
  resolveCloudUserPreferenceContext,
} from '../utils/cloudAgentRuntimeEnv.js';
import {
  buildEnvironmentSetupRuntimeEnv,
  detectEnvironmentSetup,
  getEnvironmentSetupStatus,
  saveEnvironmentSetup,
  validateEnvironmentSetup,
} from '../utils/environmentSetup.js';

const LOCAL_KERNEL_VERSION = resolveAppVersion();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const CLOUD_AUTH_FRESHNESS_MS = Math.max(
  60_000,
  Number.parseInt(process.env.MEDHELP_LOCAL_CLOUD_AUTH_FRESHNESS_MS || '300000', 10) || 300_000,
);
const localSessions = new Map();
const localAuditEvents = [];
const launchTokens = new Map();
let computeRoutesPromise = null;

// Local project files belong to the operating-system user profile. Online
// accounts authorize Kernel access but do not partition the device-local index.
const LOCAL_KERNEL_PROJECT_USER_ID = null;

function generateToken(prefix = '') {
  return `${prefix}${crypto.randomBytes(24).toString('base64url')}`;
}

function getRequestOrigin(req) {
  return req.headers.origin || req.body?.origin || null;
}

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    return header.slice(7);
  }
  return null;
}

function shouldEnforceOnlineCloudAuth() {
  return process.env.MEDHELP_SECURE_DISTRIBUTION === '1'
    && process.env.MEDHELP_LOCAL_PAIRING_SKIP_CLOUD_TOKEN !== '1';
}

function pruneExpiredSessions(now = Date.now()) {
  for (const [token, session] of localSessions.entries()) {
    if (session.expiresAtMs <= now) {
      localSessions.delete(token);
    }
  }
}

function auditLocal(event) {
  localAuditEvents.unshift({
    id: generateToken('loc_evt_'),
    createdAt: new Date().toISOString(),
    ...event,
  });
  if (localAuditEvents.length > 100) {
    localAuditEvents.length = 100;
  }
}

function getCliAuthStorePath() {
  return path.join(resolveAppDataRoot(), 'cloud-auth.json');
}

function normalizeCloudBaseUrl(value, fallbackOrigin) {
  if (shouldEnforceOnlineCloudAuth()) {
    try {
      return new URL(String(process.env.MEDHELP_CLOUD_APP_URL || value || fallbackOrigin)).origin;
    } catch {
      return 'https://app.medtimehelp.com';
    }
  }
  const address = globalThis.__MEDHELP_LOCAL_KERNEL_ADDRESS__ || {};
  const localRuntimeOrigin = `http://${address.host || '127.0.0.1'}:${address.port || 5055}`;
  for (const candidate of [value, fallbackOrigin, localRuntimeOrigin]) {
    try {
      const url = new URL(String(candidate || '').trim());
      if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) {
        return url.origin;
      }
    } catch {
      // Try the next local candidate.
    }
  }
  return localRuntimeOrigin;
}

async function verifyCloudAccessToken({ cloudAccessToken, cloudBaseUrl, cloudUserId = null }) {
  const normalizedCloudBaseUrl = normalizeCloudBaseUrl(cloudBaseUrl, null);
  if (!shouldEnforceOnlineCloudAuth()) {
    return {
      cloudBaseUrl: normalizedCloudBaseUrl,
      user: cloudUserId == null ? null : { id: cloudUserId },
    };
  }
  if (!cloudAccessToken) {
    const error = new Error('Online authentication is required');
    error.statusCode = 401;
    error.code = 'CLOUD_AUTH_REQUIRED';
    throw error;
  }
  let activation;
  try {
    activation = await fetch(`${normalizedCloudBaseUrl}/api/auth/kernel-device/activate`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cloudAccessToken}`,
        'User-Agent': `MedHelp-Local-Kernel/${LOCAL_KERNEL_VERSION}`,
      },
      body: JSON.stringify({ kernelVersion: LOCAL_KERNEL_VERSION, kernelPlatform: process.platform }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    const error = new Error('Unable to reach the online authentication service');
    error.statusCode = 503;
    error.code = 'CLOUD_AUTH_UNAVAILABLE';
    throw error;
  }
  const payload = await activation.json().catch(() => ({}));
  if (!activation.ok || payload?.countedAsDevice !== true) {
    const error = new Error(payload?.error || 'Online authentication was rejected');
    error.statusCode = [401, 403, 409].includes(activation.status) ? activation.status : 502;
    error.code = payload?.code || 'CLOUD_AUTH_REJECTED';
    error.maxDevices = payload?.maxDevices;
    throw error;
  }
  let user = payload.user;
  if (!user?.id) {
    const profileResponse = await fetch(`${normalizedCloudBaseUrl}/api/auth/user`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${cloudAccessToken}` },
      signal: AbortSignal.timeout(8_000),
    });
    const profile = await profileResponse.json().catch(() => ({}));
    if (!profileResponse.ok || !profile?.user?.id) {
      const error = new Error(profile?.error || 'Online identity verification was rejected');
      error.statusCode = [401, 403, 409].includes(profileResponse.status) ? profileResponse.status : 502;
      error.code = profile?.code || 'CLOUD_AUTH_REJECTED';
      throw error;
    }
    user = profile.user;
  }
  if (cloudUserId != null && String(user.id) !== String(cloudUserId)) {
    const error = new Error('Online user does not match the requested local session');
    error.statusCode = 403;
    error.code = 'CLOUD_USER_MISMATCH';
    throw error;
  }
  return {
    cloudBaseUrl: normalizedCloudBaseUrl,
    user,
  };
}

async function writeDesktopCloudAuthStore(payload, fallbackOrigin) {
  const authPath = getCliAuthStorePath();
  const accessToken = typeof payload?.accessToken === 'string' ? payload.accessToken.trim() : '';
  if (!accessToken) {
    const error = new Error('accessToken is required');
    error.statusCode = 400;
    throw error;
  }

  const refreshToken = typeof payload?.refreshToken === 'string' ? payload.refreshToken : null;
  const user = payload?.user && typeof payload.user === 'object' ? payload.user : null;
  const authPayload = {
    savedAt: new Date().toISOString(),
    cloudBaseUrl: normalizeCloudBaseUrl(payload?.cloudBaseUrl, fallbackOrigin),
    accessToken,
    refreshToken,
    tokenType: payload?.tokenType || 'Bearer',
    expiresIn: payload?.expiresIn || null,
    refreshExpiresIn: payload?.refreshExpiresIn || null,
    sessionId: payload?.sessionId || null,
    deviceFingerprint: payload?.deviceFingerprint || null,
    user,
  };

  await fs.mkdir(path.dirname(authPath), { recursive: true });
  await fs.writeFile(authPath, `${JSON.stringify(authPayload, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fs.chmod(authPath, 0o600).catch(() => {});
  return { authPath, user };
}

function requireLocalSession(req, res, options = {}) {
  const session = verifyLocalSessionToken(
    getBearerToken(req),
    req.headers.origin || null,
    options,
  );
  if (!session) {
    res.status(401).json({
      error: 'A current online-authorized local session token is required',
      code: 'LOCAL_SESSION_AUTH_REQUIRED',
    });
    return null;
  }
  return session;
}

function requireLocalControlToken(req, res) {
  const expected = String(globalThis.__MEDHELP_LOCAL_KERNEL_CONTROL_TOKEN__ || '');
  const received = String(req.get('x-medhelp-control-token') || '');
  const valid = expected
    && received
    && Buffer.byteLength(expected) === Buffer.byteLength(received)
    && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
  if (!valid) {
    res.status(401).json({ error: 'Local Kernel control token required' });
    return false;
  }
  return true;
}

function scheduleLocalKernelShutdown(res) {
  res.once('finish', () => {
    setTimeout(() => {
      const requestShutdown = globalThis.__MEDHELP_REQUEST_LOCAL_KERNEL_SHUTDOWN__;
      if (typeof requestShutdown === 'function') {
        void requestShutdown();
      }
    }, 250);
  });
}

async function getLocalWorkspaceRootPayload() {
  const currentRoot = await getWorkspaceRootFromConfig() || WORKSPACES_ROOT;
  const defaultRoot = WORKSPACES_ROOT;
  return {
    path: currentRoot,
    defaultPath: defaultRoot,
    displayPath: getWorkspaceDisplayPath(currentRoot),
    displayRoot: getWorkspaceDisplayPath(currentRoot),
  };
}

async function getLocalDataFoldersSettingsPayload() {
  const entries = await getAllowedDataFolderEntriesFromConfig();
  return {
    workspaceRoot: await getLocalWorkspaceRootPayload(),
    allowedFolders: entries.map((entry) => ({
      path: entry.path,
      displayPath: getWorkspaceDisplayPath(entry.path),
      exists: entry.exists,
    })),
  };
}

async function validateLocalAllowedDataFolders(folderPaths = []) {
  const normalizedPaths = [];
  const seen = new Set();

  if (!Array.isArray(folderPaths)) {
    const error = new Error('folders must be an array');
    error.statusCode = 400;
    throw error;
  }

  if (folderPaths.length > 32) {
    const error = new Error('Too many data folders');
    error.statusCode = 400;
    throw error;
  }

  for (const folderPath of folderPaths) {
    const rawPath = typeof folderPath === 'string' ? folderPath : folderPath?.path;
    const requestedPath = String(rawPath || '').trim();
    if (!requestedPath) {
      continue;
    }

    const absolutePath = path.resolve(expandWorkspaceInputPath(requestedPath));
    const stats = await fs.stat(absolutePath).catch((error) => {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    });
    if (!stats) {
      const error = new Error(`Directory does not exist: ${requestedPath}`);
      error.statusCode = 400;
      throw error;
    }
    if (!stats.isDirectory()) {
      const error = new Error(`Path is not a directory: ${requestedPath}`);
      error.statusCode = 400;
      throw error;
    }

    const validation = await validateWorkspacePath(absolutePath, {
      allowAnySafePath: true,
    });
    if (!validation.valid) {
      const error = new Error(validation.error || `Invalid data folder: ${requestedPath}`);
      error.statusCode = 400;
      throw error;
    }

    const resolvedPath = validation.resolvedPath || absolutePath;
    const normalizedKey = process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
    if (seen.has(normalizedKey)) {
      continue;
    }
    seen.add(normalizedKey);
    normalizedPaths.push(resolvedPath);
  }

  return normalizedPaths;
}

function resolveRequestedReleasePlatform(req) {
  const requested = String(req?.query?.platform || '').trim().toLowerCase();
  if (requested === 'mac' || requested === 'macos' || requested === 'darwin') return 'mac';
  if (requested === 'win' || requested === 'windows' || requested === 'win32') return 'windows';

  const userAgent = String(req?.get?.('user-agent') || '').toLowerCase();
  if (userAgent.includes('macintosh') || userAgent.includes('mac os')) return 'mac';
  return 'windows';
}

function buildLocalKernelReleasePayload(req) {
  const config = getLocalKernelConfig();
  const manifest = readKernelReleaseManifest();
  const publicUrl = process.env.MEDHELP_PUBLIC_URL || process.env.PUBLIC_URL || 'https://app.medtimehelp.com';
  const windowsUpdate = resolvePublishedWindowsKernelUpdate(
    publicUrl,
    manifest,
  );
  const macUpdate = resolvePublishedMacKernelUpdate(publicUrl, manifest);
  const platform = resolveRequestedReleasePlatform(req);
  const selectedUpdate = platform === 'mac' ? macUpdate : windowsUpdate;
  const downloads = { ...(config.downloads || {}) };
  if (macUpdate?.packageUrl) {
    downloads.mac = macUpdate.packageUrl;
    downloads.macNpm = macUpdate.packageUrl;
  }
  if (windowsUpdate?.packageUrl) {
    downloads.win = windowsUpdate.packageUrl;
    downloads.windows = windowsUpdate.packageUrl;
    downloads.windowsNpm = windowsUpdate.packageUrl;
  }
  return {
    ok: true,
    product: 'MedHelp',
    distribution: 'desktop-only',
    desktopDownloadPath: '/download',
    version: selectedUpdate?.version || LOCAL_KERNEL_VERSION,
    platform,
    publishedAt: selectedUpdate?.publishedAt || manifest?.publishedAt || '',
    notes: selectedUpdate?.notes || manifest?.notes || '',
    downloads,
    installCommand: config.installCommand,
    installCommands: config.installCommands || {},
    update: {
      ...(windowsUpdate ? { windows: windowsUpdate } : {}),
      ...(macUpdate ? { mac: macUpdate } : {}),
    },
  };
}

async function browseLocalFilesystem(dirPath, { showHidden = false, purpose = null } = {}) {
  if (isWindowsDriveListPath(dirPath)) {
    return {
      path: WINDOWS_DRIVES_ROOT,
      displayPath: getFilesystemBrowserDisplayPath(WINDOWS_DRIVES_ROOT),
      parentPath: null,
      isVirtualRoot: true,
      drivesRootPath: WINDOWS_DRIVES_ROOT,
      suggestions: await getWindowsDriveSuggestions(),
    };
  }

  const rootPath = await getWorkspaceRootFromConfig() || WORKSPACES_ROOT;
  const isDataFolderBrowse = purpose === 'dataFolder';
  const isLocalFolderBrowse = purpose === 'connectFolder';
  const isUnrestrictedBrowse = isDataFolderBrowse || isLocalFolderBrowse;
  const targetPath = path.resolve(expandWorkspaceInputPath(dirPath || rootPath));
  const isFilesystemRootBrowse = isUnrestrictedBrowse
    && process.platform !== 'win32'
    && targetPath === path.parse(targetPath).root;
  let resolvedPath = targetPath;
  if (!isFilesystemRootBrowse) {
    const validation = await validateWorkspacePath(targetPath, {
      allowUserHome: true,
      allowWindowsDrives: true,
      allowDriveRoot: true,
      allowConfiguredDataFolders: true,
      allowAnySafePath: isUnrestrictedBrowse,
    });
    if (!validation.valid) {
      const error = new Error(validation.error);
      error.statusCode = 403;
      throw error;
    }
    resolvedPath = validation.resolvedPath || targetPath;
  }
  const stats = await fs.stat(resolvedPath).catch((error) => {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  });
  if (!stats) {
    const error = new Error('Directory not accessible');
    error.statusCode = 404;
    throw error;
  }
  if (!stats.isDirectory()) {
    const error = new Error('Path is not a directory');
    error.statusCode = 400;
    throw error;
  }

  const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
  const suggestions = [];

  for (const entry of entries) {
    if (!showHidden && entry.name.startsWith('.')) {
      continue;
    }
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }

    const entryPath = path.join(resolvedPath, entry.name);
    try {
      await fs.access(entryPath);
      suggestions.push({
        path: entryPath,
        displayPath: getWorkspaceDisplayPath(entryPath),
        name: entry.name,
        type: 'directory',
      });
    } catch {
      // Skip folders this local Kernel cannot read.
    }
  }

  suggestions.sort((a, b) => {
    const aHidden = a.name.startsWith('.');
    const bHidden = b.name.startsWith('.');
    if (aHidden && !bHidden) return 1;
    if (!aHidden && bHidden) return -1;
    return a.name.localeCompare(b.name);
  });

  return {
    path: resolvedPath,
    displayPath: getWorkspaceDisplayPath(resolvedPath),
    parentPath: getFilesystemBrowserParentPath(resolvedPath, { boundaryPath: isUnrestrictedBrowse ? null : rootPath }),
    drivesRootPath: process.platform === 'win32' ? WINDOWS_DRIVES_ROOT : null,
    suggestions,
  };
}

function localKernelStatusPayload(session = null) {
  const host = resolveLocalKernelHost();
  const address = globalThis.__MEDHELP_LOCAL_KERNEL_ADDRESS__ || {};
  return {
    ok: true,
    product: 'MedHelp Kernel',
    version: LOCAL_KERNEL_VERSION,
    kernelId: crypto
      .createHash('sha256')
      .update(`${os.hostname()}:${os.platform()}:${os.arch()}`)
      .digest('hex')
      .slice(0, 16),
    sessionActive: Boolean(session),
    permissionMode: session?.permissionMode || null,
    workspaceScope: session?.workspaceScope || null,
    platform: process.platform,
    arch: process.arch,
    updateCapability: getKernelSelfUpdateCapability(),
    host: address.host || host,
    port: address.port || null,
  };
}

function createLocalSession({
  cloudUserId,
  cloudAccessToken = '',
  cloudBaseUrl = null,
  origin,
  browserNonce,
  permissionMode = 'analysis',
  workspaceScope = 'default',
  cloudVerifiedAtMs = 0,
}) {
  const token = generateToken('mh_loc_');
  const expiresAtMs = Date.now() + SESSION_TTL_MS;
  const session = {
    token,
    userId: cloudUserId || null,
    cloudAccessToken,
    cloudBaseUrl: normalizeCloudBaseUrl(cloudBaseUrl, origin),
    origin,
    browserNonce,
    permissionMode,
    workspaceScope,
    cloudVerifiedAtMs,
    expiresAtMs,
    createdAt: new Date().toISOString(),
  };
  localSessions.set(token, session);
  auditLocal({
    type: 'session.started',
    origin,
    permissionMode,
    userId: cloudUserId || null,
  });
  return session;
}

export async function getLocalSessionAgentRuntimeEnv(session, options = {}) {
  const [cloudEnv, setup] = await Promise.all([
    resolveCloudAgentRuntimeEnv(session, options),
    getEnvironmentSetupStatus(),
  ]);
  return {
    ...cloudEnv,
    ...(setup.completed ? buildEnvironmentSetupRuntimeEnv(setup.config) : {}),
  };
}

export function getLocalSessionUserPreferenceContext(session, options = {}) {
  return resolveCloudUserPreferenceContext(session, options);
}

export function getLocalSessionUserMemoryContext(session, options = {}) {
  return resolveCloudUserMemoryContext(session, options);
}

export function authorizeLocalSessionCapability(session, capability) {
  return authorizeCloudCapability(session, capability);
}

export function verifyLocalSessionToken(token, origin = null, { requireFreshCloudAuth = true } = {}) {
  pruneExpiredSessions();
  if (!token) {
    return null;
  }
  const session = localSessions.get(token);
  if (!session) {
    return null;
  }
  if (origin && session.origin && origin !== session.origin) {
    return null;
  }
  if (
    requireFreshCloudAuth
    && shouldEnforceOnlineCloudAuth()
    && Date.now() - Number(session.cloudVerifiedAtMs || 0) > CLOUD_AUTH_FRESHNESS_MS
  ) {
    return null;
  }
  return session;
}

export function getLocalKernelHealthPayload() {
  return {
    ok: true,
    product: 'MedHelp Kernel',
    version: LOCAL_KERNEL_VERSION,
    kernelId: localKernelStatusPayload().kernelId,
    instanceId: process.env.MEDHELP_KERNEL_INSTANCE_ID || null,
  };
}

export function handleLocalKernelWebSocket(ws, request) {
  const session = request.localKernelSession;
  if (!session) {
    ws.close(1008, 'local-session-required');
    return;
  }

  ws.send(JSON.stringify({
    type: 'status.connected',
    status: localKernelStatusPayload(session),
  }));

  ws.on('message', (message) => {
    let payload;
    try {
      payload = JSON.parse(String(message));
    } catch {
      ws.send(JSON.stringify({
        type: 'local.error',
        code: 'INVALID_JSON',
        error: 'Message must be valid JSON',
      }));
      return;
    }

    const type = typeof payload?.type === 'string' ? payload.type : '';
    if (type === 'status.ping') {
      ws.send(JSON.stringify({
        type: 'status.pong',
        requestId: payload.requestId || null,
        time: new Date().toISOString(),
      }));
      return;
    }

    if (type === 'status.get') {
      ws.send(JSON.stringify({
        type: 'status.snapshot',
        requestId: payload.requestId || null,
        status: localKernelStatusPayload(session),
      }));
      return;
    }

    ws.send(JSON.stringify({
      type: 'local.error',
      requestId: payload?.requestId || null,
      code: 'UNKNOWN_MESSAGE_TYPE',
      error: `Unknown local message type: ${type || '(missing)'}`,
    }));
  });
}

const localKernelRouter = express.Router();

localKernelRouter.use((req, res, next) => {
  if (!isLocalKernelMode()) {
    return res.status(404).json({ error: 'Local Engine is not enabled' });
  }
  if (!isAllowedLocalKernelOrigin(req.headers.origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  return next();
});

localKernelRouter.get('/status', (req, res) => {
  const session = verifyLocalSessionToken(getBearerToken(req), req.headers.origin || null);
  res.json(localKernelStatusPayload(session));
});

localKernelRouter.get('/update/status', async (req, res) => {
  if (!requireLocalSession(req, res)) {
    return;
  }
  const status = await readKernelUpdateStatus();
  return res.json({
    ok: true,
    capability: getKernelSelfUpdateCapability(),
    update: status,
  });
});

localKernelRouter.post('/shutdown', (req, res) => {
  const session = requireLocalSession(req, res);
  if (!session) {
    return;
  }
  auditLocal({
    type: 'kernel.shutdown_requested',
    origin: req.headers.origin || null,
    userId: session.userId || null,
  });
  scheduleLocalKernelShutdown(res);
  return res.status(202).json({ ok: true, shuttingDown: true });
});

localKernelRouter.post('/control/shutdown', (req, res) => {
  if (!requireLocalControlToken(req, res)) {
    return;
  }
  auditLocal({
    type: 'kernel.control_shutdown_requested',
    origin: req.headers.origin || null,
  });
  scheduleLocalKernelShutdown(res);
  return res.status(202).json({ ok: true, shuttingDown: true });
});

localKernelRouter.post('/update', async (req, res) => {
  const session = requireLocalSession(req, res);
  if (!session) {
    return;
  }

  try {
    const result = await prepareWindowsKernelUpdate({
      cloudBaseUrl: session.cloudBaseUrl,
      cloudAccessToken: session.cloudAccessToken,
    });
    auditLocal({
      type: 'kernel.update_accepted',
      origin: req.headers.origin || null,
      userId: session.userId || null,
      targetVersion: result.targetVersion,
    });
    scheduleLocalKernelShutdown(res);
    return res.status(202).json(result);
  } catch (error) {
    const code = error?.code || 'KERNEL_UPDATE_FAILED';
    const statusCode = code === 'ALREADY_CURRENT'
      ? 409
      : code === 'SELF_UPDATE_UNSUPPORTED'
        ? 400
        : 500;
    return res.status(statusCode).json({
      error: error instanceof Error ? error.message : 'Local Engine update failed',
      code,
    });
  }
});

localKernelRouter.post('/desktop-auth/sync', async (req, res) => {
  try {
    const origin = getRequestOrigin(req);
    if (!isAllowedLocalKernelOrigin(origin)) {
      return res.status(403).json({ error: 'Origin not allowed' });
    }

    const verified = await verifyCloudAccessToken({
      cloudAccessToken: req.body?.accessToken,
      cloudBaseUrl: req.body?.cloudBaseUrl,
      cloudUserId: req.body?.user?.id,
    });
    const { user } = await writeDesktopCloudAuthStore({
      ...req.body,
      cloudBaseUrl: verified.cloudBaseUrl,
      user: verified.user,
    }, origin);
    auditLocal({
      type: 'desktop.auth_synced',
      origin: origin || null,
      cloudUserId: user?.id == null ? null : String(user.id),
    });
    return res.json({
      ok: true,
      saved: true,
    });
  } catch (error) {
    return res.status(error?.statusCode || 500).json({
      error: error instanceof Error ? error.message : 'Failed to sync desktop login',
      code: error?.code || 'DESKTOP_AUTH_SYNC_FAILED',
      maxDevices: error?.maxDevices,
    });
  }
});

localKernelRouter.post('/session/start', async (req, res) => {
  const origin = getRequestOrigin(req);
  if (!isAllowedLocalKernelOrigin(origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  const cloudUserId = req.body?.cloudUserId == null ? null : String(req.body.cloudUserId);
  const cloudAccessToken = typeof req.body?.cloudAccessToken === 'string'
    ? req.body.cloudAccessToken.trim()
    : '';
  const browserNonce = typeof req.body?.browserNonce === 'string'
    ? req.body.browserNonce.trim()
    : '';
  const permissionMode = ['status', 'read', 'analysis'].includes(req.body?.requestedPermissionMode)
    ? req.body.requestedPermissionMode
    : 'analysis';

  if (!browserNonce) {
    return res.status(400).json({ error: 'browserNonce is required' });
  }

  try {
    const verified = await verifyCloudAccessToken({
      cloudAccessToken,
      cloudBaseUrl: req.body?.cloudBaseUrl,
      cloudUserId,
    });
    const session = createLocalSession({
      cloudUserId: verified.user?.id ?? cloudUserId,
      cloudAccessToken,
      cloudBaseUrl: verified.cloudBaseUrl,
      origin,
      browserNonce,
      permissionMode,
      workspaceScope: 'default',
      cloudVerifiedAtMs: Date.now(),
    });

    return res.json({
      ok: true,
      status: 'connected',
      sessionToken: session.token,
      expiresAt: new Date(session.expiresAtMs).toISOString(),
      permissionMode: session.permissionMode,
      workspaceScope: session.workspaceScope,
    });
  } catch (error) {
    return res.status(error?.statusCode || 502).json({
      error: error instanceof Error ? error.message : 'Online authentication failed',
      code: error?.code || 'CLOUD_AUTH_FAILED',
      maxDevices: error?.maxDevices,
    });
  }
});

localKernelRouter.post('/session/cloud-auth', async (req, res) => {
  const session = requireLocalSession(req, res, { requireFreshCloudAuth: false });
  if (!session) {
    return;
  }

  const cloudAccessToken = typeof req.body?.cloudAccessToken === 'string'
    ? req.body.cloudAccessToken.trim()
    : '';
  if (!cloudAccessToken) {
    return res.status(400).json({ error: 'cloudAccessToken is required' });
  }

  const cloudUserId = req.body?.cloudUserId == null ? null : String(req.body.cloudUserId);
  if (session.userId && cloudUserId && String(session.userId) !== cloudUserId) {
    return res.status(403).json({
      error: 'Cloud user does not match the paired local session',
      code: 'CLOUD_USER_MISMATCH',
    });
  }

  try {
    const verified = await verifyCloudAccessToken({
      cloudAccessToken,
      cloudBaseUrl: req.body?.cloudBaseUrl,
      cloudUserId: cloudUserId || session.userId,
    });
    session.cloudAccessToken = cloudAccessToken;
    session.cloudBaseUrl = verified.cloudBaseUrl;
    session.cloudVerifiedAtMs = Date.now();
    if (!session.userId && verified.user?.id) {
      session.userId = String(verified.user.id);
    }
    delete session.agentRuntimeEnvCache;
    delete session.userPreferenceContextCache;
    delete session.userMemoryContextCache;
    auditLocal({
      type: 'session.cloud_auth_refreshed',
      origin: req.headers.origin || null,
      userId: session.userId || null,
    });

    return res.json({ ok: true, updated: true });
  } catch (error) {
    if ([401, 403, 409].includes(error?.statusCode)) {
      localSessions.delete(session.token);
    }
    return res.status(error?.statusCode || 502).json({
      error: error instanceof Error ? error.message : 'Online authentication failed',
      code: error?.code || 'CLOUD_AUTH_FAILED',
      maxDevices: error?.maxDevices,
    });
  }
});

localKernelRouter.post('/session/revoke', (req, res) => {
  const token = getBearerToken(req);
  if (token) {
    localSessions.delete(token);
  }
  auditLocal({
    type: 'session.revoked',
    origin: req.headers.origin || null,
  });
  return res.json({ ok: true });
});

localKernelRouter.use('/compute', async (req, res, next) => {
  const session = requireLocalSession(req, res);
  if (!session) {
    return;
  }

  const decision = await authorizeCloudCapability(session, 'compute.resources');
  if (!decision.allowed) {
    return res.status(decision.status).json({
      error: decision.reason,
      code: decision.code,
      capability: decision.capability,
      plan: decision.plan,
    });
  }

  return next();
}, async (req, res, next) => {
  try {
    computeRoutesPromise ||= import('./compute.js').then((module) => module.default);
    const computeRoutes = await computeRoutesPromise;
    return computeRoutes(req, res, next);
  } catch (error) {
    return next(error);
  }
});

localKernelRouter.get('/projects', async (req, res) => {
  const session = requireLocalSession(req, res);
  if (!session) {
    return;
  }

  try {
    return res.json(await getProjects(LOCAL_KERNEL_PROJECT_USER_ID));
  } catch (error) {
    console.error('[local-kernel] Error getting projects:', error);
    return res.status(500).json({ error: 'Failed to get local projects' });
  }
});

// One-way legacy export used to move device-owned memories into the cloud
// account. The cloud import endpoint is idempotent, so this can be retried.
localKernelRouter.get('/preferences/export', (req, res) => {
  if (!requireLocalSession(req, res)) {
    return;
  }

  try {
    const localUser = userDb.getFirstUser();
    const memories = localUser
      ? userPreferenceMemoryDb.getAll(localUser.id).map((memory) => ({
        content: memory.content,
        category: memory.category,
        scope: memory.scope,
        projectKey: memory.project_key || null,
        isEnabled: memory.is_enabled,
      }))
      : [];
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      memoryEnabled: localUser ? userPreferenceMemoryDb.getMemoryEnabled(localUser.id) : true,
      memories,
    });
  } catch (error) {
    console.error('[local-kernel] Failed to export legacy preferences:', error);
    return res.status(500).json({ error: 'Failed to export local preferences' });
  }
});

localKernelRouter.get('/projects/trash', async (req, res) => {
  const session = requireLocalSession(req, res);
  if (!session) {
    return;
  }

  try {
    return res.json(await getTrashedProjects(LOCAL_KERNEL_PROJECT_USER_ID));
  } catch (error) {
    console.error('[local-kernel] Error getting project trash:', error);
    return res.status(500).json({ error: 'Failed to get local project trash' });
  }
});

localKernelRouter.get('/projects/:projectName/sessions', async (req, res) => {
  if (!requireLocalSession(req, res)) {
    return;
  }

  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 5;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;
    const result = await getSessions(
      req.params.projectName,
      limit,
      offset,
      LOCAL_KERNEL_PROJECT_USER_ID,
    );
    return res.json(result);
  } catch (error) {
    console.error('[local-kernel] Error getting sessions:', error);
    return res.status(500).json({ error: error.message });
  }
});

localKernelRouter.get('/projects/workspace-root', async (req, res) => {
  if (!requireLocalSession(req, res)) {
    return;
  }

  try {
    return res.json(await getLocalWorkspaceRootPayload());
  } catch (error) {
    console.error('[local-kernel] Error getting workspace root:', error);
    return res.status(500).json({ error: 'Failed to get local workspace root' });
  }
});

localKernelRouter.put('/projects/workspace-root', async (req, res) => {
  if (!requireLocalSession(req, res)) {
    return;
  }

  try {
    const { path: newPath } = req.body || {};

    if (!newPath) {
      await setWorkspaceRootInConfig(null);
      return res.json({
        success: true,
        ...(await getLocalWorkspaceRootPayload()),
      });
    }

    const absolutePath = path.resolve(expandWorkspaceInputPath(newPath));
    const stats = await fs.stat(absolutePath).catch((error) => {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    });

    if (!stats) {
      return res.status(400).json({ error: 'Directory does not exist' });
    }
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }

    const validation = await validateWorkspacePath(absolutePath, {
      allowUserHome: true,
      allowWindowsDrives: true,
    });
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    await setWorkspaceRootInConfig(absolutePath);
    return res.json({
      success: true,
      ...(await getLocalWorkspaceRootPayload()),
    });
  } catch (error) {
    console.error('[local-kernel] Error setting workspace root:', error);
    return res.status(500).json({ error: 'Failed to set local workspace root' });
  }
});

localKernelRouter.get('/projects/data-folders', async (req, res) => {
  if (!requireLocalSession(req, res)) {
    return;
  }

  try {
    return res.json(await getLocalDataFoldersSettingsPayload());
  } catch (error) {
    console.error('[local-kernel] Error getting data folder settings:', error);
    return res.status(500).json({ error: 'Failed to get local data folder settings' });
  }
});

localKernelRouter.put('/projects/data-folders', async (req, res) => {
  if (!requireLocalSession(req, res)) {
    return;
  }

  try {
    const { folders } = req.body || {};
    const normalizedPaths = await validateLocalAllowedDataFolders(folders || []);
    await setAllowedDataFoldersInConfig(normalizedPaths);
    return res.json({
      success: true,
      ...(await getLocalDataFoldersSettingsPayload()),
    });
  } catch (error) {
    console.error('[local-kernel] Error setting data folder settings:', error);
    return res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : 'Failed to set local data folder settings',
    });
  }
});

localKernelRouter.post('/projects/conversation-workspace', async (req, res) => {
  if (!requireLocalSession(req, res)) {
    return;
  }

  try {
    const workspaceRoot = await getWorkspaceRootFromConfig() || WORKSPACES_ROOT;
    const project = await createConversationWorkspace(
      workspaceRoot,
      LOCAL_KERNEL_PROJECT_USER_ID,
    );
    return res.json({ success: true, project });
  } catch (error) {
    console.error('[local-kernel] Error creating conversation workspace:', error);
    return res.status(500).json({
      error: error.message || 'Failed to create conversation workspace',
    });
  }
});

localKernelRouter.post('/projects/conversation-workspace/cleanup', async (req, res) => {
  if (!requireLocalSession(req, res)) {
    return;
  }

  try {
    const workspaceRoot = await getWorkspaceRootFromConfig() || WORKSPACES_ROOT;
    const removed = await cleanupUnusedConversationWorkspaces(
      workspaceRoot,
      LOCAL_KERNEL_PROJECT_USER_ID,
    );
    return res.json({ success: true, removedCount: removed.length });
  } catch (error) {
    console.error('[local-kernel] Error cleaning unused conversation workspaces:', error);
    return res.status(500).json({
      error: error.message || 'Failed to clean unused conversation workspaces',
    });
  }
});

localKernelRouter.post('/projects/create-workspace', async (req, res) => {
  const session = requireLocalSession(req, res);
  if (!session) {
    return;
  }

  try {
    const {
      workspaceType,
      path: workspacePath,
      displayName,
      connectionMode,
    } = req.body || {};

    if (!workspaceType || !workspacePath) {
      return res.status(400).json({ error: 'workspaceType and path are required' });
    }
    if (!['existing', 'new'].includes(workspaceType)) {
      return res.status(400).json({ error: 'workspaceType must be "existing" or "new"' });
    }

    const targetPath = path.resolve(expandWorkspaceInputPath(workspacePath));
    const validation = await validateWorkspacePath(targetPath, {
      allowUserHome: true,
      allowWindowsDrives: true,
      allowConfiguredDataFolders: true,
      allowAnySafePath: connectionMode === 'localFolder',
    });
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid workspace path',
        details: validation.error,
      });
    }

    const resolvedPath = validation.resolvedPath || targetPath;
    if (workspaceType === 'existing') {
      const stats = await fs.stat(resolvedPath).catch((error) => {
        if (error.code === 'ENOENT') {
          return null;
        }
        throw error;
      });

      if (!stats) {
        return res.status(404).json({ error: 'Workspace path does not exist' });
      }
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Path exists but is not a directory' });
      }
    } else {
      await fs.mkdir(resolvedPath, { recursive: true });
    }

    const preserveFolderContents = workspaceType === 'existing' && connectionMode === 'localFolder';
    const project = await addProjectManually(resolvedPath, displayName, LOCAL_KERNEL_PROJECT_USER_ID, {
      initializeWorkspace: !preserveFolderContents,
      metadata: preserveFolderContents ? { preserveFolderContents: true } : undefined,
    });
    return res.json({
      success: true,
      project,
      message: workspaceType === 'existing'
        ? 'Existing workspace added successfully'
        : 'New workspace created successfully',
    });
  } catch (error) {
    console.error('[local-kernel] Error creating workspace:', error);
    return res.status(500).json({
      error: error.message || 'Failed to create local workspace',
    });
  }
});

localKernelRouter.get('/browse-filesystem', async (req, res) => {
  if (!requireLocalSession(req, res)) {
    return;
  }

  try {
    const payload = await browseLocalFilesystem(req.query.path || null, {
      showHidden: req.query.showHidden === 'true',
      purpose: req.query.purpose || null,
    });
    return res.json(payload);
  } catch (error) {
    console.error('[local-kernel] Error browsing filesystem:', error);
    return res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : 'Failed to browse local filesystem',
    });
  }
});

localKernelRouter.post('/create-folder', async (req, res) => {
  if (!requireLocalSession(req, res)) {
    return;
  }

  try {
    const { path: folderPath } = req.body || {};
    const isDataFolderBrowse = req.query.purpose === 'dataFolder';
    const isLocalFolderBrowse = req.query.purpose === 'connectFolder';
    if (!folderPath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    const targetPath = path.resolve(expandWorkspaceInputPath(folderPath));
    const validation = await validateWorkspacePath(targetPath, {
      allowUserHome: true,
      allowWindowsDrives: true,
      allowConfiguredDataFolders: true,
      allowAnySafePath: isDataFolderBrowse || isLocalFolderBrowse,
    });
    if (!validation.valid) {
      return res.status(403).json({ error: validation.error });
    }

    const resolvedPath = validation.resolvedPath || targetPath;
    const parentDir = path.dirname(resolvedPath);
    const parentStats = await fs.stat(parentDir).catch((error) => {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    });
    if (!parentStats || !parentStats.isDirectory()) {
      return res.status(404).json({ error: 'Parent directory does not exist' });
    }

    const existingStats = await fs.stat(resolvedPath).catch((error) => {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    });
    if (existingStats) {
      return res.status(409).json({ error: 'Folder already exists' });
    }

    await fs.mkdir(resolvedPath, { recursive: false });
    return res.json({
      success: true,
      path: resolvedPath,
      displayPath: getWorkspaceDisplayPath(resolvedPath),
    });
  } catch (error) {
    console.error('[local-kernel] Error creating folder:', error);
    return res.status(500).json({ error: 'Failed to create local folder' });
  }
});

localKernelRouter.get('/environment-setup', async (req, res) => {
  if (!requireLocalSession(req, res)) return;

  try {
    return res.json(await getEnvironmentSetupStatus());
  } catch (error) {
    console.error('[local-kernel] Error reading environment setup:', error);
    return res.status(500).json({ error: '读取本机环境配置失败' });
  }
});

localKernelRouter.post('/environment-setup/detect', async (req, res) => {
  if (!requireLocalSession(req, res)) return;

  try {
    return res.json(await detectEnvironmentSetup());
  } catch (error) {
    console.error('[local-kernel] Error detecting environment setup:', error);
    return res.status(500).json({ error: '检测本机环境失败' });
  }
});

localKernelRouter.post('/environment-setup/validate', async (req, res) => {
  if (!requireLocalSession(req, res)) return;

  try {
    const result = await validateEnvironmentSetup(req.body || {}, { createDirectories: true });
    return res.status(result.valid ? 200 : 400).json(result);
  } catch (error) {
    console.error('[local-kernel] Error validating environment setup:', error);
    return res.status(500).json({ error: '校验本机环境配置失败' });
  }
});

localKernelRouter.put('/environment-setup', async (req, res) => {
  if (!requireLocalSession(req, res)) return;

  try {
    return res.json({ success: true, ...(await saveEnvironmentSetup(req.body || {})) });
  } catch (error) {
    console.error('[local-kernel] Error saving environment setup:', error);
    return res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : '保存本机环境配置失败',
      fieldErrors: error.fieldErrors || undefined,
    });
  }
});

localKernelRouter.get('/cli/:provider/status', async (req, res) => {
  const session = requireLocalSession(req, res);
  if (!session) {
    return;
  }

  const provider = String(req.params.provider || '').trim().toLowerCase();
  try {
    const status = await getCliAuthStatus(provider, { userId: session.userId });
    return res.json(status);
  } catch (error) {
    return res.status(500).json({
      authenticated: false,
      email: null,
      error: error.message || 'Failed to check local CLI status',
      cliAvailable: false,
      cliCommand: null,
    });
  }
});

localKernelRouter.use('/pi', (req, res, next) => {
  const session = requireLocalSession(req, res);
  if (!session) return;
  req.localKernelSession = session;
  return next();
}, piModelsRoutes);

localKernelRouter.use('/mcp', (req, res) => {
  if (!requireLocalSession(req, res)) return;
  res.status(410).json({
    error: 'The legacy MCP endpoint has been removed. Configure MCP through Pi.',
    piEndpoint: '/api/local/pi/services/integrations',
  });
});

localKernelRouter.get('/permissions', (req, res) => {
  const session = requireLocalSession(req, res);
  if (!session) {
    return;
  }
  return res.json({
    ok: true,
    permissionMode: session.permissionMode,
    permissions: ['status', 'read', 'analysis'],
  });
});

localKernelRouter.post('/permissions/request', (req, res) => {
  return res.status(202).json({
    ok: true,
    status: 'pending',
    requestedPermissionMode: req.body?.permissionMode || null,
  });
});

localKernelRouter.get('/audit', (req, res) => {
  if (!requireLocalSession(req, res)) {
    return;
  }
  return res.json({ ok: true, events: localAuditEvents.slice(0, 50) });
});

localKernelRouter.get('/public-releases', (req, res) => {
  res.json(buildLocalKernelReleasePayload(req));
});

export const localKernelCloudRouter = express.Router();
export const localKernelPublicRouter = express.Router();

localKernelPublicRouter.get('/public-releases', (req, res) => {
  res.json(buildLocalKernelReleasePayload(req));
});

localKernelCloudRouter.post('/launch-token', (req, res) => {
  const launchToken = generateToken('launch_');
  const expiresAtMs = Date.now() + 5 * 60 * 1000;
  launchTokens.set(launchToken, {
    userId: req.user?.id,
    expiresAtMs,
    createdAt: new Date().toISOString(),
  });
  res.json({
    ok: true,
    launchToken,
    expiresAt: new Date(expiresAtMs).toISOString(),
  });
});

localKernelCloudRouter.get('/launch/:token', (req, res) => {
  const launchToken = req.params.token;
  const record = launchTokens.get(launchToken);
  if (!record || record.expiresAtMs <= Date.now()) {
    launchTokens.delete(launchToken);
    return res.status(404).json({ error: 'Launch token not found or expired' });
  }
  if (String(record.userId) !== String(req.user?.id)) {
    return res.status(403).json({ error: 'Launch token belongs to another user' });
  }
  launchTokens.delete(launchToken);
  res.json({
    ok: true,
    discovery: 'loopback-auto',
    consumedAt: new Date().toISOString(),
  });
});

localKernelCloudRouter.post('/devices/register', authenticateToken, (req, res) => {
  const fingerprint = String(req.body?.deviceFingerprint || '').trim();
  if (!fingerprint) {
    return res.status(400).json({ error: 'deviceFingerprint is required' });
  }

  const device = gatewayDb.registerDevice({
    userId: req.user.id,
    deviceFingerprint: fingerprint,
    label: req.body?.label || req.body?.deviceName || null,
    userAgent: req.headers['user-agent'] || null,
    ipAddress: req.ip || null,
  });

  res.json({ ok: true, device });
});

localKernelCloudRouter.post('/audit', authenticateToken, (req, res) => {
  const event = gatewayDb.recordUsageEvent({
    userId: req.user.id,
    capability: req.body?.capability || 'local-kernel',
    plan: req.user.membershipPlan || req.user.membership_plan || 'unknown',
    status: req.body?.status || 'ok',
    code: req.body?.code || null,
    source: req.body?.source || 'local-kernel',
    deviceId: req.body?.deviceId || null,
    ipAddress: req.ip || null,
    userAgent: req.headers['user-agent'] || null,
    metadata: req.body?.metadata || {},
  });
  res.json({ ok: true, event });
});

localKernelCloudRouter.get('/releases', (_req, res) => {
  res.json(buildLocalKernelReleasePayload());
});

export default localKernelRouter;
