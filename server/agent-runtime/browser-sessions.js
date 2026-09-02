import crypto from 'node:crypto';
import { publicFetch, boundedResponseText, resolvePublicUrl } from './public-web.js';

async function launchIsolatedBrowser() {
  const { chromium } = await import('playwright');
  try { return await chromium.launch({ headless: true }); }
  catch { return chromium.launch({ channel: 'chrome', headless: true }); }
}

export function createAgentBrowserSessions({ launch } = {}) {
  const sessions = new Map();
  const ownerKey = (context) => JSON.stringify(context.identity);
  const snapshot = async (record, notifySidebar = false) => {
    record.snapshotToken = crypto.randomUUID();
    record.elements = record.page.locator('a, button, input, textarea, select, [role="button"]');
    const result = { page_id: record.id, url: record.page.url(), text: (await record.page.locator('body').innerText({ timeout: 5000 })).slice(0, 24_000), elements: await record.elements.evaluateAll((items, token) => items.slice(0, 100).map((item, index) => {
      item.setAttribute('data-medhelp-element', `${token}:${index}`);
      return { index, tag: item.tagName, label: (item.innerText || item.getAttribute('aria-label') || item.getAttribute('placeholder') || '').slice(0, 150) };
    }), record.snapshotToken), untrusted: true };
    if (notifySidebar && record.showInSidebar && result.url !== record.lastSidebarUrl) {
      // Revalidate the final URL: a page can navigate after the initial open.
      await resolvePublicUrl(result.url);
      result.sidebar_url = result.url;
      record.lastSidebarUrl = result.url;
    }
    return result;
  };
  const close = async (record) => { clearTimeout(record.timer); sessions.delete(record.id); await record.browser.close(); };
  const touch = (record) => { clearTimeout(record.timer); record.timer = setTimeout(() => close(record).catch(() => {}), 10 * 60_000); record.timer.unref?.(); };
  return {
    async execute(name, input, context) {
      const owner = ownerKey(context);
      if (name === 'browser_show') {
        let url;
        try { url = new URL(String(input.url || '')); }
        catch { throw new Error('A valid HTTP(S) URL is required'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
          throw new Error('A safe HTTP(S) URL without embedded credentials is required');
        }
        return {
          page_id: `display:${crypto.randomUUID()}`,
          url: url.href,
          sidebar_url: url.href,
          status: 'display-requested',
          display_only: true,
        };
      }
      if (name === 'browser_open') {
        await resolvePublicUrl(input.url);
        if ([...sessions.values()].filter((record) => record.owner === owner).length >= 2) throw new Error('Close an existing browser page first');
        let browser;
        try { browser = await (launch || launchIsolatedBrowser)(); }
        catch { throw new Error('Browser runtime unavailable. Install Playwright Chromium locally, or connect an existing browser MCP integration.'); }
        try {
          const browserContext = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' });
          await browserContext.route('**/*', async (route) => {
            try {
              const request = route.request();
              const response = await publicFetch(request.url(), { method: request.method(), headers: request.headers(), body: request.postDataBuffer(), redirect: 'manual' });
              // This is intentionally a text browser: binary downloads/media are not loaded.
              if (!/text\/|javascript|json|xml/i.test(response.headers.get('content-type') || '')) { await response.body?.cancel(); return route.abort(); }
              const body = await boundedResponseText(response);
              const headers = Object.fromEntries(response.headers);
              delete headers['content-encoding']; delete headers['content-length'];
              await route.fulfill({ status: response.status, headers, body });
            } catch { await route.abort().catch(() => {}); }
          });
          await browserContext.routeWebSocket('**/*', (socket) => socket.close());
          const page = await browserContext.newPage();
          page.setDefaultTimeout(10_000);
          await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
          const record = { id: crypto.randomUUID(), owner, browser, page, showInSidebar: input.show_in_sidebar !== false };
          const result = await snapshot(record, true);
          sessions.set(record.id, record); touch(record);
          return result;
        } catch (error) { await browser.close(); throw error; }
      }
      const record = sessions.get(input.page_id);
      if (!record || record.owner !== owner) throw new Error('Browser page not found in this conversation');
      touch(record);
      if (name === 'browser_action') {
        if (input.action === 'close') { await close(record); return { page_id: record.id, status: 'closed' }; }
        if (!['click', 'fill'].includes(input.action) || !Number.isInteger(input.element) || input.element < 0 || input.element >= 100) throw new Error('Invalid browser action');
        const target = record.page.locator(`[data-medhelp-element="${record.snapshotToken}:${input.element}"]`);
        if (input.action === 'click') await target.click();
        else await target.fill(String(input.text || '').slice(0, 16_000));
      }
      return snapshot(record, name === 'browser_action');
    },
    async shutdown() { await Promise.allSettled([...sessions.values()].map(close)); },
  };
}
