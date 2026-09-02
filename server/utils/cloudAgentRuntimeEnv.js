const RUNTIME_ENV_CACHE_TTL_MS = 60 * 1000;
const RUNTIME_ENV_FETCH_TIMEOUT_MS = 3500;
const USER_PREFERENCE_CACHE_TTL_MS = 15 * 1000;
const USER_PREFERENCE_FETCH_TIMEOUT_MS = 3500;
const USER_MEMORY_CACHE_TTL_MS = 15 * 1000;
const CAPABILITY_FETCH_TIMEOUT_MS = 3500;
const MAX_RUNTIME_ENV_VALUE_LENGTH = 20_000;
const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const USER_PREFERENCE_CATEGORIES = new Set(['general', 'preference', 'context', 'workflow']);
const USER_PREFERENCE_SCOPES = new Set(['user', 'project']);
const ANALYSIS_LANGUAGE_PREFERENCES = new Set(['auto', 'python', 'r']);

function normalizeCloudBaseUrl(value, fallbackOrigin = null) {
  const candidate = String(value || fallbackOrigin || 'https://app.medtimehelp.com')
    .trim()
    .replace(/\/+$/, '');
  try {
    const url = new URL(candidate);
    if (!['https:', 'http:'].includes(url.protocol)) {
      return 'https://app.medtimehelp.com';
    }
    return url.origin;
  } catch {
    return 'https://app.medtimehelp.com';
  }
}

