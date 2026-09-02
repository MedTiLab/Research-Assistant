import crypto from 'node:crypto';

import { credentialsDb, localPiProviderDb, userSettingsDb } from '../database/db.js';
import { isLocalKernelMode } from '../utils/localKernelRuntime.js';
import { PI_MODEL_APIS, PI_MODEL_PROVIDER_IDS } from '../../shared/modelConstants.js';
import {
  modelSupportsPiTask,
  normalizePiModelCapabilities,
  PI_MODEL_TASKS,
} from '../../shared/piModelCapabilities.js';
import {
  getPiProviderPreset,
  inferPiProviderPreset,
  mergePiProviderPresetModels,
} from '../../shared/piProviderPresets.js';

const PI_PROVIDER_STORE_KEY = 'pi_provider_store_v1';
const PI_PROVIDER_STORE_SCHEMA = 2;
const PI_PROVIDER_CREDENTIAL_PREFIX = 'pi_provider_api_key:';
const MAX_PROVIDER_COUNT = 24;
const MAX_MODEL_COUNT = 512;
const MAX_DISCOVERY_BYTES = 1024 * 1024;
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;

function storeError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeString(value, maxLength = 500) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function requireUserId(userId) {
  const normalized = Number(userId);
  if (!Number.isInteger(normalized) || normalized <= 0) {
    throw storeError('PI_PROVIDER_USER_REQUIRED', 'A signed-in user is required.', 401);
  }
  return normalized;
}

function normalizeProviderId(value) {
  const normalized = normalizeString(value, 80)?.toLowerCase();
  return normalized && /^[a-z0-9][a-z0-9._-]*$/.test(normalized) ? normalized : null;
}

function normalizeProviderType(value) {
  const normalized = normalizeString(value, 80);
  return [
    'byok-openai-compatible',
    'byok-anthropic-compatible',
    'local-openai-compatible',
  ].includes(normalized)
    ? normalized
    : null;
}

function defaultModelApi(providerType) {
  return providerType === 'byok-anthropic-compatible'
    ? 'anthropic-messages'
    : 'openai-completions';
}

function isProviderModelApiCompatible(providerType, modelApi) {
  if (providerType === 'byok-anthropic-compatible') return modelApi === 'anthropic-messages';
  return modelApi === 'openai-completions' || modelApi === 'openai-responses';
}

function normalizeModelApi(value) {
  const normalized = normalizeString(value, 80) || 'openai-completions';
  return PI_MODEL_APIS.includes(normalized) ? normalized : null;
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBaseUrl(value, providerType) {
  const normalized = normalizeString(value, 2048);
  if (!normalized) throw storeError('PI_PROVIDER_BASE_URL_REQUIRED', 'API Base URL is required.');
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    throw storeError('PI_PROVIDER_BASE_URL_INVALID', 'API Base URL is invalid.');
  }
  if (parsed.username || parsed.password) {
    throw storeError('PI_PROVIDER_BASE_URL_INVALID', 'API Base URL must not contain credentials.');
  }
  if (providerType === 'local-openai-compatible') {
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!['localhost', '127.0.0.1', '::1'].includes(host) || !['http:', 'https:'].includes(parsed.protocol)) {
      throw storeError('PI_PROVIDER_BASE_URL_INVALID', 'Local providers must use a loopback HTTP(S) URL.');
    }
  } else if (parsed.protocol !== 'https:') {
    throw storeError('PI_PROVIDER_BASE_URL_INVALID', 'Remote providers must use HTTPS.');
  }
  if (
    providerType === 'byok-anthropic-compatible'
    && parsed.hostname.toLowerCase() === 'api.anthropic.com'
    && parsed.pathname.replace(/\/$/, '') === '/v1'
  ) {
    parsed.pathname = '/';
  }
  return parsed.toString().replace(/\/$/, '');
}

