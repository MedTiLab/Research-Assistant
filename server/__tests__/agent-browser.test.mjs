import { afterEach, describe, expect, it, vi } from 'vitest';

// Browser smoke test uses a real isolated browser but no internet or user profile.
vi.mock('../agent-runtime/public-web.js', () => ({
  resolvePublicUrl: async () => ({}),
  publicFetch: async () => new Response('<html><body><p id="state">Before</p><button onclick="document.getElementById(\'state\').textContent=\'After\'">Continue</button><a href="/next">Next page</a></body></html>', { headers: { 'content-type': 'text/html' } }),
  boundedResponseText: (response) => response.text(),
}));
import { createAgentBrowserSessions } from '../agent-runtime/browser-sessions.js';
const suite = process.env.MEDHELP_BROWSER_TESTS === '1' ? describe : describe.skip;
let browser;
afterEach(async () => { await browser?.shutdown(); });

describe('browser display routing', () => {
  it('can surface internal HTTP apps without claiming to read them', async () => {
    browser = createAgentBrowserSessions();
    const shown = await browser.execute('browser_show', { url: 'http://localhost:5173/internal-app' }, {
      identity: { ownerKey: 'one', projectKey: 'project', runtimeId: 'pi', sessionId: 'display' },
    });
    expect(shown).toMatchObject({
      url: 'http://localhost:5173/internal-app',
      sidebar_url: 'http://localhost:5173/internal-app',
      status: 'display-requested',
      display_only: true,
    });
    expect(shown).not.toHaveProperty('text');
  });
});

suite('isolated agent browser', () => {
  it('opens, snapshots, acts on stable element ids, enforces session ownership and closes', async () => {
    browser = createAgentBrowserSessions();
    const context = { identity: { ownerKey: 'one', projectKey: 'project', runtimeId: 'pi', sessionId: 'session' } };
    const opened = await browser.execute('browser_open', { url: 'https://browser-fixture.example' }, context);
    expect(opened.text).toContain('Before');
    expect(opened.sidebar_url).toBe('https://browser-fixture.example/');
    expect(await browser.execute('browser_snapshot', { page_id: opened.page_id }, context)).not.toHaveProperty('sidebar_url');
    expect(opened.elements[0]).toMatchObject({ index: 0, tag: 'BUTTON', label: 'Continue' });
    await expect(browser.execute('browser_snapshot', { page_id: opened.page_id }, { identity: { ...context.identity, ownerKey: 'other' } })).rejects.toThrow('not found');
    const updated = await browser.execute('browser_action', { page_id: opened.page_id, action: 'click', element: 0 }, context);
    expect(updated.text).toContain('After');
    expect(updated).not.toHaveProperty('sidebar_url');
    const navigated = await browser.execute('browser_action', { page_id: opened.page_id, action: 'click', element: 1 }, context);
    expect(navigated.sidebar_url).toBe('https://browser-fixture.example/next');
    expect(await browser.execute('browser_action', { page_id: opened.page_id, action: 'close' }, context)).toMatchObject({ status: 'closed' });
    await expect(browser.execute('browser_snapshot', { page_id: opened.page_id }, context)).rejects.toThrow('not found');
  }, 20_000);

  it('keeps background browsing out of the sidebar', async () => {
    browser = createAgentBrowserSessions();
    const context = { identity: { ownerKey: 'one', projectKey: 'project', runtimeId: 'pi', sessionId: 'background' } };
    const opened = await browser.execute('browser_open', { url: 'https://browser-fixture.example', show_in_sidebar: false }, context);
    expect(opened.text).toContain('Before');
    expect(opened).not.toHaveProperty('sidebar_url');
    const navigated = await browser.execute('browser_action', { page_id: opened.page_id, action: 'click', element: 1 }, context);
    expect(navigated.url).toBe('https://browser-fixture.example/next');
    expect(navigated).not.toHaveProperty('sidebar_url');
  }, 20_000);
});
