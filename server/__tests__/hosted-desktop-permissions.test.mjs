import { describe, expect, it } from 'vitest';

import { isHostedDesktopPermissionAllowed } from '../../desktop/online/hostedPermissions.mjs';

describe('hosted desktop permissions', () => {
  it('keeps local Kernel network access enabled', () => {
    expect(isHostedDesktopPermissionAllowed('local-network-access')).toBe(true);
    expect(isHostedDesktopPermissionAllowed('loopbackNetwork')).toBe(true);
  });

  it('allows microphone-only media checks and requests', () => {
    expect(isHostedDesktopPermissionAllowed('media', { mediaType: 'audio' })).toBe(true);
    expect(isHostedDesktopPermissionAllowed('media', { mediaTypes: ['audio'] })).toBe(true);
  });

  it('rejects camera, mixed media, and unspecified media access', () => {
    expect(isHostedDesktopPermissionAllowed('media', { mediaType: 'video' })).toBe(false);
    expect(isHostedDesktopPermissionAllowed('media', { mediaTypes: ['audio', 'video'] })).toBe(false);
    expect(isHostedDesktopPermissionAllowed('media')).toBe(false);
  });

  it('does not widen any unrelated desktop permission', () => {
    expect(isHostedDesktopPermissionAllowed('geolocation')).toBe(false);
    expect(isHostedDesktopPermissionAllowed('display-capture')).toBe(false);
  });
});
