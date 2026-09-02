import { describe, expect, it, vi } from 'vitest';

import { createAsyncStatusCache } from '../utils/asyncStatusCache.js';

describe('createAsyncStatusCache', () => {
  it('deduplicates concurrent checks and refreshes after expiry', async () => {
    let currentTime = 100;
    const loader = vi.fn(async () => ({ sequence: loader.mock.calls.length }));
    const cache = createAsyncStatusCache(loader, {
      ttlMs: 5_000,
      now: () => currentTime,
    });

    const [first, concurrent] = await Promise.all([cache.get(), cache.get()]);
    expect(first).toBe(concurrent);
    expect(loader).toHaveBeenCalledTimes(1);

    currentTime += 4_999;
    await expect(cache.get()).resolves.toBe(first);
    expect(loader).toHaveBeenCalledTimes(1);

    currentTime += 2;
    await expect(cache.get()).resolves.toEqual({ sequence: 2 });
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
