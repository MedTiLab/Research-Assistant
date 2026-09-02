import { describe, expect, it } from 'vitest';

import {
  getLocalKernelBrowserFallback,
  resolveServerRuntimeMode,
  shouldServeAppStaticFiles,
} from '../utils/localKernelPageGuard.js';

describe('local Kernel page guard', () => {
  it('does not serve app static files in local Kernel mode', () => {
    expect(shouldServeAppStaticFiles({ localKernelMode: true })).toBe(false);
    expect(shouldServeAppStaticFiles({ localKernelMode: false })).toBe(true);
  });

  it('can serve the packaged app when the desktop shell explicitly opts in', () => {
    expect(shouldServeAppStaticFiles({ localKernelMode: true, serveApp: true })).toBe(true);
    expect(getLocalKernelBrowserFallback('/', { localKernelMode: true, serveApp: true })).toBeNull();
    expect(getLocalKernelBrowserFallback('/session/abc', { localKernelMode: true, serveApp: true })).toBeNull();
  });

  it('keeps the local Kernel root blank instead of serving the SPA', () => {
    expect(getLocalKernelBrowserFallback('/', { localKernelMode: true })).toEqual({
      status: 204,
      body: '',
    });
  });

  it('does not claim browser fallback routes outside local Kernel mode', () => {
    expect(getLocalKernelBrowserFallback('/', { localKernelMode: false })).toBeNull();
    expect(getLocalKernelBrowserFallback('/session/abc', { localKernelMode: false })).toBeNull();
  });

  it('returns plain not found for local Kernel browser paths and assets', () => {
    expect(getLocalKernelBrowserFallback('/session/abc', { localKernelMode: true })).toEqual({
      status: 404,
      body: 'Not found',
    });
    expect(getLocalKernelBrowserFallback('/assets/index.js', { localKernelMode: true })).toEqual({
      status: 404,
      body: 'Not found',
    });
  });

  it('classifies a frontend-free local Kernel as headless and never as a Vite proxy', () => {
    expect(resolveServerRuntimeMode({
      localKernelMode: true,
      serveApp: false,
      hasBundledApp: false,
    })).toEqual({
      label: 'HEADLESS KERNEL',
      proxyToVite: false,
    });
  });
});
