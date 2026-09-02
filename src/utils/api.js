import { IS_PLATFORM } from "../constants/config";
import { resolveApiTarget } from './apiBase';
import { fetchWithLocalNetworkAccess, withLoopbackTargetAddressSpace } from './localNetworkAccess';
import { getDesktopCloudAppOrigin } from './desktopRuntime';
import { runtimeAwareFetch } from './desktopRuntimeFetch';

const ACCESS_TOKEN_KEY = 'auth-token';
const REFRESH_TOKEN_KEY = 'auth-refresh-token';
const AUTH_SESSION_KEY = 'auth-session-id';
const DEVICE_FINGERPRINT_KEY = 'medhelp-auth-device-id';
const DESKTOP_RUNTIME_INFO_KEY = 'medhelp-auth-desktop-runtime';
const DESKTOP_KERNEL_ENDPOINT_KEY = 'medhelp.localKernel.lastEndpoint';
const AUTH_REFRESH_LOCK_KEY = 'medhelp-auth-refresh-lock';
const AUTH_REFRESH_LOCK_NAME = 'medhelp-auth-refresh';
const AUTH_REFRESH_LOCK_TTL_MS = 30_000;
const AUTH_REFRESH_LOCK_WAIT_MS = 35_000;
const AUTH_REFRESH_LOCK_RETRY_MS = 50;

let refreshPromise = null;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function createRefreshLockOwner() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `refresh-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readRefreshLock() {
  try {
    const parsed = JSON.parse(localStorage.getItem(AUTH_REFRESH_LOCK_KEY) || 'null');
    if (!parsed || typeof parsed.owner !== 'string' || !Number.isFinite(parsed.expiresAt)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function withStorageRefreshLock(callback) {
  const owner = createRefreshLockOwner();
  const deadline = Date.now() + AUTH_REFRESH_LOCK_WAIT_MS;

  while (Date.now() < deadline) {
    const current = readRefreshLock();
    if (!current || current.expiresAt <= Date.now()) {
      try {
        localStorage.setItem(AUTH_REFRESH_LOCK_KEY, JSON.stringify({
          owner,
          expiresAt: Date.now() + AUTH_REFRESH_LOCK_TTL_MS,
        }));
        if (readRefreshLock()?.owner === owner) {
          try {
            return await callback();
          } finally {
            if (readRefreshLock()?.owner === owner) {
              localStorage.removeItem(AUTH_REFRESH_LOCK_KEY);
            }
          }
        }
      } catch {
        // Storage can be unavailable in privacy modes. Continue with the
        // in-window refresh lock instead of making authentication unusable.
        return callback();
      }
    }
    await wait(AUTH_REFRESH_LOCK_RETRY_MS);
  }

  // A crashed tab can leave a lease behind until its TTL elapses. By the time
  // this deadline is reached it is safer to retry than to strand the session.
  return callback();
}

function withCrossWindowRefreshLock(callback) {
  const lockManager = globalThis.navigator?.locks;
  if (lockManager?.request) {
    return lockManager.request(AUTH_REFRESH_LOCK_NAME, { mode: 'exclusive' }, callback);
  }
  return withStorageRefreshLock(callback);
}

function createDeviceFingerprint() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(18);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }
  return `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function detectDeviceLabel() {
  if (typeof navigator === 'undefined') return 'API client';
  const platform = navigator.userAgentData?.platform || navigator.platform || 'Unknown system';
  const userAgent = navigator.userAgent || '';
  const browser = userAgent.includes('Edg/')
    ? 'Edge'
    : userAgent.includes('Chrome/')
      ? 'Chrome'
      : userAgent.includes('Firefox/')
        ? 'Firefox'
        : userAgent.includes('Safari/')
          ? 'Safari'
          : 'Browser';
  return `${platform} · ${browser}`;
}

function getRuntimeSearchParams() {
  if (typeof window === 'undefined') return new URLSearchParams();
  const params = new URLSearchParams(window.location.search || '');
  const hash = window.location.hash || '';
  const queryIndex = hash.indexOf('?');
  if (queryIndex >= 0) {
    for (const [key, value] of new URLSearchParams(hash.slice(queryIndex + 1))) {
      if (!params.has(key)) params.set(key, value);
    }
  }
  return params;
}

function normalizeRuntimeValue(value) {
  const normalized = String(value || '').trim();
  return normalized && normalized !== 'unknown' ? normalized : null;
}

function readStoredDesktopRuntime() {
  try {
    const stored = sessionStorage.getItem(DESKTOP_RUNTIME_INFO_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    const runtime = {
      platform: normalizeRuntimeValue(parsed?.platform),
      version: normalizeRuntimeValue(parsed?.version),
    };
    return runtime.platform || runtime.version ? runtime : null;
  } catch {
    return null;
  }
}

function storeDesktopRuntime(runtime) {
  try {
    sessionStorage.setItem(DESKTOP_RUNTIME_INFO_KEY, JSON.stringify(runtime));
  } catch {
    // Runtime metadata is an optimization for hosted desktop navigation. If
    // storage is unavailable, the preload bridge and launch URL still work.
  }
}

function captureDesktopRuntime() {
  if (typeof window === 'undefined') return null;
  const params = getRuntimeSearchParams();
  const bridge = window.medhelpDesktop;
  const isDesktop = params.get('desktopKernel') === '1' || bridge?.isDesktop === true;
  if (!isDesktop) return null;
  const stored = readStoredDesktopRuntime();
  const runtime = {
    platform: normalizeRuntimeValue(
      bridge?.platform || params.get('desktopPlatform') || stored?.platform,
    ),
    version: normalizeRuntimeValue(
      params.get('desktopKernelVersion') || bridge?.version || stored?.version,
    ),
  };
  if (runtime.platform || runtime.version) storeDesktopRuntime(runtime);
  return runtime;
}

// The hosted desktop launch URL is the only reliable version source for older
// releases. Capture it before client-side navigation has a chance to remove it.
const initialDesktopRuntime = captureDesktopRuntime();

function detectAuthClientInfo() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { clientType: 'api', clientVersion: null, clientPlatform: null };
  }
  const params = getRuntimeSearchParams();
  const bridge = window.medhelpDesktop;
  const isDesktopKernel = params.get('desktopKernel') === '1';
  const storedDesktopRuntime = readStoredDesktopRuntime();
  const currentDesktopRuntime = captureDesktopRuntime();
  const desktopPlatform = normalizeRuntimeValue(
    currentDesktopRuntime?.platform || initialDesktopRuntime?.platform || storedDesktopRuntime?.platform,
  );
  const desktopVersion = normalizeRuntimeValue(
    currentDesktopRuntime?.version || initialDesktopRuntime?.version || storedDesktopRuntime?.version,
  );
  const isDesktop = isDesktopKernel
    || bridge?.isDesktop === true
    || Boolean(initialDesktopRuntime)
    || Boolean(storedDesktopRuntime);
  const hostname = String(window.location.hostname || '').toLowerCase();
  const isLoopback = hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  const buildVersion = typeof __MEDHELP_APP_VERSION__ !== 'undefined'
    ? normalizeRuntimeValue(__MEDHELP_APP_VERSION__)
    : null;
  if (isDesktop && (desktopPlatform || desktopVersion)) {
    storeDesktopRuntime({ platform: desktopPlatform, version: desktopVersion });
  }
  return {
    clientType: isDesktop
      ? (String(desktopPlatform || '').startsWith('win')
          ? 'desktop-windows'
          : 'desktop-macos')
      : isLoopback
        ? 'local-engine'
        : 'web',
    // A hosted desktop renders the current web build, so its build version is
    // not evidence of the installed desktop version. Legacy desktop releases
    // may lose their launch query during SPA navigation and expose no version
    // through preload; report unknown instead of mislabeling them as the web build.
    clientVersion: isDesktop ? desktopVersion : buildVersion,
    clientPlatform: desktopPlatform || navigator.userAgentData?.platform || navigator.platform || null,
  };
}

