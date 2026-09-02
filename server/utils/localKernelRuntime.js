import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { listenOnAvailablePort, parsePortNumber } from './runtimePorts.js';

const DEFAULT_LOCAL_KERNEL_PORT = 5055;
const FALLBACK_PORT_ATTEMPTS = 101;
const BROWSER_BLOCKED_LOCAL_KERNEL_PORTS = new Set([5060, 5061]);
const DEFAULT_ALLOWED_ORIGINS = [
  'https://app.medtimehelp.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
];

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function normalizeHost(hostname) {
  return String(hostname || '').trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
}

export function isLocalKernelMode() {
  return isTruthyEnv(process.env.MEDHELP_LOCAL_KERNEL);
}

export function isLoopbackHost(hostname) {
  const normalized = normalizeHost(hostname);
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

export function resolveLocalKernelHost() {
  const host = normalizeHost(process.env.MEDHELP_LOCAL_HOST || '127.0.0.1');
  if (!isLoopbackHost(host)) {
    throw new Error(`MEDHELP_LOCAL_HOST must be loopback-only, got "${host}"`);
  }
  return host;
}

export function resolveLocalKernelPortPreference() {
  const rawPort = String(process.env.MEDHELP_LOCAL_PORT ?? '').trim();
  if (rawPort === '0') {
    return { dynamic: true, preferredPort: 0 };
  }

  return {
    dynamic: false,
    preferredPort: parsePortNumber(rawPort, DEFAULT_LOCAL_KERNEL_PORT),
  };
}

export function isBrowserBlockedLocalKernelPort(port) {
  const normalizedPort = Number(port);
  return Number.isInteger(normalizedPort) && BROWSER_BLOCKED_LOCAL_KERNEL_PORTS.has(normalizedPort);
}

async function listenOnce(server, port, host) {
  await new Promise((resolve, reject) => {
    const handleError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      server.off('error', handleError);
    };

    server.once('error', handleError);
    server.listen(port, host, () => {
      cleanup();
      resolve();
    });
  });

  const address = server.address();
  if (address && typeof address === 'object' && address.port) {
    return address.port;
  }
  return port;
}

async function listenOnAllowedLocalKernelPort(server, { startPort, host, maxAttempts }) {
  let lastError = null;

  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = startPort + offset;
    if (isBrowserBlockedLocalKernelPort(port)) {
      continue;
    }

    try {
      return await listenOnAvailablePort(server, {
        startPort: port,
        host,
        maxAttempts: 1,
      });
    } catch (error) {
      if (error.code !== 'EADDRINUSE') {
        throw error;
      }
      lastError = error;
    }
  }

  const endPort = startPort + maxAttempts - 1;
  const error = new Error(`No browser-accessible Local Engine port was found between ${startPort} and ${endPort}.`);
  error.code = 'EADDRINUSE';
  error.cause = lastError;
  throw error;
}

export async function listenOnLocalKernelPort(server, { host = resolveLocalKernelHost() } = {}) {
  const preference = resolveLocalKernelPortPreference();
  if (preference.dynamic) {
    return listenOnce(server, 0, host);
  }

  return listenOnAllowedLocalKernelPort(server, {
    startPort: preference.preferredPort,
    host,
    maxAttempts: FALLBACK_PORT_ATTEMPTS,
  });
}

function defaultRuntimeDir() {
  if (process.env.MEDHELP_RUNTIME_DIR) {
    return process.env.MEDHELP_RUNTIME_DIR;
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'MedHelp', 'runtime');
  }

  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || os.homedir(), 'MedHelp', 'runtime');
  }

  return path.join(os.homedir(), '.local', 'share', 'MedHelp', 'runtime');
}

export function resolveLocalKernelRuntimeFile() {
  return process.env.MEDHELP_LOCAL_KERNEL_RUNTIME_FILE
    || path.join(defaultRuntimeDir(), 'local-kernel.json');
}

export async function writeLocalKernelRuntimeFile(payload) {
  const runtimeFile = resolveLocalKernelRuntimeFile();
  await fs.mkdir(path.dirname(runtimeFile), { recursive: true });
  await fs.writeFile(runtimeFile, `${JSON.stringify({
    product: 'MedHelp Kernel',
    pid: process.pid,
    updatedAt: new Date().toISOString(),
    ...payload,
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return runtimeFile;
}

export async function removeLocalKernelRuntimeFile(expectedPid = process.pid) {
  const runtimeFile = resolveLocalKernelRuntimeFile();
  try {
    const runtime = JSON.parse(await fs.readFile(runtimeFile, 'utf8'));
    if (Number(runtime?.pid) !== Number(expectedPid)) {
      return false;
    }
    await fs.rm(runtimeFile, { force: true });
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export function getLocalKernelAllowedOrigins() {
  const configured = String(process.env.MEDHELP_ALLOWED_WEB_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return Array.from(new Set([...DEFAULT_ALLOWED_ORIGINS, ...configured]));
}

function normalizeOrigin(origin) {
  if (!origin || origin === 'null') {
    return null;
  }
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

export function isAllowedLocalKernelOrigin(origin) {
  if (!origin) {
    return true;
  }

  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return false;
  }

  const allowed = getLocalKernelAllowedOrigins()
    .map(normalizeOrigin)
    .filter(Boolean);

  if (allowed.includes(normalized)) {
    return true;
  }

  try {
    return isLoopbackHost(new URL(normalized).hostname);
  } catch {
    return false;
  }
}
