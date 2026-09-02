import { describe, expect, it } from 'vitest';
import { isTrendStale, selectRowsForTrendBatch, TREND_FRESHNESS_MS } from './trendBatch';

const NOW = new Date('2026-08-23T12:00:00.000Z').getTime();

describe('trend batch selection', () => {
  it('treats a row that has never been refreshed as stale', () => {
    expect(isTrendStale({ id: 'a', hasTrendData: false }, NOW)).toBe(true);
  });

  it('treats a row refreshed within the day as current', () => {
    const lastUpdatedAt = new Date(NOW - TREND_FRESHNESS_MS + 60_000).toISOString();
    expect(isTrendStale({ id: 'a', hasTrendData: true, lastUpdatedAt }, NOW)).toBe(false);
  });

  it('treats a row refreshed more than a day ago as stale', () => {
    const lastUpdatedAt = new Date(NOW - TREND_FRESHNESS_MS - 60_000).toISOString();
    expect(isTrendStale({ id: 'a', hasTrendData: true, lastUpdatedAt }, NOW)).toBe(true);
  });

  it('treats an unparseable timestamp as stale rather than silently skipping the row', () => {
    expect(isTrendStale({ id: 'a', hasTrendData: true, lastUpdatedAt: 'not-a-date' }, NOW)).toBe(true);
  });

  it('skips fresh rows by default and includes them when forced', () => {
    const rows = [
      { id: 'fresh', hasTrendData: true, lastUpdatedAt: new Date(NOW - 1000).toISOString() },
      { id: 'stale', hasTrendData: false },
    ];

    expect(selectRowsForTrendBatch(rows, false, NOW).map((row) => row.id)).toEqual(['stale']);
    expect(selectRowsForTrendBatch(rows, true, NOW).map((row) => row.id)).toEqual(['fresh', 'stale']);
  });
});
