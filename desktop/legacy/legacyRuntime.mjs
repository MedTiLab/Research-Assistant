import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_START_TIMEOUT_MS = 30_000;
const DEFAULT_STOP_TIMEOUT_MS = 8_000;
const PROCESS_POLL_INTERVAL_MS = 350;

const PASSTHROUGH_ENV_KEYS = Object.freeze([
  'ALLOWED_ORIGINS',
  'APPDATA',
  'API_KEY',
  'COMSPEC',
  'CONTEXT_WINDOW',
  'DATABASE_PATH',
  'DR_CLAW_DATA_DIR',
  'DR_CLAW_RUNTIME_DIR',
  'HOME',
  'HOST',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOCAL_GPU_SERVER_URL',
  'LOCALAPPDATA',
  'NCBI_API_KEY',
  'NODE_ENV',
  'NODE_EXTRA_CA_CERTS',
  'NO_PROXY',
  'OLLAMA_BASE_URL',
  'PATH',
  'PATHEXT',
  'PORT',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'PUBLIC',
  'REQUIRE_LOCAL_KERNEL',
  'SHELL',
  'SSL_CERT_FILE',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'TOOL_APPROVAL_TIMEOUT_MS',
  'TZ',
  'USER',
  'USERPROFILE',
  'VIRTUAL_ENV',
  'WINDIR',
  'WORKSPACES_ROOT',
  'npm_execpath',
  'npm_package_version',
]);

const PASSTHROUGH_ENV_PREFIXES = Object.freeze([
  'ADMIN_',
  'ANTHROPIC_',
  'APP_',
  'ASDF_',
  'AUTO_RESEARCH_',
  'AWS_',
  'AZURE_',
  'CARGO_',
  'CLAUDE_',
  'CODEX_',
  'CONDA_',
  'CORS_',
  'DATABASE_',
  'DOWNLOAD_',
  'DR_CLAW_',
  'EDGECLAW_',
  'GATEWAY_',
  'GEMINI_',
  'GOOGLE_',
  'HOMEBREW_',
  'JWT_',
  'MAMBA_',
  'MEDHELP_',
  'NPM_',
  'NVM_',
  'OPENAI_',
  'PIP_',
  'PIPX_',
  'PNPM_',
  'POETRY_',
  'PUBMED_',
  'PUBLIC_',
  'PYENV_',
  'REGISTRATION_EMAIL_',
  'RUSTUP_',
  'TENCENT_',
  'UV_',
  'VITE_',
  'WORKSPACE_',
  'XDG_',
]);

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid, kill = process.kill) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) {
    return false;
  }
  try {
    kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function removeFileIfPresent(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // The following child start will provide the actionable filesystem error.
  }
}

export function resolveLegacyRuntimeMode(env = process.env) {
  return String(env.MEDHELP_DESKTOP_RUNTIME_MODE || 'supervised').trim().toLowerCase() === 'embedded'
    ? 'embedded'
    : 'supervised';
}

export function buildLegacyRuntimeEnv(baseEnv = process.env, overrides = {}) {
  const env = {};
  for (const key of PASSTHROUGH_ENV_KEYS) {
    if (baseEnv[key] != null) {
      env[key] = String(baseEnv[key]);
    }
  }
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value != null && PASSTHROUGH_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      env[key] = String(value);
    }
  }

  return {
    ...env,
    ...overrides,
    ELECTRON_RUN_AS_NODE: '1',
    MEDHELP_DESKTOP: '1',
  };
}

export async function probeLegacyRuntime(runtime, { fetchImpl = globalThis.fetch } = {}) {
  const baseUrl = typeof runtime === 'string' ? runtime : runtime?.baseUrl;
  try {
    const response = await fetchImpl(`${baseUrl}/health`, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) {
      return { healthy: false, message: `Runtime health endpoint returned ${response.status}.` };
    }
    const payload = await response.json().catch(() => ({}));
    if (payload?.status !== 'ok') {
      return { healthy: false, message: 'Runtime health payload was not ready.' };
    }
    const recovery = payload?.database?.recoveredFromCorruption === true;
    return {
      healthy: true,
      health: payload,
      agentBusy: payload?.agentBusy === true,
      ...(recovery ? {
        degradedReason: 'database_recovered',
        degradedMessage: '数据库在上次异常退出后未通过完整性检查；损坏副本已安全保留，当前使用恢复后的新数据库。',
      } : {}),
    };
  } catch (error) {
    return { healthy: false, message: error instanceof Error ? error.message : String(error) };
  }
}

async function probeHealth(baseUrl, fetchImpl = globalThis.fetch) {
  return (await probeLegacyRuntime(baseUrl, { fetchImpl })).healthy;
}

export async function discoverLegacyRuntime({
  runtimeFile,
  fetchImpl = globalThis.fetch,
  kill = process.kill,
} = {}) {
  const entry = readJson(runtimeFile)?.backend;
  const port = Number(entry?.port);
  const pid = Number(entry?.pid);
  if (!Number.isInteger(port) || port <= 0 || !Number.isInteger(pid) || pid <= 0) {
    return null;
  }

  if (!isPidAlive(pid, kill)) {
    removeFileIfPresent(runtimeFile);
    return null;
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  if (await probeHealth(baseUrl, fetchImpl)) {
    return {
      pid,
      baseUrl,
      reused: true,
      child: null,
    };
  }

  const error = new Error(`A stale Runtime process (${pid}) owns ${runtimeFile} but is not healthy.`);
  error.code = 'RUNTIME_STALE';
  throw error;
}

function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), timeoutMs);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

