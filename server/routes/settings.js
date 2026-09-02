import express from 'express';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import TOML from '@iarna/toml';
import {
  apiKeysDb,
  appSettingsDb,
  credentialsDb,
  userDb,
  userLongTermMemoryDb,
  userPreferenceMemoryDb,
  userSettingsDb,
} from '../database/db.js';
import { abortCodexSession, getActiveCodexSessions } from '../openai-codex.js';
import {
  CLAUDE_MODELS,
  CODEX_MODELS,
  getClaudeModelContextWindow,
  getCodexModelContextWindow,
  isClaudeModelSelection,
  isCodexExecutableModel,
} from '../../shared/modelConstants.js';
import { resolveClaudeCodeExecutable } from '../utils/claudeCodeExecutable.js';
import {
  USER_PREFERENCE_MEMORY_MAX_CONTENT_LENGTH,
  USER_PREFERENCE_MEMORY_MAX_ITEMS,
  normalizeUserPreferenceMemoryCategory,
  normalizeUserPreferenceProjectKey,
  normalizeUserPreferenceMemoryScope,
  sanitizeUserPreferenceMemoryContent,
} from '../utils/userPreferenceMemory.js';
import {
  buildImChannelStatus,
  ensureDomesticChannelRuntime,
  ensureWeixinRuntime,
  loadImChannelSettings,
  normalizeImChannelSettings,
  saveImChannelSettings,
  stopDomesticChannelRuntime,
  stopWeixinRuntime,
  trimString,
  validateDomesticChannelCredentials,
} from '../services/im-channel-runtime.js';
import {
  DATABASE_API_BASE_URL_CREDENTIAL_TYPE,
  DATABASE_API_TOKEN_CREDENTIAL_TYPE,
  DEFAULT_DATABASE_API_BASE_URL,
  clearDatabaseApiConnectionStateForUser,
  getDatabaseApiAgentEnvForUser,
  getDatabaseApiAgentEnvState,
  normalizeDatabaseApiBaseUrl,
  saveDatabaseApiConnectionStateForUser,
} from '../utils/databaseApiAgentEnv.js';
import { requireCapability } from '../utils/entitlements.js';
import { isSafeLongTermMemoryContent } from '../user-memory/memory-policy.js';
import {
  ensureDatabaseApiConnectionForUser,
  verifyDatabaseApiConnection,
} from '../utils/databaseApiConnector.js';

const router = express.Router();
const AUTO_RESEARCH_SENDER_EMAIL_KEY = 'auto_research_sender_email';
const AUTO_RESEARCH_RESEND_API_KEY = 'auto_research_resend_api_key';
const FEISHU_TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const FEISHU_ACCOUNTS_URLS = {
  feishu: 'https://accounts.feishu.cn',
};
const FEISHU_REGISTRATION_PATH = '/oauth/v1/app/registration';

