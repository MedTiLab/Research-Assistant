import { describe, expect, it } from 'vitest';

import {
  getPiProviderStatus,
  resolvePiProviderConfig,
} from '../pi-runtime/provider-config.js';

describe('Pi provider configuration', () => {
  it('keeps the BYOK secret out of models.json-compatible config', () => {
    const config = resolvePiProviderConfig({
      modelProviderId: 'byok-openai-compatible',
      modelId: 'provider/model-a',
    }, {
      env: {
        MEDHELP_PI_BASE_URL: 'https://models.example.test/v1',
        MEDHELP_PI_API_KEY: 'server-secret',
      },
    });

    expect(config).toMatchObject({
      providerId: 'byok-openai-compatible',
      modelId: 'provider/model-a',
      modelApi: 'openai-completions',
      secretEnv: { MEDHELP_PI_API_KEY: 'server-secret' },
    });
    expect(JSON.stringify(config.modelConfig)).toContain('$MEDHELP_PI_API_KEY');
    expect(JSON.stringify(config.modelConfig)).not.toContain('server-secret');
  });

  it('allows loopback local endpoints and rejects remote HTTP endpoints', () => {
    expect(resolvePiProviderConfig({
      modelProviderId: 'local-openai-compatible',
      modelId: 'local-model',
    }, {
      env: { MEDHELP_PI_BASE_URL: 'http://127.0.0.1:11434/v1' },
    })).toMatchObject({
      providerId: 'local-openai-compatible',
      secretEnv: { MEDHELP_PI_API_KEY: 'local' },
    });

    expect(() => resolvePiProviderConfig({
      modelProviderId: 'local-openai-compatible',
      modelId: 'local-model',
    }, {
      env: { MEDHELP_PI_BASE_URL: 'http://models.example.test/v1' },
    })).toThrowError(expect.objectContaining({ code: 'PI_PROVIDER_CONFIG_INVALID' }));
  });

  it('uses native Anthropic Messages without exposing or misrouting the API key', () => {
    const config = resolvePiProviderConfig({
      modelProviderId: 'byok-anthropic-compatible',
      modelId: 'claude-sonnet-4-6',
    }, {
      env: { ANTHROPIC_API_KEY: 'anthropic-server-secret' },
    });

    expect(config).toMatchObject({
      providerId: 'byok-anthropic-compatible',
      modelId: 'claude-sonnet-4-6',
      modelApi: 'anthropic-messages',
      baseUrl: 'https://api.anthropic.com',
      secretEnv: { MEDHELP_PI_API_KEY: 'anthropic-server-secret' },
    });
    expect(config.modelConfig.providers['medhelp-byok-anthropic-compatible']).toMatchObject({
      api: 'anthropic-messages',
      authHeader: false,
      apiKey: '$MEDHELP_PI_API_KEY',
    });
    expect(JSON.stringify(config.modelConfig)).not.toContain('anthropic-server-secret');
  });

  it('rejects model protocols from the other provider family', () => {
    expect(() => resolvePiProviderConfig({
      modelProviderId: 'byok-anthropic-compatible',
      modelId: 'claude-sonnet-4-6',
      modelApi: 'openai-completions',
    }, {
      env: { ANTHROPIC_API_KEY: 'anthropic-server-secret' },
    })).toThrowError(expect.objectContaining({ code: 'PI_PROVIDER_CONFIG_INVALID' }));
  });

  it('reports missing server-side BYOK credentials without exposing a partial endpoint', () => {
    expect(getPiProviderStatus({
      env: {
        MEDHELP_PI_PROVIDER: 'byok-openai-compatible',
        MEDHELP_PI_MODEL: 'model-a',
        MEDHELP_PI_BASE_URL: 'https://models.example.test/v1',
      },
    })).toMatchObject({
      configured: false,
      code: 'PI_PROVIDER_NOT_CONFIGURED',
      baseUrl: null,
    });
  });

  it('requires managed-free selections to come from the server catalog', () => {
    expect(() => resolvePiProviderConfig({
      modelProviderId: 'managed-free',
      modelId: 'model-a',
    }, { env: {} })).toThrowError(expect.objectContaining({ code: 'PI_MANAGED_FREE_CONFIG_REQUIRED' }));
  });
});
