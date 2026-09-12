import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_BROWSER_WIDTH,
  MIN_SIDEBAR_WIDTH,
  clampResizableBrowserWidth,
  readStoredSidebarCollapsed,
  resolveDefaultBrowserWidth,
  resolveExpandedBrowserWidth,
} from './chatSidebarLayout';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chat sidebar browser widths', () => {
  it('opens the browser at half of the chat layout', () => {
    expect(resolveDefaultBrowserWidth(1600)).toBe(800);
    expect(resolveDefaultBrowserWidth(1200)).toBe(600);
  });

  it('expands the browser to fill the chat layout', () => {
    expect(resolveExpandedBrowserWidth(1600)).toBe(1600);
    expect(resolveExpandedBrowserWidth(900)).toBe(900);
  });

  it('keeps a usable width on short layouts and unknown containers', () => {
    expect(resolveDefaultBrowserWidth(700)).toBe(MIN_SIDEBAR_WIDTH);
    expect(resolveDefaultBrowserWidth(0)).toBe(DEFAULT_BROWSER_WIDTH);
    expect(resolveExpandedBrowserWidth(Number.NaN)).toBe(DEFAULT_BROWSER_WIDTH);
  });

  it('allows dragging the browser wider than the old 840px cap', () => {
    expect(clampResizableBrowserWidth(1100, 1800)).toBe(1100);
    expect(clampResizableBrowserWidth(1600, 1800)).toBe(1400);
    expect(clampResizableBrowserWidth(200, 1800)).toBe(MIN_SIDEBAR_WIDTH);
  });

  it('keeps a previously opened browser panel expanded after reload', () => {
    const store: Record<string, string> = {};
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store[key] ?? null,
        setItem: (key: string, value: string) => {
          store[key] = value;
        },
        removeItem: (key: string) => {
          delete store[key];
        },
      },
    });

    window.localStorage.setItem('chat-session-context-collapsed', '0');
    expect(readStoredSidebarCollapsed('browser')).toBe(false);
    window.localStorage.setItem('chat-session-context-collapsed', '1');
    expect(readStoredSidebarCollapsed('browser')).toBe(true);
    window.localStorage.removeItem('chat-session-context-collapsed');
    expect(readStoredSidebarCollapsed('browser')).toBe(false);
    expect(readStoredSidebarCollapsed('files')).toBe(true);
  });
});
