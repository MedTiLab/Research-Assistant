import { withLoopbackTargetAddressSpace } from '../utils/localNetworkAccess';

export type LocalKernelEndpoint = {
  httpBaseUrl: string;
  wsBaseUrl: string;
  host: string;
  port: string;
  source: 'url' | 'stored' | 'default';
};

export type LocalKernelHealth = {
  ok?: boolean;
  status?: string;
  product?: string;
  version?: string;
  kernelId?: string;
};

export const LOCAL_NETWORK_ACCESS_REQUIRED_ERROR = 'local_network_access_required';
export const LOCAL_NETWORK_ACCESS_DENIED_ERROR = 'local_network_access_denied';

export type LocalKernelStatus = {
  ok?: boolean;
  product?: string;
  version?: string;
  kernelId?: string;
  sessionActive?: boolean;
  permissionMode?: string | null;
  workspaceScope?: string | null;
  platform?: string;
  arch?: string;
  updateCapability?: {
    supported: boolean;
    platform: string;
    installMode: string;
    reason?: string | null;
  };
  host?: string;
  port?: number;
};

export type LocalSessionStartResult = {
  ok?: boolean;
  sessionToken?: string;
  expiresAt?: string;
  permissionMode?: string;
  workspaceScope?: string | null;
};

export type LocalKernelUpdateStartResult = {
  accepted: boolean;
  currentVersion: string;
  targetVersion: string;
  restartExpected: boolean;
  manualRestartRequired?: boolean;
};

export type LocalKernelUpdateProgress = {
  state?: 'checking' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'restarting' | 'awaiting_manual_restart' | 'completed' | 'failed';
  progress?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  downloadPercent?: number;
  currentVersion?: string;
  targetVersion?: string;
  error?: string;
  updatedAt?: string;
};

const DEFAULT_LOCAL_KERNEL_PORT = 5055;
const LOCAL_KERNEL_DISCOVERY_ATTEMPTS = 101;
const BROWSER_BLOCKED_LOCAL_KERNEL_PORTS = new Set([5060, 5061]);
const DEFAULT_LOCAL_KERNEL_WS_URL = `ws://127.0.0.1:${DEFAULT_LOCAL_KERNEL_PORT}`;
const LAST_ENDPOINT_KEY = 'medhelp.localKernel.lastEndpoint';
const SESSION_TOKEN_PREFIX = 'medhelp.localKernel.sessionToken:';

function stripIpv6Brackets(hostname: string) {
  return hostname.replace(/^\[/, '').replace(/\]$/, '');
}

function formatHostForUrl(hostname: string) {
  const stripped = stripIpv6Brackets(hostname);
  return stripped.includes(':') ? `[${stripped}]` : stripped;
}

export function isAllowedLoopbackHostname(hostname: string | null | undefined) {
  const normalized = stripIpv6Brackets(String(hostname || '').trim().toLowerCase());
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

export function isBrowserBlockedLocalKernelPort(port: string | number | null | undefined) {
  const normalizedPort = Number(port);
  return Number.isInteger(normalizedPort) && BROWSER_BLOCKED_LOCAL_KERNEL_PORTS.has(normalizedPort);
}

function getSearchParamsFromHash(hash: string) {
  const queryIndex = hash.indexOf('?');
  if (queryIndex < 0) {
    return new URLSearchParams();
  }
  return new URLSearchParams(hash.slice(queryIndex + 1));
}

function normalizeEndpointInput(input: string) {
  const trimmed = String(input || '').trim();
  if (!trimmed) {
    return null;
  }

  if (/^wss?:\/\//i.test(trimmed) || /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `http://${trimmed}`;
}

export function parseLocalKernelEndpoint(
  input: string | null | undefined,
  source: LocalKernelEndpoint['source'] = 'default',
): { endpoint: LocalKernelEndpoint | null; error: string | null } {
  const normalizedInput = normalizeEndpointInput(input || DEFAULT_LOCAL_KERNEL_WS_URL);
  if (!normalizedInput) {
    return { endpoint: null, error: 'empty_endpoint' };
  }

  let parsed: URL;
  try {
    parsed = new URL(normalizedInput);
  } catch {
    return { endpoint: null, error: 'invalid_endpoint' };
  }

  if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
    return { endpoint: null, error: 'unsupported_protocol' };
  }

  if (!isAllowedLoopbackHostname(parsed.hostname)) {
    return { endpoint: null, error: 'non_loopback_host' };
  }

  const host = stripIpv6Brackets(parsed.hostname).toLowerCase();
  const formattedHost = formatHostForUrl(host);
  const port = parsed.port || '5055';
  if (isBrowserBlockedLocalKernelPort(port)) {
    return { endpoint: null, error: 'blocked_port' };
  }

  const isSecure = parsed.protocol === 'https:' || parsed.protocol === 'wss:';
  const httpProtocol = isSecure ? 'https:' : 'http:';
  const wsProtocol = isSecure ? 'wss:' : 'ws:';

  return {
    endpoint: {
      httpBaseUrl: `${httpProtocol}//${formattedHost}:${port}`,
      wsBaseUrl: `${wsProtocol}//${formattedHost}:${port}`,
      host,
      port,
      source,
    },
    error: null,
  };
}

function dedupeEndpoints(endpoints: LocalKernelEndpoint[]) {
  const seen = new Set<string>();
  return endpoints.filter((endpoint) => {
    if (seen.has(endpoint.httpBaseUrl)) {
      return false;
    }
    seen.add(endpoint.httpBaseUrl);
    return true;
  });
}

export function getStoredLocalKernelEndpoint() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage.getItem(LAST_ENDPOINT_KEY);
  } catch {
    return null;
  }
}

