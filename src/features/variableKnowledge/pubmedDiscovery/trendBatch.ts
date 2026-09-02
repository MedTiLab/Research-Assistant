export type TrendBatchRow = {
  id: string;
  /** Milliseconds since this row's trend was last refreshed, or null when never. */
  lastUpdatedAt?: string;
  hasTrendData: boolean;
};

/** A refreshed trend is treated as current for a day; PubMed monthly counts do not move faster. */
export const TREND_FRESHNESS_MS = 24 * 60 * 60 * 1000;

/** Consecutive failures after which the batch stops rather than keep hammering NCBI. */
export const TREND_BATCH_FAILURE_LIMIT = 3;

export function isTrendStale(row: TrendBatchRow, now = Date.now()) {
  if (!row.hasTrendData) return true;
  if (!row.lastUpdatedAt) return true;
  const updatedAt = new Date(row.lastUpdatedAt).getTime();
  if (Number.isNaN(updatedAt)) return true;
  return now - updatedAt >= TREND_FRESHNESS_MS;
}

/**
 * Rows the batch should refresh. `force` re-runs everything, including rows whose
 * trend is still fresh, for when the user explicitly wants a full recount.
 */
export function selectRowsForTrendBatch(rows: TrendBatchRow[], force = false, now = Date.now()) {
  return force ? [...rows] : rows.filter((row) => isTrendStale(row, now));
}
