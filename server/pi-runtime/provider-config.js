import { createPiRuntimeError } from './rpc-client.js';
import {
  PI_MODEL_APIS as SHARED_PI_MODEL_APIS,
  PI_MODEL_PROVIDER_IDS as SHARED_PI_MODEL_PROVIDER_IDS,
} from '../../shared/modelConstants.js';
export { PI_READ_ONLY_TOOLS } from './tool-policy.js';

export const PI_SDK_VERSION = '0.84.3';
export const PI_SDK_PACKAGE = '@earendil-works/pi-coding-agent';
export const PI_MODEL_APIS = SHARED_PI_MODEL_APIS;
export const PI_MODEL_PROVIDER_IDS = SHARED_PI_MODEL_PROVIDER_IDS;

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function requireSafeModelId(value) {
  const modelId = normalizeString(value);
  if (!modelId || modelId.length > 200 || /[\u0000-\u001f\u007f]/.test(modelId)) {
    throw createPiRuntimeError(
      'PI_MODEL_INVALID',
      'Pi Runtime requires a valid server-configured model id.',
    );
  }
  return modelId;
}

function parseEndpoint(value, providerId) {
  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw createPiRuntimeError('PI_PROVIDER_CONFIG_INVALID', 'Pi Runtime base URL is invalid.');
  }
  if (endpoint.username || endpoint.password) {
    throw createPiRuntimeError(
      'PI_PROVIDER_CONFIG_INVALID',
      'Pi Runtime base URL must not contain credentials.',
    );
  }
  if (providerId === 'local-openai-compatible') {
    const host = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!['localhost', '127.0.0.1', '::1'].includes(host) || !['http:', 'https:'].includes(endpoint.protocol)) {
      throw createPiRuntimeError(
        'PI_PROVIDER_CONFIG_INVALID',
        'Local Pi providers must use a loopback HTTP(S) endpoint.',
      );
    }
  } else if (endpoint.protocol !== 'https:') {
    throw createPiRuntimeError(
      'PI_PROVIDER_CONFIG_INVALID',
      'BYOK Pi providers must use an HTTPS endpoint.',
    );
  }
  return endpoint.toString().replace(/\/$/, '');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function isProviderModelApiCompatible(providerId, modelApi) {
  if (providerId === 'byok-anthropic-compatible') return modelApi === 'anthropic-messages';
  return modelApi === 'openai-completions' || modelApi === 'openai-responses';
}

export function createPiOpenAICompatibleConfig(options = {}) {
  const providerId = normalizeString(options.providerId);
  if (!PI_MODEL_PROVIDER_IDS.includes(providerId)) {
    throw createPiRuntimeError(
      'PI_PROVIDER_UNAVAILABLE',
      `Pi Runtime provider "${providerId || 'unknown'}" is not supported.`,
      { providerId },
    );
  }
  const modelId = requireSafeModelId(options.modelId);
  const modelApi = normalizeString(options.modelApi) || 'openai-completions';
  if (!PI_MODEL_APIS.includes(modelApi)) {
    throw createPiRuntimeError(
      'PI_PROVIDER_CONFIG_INVALID',
      `Pi Runtime model API "${modelApi}" is not supported.`,
      { modelApi },
    );
  }
  if (!isProviderModelApiCompatible(providerId, modelApi)) {
    throw createPiRuntimeError(
      'PI_PROVIDER_CONFIG_INVALID',
      `Pi Runtime model API "${modelApi}" does not match provider "${providerId}".`,
      { providerId, modelApi },
    );
  }
  const baseUrl = parseEndpoint(options.baseUrl, providerId);
  const secretEnvKey = normalizeString(options.secretEnvKey) || 'MEDHELP_PI_API_KEY';
  if (!/^[A-Z][A-Z0-9_]*$/.test(secretEnvKey)) {
    throw createPiRuntimeError('PI_PROVIDER_CONFIG_INVALID', 'Pi Runtime secret environment key is invalid.');
  }
  const apiKey = normalizeString(options.apiKey);
  const authHeader = options.authHeader !== false;
  const apiKeyRequired = options.apiKeyRequired !== false;
  if (apiKeyRequired && !apiKey) {
    throw createPiRuntimeError(
      'PI_PROVIDER_NOT_CONFIGURED',
      `Pi Runtime provider "${providerId}" requires a server-side API key.`,
      { providerId },
    );
  }
  const contextWindow = parsePositiveInteger(options.contextWindow, 128_000);
  const maxTokens = Math.min(
    parsePositiveInteger(options.maxTokens, 16_384),
    contextWindow,
  );
  const sdkProviderId = normalizeString(options.sdkProviderId) || `medhelp-${providerId}`;
  const provider = {
    baseUrl,
    api: modelApi,
    authHeader,
    ...(apiKey ? { apiKey: `$${secretEnvKey}` } : {}),
    ...(options.compat && typeof options.compat === 'object' ? { compat: options.compat } : {}),
    models: [{
      id: modelId,
      name: normalizeString(options.modelName) || modelId,
      reasoning: options.reasoning === true,
      input: options.vision === true ? ['text', 'image'] : ['text'],
      contextWindow,
      maxTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    }],
  };

  return deepFreeze({
    providerId,
    sdkProviderId,
    modelId,
    modelApi,
    baseUrl,
    catalogRevision: Number.isInteger(options.catalogRevision) ? options.catalogRevision : null,
    secretEnv: apiKey ? { [secretEnvKey]: apiKey } : {},
    modelConfig: { providers: { [sdkProviderId]: provider } },
  });
}