export function getAuthDeviceIdentity() {
  let deviceFingerprint = localStorage.getItem(DEVICE_FINGERPRINT_KEY);
  if (!deviceFingerprint) {
    deviceFingerprint = createDeviceFingerprint();
    localStorage.setItem(DEVICE_FINGERPRINT_KEY, deviceFingerprint);
  }
  return {
    deviceFingerprint,
    deviceLabel: detectDeviceLabel(),
    ...detectAuthClientInfo(),
  };
}

export const getStoredAuthSessionId = () => localStorage.getItem(AUTH_SESSION_KEY);

function getHashSearchParams(hash = '') {
  const queryIndex = hash.indexOf('?');
  if (queryIndex < 0) {
    return new URLSearchParams();
  }
  return new URLSearchParams(hash.slice(queryIndex + 1));
}

function normalizeLoopbackHostname(hostname = '') {
  return hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
}

function formatHostForUrl(hostname = '') {
  const normalized = normalizeLoopbackHostname(hostname);
  return normalized.includes(':') ? `[${normalized}]` : normalized;
}

function isLoopbackHostname(hostname = '') {
  const normalized = normalizeLoopbackHostname(hostname);
  return normalized === 'localhost'
    || normalized === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function parseDesktopLocalKernelBaseUrl(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) {
    return null;
  }

  const normalized = /^https?:\/\//i.test(trimmed) || /^wss?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;

  try {
    const parsed = new URL(normalized);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
      return null;
    }
    if (!isLoopbackHostname(parsed.hostname)) {
      return null;
    }
    const protocol = parsed.protocol === 'https:' || parsed.protocol === 'wss:' ? 'https:' : 'http:';
    const port = parsed.port || '5055';
    return `${protocol}//${formatHostForUrl(parsed.hostname)}:${port}`;
  } catch {
    return null;
  }
}

function getDesktopAuthSyncUrl() {
  if (typeof window === 'undefined') {
    return null;
  }

  const searchParams = new URLSearchParams(window.location.search || '');
  const hashParams = getHashSearchParams(window.location.hash || '');
  const desktopKernel = searchParams.get('desktopKernel') || hashParams.get('desktopKernel');
  const bridgeUiMode = String(window.medhelpDesktop?.uiMode || '').toLowerCase();
  const bridgeOwnsBundledKernel = window.medhelpDesktop?.isDesktop === true
    && (bridgeUiMode === 'hosted' || bridgeUiMode === 'offline');
  if (desktopKernel !== '1' && !bridgeOwnsBundledKernel) {
    return null;
  }

  let storedLocalEndpoint = null;
  try {
    storedLocalEndpoint = localStorage.getItem(DESKTOP_KERNEL_ENDPOINT_KEY);
  } catch {
    // Launch parameters still provide the endpoint when storage is unavailable.
  }
  const localHint =
    searchParams.get('local')
    || searchParams.get('ws')
    || hashParams.get('local')
    || hashParams.get('ws')
    || storedLocalEndpoint;
  const localBaseUrl = parseDesktopLocalKernelBaseUrl(localHint);
  return localBaseUrl ? `${localBaseUrl}/api/local/desktop-auth/sync` : null;
}

export async function syncDesktopAuthIfRequested(payload = {}, accessToken = null) {
  const syncUrl = getDesktopAuthSyncUrl();
  const token = accessToken || payload.accessToken || payload.token;
  if (!syncUrl || !token) {
    return;
  }

  try {
    const response = await fetchWithLocalNetworkAccess(syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: token,
        refreshToken: payload.refreshToken || null,
        tokenType: payload.tokenType || 'Bearer',
        expiresIn: payload.expiresIn || null,
        refreshExpiresIn: payload.refreshExpiresIn || null,
        sessionId: payload.sessionId || null,
        deviceFingerprint: getAuthDeviceIdentity().deviceFingerprint,
        user: payload.user || null,
        cloudBaseUrl: getDesktopCloudAppOrigin(),
        origin: window.location.origin,
      }),
    });
    if (!response.ok) {
      console.warn('[auth] Desktop login sync failed:', response.status);
    }
  } catch (error) {
    console.warn('[auth] Desktop login sync failed:', error);
  }
}

export async function restoreDesktopAuthSession() {
  const bridge = typeof window === 'undefined' ? null : window.medhelpDesktop;
  if (!bridge?.restoreAuthSession) return null;
  try {
    const payload = await bridge.restoreAuthSession();
    const accessToken = payload?.accessToken || payload?.token;
    if (!accessToken) return null;
    if (payload.deviceFingerprint) {
      localStorage.setItem(DEVICE_FINGERPRINT_KEY, payload.deviceFingerprint);
    }
    return payload;
  } catch (error) {
    console.warn('[auth] Desktop session restore failed:', error);
    return null;
  }
}

function persistDesktopAuthSession(payload = {}, accessToken = null) {
  const bridge = typeof window === 'undefined' ? null : window.medhelpDesktop;
  const token = accessToken || payload.accessToken || payload.token;
  if (!bridge?.saveAuthSession || !token) return;
  Promise.resolve(bridge.saveAuthSession({
    accessToken: token,
    refreshToken: payload.refreshToken || localStorage.getItem(REFRESH_TOKEN_KEY),
    tokenType: payload.tokenType || 'Bearer',
    expiresIn: payload.expiresIn || null,
    refreshExpiresIn: payload.refreshExpiresIn || null,
    sessionId: payload.sessionId || localStorage.getItem(AUTH_SESSION_KEY),
    deviceFingerprint: getAuthDeviceIdentity().deviceFingerprint,
    user: payload.user || null,
  })).catch((error) => {
    console.warn('[auth] Desktop session persistence failed:', error);
  });
}

export const clearStoredAuthTokens = () => {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(AUTH_SESSION_KEY);
  const bridge = typeof window === 'undefined' ? null : window.medhelpDesktop;
  if (bridge?.clearAuthSession) {
    Promise.resolve(bridge.clearAuthSession()).catch((error) => {
      console.warn('[auth] Desktop session clear failed:', error);
    });
  }
};

export const storeAuthTokens = (payload = {}) => {
  const accessToken = payload.accessToken || payload.token;
  // Publish the access token last. Other windows react to that storage event,
  // so the matching refresh token and session id must already be visible.
  if (payload.refreshToken) {
    localStorage.setItem(REFRESH_TOKEN_KEY, payload.refreshToken);
  }
  if (payload.sessionId) {
    localStorage.setItem(AUTH_SESSION_KEY, payload.sessionId);
  }
  if (accessToken) {
    localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  }
  if (accessToken) {
    persistDesktopAuthSession(payload, accessToken);
    syncDesktopAuthIfRequested(payload, accessToken).catch(() => {});
  }
  return accessToken || null;
};

function emitTokenRefresh(token) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('medhelp-auth-token-refreshed', {
      detail: { token },
    }));
  }
}

function emitAuthSessionExpired() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('medhelp-auth-session-expired'));
  }
}

