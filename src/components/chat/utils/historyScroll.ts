export const HISTORY_TOP_PREFETCH_PX = 320;
export const HISTORY_REVEAL_BATCH_SIZE = 100;

interface HistoryLoadState {
  scrollTop: number;
  hasHiddenMessages: boolean;
  hasMoreMessages: boolean;
  isLoading: boolean;
  threshold?: number;
}

export function shouldLoadOlderHistory({
  scrollTop,
  hasHiddenMessages,
  hasMoreMessages,
  isLoading,
  threshold = HISTORY_TOP_PREFETCH_PX,
}: HistoryLoadState): boolean {
  return (
    !isLoading
    && (hasHiddenMessages || hasMoreMessages)
    && scrollTop <= threshold
  );
}

export function getNextVisibleMessageCount(
  currentCount: number,
  totalCount: number,
  batchSize = HISTORY_REVEAL_BATCH_SIZE,
): number {
  if (!Number.isFinite(currentCount)) {
    return totalCount;
  }

  return Math.min(totalCount, Math.max(0, currentCount) + batchSize);
}

export function getAnchoredScrollTop(
  previousScrollHeight: number,
  previousScrollTop: number,
  nextScrollHeight: number,
): number {
  const addedHeight = Math.max(0, nextScrollHeight - previousScrollHeight);
  return Math.max(0, previousScrollTop + addedHeight);
}