export function resolvePiProviderConfig(selection = {}, options = {}) {
  const env = options.env || process.env;
  const providerId = normalizeString(selection.modelProviderId)
    || normalizeString(env.MEDHELP_PI_PROVIDER)
    || 'byok-openai-compatible';

  if (providerId === 'faux' && options.allowFaux === true) {
    const modelId = requireSafeModelId(selection.modelId || 'pi-faux-v1');
    if (modelId !== 'pi-faux-v1') {
      throw createPiRuntimeError('PI_PROVIDER_UNAVAILABLE', 'The faux Pi Host only supports pi-faux-v1.');
    }
    return Object.freeze({
      providerId,
      sdkProviderId: 'faux',
      modelId,
      modelApi: 'faux',
      baseUrl: null,
      secretEnv: Object.freeze({}),
      modelConfig: null,
    });
  }

  if (!PI_MODEL_PROVIDER_IDS.includes(providerId)) {
    throw createPiRuntimeError(
      'PI_PROVIDER_UNAVAILABLE',
      `Pi Runtime provider "${providerId}" is not available in the read-only phase.`,
      { providerId },
    );
  }

  if (providerId === 'managed-free') {
    throw createPiRuntimeError(
      'PI_MANAGED_FREE_CONFIG_REQUIRED',
      'Managed-free models must be resolved through the server catalog.',
      { providerId },
    );
  }

  const modelId = requireSafeModelId(selection.modelId || env.MEDHELP_PI_MODEL);
  const isAnthropic = providerId === 'byok-anthropic-compatible';
  const modelApi = normalizeString(selection.modelApi)
    || normalizeString(env.MEDHELP_PI_MODEL_API)
    || (isAnthropic ? 'anthropic-messages' : 'openai-completions');
  if (!PI_MODEL_APIS.includes(modelApi)) {
    throw createPiRuntimeError(
      'PI_PROVIDER_CONFIG_INVALID',
      `Pi Runtime model API "${modelApi}" is not supported.`,
      { modelApi },
    );
  }
  if (!isProviderModelApiCompatible(providerId, modelApi)) {
    throw createPiRuntimeError(
      'PI_PROVIDER_CONFIG_INVALID',
      `Pi Runtime model API "${modelApi}" does not match provider "${providerId}".`,
      { providerId, modelApi },
    );
  }

  const isLocal = providerId === 'local-openai-compatible';
  const baseUrl = parseEndpoint(
    normalizeString(env.MEDHELP_PI_BASE_URL)
      || normalizeString(isAnthropic ? env.ANTHROPIC_BASE_URL : env.OPENAI_BASE_URL)
      || (isLocal
        ? 'http://127.0.0.1:11434/v1'
        : (isAnthropic ? 'https://api.anthropic.com' : 'https://api.openai.com/v1')),
    providerId,
  );
  const apiKey = normalizeString(env.MEDHELP_PI_API_KEY)
    || normalizeString(isAnthropic ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY)
    || (isLocal ? 'local' : null);
  if (!apiKey) {
    throw createPiRuntimeError(
      'PI_PROVIDER_NOT_CONFIGURED',
      `Pi Runtime requires MEDHELP_PI_API_KEY (or ${isAnthropic ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'}) on the server.`,
      { providerId },
    );
  }

  const contextWindow = parsePositiveInteger(env.MEDHELP_PI_CONTEXT_WINDOW, 128_000);
  const maxTokens = Math.min(
    parsePositiveInteger(env.MEDHELP_PI_MAX_TOKENS, 16_384),
    contextWindow,
  );
  return createPiOpenAICompatibleConfig({
    providerId,
    modelId,
    modelApi,
    baseUrl,
    apiKey,
    contextWindow,
    maxTokens,
    reasoning: env.MEDHELP_PI_REASONING === '1' || env.MEDHELP_PI_REASONING === 'true',
    vision: env.MEDHELP_PI_VISION === '1' || env.MEDHELP_PI_VISION === 'true',
    authHeader: !isAnthropic,
    compat: isLocal ? {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    } : null,
  });
}

