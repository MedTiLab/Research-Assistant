import { getDesktopRuntimeInfo } from '../../../utils/desktopRuntime';

export const SIMPLE_BROWSER_HOME_URL = 'https://www.bing.com/';
export const SIMPLE_BROWSER_LAST_URL_STORAGE_KEY = 'medhelp-simple-browser-last-url-v3';
export const SIMPLE_BROWSER_NAVIGATE_EVENT = 'medhelp:simple-browser-navigate';

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const LOCAL_HOST_PATTERN = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i;
const HOST_PATTERN = /^(?:[^\s./]+\.)+[^\s./]+(?::\d+)?(?:[/?#]|$)/i;

export function isSafeBrowserUrl(value: string) {
  try {
    return HTTP_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function normalizeBrowserAddress(value: string) {
  const input = value.trim();
  if (!input) {
    return SIMPLE_BROWSER_HOME_URL;
  }

  if (/^https?:\/\//i.test(input)) {
    return isSafeBrowserUrl(input)
      ? new URL(input).href
      : `https://www.bing.com/search?q=${encodeURIComponent(input)}`;
  }

  if (LOCAL_HOST_PATTERN.test(input)) {
    const localUrl = `http://${input}`;
    return isSafeBrowserUrl(localUrl)
      ? new URL(localUrl).href
      : SIMPLE_BROWSER_HOME_URL;
  }

  if (HOST_PATTERN.test(input)) {
    const remoteUrl = `https://${input}`;
    return isSafeBrowserUrl(remoteUrl)
      ? new URL(remoteUrl).href
      : SIMPLE_BROWSER_HOME_URL;
  }

  return `https://www.bing.com/search?q=${encodeURIComponent(input)}`;
}

export function requestSimpleBrowserSearch(value: string) {
  const normalizedValue = value.trim();
  if (!normalizedValue || typeof window === 'undefined') {
    return null;
  }

  const url = normalizeBrowserAddress(normalizedValue);
  try {
    window.localStorage.setItem(SIMPLE_BROWSER_LAST_URL_STORAGE_KEY, url);
  } catch {
    // Navigation still works when storage is disabled.
  }
  window.dispatchEvent(new CustomEvent(SIMPLE_BROWSER_NAVIGATE_EVENT, {
    detail: { url },
  }));
  return url;
}

export function routeSimpleBrowserUrl(url: string, openInDesktopPanel: () => void) {
  if (typeof window === 'undefined' || !isSafeBrowserUrl(url)) {
    return null;
  }
  if (getDesktopRuntimeInfo().isDesktopShell) {
    openInDesktopPanel();
    return 'desktop' as const;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
  return 'web' as const;
}

/** Only consume explicit runtime metadata, never URLs extracted from page text. */
export function getAgentBrowserSidebarUrl(data: {
  toolName?: unknown;
  nativeToolName?: unknown;
  isError?: unknown;
  output?: unknown;
}) {
  const toolName = data.nativeToolName || data.toolName;
  if (!['browser_open', 'browser_show', 'browser_action', 'BrowserOpen', 'BrowserShow', 'BrowserAction'].includes(String(toolName)) || data.isError) {
    return null;
  }
  try {
    const result = typeof data.output === 'string' ? JSON.parse(data.output) : data.output;
    if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
    if (typeof result.page_id !== 'string' || !result.page_id || result.status === 'closed') return null;
    if (typeof result.sidebar_url !== 'string' || result.sidebar_url !== result.url) return null;
    const url = new URL(result.sidebar_url);
    if (!HTTP_PROTOCOLS.has(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