function parsePositiveInteger(rawValue) {
  const value = Number.parseInt(rawValue, 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function getMemoryContentOrError(rawContent) {
  const content = sanitizeUserPreferenceMemoryContent(rawContent);
  if (!content) {
    return { error: 'Memory content is required' };
  }
  if (content.length > USER_PREFERENCE_MEMORY_MAX_CONTENT_LENGTH) {
    return {
      error: `Memory content must be ${USER_PREFERENCE_MEMORY_MAX_CONTENT_LENGTH} characters or less`,
    };
  }
  return { content };
}

function getMemoryScopePayload(rawScope, rawProjectPath, rawProjectKey) {
  const projectPath = typeof rawProjectPath === 'string' ? rawProjectPath.trim() : '';
  const projectKey = normalizeUserPreferenceProjectKey(rawProjectKey, projectPath);
  const scope = rawScope === undefined && projectPath
    ? 'project'
    : normalizeUserPreferenceMemoryScope(rawScope);

  if (scope === 'project' && !projectPath && !projectKey) {
    return { error: 'projectPath or projectKey is required for project-scoped memory' };
  }

  return {
    scope,
    projectPath: scope === 'project' ? projectPath : null,
    projectKey: scope === 'project' ? projectKey : null,
  };
}

function replaceCredentialForType(userId, type, name, value, description = null) {
  const existingCredentials = credentialsDb.getCredentials(userId, type) || [];
  for (const credential of existingCredentials) {
    credentialsDb.deleteCredential(userId, credential.id);
  }
  return credentialsDb.createCredential(userId, name, type, value, description);
}

function deleteCredentialsForType(userId, type) {
  const existingCredentials = credentialsDb.getCredentials(userId, type) || [];
  for (const credential of existingCredentials) {
    credentialsDb.deleteCredential(userId, credential.id);
  }
}

function databaseApiConnectionError(status) {
  if (status === 'invalid_credentials') {
    return { statusCode: 401, error: 'Database API credentials were rejected' };
  }
  if (status === 'access_denied') {
    return { statusCode: 403, error: 'Database API access is not authorized' };
  }
  if (status === 'invalid_response') {
    return { statusCode: 502, error: 'Unexpected Database API response' };
  }
  return { statusCode: 502, error: 'Database API service is unavailable' };
}

// ===============================
// API Keys Management
// ===============================

// Get all API keys for the authenticated user
router.get('/api-keys', async (req, res) => {
  try {
    const apiKeys = apiKeysDb.getApiKeys(req.user.id);
    // Don't send the full API key in the list for security
    const sanitizedKeys = apiKeys.map(key => ({
      ...key,
      api_key: key.api_key.substring(0, 10) + '...'
    }));
    res.json({ apiKeys: sanitizedKeys });
  } catch (error) {
    console.error('Error fetching API keys:', error);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// Create a new API key
router.post('/api-keys', async (req, res) => {
  try {
    const { keyName } = req.body;

    if (!keyName || !keyName.trim()) {
      return res.status(400).json({ error: 'Key name is required' });
    }

    const result = apiKeysDb.createApiKey(req.user.id, keyName.trim());
    res.json({
      success: true,
      apiKey: result
    });
  } catch (error) {
    console.error('Error creating API key:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// Delete an API key
router.delete('/api-keys/:keyId', async (req, res) => {
  try {
    const { keyId } = req.params;
    const success = apiKeysDb.deleteApiKey(req.user.id, parseInt(keyId));

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'API key not found' });
    }
  } catch (error) {
    console.error('Error deleting API key:', error);
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

// Toggle API key active status
router.patch('/api-keys/:keyId/toggle', async (req, res) => {
  try {
    const { keyId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }

    const success = apiKeysDb.toggleApiKey(req.user.id, parseInt(keyId), isActive);

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'API key not found' });
    }
  } catch (error) {
    console.error('Error toggling API key:', error);
    res.status(500).json({ error: 'Failed to toggle API key' });
  }
});

// ===============================
// Generic Credentials Management
// ===============================

// Get all credentials for the authenticated user (optionally filtered by type)
router.get('/credentials', async (req, res) => {
  try {
    const { type } = req.query;
    const credentials = credentialsDb.getCredentials(req.user.id, type || null);
    // Don't send the actual credential values for security
    res.json({ credentials });
  } catch (error) {
    console.error('Error fetching credentials:', error);
    res.status(500).json({ error: 'Failed to fetch credentials' });
  }
});

// Create a new credential
router.post('/credentials', async (req, res) => {
  try {
    const { credentialName, credentialType, credentialValue, description } = req.body;

    if (!credentialName || !credentialName.trim()) {
      return res.status(400).json({ error: 'Credential name is required' });
    }

    if (!credentialType || !credentialType.trim()) {
      return res.status(400).json({ error: 'Credential type is required' });
    }

    if (!credentialValue || !credentialValue.trim()) {
      return res.status(400).json({ error: 'Credential value is required' });
    }

    const result = credentialsDb.createCredential(
      req.user.id,
      credentialName.trim(),
      credentialType.trim(),
      credentialValue.trim(),
      description?.trim() || null
    );

    res.json({
      success: true,
      credential: result
    });
  } catch (error) {
    console.error('Error creating credential:', error);
    res.status(500).json({ error: 'Failed to create credential' });
  }
});

// Delete a credential
router.delete('/credentials/:credentialId', async (req, res) => {
  try {
    const { credentialId } = req.params;
    const success = credentialsDb.deleteCredential(req.user.id, parseInt(credentialId));

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Credential not found' });
    }
  } catch (error) {
    console.error('Error deleting credential:', error);
    res.status(500).json({ error: 'Failed to delete credential' });
  }
});

// Toggle credential active status
router.patch('/credentials/:credentialId/toggle', async (req, res) => {
  try {
    const { credentialId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }

    const success = credentialsDb.toggleCredential(req.user.id, parseInt(credentialId), isActive);

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Credential not found' });
    }
  } catch (error) {
    console.error('Error toggling credential:', error);
    res.status(500).json({ error: 'Failed to toggle credential' });
  }
});

router.get('/database-api-access', async (req, res) => {
  try {
    const baseUrl = credentialsDb.getActiveCredential(req.user.id, DATABASE_API_BASE_URL_CREDENTIAL_TYPE)
      || DEFAULT_DATABASE_API_BASE_URL;
    const tokenConfigured = Boolean(credentialsDb.getActiveCredential(req.user.id, DATABASE_API_TOKEN_CREDENTIAL_TYPE));
    const connection = await ensureDatabaseApiConnectionForUser(req.user.id);

    res.json({
      baseUrl,
      tokenConfigured,
      tokenType: 'Bearer',
      connection,
    });
  } catch (error) {
    console.error('Error fetching database API settings:', error);
    res.status(500).json({ error: 'Failed to load database API settings' });
  }
});

router.get('/agent-runtime-env', async (req, res) => {
  try {
    if (req.get('x-medhelp-client') !== 'local-kernel') {
      return res.status(403).json({ error: 'Agent runtime environment is only available to paired local runtimes' });
    }

    const connection = await ensureDatabaseApiConnectionForUser(req.user.id);
    const env = getDatabaseApiAgentEnvForUser(req.user.id);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      success: true,
      env,
      state: getDatabaseApiAgentEnvState(env),
      connection,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching agent runtime env:', error);
    res.status(500).json({ error: 'Failed to load agent runtime environment' });
  }
});

router.post('/database-api-access/test', async (req, res) => {
  try {
    const savedBaseUrl = normalizeDatabaseApiBaseUrl(
      credentialsDb.getActiveCredential(req.user.id, DATABASE_API_BASE_URL_CREDENTIAL_TYPE)
        || DEFAULT_DATABASE_API_BASE_URL
    );
    const savedToken = String(
      credentialsDb.getActiveCredential(req.user.id, DATABASE_API_TOKEN_CREDENTIAL_TYPE) || ''
    ).trim();
    const baseUrl = normalizeDatabaseApiBaseUrl(req.body?.baseUrl || savedBaseUrl);
    const submittedToken = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const token = submittedToken || savedToken;

    if (!baseUrl) {
      return res.status(400).json({ success: false, error: 'Invalid API base URL' });
    }
    if (!token) {
      return res.status(400).json({ success: false, error: 'Database API token is required' });
    }

    const verification = await verifyDatabaseApiConnection({ baseUrl, token });
    const testingSavedCredential = !submittedToken
      && baseUrl === savedBaseUrl
      && Boolean(savedToken);
    const connection = testingSavedCredential
      ? saveDatabaseApiConnectionStateForUser(req.user.id, verification)
      : verification;

    res.json({
      success: verification.connected,
      persisted: testingSavedCredential,
      connection,
    });
  } catch (error) {
    console.error('Error testing database API connection:', error);
    res.status(500).json({ success: false, error: 'Failed to test database API connection' });
  }
});

router.put('/database-api-access', async (req, res) => {
  try {
    const baseUrl = normalizeDatabaseApiBaseUrl(req.body?.baseUrl);
    const tokenProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'token');
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';

    if (!baseUrl) {
      return res.status(400).json({ error: 'Invalid API base URL' });
    }

    const existingBaseUrl = normalizeDatabaseApiBaseUrl(
      credentialsDb.getActiveCredential(req.user.id, DATABASE_API_BASE_URL_CREDENTIAL_TYPE)
        || DEFAULT_DATABASE_API_BASE_URL
    );
    const existingToken = credentialsDb.getActiveCredential(req.user.id, DATABASE_API_TOKEN_CREDENTIAL_TYPE);
    if (!existingToken && (!tokenProvided || !token)) {
      return res.status(400).json({ error: 'Database API token is required' });
    }

    const candidateToken = token || existingToken;
    const verification = await verifyDatabaseApiConnection({
      baseUrl,
      token: candidateToken,
    });
    if (!verification.connected) {
      const failure = databaseApiConnectionError(verification.status);
      const testingSavedCredential = !token
        && baseUrl === existingBaseUrl
        && Boolean(existingToken);
      const connection = testingSavedCredential
        ? saveDatabaseApiConnectionStateForUser(req.user.id, verification)
        : verification;
      return res.status(failure.statusCode).json({
        success: false,
        error: failure.error,
        persisted: testingSavedCredential,
        connection,
      });
    }

    replaceCredentialForType(
      req.user.id,
      DATABASE_API_BASE_URL_CREDENTIAL_TYPE,
      'MedHelp Database API Base URL',
      baseUrl,
      'Remote MedHelp database API endpoint for /api/v1 calls'
    );

    if (tokenProvided && token) {
      replaceCredentialForType(
        req.user.id,
        DATABASE_API_TOKEN_CREDENTIAL_TYPE,
        'MedHelp Database API Token',
        token,
        'Bearer token for the remote MedHelp database API'
      );
    }

    const connection = saveDatabaseApiConnectionStateForUser(req.user.id, verification);

    res.json({
      success: true,
      baseUrl,
      tokenConfigured: Boolean(token || existingToken),
      tokenType: 'Bearer',
      connection,
    });
  } catch (error) {
    console.error('Error saving database API settings:', error);
    res.status(500).json({ error: 'Failed to save database API settings' });
  }
});

router.delete('/database-api-access', async (req, res) => {
  try {
    deleteCredentialsForType(req.user.id, DATABASE_API_BASE_URL_CREDENTIAL_TYPE);
    deleteCredentialsForType(req.user.id, DATABASE_API_TOKEN_CREDENTIAL_TYPE);
    clearDatabaseApiConnectionStateForUser(req.user.id);

    res.json({
      success: true,
      baseUrl: DEFAULT_DATABASE_API_BASE_URL,
      tokenConfigured: false,
      tokenType: 'Bearer',
      connection: {
        connected: false,
        status: 'not_configured',
        baseUrl: DEFAULT_DATABASE_API_BASE_URL,
        tokenConfigured: false,
        verifiedAt: null,
        accessibleSourceCount: null,
      },
    });
  } catch (error) {
    console.error('Error clearing database API settings:', error);
    res.status(500).json({ error: 'Failed to clear database API settings' });
  }
});

router.get('/auto-research-email', async (req, res) => {
  try {
    res.json({
      senderEmail: userSettingsDb.get(req.user.id, AUTO_RESEARCH_SENDER_EMAIL_KEY),
    });
  } catch (error) {
    console.error('Error fetching Auto Research sender email:', error);
    res.status(500).json({ error: 'Failed to fetch Auto Research sender email' });
  }
});

router.put('/auto-research-email', async (req, res) => {
  try {
    const rawEmail = typeof req.body?.senderEmail === 'string' ? req.body.senderEmail.trim().toLowerCase() : '';
    if (!rawEmail) {
      return res.status(400).json({ error: 'Sender email is required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(rawEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    userSettingsDb.set(req.user.id, AUTO_RESEARCH_SENDER_EMAIL_KEY, rawEmail);
    res.json({ success: true, senderEmail: rawEmail });
  } catch (error) {
    console.error('Error saving Auto Research sender email:', error);
    res.status(500).json({ error: 'Failed to save Auto Research sender email' });
  }
});

router.get('/auto-research-resend-key', async (req, res) => {
  try {
    const apiKey = appSettingsDb.get(AUTO_RESEARCH_RESEND_API_KEY);
    res.json({
      configured: Boolean(apiKey),
      maskedKey: apiKey ? `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}` : null,
    });
  } catch (error) {
    console.error('Error fetching Auto Research Resend key:', error);
    res.status(500).json({ error: 'Failed to fetch Auto Research Resend key' });
  }
});

router.put('/auto-research-resend-key', async (req, res) => {
  try {
    const rawKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
    if (!rawKey) {
      return res.status(400).json({ error: 'Resend API key is required' });
    }

    appSettingsDb.set(AUTO_RESEARCH_RESEND_API_KEY, rawKey);
    res.json({
      success: true,
      configured: true,
      maskedKey: `${rawKey.slice(0, 6)}...${rawKey.slice(-4)}`,
    });
  } catch (error) {
    console.error('Error saving Auto Research Resend key:', error);
    res.status(500).json({ error: 'Failed to save Auto Research Resend key' });
  }
});

// ===============================
// IM Channels
// ===============================

async function postFeishuRegistration(domainName, body) {
  const baseUrl = FEISHU_ACCOUNTS_URLS.feishu;
  const response = await fetch(`${baseUrl}${FEISHU_REGISTRATION_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${baseUrl}: ${text.slice(0, 200)}`);
  }
}

router.get('/im-channels/status', async (req, res) => {
  try {
    res.json(buildImChannelStatus(req.user.id));
  } catch (error) {
    console.error('Error fetching IM channel status:', error);
    res.status(500).json({ error: 'Failed to fetch IM channel status' });
  }
});

router.put('/im-channels/default-agent', async (req, res) => {
  try {
    if (req.body?.defaultAgent && req.body.defaultAgent !== 'pi') {
      return res.status(400).json({ ok: false, error: 'IM 通道仅支持 Pi 智能体' });
    }
    const saved = saveImChannelSettings(req.user.id, {
      ...loadImChannelSettings(req.user.id),
      defaultAgent: 'pi',
    });
    res.json({ ok: true, status: buildImChannelStatus(req.user.id, saved) });
  } catch (error) {
    console.error('Error saving IM default agent:', error);
    res.status(500).json({ ok: false, error: 'Failed to save IM default agent' });
  }
});

router.post('/im-channels/feishu/test', async (req, res) => {
  const appId = trimString(req.body?.appId);
  const appSecret = trimString(req.body?.appSecret);
  const domainName = 'feishu';

  if (!appId || !appSecret) {
    return res.status(400).json({ ok: false, error: 'appId and appSecret are required' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(FEISHU_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const payload = await response.json();
    if (payload.code === 0 && payload.tenant_access_token) {
      return res.json({ ok: true, message: 'Credentials verified' });
    }
    return res.json({ ok: false, error: `code=${payload.code} msg=${payload.msg || 'unknown'}` });
  } catch (error) {
    clearTimeout(timer);
    if (error.name === 'AbortError') {
      return res.json({ ok: false, error: 'Connection timed out after 10 seconds' });
    }
    return res.json({ ok: false, error: error.message });
  }
});

router.post('/im-channels/feishu/qr-begin', async (req, res) => {
  const domainName = 'feishu';

  try {
    const initResponse = await postFeishuRegistration(domainName, { action: 'init' });
    const methods = Array.isArray(initResponse.supported_auth_methods)
      ? initResponse.supported_auth_methods
      : [];
    if (!methods.includes('client_secret')) {
      return res.json({
        ok: false,
        error: `Registration environment does not support client_secret. Supported: ${methods.join(', ')}`,
      });
    }

    const beginResponse = await postFeishuRegistration(domainName, {
      action: 'begin',
      archetype: 'PersonalAgent',
      auth_method: 'client_secret',
      request_user_info: 'open_id',
    });
    const deviceCode = beginResponse.device_code;
    const qrUrl = beginResponse.verification_uri_complete || '';

    if (!deviceCode || !qrUrl) {
      return res.json({ ok: false, error: 'Feishu did not return a complete QR registration session' });
    }

    const qrStates = req.app.locals._medhelpFeishuQrByUser || new Map();
    req.app.locals._medhelpFeishuQrByUser = qrStates;
    qrStates.set(req.user.id, {
      deviceCode,
      domainName,
      expireIn: beginResponse.expire_in || 600,
      startedAt: Date.now(),
    });

    res.json({
      ok: true,
      qrUrl,
      userCode: beginResponse.user_code || '',
      expireIn: beginResponse.expire_in || 600,
    });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

router.get('/im-channels/feishu/qr-poll', async (req, res) => {
  const qrStates = req.app.locals._medhelpFeishuQrByUser;
  const state = qrStates?.get(req.user.id);
  if (!state) {
    return res.json({ ok: false, error: 'No Feishu QR registration session is active' });
  }

  const elapsed = (Date.now() - state.startedAt) / 1000;
  if (elapsed > state.expireIn) {
    qrStates.delete(req.user.id);
    return res.json({ ok: false, error: 'QR code expired' });
  }

  try {
    const pollResponse = await postFeishuRegistration(state.domainName, {
      action: 'poll',
      device_code: state.deviceCode,
      tp: 'ob_app',
    });

    const userInfo = pollResponse.user_info || {};
    if (pollResponse.client_id && pollResponse.client_secret) {
      qrStates.delete(req.user.id);
      const settings = loadImChannelSettings(req.user.id);
      settings.feishu = {
        enabled: true,
        appId: pollResponse.client_id,
        appSecret: pollResponse.client_secret,
        connectionMode: 'stream',
        domainName: state.domainName,
      };
      saveImChannelSettings(req.user.id, settings);
      const runtime = await ensureDomesticChannelRuntime(req.user.id, 'feishu', settings);
      if (!runtime?.running) {
        return res.json({ ok: false, error: runtime?.lastError || '飞书长连接启动失败' });
      }

      return res.json({
        ok: true,
        appId: pollResponse.client_id,
        domainName: state.domainName,
        openId: userInfo.open_id || null,
      });
    }

    const error = pollResponse.error || '';
    if (error === 'access_denied' || error === 'expired_token') {
      qrStates.delete(req.user.id);
      return res.json({ ok: false, error: `Registration ${error}` });
    }

    return res.json({ pending: true });
  } catch {
    return res.json({ pending: true });
  }
});

router.post('/im-channels/feishu/qr-cancel', (req, res) => {
  req.app.locals._medhelpFeishuQrByUser?.delete(req.user.id);
  res.json({ ok: true });
});

router.post('/im-channels/feishu/save', async (req, res) => {
  const appId = trimString(req.body?.appId);
  const appSecret = trimString(req.body?.appSecret);

  if (!appId || !appSecret) {
    return res.status(400).json({ ok: false, error: 'appId and appSecret are required' });
  }

  try {
    const settings = loadImChannelSettings(req.user.id);
    settings.feishu = {
      enabled: true,
      appId,
      appSecret,
      connectionMode: req.body?.connectionMode === 'webhook' ? 'webhook' : 'stream',
      domainName: 'feishu',
    };
    const saved = saveImChannelSettings(req.user.id, settings);
    const runtime = await ensureDomesticChannelRuntime(req.user.id, 'feishu', saved);
    if (!runtime?.running) {
      return res.status(400).json({
        ok: false,
        error: runtime?.lastError || '飞书长连接启动失败',
        status: buildImChannelStatus(req.user.id, saved),
      });
    }
    res.json({ ok: true, status: buildImChannelStatus(req.user.id, saved) });
  } catch (error) {
    console.error('Error saving Feishu IM channel:', error);
    res.status(500).json({ ok: false, error: 'Failed to save Feishu IM channel' });
  }
});

router.post('/im-channels/feishu/disable', async (req, res) => {
  try {
    const settings = loadImChannelSettings(req.user.id);
    settings.feishu.enabled = false;
    const saved = saveImChannelSettings(req.user.id, settings);
    await stopDomesticChannelRuntime(req.user.id, 'feishu');
    res.json({ ok: true, status: buildImChannelStatus(req.user.id, saved) });
  } catch (error) {
    console.error('Error disabling Feishu IM channel:', error);
    res.status(500).json({ ok: false, error: 'Failed to disable Feishu IM channel' });
  }
});

const DOMESTIC_CREDENTIAL_CHANNELS = new Set(['dingtalk', 'wecom', 'qq']);

router.post('/im-channels/:platform/test', async (req, res, next) => {
  const platform = trimString(req.params.platform).toLowerCase();
  if (!DOMESTIC_CREDENTIAL_CHANNELS.has(platform)) return next();
  try {
    const result = await validateDomesticChannelCredentials(platform, {
      appId: req.body?.appId,
      appSecret: req.body?.appSecret,
      botId: req.body?.botId,
      secret: req.body?.secret,
      userId: req.user.id,
    });
    res.json(result);
  } catch (error) {
    res.json({ ok: false, error: error.message || '连接测试失败' });
  }
});

router.post('/im-channels/:platform/save', async (req, res, next) => {
  const platform = trimString(req.params.platform).toLowerCase();
  if (!DOMESTIC_CREDENTIAL_CHANNELS.has(platform)) return next();
  try {
    const settings = loadImChannelSettings(req.user.id);
    if (platform === 'wecom') {
      const botId = trimString(req.body?.botId);
      const secret = trimString(req.body?.secret);
      if (!botId || !secret) {
        return res.status(400).json({ ok: false, error: 'botId and secret are required' });
      }
      settings.wecom = { enabled: true, botId, secret };
    } else {
      const appId = trimString(req.body?.appId);
      const appSecret = trimString(req.body?.appSecret);
      if (!appId || !appSecret) {
        return res.status(400).json({ ok: false, error: 'appId and appSecret are required' });
      }
      settings[platform] = { enabled: true, appId, appSecret };
    }
    const saved = saveImChannelSettings(req.user.id, settings);
    const runtime = await ensureDomesticChannelRuntime(req.user.id, platform, saved);
    if (!runtime?.running) {
      return res.status(400).json({
        ok: false,
        error: runtime?.lastError || `${platform} runtime failed to start`,
        status: buildImChannelStatus(req.user.id, saved),
      });
    }
    res.json({ ok: true, status: buildImChannelStatus(req.user.id, saved) });
  } catch (error) {
    console.error(`Error saving ${platform} IM channel:`, error);
    res.status(500).json({ ok: false, error: error.message || 'Failed to save IM channel' });
  }
});

router.post('/im-channels/:platform/disable', async (req, res, next) => {
  const platform = trimString(req.params.platform).toLowerCase();
  if (!DOMESTIC_CREDENTIAL_CHANNELS.has(platform)) return next();
  try {
    const settings = loadImChannelSettings(req.user.id);
    settings[platform].enabled = false;
    const saved = saveImChannelSettings(req.user.id, settings);
    await stopDomesticChannelRuntime(req.user.id, platform);
    res.json({ ok: true, status: buildImChannelStatus(req.user.id, saved) });
  } catch (error) {
    console.error(`Error disabling ${platform} IM channel:`, error);
    res.status(500).json({ ok: false, error: 'Failed to disable IM channel' });
  }
});

router.get('/im-channels/weixin/qr', async (req, res) => {
  try {
    const { loginWithQR } = await import('weixin-ilink');
    let responded = false;
    const loginStates = req.app.locals._medhelpWeixinLoginByUser || new Map();
    req.app.locals._medhelpWeixinLoginByUser = loginStates;
    const loginState = {
      resolved: false,
      result: null,
    };
    loginStates.set(req.user.id, loginState);

    const loginPromise = loginWithQR({
      onQRCode: (qrUrl) => {
        if (responded) return;
        responded = true;
        res.json({ ok: true, qrUrl });
      },
      onStatusChange: () => {},
    });

    loginPromise
      .then(async (result) => {
        const settings = loadImChannelSettings(req.user.id);
        settings.weixin = {
          enabled: true,
          baseUrl: trimString(result.baseUrl),
          botToken: trimString(result.botToken),
          accountId: trimString(result.accountId),
          cursor: '',
        };
        const saved = saveImChannelSettings(req.user.id, settings);
        await ensureWeixinRuntime(req.user.id, saved);

        loginState.result = {
          ok: true,
          accountId: result.accountId || null,
        };
        loginState.resolved = true;
      })
      .catch((error) => {
        loginState.result = {
          ok: false,
          error: error.message || String(error),
        };
        loginState.resolved = true;
      });

    setTimeout(() => {
      if (!responded) {
        responded = true;
        res.json({ ok: false, error: 'Timed out while generating the WeChat QR code' });
      }
    }, 15_000);
  } catch (error) {
    res.json({
      ok: false,
      error: error.code === 'ERR_MODULE_NOT_FOUND'
        ? 'Optional dependency weixin-ilink is not installed'
        : (error.message || 'Failed to load WeChat iLink'),
    });
  }
});

router.get('/im-channels/weixin/qr-poll', (req, res) => {
  const loginStates = req.app.locals._medhelpWeixinLoginByUser;
  const loginState = loginStates?.get(req.user.id);
  const resolved = loginState?.resolved;
  const result = loginState?.result;

  if (resolved && result) {
    loginStates.delete(req.user.id);
    return res.json(result);
  }

  return res.json({ pending: true });
});

router.post('/im-channels/weixin/save', async (req, res) => {
  const baseUrl = trimString(req.body?.baseUrl);
  const botToken = trimString(req.body?.botToken);
  const accountId = trimString(req.body?.accountId);

  if (!baseUrl || !botToken) {
    return res.status(400).json({ ok: false, error: 'baseUrl and botToken are required' });
  }

  try {
    const settings = loadImChannelSettings(req.user.id);
    settings.weixin = {
      enabled: true,
      baseUrl,
      botToken,
      accountId,
      cursor: '',
    };
    const saved = saveImChannelSettings(req.user.id, settings);
    await ensureWeixinRuntime(req.user.id, saved);
    res.json({ ok: true, status: buildImChannelStatus(req.user.id, saved) });
  } catch (error) {
    console.error('Error saving WeChat IM channel:', error);
    res.status(500).json({ ok: false, error: 'Failed to save WeChat IM channel' });
  }
});

router.post('/im-channels/weixin/disable', async (req, res) => {
  try {
    const userId = req.user.id;
    const settings = loadImChannelSettings(userId);
    settings.weixin.enabled = false;
    const saved = saveImChannelSettings(userId, settings);
    await stopWeixinRuntime(userId);
    res.json({ ok: true, status: buildImChannelStatus(userId, saved) });
  } catch (error) {
    console.error('Error disabling WeChat IM channel:', error);
    res.status(500).json({ ok: false, error: 'Failed to disable WeChat IM channel' });
  }
});

// ===============================
// User Preferences (legacy route name kept for paired older clients)
// ===============================

router.use(['/memory', '/preferences'], requireCapability('memory.persistent'));

router.get(['/memory/settings', '/preferences/settings'], async (req, res) => {
  try {
    res.json({
      enabled: userPreferenceMemoryDb.getMemoryEnabled(req.user.id),
    });
  } catch (error) {
    console.error('Error fetching memory settings:', error);
    res.status(500).json({ error: 'Failed to fetch memory settings' });
  }
});

router.patch(['/memory/settings', '/preferences/settings'], async (req, res) => {
  try {
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    res.json({
      enabled: userPreferenceMemoryDb.setMemoryEnabled(req.user.id, enabled),
    });
  } catch (error) {
    console.error('Error updating memory settings:', error);
    res.status(500).json({ error: 'Failed to update memory settings' });
  }
});

router.get(['/memory', '/preferences'], async (req, res) => {
  try {
    res.json({
      memories: userPreferenceMemoryDb.getAll(req.user.id),
    });
  } catch (error) {
    console.error('Error fetching memories:', error);
    res.status(500).json({ error: 'Failed to fetch memories' });
  }
});

// Compact account-owned context consumed by paired local Kernels before each turn.
router.get('/user-preference-context', async (req, res) => {
  try {
    const enabled = userPreferenceMemoryDb.getMemoryEnabled(req.user.id);
    const profile = userDb.getProfile(req.user.id);
    const memories = enabled
      ? userPreferenceMemoryDb.getAll(req.user.id)
        .filter((memory) => memory.is_enabled)
        .map((memory) => ({
          id: memory.id,
          content: memory.content,
          category: memory.category,
          scope: memory.scope,
          projectPath: memory.project_path || null,
          projectKey: memory.project_key || null,
          updatedAt: memory.updated_at || null,
        }))
      : [];

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      enabled,
      aboutYou: profile?.about_you || '',
      analysisLanguagePreference: profile?.analysis_language_preference || 'auto',
      autoResearchSenderEmail: userSettingsDb.get(req.user.id, AUTO_RESEARCH_SENDER_EMAIL_KEY) || '',
      memories,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching user preference context:', error);
    res.status(500).json({ error: 'Failed to fetch user preference context' });
  }
});

// Account-owned long-term memory, deliberately separate from user preferences.
router.use('/long-term-memory', requireCapability('memory.persistent'));

router.get('/long-term-memory/context', async (req, res) => {
  try {
    const settings = userLongTermMemoryDb.getSettings(req.user.id);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ...settings,
      memories: settings.enabled
        ? userLongTermMemoryDb.getAll(req.user.id, { limit: 300 })
          .filter((memory) => isSafeLongTermMemoryContent(memory.content))
          .map((memory) => ({
          id: memory.id,
          content: memory.content,
          source: memory.source,
          pinned: memory.pinned,
          conversationId: memory.conversation_id,
          updatedAt: memory.updated_at || null,
          }))
        : [],
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching long-term memory context:', error);
    res.status(500).json({ error: 'Failed to fetch long-term memory context' });
  }
});

router.get('/long-term-memory', async (req, res) => {
  try {
    res.json({
      settings: userLongTermMemoryDb.getSettings(req.user.id),
      memories: userLongTermMemoryDb.getAll(req.user.id),
      stats: userLongTermMemoryDb.getStats(req.user.id),
    });
  } catch (error) {
    console.error('Error fetching long-term memory:', error);
    res.status(500).json({ error: 'Failed to fetch long-term memory' });
  }
});

router.patch('/long-term-memory/settings', async (req, res) => {
  try {
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'enabled')) {
      if (typeof req.body.enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
      }
      updates.enabled = req.body.enabled;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'autoCaptureEnabled')) {
      if (typeof req.body.autoCaptureEnabled !== 'boolean') {
        return res.status(400).json({ error: 'autoCaptureEnabled must be a boolean' });
      }
      updates.autoCaptureEnabled = req.body.autoCaptureEnabled;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No settings updates provided' });
    }
    res.json({ settings: userLongTermMemoryDb.setSettings(req.user.id, updates) });
  } catch (error) {
    console.error('Error updating long-term memory settings:', error);
    res.status(500).json({ error: 'Failed to update long-term memory settings' });
  }
});

router.post('/long-term-memory', async (req, res) => {
  try {
    const result = userLongTermMemoryDb.create(req.user.id, req.body?.content, { source: 'manual' });
    res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to create memory', code: error.code || null });
  }
});

router.post('/long-term-memory/import', async (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.memories) ? req.body.memories.slice(0, 300) : null;
    if (!incoming) return res.status(400).json({ error: 'memories must be an array' });
    let added = 0;
    let skipped = 0;
    let rejected = 0;
    for (const item of incoming) {
      const record = typeof item === 'string' ? { content: item } : item;
      if (!record || typeof record.content !== 'string') {
        rejected += 1;
        continue;
      }
      try {
        const result = userLongTermMemoryDb.create(req.user.id, record.content, {
          source: record.source === 'automatic' ? 'automatic' : 'manual',
          pinned: record.pinned === true,
          conversationId: typeof record.conversationId === 'string' ? record.conversationId.slice(0, 240) : null,
        });
        if (result.created) added += 1;
        else skipped += 1;
      } catch {
        rejected += 1;
      }
    }
    res.json({ added, skipped, rejected, stats: userLongTermMemoryDb.getStats(req.user.id) });
  } catch (error) {
    console.error('Error importing long-term memory:', error);
    res.status(500).json({ error: 'Failed to import long-term memory' });
  }
});

router.post('/long-term-memory/capture', async (req, res) => {
  try {
    const settings = userLongTermMemoryDb.getSettings(req.user.id);
    if (!settings.autoCaptureEnabled) {
      return res.json({ added: 0, memories: [], autoCaptureEnabled: false });
    }
    const facts = Array.isArray(req.body?.facts) ? req.body.facts : [];
    const result = userLongTermMemoryDb.capture(req.user.id, facts, {
      conversationId: req.body?.conversationId,
    });
    res.json({ ...result, autoCaptureEnabled: true });
  } catch (error) {
    console.error('Error capturing long-term memory:', error);
    res.status(400).json({ error: error.message || 'Failed to capture memory' });
  }
});

router.patch('/long-term-memory/:memoryId/pinned', async (req, res) => {
  try {
    const memoryId = parsePositiveInteger(req.params.memoryId);
    if (!memoryId) return res.status(400).json({ error: 'Invalid memory ID' });
    if (typeof req.body?.pinned !== 'boolean') {
      return res.status(400).json({ error: 'pinned must be a boolean' });
    }
    const memory = userLongTermMemoryDb.setPinned(req.user.id, memoryId, req.body.pinned);
    if (!memory) return res.status(404).json({ error: 'Memory not found' });
    res.json({ memory });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update pinned memory' });
  }
});

router.delete('/long-term-memory/automatic', async (req, res) => {
  try {
    res.json({
      success: true,
      deleted: userLongTermMemoryDb.clear(req.user.id, { source: 'automatic' }),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear automatic memory' });
  }
});

router.put('/long-term-memory/:memoryId', async (req, res) => {
  try {
    const memoryId = parsePositiveInteger(req.params.memoryId);
    if (!memoryId) return res.status(400).json({ error: 'Invalid memory ID' });
    const memory = userLongTermMemoryDb.update(req.user.id, memoryId, req.body?.content);
    if (!memory) return res.status(404).json({ error: 'Memory not found' });
    res.json({ memory });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to update memory', code: error.code || null });
  }
});

router.delete('/long-term-memory/:memoryId', async (req, res) => {
  try {
    const memoryId = parsePositiveInteger(req.params.memoryId);
    if (!memoryId) return res.status(400).json({ error: 'Invalid memory ID' });
    if (!userLongTermMemoryDb.delete(req.user.id, memoryId)) {
      return res.status(404).json({ error: 'Memory not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete memory' });
  }
});

router.delete('/long-term-memory', async (req, res) => {
  try {
    res.json({ success: true, deleted: userLongTermMemoryDb.clear(req.user.id) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear memory' });
  }
});

router.post(['/memory/import', '/preferences/import'], async (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.memories)
      ? req.body.memories.slice(0, USER_PREFERENCE_MEMORY_MAX_ITEMS)
      : [];
    const existing = userPreferenceMemoryDb.getAll(req.user.id);
    const signatures = new Set(existing.map((memory) => JSON.stringify([
      sanitizeUserPreferenceMemoryContent(memory.content),
      normalizeUserPreferenceMemoryCategory(memory.category),
      normalizeUserPreferenceMemoryScope(memory.scope),
      memory.project_key || '',
    ])));
    let imported = 0;
    let skipped = 0;

    for (const candidate of incoming) {
      if (existing.length + imported >= USER_PREFERENCE_MEMORY_MAX_ITEMS) {
        skipped += 1;
        continue;
      }
      const validated = getMemoryContentOrError(candidate?.content);
      if (validated.error) {
        skipped += 1;
        continue;
      }
      const scoped = getMemoryScopePayload(candidate?.scope, null, candidate?.projectKey);
      if (scoped.error) {
        skipped += 1;
        continue;
      }
      const category = normalizeUserPreferenceMemoryCategory(candidate?.category);
      const signature = JSON.stringify([
        validated.content,
        category,
        scoped.scope,
        scoped.projectKey || '',
      ]);
      if (signatures.has(signature)) {
        skipped += 1;
        continue;
      }

      const memory = userPreferenceMemoryDb.create(
        req.user.id,
        validated.content,
        category,
        scoped.scope,
        null,
        scoped.projectKey,
      );
      if (candidate?.isEnabled === false) {
        userPreferenceMemoryDb.toggle(req.user.id, memory.id, false);
      }
      signatures.add(signature);
      imported += 1;
    }

    res.json({ success: true, imported, skipped });
  } catch (error) {
    console.error('Error importing local memories:', error);
    res.status(500).json({ error: 'Failed to import local memories' });
  }
});

router.post(['/memory', '/preferences'], async (req, res) => {
  try {
    const { content, category, scope, projectPath, projectKey } = req.body || {};
    const validated = getMemoryContentOrError(content);
    if (validated.error) {
      return res.status(400).json({ error: validated.error });
    }
    const scoped = getMemoryScopePayload(scope, projectPath, projectKey);
    if (scoped.error) {
      return res.status(400).json({ error: scoped.error });
    }

    const memory = userPreferenceMemoryDb.create(
      req.user.id,
      validated.content,
      normalizeUserPreferenceMemoryCategory(category),
      scoped.scope,
      scoped.projectPath,
      scoped.projectKey,
    );

    res.status(201).json({ memory });
  } catch (error) {
    console.error('Error creating memory:', error);
    const statusCode = error.message?.includes('Maximum of') ? 400 : 500;
    res.status(statusCode).json({ error: error.message || 'Failed to create memory' });
  }
});

router.put(['/memory/:memoryId', '/preferences/:memoryId'], async (req, res) => {
  try {
    const memoryId = parsePositiveInteger(req.params.memoryId);
    if (!memoryId) {
      return res.status(400).json({ error: 'Invalid memory ID' });
    }

    const existingMemory = userPreferenceMemoryDb.getById(req.user.id, memoryId);
    if (!existingMemory) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    const updates = {};
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'content')) {
      const validated = getMemoryContentOrError(req.body.content);
      if (validated.error) {
        return res.status(400).json({ error: validated.error });
      }
      updates.content = validated.content;
    }

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'category')) {
      updates.category = normalizeUserPreferenceMemoryCategory(req.body.category);
    }

    const hasScope = Object.prototype.hasOwnProperty.call(req.body || {}, 'scope');
    const hasProjectPath = Object.prototype.hasOwnProperty.call(req.body || {}, 'projectPath');
    const hasProjectKey = Object.prototype.hasOwnProperty.call(req.body || {}, 'projectKey');
    if (hasScope || hasProjectPath || hasProjectKey) {
      const scoped = getMemoryScopePayload(
        hasScope ? req.body.scope : existingMemory.scope,
        hasProjectPath ? req.body.projectPath : existingMemory.project_path,
        hasProjectKey ? req.body.projectKey : existingMemory.project_key,
      );
      if (scoped.error) {
        return res.status(400).json({ error: scoped.error });
      }
      if (hasScope) {
        updates.scope = scoped.scope;
      }
      if (hasProjectPath || hasProjectKey || scoped.scope === 'project') {
        updates.projectPath = scoped.projectPath;
        updates.projectKey = scoped.projectKey;
      }
      if (hasScope && scoped.scope === 'user') {
        updates.projectPath = null;
        updates.projectKey = null;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    const memory = userPreferenceMemoryDb.update(req.user.id, memoryId, updates);
    if (!memory) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    res.json({ memory });
  } catch (error) {
    console.error('Error updating memory:', error);
    res.status(500).json({ error: 'Failed to update memory' });
  }
});

router.patch(['/memory/:memoryId/toggle', '/preferences/:memoryId/toggle'], async (req, res) => {
  try {
    const memoryId = parsePositiveInteger(req.params.memoryId);
    if (!memoryId) {
      return res.status(400).json({ error: 'Invalid memory ID' });
    }

    const requestedEnabled = typeof req.body?.isEnabled === 'boolean'
      ? req.body.isEnabled
      : undefined;
    const memory = userPreferenceMemoryDb.toggle(req.user.id, memoryId, requestedEnabled);
    if (!memory) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    res.json({ memory });
  } catch (error) {
    console.error('Error toggling memory:', error);
    res.status(500).json({ error: 'Failed to toggle memory' });
  }
});

router.delete(['/memory/:memoryId', '/preferences/:memoryId'], async (req, res) => {
  try {
    const memoryId = parsePositiveInteger(req.params.memoryId);
    if (!memoryId) {
      return res.status(400).json({ error: 'Invalid memory ID' });
    }

    const deleted = userPreferenceMemoryDb.delete(req.user.id, memoryId);
    if (!deleted) {
      return res.status(404).json({ error: 'Memory not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting memory:', error);
    res.status(500).json({ error: 'Failed to delete memory' });
  }
});

// ===============================
// Model catalog proxies
// ===============================

let claudeModelsCache = { data: null, fetchedAt: 0 };
let codexModelsCache = { data: null, fetchedAt: 0 };
const MODEL_CACHE_TTL = 1000 * 60 * 5; // 5 minutes

function buildAnthropicModelsUrl(env = process.env) {
  const base = (env.ANTHROPIC_BASE_URL || env.ANTHROPIC_API_URL || 'https://api.anthropic.com')
    .trim()
    .replace(/\/+$/, '');
  return base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;
}

function resolveAnthropicAuthHeaders(env = process.env) {
  const apiKey = typeof env.ANTHROPIC_API_KEY === 'string' ? env.ANTHROPIC_API_KEY.trim() : '';
  const authToken = typeof env.ANTHROPIC_AUTH_TOKEN === 'string' ? env.ANTHROPIC_AUTH_TOKEN.trim() : '';

  if (apiKey) {
    return { 'x-api-key': apiKey };
  }
  if (authToken) {
    return { authorization: `Bearer ${authToken}` };
  }

  return null;
}

function stripAnsiOutput(value = '') {
  return String(value).replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

function extractClaudeModelIdsFromText(value = '') {
  const text = stripAnsiOutput(value);
  const matches = text.match(/\bclaude-[A-Za-z0-9][A-Za-z0-9._-]*\b/g) || [];
  return [...new Set(matches.filter((modelId) => isClaudeModelSelection(modelId)))];
}

function formatClaudeModelLabel(modelId, configuredModel = null) {
  const normalized = String(modelId || '').trim();
  const aliasLabels = new Map(CLAUDE_MODELS.OPTIONS.map((model) => [model.value, model.label]));
  if (aliasLabels.has(normalized)) {
    return aliasLabels.get(normalized);
  }

  const dateMatch = normalized.match(/-(\d{8})$/);
  const modelWithoutDate = dateMatch ? normalized.slice(0, -9) : normalized;
  const dateLabel = dateMatch
    ? ` (${dateMatch[1].slice(0, 4)}-${dateMatch[1].slice(4, 6)}-${dateMatch[1].slice(6, 8)})`
    : '';

  let label = normalized;
  const familyFirst = modelWithoutDate.match(/^claude-(opus|sonnet|haiku)-(\d+(?:[-.]\d+)*)$/i);
  const legacyFamilyLast = modelWithoutDate.match(/^claude-(\d+(?:[-.]\d+)*)-(opus|sonnet|haiku)$/i);

  if (familyFirst) {
    const [, family, version] = familyFirst;
    label = `${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${version.replace(/-/g, '.')}`;
  } else if (legacyFamilyLast) {
    const [, version, family] = legacyFamilyLast;
    label = `Claude ${version.replace(/-/g, '.')} ${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()}`;
  }

  if (normalized === configuredModel) {
    return `${label}${dateLabel} (Current Default)`;
  }
  return `${label}${dateLabel}`;
}

function parseClaudeModelSortKey(modelId) {
  const normalized = String(modelId || '').trim();
  const aliasPriority = ['sonnet', 'opus', 'haiku', 'opusplan', 'sonnet[1m]'].indexOf(normalized);
  if (aliasPriority >= 0) {
    return { aliasPriority, version: [], date: 0, familyPriority: aliasPriority, raw: normalized };
  }

  const dateMatch = normalized.match(/-(\d{8})$/);
  const modelWithoutDate = dateMatch ? normalized.slice(0, -9) : normalized;
  const familyMatch = modelWithoutDate.match(/^claude-(opus|sonnet|haiku)-(\d+(?:[-.]\d+)*)$/i)
    || modelWithoutDate.match(/^claude-(\d+(?:[-.]\d+)*)-(opus|sonnet|haiku)$/i);

  const family = familyMatch
    ? (/^(opus|sonnet|haiku)$/i.test(familyMatch[1]) ? familyMatch[1] : familyMatch[2])
    : '';
  const version = familyMatch
    ? (/^(opus|sonnet|haiku)$/i.test(familyMatch[1]) ? familyMatch[2] : familyMatch[1])
    : '';

  const familyPriority = family === 'opus' ? 0 : family === 'sonnet' ? 1 : family === 'haiku' ? 2 : 9;
  return {
    aliasPriority: 99,
    version: version.split(/[-.]/).map((part) => Number.parseInt(part, 10) || 0),
    date: dateMatch ? Number.parseInt(dateMatch[1], 10) || 0 : 0,
    familyPriority,
    raw: normalized,
  };
}

function compareClaudeModelIds(left, right) {
  const a = parseClaudeModelSortKey(left);
  const b = parseClaudeModelSortKey(right);

  if (a.aliasPriority !== 99 || b.aliasPriority !== 99) {
    return a.aliasPriority - b.aliasPriority;
  }

  const maxParts = Math.max(a.version.length, b.version.length);
  for (let index = 0; index < maxParts; index += 1) {
    const delta = (b.version[index] || 0) - (a.version[index] || 0);
    if (delta) return delta;
  }

  return (
    b.date - a.date
    || a.familyPriority - b.familyPriority
    || a.raw.localeCompare(b.raw)
  );
}

function mergeClaudeModelOptions(...modelLists) {
  const byId = new Map();
  const configuredModel = typeof process.env.ANTHROPIC_MODEL === 'string'
    ? process.env.ANTHROPIC_MODEL.trim()
    : null;

  for (const modelList of modelLists) {
    for (const model of modelList || []) {
      const value = typeof model?.value === 'string'
        ? model.value.trim()
        : typeof model?.id === 'string'
          ? model.id.trim()
          : '';
      if (!value || !isClaudeModelSelection(value)) {
        continue;
      }

      const existing = byId.get(value);
      byId.set(value, {
        value,
        label: model.label || existing?.label || formatClaudeModelLabel(value, configuredModel),
        contextLength: model.contextLength ?? existing?.contextLength ?? getClaudeModelContextWindow(value),
      });
    }
  }

  return Array.from(byId.values())
    .sort((left, right) => compareClaudeModelIds(left.value, right.value));
}

async function readClaudeCliHelpModels() {
  const resolvedCliCommand = resolveClaudeCodeExecutable({ preferBundledNative: true });

  if (!resolvedCliCommand) {
    return [];
  }

  return new Promise((resolve) => {
    let completed = false;
    let childProcess;
    let stdout = '';
    let stderr = '';

    const finish = () => {
      if (completed) return;
      completed = true;
      resolve(extractClaudeModelIdsFromText(`${stdout}\n${stderr}`).map((modelId) => ({ value: modelId })));
    };

    const timeout = setTimeout(() => {
      if (childProcess) {
        childProcess.kill();
      }
      finish();
    }, 3000);

    try {
      childProcess = spawn(resolvedCliCommand, ['--help'], {
        env: { ...process.env, CLAUDECODE: '' },
        shell: process.platform === 'win32',
        windowsHide: true,
      });
    } catch {
      clearTimeout(timeout);
      finish();
      return;
    }

    childProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    childProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    childProcess.on('close', () => {
      clearTimeout(timeout);
      finish();
    });
    childProcess.on('error', () => {
      clearTimeout(timeout);
      finish();
    });
  });
}

async function fetchAnthropicModelOptions() {
  const authHeaders = resolveAnthropicAuthHeaders();
  if (!authHeaders) {
    return [];
  }

  const response = await fetch(buildAnthropicModelsUrl(), {
    headers: {
      ...authHeaders,
      'anthropic-version': '2023-06-01',
    },
  });
  if (!response.ok) throw new Error(`Anthropic Models API returned ${response.status}`);

  const json = await response.json();
  return (json.data || [])
    .filter((model) => typeof model?.id === 'string' && isClaudeModelSelection(model.id))
    .map((model) => ({
      value: model.id,
      label: model.display_name || formatClaudeModelLabel(model.id),
      contextLength: getClaudeModelContextWindow(model.id),
    }));
}

async function resolveOpenAIApiKey(env = process.env, homeDir = os.homedir()) {
  if (env.OPENAI_API_KEY) {
    return env.OPENAI_API_KEY;
  }

  try {
    const authPath = path.join(homeDir, '.codex', 'auth.json');
    const content = await fs.readFile(authPath, 'utf8');
    const auth = JSON.parse(content);
    if (typeof auth?.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY.trim()) {
      return auth.OPENAI_API_KEY.trim();
    }
  } catch {}

  return null;
}

async function resolveCodexProviderConfig(env = process.env, homeDir = os.homedir()) {
  if (env.OPENAI_BASE_URL) {
    return {
      baseUrl: env.OPENAI_BASE_URL.trim(),
      configuredModel: typeof env.OPENAI_MODEL === 'string' ? env.OPENAI_MODEL.trim() : null,
    };
  }

  try {
    const configPath = path.join(homeDir, '.codex', 'config.toml');
    const content = await fs.readFile(configPath, 'utf8');
    const config = TOML.parse(content);
    const providerId = typeof config?.model_provider === 'string' ? config.model_provider.trim() : '';
    const providerConfig = providerId ? config?.model_providers?.[providerId] : null;
    const baseUrl = typeof providerConfig?.base_url === 'string' ? providerConfig.base_url.trim() : '';
    const configuredModel = typeof config?.model === 'string' ? config.model.trim() : null;

    if (baseUrl) {
      return { baseUrl, configuredModel };
    }

    if (configuredModel) {
      return { baseUrl: 'https://api.openai.com', configuredModel };
    }
  } catch {}

  return {
    baseUrl: 'https://api.openai.com',
    configuredModel: null,
  };
}

function buildCodexModelsUrl(baseUrl) {
  const normalized = String(baseUrl || 'https://api.openai.com')
    .trim()
    .replace(/\/+$/, '');
  return normalized.endsWith('/v1') ? `${normalized}/models` : `${normalized}/v1/models`;
}

function formatCodexModelLabel(modelId, configuredModel = null) {
  if (/^codex-auto-review$/i.test(modelId)) {
    return 'Codex Auto Review';
  }

  const normalized = String(modelId).trim();
  const match = normalized.match(/^gpt-(\d+(?:\.\d+)*)-(sol|terra|luna|codex|mini|max)$/i)
    || normalized.match(/^gpt-(\d+(?:\.\d+)*)$/i);
  if (!match) {
    return normalized;
  }

  const [, version, variant = ''] = match;
  const variantLabel = variant ? ` ${variant.charAt(0).toUpperCase()}${variant.slice(1)}` : '';
  const baseLabel = `GPT-${version}${variantLabel}`;
  return normalized === configuredModel
    ? `${baseLabel} (Current Default)`
    : baseLabel;
}

function parseCodexModelSortKey(modelId) {
  const normalized = String(modelId).trim();
  const match = normalized.match(/^gpt-(\d+)(?:\.(\d+))?(?:-(sol|terra|luna|codex|mini|max))?$/i);
  if (!match) {
    return { major: -1, minor: -1, tierPriority: 99, raw: normalized };
  }

  const [, major, minor = '0', tier = ''] = match;
  const tierPriority = tier === 'sol'
    ? 0
    : tier === 'terra'
      ? 1
      : tier === 'luna'
        ? 2
        : tier === ''
          ? 3
          : tier === 'codex'
            ? 4
            : tier === 'mini'
              ? 5
              : tier === 'max'
                ? 6
                : 9;

  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    tierPriority,
    raw: normalized,
  };
}

function compareCodexModelIds(left, right) {
  const a = parseCodexModelSortKey(left);
  const b = parseCodexModelSortKey(right);

  return (
    b.major - a.major
    || b.minor - a.minor
    || a.tierPriority - b.tierPriority
    || a.raw.localeCompare(b.raw)
  );
}

function mergeCodexModelOptions(...modelLists) {
  const byId = new Map();

  for (const modelList of modelLists) {
    for (const model of modelList || []) {
      const value = typeof model?.value === 'string'
        ? model.value.trim()
        : typeof model?.id === 'string'
          ? model.id.trim()
          : '';
      if (!value) {
        continue;
      }

      const existing = byId.get(value);
      byId.set(value, {
        value,
        label: model.label || existing?.label || formatCodexModelLabel(value),
        contextLength: model.contextLength ?? existing?.contextLength ?? getCodexModelContextWindow(value),
      });
    }
  }

  return Array.from(byId.values())
    .sort((left, right) => compareCodexModelIds(left.value, right.value));
}

router.get('/claude-models', async (_req, res) => {
  try {
    const now = Date.now();
    if (claudeModelsCache.data && now - claudeModelsCache.fetchedAt < MODEL_CACHE_TTL) {
      return res.json(claudeModelsCache.data);
    }

    const [apiModels, cliModels] = await Promise.all([
      fetchAnthropicModelOptions().catch((error) => {
        console.warn('Failed to fetch Anthropic models:', error.message);
        return [];
      }),
      readClaudeCliHelpModels().catch((error) => {
        console.warn('Failed to read Claude CLI model help:', error.message);
        return [];
      }),
    ]);

    const models = mergeClaudeModelOptions(CLAUDE_MODELS.OPTIONS, apiModels, cliModels);
    claudeModelsCache = { data: { models }, fetchedAt: now };

    return res.json({
      models,
      ...(apiModels.length || cliModels.length
        ? {}
        : { warning: 'Claude dynamic model sources unavailable; using bundled Claude model options.' }),
    });
  } catch (error) {
    console.error('Error fetching Claude models:', error);
    if (claudeModelsCache.data) {
      return res.json(claudeModelsCache.data);
    }
    return res.json({
      models: mergeClaudeModelOptions(CLAUDE_MODELS.OPTIONS),
      warning: 'Failed to fetch Claude models; using bundled Claude model options.',
    });
  }
});

router.get('/codex-models', async (_req, res) => {
  try {
    const now = Date.now();
    if (codexModelsCache.data && now - codexModelsCache.fetchedAt < MODEL_CACHE_TTL) {
      return res.json(codexModelsCache.data);
    }

    const apiKey = await resolveOpenAIApiKey();
    if (!apiKey) {
      const models = mergeCodexModelOptions(CODEX_MODELS.OPTIONS);
      codexModelsCache = { data: { models }, fetchedAt: now };
      return res.json({
        models,
        warning: 'OpenAI API key not available; using bundled Codex model options.',
      });
    }

    const { baseUrl, configuredModel } = await resolveCodexProviderConfig();
    const response = await fetch(buildCodexModelsUrl(baseUrl), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    if (!response.ok) throw new Error(`OpenAI Models API returned ${response.status}`);

    const json = await response.json();
    const apiModels = (json.data || [])
      .filter((model) => typeof model?.id === 'string' && model.id.trim())
      .filter((model) => !/^codex-auto-/i.test(model.id))
      .filter((model) => isCodexExecutableModel(model.id))
      .map((model) => ({
        value: model.id,
        label: formatCodexModelLabel(model.id, configuredModel),
        contextLength: getCodexModelContextWindow(model.id),
      }));
    const models = mergeCodexModelOptions(CODEX_MODELS.OPTIONS, apiModels);

    codexModelsCache = { data: { models }, fetchedAt: now };
    return res.json({ models });
  } catch (error) {
    console.error('Error fetching Codex models:', error);
    if (codexModelsCache.data) {
      return res.json(codexModelsCache.data);
    }
    return res.json({
      models: mergeCodexModelOptions(CODEX_MODELS.OPTIONS),
      warning: 'Failed to fetch Codex models; using bundled Codex model options.',
    });
  }
});

// ===============================
// Runtime Reset (in-memory state)
// ===============================
//
// This is a "panic button" for stuck sessions (e.g. provider hangs, websocket reconnect loops).
// It does NOT delete session history on disk; it only aborts in-memory active sessions and clears caches.
router.post('/runtime-reset', async (_req, res) => {
  try {
    const active = {
      codex: getActiveCodexSessions(),
    };

    const results = {
      aborted: {
        codex: [],
      },
      counts: {
        codex: active.codex.length,
      },
      cacheCleared: {
        claudeModels: false,
        codexModels: false,
      },
    };

    for (const sessionId of active.codex) {
      const ok = abortCodexSession(sessionId);
      results.aborted.codex.push({ sessionId, ok: Boolean(ok) });
    }
    // Clear lightweight caches (doesn't affect sessions)
    claudeModelsCache = { data: null, fetchedAt: 0 };
    codexModelsCache = { data: null, fetchedAt: 0 };
    results.cacheCleared.claudeModels = true;
    results.cacheCleared.codexModels = true;

    res.json({ success: true, results });
  } catch (error) {
    console.error('Error during runtime reset:', error);
    res.status(500).json({ error: 'Failed to reset runtime', details: error.message });
  }
});

export default router;