export const refreshStoredAuthToken = async (failedAccessToken = null) => {
  if (!refreshPromise) {
    const accessTokenAtRequest = localStorage.getItem(ACCESS_TOKEN_KEY);
    const refreshTokenAtRequest = localStorage.getItem(REFRESH_TOKEN_KEY);
    refreshPromise = withCrossWindowRefreshLock(async () => {
      const currentAccessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
      const currentRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);

      // Another window may have completed the refresh while this one waited
      // for the cross-window lock. Reuse its result instead of rotating again.
      if (
        currentAccessToken
        && (
          (failedAccessToken && currentAccessToken !== failedAccessToken)
          || (accessTokenAtRequest && currentAccessToken !== accessTokenAtRequest)
          || (refreshTokenAtRequest && currentRefreshToken !== refreshTokenAtRequest)
        )
      ) {
        return currentAccessToken;
      }

      if (!currentRefreshToken) {
        if (!failedAccessToken || !currentAccessToken || currentAccessToken === failedAccessToken) {
          clearStoredAuthTokens();
          emitAuthSessionExpired();
        }
        return null;
      }

      const device = getAuthDeviceIdentity();
      try {
        const response = await runtimeAwareFetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: currentRefreshToken, ...device }),
        });
        if (!response.ok) {
          const latestAccessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
          const latestRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);

          // A successful refresh in another window wins over this stale 401.
          // Never erase credentials that no longer match this request.
          if (
            latestAccessToken
            && (
              latestRefreshToken !== currentRefreshToken
              || (failedAccessToken && latestAccessToken !== failedAccessToken)
            )
          ) {
            return latestAccessToken;
          }

          clearStoredAuthTokens();
          emitAuthSessionExpired();
          return null;
        }

        const data = await response.json();
        const accessToken = storeAuthTokens(data);
        if (accessToken) {
          emitTokenRefresh(accessToken);
        }
        return accessToken;
      } catch (error) {
        console.error('Failed to refresh auth token:', error);
        return null;
      }
    })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
};

// Utility function for authenticated API calls
export const authenticatedFetch = async (url, options = {}) => {
  const {
    forceCloud = false,
    skipAuthRefresh = false,
    ...fetchOptions
  } = options;
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  const target = resolveApiTarget(url, { forceCloud });
  const defaultHeaders = {};

  // Only set Content-Type for non-FormData requests
  if (!(fetchOptions.body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
  }

  if (target.localSessionToken) {
    defaultHeaders['Authorization'] = `Bearer ${target.localSessionToken}`;
  } else if (token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }

  const requestOptions = {
    ...fetchOptions,
    headers: {
      ...defaultHeaders,
      ...fetchOptions.headers,
    },
  };

  const response = await runtimeAwareFetch(
    target.url,
    target.localSessionToken
      ? withLoopbackTargetAddressSpace(target.url, requestOptions)
      : requestOptions,
  );
  if (response.status === 401 && target.localSessionToken) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('medhelp-local-kernel-unauthorized'));
    }
    return response;
  }
  if (response.status !== 401 || skipAuthRefresh || target.localSessionToken) {
    return response;
  }

  const refreshedToken = await refreshStoredAuthToken(token);
  if (!refreshedToken) {
    return response;
  }

  const retryOptions = {
    ...fetchOptions,
    headers: {
      ...defaultHeaders,
      ...fetchOptions.headers,
      Authorization: `Bearer ${refreshedToken}`,
    },
  };
  return runtimeAwareFetch(
    target.url,
    target.localSessionToken
      ? withLoopbackTargetAddressSpace(target.url, retryOptions)
      : retryOptions,
  );
};

