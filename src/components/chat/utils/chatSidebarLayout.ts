export const SIDEBAR_WIDTH_STORAGE_KEY = 'chat-session-context-width';
export const BROWSER_WIDTH_STORAGE_KEY = 'chat-simple-browser-width';
export const SIDEBAR_COLLAPSED_STORAGE_KEY = 'chat-session-context-collapsed';
export const DEFAULT_SIDEBAR_WIDTH = 480;
export const DEFAULT_BROWSER_WIDTH = 620;
export const MIN_SIDEBAR_WIDTH = 360;
export const MAX_SIDEBAR_WIDTH = 840;
export const MIN_CHAT_AREA_WIDTH = 400;

export function resolveDefaultBrowserWidth(containerWidth: number) {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return DEFAULT_BROWSER_WIDTH;
  }

  const half = Math.round(containerWidth / 2);
  const maxAvailable = Math.max(MIN_SIDEBAR_WIDTH, containerWidth - MIN_CHAT_AREA_WIDTH);
  return Math.min(maxAvailable, Math.max(MIN_SIDEBAR_WIDTH, half));
}

export function resolveExpandedBrowserWidth(containerWidth: number) {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return DEFAULT_BROWSER_WIDTH;
  }

  return Math.max(MIN_SIDEBAR_WIDTH, containerWidth);
}

export function clampResizableBrowserWidth(width: number, containerWidth: number) {
  const boundedContainer = Number.isFinite(containerWidth) && containerWidth > 0
    ? containerWidth
    : width;
  const maxAvailable = Math.max(MIN_SIDEBAR_WIDTH, boundedContainer - MIN_CHAT_AREA_WIDTH);
  return Math.min(maxAvailable, Math.max(MIN_SIDEBAR_WIDTH, width));
}

export function readStoredSidebarCollapsed(activeSidebarTab?: string | null) {
  if (typeof window === 'undefined') {
    return activeSidebarTab !== 'context';
  }

  const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
  if (stored === '0') {
    return false;
  }
  if (stored === '1') {
    return true;
  }

  return activeSidebarTab !== 'context' && activeSidebarTab !== 'browser';
}
