import { describe, expect, it } from 'vitest';

import {
  getAnchoredScrollTop,
  getNextVisibleMessageCount,
  HISTORY_TOP_PREFETCH_PX,
  shouldLoadOlderHistory,
} from '../historyScroll';

describe('chat history scrolling', () => {
  it('prefetches loaded or remote history near the top without requiring a button', () => {
    expect(shouldLoadOlderHistory({
      scrollTop: HISTORY_TOP_PREFETCH_PX,
      hasHiddenMessages: false,
      hasMoreMessages: true,
      isLoading: false,
    })).toBe(true);

    expect(shouldLoadOlderHistory({
      scrollTop: 0,
      hasHiddenMessages: true,
      hasMoreMessages: false,
      isLoading: false,
    })).toBe(true);
  });

  it('does not duplicate requests while loading or away from the history boundary', () => {
    expect(shouldLoadOlderHistory({
      scrollTop: 0,
      hasHiddenMessages: false,
      hasMoreMessages: true,
      isLoading: true,
    })).toBe(false);

    expect(shouldLoadOlderHistory({
      scrollTop: HISTORY_TOP_PREFETCH_PX + 1,
      hasHiddenMessages: true,
      hasMoreMessages: true,
      isLoading: false,
    })).toBe(false);
  });

  it('reveals history in bounded batches instead of rendering an unbounded transcript', () => {
    expect(getNextVisibleMessageCount(100, 1_000)).toBe(200);
    expect(getNextVisibleMessageCount(950, 1_000)).toBe(1_000);
    expect(getNextVisibleMessageCount(Infinity, 1_000)).toBe(1_000);
  });

  it('keeps the same viewport anchor after older content is prepended', () => {
    expect(getAnchoredScrollTop(2_000, 120, 3_400)).toBe(1_520);
    expect(getAnchoredScrollTop(2_000, 120, 1_900)).toBe(120);
  });
});
