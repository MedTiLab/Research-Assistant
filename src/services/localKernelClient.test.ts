import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isBrowserBlockedLocalKernelPort,
  isAllowedLoopbackHostname,
  parseLocalKernelEndpoint,
  probeLocalKernel,
  refreshLocalSessionCloudAuth,
  resolvePreferredLocalKernelEndpoints,
  startLocalSession,
} from './localKernelClient';

describe('localKernelClient endpoint validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  it('allows loopback endpoints', () => {
    const port = 5091;
    expect(parseLocalKernelEndpoint(`127.0.0.1:${port}`, 'url').endpoint?.httpBaseUrl)
      .toBe(`http://127.0.0.1:${port}`);
    expect(parseLocalKernelEndpoint(`localhost:${port}`, 'url').endpoint?.wsBaseUrl)
      .toBe(`ws://localhost:${port}`);
    expect(parseLocalKernelEndpoint(`http://[::1]:${port}`, 'url').endpoint?.host)
      .toBe('::1');
  });

  it('rejects non-loopback endpoints', () => {
    const port = 5091;
    expect(parseLocalKernelEndpoint(`0.0.0.0:${port}`, 'url').error).toBe('non_loopback_host');
    expect(parseLocalKernelEndpoint(`192.168.1.20:${port}`, 'url').error).toBe('non_loopback_host');
    expect(parseLocalKernelEndpoint(`https://example.com:${port}`, 'url').error).toBe('non_loopback_host');
    expect(isAllowedLoopbackHostname('10.0.0.2')).toBe(false);
  });

  it('skips ports blocked by Chromium before probing loopback', () => {
    expect(isBrowserBlockedLocalKernelPort(5060)).toBe(true);
    expect(isBrowserBlockedLocalKernelPort('5061')).toBe(true);
    expect(parseLocalKernelEndpoint('127.0.0.1:5060', 'url').error).toBe('blocked_port');
  });

  it('builds a private auto-discovery sequence from the default port upward', () => {
    const endpoints = resolvePreferredLocalKernelEndpoints();
    const firstPort = Number(endpoints[0]?.port);

    expect(endpoints[0]?.httpBaseUrl).toBe(`http://127.0.0.1:${firstPort}`);
    expect(endpoints[1]?.httpBaseUrl).toBe(`http://127.0.0.1:${firstPort + 1}`);
    expect(endpoints[2]?.httpBaseUrl).toBe(`http://127.0.0.1:${firstPort + 2}`);
    expect(endpoints.some((endpoint) => endpoint.port === '5060')).toBe(false);
    expect(endpoints.some((endpoint) => endpoint.port === '5061')).toBe(false);
    expect(new Set(endpoints.map((endpoint) => endpoint.httpBaseUrl)).size).toBe(endpoints.length);
  });

  it('refreshes cloud auth without replacing the local session token', async () => {
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      location: { protocol: 'https:', href: 'https://app.medtimehelp.com/' },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, updated: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    const endpoint = parseLocalKernelEndpoint('127.0.0.1:5055', 'url').endpoint!;

    await refreshLocalSessionCloudAuth(endpoint, 'mh_loc_existing', {
      cloudUserId: 'user-1',
      cloudAccessToken: 'cloud-new',
      cloudBaseUrl: 'https://app.medtimehelp.com',
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:5055/api/local/session/cloud-auth',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer mh_loc_existing' }),
      }),
    );
  });

  it('accepts only a real MedHelp health response during port discovery', async () => {
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      location: { protocol: 'https:', href: 'https://app.medtimehelp.com/' },
    });
    const endpoint = parseLocalKernelEndpoint('127.0.0.1:5055', 'default').endpoint!;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, product: 'Another Service' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        product: 'MedHelp Kernel',
        version: '1.1.20',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(probeLocalKernel(endpoint)).rejects.toThrow('not_medhelp_local_kernel');
    await expect(probeLocalKernel(endpoint)).resolves.toMatchObject({
      ok: true,
      product: 'MedHelp Kernel',
    });
  });

  it.each(['pair', 'renew'])('allows both cloud authorization steps to finish during %s', async (action) => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      setTimeout, clearTimeout,
      location: { protocol: 'https:', href: 'https://app.medtimehelp.com/' },
    });
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response(JSON.stringify({ ok: true, sessionToken: 'local-token' }))), 10_000);
      options.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Request aborted')); });
    })));
    const endpoint = parseLocalKernelEndpoint('127.0.0.1:5055', 'url').endpoint!;
    const result = action === 'pair'
      ? startLocalSession(endpoint, { cloudAccessToken: 'cloud-token', browserNonce: 'test', requestedPermissionMode: 'analysis' })
      : refreshLocalSessionCloudAuth(endpoint, 'local-token', { cloudAccessToken: 'cloud-token' });
    const completed = expect(result).resolves.toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(10_000);
    await completed;
  });
});
