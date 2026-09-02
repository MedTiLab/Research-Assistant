import { describe, expect, it } from 'vitest';

import {
  canTestPiProviderForm,
  canTestSavedPiProvider,
  changePiProviderFormType,
  createPiProviderForm,
  getPiVendorSelectionValue,
  PI_CUSTOM_VENDOR_ID,
  piProviderTestMessageKey,
  piProviderTestPayload,
} from './piProviderFormState.js';

describe('Pi provider form state', () => {
  it('keeps DeepSeek selected when compatibility is changed', () => {
    const deepSeek = createPiProviderForm('deepseek');

    expect(changePiProviderFormType(deepSeek, 'byok-anthropic-compatible')).toMatchObject({
      presetId: 'deepseek',
      name: 'DeepSeek',
      providerType: 'byok-anthropic-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      modelApi: 'anthropic-messages',
    });
  });

  it('changes a custom provider protocol without erasing its identity', () => {
    const custom = {
      ...createPiProviderForm(),
      presetId: null,
      name: 'Company Gateway',
      baseUrl: 'https://models.company.test/v1',
    };

    expect(changePiProviderFormType(custom, 'byok-anthropic-compatible')).toMatchObject({
      presetId: null,
      name: 'Company Gateway',
      baseUrl: 'https://models.company.test/v1',
      providerType: 'byok-anthropic-compatible',
      modelApi: 'anthropic-messages',
    });
  });

  it('keeps Custom visible in the vendor selector while its form is open', () => {
    expect(getPiVendorSelectionValue(createPiProviderForm(), true)).toBe(PI_CUSTOM_VENDOR_ID);
    expect(getPiVendorSelectionValue(createPiProviderForm(), false)).toBe('');
  });

  it('allows a connectivity test once the endpoint and key are present', () => {
    const empty = createPiProviderForm('deepseek');
    expect(canTestPiProviderForm(empty)).toBe(false);
    expect(canTestPiProviderForm({ ...empty, apiKey: 'sk-test' })).toBe(true);
    expect(canTestPiProviderForm({ ...empty, id: 'deepseek', apiKey: '' })).toBe(true);
    expect(canTestPiProviderForm({
      ...createPiProviderForm(null, 'local-openai-compatible'),
      apiKey: '',
    })).toBe(true);
  });

  it('omits a blank API key from the connectivity test payload', () => {
    expect(piProviderTestPayload({
      id: 'deepseek',
      providerType: 'byok-openai-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      modelApi: 'openai-completions',
      apiKey: '',
    })).toEqual({
      id: 'deepseek',
      providerType: 'byok-openai-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      modelApi: 'openai-completions',
    });
    expect(piProviderTestMessageKey('PI_PROVIDER_DISCOVERY_REJECTED')).toBe('piProvider.api.testRejected');
  });

  it('tests a saved provider with its stored key, not a missing key', () => {
    expect(canTestSavedPiProvider({
      id: 'deepseek',
      providerType: 'byok-openai-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      keyConfigured: true,
    })).toBe(true);
    expect(canTestSavedPiProvider({
      id: 'deepseek',
      providerType: 'byok-openai-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      keyConfigured: false,
    })).toBe(false);
    expect(canTestSavedPiProvider({
      id: 'ollama',
      providerType: 'local-openai-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      keyConfigured: false,
    })).toBe(true);
  });
});
