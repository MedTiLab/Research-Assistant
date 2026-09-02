import { describe, expect, it, vi } from 'vitest';

import {
  nextWithInactivityTimeout,
  resolveInactivityTimeoutMs,
} from '../utils/streamInactivity.js';

describe('stream inactivity helpers', () => {
  it('uses configured non-negative timeouts and falls back for invalid values', () => {
    expect(resolveInactivityTimeoutMs('250', 1_000)).toBe(250);
    expect(resolveInactivityTimeoutMs('0', 1_000)).toBe(0);
    expect(resolveInactivityTimeoutMs('invalid', 1_000)).toBe(1_000);
  });

  it('returns the next iterator result when activity arrives', async () => {
    const iterator = { next: vi.fn(async () => ({ done: false, value: 'event' })) };
    await expect(nextWithInactivityTimeout(iterator, { timeoutMs: 50 })).resolves.toEqual({
      done: false,
      value: 'event',
    });
  });

  it('rejects and invokes the timeout callback when the stream is silent', async () => {
    const onTimeout = vi.fn();
    const iterator = { next: vi.fn(() => new Promise(() => {})) };
    await expect(nextWithInactivityTimeout(iterator, {
      timeoutMs: 10,
      errorCode: 'TEST_IDLE',
      onTimeout,
    })).rejects.toMatchObject({ name: 'TimeoutError', code: 'TEST_IDLE' });
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('rejects immediately when the stream is aborted', async () => {
    const controller = new AbortController();
    const iterator = { next: vi.fn(() => new Promise(() => {})) };
    const pending = nextWithInactivityTimeout(iterator, {
      timeoutMs: 1_000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      name: 'AbortError',
      code: 'STREAM_ABORTED',
    });
  });
});
