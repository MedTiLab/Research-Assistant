import path from 'path';

import { isLocalKernelMode } from './localKernelRuntime.js';

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function shouldLocalKernelServeApp() {
  return isTruthyEnv(process.env.MEDHELP_LOCAL_KERNEL_SERVE_APP);
}

export function shouldServeAppStaticFiles({
  localKernelMode = isLocalKernelMode(),
  serveApp = shouldLocalKernelServeApp(),
} = {}) {
  return !localKernelMode || serveApp;
}

export function resolveServerRuntimeMode({
  localKernelMode = isLocalKernelMode(),
  serveApp = shouldLocalKernelServeApp(),
  hasBundledApp = false,
} = {}) {
  if (localKernelMode && !serveApp) {
    return { label: 'HEADLESS KERNEL', proxyToVite: false };
  }
  if (hasBundledApp) {
    return { label: 'PRODUCTION', proxyToVite: false };
  }
  return { label: 'DEVELOPMENT', proxyToVite: true };
}

export function getLocalKernelBrowserFallback(
  requestPath,
  {
    localKernelMode = isLocalKernelMode(),
    serveApp = shouldLocalKernelServeApp(),
  } = {},
) {
  if (!localKernelMode || serveApp) {
    return null;
  }

  const pathname = String(requestPath || '/');
  if (pathname === '/' || pathname === '') {
    return { status: 204, body: '' };
  }

  if (path.extname(pathname)) {
    return { status: 404, body: 'Not found' };
  }

  return { status: 404, body: 'Not found' };
}
