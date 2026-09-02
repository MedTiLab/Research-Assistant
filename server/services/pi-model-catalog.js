import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import { createPiOpenAICompatibleConfig } from '../pi-runtime/provider-config.js';
import { createPiRuntimeError } from '../pi-runtime/rpc-client.js';
import { resolveAppDataRoot } from '../utils/storagePaths.js';

const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_MIN_REFRESH_INTERVAL_MS = 30 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_PRIVACY_NOTICE = 'Prompts and read-only tool results may be sent to a server-managed third-party model endpoint. Do not include sensitive or regulated data.';
const DEFAULT_PRICE_NOTICE = 'Listed as free by the current catalog; availability and pricing may change.';
const MANAGED_FREE_MODEL_APIS = Object.freeze(['openai-completions', 'openai-responses']);
const HEALTH_STATES = Object.freeze([
  'healthy',
  'degraded',
  'disabled',
  'rate_limited',
  'unavailable',
]);

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = normalizeString(value)?.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOptionalJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function isSafeModelId(value) {
  return Boolean(
    typeof value === 'string'
    && value.trim()
    && value.length <= 200
    && !/[\u0000-\u001f\u007f]/.test(value),
  );
}

function normalizeCatalogModel(entry, defaults = {}) {
  const raw = typeof entry === 'string' ? { id: entry } : entry;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = normalizeString(raw.id || raw.value);
  if (!isSafeModelId(id)) return null;
  const api = normalizeString(raw.api || raw.modelApi || defaults.modelApi) || 'openai-completions';
  if (!MANAGED_FREE_MODEL_APIS.includes(api)) return null;
  const contextWindow = parsePositiveInteger(
    raw.contextWindow ?? raw.contextLength,
    defaults.contextWindow,
  );
  const maxTokens = Math.min(
    parsePositiveInteger(raw.maxTokens, defaults.maxTokens),
    contextWindow,
  );
  return Object.freeze({
    id,
    label: normalizeString(raw.label || raw.name) || id,
    api,
    contextWindow,
    maxTokens,
    reasoning: raw.reasoning === true,
    vision: raw.vision === true || (Array.isArray(raw.input) && raw.input.includes('image')),
    free: true,
  });
}

export function normalizePiManagedFreeModels(input, defaults = {}) {
  const rawModels = Array.isArray(input) ? input : [];
  const byId = new Map();
  rawModels.forEach((entry) => {
    const model = normalizeCatalogModel(entry, {
      modelApi: defaults.modelApi || 'openai-completions',
      contextWindow: parsePositiveInteger(defaults.contextWindow, 128_000),
      maxTokens: parsePositiveInteger(defaults.maxTokens, 16_384),
    });
    if (model) byId.set(model.id, model);
  });
  return Object.freeze([...byId.values()].sort((left, right) => left.id.localeCompare(right.id)));
}

function catalogFingerprint(models) {
  return crypto.createHash('sha256').update(JSON.stringify(models)).digest('hex');
}

function parseRetryAfter(value, nowMs) {
  const normalized = normalizeString(value);
  if (!normalized) return nowMs + 60_000;
  const seconds = Number(normalized);
  if (Number.isFinite(seconds) && seconds >= 0) return nowMs + Math.ceil(seconds * 1000);
  const dateMs = Date.parse(normalized);
  return Number.isFinite(dateMs) && dateMs > nowMs ? dateMs : nowMs + 60_000;
}

