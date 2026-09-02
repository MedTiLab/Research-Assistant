import { describe, expect, it, vi } from 'vitest';

import {
  canReadRememberedLogin,
  readRememberedLoginWhenVisible,
  resolveHostedUiTimeout,
  shouldUseKeychainAuthSession,
} from './desktopStartupPolicy.mjs';

describe('offline desktop startup policy', () => {
  it('never reads the remembered password until the MedHelp window is visible and painted', async () => {
    const events = [];
    const visibility = [false, false, true];
    const readRememberedLogin = vi.fn(async () => {
      events.push('keychain-read');
      return { username: 'researcher', password: 'secret' };
    });

    const credentials = await readRememberedLoginWhenVisible({
      isLoginFormConnected: () => true,
      isMainWindowVisible: async () => {
        const visible = visibility.shift();
        events.push(`visible:${visible}`);
        return visible;
      },
      readRememberedLogin,
      waitForRetry: async () => events.push('retry'),
      waitForPaint: async () => events.push('paint'),
    });

    expect(credentials).toEqual({ username: 'researcher', password: 'secret' });
    expect(events).toEqual([
      'visible:false',
      'retry',
      'visible:false',
      'retry',
      'visible:true',
      'paint',
      'keychain-read',
    ]);
    expect(readRememberedLogin).toHaveBeenCalledTimes(1);
  });

  it('abandons the Keychain read when the login form disappears while the window is hidden', async () => {
    let connected = true;
    const readRememberedLogin = vi.fn();

    const credentials = await readRememberedLoginWhenVisible({
      isLoginFormConnected: () => connected,
      isMainWindowVisible: async () => false,
      readRememberedLogin,
      waitForRetry: async () => {
        connected = false;
      },
      waitForPaint: vi.fn(),
    });

    expect(credentials).toBeNull();
    expect(readRememberedLogin).not.toHaveBeenCalled();
  });

  it('blocks offline token-session Keychain access but keeps visible remembered-login access', () => {
    expect(shouldUseKeychainAuthSession('offline')).toBe(false);
    expect(shouldUseKeychainAuthSession('hosted')).toBe(true);
    expect(canReadRememberedLogin({ trustedRenderer: true, mainWindowVisible: false })).toBe(false);
    expect(canReadRememberedLogin({ trustedRenderer: false, mainWindowVisible: true })).toBe(false);
    expect(canReadRememberedLogin({ trustedRenderer: true, mainWindowVisible: true })).toBe(true);
  });

  it('does not misreport a slow renderer as a local-engine failure after the Kernel is healthy', () => {
    expect(resolveHostedUiTimeout({ kernelReady: true, rendererLoaded: true })).toBe('show-loaded-app');
    expect(resolveHostedUiTimeout({ kernelReady: false, rendererLoaded: true })).toBe('kernel-failure');
    expect(resolveHostedUiTimeout({ kernelReady: true, rendererLoaded: false })).toBe('renderer-load-failure');
    expect(resolveHostedUiTimeout({
      kernelReady: false,
      rendererLoaded: true,
      allowRuntimeUnavailable: true,
    })).toBe('show-loaded-app');
  });
});
