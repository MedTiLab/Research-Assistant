import fs from 'node:fs';

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function removeRuntimeFile(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // The caller will surface the next actionable start error.
  }
}

export function isProcessAlive(pid, kill = process.kill) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    kill(numericPid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

export function isLoopbackRuntimeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const hostname = url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
    return url.protocol === 'http:'
      && (hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname));
  } catch {
    return false;
  }
}

export async function probeBundledKernel(runtime, {
  fetchImpl = globalThis.fetch,
  expectedVersion = null,
  expectedInstanceId = null,
  timeoutMs = 1_500,
} = {}) {
  if (!runtime || !isLoopbackRuntimeUrl(runtime.httpUrl)) {
    return { healthy: false, message: 'Runtime endpoint is missing or is not loopback-only.' };
  }

  try {
    const response = await fetchImpl(`${runtime.httpUrl}/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const health = await response.json().catch(() => ({}));
    if (!response.ok || !['ok', undefined].includes(health?.status) || health?.ok === false) {
      return { healthy: false, message: `Runtime health endpoint returned ${response.status}.` };
    }
    if (expectedVersion && health?.version !== expectedVersion) {
      return {
        healthy: false,
        message: `Runtime version mismatch (${health?.version || 'unknown'} / ${expectedVersion}).`,
      };
    }
    if (expectedInstanceId && health?.instanceId !== expectedInstanceId) {
      return { healthy: false, message: 'Runtime instance identity did not match the launched process.' };
    }

    const recovery = health?.database?.recoveredFromCorruption === true;
    return {
      healthy: true,
      health,
      agentBusy: health?.agentBusy === true,
      ...(recovery ? {
        degradedReason: 'database_recovered',
        degradedMessage: '数据库在上次异常退出后未通过完整性检查；损坏副本已安全保留，当前使用恢复后的新数据库。',
      } : {}),
    };
  } catch (error) {
    return {
      healthy: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function discoverBundledKernel({
  runtimeFile,
  expectedVersion,
  fetchImpl = globalThis.fetch,
  kill = process.kill,
} = {}) {
  const runtime = readJson(runtimeFile);
  if (!runtime) return null;

  if (!isProcessAlive(runtime.pid, kill)) {
    removeRuntimeFile(runtimeFile);
    return null;
  }

  const probe = await probeBundledKernel(runtime, { fetchImpl, expectedVersion });
  if (probe.healthy) {
    return {
      ...runtime,
      pid: Number(runtime.pid),
      reused: true,
      child: null,
      ...probe,
    };
  }

  const error = new Error(`A recorded Runtime process (${runtime.pid}) is alive but unhealthy: ${probe.message}`);
  error.code = 'RUNTIME_STALE';
  error.runtime = runtime;
  throw error;
}

export const KERNEL_LIFECYCLE_TEST_CONSTANTS = Object.freeze({
  removeRuntimeFile,
});