function parseHttpsUrl(value, label) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw createPiRuntimeError('PI_MANAGED_FREE_CONFIG_INVALID', `${label} is invalid.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw createPiRuntimeError(
      'PI_MANAGED_FREE_CONFIG_INVALID',
      `${label} must be an HTTPS URL without embedded credentials.`,
    );
  }
  return url;
}

function normalizeAllowedHosts(value, configuredUrls) {
  const explicit = (Array.isArray(value) ? value : String(value || '').split(','))
    .map((entry) => normalizeString(entry)?.toLowerCase())
    .filter(Boolean);
  if (explicit.length > 0) return new Set(explicit);
  return new Set(configuredUrls.filter(Boolean).map((url) => url.host.toLowerCase()));
}

function assertAllowedUrl(url, allowedHosts, label) {
  if (url && !allowedHosts.has(url.host.toLowerCase())) {
    throw createPiRuntimeError(
      'PI_MANAGED_FREE_CONFIG_INVALID',
      `${label} host is not in the server allowlist.`,
    );
  }
}

function publicModel(model, revision) {
  return {
    value: model.id,
    id: model.id,
    label: model.label,
    modelProviderId: 'managed-free',
    modelApi: model.api,
    catalogRevision: revision,
    contextLength: model.contextWindow,
    maxTokens: model.maxTokens,
    reasoning: model.reasoning,
    vision: model.vision,
    free: true,
  };
}

function publicError(error) {
  if (!error) return null;
  return {
    code: error.code || 'PI_MANAGED_FREE_REFRESH_FAILED',
    message: error.message || 'Managed-free catalog refresh failed.',
  };
}

function createState(overrides = {}) {
  return {
    initialized: false,
    health: 'disabled',
    source: 'none',
    revision: 0,
    models: Object.freeze([]),
    fingerprint: catalogFingerprint([]),
    fetchedAt: null,
    checkedAt: null,
    retryAt: null,
    error: null,
    ...overrides,
  };
}

function getManagedFreeConfigurationError(config) {
  if (!config.baseUrl) {
    return createPiRuntimeError(
      'PI_MANAGED_FREE_NOT_CONFIGURED',
      'Managed-free base URL is not configured.',
    );
  }
  if (!config.apiKey && !config.allowAnonymous) {
    return createPiRuntimeError(
      'PI_MANAGED_FREE_NOT_CONFIGURED',
      'Managed-free requires a server-side API key unless the experimental anonymous flag is enabled.',
    );
  }
  return null;
}

export class PiManagedFreeCatalog {
  constructor(options = {}) {
    this.options = options;
    this.env = options.env || process.env;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.now = options.now || (() => Date.now());
    this.cachePath = path.resolve(
      options.cachePath
      || path.join(resolveAppDataRoot(options), 'pi', 'managed-free-catalog.json'),
    );
    this.state = createState();
    this.initializePromise = null;
    this.refreshPromise = null;
  }

  getConfiguration() {
    const env = this.env;
    const enabled = this.options.enabled ?? (
      parseBoolean(env.MEDHELP_PI_MANAGED_FREE_ENABLED)
      || normalizeString(env.MEDHELP_PI_PROVIDER) === 'managed-free'
    );
    const baseUrl = parseHttpsUrl(
      this.options.baseUrl || env.MEDHELP_PI_MANAGED_FREE_BASE_URL,
      'Managed-free base URL',
    );
    const catalogUrl = parseHttpsUrl(
      this.options.catalogUrl || env.MEDHELP_PI_MANAGED_FREE_CATALOG_URL,
      'Managed-free catalog URL',
    );
    const allowedHosts = normalizeAllowedHosts(
      this.options.allowedHosts || env.MEDHELP_PI_MANAGED_FREE_ALLOWED_HOSTS,
      [baseUrl, catalogUrl],
    );
    assertAllowedUrl(baseUrl, allowedHosts, 'Managed-free base URL');
    assertAllowedUrl(catalogUrl, allowedHosts, 'Managed-free catalog URL');
    const allowAnonymous = this.options.allowAnonymous ?? parseBoolean(
      env.MEDHELP_PI_MANAGED_FREE_ALLOW_ANONYMOUS,
    );
    const apiKey = normalizeString(
      this.options.apiKey ?? env.MEDHELP_PI_MANAGED_FREE_API_KEY,
    );
    const seedInput = this.options.seedModels ?? parseOptionalJson(
      env.MEDHELP_PI_MANAGED_FREE_MODELS,
      [],
    );
    const defaults = {
      modelApi: this.options.modelApi || env.MEDHELP_PI_MANAGED_FREE_MODEL_API || 'openai-completions',
      contextWindow: this.options.contextWindow || env.MEDHELP_PI_MANAGED_FREE_CONTEXT_WINDOW || 128_000,
      maxTokens: this.options.maxTokens || env.MEDHELP_PI_MANAGED_FREE_MAX_TOKENS || 16_384,
    };
    const seedModels = normalizePiManagedFreeModels(seedInput, defaults);
    return Object.freeze({
      enabled,
      baseUrl,
      catalogUrl,
      allowedHosts,
      allowAnonymous,
      apiKey,
      catalogToken: normalizeString(
        this.options.catalogToken ?? env.MEDHELP_PI_MANAGED_FREE_CATALOG_TOKEN,
      ),
      seedModels,
      defaults,
      refreshIntervalMs: parsePositiveInteger(
        this.options.refreshIntervalMs ?? env.MEDHELP_PI_MANAGED_FREE_REFRESH_MS,
        DEFAULT_REFRESH_INTERVAL_MS,
      ),
      minRefreshIntervalMs: parsePositiveInteger(
        this.options.minRefreshIntervalMs ?? env.MEDHELP_PI_MANAGED_FREE_MIN_REFRESH_MS,
        DEFAULT_MIN_REFRESH_INTERVAL_MS,
      ),
      requestTimeoutMs: parsePositiveInteger(
        this.options.requestTimeoutMs ?? env.MEDHELP_PI_MANAGED_FREE_TIMEOUT_MS,
        DEFAULT_REQUEST_TIMEOUT_MS,
      ),
      maxResponseBytes: parsePositiveInteger(
        this.options.maxResponseBytes,
        DEFAULT_MAX_RESPONSE_BYTES,
      ),
    });
  }

  async readCache(config) {
    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(this.cachePath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
    if (parsed?.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
    const models = normalizePiManagedFreeModels(parsed.models, config.defaults);
    if (models.length === 0) return null;
    return {
      revision: parsePositiveInteger(parsed.revision, 1),
      models,
      fingerprint: catalogFingerprint(models),
      fetchedAt: normalizeString(parsed.fetchedAt),
    };
  }

  async writeCache() {
    const cacheDir = path.dirname(this.cachePath);
    const tempPath = `${this.cachePath}.${crypto.randomUUID()}.tmp`;
    const payload = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      revision: this.state.revision,
      fetchedAt: this.state.fetchedAt,
      models: this.state.models,
    };
    await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 });
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await fs.rename(tempPath, this.cachePath);
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => {});
    }
  }

  async initialize() {
    if (this.state.initialized) return this.state;
    if (this.initializePromise) return this.initializePromise;
    this.initializePromise = (async () => {
      let config;
      try {
        config = this.getConfiguration();
      } catch (error) {
        this.state = createState({
          initialized: true,
          health: 'unavailable',
          error,
        });
        return this.state;
      }
      if (!config.enabled) {
        this.state = createState({ initialized: true, health: 'disabled' });
        return this.state;
      }
      let cached = null;
      try {
        cached = await this.readCache(config);
      } catch (error) {
        this.state.error = error;
      }
      const models = cached?.models || config.seedModels;
      const configError = getManagedFreeConfigurationError(config);
      this.state = createState({
        initialized: true,
        health: configError || models.length === 0 ? 'unavailable' : 'degraded',
        source: cached ? 'last-known-good' : (models.length > 0 ? 'seed' : 'none'),
        revision: cached?.revision || (models.length > 0 ? 1 : 0),
        models,
        fingerprint: cached?.fingerprint || catalogFingerprint(models),
        fetchedAt: cached?.fetchedAt || null,
        error: configError || this.state.error || null,
      });
      return this.state;
    })().finally(() => {
      this.initializePromise = null;
    });
    return this.initializePromise;
  }

  snapshot() {
    const state = this.state;
    const config = (() => {
      try {
        return this.getConfiguration();
      } catch {
        return null;
      }
    })();
    const configured = Boolean(
      config?.enabled
      && config.baseUrl
      && (config.apiKey || config.allowAnonymous)
      && state.models.length > 0
      && !['disabled', 'unavailable'].includes(state.health),
    );
    const defaultModel = state.models[0] || null;
    return Object.freeze({
      providerId: 'managed-free',
      configured,
      health: HEALTH_STATES.includes(state.health) ? state.health : 'unavailable',
      source: state.source,
      revision: state.revision || null,
      catalogRevision: state.revision || null,
      fetchedAt: state.fetchedAt,
      checkedAt: state.checkedAt,
      retryAt: state.retryAt ? new Date(state.retryAt).toISOString() : null,
      error: publicError(state.error),
      modelId: defaultModel?.id || null,
      modelApi: defaultModel?.api || null,
      models: Object.freeze(state.models.map((model) => Object.freeze(publicModel(model, state.revision)))),
      privacyNotice: DEFAULT_PRIVACY_NOTICE,
      priceNotice: DEFAULT_PRICE_NOTICE,
    });
  }

  async refresh(options = {}) {
    await this.initialize();
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      let config;
      try {
        config = this.getConfiguration();
      } catch (error) {
        this.state = { ...this.state, health: 'unavailable', error };
        return this.snapshot();
      }
      if (!config.enabled) return this.snapshot();
      const configError = getManagedFreeConfigurationError(config);
      const nowMs = this.now();
      if (this.state.retryAt && this.state.retryAt > nowMs) return this.snapshot();
      const fetchedAtMs = this.state.fetchedAt ? Date.parse(this.state.fetchedAt) : 0;
      const checkedAtMs = this.state.checkedAt ? Date.parse(this.state.checkedAt) : 0;
      if (
        options.force === true
        && checkedAtMs
        && nowMs - checkedAtMs < config.minRefreshIntervalMs
      ) {
        return this.snapshot();
      }
      if (
        options.force !== true
        && fetchedAtMs
        && this.state.health === 'healthy'
        && nowMs - fetchedAtMs < config.refreshIntervalMs
      ) {
        return this.snapshot();
      }
      if (!config.catalogUrl) {
        const error = createPiRuntimeError(
          'PI_MANAGED_FREE_CATALOG_NOT_CONFIGURED',
          'Managed-free catalog URL is not configured.',
        );
        this.state = {
          ...this.state,
          health: configError
            ? 'unavailable'
            : (this.state.models.length > 0 ? 'degraded' : 'unavailable'),
          checkedAt: new Date(nowMs).toISOString(),
          error: configError || error,
        };
        return this.snapshot();
      }
      if (typeof this.fetchImpl !== 'function') {
        const error = createPiRuntimeError(
          'PI_MANAGED_FREE_FETCH_UNAVAILABLE',
          'This server runtime cannot refresh the managed-free catalog.',
        );
        this.state = {
          ...this.state,
          health: configError
            ? 'unavailable'
            : (this.state.models.length > 0 ? 'degraded' : 'unavailable'),
          checkedAt: new Date(nowMs).toISOString(),
          error: configError || error,
        };
        return this.snapshot();
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
      timer.unref?.();
      try {
        const response = await this.fetchImpl(config.catalogUrl.toString(), {
          method: 'GET',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            accept: 'application/json',
            ...(config.catalogToken ? { authorization: `Bearer ${config.catalogToken}` } : {}),
          },
        });
        if (response.status === 429) {
          const retryAt = parseRetryAfter(response.headers?.get?.('retry-after'), nowMs);
          const error = createPiRuntimeError(
            'PI_MANAGED_FREE_RATE_LIMITED',
            'Managed-free catalog refresh is rate limited.',
            { retryAt: new Date(retryAt).toISOString() },
          );
          this.state = {
            ...this.state,
            health: configError ? 'unavailable' : 'rate_limited',
            checkedAt: new Date(nowMs).toISOString(),
            retryAt,
            error,
          };
          return this.snapshot();
        }
        if (!response.ok) {
          const errorCode = response.status === 401 || response.status === 403
            ? 'PI_MANAGED_FREE_CATALOG_AUTH_FAILED'
            : response.status === 404
              ? 'PI_MANAGED_FREE_CATALOG_NOT_FOUND'
              : response.status >= 500
                ? 'PI_MANAGED_FREE_CATALOG_UPSTREAM_ERROR'
                : 'PI_MANAGED_FREE_REFRESH_FAILED';
          throw createPiRuntimeError(
            errorCode,
            `Managed-free catalog returned HTTP ${response.status}.`,
            { status: response.status },
          );
        }
        const rawText = await response.text();
        if (Buffer.byteLength(rawText, 'utf8') > config.maxResponseBytes) {
          throw createPiRuntimeError(
            'PI_MANAGED_FREE_CATALOG_TOO_LARGE',
            'Managed-free catalog response exceeded the size limit.',
          );
        }
        let payload;
        try {
          payload = JSON.parse(rawText);
        } catch {
          throw createPiRuntimeError(
            'PI_MANAGED_FREE_CATALOG_INVALID',
            'Managed-free catalog returned invalid JSON.',
          );
        }
        const models = normalizePiManagedFreeModels(
          Array.isArray(payload) ? payload : payload?.models,
          config.defaults,
        );
        if (models.length === 0) {
          throw createPiRuntimeError(
            'PI_MANAGED_FREE_CATALOG_EMPTY',
            'Managed-free catalog did not contain any supported text models.',
          );
        }
        const fingerprint = catalogFingerprint(models);
        const changed = fingerprint !== this.state.fingerprint;
        const revision = changed ? Math.max(1, this.state.revision + 1) : Math.max(1, this.state.revision);
        this.state = createState({
          initialized: true,
          health: configError ? 'unavailable' : 'healthy',
          source: 'remote',
          revision,
          models,
          fingerprint,
          fetchedAt: new Date(nowMs).toISOString(),
          checkedAt: new Date(nowMs).toISOString(),
          error: configError,
        });
        await this.writeCache();
        return this.snapshot();
      } catch (error) {
        if (error?.code === 'PI_MANAGED_FREE_RATE_LIMITED') return this.snapshot();
        const normalizedError = error?.name === 'AbortError'
          ? createPiRuntimeError('PI_MANAGED_FREE_REFRESH_TIMEOUT', 'Managed-free catalog refresh timed out.')
          : error;
        this.state = {
          ...this.state,
          health: configError
            ? 'unavailable'
            : (this.state.models.length > 0 ? 'degraded' : 'unavailable'),
          checkedAt: new Date(nowMs).toISOString(),
          retryAt: nowMs + config.minRefreshIntervalMs,
          error: configError || normalizedError,
        };
        return this.snapshot();
      } finally {
        clearTimeout(timer);
      }
    })().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  async getCatalog(options = {}) {
    await this.initialize();
    return options.refresh === false ? this.snapshot() : this.refresh(options);
  }

  async resolveProviderConfig(selection = {}) {
    const catalog = await this.getCatalog({ refresh: selection.refresh !== false });
    if (!catalog.configured) {
      throw createPiRuntimeError(
        catalog.error?.code || 'PI_MANAGED_FREE_UNAVAILABLE',
        catalog.error?.message || 'Managed-free provider is unavailable.',
        { health: catalog.health },
      );
    }
    if (
      Number.isInteger(selection.catalogRevision)
      && selection.catalogRevision !== catalog.revision
      && selection.allowStale !== true
    ) {
      throw createPiRuntimeError(
        'PI_CATALOG_REVISION_STALE',
        `Managed-free catalog revision ${selection.catalogRevision} is stale; current revision is ${catalog.revision}.`,
        { requestedRevision: selection.catalogRevision, currentRevision: catalog.revision },
      );
    }
    const modelId = normalizeString(selection.modelId) || catalog.modelId;
    const model = this.state.models.find((entry) => entry.id === modelId);
    if (!model) {
      throw createPiRuntimeError(
        'PI_MODEL_NOT_FOUND',
        `Managed-free model "${modelId || 'unknown'}" is not in the allowlisted catalog.`,
        { modelId, catalogRevision: catalog.revision },
      );
    }
    const config = this.getConfiguration();
    return createPiOpenAICompatibleConfig({
      providerId: 'managed-free',
      sdkProviderId: 'medhelp-managed-free',
      modelId: model.id,
      modelName: model.label,
      modelApi: model.api,
      baseUrl: config.baseUrl.toString().replace(/\/$/, ''),
      apiKey: config.apiKey,
      authHeader: Boolean(config.apiKey),
      apiKeyRequired: Boolean(config.apiKey),
      secretEnvKey: 'MEDHELP_PI_MANAGED_FREE_API_KEY',
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
      reasoning: model.reasoning,
      vision: model.vision,
      catalogRevision: catalog.revision,
    });
  }
}

export const piModelCatalog = new PiManagedFreeCatalog();

export {
  DEFAULT_PRICE_NOTICE as PI_MANAGED_FREE_PRICE_NOTICE,
  DEFAULT_PRIVACY_NOTICE as PI_MANAGED_FREE_PRIVACY_NOTICE,
  HEALTH_STATES as PI_MANAGED_FREE_HEALTH_STATES,
};