function normalizeModel(input, fallbackApi = 'openai-completions', provider = {}) {
  const raw = typeof input === 'string' ? { id: input } : input;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = normalizeString(raw.id || raw.value, 200);
  if (!id || /[\u0000-\u001f\u007f]/.test(id)) return null;
  const api = normalizeModelApi(raw.api || raw.modelApi || fallbackApi);
  if (!api) return null;
  const contextWindow = normalizePositiveInteger(raw.contextWindow ?? raw.contextLength, DEFAULT_CONTEXT_WINDOW);
  const maxTokens = Math.min(
    normalizePositiveInteger(raw.maxTokens, DEFAULT_MAX_TOKENS),
    contextWindow,
  );
  const capabilities = normalizePiModelCapabilities(raw.capabilities, provider, id, {
    reasoning: raw.reasoning === true,
    vision: raw.vision === true || (Array.isArray(raw.input) && raw.input.includes('image')),
  });
  const chatTraits = capabilities.find((capability) => capability.task === 'chat')?.traits || [];
  return {
    id,
    label: normalizeString(raw.label || raw.name, 200) || id,
    api,
    contextWindow,
    maxTokens,
    reasoning: raw.reasoning === true || chatTraits.includes('reasoning'),
    vision: raw.vision === true
      || (Array.isArray(raw.input) && raw.input.includes('image'))
      || chatTraits.includes('vision_input'),
    capabilities,
    enabled: raw.enabled !== false,
    source: raw.source === 'discovered' ? 'discovered' : 'manual',
  };
}

function normalizeActiveModelIds(input, models) {
  const requested = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  return Object.fromEntries(PI_MODEL_TASKS.map((task) => {
    const requestedId = normalizeString(requested[task], 200);
    const selected = models.find((model) => model.id === requestedId && modelSupportsPiTask(model, task))
      || models.find((model) => modelSupportsPiTask(model, task));
    return [task, selected?.id || null];
  }));
}

function emptyStore() {
  return { schemaVersion: PI_PROVIDER_STORE_SCHEMA, activeProviderId: null, providers: [] };
}

function normalizeStore(input) {
  const rawProviders = Array.isArray(input?.providers) ? input.providers : [];
  const providers = [];
  const seen = new Set();
  for (const raw of rawProviders.slice(0, MAX_PROVIDER_COUNT)) {
    const id = normalizeProviderId(raw?.id);
    const preset = getPiProviderPreset(raw?.presetId) || inferPiProviderPreset(raw);
    const presetId = preset?.id || null;
    const providerType = normalizeProviderType(raw?.providerType || preset?.providerType);
    const modelApi = normalizeModelApi(raw?.modelApi || preset?.modelApi || defaultModelApi(providerType));
    if (!id || !providerType || !modelApi || !isProviderModelApiCompatible(providerType, modelApi) || seen.has(id)) continue;
    let baseUrl;
    try {
      baseUrl = normalizeBaseUrl(raw.baseUrl, providerType);
    } catch {
      continue;
    }
    const models = [];
    const modelIds = new Set();
    const modelCandidates = mergePiProviderPresetModels(presetId, raw.models).slice(0, MAX_MODEL_COUNT);
    for (const candidate of modelCandidates) {
      const model = normalizeModel({ ...candidate, api: modelApi }, modelApi, { id, presetId });
      if (!model || modelIds.has(model.id)) continue;
      modelIds.add(model.id);
      models.push(model);
    }
    const legacyActiveModelId = normalizeString(raw.activeModelId, 200);
    const activeModelIds = normalizeActiveModelIds({
      ...(raw.activeModelIds || {}),
      chat: raw.activeModelIds?.chat || legacyActiveModelId,
    }, models);
    providers.push({
      id,
      presetId,
      name: normalizeString(raw.name, 120) || id,
      providerType,
      baseUrl,
      modelApi,
      enabled: raw.enabled !== false,
      activeModelId: activeModelIds.chat,
      activeModelIds,
      models,
      createdAt: normalizeString(raw.createdAt, 80) || new Date().toISOString(),
      updatedAt: normalizeString(raw.updatedAt, 80) || new Date().toISOString(),
    });
    seen.add(id);
  }
  const requestedActiveId = normalizeProviderId(input?.activeProviderId);
  return {
    schemaVersion: PI_PROVIDER_STORE_SCHEMA,
    activeProviderId: providers.some((provider) => provider.id === requestedActiveId && provider.enabled)
      ? requestedActiveId
      : (providers.find((provider) => provider.enabled)?.id || null),
    providers,
  };
}

