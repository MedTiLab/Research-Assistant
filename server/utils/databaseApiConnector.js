import {
  getDatabaseApiConnectionStateForUser,
  getDatabaseApiCredentialForUser,
  normalizeDatabaseApiBaseUrl,
  saveDatabaseApiConnectionStateForUser,
} from './databaseApiAgentEnv.js';

const CONNECTION_CACHE_TTL_MS = 60_000;
const CONNECTION_TIMEOUT_MS = 5_000;

function countAccessibleSources(payload) {
  const sources = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.sources)
      ? payload.sources
      : null;
  return sources ? sources.length : null;
}

function connectionResult(status, extra = {}) {
  return {
    connected: status === 'connected',
    status,
    verifiedAt: new Date().toISOString(),
    accessibleSourceCount: null,
    ...extra,
  };
}

export async function verifyDatabaseApiConnection({
  baseUrl,
  token,
  fetchImpl = globalThis.fetch,
  timeoutMs = CONNECTION_TIMEOUT_MS,
} = {}) {
  const normalizedBaseUrl = normalizeDatabaseApiBaseUrl(baseUrl);
  const normalizedToken = typeof token === 'string' ? token.trim() : '';
  if (!normalizedBaseUrl || !normalizedToken) {
    return connectionResult('not_configured');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${normalizedBaseUrl}/api/v1/sources`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${normalizedToken}`,
        'Cache-Control': 'no-cache',
      },
      signal: controller.signal,
    });

    if (response.status === 401) {
      return connectionResult('invalid_credentials');
    }
    if (response.status === 403) {
      return connectionResult('access_denied');
    }
    if (!response.ok) {
      return connectionResult('unavailable');
    }

    const payload = await response.json().catch(() => null);
    const accessibleSourceCount = countAccessibleSources(payload);
    if (accessibleSourceCount === null) {
      return connectionResult('invalid_response');
    }
    if (accessibleSourceCount === 0) {
      return connectionResult('access_denied', { accessibleSourceCount: 0 });
    }
    return connectionResult('connected', { accessibleSourceCount });
  } catch {
    return connectionResult('unavailable');
  } finally {
    clearTimeout(timer);
  }
}

export async function ensureDatabaseApiConnectionForUser(userId, options = {}) {
  const credential = getDatabaseApiCredentialForUser(userId);
  if (!credential.tokenConfigured) {
    return getDatabaseApiConnectionStateForUser(userId);
  }

  const currentState = getDatabaseApiConnectionStateForUser(userId);
  const verifiedAtMs = Date.parse(currentState.verifiedAt || '');
  const isFresh = Number.isFinite(verifiedAtMs)
    && Date.now() - verifiedAtMs < CONNECTION_CACHE_TTL_MS;
  if (!options.force && currentState.status !== 'unverified' && isFresh) {
    return currentState;
  }

  const result = await verifyDatabaseApiConnection({
    baseUrl: credential.baseUrl,
    token: credential.token,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
  });
  return saveDatabaseApiConnectionStateForUser(userId, result);
}
