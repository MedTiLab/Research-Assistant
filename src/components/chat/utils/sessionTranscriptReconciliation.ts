/**
 * Keep a live transcript intact when the completion event arrives before the
 * provider has finished persisting its final message. Completion requests the
 * newest page, while `current` may already include many prepended history
 * pages. Merge an overlapping newest page onto that history, and retain the
 * existing array reference for byte-for-byte equivalent refreshes.
 */
export function reconcilePersistedSessionMessages<T>(
  current: T[],
  incoming: T[],
): T[] {
  if (!Array.isArray(incoming)) {
    return current;
  }
  if (!Array.isArray(current)) {
    return incoming;
  }
  if (current.length === 0) {
    return incoming.length === 0 ? current : incoming;
  }

  try {
    const currentKeys = current.map((message) => JSON.stringify(message));
    const incomingKeys = incoming.map((message) => JSON.stringify(message));

    if (
      currentKeys.length === incomingKeys.length
      && currentKeys.every((key, index) => key === incomingKeys[index])
    ) {
      return current;
    }

    // Completion refreshes always request the newest page. Once older history
    // has been prepended, that page is legitimately shorter than `current`.
    // Merge the overlapping tail instead of treating it as a stale regression:
    //
    // current:  [old ... A B C]
    // incoming:          [A B C FINAL]
    // merged:   [old ... A B C FINAL]
    for (
      let overlap = Math.min(currentKeys.length, incomingKeys.length);
      overlap > 0;
      overlap -= 1
    ) {
      const currentStart = currentKeys.length - overlap;
      let matches = true;
      for (let index = 0; index < overlap; index += 1) {
        if (currentKeys[currentStart + index] !== incomingKeys[index]) {
          matches = false;
          break;
        }
      }

      if (!matches) continue;

      if (overlap === current.length) {
        return incoming;
      }

      const merged = [
        ...current.slice(0, current.length - overlap),
        ...incoming,
      ];
      const mergedKeys = [
        ...currentKeys.slice(0, currentKeys.length - overlap),
        ...incomingKeys,
      ];
      if (
        mergedKeys.length === currentKeys.length
        && mergedKeys.every((key, index) => key === currentKeys[index])
      ) {
        return current;
      }
      return merged;
    }
  } catch {
    // Session messages are JSON data. If a provider ever supplies a
    // non-serializable field, fall back to the conservative length guard.
  }

  if (incoming.length < current.length) {
    return current;
  }

  return incoming;
}

export type TranscriptPage<T> = {
  messages: T[];
  total?: number;
  hasMore?: boolean;
  offset?: number;
};

export function getTranscriptPageStart(page: TranscriptPage<unknown>): number | null {
  if (!Number.isFinite(page.total) || Number(page.total) < 0) return null;
  return Math.max(0, Number(page.total) - (page.offset || 0) - page.messages.length);
}

/**
 * Pi appends separate records for tool calls and results. A single turn can
 * therefore outgrow the latest page without overlapping the loaded history.
 * Fetch back to its oldest loaded record before replacing the live transcript.
 */
export async function loadTranscriptWindow<T, P extends TranscriptPage<T>>({
  fetchPage,
  start,
  pageSize = 50,
}: {
  fetchPage: (limit: number) => Promise<P>;
  start: number | null;
  pageSize?: number;
}): Promise<P> {
  let limit = pageSize;
  let page = await fetchPage(limit);
  let pageStart = getTranscriptPageStart(page);
  while (start !== null && pageStart !== null && pageStart > start && page.hasMore !== false) {
    const nextLimit = Math.max(limit + pageSize, Number(page.total) - start);
    const expanded = await fetchPage(nextLimit);
    const expandedStart = getTranscriptPageStart(expanded);
    // Do not replace a complete snapshot with an empty/stale read, or loop if
    // a server caps the page size and cannot make progress. Keep hasMore so the
    // remaining history can still be loaded explicitly.
    if (expanded.messages.length < page.messages.length
      || (expandedStart !== null && expandedStart >= pageStart)) break;
    page = expanded;
    pageStart = expandedStart;
    limit = nextLimit;
  }
  return page;
}

export function shouldHoldLiveTranscript({
  liveMessageCount,
  persistedMessageCount,
  isProcessing,
  isLoadingPersistedMessages,
  isCompletionReconcileActive,
}: {
  liveMessageCount: number;
  persistedMessageCount: number;
  isProcessing: boolean;
  isLoadingPersistedMessages: boolean;
  isCompletionReconcileActive: boolean;
}): boolean {
  return liveMessageCount > 0
    && liveMessageCount > persistedMessageCount
    && (isProcessing || isLoadingPersistedMessages || isCompletionReconcileActive);
}