function readStore(userId) {
  const normalizedUserId = requireUserId(userId);
  const raw = isLocalKernelMode()
    ? localPiProviderDb.getStore(normalizedUserId)
    : userSettingsDb.get(normalizedUserId, PI_PROVIDER_STORE_KEY);
  if (!raw) return emptyStore();
  try {
    return normalizeStore(JSON.parse(raw));
  } catch {
    return emptyStore();
  }
}

function writeStore(userId, store) {
  const normalizedUserId = requireUserId(userId);
  const normalized = normalizeStore(store);
  if (isLocalKernelMode()) localPiProviderDb.setStore(normalizedUserId, JSON.stringify(normalized));
  else userSettingsDb.set(normalizedUserId, PI_PROVIDER_STORE_KEY, JSON.stringify(normalized));
  return normalized;
}

function credentialType(providerId) {
  return `${PI_PROVIDER_CREDENTIAL_PREFIX}${providerId}`;
}

function readProviderKey(userId, providerId) {
  if (isLocalKernelMode()) return localPiProviderDb.getCredential(requireUserId(userId), providerId);
  return credentialsDb.getActiveCredential(requireUserId(userId), credentialType(providerId));
}

function replaceProviderKey(userId, provider, apiKey) {
  const normalizedUserId = requireUserId(userId);
  const secret = normalizeString(apiKey, 20_000);
  if (!secret) throw storeError('PI_PROVIDER_API_KEY_REQUIRED', 'API Key is required.');
  if (isLocalKernelMode()) return localPiProviderDb.setCredential(normalizedUserId, provider.id, secret);
  const type = credentialType(provider.id);
  const previous = credentialsDb.getCredentials(normalizedUserId, type);
  const created = credentialsDb.createCredential(
    normalizedUserId,
    `${provider.name} API Key`,
    type,
    secret,
    'Pi model provider credential',
  );
  previous.forEach((entry) => credentialsDb.deleteCredential(normalizedUserId, entry.id));
  return created;
}

function deleteProviderKeys(userId, providerId) {
  const normalizedUserId = requireUserId(userId);
  if (isLocalKernelMode()) return localPiProviderDb.deleteCredential(normalizedUserId, providerId);
  credentialsDb.getCredentials(normalizedUserId, credentialType(providerId))
    .forEach((entry) => credentialsDb.deleteCredential(normalizedUserId, entry.id));
}

function createProviderId(name, providers) {
  const base = (normalizeString(name, 120) || 'provider')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'provider';
  let id = base;
  while (providers.some((provider) => provider.id === id)) {
    id = `${base}-${crypto.randomBytes(3).toString('hex')}`;
  }
  return id;
}

