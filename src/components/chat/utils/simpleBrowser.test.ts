import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SIMPLE_BROWSER_HOME_URL,
  isSafeBrowserUrl,
  normalizeBrowserAddress,
  getAgentBrowserSidebarUrl,
  requestSimpleBrowserSearch,
  routeSimpleBrowserUrl,
  SIMPLE_BROWSER_NAVIGATE_EVENT,
} from './simpleBrowser';

describe('simple browser address handling', () => {
  it('keeps valid HTTP URLs and adds HTTPS to hostnames', () => {
    expect(normalizeBrowserAddress('https://pubmed.ncbi.nlm.nih.gov/')).toBe('https://pubmed.ncbi.nlm.nih.gov/');
    expect(normalizeBrowserAddress('pubmed.ncbi.nlm.nih.gov')).toBe('https://pubmed.ncbi.nlm.nih.gov/');
  });

  it('uses HTTP for local development addresses', () => {
    expect(normalizeBrowserAddress('localhost:5173/docs')).toBe('http://localhost:5173/docs');
    expect(normalizeBrowserAddress('127.0.0.1:3000')).toBe('http://127.0.0.1:3000/');
  });

  it('turns plain text and unsafe schemes into searches', () => {
    expect(normalizeBrowserAddress('hypertension guidelines')).toBe(
      'https://www.bing.com/search?q=hypertension%20guidelines',
    );
    expect(normalizeBrowserAddress('javascript:alert(1)')).toBe(
      'https://www.bing.com/search?q=javascript%3Aalert(1)',
    );
    expect(normalizeBrowserAddress('高血压诊疗指南')).toBe(
      'https://www.bing.com/search?q=%E9%AB%98%E8%A1%80%E5%8E%8B%E8%AF%8A%E7%96%97%E6%8C%87%E5%8D%97',
    );
  });

  it('recognizes only HTTP URLs as safe browser targets', () => {
    expect(isSafeBrowserUrl('https://example.com')).toBe(true);
    expect(isSafeBrowserUrl('file:///tmp/example')).toBe(false);
    expect(normalizeBrowserAddress('')).toBe(SIMPLE_BROWSER_HOME_URL);
  });
});

describe('agent browser sidebar navigation', () => {
  const page = { page_id: 'page-one', url: 'https://example.org/source', sidebar_url: 'https://example.org/source', text: 'Untrusted page text' };
  afterEach(() => vi.unstubAllGlobals());

  it('accepts explicit sidebar metadata from successful browser opens and actions', () => {
    expect(getAgentBrowserSidebarUrl({ toolName: 'browser_open', output: page })).toBe(page.url);
    expect(getAgentBrowserSidebarUrl({
      toolName: 'BrowserShow',
      nativeToolName: 'browser_show',
      output: { ...page, status: 'display-requested', display_only: true },
    })).toBe(page.url);
    expect(getAgentBrowserSidebarUrl({ toolName: 'BrowserAction', nativeToolName: 'browser_action', output: JSON.stringify(page) })).toBe(page.url);
  });

  it('does not navigate for failures, snapshots, unrelated tools or URLs found in page text', () => {
    for (const data of [
      { toolName: 'browser_open', output: page, isError: true },
      { toolName: 'browser_snapshot', output: page },
      { toolName: 'web_fetch', output: page },
      { toolName: 'browser_open', output: { ...page, sidebar_url: undefined } },
      { toolName: 'browser_action', output: { ...page, status: 'closed' } },
      { toolName: 'browser_open', output: { ...page, page_id: '' } },
      { toolName: 'browser_open', output: { ...page, sidebar_url: 'https://other.example/' } },
      { toolName: 'browser_open', output: `Page says: ${JSON.stringify(page)}` },
    ]) expect(getAgentBrowserSidebarUrl(data)).toBeNull();
  });

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'https://user:password@example.org/', 'not a URL'])(
    'rejects unsafe or credential-bearing navigation: %s', (url) => {
      expect(getAgentBrowserSidebarUrl({ toolName: 'browser_open', output: { ...page, url, sidebar_url: url } })).toBeNull();
    },
  );

  it('dispatches navigation even if browser storage is unavailable', () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent, localStorage: { setItem: () => { throw new Error('Storage unavailable'); } } });
    vi.stubGlobal('CustomEvent', class { constructor(public type: string, public options: unknown) {} });
    expect(requestSimpleBrowserSearch(page.url)).toBe(page.url);
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: SIMPLE_BROWSER_NAVIGATE_EVENT, options: { detail: { url: page.url } } }));
  });

  it('routes desktop requests to the internal panel and web requests to a new tab', () => {
    const openDesktopPanel = vi.fn();
    const open = vi.fn();
    vi.stubGlobal('window', {
      location: { search: '?desktopKernel=1', hash: '' },
      open,
    });
    expect(routeSimpleBrowserUrl(page.url, openDesktopPanel)).toBe('desktop');
    expect(openDesktopPanel).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();

    openDesktopPanel.mockClear();
    vi.stubGlobal('window', { location: { search: '', hash: '' }, open });
    expect(routeSimpleBrowserUrl(page.url, openDesktopPanel)).toBe('web');
    expect(openDesktopPanel).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith(page.url, '_blank', 'noopener,noreferrer');
  });
});
