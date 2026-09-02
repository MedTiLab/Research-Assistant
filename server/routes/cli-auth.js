import express from 'express';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { resolveCodexCliExecutable } from '../utils/codexCliExecutable.js';
import { resolveClaudeCodeExecutableInfo } from '../utils/claudeCodeExecutable.js';
import { createAsyncStatusCache } from '../utils/asyncStatusCache.js';
import { readClaudeCustomApiConfig } from '../utils/claudeSettings.js';
import { piRuntime } from '../agent-runtime/pi-runtime.js';

const router = express.Router();

function buildCliInstallHint(agent) {
  switch (agent) {
    case 'claude':
      return 'Claude Code CLI is not installed. Install it first, then retry login.';
    case 'codex':
      return 'Codex CLI is not installed. Install it first, then retry login.';
    default:
      return 'Required CLI is not installed. Install it first, then retry login.';
  }
}

function buildStatusPayload(result, agent) {
  const {
    authenticated,
    email,
    error,
    cliAvailable,
    cliCommand,
    installHint,
    ...extra
  } = result || {};

  return {
    authenticated: Boolean(authenticated),
    email: email || null,
    error: error || null,
    cliAvailable: cliAvailable !== false,
    cliCommand: cliCommand || null,
    installHint: installHint || (cliAvailable === false ? buildCliInstallHint(agent) : null),
    ...extra,
  };
}

export async function getCliAuthStatus(agent, options = {}) {
  switch (agent) {
    case 'pi':
      return getPiRuntimeStatusPayload(options);
    default:
      return {
        authenticated: false,
        email: null,
        error: `Unsupported CLI provider: ${agent}`,
        cliAvailable: false,
        cliCommand: null,
      };
  }
}