async function waitForPidExit(pid, timeoutMs, kill = process.kill) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid, kill)) {
      return true;
    }
    await wait(PROCESS_POLL_INTERVAL_MS);
  }
  return !isPidAlive(pid, kill);
}

async function terminateProcessTree({ child, pid, stopTimeoutMs, spawnImpl, kill = process.kill }) {
  if (child && child.exitCode !== null) {
    return;
  }

  if (child && process.platform !== 'win32') {
    child.kill('SIGTERM');
  } else if (child?.connected) {
    try {
      child.send({ type: 'medhelp-runtime-shutdown' });
    } catch {
      child.kill?.('SIGTERM');
    }
  } else if (Number.isInteger(Number(pid)) && Number(pid) > 0 && process.platform !== 'win32') {
    try {
      kill(Number(pid), 'SIGTERM');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }

  if (
    (child && await waitForChildExit(child, stopTimeoutMs))
    || (!child && await waitForPidExit(Number(pid), stopTimeoutMs, kill))
  ) {
    return;
  }

  const targetPid = Number(child?.pid || pid);
  if (!Number.isInteger(targetPid) || targetPid <= 0) {
    return;
  }
  if (process.platform === 'win32') {
    const taskkill = spawnImpl('taskkill.exe', ['/PID', String(targetPid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    await waitForChildExit(taskkill, 5_000);
    return;
  }

  try {
    kill(targetPid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

export function createSupervisedLegacyRuntime({
  projectRoot,
  runtimeFile,
  logPath,
  kernelEntry = path.join(projectRoot, 'desktop', 'legacy', 'kernel-entry.mjs'),
  execPath = process.execPath,
  baseEnv = process.env,
  spawnImpl = spawn,
  fetchImpl = globalThis.fetch,
  kill = process.kill,
  startTimeoutMs = DEFAULT_START_TIMEOUT_MS,
  stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
} = {}) {
  if (!projectRoot || !runtimeFile || !logPath) {
    throw new TypeError('Supervised Legacy Runtime requires projectRoot, runtimeFile, and logPath');
  }

  return {
    async start({ onExit } = {}) {
      if (!fs.existsSync(kernelEntry)) {
        const error = new Error(`Runtime entry is missing: ${kernelEntry}`);
        error.code = 'RUNTIME_MISSING';
        throw error;
      }

      const existing = await discoverLegacyRuntime({ runtimeFile, fetchImpl, kill });
      if (existing) {
        return existing;
      }

      fs.mkdirSync(path.dirname(runtimeFile), { recursive: true });
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      removeFileIfPresent(runtimeFile);
      const logFd = fs.openSync(logPath, 'a');
      let child;
      try {
        child = spawnImpl(execPath, [kernelEntry], {
          cwd: projectRoot,
          windowsHide: true,
          stdio: ['ignore', logFd, logFd, 'ipc'],
          env: buildLegacyRuntimeEnv(baseEnv, {
            HOST: '127.0.0.1',
            MEDHELP_RUNTIME_FILE: runtimeFile,
          }),
        });
      } finally {
        fs.closeSync(logFd);
      }

      let ready = false;
      let settled = false;
      const startedAt = new Date().toISOString();
      const runtime = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const error = new Error(`Runtime did not become ready within ${Math.round(startTimeoutMs / 1_000)} seconds. See ${logPath}.`);
          error.code = 'RUNTIME_START_TIMEOUT';
          reject(error);
        }, startTimeoutMs);

        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          callback(value);
        };

        child.once('error', (error) => finish(reject, error));
        child.once('exit', (code, signal) => {
          if (!ready) {
            const error = new Error(`Runtime exited before readiness (${signal ?? code ?? 'unknown'}). See ${logPath}.`);
            error.code = 'RUNTIME_EARLY_EXIT';
            finish(reject, error);
            return;
          }
          onExit?.({ code, signal });
        });
        child.on('message', async (message) => {
          if (settled || message?.type !== 'medhelp-runtime-ready') return;
          const baseUrl = String(message.baseUrl || '');
          if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseUrl) || !await probeHealth(baseUrl, fetchImpl)) {
            return;
          }
          ready = true;
          finish(resolve, {
            pid: child.pid,
            baseUrl,
            startedAt,
            child,
            reused: false,
          });
        });
      }).catch(async (error) => {
        await terminateProcessTree({ child, pid: child?.pid, stopTimeoutMs: 500, spawnImpl, kill });
        removeFileIfPresent(runtimeFile);
        throw error;
      });

      return runtime;
    },

    async stop(runtime) {
      if (runtime) {
        await terminateProcessTree({
          child: runtime.child,
          pid: runtime.pid,
          stopTimeoutMs,
          spawnImpl,
          kill,
        });
        removeFileIfPresent(runtimeFile);
        return;
      }

      const recordedPid = Number(readJson(runtimeFile)?.backend?.pid);
      if (isPidAlive(recordedPid, kill)) {
        await terminateProcessTree({
          child: null,
          pid: recordedPid,
          stopTimeoutMs,
          spawnImpl,
          kill,
        });
      }
      removeFileIfPresent(runtimeFile);
    },
  };
}

export const LEGACY_RUNTIME_TEST_CONSTANTS = Object.freeze({
  PROCESS_POLL_INTERVAL_MS,
  PASSTHROUGH_ENV_KEYS,
  PASSTHROUGH_ENV_PREFIXES,
});