// API endpoints
export const api = {
  companions: {
    list: () => authenticatedFetch('/api/companions', { cache: 'no-store' }),
    create: (body) => authenticatedFetch('/api/companions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    update: (id, body) => authenticatedFetch(`/api/companions/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
    delete: (id) => authenticatedFetch(`/api/companions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    memories: (id) => authenticatedFetch(`/api/companions/${encodeURIComponent(id)}/memories`, { cache: 'no-store' }),
    createMemory: (id, body) => authenticatedFetch(`/api/companions/${encodeURIComponent(id)}/memories`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    deleteMemory: (id, memoryId) => authenticatedFetch(
      `/api/companions/${encodeURIComponent(id)}/memories/${encodeURIComponent(memoryId)}`,
      { method: 'DELETE' },
    ),
  },
  miniApps: {
    list: () => authenticatedFetch('/api/mini-apps', { cache: 'no-store' }),
    get: (id) => authenticatedFetch(`/api/mini-apps/${encodeURIComponent(id)}`, { cache: 'no-store' }),
    create: (body) => authenticatedFetch('/api/mini-apps', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    update: (id, body) => authenticatedFetch(`/api/mini-apps/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
    delete: (id) => authenticatedFetch(`/api/mini-apps/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    validate: (html) => authenticatedFetch('/api/mini-apps/validate', {
      method: 'POST',
      body: JSON.stringify({ html }),
    }),
  },
  // Auth endpoints (no token required)
  auth: {
    status: () => runtimeAwareFetch('/api/auth/status'),
    login: (username, password) => runtimeAwareFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        ...(password ? { password } : {}),
        ...getAuthDeviceIdentity(),
      }),
    }),
    register: (
      username,
      password,
      notificationEmail,
      acceptedLegalTerms = false,
    ) => runtimeAwareFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        password,
        notificationEmail,
        acceptedLegalTerms,
        ...getAuthDeviceIdentity(),
      }),
    }),
    refresh: (refreshToken) => runtimeAwareFetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken, ...getAuthDeviceIdentity() }),
    }),
    user: () => authenticatedFetch('/api/auth/user'),
    logout: () => authenticatedFetch('/api/auth/logout', { method: 'POST' }),
    presence: () => authenticatedFetch('/api/auth/presence', {
      method: 'POST',
      body: JSON.stringify(getAuthDeviceIdentity()),
    }),
    activateKernelDevice: (
      /** @type {{ kernelVersion?: string | null, kernelPlatform?: string | null }} */
      { kernelVersion = null, kernelPlatform = null } = {},
    ) => authenticatedFetch('/api/auth/kernel-device/activate', {
      method: 'POST',
      body: JSON.stringify({ kernelVersion, kernelPlatform }),
    }),
    reportProjectCount: (projectCount) => authenticatedFetch('/api/auth/project-count', {
      method: 'POST',
      body: JSON.stringify({ projectCount }),
    }),
    devices: () => authenticatedFetch('/api/auth/devices'),
    revokeDevice: (sessionId) => authenticatedFetch(`/api/auth/devices/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    }),
  },
  system: {
    restart: () => authenticatedFetch('/api/system/restart', {
      method: 'POST',
    }),
  },

  // Protected endpoints
  // config endpoint removed - no longer needed (frontend uses window.location)
  projects: () => authenticatedFetch('/api/projects'),
  trashedProjects: () => authenticatedFetch('/api/projects/trash'),
  trashedSessions: () => authenticatedFetch('/api/projects/trash/sessions'),
  settings: {
    autoResearchEmail: () => authenticatedFetch('/api/settings/auto-research-email', { forceCloud: true }),
    updateAutoResearchEmail: (senderEmail) =>
      authenticatedFetch('/api/settings/auto-research-email', {
        method: 'PUT',
        forceCloud: true,
        body: JSON.stringify({ senderEmail }),
      }),
    autoResearchResendKey: () => authenticatedFetch('/api/settings/auto-research-resend-key'),
    updateAutoResearchResendKey: (apiKey) =>
      authenticatedFetch('/api/settings/auto-research-resend-key', {
        method: 'PUT',
        body: JSON.stringify({ apiKey }),
      }),
    memory: () => authenticatedFetch('/api/settings/preferences', { forceCloud: true }),
    exportLocalMemories: () => authenticatedFetch('/api/local/preferences/export'),
    importMemories: (memories) => authenticatedFetch('/api/settings/preferences/import', {
      method: 'POST',
      forceCloud: true,
      body: JSON.stringify({ memories }),
    }),
    createMemory: (payload) =>
      authenticatedFetch('/api/settings/preferences', {
        method: 'POST',
        forceCloud: true,
        body: JSON.stringify(payload),
      }),
    updateMemory: (memoryId, payload) =>
      authenticatedFetch(`/api/settings/preferences/${memoryId}`, {
        method: 'PUT',
        forceCloud: true,
        body: JSON.stringify(payload),
      }),
    toggleMemory: (memoryId, isEnabled) =>
      authenticatedFetch(`/api/settings/preferences/${memoryId}/toggle`, {
        method: 'PATCH',
        forceCloud: true,
        body: JSON.stringify(
          typeof isEnabled === 'boolean'
            ? { isEnabled }
            : {},
        ),
      }),
    deleteMemory: (memoryId) =>
      authenticatedFetch(`/api/settings/preferences/${memoryId}`, {
        method: 'DELETE',
        forceCloud: true,
      }),
    memorySettings: () => authenticatedFetch('/api/settings/preferences/settings', { forceCloud: true }),
    updateMemorySettings: (enabled) =>
      authenticatedFetch('/api/settings/preferences/settings', {
        method: 'PATCH',
        forceCloud: true,
        body: JSON.stringify({ enabled }),
      }),
    longTermMemory: () => authenticatedFetch('/api/settings/long-term-memory', { forceCloud: true }),
    createLongTermMemory: (content) => authenticatedFetch('/api/settings/long-term-memory', {
      method: 'POST',
      forceCloud: true,
      body: JSON.stringify({ content }),
    }),
    importLongTermMemories: (memories) => authenticatedFetch('/api/settings/long-term-memory/import', {
      method: 'POST',
      forceCloud: true,
      body: JSON.stringify({ memories }),
    }),
    updateLongTermMemory: (memoryId, content) => authenticatedFetch(`/api/settings/long-term-memory/${memoryId}`, {
      method: 'PUT',
      forceCloud: true,
      body: JSON.stringify({ content }),
    }),
    deleteLongTermMemory: (memoryId) => authenticatedFetch(`/api/settings/long-term-memory/${memoryId}`, {
      method: 'DELETE',
      forceCloud: true,
    }),
    setLongTermMemoryPinned: (memoryId, pinned) => authenticatedFetch(`/api/settings/long-term-memory/${memoryId}/pinned`, {
      method: 'PATCH',
      forceCloud: true,
      body: JSON.stringify({ pinned }),
    }),
    clearAutomaticLongTermMemory: () => authenticatedFetch('/api/settings/long-term-memory/automatic', {
      method: 'DELETE',
      forceCloud: true,
    }),
    clearLongTermMemory: () => authenticatedFetch('/api/settings/long-term-memory', {
      method: 'DELETE',
      forceCloud: true,
    }),
    updateLongTermMemorySettings: (payload) => authenticatedFetch('/api/settings/long-term-memory/settings', {
      method: 'PATCH',
      forceCloud: true,
      body: JSON.stringify(payload),
    }),
    imChannelsStatus: () => authenticatedFetch('/api/settings/im-channels/status'),
    updateImDefaultAgent: (defaultAgent) =>
      authenticatedFetch('/api/settings/im-channels/default-agent', {
        method: 'PUT',
        body: JSON.stringify({ defaultAgent }),
      }),
    testFeishuImChannel: (payload) =>
      authenticatedFetch('/api/settings/im-channels/feishu/test', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    beginFeishuImQr: (payload) =>
      authenticatedFetch('/api/settings/im-channels/feishu/qr-begin', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    pollFeishuImQr: () => authenticatedFetch('/api/settings/im-channels/feishu/qr-poll'),
    cancelFeishuImQr: () =>
      authenticatedFetch('/api/settings/im-channels/feishu/qr-cancel', {
        method: 'POST',
      }),
    saveFeishuImChannel: (payload) =>
      authenticatedFetch('/api/settings/im-channels/feishu/save', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    disableFeishuImChannel: () =>
      authenticatedFetch('/api/settings/im-channels/feishu/disable', {
        method: 'POST',
      }),
    testDomesticImChannel: (platform, payload) =>
      authenticatedFetch(`/api/settings/im-channels/${encodeURIComponent(platform)}/test`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    saveDomesticImChannel: (platform, payload) =>
      authenticatedFetch(`/api/settings/im-channels/${encodeURIComponent(platform)}/save`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    disableDomesticImChannel: (platform) =>
      authenticatedFetch(`/api/settings/im-channels/${encodeURIComponent(platform)}/disable`, {
        method: 'POST',
      }),
    beginWeixinImQr: () => authenticatedFetch('/api/settings/im-channels/weixin/qr'),
    pollWeixinImQr: () => authenticatedFetch('/api/settings/im-channels/weixin/qr-poll'),
    saveWeixinImChannel: (payload) =>
      authenticatedFetch('/api/settings/im-channels/weixin/save', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    disableWeixinImChannel: () =>
      authenticatedFetch('/api/settings/im-channels/weixin/disable', {
        method: 'POST',
      }),
  },
  projectTokenUsageSummary: (projects) =>
    authenticatedFetch('/api/projects/token-usage-summary', {
      method: 'POST',
      body: JSON.stringify({
        projects: (projects || []).map((project) => ({
          name: project.name,
          fullPath: project.fullPath,
        })),
      }),
    }),
  shares: {
    getConversation: (token) =>
      authenticatedFetch(`/api/shares/${encodeURIComponent(token)}`, {
        method: 'GET',
        forceCloud: true,
      }),
    createConversation: async (payload) => {
      const messagesResponse = await api.sessionMessages(
        payload.projectName,
        payload.sessionId,
        null,
        0,
        payload.provider || 'claude',
      );
      if (!messagesResponse.ok) {
        return messagesResponse;
      }

      const messagesData = await messagesResponse.json().catch(() => ({}));
      return authenticatedFetch('/api/shares/snapshots', {
        method: 'POST',
        forceCloud: true,
        body: JSON.stringify({
          ...payload,
          rawMessages: Array.isArray(messagesData?.messages) ? messagesData.messages : [],
        }),
      });
    },
    createMessage: (payload) =>
      authenticatedFetch('/api/shares/snapshots', {
        method: 'POST',
        forceCloud: true,
        body: JSON.stringify(payload),
      }),
    revoke: (token) =>
      authenticatedFetch(`/api/shares/${encodeURIComponent(token)}`, {
        method: 'DELETE',
        forceCloud: true,
      }),
  },
  conversations: {
    list: ({ limit = 50, offset = 0, search = '' } = {}) => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (search) params.set('search', search);
      return authenticatedFetch(`/api/conversations?${params.toString()}`, { forceCloud: true });
    },
    get: (id) => authenticatedFetch(`/api/conversations/${encodeURIComponent(id)}`, { forceCloud: true }),
    sync: (sessionId, payload) => authenticatedFetch(`/api/conversations/session/${encodeURIComponent(sessionId)}`, {
      method: 'PUT',
      forceCloud: true,
      body: JSON.stringify(payload),
    }),
    syncFromSession: async (payload) => {
      const messagesResponse = await api.sessionMessages(
        payload.projectName,
        payload.sessionId,
        null,
        0,
        payload.provider || 'claude',
      );
      if (!messagesResponse.ok) return messagesResponse;
      const messagesData = await messagesResponse.json().catch(() => ({}));
      return api.conversations.sync(payload.sessionId, {
        provider: payload.provider,
        runtimeId: payload.runtimeId,
        sessionKey: payload.sessionKey,
        projectKey: payload.projectKey || payload.projectName,
        title: payload.title,
        projectLabel: payload.projectLabel,
        messages: Array.isArray(messagesData?.messages) ? messagesData.messages : [],
      });
    },
    delete: (id) => authenticatedFetch(`/api/conversations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      forceCloud: true,
    }),
  },
  sessions: (projectName, limit = 5, offset = 0) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/sessions?limit=${limit}&offset=${offset}`),
  agentWork: (projectNames = []) => {
    const params = new URLSearchParams();
    (Array.isArray(projectNames) ? projectNames : [projectNames])
      .filter(Boolean)
      .forEach((projectName) => params.append('projectKey', projectName));
    return authenticatedFetch(`/api/agent-work${params.toString() ? `?${params}` : ''}`);
  },
  piSessionState: (projectName, sessionId, options = {}) => authenticatedFetch(`/api/pi/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}/state`, options),
  piTaskAction: (projectName, sessionId, taskId, action) => authenticatedFetch(`/api/pi/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}/tasks/${encodeURIComponent(taskId)}/${encodeURIComponent(action)}`, { method: 'POST' }),
  piTerminals: (projectName, sessionId) => authenticatedFetch(`/api/pi/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}/terminals`),
  piTerminalRead: (projectName, sessionId, terminalId, cursor = 0) => authenticatedFetch(`/api/pi/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}/terminals/${encodeURIComponent(terminalId)}?cursor=${cursor}`),
  piTerminalAction: (projectName, sessionId, terminalId, action, input = '') => authenticatedFetch(`/api/pi/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}/terminals/${encodeURIComponent(terminalId)}/${encodeURIComponent(action)}`, { method: 'POST', body: JSON.stringify({ input }) }),
  reindexProjectSessions: (projectName, providers = ['codex']) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/sessions/reindex`, {
      method: 'POST',
      body: JSON.stringify({ providers }),
    }),
  projectTags: (projectName, tagType = null) => {
    const params = new URLSearchParams();
    if (tagType) {
      params.append('tagType', tagType);
    }
    const query = params.toString();
    return authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/tags${query ? `?${query}` : ''}`);
  },
  sessionTags: (projectName, sessionId) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}/tags`),
  updateSessionTags: (projectName, sessionId, tagIds) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tagIds }),
    }),
  sessionMessages: (projectName, sessionId, limit = null, offset = 0, provider = 'claude', requestOptions = {}) => {
    const params = new URLSearchParams();
    if (limit !== null) {
      params.append('limit', limit);
      params.append('offset', offset);
    }
    params.append('provider', provider);
    const queryString = params.toString();

    // Route to the correct endpoint based on provider
    let url;
    if (provider === 'codex') {
      url = `/api/codex/sessions/${sessionId}/messages${queryString ? `?${queryString}` : ''}`;
    } else {
      url = `/api/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}/messages${queryString ? `?${queryString}` : ''}`;
    }
    return authenticatedFetch(url, requestOptions);
  },
  sessionContextReview: (projectName, sessionId) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}/context-review`),
  updateSessionContextReview: (projectName, sessionId, reviews) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}/context-review`, {
      method: 'PUT',
      body: JSON.stringify({ reviews }),
    }),
  renameProject: (projectName, displayName) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ displayName }),
    }),
  renameSession: (projectName, sessionId, summary, provider = 'claude') =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ summary, provider }),
    }),
  deleteSession: (projectName, sessionId, provider = 'claude') =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}?provider=${encodeURIComponent(provider)}`, {
      method: 'DELETE',
    }),
  restoreSession: (projectName, sessionId, provider = '') =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}/restore`, {
      method: 'POST',
      body: JSON.stringify(provider ? { provider } : {}),
    }),
  deleteSessionPermanently: (projectName, sessionId, provider = 'claude') =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}?provider=${encodeURIComponent(provider)}&mode=physical`, {
      method: 'DELETE',
    }),
  deleteConsultationSession: (projectName, sessionId, provider = 'claude') =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/consultations/${encodeURIComponent(sessionId)}?provider=${encodeURIComponent(provider)}`, {
      method: 'DELETE',
    }),
  deleteCodexSession: (sessionId) =>
    authenticatedFetch(`/api/codex/sessions/${sessionId}`, {
      method: 'DELETE',
    }),
  deleteProject: (projectName, force = false) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}${force ? '?force=true' : ''}`, {
      method: 'DELETE',
    }),
  restoreProject: (projectName) =>
    authenticatedFetch(`/api/projects/trash/${encodeURIComponent(projectName)}/restore`, {
      method: 'POST',
    }),
  deleteTrashedProject: (projectName, mode = 'logical') =>
    authenticatedFetch(`/api/projects/trash/${encodeURIComponent(projectName)}?mode=${encodeURIComponent(mode)}`, {
      method: 'DELETE',
    }),
  createProject: (path) =>
    authenticatedFetch('/api/projects/create', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  createWorkspace: (workspaceData) =>
    authenticatedFetch('/api/projects/create-workspace', {
      method: 'POST',
      body: JSON.stringify(workspaceData),
    }),
  createConversationWorkspace: () =>
    authenticatedFetch('/api/projects/conversation-workspace', {
      method: 'POST',
    }),
  cleanupConversationWorkspaces: () =>
    authenticatedFetch('/api/projects/conversation-workspace/cleanup', {
      method: 'POST',
    }),
  downloadProjectArchive: (projectName, options = {}) => {
    const params = new URLSearchParams();
    if (options?.scope) {
      params.set('scope', options.scope);
    }
    const query = params.toString();
    return authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/download${query ? `?${query}` : ''}`);
  },
  readFile: (projectName, filePath, options = {}) => {
    const params = new URLSearchParams({ filePath });
    const maxPreviewBytes = options?.maxPreviewBytes;
    if (maxPreviewBytes != null && Number.isFinite(Number(maxPreviewBytes)) && Number(maxPreviewBytes) > 0) {
      params.set('maxPreviewBytes', String(Math.floor(Number(maxPreviewBytes))));
    }
    if (options?.includeInternal) {
      params.set('includeInternal', 'true');
    }
    return authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/file?${params.toString()}`);
  },
  /** Fetch binary file content (e.g. PDF/docx/zip) as Blob. Accepts project-relative or absolute paths. */
  getFileContentBlob: (projectName, filePath, options = {}) => {
    const params = new URLSearchParams({ path: filePath });
    if (options?.format) {
      params.set('format', options.format);
    }
    return authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/files/content?${params.toString()}`).then(async (r) => {
      if (!r.ok) {
        const payload = await r.clone().json().catch(() => null);
        throw new Error(payload?.error || (r.status === 404 ? 'Not found' : `HTTP ${r.status}`));
      }
      return r.blob();
    });
  },
  saveFile: (projectName, filePath, content) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/file`, {
      method: 'PUT',
      body: JSON.stringify({ filePath, content }),
    }),
  createProjectFile: (projectName, parentDir, name) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/file/create`, {
      method: 'POST',
      body: JSON.stringify({ parentDir, name }),
    }),
  renameFile: (projectName, sourcePath, newName) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/file/rename`, {
      method: 'POST',
      body: JSON.stringify({ sourcePath, newName }),
    }),
  copyFile: (projectName, sourcePath, destinationDir) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/file/copy`, {
      method: 'POST',
      body: JSON.stringify({ sourcePath, destinationDir }),
    }),
  moveFile: (projectName, sourcePath, destinationDir) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/file/move`, {
      method: 'POST',
      body: JSON.stringify({ sourcePath, destinationDir }),
    }),
  openInFileManager: (projectName, filePath = '') =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/file/reveal`, {
      method: 'POST',
      body: JSON.stringify({ filePath }),
    }),
  createProjectFolder: (projectName, parentDir, name) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/folder`, {
      method: 'POST',
      body: JSON.stringify({ parentDir, name }),
    }),
  deleteFile: (projectName, filePath) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/file`, {
      method: 'DELETE',
      body: JSON.stringify({ filePath }),
    }),
  getFiles: (projectName, options = {}) => {
    const { path, maxDepth, showHidden, includeInternal, ...fetchOptions } = options || {};
    const params = new URLSearchParams();

    if (typeof path === 'string' && path) {
      params.append('path', path);
    }
    if (maxDepth !== undefined && maxDepth !== null) {
      params.append('maxDepth', String(maxDepth));
    }
    if (showHidden !== undefined && showHidden !== null) {
      params.append('showHidden', String(showHidden));
    }
    if (includeInternal !== undefined && includeInternal !== null) {
      params.append('includeInternal', String(includeInternal));
    }

    const query = params.toString();
    return authenticatedFetch(
      `/api/projects/${encodeURIComponent(projectName)}/files${query ? `?${query}` : ''}`,
      fetchOptions
    );
  },
  transcribe: (formData) =>
    authenticatedFetch('/api/transcribe', {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set Content-Type for FormData
    }),

  // TaskMaster endpoints
  taskmaster: {
    detect: (projectName) =>
      authenticatedFetch(`/api/taskmaster/detect/${encodeURIComponent(projectName)}`),

    // Initialize TaskMaster in a project
    init: (projectName) =>
      authenticatedFetch(`/api/taskmaster/init/${projectName}`, {
        method: 'POST',
      }),

    // Add a new task
    addTask: (projectName, { prompt, title, description, priority, dependencies, stage, insertAfterId }) =>
      authenticatedFetch(`/api/taskmaster/add-task/${projectName}`, {
        method: 'POST',
        body: JSON.stringify({ prompt, title, description, priority, dependencies, stage, insertAfterId }),
      }),

    // Parse PRD to generate tasks
    parsePRD: (projectName, { fileName, numTasks, append }) =>
      authenticatedFetch(`/api/taskmaster/parse-prd/${projectName}`, {
        method: 'POST',
        body: JSON.stringify({ fileName, numTasks, append }),
      }),

    // Get available PRD templates
    getTemplates: () =>
      authenticatedFetch('/api/taskmaster/prd-templates'),

    // Apply a PRD template
    applyTemplate: (projectName, { templateId, fileName, customizations }) =>
      authenticatedFetch(`/api/taskmaster/apply-template/${projectName}`, {
        method: 'POST',
        body: JSON.stringify({ templateId, fileName, customizations }),
      }),

    updateResearchBrief: (projectName, { fileName, updates }) =>
      authenticatedFetch(`/api/taskmaster/research-brief/${projectName}`, {
        method: 'PUT',
        body: JSON.stringify({ fileName, updates }),
      }),

    getKnowledgeBaseManifest: (projectName) =>
      authenticatedFetch(`/api/taskmaster/kb/${encodeURIComponent(projectName)}`),

    bootstrapKnowledgeBase: (projectName) =>
      authenticatedFetch(`/api/taskmaster/kb/${encodeURIComponent(projectName)}/bootstrap`, {
        method: 'POST',
      }),

    ingestNewsItem: (projectName, { item, sourceKey }) =>
      authenticatedFetch(`/api/taskmaster/kb/${encodeURIComponent(projectName)}/news-item`, {
        method: 'POST',
        body: JSON.stringify({ item, sourceKey }),
      }),

    createKnowledgeBaseNote: (projectName, payload) =>
      authenticatedFetch(`/api/taskmaster/kb/${encodeURIComponent(projectName)}/note`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),

    uploadKnowledgeBaseFile: (projectName, file) => {
      const formData = new FormData();
      formData.append('file', file, file.name);
      return authenticatedFetch(`/api/taskmaster/kb/${encodeURIComponent(projectName)}/upload`, {
        method: 'POST',
        body: formData,
        headers: {},
      });
    },

    searchKnowledgeBase: (projectName, { query = '', limit = 12 } = {}) =>
      authenticatedFetch(
        `/api/taskmaster/kb/${encodeURIComponent(projectName)}/search?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(String(limit))}`,
      ),

    // Update a task
    updateTask: (projectName, taskId, updates) =>
      authenticatedFetch(`/api/taskmaster/update-task/${projectName}/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      }),

    // Delete a task
    deleteTask: (projectName, taskId) =>
      authenticatedFetch(`/api/taskmaster/delete-task/${projectName}/${taskId}`, {
        method: 'DELETE',
      }),
  },

  autoResearch: {
    status: (projectName) =>
      authenticatedFetch(`/api/auto-research/${encodeURIComponent(projectName)}/status`),
    start: (projectName, { provider, model, permissionMode, resume, bypassPermissionsConfirmed } = {}) =>
      authenticatedFetch(`/api/auto-research/${encodeURIComponent(projectName)}/start`, {
        method: 'POST',
        body: JSON.stringify({
          provider,
          model,
          permissionMode,
          resume,
          bypassPermissionsConfirmed,
        }),
      }),
    cancel: (projectName) =>
      authenticatedFetch(`/api/auto-research/${encodeURIComponent(projectName)}/cancel`, {
        method: 'POST',
      }),
    createResearchSpecDraft: (projectName) =>
      authenticatedFetch(`/api/auto-research/${encodeURIComponent(projectName)}/research-spec/draft`, {
        method: 'POST',
      }),
    approveResearchSpec: (projectName) =>
      authenticatedFetch(`/api/auto-research/${encodeURIComponent(projectName)}/research-spec/approve`, {
        method: 'POST',
      }),
    changeRequests: (projectName) =>
      authenticatedFetch(`/api/auto-research/${encodeURIComponent(projectName)}/change-requests`),
    createChangeRequest: (projectName, request) =>
      authenticatedFetch(`/api/auto-research/${encodeURIComponent(projectName)}/change-requests`, {
        method: 'POST',
        body: JSON.stringify(request),
      }),
    approveChangeRequest: (projectName, requestId) =>
      authenticatedFetch(`/api/auto-research/${encodeURIComponent(projectName)}/change-requests/${encodeURIComponent(requestId)}/approve`, {
        method: 'POST',
      }),
    rejectChangeRequest: (projectName, requestId) =>
      authenticatedFetch(`/api/auto-research/${encodeURIComponent(projectName)}/change-requests/${encodeURIComponent(requestId)}/reject`, {
        method: 'POST',
      }),
  },

  // Workspace root
  getWorkspaceRoot: () => authenticatedFetch('/api/projects/workspace-root'),
  setWorkspaceRoot: (path) =>
    authenticatedFetch('/api/projects/workspace-root', {
      method: 'PUT',
      body: JSON.stringify({ path }),
    }),
  getDataFoldersSettings: () => authenticatedFetch('/api/projects/data-folders'),
  setDataFoldersSettings: (folders) =>
    authenticatedFetch('/api/projects/data-folders', {
      method: 'PUT',
      body: JSON.stringify({ folders }),
    }),

  // Browse filesystem for project suggestions
  /**
   * @param {string | null} dirPath
   * @param {boolean} showHidden
   */
  browseFilesystem: (dirPath = null, showHidden = false, options = {}) => {
    const params = new URLSearchParams();
    if (dirPath) params.append('path', dirPath);
    if (showHidden) params.append('showHidden', 'true');
    if (options?.purpose) params.append('purpose', options.purpose);

    return authenticatedFetch(`/api/browse-filesystem?${params}`);
  },

  createFolder: (folderPath, options = {}) => {
    const params = new URLSearchParams();
    if (options?.purpose) params.append('purpose', options.purpose);
    const query = params.toString();
    return authenticatedFetch(`/api/create-folder${query ? `?${query}` : ''}`, {
      method: 'POST',
      body: JSON.stringify({ path: folderPath }),
    });
  },

  environmentSetup: {
    status: () => authenticatedFetch('/api/environment-setup'),
    detect: () => authenticatedFetch('/api/environment-setup/detect', { method: 'POST' }),
    validate: (config) => authenticatedFetch('/api/environment-setup/validate', {
      method: 'POST',
      body: JSON.stringify(config || {}),
    }),
    save: (config) => authenticatedFetch('/api/environment-setup', {
      method: 'PUT',
      body: JSON.stringify(config || {}),
    }),
  },

  // User endpoints
  user: {
    profile: () => authenticatedFetch('/api/user/profile'),
    updateProfile: (profile) =>
      authenticatedFetch('/api/user/profile', {
        method: 'PUT',
        body: JSON.stringify(
          typeof profile === 'string'
            ? { notificationEmail: profile }
            : (profile || {}),
        ),
      }),
    updateAvatar: (avatarId) =>
      authenticatedFetch('/api/user/profile', {
        method: 'PUT',
        body: JSON.stringify({ avatarId }),
      }),
    uploadAvatar: (file) => {
      const formData = new FormData();
      formData.append('avatar', file);
      return authenticatedFetch('/api/user/avatar', {
        method: 'POST',
        body: formData,
        headers: {},
      });
    },
    projectActivity: (params) => {
      const query = new URLSearchParams(params || {}).toString();
      return authenticatedFetch(`/api/user/project-activity${query ? `?${query}` : ''}`);
    },
    recordProjectOpen: (project, source = 'project_select') =>
      authenticatedFetch('/api/user/project-activity/open', {
        method: 'POST',
        body: JSON.stringify({
          projectId: project?.name,
          projectPath: project?.fullPath || project?.path,
          displayName: project?.displayName,
          source,
        }),
      }),
    changePassword: (currentPassword, newPassword) =>
      authenticatedFetch('/api/user/password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      }),
    gitConfig: () => authenticatedFetch('/api/user/git-config'),
    updateGitConfig: (gitName, gitEmail) =>
      authenticatedFetch('/api/user/git-config', {
        method: 'POST',
        body: JSON.stringify({ gitName, gitEmail }),
      }),
    onboardingStatus: () => authenticatedFetch('/api/user/onboarding-status'),
    completeOnboarding: () =>
      authenticatedFetch('/api/user/complete-onboarding', {
        method: 'POST',
      }),
  },

  // Global skills endpoints
  getGlobalSkills: () => authenticatedFetch('/api/skills'),
  getSkillMentionCandidates: () => authenticatedFetch('/api/skills/mentions'),
  readGlobalSkillFile: (filePath) =>
    authenticatedFetch(`/api/skills/file?filePath=${encodeURIComponent(filePath)}`),
  uploadFiles: (projectName, formData) =>
    authenticatedFetch(`/api/projects/${encodeURIComponent(projectName)}/upload-files`, {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set multipart boundary
    }),
  validateSkillZip: (projectName, formData) =>
    authenticatedFetch(`/api/skills${projectName ? `/${encodeURIComponent(projectName)}` : ''}/validate-skill-zip`, {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set multipart boundary
    }),
  uploadSkill: (projectName, formData) =>
    authenticatedFetch(`/api/skills${projectName ? `/${encodeURIComponent(projectName)}` : ''}/upload-skill`, {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set multipart boundary
    }),
  scanLocalSkills: (dirPath) =>
    authenticatedFetch(`/api/skills/scan-local?path=${encodeURIComponent(dirPath)}`),
  importLocalSkills: (sourcePath, skillNames, projectName) =>
    authenticatedFetch('/api/skills/import-from-local', {
      method: 'POST',
      body: JSON.stringify({ sourcePath, skillNames, projectName }),
    }),
  listSkillMarket: ({ query = '', source = 'all', limit = 24 } = {}) => {
    const search = new URLSearchParams();
    if (query) search.set('q', query);
    if (source && source !== 'all') search.set('source', source);
    search.set('limit', String(limit));
    return authenticatedFetch(`/api/skills/market?${search.toString()}`);
  },
  getSkillMarketDetail: (source, slug) =>
    authenticatedFetch(`/api/skills/market/${encodeURIComponent(source)}/${encodeURIComponent(slug)}`),
  installSkillMarket: (id, projectName) =>
    authenticatedFetch('/api/skills/market/install', {
      method: 'POST',
      body: JSON.stringify({ id, projectName: projectName || null }),
    }),
  uninstallSkillMarket: (source, slug) =>
    authenticatedFetch(`/api/skills/market/${encodeURIComponent(source)}/${encodeURIComponent(slug)}`, {
      method: 'DELETE',
    }),

  // News dashboard endpoints
  news: {
    getBootstrap: () => authenticatedFetch('/api/news/bootstrap'),
    getSources: () => authenticatedFetch('/api/news/sources'),
    getConfig: (source = 'arxiv') => authenticatedFetch(`/api/news/config/${source}`),
    updateConfig: (source, config) =>
      authenticatedFetch(`/api/news/config/${source}`, {
        method: 'PUT',
        body: JSON.stringify(config),
      }),
    resetConfig: (source) =>
      authenticatedFetch(`/api/news/config/${source}`, {
        method: 'DELETE',
      }),
    search: (source = 'arxiv', configOverride, fetchOptions = {}) =>
      authenticatedFetch(`/api/news/search/${source}`, {
        ...fetchOptions,
        method: 'POST',
        body: configOverride ? JSON.stringify({ configOverride }) : undefined,
      }),
    getResults: (source = 'arxiv') => authenticatedFetch(`/api/news/results/${source}`),
    /** Poll search progress logs for a source. */
    getLogs: (source) => authenticatedFetch(`/api/news/logs/${source}`),
  },
  pubmedDiscovery: {
    getState: (key) => authenticatedFetch(`/api/pubmed-discovery/state/${encodeURIComponent(key)}`, {
      cache: 'no-store',
    }),
    getAllState: () => authenticatedFetch('/api/pubmed-discovery/state', {
      cache: 'no-store',
    }),
    saveState: (key, payload) => authenticatedFetch(`/api/pubmed-discovery/state/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ payload }),
    }),
    extract: (payload, fetchOptions = {}) => authenticatedFetch('/api/pubmed-discovery/extract', {
      ...fetchOptions,
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    trend: (payload) => authenticatedFetch('/api/pubmed-discovery/trend', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  },

  // References (literature library) endpoints
  references: {
    list: (params) => authenticatedFetch(`/api/references?${new URLSearchParams(params || {})}`, { cache: 'no-store' }),
    get: (id) => authenticatedFetch(`/api/references/${encodeURIComponent(id)}`),
    delete: (id) => authenticatedFetch(`/api/references/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    getPdf: (id) => authenticatedFetch(`/api/references/${encodeURIComponent(id)}/pdf`),
    syncZotero: ({ projectName, collectionKey, sourceIds } = {}) => authenticatedFetch('/api/references/sync/zotero', { method: 'POST', body: JSON.stringify({ projectName, collectionKey, sourceIds }) }),
    zoteroItems: (params) => {
      const qs = new URLSearchParams();
      if (params?.collectionKey) qs.set('collectionKey', params.collectionKey);
      if (params?.limit) qs.set('limit', String(params.limit));
      if (params?.start) qs.set('start', String(params.start));
      return authenticatedFetch(`/api/references/zotero/items?${qs}`);
    },
    importBibtex: (formData) => authenticatedFetch('/api/references/import/bibtex', { method: 'POST', body: formData, headers: {} }),
    zoteroStatus: () => authenticatedFetch('/api/references/zotero/status'),
    zoteroCollections: () => authenticatedFetch('/api/references/zotero/collections'),
    importPubmed: (item, folderId = /** @type {string | null} */ (null)) => authenticatedFetch('/api/references/import/pubmed', { method: 'POST', body: JSON.stringify({ item, folderId }) }),
    projectRefs: (projectName) => authenticatedFetch(`/api/references/project/${encodeURIComponent(projectName)}`),
    aggregatedProjectRefs: (projectName) => authenticatedFetch(`/api/references/project/${encodeURIComponent(projectName)}/aggregate`),
    linkToProject: (projectName, refId) => authenticatedFetch(`/api/references/project/${encodeURIComponent(projectName)}/${encodeURIComponent(refId)}`, { method: 'POST' }),
    unlinkFromProject: (projectName, refId) => authenticatedFetch(`/api/references/project/${encodeURIComponent(projectName)}/${encodeURIComponent(refId)}`, { method: 'DELETE' }),
    bulkDelete: (ids) => authenticatedFetch('/api/references/bulk-delete', { method: 'POST', body: JSON.stringify({ ids }) }),
    folders: () => authenticatedFetch('/api/references/folders', { cache: 'no-store' }),
    createFolder: (name, parentId = null) => authenticatedFetch('/api/references/folders', { method: 'POST', body: JSON.stringify({ name, parentId }) }),
    renameFolder: (folderId, name) => authenticatedFetch(`/api/references/folders/${encodeURIComponent(folderId)}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
    deleteFolder: (folderId) => authenticatedFetch(`/api/references/folders/${encodeURIComponent(folderId)}`, { method: 'DELETE' }),
    addToFolder: (folderId, referenceIds) => authenticatedFetch(`/api/references/folders/${encodeURIComponent(folderId)}/references`, { method: 'POST', body: JSON.stringify({ referenceIds }) }),
    removeFromFolder: (folderId, referenceId) => authenticatedFetch(`/api/references/folders/${encodeURIComponent(folderId)}/references/${encodeURIComponent(referenceId)}`, { method: 'DELETE' }),
    removeFromAllFolders: (referenceId) => authenticatedFetch(`/api/references/folders/references/${encodeURIComponent(referenceId)}`, { method: 'DELETE' }),
    tags: () => authenticatedFetch('/api/references/tags'),
  },

  medLibrary: {
    overview: () => authenticatedFetch('/api/med-library/overview'),
    projectMemory: () => authenticatedFetch('/api/med-library/project-memory'),
    projectMemoryFile: (projectName) =>
      authenticatedFetch(`/api/med-library/project-memory-file?projectName=${encodeURIComponent(projectName)}`),
    createLesson: (body) =>
      authenticatedFetch('/api/med-library/lessons', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateLesson: (slug, body) =>
      authenticatedFetch(`/api/med-library/lessons/${encodeURIComponent(slug)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    deleteLesson: (slug, projectName) =>
      authenticatedFetch(
        `/api/med-library/lessons/${encodeURIComponent(slug)}?projectName=${encodeURIComponent(projectName)}`,
        { method: 'DELETE' },
      ),
    draftLessons: (body) =>
      authenticatedFetch('/api/med-library/lessons/draft', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    createOperatingAsset: (body) =>
      authenticatedFetch('/api/med-library/operating-assets', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    updateOperatingAsset: (id, body) =>
      authenticatedFetch(`/api/med-library/operating-assets/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    deleteOperatingAsset: (id) =>
      authenticatedFetch(`/api/med-library/operating-assets/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    reportPreview: () => authenticatedFetch('/api/med-library/report-preview'),
    reportPreviewContent: (id) =>
      authenticatedFetch(`/api/med-library/report-preview/${encodeURIComponent(id)}/content`).then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          const retryAfterSeconds = Number(data?.retryAfterSeconds);
          const retryText = r.status === 429 && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? ` Retry after ${Math.ceil(retryAfterSeconds)}s.`
            : '';
          const message = typeof data?.error === 'string' && data.error.trim()
            ? data.error.trim()
            : (r.status === 404 ? 'Not found' : `HTTP ${r.status}`);
          throw new Error(`${message}${retryText}`);
        }
        return r.blob();
      }),
  },

  concepts: {
    list: (params) => {
      const query = new URLSearchParams(params || {}).toString();
      return authenticatedFetch(`/api/concepts${query ? `?${query}` : ''}`);
    },
    get: (id) => authenticatedFetch(`/api/concepts/${encodeURIComponent(id)}`),
    create: (payload) => authenticatedFetch('/api/concepts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    update: (id, payload) => authenticatedFetch(`/api/concepts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
    delete: (id) => authenticatedFetch(`/api/concepts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
    evidence: (id, params) => {
      const query = new URLSearchParams(params || {}).toString();
      return authenticatedFetch(`/api/concepts/${encodeURIComponent(id)}/evidence${query ? `?${query}` : ''}`);
    },
    addEvidence: (id, payload) => authenticatedFetch(`/api/concepts/${encodeURIComponent(id)}/evidence`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  },

  monitor: {
    candidates: (params) => {
      const query = new URLSearchParams(params || {}).toString();
      return authenticatedFetch(`/api/monitor/candidates${query ? `?${query}` : ''}`);
    },
    scheduler: () => authenticatedFetch('/api/monitor/scheduler'),
    updateScheduler: (payload) => authenticatedFetch('/api/monitor/scheduler', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
    runScheduler: (sourceKey) => authenticatedFetch('/api/monitor/scheduler/run', {
      method: 'POST',
      body: JSON.stringify({ source_key: sourceKey }),
    }),
    extractReferences: (referenceIds, extraction) => authenticatedFetch('/api/monitor/extract-references', {
      method: 'POST',
      body: JSON.stringify({ reference_ids: referenceIds, extraction, strict_llm: true }),
    }),
    acceptCandidate: (id, payload) => authenticatedFetch(`/api/monitor/candidates/${encodeURIComponent(id)}/accept`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
    rejectCandidate: (id, payload) => authenticatedFetch(`/api/monitor/candidates/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
  },

  // Generic GET method for any endpoint
  get: (endpoint, options = {}) => authenticatedFetch(`/api${endpoint}`, options),

  // Compute node management
  compute: {
    getNodes: () => authenticatedFetch('/api/compute/nodes'),
    addNode: (node) => authenticatedFetch('/api/compute/nodes', { method: 'POST', body: JSON.stringify(node) }),
    updateNode: (id, node) => authenticatedFetch(`/api/compute/nodes/${id}`, { method: 'PUT', body: JSON.stringify(node) }),
    deleteNode: (id) => authenticatedFetch(`/api/compute/nodes/${id}`, { method: 'DELETE' }),
    setActive: (id) => id
      ? authenticatedFetch(`/api/compute/nodes/${id}/active`, { method: 'POST' })
      : authenticatedFetch('/api/compute/active', { method: 'POST', body: JSON.stringify({ nodeId: null }) }),
    testNode: (id) => authenticatedFetch(`/api/compute/nodes/${id}/test`, { method: 'POST' }),
    syncNode: (id, direction, cwd) => authenticatedFetch(`/api/compute/nodes/${id}/sync`, { method: 'POST', body: JSON.stringify({ direction, cwd }) }),
    runOnNode: (id, command, cwd, skipSync) => authenticatedFetch(`/api/compute/nodes/${id}/run`, { method: 'POST', body: JSON.stringify({ command, cwd, skipSync }) }),
    slurmInfo: (id) => authenticatedFetch(`/api/compute/nodes/${id}/slurm/info`),
    slurmQueue: (id) => authenticatedFetch(`/api/compute/nodes/${id}/slurm/queue`),
    slurmSalloc: (id, opts) => authenticatedFetch(`/api/compute/nodes/${id}/slurm/salloc`, { method: 'POST', body: JSON.stringify(opts) }),
    slurmSbatch: (id, opts) => authenticatedFetch(`/api/compute/nodes/${id}/slurm/sbatch`, { method: 'POST', body: JSON.stringify(opts) }),
    slurmCancel: (id, jobId) => authenticatedFetch(`/api/compute/nodes/${id}/slurm/cancel/${jobId}`, { method: 'POST' }),
    monitorNode: (id) => authenticatedFetch(`/api/compute/nodes/${id}/monitor`),
    // Backward-compatible
    getConfig: () => authenticatedFetch('/api/compute/config'),
    configure: (config) => authenticatedFetch('/api/compute/configure', { method: 'POST', body: JSON.stringify(config) }),
    test: () => authenticatedFetch('/api/compute/test', { method: 'POST' }),
    sync: (direction, cwd) => authenticatedFetch('/api/compute/sync', { method: 'POST', body: JSON.stringify({ direction, cwd }) }),
    run: (command, cwd, skipSync) => authenticatedFetch('/api/compute/run', { method: 'POST', body: JSON.stringify({ command, cwd, skipSync }) }),
    status: () => authenticatedFetch('/api/compute/status'),
  },
};