function stripAnsiOutput(value = '') {
  return String(value).replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

export function resolveClaudeStatusExecutable({
  env = process.env,
  resolve = resolveClaudeCodeExecutableInfo,
} = {}) {
  return resolve({
    // A packaged Agent SDK must not be shadowed by a stale local CLI override.
    // Keep the rest of the process environment for HOME/keychain discovery.
    env: { ...env, CLAUDE_CLI_PATH: '' },
    preferBundledNative: true,
  });
}

async function getClaudeAuthStatusPayload() {
  // Read settings.json first. Besides being authoritative for a custom Claude
  // endpoint, this avoids waiting for an OAuth status subprocess when the user
  // has intentionally configured API authentication instead.
  const customApi = await readClaudeCustomApiConfig();
  if (customApi.configured) {
    const resolvedCli = resolveClaudeStatusExecutable();
    return buildStatusPayload({
      authenticated: true,
      email: 'Custom API Connected',
      method: 'custom_api',
      customApiSource: customApi.source,
      customApiBaseUrl: customApi.baseUrl,
      cliAvailable: Boolean(resolvedCli.executable),
      cliCommand: resolvedCli.executable,
    }, 'claude');
  }

  const credentialsResult = await checkClaudeCredentials();
  if (credentialsResult.authenticated) {
    return buildStatusPayload({
      ...credentialsResult,
      email: credentialsResult.email || 'Authenticated',
      method: 'cli',
    }, 'claude');
  }
  return buildStatusPayload({
    authenticated: false,
    email: null,
    error: credentialsResult.error || 'Not authenticated',
    cliAvailable: credentialsResult.cliAvailable,
    cliCommand: credentialsResult.cliCommand,
    installHint: credentialsResult.installHint,
  }, 'claude');
}

async function getPiRuntimeStatusPayload(options = {}) {
  const diagnostics = await piRuntime.native.diagnostics({ userId: options.userId });
  const provider = diagnostics.providerConfig || {};
  const runtimeIssue = diagnostics.issues?.[0]?.message || null;
  return buildStatusPayload({
    authenticated: Boolean(diagnostics.configured),
    email: diagnostics.configured
      ? `${provider.providerName || provider.providerRef || provider.providerId}/${provider.modelName || String(provider.modelId || '').split('/').pop()}`
      : null,
    error: diagnostics.configured
      ? null
      : (provider.error || runtimeIssue || (diagnostics.available ? 'Pi provider is not configured.' : 'Pi Host is not prepared.')),
    cliAvailable: Boolean(diagnostics.available),
    cliCommand: diagnostics.hostPath || null,
    installHint: diagnostics.available
      ? null
      : `${runtimeIssue ? `${runtimeIssue} ` : ''}Run "npm run pi-runtime:prepare" to prepare the isolated Pi Host.`,
    configurationHint: diagnostics.available && !diagnostics.configured
      ? (provider.error || 'Configure a Pi model provider to start using the runtime.')
      : null,
    runtimePrepared: Boolean(diagnostics.available),
    configured: Boolean(diagnostics.configured),
    runtimeId: 'pi',
    modelProviderId: provider.providerId || null,
    modelId: provider.modelId || null,
    modelApi: provider.modelApi || null,
    models: provider.models,
    catalogRevision: provider.catalogRevision ?? null,
    catalogHealth: provider.health || null,
    retryAt: provider.retryAt || null,
    privacyNotice: provider.privacyNotice || null,
    priceNotice: provider.priceNotice || null,
    toolPolicy: diagnostics.toolPolicy || null,
    protocolVersion: diagnostics.protocolVersion,
    sdkVersion: diagnostics.sdkVersion,
    runtimeHealth: diagnostics.health || null,
    runtimeStatus: diagnostics.status || null,
    runtimeVerified: Boolean(diagnostics.verified),
    upgradeRequired: Boolean(diagnostics.upgradeRequired),
    runtimeIssues: diagnostics.issues || [],
    prepareCommand: diagnostics.prepareCommand || null,
    resources: diagnostics.resources || null,
  }, 'pi');
}

router.get('/pi/status', async (req, res) => {
  try {
    res.json(await getPiRuntimeStatusPayload({ userId: req.user?.id }));
  } catch (error) {
    console.error('Error checking Pi runtime status:', error);
    res.status(500).json({
      authenticated: false,
      configured: false,
      cliAvailable: false,
      email: null,
      error: error.message,
    });
  }
});

async function checkClaudeCredentialsUncached() {
  // Desktop ships the Claude Agent SDK native runtime. Account status should
  // not become "CLI missing" merely because the login-shell PATH was not
  // imported; use PATH only as an unbundled development fallback.
  const resolvedCli = resolveClaudeStatusExecutable();
  const resolvedCliCommand = resolvedCli.executable;

  if (!resolvedCliCommand) {
    return checkClaudeCredentialsFile({ cliAvailable: false });
  }

  return new Promise((resolve) => {
    let processCompleted = false;

    const timeout = setTimeout(() => {
      if (!processCompleted) {
        processCompleted = true;
        if (childProcess) {
          childProcess.kill();
        }
        // Fall back to credentials file check on timeout
        checkClaudeCredentialsFile({ cliAvailable: true, cliCommand: resolvedCliCommand }).then(resolve);
      }
    }, 5000);

    let childProcess;
    try {
      childProcess = spawn(resolvedCliCommand, ['auth', 'status', '--json'], {
        env: { ...process.env, CLAUDECODE: '' },
        shell: process.platform === 'win32',
        windowsHide: true,
      });
    } catch {
      clearTimeout(timeout);
      checkClaudeCredentialsFile({ cliAvailable: false }).then(resolve);
      return;
    }

    let stdout = '';
    let stderr = '';

    childProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    childProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    childProcess.on('close', (code) => {
      if (processCompleted) return;
      processCompleted = true;
      clearTimeout(timeout);

      if (code === 0 && stdout.trim()) {
        try {
          const status = JSON.parse(stdout.trim());
          if (status.loggedIn) {
            resolve({
              authenticated: true,
              email: status.email || null,
              cliAvailable: true,
              cliCommand: resolvedCliCommand
            });
            return;
          }
        } catch {
          // JSON parse failed, fall through
        }
      }

      // CLI check failed, fall back to credentials file
      checkClaudeCredentialsFile({ cliAvailable: true, cliCommand: resolvedCliCommand }).then(resolve);
    });

    childProcess.on('error', () => {
      if (processCompleted) return;
      processCompleted = true;
      clearTimeout(timeout);
      // Command was already resolved by resolveClaudeCodeExecutableInfo, so treat
      // any spawn error as a transient failure rather than "CLI missing".
      checkClaudeCredentialsFile({ cliAvailable: true, cliCommand: resolvedCliCommand }).then(resolve);
    });
  });
}

// Several screens request agent status together. Share the authoritative
// bundled-runtime probe briefly so they do not each launch Claude, while still
// reflecting a newly completed login within a few seconds.
const claudeCredentialStatusCache = createAsyncStatusCache(
  checkClaudeCredentialsUncached,
  { ttlMs: 5_000 },
);

async function checkClaudeCredentials() {
  return claudeCredentialStatusCache.get();
}

async function checkClaudeCredentialsFile({ cliAvailable = true, cliCommand = 'claude' } = {}) {
  try {
    const credPath = path.join(os.homedir(), '.claude', '.credentials.json');
    const content = await fs.readFile(credPath, 'utf8');
    const creds = JSON.parse(content);

    const oauth = creds.claudeAiOauth;
    if (oauth && oauth.accessToken) {
      const isExpired = oauth.expiresAt && Date.now() >= oauth.expiresAt;

      if (!isExpired) {
        return {
          authenticated: true,
          email: creds.email || creds.user || null,
          cliAvailable,
          cliCommand
        };
      }
    }

    return {
      authenticated: false,
      email: null,
      cliAvailable,
      cliCommand,
      error: cliAvailable ? null : 'Claude Code CLI not installed',
      installHint: cliAvailable ? null : buildCliInstallHint('claude')
    };
  } catch (error) {
    return {
      authenticated: false,
      email: null,
      cliAvailable,
      cliCommand,
      error: cliAvailable ? null : 'Claude Code CLI not installed',
      installHint: cliAvailable ? null : buildCliInstallHint('claude')
    };
  }
}

async function checkCodexCredentials() {
  let cliCommand = process.env.CODEX_CLI_PATH || 'codex';
  try {
    if (process.env.OPENAI_API_KEY) {
      return {
        authenticated: true,
        email: 'API Key Auth',
        cliAvailable: true,
        cliCommand
      };
    }

    const resolvedCliCommand = await resolveCodexCliExecutable();
    cliCommand = resolvedCliCommand || cliCommand;

    if (!resolvedCliCommand) {
      return {
        authenticated: false,
        email: null,
        error: 'Codex CLI not installed',
        cliAvailable: false,
        cliCommand,
        installHint: buildCliInstallHint('codex')
      };
    }

    const authPath = path.join(os.homedir(), '.codex', 'auth.json');
    const content = await fs.readFile(authPath, 'utf8');
    const auth = JSON.parse(content);

    // Tokens are nested under 'tokens' key
    const tokens = auth.tokens || {};

    // Check for valid tokens (id_token or access_token)
    if (tokens.id_token || tokens.access_token) {
      // Try to extract email from id_token JWT payload
      let email = 'Authenticated';
      if (tokens.id_token) {
        try {
          // JWT is base64url encoded: header.payload.signature
          const parts = tokens.id_token.split('.');
          if (parts.length >= 2) {
            // Decode the payload (second part)
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
            email = payload.email || payload.user || 'Authenticated';
          }
        } catch {
          // If JWT decoding fails, use fallback
          email = 'Authenticated';
        }
      }

      return {
        authenticated: true,
        email,
        cliAvailable: true,
        cliCommand
      };
    }

    // Also check for OPENAI_API_KEY as fallback auth method
    if (auth.OPENAI_API_KEY) {
      return {
        authenticated: true,
        email: 'API Key Auth',
        cliAvailable: true,
        cliCommand
      };
    }

    return {
      authenticated: false,
      email: null,
      error: 'No valid tokens found',
      cliAvailable: true,
      cliCommand
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        authenticated: false,
        email: null,
        error: 'Codex not configured',
        cliAvailable: true,
        cliCommand
      };
    }
    return {
      authenticated: false,
      email: null,
      error: error.message,
      cliAvailable: true,
      cliCommand
    };
  }
}

router.get('/local/gpu-info', async (req, res) => {
  res.status(410).json({ error: 'Local GPU provider has been removed from this deployment' });
});

router.get('/local/status', async (req, res) => {
  res.status(410).json({
    authenticated: false,
    email: null,
    error: 'Local GPU provider has been removed from this deployment',
    cliAvailable: false,
    cliCommand: null,
  });
});

router.get('/local/models', async (req, res) => {
  res.status(410).json({ error: 'Local GPU provider has been removed from this deployment', models: [] });
});

router.post('/local/pull-model', async (req, res) => {
  res.status(410).json({ error: 'Local GPU provider has been removed from this deployment' });
});

router.post('/local/save-config', async (req, res) => {
  res.status(410).json({ error: 'Local GPU provider has been removed from this deployment' });
});

export default router;