export function getPiProviderStatus(options = {}) {
  try {
    const config = resolvePiProviderConfig({}, options);
    return {
      configured: true,
      providerId: config.providerId,
      modelId: config.modelId,
      modelApi: config.modelApi,
      baseUrl: config.baseUrl,
    };
  } catch (error) {
    return {
      configured: false,
      providerId: normalizeString(options.env?.MEDHELP_PI_PROVIDER) || null,
      modelId: normalizeString(options.env?.MEDHELP_PI_MODEL) || null,
      modelApi: normalizeString(options.env?.MEDHELP_PI_MODEL_API) || null,
      baseUrl: null,
      error: error?.message || 'Pi Runtime is not configured.',
      code: error?.code || 'PI_PROVIDER_NOT_CONFIGURED',
    };
  }
}

export async function resolvePiProviderConfigForRuntime(selection = {}, options = {}) {
  if (options.userId != null) {
    const { resolveStoredPiProviderSelection } = await import('./provider-store.js');
    const stored = resolveStoredPiProviderSelection(options.userId, selection);
    if (stored) {
      const config = createPiOpenAICompatibleConfig({
        providerId: stored.providerId,
        modelId: stored.model.id,
        modelName: stored.model.label,
        modelApi: stored.model.api,
        baseUrl: stored.baseUrl,
        apiKey: stored.apiKey,
        contextWindow: stored.model.contextWindow,
        maxTokens: stored.model.maxTokens,
        reasoning: stored.model.reasoning,
        vision: stored.model.vision,
        secretEnvKey: 'MEDHELP_PI_STORED_PROVIDER_API_KEY',
        authHeader: stored.providerId !== 'byok-anthropic-compatible',
        compat: stored.providerId === 'local-openai-compatible' ? {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
        } : null,
      });
      return Object.freeze({
        ...config,
        source: 'user-settings',
        providerRef: stored.providerRef,
        providerName: stored.providerName,
        modelName: stored.model.label,
        selectionModelId: stored.selectionModelId,
      });
    }
    throw createPiRuntimeError(
      'PI_PROVIDER_NOT_CONFIGURED',
      'Add a Pi API provider and enable a model in Settings.',
    );
  }
  return resolvePiProviderConfig(selection, options);
}

export async function getPiProviderStatusForRuntime(options = {}) {
  try {
    const config = await resolvePiProviderConfigForRuntime({}, options);
    const models = options.userId != null
      ? (await import('./provider-store.js')).listEnabledPiModels(options.userId)
      : undefined;
    return {
      configured: true,
      providerId: config.providerId,
      modelId: config.selectionModelId || config.modelId,
      modelApi: config.modelApi,
      baseUrl: config.baseUrl,
      source: config.source || 'environment',
      providerRef: config.providerRef || null,
      providerName: config.providerName || null,
      modelName: config.modelName || null,
      models,
    };
  } catch (error) {
    if (options.userId != null) {
      return {
        configured: false,
        providerId: null,
        modelId: null,
        modelApi: null,
        baseUrl: null,
        source: 'user-settings',
        providerRef: null,
        providerName: null,
        modelName: null,
        error: error?.message || 'Pi Runtime is not configured.',
        code: error?.code || 'PI_PROVIDER_NOT_CONFIGURED',
      };
    }
    return getPiProviderStatus(options);
  }
}
