import { afterEach, describe, expect, it } from 'vitest';

import {
  resolveGeminiDirectApiConfig,
  withGeminiDirectApiEnv,
} from '../utils/geminiApiKey.js';

const originalGeminiApiKey = process.env.GEMINI_API_KEY;
const originalGoogleApiKey = process.env.GOOGLE_API_KEY;
const originalGeminiApiBaseUrl = process.env.GEMINI_API_BASE_URL;

afterEach(() => {
  process.env.GEMINI_API_KEY = originalGeminiApiKey;
  process.env.GOOGLE_API_KEY = originalGoogleApiKey;
  process.env.GEMINI_API_BASE_URL = originalGeminiApiBaseUrl;
});

describe('image-generation API configuration', () => {
  it('falls back to GOOGLE_API_KEY for image generation', () => {
    delete process.env.GEMINI_API_KEY;
    process.env.GOOGLE_API_KEY = 'google-env-key';

    expect(resolveGeminiDirectApiConfig(null)).toMatchObject({
      apiKey: 'google-env-key',
      keySource: 'server_env',
      configured: true,
    });
  });

  it('injects direct API env for tool scripts while preserving the configured gateway', () => {
    const env = withGeminiDirectApiEnv(
      { PATH: process.env.PATH || '' },
      { apiKey: 'user-key', baseUrl: 'https://api.go-model.com' },
    );

    expect(env.GEMINI_API_KEY).toBe('user-key');
    expect(env.GOOGLE_API_KEY).toBe('user-key');
    expect(env.GEMINI_API_BASE_URL).toBe('https://api.go-model.com');
    expect(env.MEDHELP_GEMINI_API_KEY).toBe('user-key');
    expect(env.MEDHELP_GEMINI_API_BASE_URL).toBe('https://api.go-model.com');
  });
});
