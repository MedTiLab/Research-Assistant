import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCooldownRateLimiter, createDownloadRateLimiter } from '../middleware/rate-limit.js';

const originalDownloadRateLimitMax = process.env.DOWNLOAD_RATE_LIMIT_MAX;

function createRequest({ userId = 1, ip = '127.0.0.1' } = {}) {
  return {
    headers: {},
    ip,
    socket: { remoteAddress: ip },
    user: { id: userId },
  };
}

function createResponse() {
  const headers = new Map();
  return {
    statusCode: 200,
    payload: null,
    headers,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

function runMiddleware(middleware, req) {
  const res = createResponse();
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

afterEach(() => {
  vi.useRealTimers();
  if (originalDownloadRateLimitMax === undefined) {
    delete process.env.DOWNLOAD_RATE_LIMIT_MAX;
  } else {
    process.env.DOWNLOAD_RATE_LIMIT_MAX = originalDownloadRateLimitMax;
  }
});

describe('createCooldownRateLimiter', () => {
  it('allows the first request and blocks another request in the same cooldown window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const middleware = createCooldownRateLimiter({
      action: 'download-test',
      windowMs: 60_000,
    });

    const first = runMiddleware(middleware, createRequest());
    expect(first.nextCalled).toBe(true);
    expect(first.res.headers.get('x-ratelimit-remaining')).toBe('0');

    const second = runMiddleware(middleware, createRequest());
    expect(second.nextCalled).toBe(false);
    expect(second.res.statusCode).toBe(429);
    expect(second.res.payload).toMatchObject({
      code: 'RATE_LIMITED',
      action: 'download-test',
      retryAfterSeconds: 60,
    });
    expect(second.res.headers.get('retry-after')).toBe('60');
  });

  it('keeps cooldown buckets isolated by authenticated user and IP address', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const middleware = createCooldownRateLimiter({
      action: 'download-test',
      windowMs: 60_000,
    });

    expect(runMiddleware(middleware, createRequest({ userId: 1, ip: '10.0.0.1' })).nextCalled).toBe(true);
    expect(runMiddleware(middleware, createRequest({ userId: 2, ip: '10.0.0.1' })).nextCalled).toBe(true);
    expect(runMiddleware(middleware, createRequest({ userId: 1, ip: '10.0.0.2' })).nextCalled).toBe(true);
  });

  it('allows the same bucket again after the cooldown expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const middleware = createCooldownRateLimiter({
      action: 'download-test',
      windowMs: 60_000,
    });

    expect(runMiddleware(middleware, createRequest()).nextCalled).toBe(true);
    vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
    expect(runMiddleware(middleware, createRequest()).nextCalled).toBe(true);
  });
});

describe('createDownloadRateLimiter', () => {
  it('allows repeated ordinary downloads in the default one-minute window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    delete process.env.DOWNLOAD_RATE_LIMIT_MAX;

    const middleware = createDownloadRateLimiter({
      action: 'download-test',
      windowMs: 60_000,
    });

    expect(runMiddleware(middleware, createRequest()).nextCalled).toBe(true);
    expect(runMiddleware(middleware, createRequest()).nextCalled).toBe(true);

    for (let i = 0; i < 28; i += 1) {
      expect(runMiddleware(middleware, createRequest()).nextCalled).toBe(true);
    }

    const blocked = runMiddleware(middleware, createRequest());
    expect(blocked.nextCalled).toBe(false);
    expect(blocked.res.statusCode).toBe(429);
    expect(blocked.res.payload).toMatchObject({
      code: 'RATE_LIMITED',
      action: 'download-test',
      retryAfterSeconds: 60,
    });
  });
});