export function rememberLocalKernelEndpoint(endpoint: LocalKernelEndpoint) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(LAST_ENDPOINT_KEY, endpoint.httpBaseUrl);
  } catch {
    // Storage can be unavailable in private contexts.
  }
}

export function resolvePreferredLocalKernelEndpoint(_config: unknown = {}) {
  const endpoints = resolvePreferredLocalKernelEndpoints();
  return endpoints[0]
    ? { endpoint: endpoints[0], error: null }
    : { endpoint: null, error: 'invalid_endpoint' };
}

export function resolvePreferredLocalKernelEndpoints(_config: unknown = {}) {
  const candidates: LocalKernelEndpoint[] = [];

  if (typeof window !== 'undefined') {
    const searchParams = new URLSearchParams(window.location.search);
    const hashParams = getSearchParamsFromHash(window.location.hash || '');
    const urlHint =
      searchParams.get('ws') ||
      searchParams.get('local') ||
      hashParams.get('ws') ||
      hashParams.get('local');

    if (urlHint) {
      const parsedUrlHint = parseLocalKernelEndpoint(urlHint, 'url');
      if (parsedUrlHint.endpoint) {
        candidates.push(parsedUrlHint.endpoint);
      }
    }

    const stored = getStoredLocalKernelEndpoint();
    if (stored) {
      const parsedStored = parseLocalKernelEndpoint(stored, 'stored');
      if (parsedStored.endpoint) {
        candidates.push(parsedStored.endpoint);
      }
    }
  }

  const configuredDefault = parseLocalKernelEndpoint(DEFAULT_LOCAL_KERNEL_WS_URL, 'default');
  if (configuredDefault.endpoint) {
    candidates.push(configuredDefault.endpoint);
  }

  for (let offset = 0; offset < LOCAL_KERNEL_DISCOVERY_ATTEMPTS; offset += 1) {
    const parsedCandidate = parseLocalKernelEndpoint(
      `http://127.0.0.1:${DEFAULT_LOCAL_KERNEL_PORT + offset}`,
      'default',
    );
    if (parsedCandidate.endpoint) {
      candidates.push(parsedCandidate.endpoint);
    }
  }

  return dedupeEndpoints(candidates);
}

function buildSessionTokenKey(endpoint: LocalKernelEndpoint) {
  return `${SESSION_TOKEN_PREFIX}${endpoint.httpBaseUrl}`;
}

export function getStoredLocalSessionToken(endpoint: LocalKernelEndpoint | null) {
  if (!endpoint || typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage.getItem(buildSessionTokenKey(endpoint));
  } catch {
    return null;
  }
}

export function storeLocalSessionToken(endpoint: LocalKernelEndpoint, token: string) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.setItem(buildSessionTokenKey(endpoint), token);
  } catch {
    // Session storage is best-effort only.
  }
}

