import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getLocalNetworkAccessPermissionState,
  isLoopbackRequestUrl,
  withLoopbackTargetAddressSpace,
} from './localNetworkAccess';

describe('localNetworkAccess', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps HTTP-page loopback requests as plain fetch options', () => {
    vi.stubGlobal('window', {
      location: { protocol: 'http:', href: 'http://127.0.0.1:5173/' },
    });
    const options = withLoopbackTargetAddressSpace('http://127.0.0.1:5055/health', {
      cache: 'no-store',
    });

    expect(options).toMatchObject({
      cache: 'no-store',
    });
    expect(options).not.toHaveProperty('targetAddressSpace');
  });

  it('marks HTTPS-page loopback requests for Loopback Network Access', () => {
    vi.stubGlobal('window', {
      location: { protocol: 'https:', href: 'https://app.medtimehelp.com/' },
    });
    const options = withLoopbackTargetAddressSpace('http://127.0.0.1:5055/health', {
      cache: 'no-store',
    });

    expect(options).toMatchObject({
      cache: 'no-store',
      targetAddressSpace: 'loopback',
    });
  });

  it('recognizes localhost and IPv6 loopback URLs', () => {
    expect(isLoopbackRequestUrl('http://localhost:5055/health')).toBe(true);
    expect(isLoopbackRequestUrl('http://[::1]:5055/health')).toBe(true);
  });

  it('leaves cloud and private-LAN URLs untouched', () => {
    expect(withLoopbackTargetAddressSpace('https://app.medtimehelp.com/api/auth/status', {}))
      .not.toHaveProperty('targetAddressSpace');
    expect(withLoopbackTargetAddressSpace('http://192.168.1.5:5055/health', {}))
      .not.toHaveProperty('targetAddressSpace');
  });

  it('reports Chromium Local Network Access permission state when available', async () => {
    vi.stubGlobal('navigator', {
      permissions: {
        query: vi.fn().mockResolvedValue({ state: 'denied' }),
      },
    });

    await expect(getLocalNetworkAccessPermissionState()).resolves.toBe('denied');
  });

  it('falls back cleanly when the browser does not expose the permission name', async () => {
    vi.stubGlobal('navigator', {
      permissions: {
        query: vi.fn().mockRejectedValue(new TypeError('unsupported permission')),
      },
    });

    await expect(getLocalNetworkAccessPermissionState()).resolves.toBe('unsupported');
  });
});
