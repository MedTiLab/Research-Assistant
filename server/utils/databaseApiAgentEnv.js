import crypto from 'crypto';
import { credentialsDb, userSettingsDb } from '../database/db.js';
import { withAllowedDataFoldersAgentEnv } from './allowedDataFolders.js';
export { getAllowedDataFoldersAgentEnv } from './allowedDataFolders.js';

export const DATABASE_API_BASE_URL_CREDENTIAL_TYPE = 'medhelp_database_api_base_url';
export const DATABASE_API_TOKEN_CREDENTIAL_TYPE = 'medhelp_database_api_token';
export const DATABASE_API_CONNECTION_STATE_SETTING_KEY = 'medhelp_database_api_connection_state';
export const DEFAULT_DATABASE_API_BASE_URL = 'https://api.medtimehelp.com';
const DATABASE_API_CONNECTION_STATUSES = new Set([
  'connected',
  'not_configured',
  'unverified',
  'invalid_credentials',
  'access_denied',
  'unavailable',
  'invalid_response',
]);

export function normalizeDatabaseApiBaseUrl(rawValue) {
  const value = String(rawValue || DEFAULT_DATABASE_API_BASE_URL)
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api\/v1$/i, '');
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function getDatabaseApiCredentialForUser(userId) {
  if (!userId) {
    return {
      baseUrl: DEFAULT_DATABASE_API_BASE_URL,
      token: '',
      tokenConfigured: false,
    };
  }

  const baseUrl = normalizeDatabaseApiBaseUrl(
    credentialsDb.getActiveCredential(userId, DATABASE_API_BASE_URL_CREDENTIAL_TYPE)
      || DEFAULT_DATABASE_API_BASE_URL
  ) || DEFAULT_DATABASE_API_BASE_URL;
  const token = String(
    credentialsDb.getActiveCredential(userId, DATABASE_API_TOKEN_CREDENTIAL_TYPE)
      || ''
  ).trim();

  return {
    baseUrl,
    token,
    tokenConfigured: Boolean(token),
  };
}

function getDatabaseApiCredentialFingerprint(baseUrl, token) {
  return crypto
    .createHash('sha256')
    .update(`${baseUrl}\0${token}`)
    .digest('hex');
}

export function getDatabaseApiConnectionStateForUser(userId) {
  const credential = getDatabaseApiCredentialForUser(userId);
  const baseState = {
    connected: false,
    status: credential.tokenConfigured ? 'unverified' : 'not_configured',
    baseUrl: credential.baseUrl,
    tokenConfigured: credential.tokenConfigured,
    verifiedAt: null,
    accessibleSourceCount: null,
  };
  if (!userId || !credential.tokenConfigured) {
    return baseState;
  }

  let storedState = null;
  try {
    storedState = JSON.parse(
      userSettingsDb.get(userId, DATABASE_API_CONNECTION_STATE_SETTING_KEY) || 'null'
    );
  } catch {
    return baseState;
  }
  if (!storedState || typeof storedState !== 'object') {
    return baseState;
  }

  const expectedFingerprint = getDatabaseApiCredentialFingerprint(
    credential.baseUrl,
    credential.token
  );
  if (storedState.credentialFingerprint !== expectedFingerprint) {
    return baseState;
  }

  const status = DATABASE_API_CONNECTION_STATUSES.has(storedState.status)
    ? storedState.status
    : 'unverified';
  return {
    ...baseState,
    connected: status === 'connected',
    status,
    verifiedAt: typeof storedState.verifiedAt === 'string' ? storedState.verifiedAt : null,
    accessibleSourceCount: Number.isInteger(storedState.accessibleSourceCount)
      ? Math.max(0, storedState.accessibleSourceCount)
      : null,
  };
}

export function saveDatabaseApiConnectionStateForUser(userId, state = {}) {
  const credential = getDatabaseApiCredentialForUser(userId);
  if (!userId || !credential.tokenConfigured) {
    return getDatabaseApiConnectionStateForUser(userId);
  }

  const status = DATABASE_API_CONNECTION_STATUSES.has(state.status)
    ? state.status
    : 'unverified';
  const storedState = {
    status,
    verifiedAt: typeof state.verifiedAt === 'string'
      ? state.verifiedAt
      : new Date().toISOString(),
    accessibleSourceCount: Number.isInteger(state.accessibleSourceCount)
      ? Math.max(0, state.accessibleSourceCount)
      : null,
    credentialFingerprint: getDatabaseApiCredentialFingerprint(
      credential.baseUrl,
      credential.token
    ),
  };
  userSettingsDb.set(
    userId,
    DATABASE_API_CONNECTION_STATE_SETTING_KEY,
    JSON.stringify(storedState)
  );
  return getDatabaseApiConnectionStateForUser(userId);
}

