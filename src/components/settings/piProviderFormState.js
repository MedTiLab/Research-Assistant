import { getPiProviderPreset } from '../../../shared/piProviderPresets.js';

export const PI_PROVIDER_TYPE_DEFAULTS = Object.freeze({
  'byok-openai-compatible': Object.freeze({
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    modelApi: 'openai-completions',
  }),
  'byok-anthropic-compatible': Object.freeze({
    name: 'Claude',
    baseUrl: 'https://api.anthropic.com',
    modelApi: 'anthropic-messages',
  }),
  'local-openai-compatible': Object.freeze({
    name: '',
    baseUrl: 'http://127.0.0.1:11434/v1',
    modelApi: 'openai-completions',
  }),
});

export const PI_CUSTOM_VENDOR_ID = '__custom__';

export function createPiProviderForm(
  presetId = null,
  providerType = 'byok-openai-compatible',
) {
  const preset = getPiProviderPreset(presetId);
  const resolvedProviderType = preset?.providerType || providerType;
  const defaults = PI_PROVIDER_TYPE_DEFAULTS[resolvedProviderType]
    || PI_PROVIDER_TYPE_DEFAULTS['byok-openai-compatible'];
  return {
    id: null,
    presetId: preset?.id || null,
    name: preset?.name || defaults.name,
    providerType: resolvedProviderType,
    baseUrl: preset?.baseUrl || defaults.baseUrl,
    apiKey: '',
    modelApi: preset?.modelApi || defaults.modelApi,
    enabled: true,
  };
}

/**
 * Vendor and compatibility are independent choices. Changing compatibility
 * updates only protocol fields and must not detach the selected vendor or
 * overwrite its name and endpoint.
 */
export function changePiProviderFormType(form, providerType) {
  const defaults = PI_PROVIDER_TYPE_DEFAULTS[providerType]
    || PI_PROVIDER_TYPE_DEFAULTS['byok-openai-compatible'];
  return {
    ...form,
    providerType,
    modelApi: defaults.modelApi,
  };
}

export function getPiVendorSelectionValue(form, showForm) {
  return form?.presetId || (showForm ? PI_CUSTOM_VENDOR_ID : '');
}

export function canTestPiProviderForm(form) {
  if (!form?.baseUrl?.trim()) return false;
  if (form.providerType === 'local-openai-compatible') return true;
  return Boolean(form.apiKey?.trim() || form.id);
}

export function canTestSavedPiProvider(provider) {
  if (!provider?.id || !String(provider.baseUrl || '').trim()) return false;
  if (provider.providerType === 'local-openai-compatible') return true;
  return provider.keyConfigured === true;
}

export function piProviderTestPayload(form) {
  const payload = {
    providerType: form.providerType,
    baseUrl: form.baseUrl,
    modelApi: form.modelApi,
  };
  if (form.id) payload.id = form.id;
  if (form.apiKey) payload.apiKey = form.apiKey;
  return payload;
}

export function piProviderTestMessageKey(code, message) {
  if (code === 'PI_PROVIDER_API_KEY_REQUIRED') return 'piProvider.api.testKeyRequired';
  if (code === 'PI_PROVIDER_BASE_URL_REQUIRED' || code === 'PI_PROVIDER_BASE_URL_INVALID') {
    return 'piProvider.api.testBaseUrlInvalid';
  }
  if (code === 'PI_PROVIDER_CONNECTION_TIMEOUT' || String(message || '').includes('timed out')) {
    return 'piProvider.api.testTimeout';
  }
  if (code === 'PI_PROVIDER_DISCOVERY_REJECTED') return 'piProvider.api.testRejected';
  if (code === 'PI_PROVIDER_DISCOVERY_FAILED') return 'piProvider.api.testUnreachable';
  return 'piProvider.api.testFailed';
}
