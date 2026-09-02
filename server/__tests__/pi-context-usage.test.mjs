import { describe, expect, it } from 'vitest';

const browserSuite = process.env.MEDHELP_BROWSER_TESTS === '1' ? describe : describe.skip;

browserSuite('Pi context indicator with session restoration and realtime events', () => {
  it('restores the circle, rejects stale requests and displays post-compaction estimates without billing totals', async () => {
    const { build } = await import('esbuild');
    const { chromium } = await import('playwright');
    const { fileURLToPath } = await import('node:url');
    const bundle = await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../../src/components/chat/hooks/', import.meta.url)), loader: 'tsx',
        contents: `
          import React, { useMemo, useRef, useState } from 'react';
          import { createRoot } from 'react-dom/client';
          import { createInstance } from 'i18next';
          import { I18nextProvider } from 'react-i18next';
          import translations from '../../../i18n/locales/zh-CN/chat.json';
          import { useChatSessionState } from './useChatSessionState';
          import { useChatRealtimeHandlers } from './useChatRealtimeHandlers';
          import TokenUsagePie from '../view/subcomponents/TokenUsagePie';
          const noop = () => {}, project = { name: 'project', path: '/test/project' };
          const i18n = createInstance();
          i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { chat: translations } }, initImmediate: false });
          function Fixture() {
            const [id, choose] = useState('saved');
            const [latestMessage, emit] = useState(null);
            const selectedSession = useMemo(() => ({ id, __provider: 'pi' }), [id]);
            const pendingViewSessionRef = useRef(null), streamBufferRef = useRef(''), streamTimerRef = useRef(null);
            const state = useChatSessionState({ selectedProject: project, selectedSession, provider: 'pi', ws: null,
              sendMessage: noop, resetStreamingState: noop, pendingViewSessionRef });
            const chatMessagesRef = useRef(state.chatMessages); chatMessagesRef.current = state.chatMessages;
            useChatRealtimeHandlers({ ...state, latestMessage, provider: 'pi', selectedProject: project, selectedSession,
              chatMessagesRef, pendingViewSessionRef, streamBufferRef, streamTimerRef,
              setStatusTextOverride: noop, setPendingPermissionRequests: noop, setQueuedTurns: noop });
            window.choose = choose; window.emit = emit;
            return <><pre id="state">{JSON.stringify({ id, budget: state.tokenBudget, messages: state.chatMessages.length })}</pre>
              <TokenUsagePie {...state.tokenBudget} provider="pi" /></>;
          }
          createRoot(document.getElementById('root')).render(<I18nextProvider i18n={i18n}><Fixture /></I18nextProvider>);
        `,
      },
      bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'import.meta.env': '{}' },
      plugins: [{ name: 'context-fixture', setup(builder) {
        builder.onResolve({ filter: /\/utils\/api$/ }, () => ({ path: 'api', namespace: 'fixture' }));
        builder.onResolve({ filter: /\/hooks\/useEntitlements$/ }, () => ({ path: 'entitlements', namespace: 'fixture' }));
        builder.onResolve({ filter: /\/i18n\/config$/ }, () => ({ path: 'i18n', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: {
          api: `export const authenticatedFetch = (url, options) => fetch(url, options);
            export const api = { sessionMessages: (project, session, limit, offset, provider, options) => fetch('/history/' + session, options) };`,
          entitlements: 'const can = () => false; export const CAPABILITIES = {}; export const useEntitlements = () => ({ can });',
          i18n: 'export default { language: "zh-CN", t: (key) => key };',
        }[path] }));
      } }],
    });
    const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ channel: 'chrome', headless: true }));
    const pending = new Map();
    let holdSavedHistory = true;
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        const history = url.pathname.startsWith('/history/');
        const usage = url.pathname.endsWith('/token-usage');
        if (history || usage) {
          const id = history ? url.pathname.split('/').at(-1) : url.pathname.split('/').at(-2);
          const key = `${history ? 'history' : 'usage'}:${id}`;
          if (id === 'race' || id === 'slow' || id === 'saved' && history && holdSavedHistory) {
            const value = await new Promise((resolve) => pending.set(key, resolve));
            await route.fulfill({ json: value }).catch(() => {});
          } else {
            const tokenUsage = id === 'other' ? { used: 16000, total: 64000 } : { used: 32000, total: 128000 };
            await route.fulfill({ json: history ? { messages: [{ role: 'assistant', content: 'Saved reply' }], hasMore: false, tokenUsage } : tokenUsage });
          }
        } else await route.fulfill(url.pathname === '/fixture.js'
          ? { contentType: 'application/javascript', body: bundle.outputFiles[0].text }
          : { contentType: 'text/html', body: '<div id="root"></div><script src="/fixture.js"></script>' });
      });
      const read = () => page.locator('#state').textContent().then(JSON.parse);
      const emit = async (event, data, id = 'saved') => page.evaluate((message) => window.emit(message), {
        type: 'pi-response', provider: 'pi', runtimeId: 'pi', sessionId: id, data: { event, data },
      });
      await page.goto('http://pi-context.test');
      await page.getByRole('button', { name: '查看上下文状态' }).waitFor();
      expect(await page.getByRole('button', { name: '查看上下文状态' }).textContent()).toContain('25.0%');
      await expect.poll(() => pending.has('history:saved')).toBe(true);
      pending.get('history:saved')({ messages: [{ role: 'assistant', content: 'Saved reply' }], hasMore: false, tokenUsage: { provider: 'pi', totalTokens: 999999, context: null } });
      await page.waitForFunction(() => JSON.parse(document.querySelector('#state').textContent).messages > 0);
      expect((await read()).budget).toMatchObject({ used: 32000, total: 128000 });

      await page.evaluate(() => window.choose('race'));
      await expect.poll(() => pending.has('usage:race') && pending.has('history:race')).toBe(true);
      await emit('usage', { context: { tokens: 64000, contextWindow: 128000 } }, 'race');
      await page.getByText('50.0%', { exact: true }).waitFor();
      const oldUsage = page.waitForResponse('**/sessions/race/token-usage?provider=pi');
      const oldHistory = page.waitForResponse('**/history/race');
      pending.get('usage:race')({ used: 16000, total: 128000 });
      pending.get('history:race')({ messages: [{ role: 'assistant', content: 'Old reply' }], hasMore: false, tokenUsage: { used: 28000, total: 128000 } });
      await Promise.all([oldUsage, oldHistory]);
      await page.waitForFunction(() => JSON.parse(document.querySelector('#state').textContent).messages > 0);
      expect((await read()).budget.used).toBe(64000);

      await page.evaluate(() => window.choose('slow'));
      await expect.poll(() => pending.has('usage:slow') && pending.has('history:slow')).toBe(true);
      await page.evaluate(() => window.choose('other'));
      await page.getByText('25.0%', { exact: true }).waitFor();
      pending.get('usage:slow')({ used: 96000, total: 128000 });
      pending.get('history:slow')({ messages: [], tokenUsage: { used: 96000, total: 128000 } });
      await emit('auto_compaction_end', { success: true, context: { tokens: 8000, contextWindow: 64000, estimated: true } }, 'other');
      await page.getByText('12.5%', { exact: true }).waitFor();
      await page.getByRole('button', { name: '查看上下文状态' }).click();
      await page.getByRole('dialog').waitFor();
      expect((await read()).budget).toMatchObject({ used: 8000, total: 64000, estimated: true });
      expect(await page.getByRole('dialog').textContent()).toContain('估算');
      await emit('usage', { totalTokens: 999999, context: null }, 'other');
      // Wait for a subsequent event to prove the no-context usage was processed.
      await emit('thinking_delta', { text: 'Thinking', messageId: 'marker' }, 'other');
      await page.waitForFunction(() => JSON.parse(document.querySelector('#state').textContent).messages > 1);
      expect((await read()).budget.used).toBe(8000);
      await emit('usage', { totalTokens: 999999, context: { tokens: null, contextWindow: 64000 } }, 'other');
      await page.getByRole('button', { name: '等待上下文用量数据' }).waitFor();
      expect((await read()).budget.used).toBeNull();
      await emit('usage', { context: { tokens: 0, contextWindow: 64000 } }, 'other');
      await page.getByText('0.0%', { exact: true }).waitFor();

      holdSavedHistory = false;
      await page.reload();
      await page.getByText('25.0%', { exact: true }).waitFor();
      expect((await read()).budget).toMatchObject({ used: 32000, total: 128000 });
      expect(errors).toEqual([]);
    } finally {
      for (const resolve of pending.values()) resolve({});
      await browser.close();
    }
  }, 30000);
});