export function clearLocalSessionToken(endpoint: LocalKernelEndpoint | null) {
  if (!endpoint || typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.removeItem(buildSessionTokenKey(endpoint));
  } catch {
    // Ignore storage failures.
  }
}

async function fetchJsonWithTimeout<T>(
  url: string,
  options: RequestInit = {},
  timeoutMs = 1800,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, withLoopbackTargetAddressSpace(url, {
      cache: 'no-store',
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...(options.headers || {}),
      },
      signal: controller.signal,
    }));
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error((payload as { error?: string })?.error || `HTTP ${response.status}`);
      (error as Error & { status?: number; payload?: unknown }).status = response.status;
      (error as Error & { status?: number; payload?: unknown }).payload = payload;
      throw error;
    }
    return payload as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function probeLocalKernel(endpoint: LocalKernelEndpoint, timeoutMs?: number) {
  return fetchJsonWithTimeout<LocalKernelHealth>(`${endpoint.httpBaseUrl}/health`, {}, timeoutMs)
    .then((health) => {
      if (health?.ok !== true || health?.product !== 'MedHelp Kernel') {
        throw new Error('not_medhelp_local_kernel');
      }
      return health;
    });
}

export function getLocalKernelStatus(endpoint: LocalKernelEndpoint, sessionToken?: string | null) {
  const headers: Record<string, string> = sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
  return fetchJsonWithTimeout<LocalKernelStatus>(`${endpoint.httpBaseUrl}/api/local/status`, {
    headers,
  });
}

export function startLocalSession(
  endpoint: LocalKernelEndpoint,
  payload: {
    cloudUserId?: string | number | null;
    cloudAccessToken?: string | null;
    cloudBaseUrl?: string | null;
    origin?: string;
    browserNonce: string;
    requestedPermissionMode: string;
  },
) {
  return fetchJsonWithTimeout<LocalSessionStartResult>(`${endpoint.httpBaseUrl}/api/local/session/start`, {
    method: 'POST',
    body: JSON.stringify(payload),
  // Older cloud responses require separate device and identity checks, each
  // bounded to 8 seconds by the Kernel. Let it return a useful failure first.
  }, 20_000);
}

export function refreshLocalSessionCloudAuth(
  endpoint: LocalKernelEndpoint,
  sessionToken: string,
  payload: {
    cloudUserId?: string | number | null;
    cloudAccessToken: string;
    cloudBaseUrl?: string | null;
    origin?: string;
  },
) {
  return fetchJsonWithTimeout<{ ok?: boolean; updated?: boolean }>(
    `${endpoint.httpBaseUrl}/api/local/session/cloud-auth`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify(payload),
    },
    20_000,
  );
}

export function revokeLocalSession(endpoint: LocalKernelEndpoint, sessionToken: string | null) {
  return fetchJsonWithTimeout<{ ok?: boolean }>(`${endpoint.httpBaseUrl}/api/local/session/revoke`, {
    method: 'POST',
    headers: sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {},
    body: JSON.stringify({}),
  }, 3000);
}

export function shutdownLocalKernel(endpoint: LocalKernelEndpoint, sessionToken: string) {
  return fetchJsonWithTimeout<{ ok?: boolean; shuttingDown?: boolean }>(
    `${endpoint.httpBaseUrl}/api/local/shutdown`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({}),
    },
    5000,
  );
}

export function getLocalKernelUpdateProgress(endpoint: LocalKernelEndpoint, sessionToken: string) {
  return fetchJsonWithTimeout<{ ok?: boolean; update?: LocalKernelUpdateProgress | null }>(
    `${endpoint.httpBaseUrl}/api/local/update/status`,
    {
      headers: { Authorization: `Bearer ${sessionToken}` },
    },
    2500,
  );
}

export function startLocalKernelUpdate(endpoint: LocalKernelEndpoint, sessionToken: string) {
  return fetchJsonWithTimeout<LocalKernelUpdateStartResult>(
    `${endpoint.httpBaseUrl}/api/local/update`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({}),
    },
    10 * 60 * 1000,
  );
}

export function buildLocalKernelWebSocketUrl(endpoint: LocalKernelEndpoint, sessionToken: string) {
  return `${endpoint.wsBaseUrl}/ws/local?token=${encodeURIComponent(sessionToken)}`;
}
