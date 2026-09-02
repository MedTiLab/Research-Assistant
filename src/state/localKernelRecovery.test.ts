import { describe, expect, it } from 'vitest';

import {
  shouldAutoRetryDesktopConnection,
  shouldReplaceLocalKernelSessionAfterCloudAuthError,
  shouldRestartLocalKernelProbeAfterCloudAuthChange,
  shouldShowDesktopKernelTransition,
} from './localKernelRecovery';

describe('local Kernel login recovery', () => {
  it('automatically retries a signed-in browser when the Desktop app is offline', () => {
    expect(shouldAutoRetryDesktopConnection({
      isDesktopShell: false,
      isRequired: true,
      hasCloudAccessToken: true,
      state: 'offline',
    })).toBe(true);
    expect(shouldAutoRetryDesktopConnection({
      isDesktopShell: true,
      isRequired: true,
      hasCloudAccessToken: true,
      state: 'offline',
    })).toBe(false);
    expect(shouldAutoRetryDesktopConnection({
      isDesktopShell: false,
      isRequired: true,
      hasCloudAccessToken: false,
      state: 'offline',
    })).toBe(false);
    expect(shouldAutoRetryDesktopConnection({
      isDesktopShell: false,
      isRequired: true,
      hasCloudAccessToken: true,
      state: 'connected',
    })).toBe(false);
  });

  it('retries when cloud login finishes after the initial Kernel probe', () => {
    expect(shouldRestartLocalKernelProbeAfterCloudAuthChange({
      isRequired: true,
      state: 'session-pending',
      previousCloudAccessToken: null,
      currentCloudAccessToken: 'cloud-token',
    })).toBe(true);
  });

  it('retries an interrupted probe when online auth rotates to a fresh token', () => {
    expect(shouldRestartLocalKernelProbeAfterCloudAuthChange({
      isRequired: true,
      state: 'offline',
      previousCloudAccessToken: 'expired-token',
      currentCloudAccessToken: 'fresh-token',
    })).toBe(true);
    expect(shouldRestartLocalKernelProbeAfterCloudAuthChange({
      isRequired: true,
      state: 'probing',
      previousCloudAccessToken: 'expired-token',
      currentCloudAccessToken: 'fresh-token',
    })).toBe(true);
  });

  it('does not loop retries without a new cloud token', () => {
    expect(shouldRestartLocalKernelProbeAfterCloudAuthChange({
      isRequired: true,
      state: 'offline',
      previousCloudAccessToken: 'same-token',
      currentCloudAccessToken: 'same-token',
    })).toBe(false);
  });

  it('shows the desktop transition only while a connection can still complete', () => {
    expect(shouldShowDesktopKernelTransition('probing')).toBe(true);
    expect(shouldShowDesktopKernelTransition('session-pending')).toBe(true);
    expect(shouldShowDesktopKernelTransition('offline')).toBe(false);
    expect(shouldShowDesktopKernelTransition('error')).toBe(false);
  });

  it('keeps the active local session during transient cloud refresh failures', () => {
    expect(shouldReplaceLocalKernelSessionAfterCloudAuthError(new Error('network timeout'))).toBe(false);
    expect(shouldReplaceLocalKernelSessionAfterCloudAuthError({
      status: 503,
      payload: { code: 'CLOUD_AUTH_UNAVAILABLE' },
    })).toBe(false);
    expect(shouldReplaceLocalKernelSessionAfterCloudAuthError({
      status: 502,
      payload: { code: 'CLOUD_AUTH_REJECTED' },
    })).toBe(false);
  });

  it('replaces the local session only when the Kernel explicitly invalidates it', () => {
    expect(shouldReplaceLocalKernelSessionAfterCloudAuthError({
      status: 401,
      payload: { code: 'LOCAL_SESSION_AUTH_REQUIRED' },
    })).toBe(true);
    expect(shouldReplaceLocalKernelSessionAfterCloudAuthError({
      status: 403,
      payload: { code: 'CLOUD_USER_MISMATCH' },
    })).toBe(true);
  });
});