function sanitizeRuntimeEnv(env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    return {};
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(env)) {
    if (!ENV_NAME_PATTERN.test(key)) {
      continue;
    }
    if (typeof value !== 'string') {
      continue;
    }
    if (value.length > MAX_RUNTIME_ENV_VALUE_LENGTH) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

function sanitizeText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export function sanitizeCloudUserPreferenceContext(payload) {
  const memories = Array.isArray(payload?.memories)
    ? payload.memories.slice(0, 20).map((memory) => {
      const scope = USER_PREFERENCE_SCOPES.has(memory?.scope) ? memory.scope : 'user';
      const category = USER_PREFERENCE_CATEGORIES.has(memory?.category) ? memory.category : 'general';
      return {
        id: Number.isFinite(Number(memory?.id)) ? Number(memory.id) : null,
        content: sanitizeText(memory?.content, 300),
        category,
        scope,
        projectPath: scope === 'project' ? sanitizeText(memory?.projectPath, 2000) || null : null,
        projectKey: scope === 'project' ? sanitizeText(memory?.projectKey, 240) || null : null,
        updatedAt: sanitizeText(memory?.updatedAt, 80) || null,
      };
    }).filter((memory) => memory.content)
    : [];
  const analysisLanguagePreference = ANALYSIS_LANGUAGE_PREFERENCES.has(payload?.analysisLanguagePreference)
    ? payload.analysisLanguagePreference
    : 'auto';

  return {
    enabled: payload?.enabled !== false,
    aboutYou: sanitizeText(payload?.aboutYou, 1200),
    analysisLanguagePreference,
    autoResearchSenderEmail: sanitizeText(payload?.autoResearchSenderEmail, 320),
    memories,
    syncedAt: sanitizeText(payload?.syncedAt, 80) || null,
  };
}

export function sanitizeCloudUserMemoryContext(payload) {
  const memories = Array.isArray(payload?.memories)
    ? payload.memories.slice(0, 300).map((memory) => ({
      id: Number.isFinite(Number(memory?.id)) ? Number(memory.id) : null,
      content: sanitizeText(memory?.content, 240),
      source: memory?.source === 'manual' ? 'manual' : 'automatic',
      pinned: memory?.pinned === true,
      conversationId: sanitizeText(memory?.conversationId, 240) || null,
      updatedAt: sanitizeText(memory?.updatedAt, 80) || null,
    })).filter((memory) => memory.content)
    : [];
  return {
    enabled: payload?.enabled !== false,
    autoCaptureEnabled: payload?.autoCaptureEnabled !== false,
    memories,
    syncedAt: sanitizeText(payload?.syncedAt, 80) || null,
  };
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = RUNTIME_ENV_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error || `HTTP ${response.status}`);
      error.statusCode = response.status;
      throw error;
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export function mergeAgentRuntimeEnv(baseEnv = process.env, runtimeEnv = {}) {
  const sanitized = sanitizeRuntimeEnv(runtimeEnv);
  if (!Object.keys(sanitized).length) {
    return baseEnv;
  }
  return {
    ...(baseEnv || {}),
    ...sanitized,
  };
}

export function getAgentRuntimeEnvState(env = {}) {
  return {
    databaseApiTokenConfigured: Boolean(env.MEDHELP_DATABASE_API_TOKEN || env.DATABASE_API_TOKEN),
    databaseApiBaseUrl: env.MEDHELP_DATABASE_API_URL || env.DATABASE_API_URL || null,
    databaseApiConnectionStatus: env.MEDHELP_DATABASE_API_CONNECTION_STATUS || null,
    databaseApiConnectionVerifiedAt: env.MEDHELP_DATABASE_API_CONNECTION_VERIFIED_AT || null,
    databaseApiAccessibleSourceCount: env.MEDHELP_DATABASE_API_ACCESSIBLE_SOURCE_COUNT || null,
    keyCount: Object.keys(env || {}).length,
  };
}

export async function authorizeCloudCapability(session, capability) {
  const accessToken = typeof session?.cloudAccessToken === 'string'
    ? session.cloudAccessToken.trim()
    : '';
  if (!accessToken) {
    return {
      allowed: false,
      status: 401,
      code: 'CLOUD_LOGIN_REQUIRED',
      reason: 'Cloud login is required to verify this feature',
      capability,
      plan: null,
    };
  }

  const cloudBaseUrl = normalizeCloudBaseUrl(session.cloudBaseUrl, session.origin);
  try {
    const payload = await fetchJsonWithTimeout(`${cloudBaseUrl}/api/gateway/authorize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-MedHelp-Client': 'local-kernel',
      },
      body: JSON.stringify({ capability, source: 'local-kernel' }),
    }, CAPABILITY_FETCH_TIMEOUT_MS);
    return {
      allowed: payload?.success === true,
      status: 200,
      code: payload?.success === true ? 'ALLOWED' : 'CAPABILITY_DENIED',
      reason: payload?.success === true ? 'Capability allowed' : 'Membership plan does not include this capability',
      capability,
      plan: payload?.plan || null,
    };
  } catch (error) {
    return {
      allowed: false,
      status: Number(error?.statusCode) || 503,
      code: Number(error?.statusCode) === 403 ? 'CAPABILITY_DENIED' : 'ENTITLEMENT_CHECK_FAILED',
      reason: Number(error?.statusCode) === 403
        ? 'Membership plan does not include this capability'
        : 'Unable to verify feature access with the cloud account',
      capability,
      plan: null,
    };
  }
}

export async function resolveCloudAgentRuntimeEnv(session, options = {}) {
  const force = options.force === true;
  const now = Date.now();
  if (!force && session?.agentRuntimeEnvCache?.expiresAtMs > now) {
    return session.agentRuntimeEnvCache.env;
  }

  const accessToken = typeof session?.cloudAccessToken === 'string'
    ? session.cloudAccessToken.trim()
    : '';
  if (!accessToken) {
    return {};
  }

  const cloudBaseUrl = normalizeCloudBaseUrl(session.cloudBaseUrl, session.origin);
  try {
    const payload = await fetchJsonWithTimeout(`${cloudBaseUrl}/api/settings/agent-runtime-env`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-MedHelp-Client': 'local-kernel',
      },
    });
    const env = sanitizeRuntimeEnv(payload?.env);
    session.agentRuntimeEnvCache = {
      env,
      fetchedAtMs: now,
      expiresAtMs: now + RUNTIME_ENV_CACHE_TTL_MS,
    };
    return env;
  } catch (error) {
    console.warn('[local-kernel] Failed to fetch cloud agent runtime env:', error.message);
    session.agentRuntimeEnvCache = {
      env: {},
      fetchedAtMs: now,
      expiresAtMs: now + Math.min(RUNTIME_ENV_CACHE_TTL_MS, 10_000),
    };
    return {};
  }
}

export async function resolveCloudUserPreferenceContext(session, options = {}) {
  const force = options.force === true;
  const now = Date.now();
  const cached = session?.userPreferenceContextCache || null;
  if (!force && cached?.expiresAtMs > now) {
    return cached.context;
  }
  if (force && cached?.retryAfterMs > now) {
    return cached.context;
  }

  const accessToken = typeof session?.cloudAccessToken === 'string'
    ? session.cloudAccessToken.trim()
    : '';
  if (!accessToken) {
    return cached?.context || null;
  }

  const cloudBaseUrl = normalizeCloudBaseUrl(session.cloudBaseUrl, session.origin);
  try {
    const payload = await fetchJsonWithTimeout(`${cloudBaseUrl}/api/settings/user-preference-context`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-MedHelp-Client': 'local-kernel',
        'Cache-Control': 'no-cache',
      },
    }, USER_PREFERENCE_FETCH_TIMEOUT_MS);
    const context = sanitizeCloudUserPreferenceContext(payload);
    session.userPreferenceContextCache = {
      context,
      fetchedAtMs: now,
      expiresAtMs: now + USER_PREFERENCE_CACHE_TTL_MS,
    };
    return context;
  } catch (error) {
    console.warn('[local-kernel] Failed to fetch cloud user preferences:', error.message);
    if (cached?.context) {
      session.userPreferenceContextCache = {
        ...cached,
        retryAfterMs: now + 10_000,
      };
      return cached.context;
    }
    return null;
  }
}

export async function resolveCloudUserMemoryContext(session, options = {}) {
  const force = options.force === true;
  const now = Date.now();
  const cached = session?.userMemoryContextCache || null;
  if (!force && cached?.expiresAtMs > now) return cached.context;
  if (force && cached?.retryAfterMs > now) return cached.context;
  const accessToken = typeof session?.cloudAccessToken === 'string'
    ? session.cloudAccessToken.trim()
    : '';
  if (!accessToken) return cached?.context || null;
  const cloudBaseUrl = normalizeCloudBaseUrl(session.cloudBaseUrl, session.origin);
  try {
    const payload = await fetchJsonWithTimeout(`${cloudBaseUrl}/api/settings/long-term-memory/context`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-MedHelp-Client': 'local-kernel',
        'Cache-Control': 'no-cache',
      },
    }, USER_PREFERENCE_FETCH_TIMEOUT_MS);
    const context = sanitizeCloudUserMemoryContext(payload);
    session.userMemoryContextCache = {
      context,
      fetchedAtMs: now,
      expiresAtMs: now + USER_MEMORY_CACHE_TTL_MS,
    };
    return context;
  } catch (error) {
    console.warn('[local-kernel] Failed to fetch cloud user memory:', error.message);
    if (cached?.context) {
      session.userMemoryContextCache = { ...cached, retryAfterMs: now + 10_000 };
      return cached.context;
    }
    return null;
  }
}

// Save an explicit agent "remember" action to long-term memory, never to Preferences.
export async function saveCloudUserMemory(session, content) {
  if (!session?.cloudAccessToken) throw new Error('Reconnect your account before saving user memory');
  const cloudBaseUrl = normalizeCloudBaseUrl(session.cloudBaseUrl, session.origin);
  const result = await fetchJsonWithTimeout(`${cloudBaseUrl}/api/settings/long-term-memory`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.cloudAccessToken}`, 'Content-Type': 'application/json', 'X-MedHelp-Client': 'local-kernel' },
    body: JSON.stringify({ content }),
  }, USER_PREFERENCE_FETCH_TIMEOUT_MS);
  session.userMemoryContextCache = null;
  return result.memory;
}

export async function captureCloudUserLongTermMemory(session, facts, options = {}) {
  if (!session?.cloudAccessToken) throw new Error('Reconnect your account before saving memory');
  const cloudBaseUrl = normalizeCloudBaseUrl(session.cloudBaseUrl, session.origin);
  const result = await fetchJsonWithTimeout(`${cloudBaseUrl}/api/settings/long-term-memory/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.cloudAccessToken}`,
      'Content-Type': 'application/json',
      'X-MedHelp-Client': 'local-kernel',
    },
    body: JSON.stringify({
      facts: Array.isArray(facts) ? facts : [],
      conversationId: options.conversationId || null,
    }),
  }, USER_PREFERENCE_FETCH_TIMEOUT_MS);
  session.userMemoryContextCache = null;
  return result;
}
