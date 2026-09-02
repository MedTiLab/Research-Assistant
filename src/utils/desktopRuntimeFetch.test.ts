import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DesktopRuntimeRequestError,
  isSafeDesktopRuntimeRetry,
  resolveDesktopRuntimeRetryUrl,
  runtimeAwareFetch,
} from './desktopRuntimeFetch';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('desktop Runtime-aware fetch', () => {
  it('only retries safe loopback requests', () => {
    expect(isSafeDesktopRuntimeRetry('/api/projects')).toBe(true);
    expect(isSafeDesktopRuntimeRetry('/api/projects', { method: 'POST' })).toBe(false);
    expect(isSafeDesktopRuntimeRetry('https://example.com/api/projects')).toBe(false);
    expect(isSafeDesktopRuntimeRetry('http://127.0.0.1:3001/health')).toBe(true);
  });

  it('re-resolves the Runtime origin while preserving path and query', () => {
    expect(resolveDesktopRuntimeRetryUrl('/api/projects?page=2', 'http://127.0.0.1:3010'))
      .toBe('http://127.0.0.1:3010/api/projects?page=2');
    expect(resolveDesktopRuntimeRetryUrl(
      'http://127.0.0.1:3001/api/projects?page=3',
      'http://127.0.0.1:3011',
    )).toBe('http://127.0.0.1:3011/api/projects?page=3');
  });

  it('waits for Runtime recovery and retries a failed GET once', async () => {
    let statusListener: ((status: MedHelpDesktopRuntimeStatus) => void) | null = null;
    vi.stubGlobal('window', {
      medhelpDesktop: {
        getRuntimeStatus: async () => ({ status: 'starting', baseUrl: null }),
        onRuntimeStatus: (listener: (status: MedHelpDesktopRuntimeStatus) => void) => {
          statusListener = listener;
          queueMicrotask(() => listener({
            status: 'running',
            baseUrl: 'http://127.0.0.1:3012',
          } as MedHelpDesktopRuntimeStatus));
          return () => { statusListener = null; };
        },
      },
    });
    const response = new Response('{}', { status: 200 });
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(runtimeAwareFetch('/api/projects')).resolves.toBe(response);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/projects');
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(fetchMock.mock.calls[1][0]).toBe('http://127.0.0.1:3012/api/projects');
    expect(statusListener).toBeNull();
  });

  it('never replays a failed write request', async () => {
    vi.stubGlobal('window', {
      medhelpDesktop: {
        getRuntimeStatus: vi.fn(),
        onRuntimeStatus: vi.fn(),
      },
    });
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(runtimeAwareFetch('/api/projects', { method: 'POST' })).rejects.toThrow('fetch failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns a structured error after bounded Runtime GET failures', async () => {
    vi.stubGlobal('window', {
      medhelpDesktop: {
        getRuntimeStatus: async () => ({
          status: 'running',
          baseUrl: 'http://127.0.0.1:3015',
        } as MedHelpDesktopRuntimeStatus),
        onRuntimeStatus: vi.fn(),
      },
    });
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    const error = await runtimeAwareFetch('http://127.0.0.1:3001/api/projects').catch((caught) => caught);
    expect(error).toBeInstanceOf(DesktopRuntimeRequestError);
    expect(error).toMatchObject({
      code: 'RUNTIME_UNAVAILABLE',
      attempts: 3,
      cause: expect.any(TypeError),
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('never reroutes a modern Desktop cloud-relative GET into Kernel', async () => {
    const getRuntimeStatus = vi.fn(async () => ({
      status: 'running',
      baseUrl: 'http://127.0.0.1:5055',
    } as MedHelpDesktopRuntimeStatus));
    vi.stubGlobal('window', {
      medhelpDesktop: {
        uiMode: 'offline',
        getRuntimeStatus,
        onRuntimeStatus: vi.fn(),
      },
    });
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('cloud fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(runtimeAwareFetch('/api/auth/status')).rejects.toThrow('cloud fetch failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getRuntimeStatus).not.toHaveBeenCalled();
  });

  it('preserves Request headers while moving a recovered GET to the new endpoint', async () => {
    vi.stubGlobal('window', {
      medhelpDesktop: {
        getRuntimeStatus: async () => ({
          status: 'running',
          baseUrl: 'http://127.0.0.1:3013',
        } as MedHelpDesktopRuntimeStatus),
        onRuntimeStatus: vi.fn(),
      },
    });
    const response = new Response('{}', { status: 200 });
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(response);
    vi.stubGlobal('fetch', fetchMock);
    const request = new Request('http://127.0.0.1:3001/api/projects', {
      headers: { Authorization: 'Bearer test-token' },
    });

    await expect(runtimeAwareFetch(request)).resolves.toBe(response);
    const retriedRequest = fetchMock.mock.calls[1][0] as Request;
    expect(retriedRequest).toBeInstanceOf(Request);
    expect(retriedRequest.url).toBe('http://127.0.0.1:3013/api/projects');
    expect(retriedRequest.headers.get('Authorization')).toBe('Bearer test-token');
  });

  it('aborts a hung Runtime GET and uses a bounded recovery attempt', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      medhelpDesktop: {
        getRuntimeStatus: async () => ({
          status: 'running',
          baseUrl: 'http://127.0.0.1:3014',
        } as MedHelpDesktopRuntimeStatus),
        onRuntimeStatus: vi.fn(),
      },
    });
    const response = new Response('{}', { status: 200 });
    const fetchMock = vi.fn()
      .mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      }))
      .mockResolvedValueOnce(response);
    vi.stubGlobal('fetch', fetchMock);

    const pending = runtimeAwareFetch('http://127.0.0.1:3001/api/projects');
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(pending).resolves.toBe(response);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('http://127.0.0.1:3014/api/projects');
    vi.useRealTimers();
  });
});