function publicProvider(userId, provider, activeProviderId) {
  const secret = provider.providerType === 'local-openai-compatible'
    ? 'local'
    : readProviderKey(userId, provider.id);
  const taskModelCounts = Object.fromEntries(PI_MODEL_TASKS.map((task) => [
    task,
    provider.models.filter((model) => modelSupportsPiTask(model, task)).length,
  ]));
  const visionModelCount = provider.models.filter((model) => (
    modelSupportsPiTask(model, 'chat')
    && model.capabilities.some((capability) => (
      capability.task === 'chat'
      && capability.enabled !== false
      && capability.traits?.includes('vision_input')
    ))
  )).length;
  return {
    id: provider.id,
    presetId: provider.presetId || null,
    name: provider.name,
    providerType: provider.providerType,
    baseUrl: provider.baseUrl,
    modelApi: provider.modelApi,
    enabled: provider.enabled,
    active: provider.id === activeProviderId,
    keyConfigured: Boolean(secret),
    keyLast4: secret && secret !== 'local' ? secret.slice(-4) : null,
    activeModelId: provider.activeModelId,
    activeModelIds: { ...provider.activeModelIds },
    modelCount: provider.models.length,
    enabledModelCount: provider.models.filter((model) => model.enabled).length,
    taskModelCounts,
    capabilityModelCounts: { ...taskModelCounts, vision: visionModelCount },
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

export function listPiProviders(userId) {
  const store = readStore(userId);
  return {
    activeProviderId: store.activeProviderId,
    providers: store.providers.map((provider) => publicProvider(userId, provider, store.activeProviderId)),
  };
}

export function upsertPiProvider(userId, input = {}) {
  const normalizedUserId = requireUserId(userId);
  const store = readStore(normalizedUserId);
  const requestedId = normalizeProviderId(input.id);
  const existingIndex = requestedId
    ? store.providers.findIndex((provider) => provider.id === requestedId)
    : -1;
  if (requestedId && existingIndex < 0) {
    throw storeError('PI_PROVIDER_NOT_FOUND', 'Pi provider was not found.', 404);
  }
  if (existingIndex < 0 && store.providers.length >= MAX_PROVIDER_COUNT) {
    throw storeError('PI_PROVIDER_LIMIT_REACHED', `At most ${MAX_PROVIDER_COUNT} Pi providers may be configured.`);
  }
  const existing = existingIndex >= 0 ? store.providers[existingIndex] : null;
  const hasPresetInput = Object.prototype.hasOwnProperty.call(input, 'presetId');
  const requestedPresetId = normalizeProviderId(input.presetId);
  const requestedPreset = getPiProviderPreset(requestedPresetId);
  if (hasPresetInput && input.presetId && !requestedPreset) {
    throw storeError('PI_PROVIDER_PRESET_INVALID', 'The selected Pi provider preset is not supported.');
  }
  const presetId = hasPresetInput ? requestedPreset?.id || null : existing?.presetId || null;
  const preset = getPiProviderPreset(presetId);
  const providerType = normalizeProviderType(input.providerType || existing?.providerType || preset?.providerType);
  const modelApi = normalizeModelApi(input.modelApi || existing?.modelApi || preset?.modelApi || defaultModelApi(providerType));
  const name = normalizeString(input.name || existing?.name || preset?.name, 120);
  if (!providerType) throw storeError('PI_PROVIDER_TYPE_INVALID', 'A supported provider type is required.');
  if (!modelApi) throw storeError('PI_PROVIDER_MODEL_API_INVALID', 'A supported model protocol is required.');
  if (!isProviderModelApiCompatible(providerType, modelApi)) {
    throw storeError('PI_PROVIDER_MODEL_API_INVALID', 'The model protocol does not match the provider type.');
  }
  if (!name) throw storeError('PI_PROVIDER_NAME_REQUIRED', 'Provider name is required.');
  const submittedApiKey = normalizeString(input.apiKey, 20_000);
  const existingApiKey = existing ? readProviderKey(normalizedUserId, existing.id) : null;
  if (providerType !== 'local-openai-compatible' && !submittedApiKey && !existingApiKey) {
    throw storeError('PI_PROVIDER_API_KEY_REQUIRED', 'API Key is required for a remote provider.');
  }
  const now = new Date().toISOString();
  const initialModels = (existing?.models || mergePiProviderPresetModels(presetId, preset?.models))
    .map((model) => ({ ...model, api: modelApi }));
  const initialActiveModelId = existing?.activeModelId
    || initialModels.find((model) => model.enabled !== false)?.id
    || null;
  const provider = {
    id: existing?.id || createProviderId(name, store.providers),
    presetId,
    name,
    providerType,
    baseUrl: normalizeBaseUrl(input.baseUrl || existing?.baseUrl || preset?.baseUrl, providerType),
    modelApi,
    enabled: input.enabled === undefined ? (existing?.enabled !== false) : input.enabled === true,
    activeModelId: initialActiveModelId,
    activeModelIds: existing?.activeModelIds || { chat: initialActiveModelId },
    models: initialModels,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  if (existingIndex >= 0) store.providers[existingIndex] = provider;
  else store.providers.push(provider);
  if (!store.activeProviderId && provider.enabled) store.activeProviderId = provider.id;
  if (submittedApiKey) replaceProviderKey(normalizedUserId, provider, submittedApiKey);
  const saved = writeStore(normalizedUserId, store);
  const resolved = saved.providers.find((entry) => entry.id === provider.id);
  return publicProvider(normalizedUserId, resolved, saved.activeProviderId);
}

export function deletePiProvider(userId, providerId) {
  const normalizedUserId = requireUserId(userId);
  const id = normalizeProviderId(providerId);
  const store = readStore(normalizedUserId);
  const nextProviders = store.providers.filter((provider) => provider.id !== id);
  if (nextProviders.length === store.providers.length) return false;
  deleteProviderKeys(normalizedUserId, id);
  writeStore(normalizedUserId, {
    ...store,
    providers: nextProviders,
    activeProviderId: store.activeProviderId === id ? null : store.activeProviderId,
  });
  return true;
}

export function setActivePiProvider(userId, providerId) {
  const normalizedUserId = requireUserId(userId);
  const id = normalizeProviderId(providerId);
  const store = readStore(normalizedUserId);
  const provider = store.providers.find((entry) => entry.id === id && entry.enabled);
  if (!provider) throw storeError('PI_PROVIDER_NOT_FOUND', 'Enabled Pi provider was not found.', 404);
  writeStore(normalizedUserId, { ...store, activeProviderId: provider.id });
  return publicProvider(normalizedUserId, provider, provider.id);
}

export function listPiProviderModels(userId, providerId) {
  const store = readStore(userId);
  const id = normalizeProviderId(providerId);
  const provider = store.providers.find((entry) => entry.id === id);
  if (!provider) throw storeError('PI_PROVIDER_NOT_FOUND', 'Pi provider was not found.', 404);
  return {
    providerId: provider.id,
    activeModelId: provider.activeModelId,
    activeModelIds: { ...provider.activeModelIds },
    tasks: PI_MODEL_TASKS,
    models: provider.models.map((model) => ({
      ...model,
      capabilities: model.capabilities.map((capability) => ({
        ...capability,
        traits: [...capability.traits],
      })),
    })),
  };
}

export function savePiProviderModels(userId, providerId, input = {}) {
  const normalizedUserId = requireUserId(userId);
  const id = normalizeProviderId(providerId);
  const store = readStore(normalizedUserId);
  const index = store.providers.findIndex((entry) => entry.id === id);
  if (index < 0) throw storeError('PI_PROVIDER_NOT_FOUND', 'Pi provider was not found.', 404);
  const provider = store.providers[index];
  const models = [];
  const seen = new Set();
  for (const candidate of (Array.isArray(input.models) ? input.models : []).slice(0, MAX_MODEL_COUNT)) {
    const model = normalizeModel(candidate, provider.modelApi, provider);
    if (!model || model.api !== provider.modelApi || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  if (models.length === 0) throw storeError('PI_PROVIDER_MODEL_REQUIRED', 'Add at least one valid model.');
  const activeModelIds = normalizeActiveModelIds({
    ...(input.activeModelIds || provider.activeModelIds || {}),
    chat: input.activeModelIds?.chat || input.activeModelId || provider.activeModelIds?.chat,
  }, models);
  store.providers[index] = {
    ...provider,
    models,
    activeModelId: activeModelIds.chat,
    activeModelIds,
    updatedAt: new Date().toISOString(),
  };
  writeStore(normalizedUserId, store);
  return listPiProviderModels(normalizedUserId, id);
}

function providerModelsRequest(provider, apiKey) {
  const baseUrl = String(provider.baseUrl).replace(/\/$/, '');
  if (
    provider.presetId === 'official-gemini'
    || new URL(baseUrl).hostname.toLowerCase() === 'generativelanguage.googleapis.com'
  ) {
    return {
      url: `${baseUrl}/models`,
      headers: { 'x-goog-api-key': apiKey, Accept: 'application/json' },
    };
  }
  if (provider.providerType === 'byok-anthropic-compatible') {
    const modelsUrl = /\/v1$/i.test(baseUrl) ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
    return {
      url: modelsUrl,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        Accept: 'application/json',
      },
    };
  }
  return {
    url: `${baseUrl}/models`,
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  };
}

function resolveProviderApiKey(userId, provider, submittedApiKey) {
  if (provider.providerType === 'local-openai-compatible') {
    return submittedApiKey || (provider.id ? readProviderKey(userId, provider.id) : null) || 'local';
  }
  return submittedApiKey || (provider.id ? readProviderKey(userId, provider.id) : null);
}

async function fetchProviderModels(provider, apiKey, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 8_000);
  const request = providerModelsRequest(provider, apiKey);
  let response;
  try {
    response = await (options.fetchImpl || globalThis.fetch)(request.url, {
      headers: request.headers,
      signal: controller.signal,
    });
  } catch (error) {
    throw storeError(
      error?.name === 'AbortError' ? 'PI_PROVIDER_CONNECTION_TIMEOUT' : 'PI_PROVIDER_DISCOVERY_FAILED',
      error?.name === 'AbortError' ? 'Model discovery timed out.' : 'Could not connect to the model provider.',
      502,
    );
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_DISCOVERY_BYTES) {
    throw storeError('PI_PROVIDER_DISCOVERY_FAILED', 'Provider model response is too large.', 502);
  }
  if (!response.ok) {
    throw storeError('PI_PROVIDER_DISCOVERY_REJECTED', `Provider rejected model discovery (HTTP ${response.status}).`, 502);
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw storeError('PI_PROVIDER_DISCOVERY_FAILED', 'Provider returned invalid model JSON.', 502);
  }
  return {
    status: response.status,
    discovered: Array.isArray(payload?.data) ? payload.data : [],
  };
}

export async function testPiProviderConnection(userId, input = {}, options = {}) {
  const normalizedUserId = requireUserId(userId);
  const requestedId = normalizeProviderId(input.id);
  const existing = requestedId
    ? readStore(normalizedUserId).providers.find((provider) => provider.id === requestedId) || null
    : null;
  if (requestedId && !existing) {
    throw storeError('PI_PROVIDER_NOT_FOUND', 'Pi provider was not found.', 404);
  }
  const providerType = normalizeProviderType(input.providerType || existing?.providerType);
  const modelApi = normalizeModelApi(input.modelApi || existing?.modelApi || defaultModelApi(providerType));
  if (!providerType) throw storeError('PI_PROVIDER_TYPE_INVALID', 'A supported provider type is required.');
  if (!modelApi) throw storeError('PI_PROVIDER_MODEL_API_INVALID', 'A supported model protocol is required.');
  if (!isProviderModelApiCompatible(providerType, modelApi)) {
    throw storeError('PI_PROVIDER_MODEL_API_INVALID', 'The model protocol does not match the provider type.');
  }
  const provider = {
    id: existing?.id || null,
    providerType,
    baseUrl: normalizeBaseUrl(input.baseUrl || existing?.baseUrl, providerType),
    modelApi,
  };
  const apiKey = resolveProviderApiKey(
    normalizedUserId,
    provider,
    normalizeString(input.apiKey, 20_000),
  );
  if (!apiKey) throw storeError('PI_PROVIDER_API_KEY_REQUIRED', 'API Key is required for a remote provider.');
  const probed = await fetchProviderModels(provider, apiKey, options);
  return {
    connected: true,
    modelCount: probed.discovered.length,
    status: probed.status,
  };
}

export async function discoverPiProviderModels(userId, providerId, options = {}) {
  const normalizedUserId = requireUserId(userId);
  const store = readStore(normalizedUserId);
  const index = store.providers.findIndex((entry) => entry.id === normalizeProviderId(providerId));
  if (index < 0) throw storeError('PI_PROVIDER_NOT_FOUND', 'Pi provider was not found.', 404);
  const provider = store.providers[index];
  const apiKey = resolveProviderApiKey(normalizedUserId, provider);
  if (!apiKey) throw storeError('PI_PROVIDER_API_KEY_REQUIRED', 'API Key is not configured.');
  const { discovered } = await fetchProviderModels(provider, apiKey, options);
  const existingById = new Map(provider.models.map((model) => [model.id, model]));
  for (const entry of discovered.slice(0, MAX_MODEL_COUNT)) {
    const id = normalizeString(entry?.id, 200);
    if (!id || existingById.has(id)) continue;
    existingById.set(id, normalizeModel({
      id,
      label: entry?.display_name || entry?.name || id,
      api: provider.modelApi,
      enabled: false,
      source: 'discovered',
    }, provider.modelApi, provider));
  }
  store.providers[index] = {
    ...provider,
    models: [...existingById.values()].filter(Boolean),
    updatedAt: new Date().toISOString(),
  };
  writeStore(normalizedUserId, store);
  return listPiProviderModels(normalizedUserId, provider.id);
}

export function listEnabledPiModels(userId) {
  const store = readStore(userId);
  // The composer follows the API selected in Settings. Other configured APIs
  // remain editable there, but must not leak into the active model picker.
  const providers = store.providers.filter((provider) => provider.id === store.activeProviderId);
  return providers.flatMap((provider) => {
    if (!provider.enabled) return [];
    const keyConfigured = provider.providerType === 'local-openai-compatible'
      || Boolean(readProviderKey(userId, provider.id));
    if (!keyConfigured) return [];
    return provider.models.filter((model) => modelSupportsPiTask(model, 'chat')).map((model) => ({
      value: `${provider.id}/${model.id}`,
      id: `${provider.id}/${model.id}`,
      label: `${provider.name} / ${model.label}`,
      modelProviderId: provider.providerType,
      modelApi: model.api,
      contextLength: model.contextWindow,
      reasoning: model.reasoning,
      vision: model.vision,
      providerRef: provider.id,
      free: false,
    }));
  });
}

export function listPiTaskModels(userId, task) {
  if (!PI_MODEL_TASKS.includes(task)) {
    throw storeError('PI_MODEL_TASK_INVALID', `Unsupported model task: ${task}.`);
  }
  const store = readStore(userId);
  return store.providers.flatMap((provider) => {
    if (!provider.enabled) return [];
    const keyConfigured = provider.providerType === 'local-openai-compatible'
      || Boolean(readProviderKey(userId, provider.id));
    if (!keyConfigured) return [];
    return provider.models.filter((model) => modelSupportsPiTask(model, task)).map((model) => ({
      id: `${provider.id}/${model.id}`,
      value: `${provider.id}/${model.id}`,
      label: `${provider.name} / ${model.label}`,
      providerRef: provider.id,
      providerName: provider.name,
      modelId: model.id,
      task,
      default: provider.activeModelIds?.[task] === model.id,
      capability: model.capabilities.find((entry) => entry.task === task),
    }));
  });
}

export function resolvePiTaskModel(userId, task, selection = {}) {
  if (!PI_MODEL_TASKS.includes(task)) {
    throw storeError('PI_MODEL_TASK_INVALID', `Unsupported model task: ${task}.`);
  }
  const store = readStore(userId);
  const requestedToken = normalizeString(selection.modelRef || selection.modelId, 300);
  const allowedProtocols = Array.isArray(selection.protocols) && selection.protocols.length > 0
    ? new Set(selection.protocols)
    : null;
  const supportsTask = (model) => {
    if (!modelSupportsPiTask(model, task)) return false;
    const protocol = model.capabilities.find((entry) => entry.task === task)?.protocol;
    return !allowedProtocols || allowedProtocols.has(protocol);
  };
  const requestedProvider = normalizeProviderId(selection.providerRef);
  let provider = requestedProvider
    ? store.providers.find((entry) => entry.id === requestedProvider && entry.enabled)
    : null;
  let requestedModelId = null;
  if (requestedToken) {
    const matchingProvider = store.providers.find((entry) => requestedToken.startsWith(`${entry.id}/`));
    if (matchingProvider) {
      provider = matchingProvider.enabled ? matchingProvider : null;
      requestedModelId = requestedToken.slice(matchingProvider.id.length + 1);
    } else {
      requestedModelId = requestedToken;
    }
  }
  const candidates = [
    provider,
    store.providers.find((entry) => entry.id === store.activeProviderId && entry.enabled),
    ...store.providers.filter((entry) => entry.enabled),
  ].filter(Boolean);
  provider = candidates.find((entry, index) => candidates.indexOf(entry) === index && (
    requestedModelId
      ? entry.models.some((model) => model.id === requestedModelId && supportsTask(model))
      : entry.models.some((model) => supportsTask(model))
  )) || null;
  if (!provider) return null;
  const defaultModelId = provider.activeModelIds?.[task];
  const model = provider.models.find((entry) => entry.id === requestedModelId && supportsTask(entry))
    || provider.models.find((entry) => entry.id === defaultModelId && supportsTask(entry))
    || provider.models.find((entry) => supportsTask(entry));
  if (!model) return null;
  const apiKey = provider.providerType === 'local-openai-compatible'
    ? (readProviderKey(userId, provider.id) || 'local')
    : readProviderKey(userId, provider.id);
  if (!apiKey) return null;
  return {
    providerRef: provider.id,
    providerName: provider.name,
    providerId: provider.providerType,
    presetId: provider.presetId,
    baseUrl: provider.baseUrl,
    apiKey,
    model,
    capability: model.capabilities.find((entry) => entry.task === task),
    selectionModelId: `${provider.id}/${model.id}`,
  };
}

export function resolveStoredPiProviderSelection(userId, selection = {}) {
  const store = readStore(userId);
  const enabledProviders = store.providers.filter((provider) => provider.enabled);
  if (enabledProviders.length === 0) return null;
  const requestedType = normalizeString(selection.modelProviderId, 80);
  const requestedRef = normalizeProviderId(selection.providerRef);
  const requestedToken = normalizeString(selection.modelId, 300);
  let provider = requestedRef
    ? enabledProviders.find((entry) => entry.id === requestedRef)
    : null;
  let modelId = null;
  if (!provider && requestedToken) {
    provider = enabledProviders.find((entry) => requestedToken.startsWith(`${entry.id}/`)) || null;
    if (provider) modelId = requestedToken.slice(provider.id.length + 1);
  }
  if (!provider) {
    provider = enabledProviders.find((entry) => entry.id === store.activeProviderId)
      || enabledProviders.find((entry) => !requestedType || entry.providerType === requestedType)
      || null;
  }
  if (!provider || (requestedType && !PI_MODEL_PROVIDER_IDS.includes(requestedType))) return null;
  if (requestedType && provider.providerType !== requestedType) return null;
  if (!modelId && requestedToken && !requestedToken.startsWith(`${provider.id}/`)) modelId = requestedToken;
  modelId ||= provider.activeModelIds?.chat || provider.activeModelId;
  const model = provider.models.find((entry) => entry.id === modelId && modelSupportsPiTask(entry, 'chat'));
  if (!model) return null;
  const apiKey = provider.providerType === 'local-openai-compatible'
    ? (readProviderKey(userId, provider.id) || 'local')
    : readProviderKey(userId, provider.id);
  if (!apiKey) return null;
  return {
    providerRef: provider.id,
    providerName: provider.name,
    providerId: provider.providerType,
    baseUrl: provider.baseUrl,
    apiKey,
    model,
    selectionModelId: `${provider.id}/${model.id}`,
  };
}
