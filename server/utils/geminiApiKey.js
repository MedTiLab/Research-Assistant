import { credentialsDb } from '../database/db.js';

// Image-generation configuration only. Gemini is not an interactive agent provider.

export const DEFAULT_GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com';
export const MEDHELP_GEMINI_API_KEY_ENV = 'MEDHELP_GEMINI_API_KEY';
export const MEDHELP_GEMINI_API_BASE_URL_ENV = 'MEDHELP_GEMINI_API_BASE_URL';

export function normalizeGeminiApiBaseUrl(value) {
  const normalized = String(value || '').trim().replace(/\/+$/, '');
  return normalized || DEFAULT_GEMINI_API_BASE_URL;
}

export function isOfficialGeminiApiBaseUrl(value = process.env.GEMINI_API_BASE_URL) {
  return normalizeGeminiApiBaseUrl(value) === DEFAULT_GEMINI_API_BASE_URL;
}

export function resolveGeminiDirectApiConfig(userId = null) {
  let userApiKey = null;
  let userBaseUrl = null;

  if (userId) {
    try {
      userApiKey = credentialsDb.getActiveCredential(userId, 'gemini_api_key');
    } catch (error) {
      console.error('[WARN] Failed to load Gemini API key from DB:', error.message);
    }

    try {
      userBaseUrl = credentialsDb.getActiveCredential(userId, 'gemini_api_base_url');
    } catch (error) {
      console.error('[WARN] Failed to load Gemini API base URL from DB:', error.message);
    }
  }

  const envApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
  const envBaseUrl = process.env.GEMINI_API_BASE_URL || null;
  const apiKey = userApiKey || envApiKey || null;
  const baseUrl = normalizeGeminiApiBaseUrl(userBaseUrl || envBaseUrl);

  return {
    apiKey,
    baseUrl,
    configured: Boolean(apiKey),
    keySource: userApiKey ? 'user_credential' : envApiKey ? 'server_env' : null,
    baseUrlSource: userBaseUrl ? 'user_setting' : envBaseUrl ? 'server_env' : 'default',
    gatewayMode: isOfficialGeminiApiBaseUrl(baseUrl) ? 'official' : 'third_party',
  };
}

export function withGeminiDirectApiEnv(baseEnv = process.env, directApiConfig = null) {
  const nextEnv = { ...baseEnv };
  const config = directApiConfig && typeof directApiConfig === 'object'
    ? directApiConfig
    : { apiKey: directApiConfig || null, baseUrl: baseEnv.GEMINI_API_BASE_URL || null };
  const apiKey = config?.apiKey || null;
  const baseUrl = config?.baseUrl ? normalizeGeminiApiBaseUrl(config.baseUrl) : null;

  if (apiKey) {
    nextEnv[MEDHELP_GEMINI_API_KEY_ENV] = apiKey;
    nextEnv.GEMINI_API_KEY = apiKey;
    nextEnv.GOOGLE_API_KEY = apiKey;
  } else {
    delete nextEnv[MEDHELP_GEMINI_API_KEY_ENV];
    delete nextEnv.GEMINI_API_KEY;
    delete nextEnv.GOOGLE_API_KEY;
  }

  if (baseUrl) {
    nextEnv[MEDHELP_GEMINI_API_BASE_URL_ENV] = baseUrl;
    nextEnv.GEMINI_API_BASE_URL = baseUrl;
  } else {
    delete nextEnv[MEDHELP_GEMINI_API_BASE_URL_ENV];
    delete nextEnv.GEMINI_API_BASE_URL;
  }

  return nextEnv;
}
