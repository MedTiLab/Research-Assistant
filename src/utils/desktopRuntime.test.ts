import { afterEach, describe, expect, it, vi } from 'vitest';

import { getDesktopRuntimeInfo } from './desktopRuntime';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('desktop runtime mode', () => {
  it('recognizes the packaged offline shell from its launch URL', () => {
    vi.stubGlobal('window', {
      location: {
        origin: 'http://127.0.0.1:5077',
        search: '?desktopKernel=1&desktopUiMode=offline&desktopPlatform=darwin',
        hash: '',
      },
      medhelpDesktop: { isDesktop: true, platform: 'darwin' },
    });

    expect(getDesktopRuntimeInfo()).toMatchObject({
      isDesktopShell: true,
      isDesktopKernel: true,
      isOfflineShell: true,
      isLimitedShell: false,
      platform: 'darwin',
    });
  });

  it('recognizes a fail-open desktop shell that must keep the workspace mounted', () => {
    vi.stubGlobal('window', {
      location: {
        origin: 'https://app.medtimehelp.com',
        search: '?desktopKernel=1&desktopRuntimeLimited=1&desktopUiMode=hosted',
        hash: '',
      },
      medhelpDesktop: { isDesktop: true, platform: 'darwin' },
    });

    expect(getDesktopRuntimeInfo()).toMatchObject({
      isDesktopShell: true,
      isDesktopKernel: true,
      isLimitedShell: true,
    });
  });

  it('does not classify the hosted desktop as the offline shell', () => {
    vi.stubGlobal('window', {
      location: {
        origin: 'https://app.medtimehelp.com',
        search: '?desktopKernel=1&desktopUiMode=hosted&desktopPlatform=win32',
        hash: '',
      },
      medhelpDesktop: { isDesktop: true, platform: 'win32' },
    });

    expect(getDesktopRuntimeInfo().isOfflineShell).toBe(false);
  });

  it('keeps the packaged offline shell identity after SPA navigation drops launch parameters', () => {
    vi.stubGlobal('window', {
      location: {
        origin: 'http://127.0.0.1:5077',
        search: '',
        hash: '#/session/abc',
      },
      medhelpDesktop: {
        isDesktop: true,
        platform: 'darwin',
        uiMode: 'offline',
      },
    });

    expect(getDesktopRuntimeInfo()).toMatchObject({
      isDesktopShell: true,
      isDesktopKernel: true,
      isOfflineShell: true,
    });
  });

  it('keeps hosted Desktop separate from browser mode without launch parameters', () => {
    vi.stubGlobal('window', {
      location: {
        origin: 'https://app.medtimehelp.com',
        search: '',
        hash: '#/session/abc',
      },
      medhelpDesktop: {
        isDesktop: true,
        platform: 'darwin',
        uiMode: 'hosted',
      },
    });

    expect(getDesktopRuntimeInfo()).toMatchObject({
      isDesktopShell: true,
      isDesktopKernel: true,
      isOfflineShell: false,
    });
  });
});