export function clearDatabaseApiConnectionStateForUser(userId) {
  if (userId) {
    userSettingsDb.delete(userId, DATABASE_API_CONNECTION_STATE_SETTING_KEY);
  }
}

export function getDatabaseApiAgentEnvForUser(userId) {
  const credential = getDatabaseApiCredentialForUser(userId);
  const connection = getDatabaseApiConnectionStateForUser(userId);
  const connectionEnv = {
    MEDHELP_DATABASE_API_CONNECTION_STATUS: connection.status,
  };
  if (!connection.connected) {
    return connectionEnv;
  }

  return {
    ...connectionEnv,
    MEDHELP_DATABASE_API_URL: credential.baseUrl,
    DATABASE_API_URL: credential.baseUrl,
    MEDHELP_DATABASE_API_TOKEN: credential.token,
    DATABASE_API_TOKEN: credential.token,
    ...(connection.verifiedAt
      ? { MEDHELP_DATABASE_API_CONNECTION_VERIFIED_AT: connection.verifiedAt }
      : {}),
    ...(Number.isInteger(connection.accessibleSourceCount)
      ? { MEDHELP_DATABASE_API_ACCESSIBLE_SOURCE_COUNT: String(connection.accessibleSourceCount) }
      : {}),
  };
}

export function getDatabaseApiAgentEnvState(env = {}) {
  return {
    databaseApiTokenConfigured: Boolean(env.MEDHELP_DATABASE_API_TOKEN || env.DATABASE_API_TOKEN),
    databaseApiBaseUrl: env.MEDHELP_DATABASE_API_URL || env.DATABASE_API_URL || null,
    databaseApiConnectionStatus: env.MEDHELP_DATABASE_API_CONNECTION_STATUS || null,
    databaseApiConnectionVerifiedAt: env.MEDHELP_DATABASE_API_CONNECTION_VERIFIED_AT || null,
    databaseApiAccessibleSourceCount: env.MEDHELP_DATABASE_API_ACCESSIBLE_SOURCE_COUNT || null,
    allowedDataFoldersConfigured: Boolean(env.MEDHELP_ALLOWED_DATA_FOLDERS),
    localDatabaseAppRoot: env.MEDHELP_LOCAL_DATABASE_APP_ROOT || null,
    localDatabaseRawRoot: env.MEDHELP_LOCAL_DATABASE_RAW_ROOT || null,
  };
}

export function withDatabaseApiAgentEnv(baseEnv = process.env, userId = null) {
  const hasInjectedDatabaseToken = Boolean(
    (baseEnv?.MEDHELP_DATABASE_API_TOKEN || baseEnv?.DATABASE_API_TOKEN)
      && baseEnv?.MEDHELP_DATABASE_API_CONNECTION_STATUS === 'connected'
  );
  const databaseApiEnv = hasInjectedDatabaseToken
    ? {}
    : getDatabaseApiAgentEnvForUser(userId);
  const mergedEnv = {
    ...withAllowedDataFoldersAgentEnv(baseEnv),
    ...databaseApiEnv,
  };
  if (
    mergedEnv.MEDHELP_MANAGED_AGENT_SESSION === '1'
      && mergedEnv.MEDHELP_DATABASE_API_CONNECTION_STATUS !== 'connected'
  ) {
    delete mergedEnv.MEDHELP_DATABASE_API_URL;
    delete mergedEnv.DATABASE_API_URL;
    delete mergedEnv.MEDHELP_DATABASE_API_TOKEN;
    delete mergedEnv.DATABASE_API_TOKEN;
    delete mergedEnv.MEDHELP_DATABASE_API_CONNECTION_VERIFIED_AT;
    delete mergedEnv.MEDHELP_DATABASE_API_ACCESSIBLE_SOURCE_COUNT;
  }
  return mergedEnv;
}
