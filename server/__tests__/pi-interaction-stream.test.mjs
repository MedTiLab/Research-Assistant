import { describe, expect, it } from 'vitest';

const browserSuite = process.env.MEDHELP_BROWSER_TESTS === '1' ? describe : describe.skip;

browserSuite('Pi interaction timeout in the realtime React hook', () => {
  it('removes the question without inserting an assistant reply, and finishes the original streaming bubble', async () => {
    const { build } = await import('esbuild');
    const { chromium } = await import('playwright');
    const { fileURLToPath } = await import('node:url');
    const bundle = await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../../src/components/chat/hooks/', import.meta.url)), loader: 'tsx',
        contents: `
          import React, { useEffect, useRef, useState } from 'react';
          import { createRoot } from 'react-dom/client';
          import { useChatRealtimeHandlers } from './useChatRealtimeHandlers';
          import SimpleBrowser from '../view/subcomponents/SimpleBrowser';
          import { SIMPLE_BROWSER_NAVIGATE_EVENT } from '../utils/simpleBrowser';
          import { WebSocketProvider, useWebSocket } from '../../../contexts/WebSocketContext';
          window.WebSocket = class {
            static OPEN = 1; static CLOSED = 3; readyState = 1;
            constructor() { window.socket = this; setTimeout(() => this.onopen?.(), 0); }
            send() {} close() { this.readyState = 3; }
          };
          const noop = () => {};
          function Fixture() {
            const { latestMessage } = useWebSocket();
            const [provider, setProvider] = useState('pi');
            const [messages, setChatMessages] = useState([]);
            const [pending, setPendingPermissionRequests] = useState([]);
            const [isLoading, setIsLoading] = useState(false);
            const [canAbort, setCanAbortSession] = useState(false);
            const [status, setStatusTextOverride] = useState(null);
            const [browserVisible, setBrowserVisible] = useState(false);
            useEffect(() => {
              const showBrowser = () => setBrowserVisible(true);
              window.addEventListener(SIMPLE_BROWSER_NAVIGATE_EVENT, showBrowser);
              return () => window.removeEventListener(SIMPLE_BROWSER_NAVIGATE_EVENT, showBrowser);
            }, []);
            const chatMessagesRef = useRef(messages); chatMessagesRef.current = messages;
            const pendingViewSessionRef = useRef(null);
            const streamBufferRef = useRef(''); const streamTimerRef = useRef(null);
            window.emit = (message) => window.socket.onmessage({ data: JSON.stringify(message) });
            const seen = useRef([]);
            useEffect(() => { if (latestMessage?.probe != null) seen.current.push(latestMessage.probe); }, [latestMessage]);
            window.receivedProbes = () => seen.current;
            window.setProvider = setProvider;
            window.addNotice = () => setChatMessages((previous) => [...previous, { type: 'system', content: 'Notice', timestamp: 1 }]);
            useChatRealtimeHandlers({
              latestMessage, provider, selectedProject: { name: 'project' },
              selectedSession: { id: 'saved', __provider: provider }, currentSessionId: 'saved', isLoading,
              setChatMessages, chatMessagesRef, setPendingPermissionRequests, setIsLoading, setCanAbortSession,
              setCurrentSessionId: noop, setClaudeStatus: noop, setStatusTextOverride, setTokenBudget: noop,
              setIsSystemSessionChange: noop, setQueuedTurns: noop, requestTranscriptReconcile: noop,
              pendingViewSessionRef, streamBufferRef, streamTimerRef,
            });
            return <><pre id="state">{JSON.stringify({ messages, pending, isLoading, canAbort, status, provider })}</pre>{browserVisible && <SimpleBrowser />}</>;
          }
          createRoot(document.getElementById('root')).render(<WebSocketProvider><Fixture /></WebSocketProvider>);
        `,
      },
      bundle: true, write: false, format: 'iife', platform: 'browser', define: { 'import.meta.env': '{}' },
      plugins: [{ name: 'isolated-realtime-environment', setup(builder) {
        builder.onResolve({ filter: /\/i18n\/config$/ }, () => ({ path: 'i18n', namespace: 'fixture' }));
        builder.onResolve({ filter: /\/agent-work\/usePiSessionState$/ }, () => ({ path: 'state', namespace: 'fixture' }));
        builder.onResolve({ filter: /\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
        builder.onResolve({ filter: /\/localKernelStore$/ }, () => ({ path: 'kernel', namespace: 'fixture' }));
        builder.onResolve({ filter: /\/DesktopRuntimeContext$/ }, () => ({ path: 'desktop', namespace: 'fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'i18n'
          ? 'export default { language: "zh", t: (key) => key };'
          : path === 'auth' ? 'export const useAuth = () => ({ token: "test-token", isLoading: false });'
          : path === 'kernel' ? 'export const useOptionalLocalKernel = () => null;'
          : path === 'desktop' ? 'export const useDesktopRuntime = () => ({ supported: false });'
          : 'export const AGENT_WORK_CHANGED = "work-changed"; export const PI_SESSION_STATE = "pi-state";' }));
      } }],
    });
    const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ channel: 'chrome', headless: true }));
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        return route.fulfill(url.hostname === 'sources.example'
          ? { contentType: 'text/html', body: '<p>Source loaded</p>' }
          : url.pathname === '/fixture.js'
            ? { contentType: 'application/javascript', body: bundle.outputFiles[0].text }
            : { contentType: 'text/html', body: '<div id="root"></div><script src="/fixture.js"></script>' });
      });
      await page.goto('http://pi-interaction.test');
      await page.locator('#state').waitFor();
      const emit = (event) => page.evaluate((message) => window.emit(message), { provider: 'pi', runtimeId: 'pi', sessionId: 'saved', ...event });
      const read = () => page.locator('#state').textContent().then(JSON.parse);
      const piEvent = (event, data) => emit({ type: 'pi-response', data: { event, data } });

      await emit({ type: 'agent-permission-request', requestId: 'question', toolCallId: 'ask', toolName: 'AskUserQuestion', input: { questions: [] } });
      await page.waitForFunction(() => JSON.parse(document.querySelector('#state').textContent).pending.length === 1);
      await piEvent('assistant_message_start', { messageId: 'answer' });
      await piEvent('text_delta', { messageId: 'answer', text: '建议先' });
      await page.waitForFunction(() => JSON.parse(document.querySelector('#state').textContent).messages[0]?.content === '建议先');
      await emit({ type: 'agent-permission-cancelled', requestId: 'question', reason: 'timeout' });
      await page.waitForFunction(() => JSON.parse(document.querySelector('#state').textContent).pending.length === 0);
      expect(await read()).toMatchObject({ messages: [{ content: '建议先', isStreaming: true }], isLoading: true, canAbort: true });
      expect((await read()).messages).toHaveLength(1);

      // Even an unrelated row between deltas must not break message identity.
      await page.evaluate(() => window.addNotice());
      await piEvent('text_delta', { messageId: 'answer', text: '确认范围。' });
      await page.waitForFunction(() => JSON.parse(document.querySelector('#state').textContent).messages[0]?.content === '建议先确认范围。');
      await emit({ type: 'pi-complete' });
      await page.waitForFunction(() => !JSON.parse(document.querySelector('#state').textContent).isLoading);
      const finished = await read();
      expect(finished.messages).toHaveLength(2);
      expect(finished.messages[0]).toMatchObject({ content: '建议先确认范围。', isStreaming: false });
      expect(finished.canAbort).toBe(false);
      expect(JSON.stringify(finished)).not.toContain('timed out');

      // Exercise the actual transport, not one awaited React update per event.
      // Interleaved notifications prevent adjacent delta coalescing from hiding
      // lost events when MessageChannel tasks outrun concurrent React commits.
      await page.evaluate(() => {
        const scope = { provider: 'pi', runtimeId: 'pi', sessionId: 'saved' };
        window.emit({ ...scope, type: 'pi-response', data: { event: 'assistant_message_start', data: { messageId: 'burst' } } });
        for (let index = 0; index < 80; index++) {
          window.emit({ ...scope, type: 'pi-response', data: { event: 'text_delta', data: { messageId: 'burst', text: '完整' } } });
          window.emit({ type: 'transport-probe', probe: index });
        }
        window.emit({ ...scope, type: 'pi-complete' });
      });
      await page.waitForFunction(() => window.receivedProbes().length === 80);
      await page.waitForFunction(() => {
        const value = JSON.parse(document.querySelector('#state').textContent);
        return !value.isLoading && value.messages.some((message) => message.piMessageId === 'burst' && !message.isStreaming);
      });
      expect(await page.evaluate(() => window.receivedProbes())).toEqual(Array.from({ length: 80 }, (_, index) => index));
      expect((await read()).messages.find((message) => message.piMessageId === 'burst').content).toBe('完整'.repeat(80));

      // Preserve the legacy Claude notice, which is outside this Pi fix.
      await page.evaluate(() => window.setProvider('claude'));
      await page.waitForFunction(() => JSON.parse(document.querySelector('#state').textContent).provider === 'claude');
      await emit({ type: 'claude-permission-cancelled', provider: 'claude', runtimeId: 'claude', requestId: 'legacy', reason: 'timeout' });
      await page.waitForFunction(() => JSON.parse(document.querySelector('#state').textContent).messages.length === 4);
      expect((await read()).messages[3].content).toContain('The pending interaction timed out');

      // Only successful browser results in the active chat may open the sidebar.
      await page.evaluate(() => window.setProvider('pi'));
      await page.waitForFunction(() => JSON.parse(document.querySelector('#state').textContent).provider === 'pi');
      const browserResult = {
        toolCallId: 'browser-one', toolName: 'BrowserOpen', nativeToolName: 'browser_open', isError: false,
        output: JSON.stringify({ page_id: 'page-one', url: 'https://sources.example/evidence', sidebar_url: 'https://sources.example/evidence', text: 'Source text' }),
      };
      for (const scope of [{ sessionId: 'other' }, { projectKey: 'other' }, { provider: 'claude', runtimeId: 'claude' }]) {
        await emit({ type: 'pi-response', ...scope, data: { event: 'tool_completed', data: browserResult } });
      }
      await piEvent('tool_completed', { ...browserResult, isError: true });
      await piEvent('tool_completed', { ...browserResult, toolName: 'Read', nativeToolName: 'read' });
      await emit({ type: 'transport-probe', probe: 'browser-filtered' });
      await page.waitForFunction(() => window.receivedProbes().includes('browser-filtered'));
      expect(await page.locator('iframe').count()).toBe(0);

      await piEvent('tool_completed', browserResult);
      await page.frameLocator('iframe').getByText('Source loaded').waitFor();
      expect(await page.locator('iframe').getAttribute('src')).toBe('https://sources.example/evidence');
      expect(await page.locator('input').inputValue()).toBe('https://sources.example/evidence');
      await piEvent('tool_completed', {
        ...browserResult, toolName: 'BrowserAction', nativeToolName: 'browser_action',
        output: JSON.stringify({ page_id: 'page-one', url: 'https://sources.example/next', sidebar_url: 'https://sources.example/next' }),
      });
      await page.waitForFunction(() => document.querySelector('iframe')?.src === 'https://sources.example/next');
      expect(errors).toEqual([]);
    } finally { await browser.close(); }
  }, 30000);
});
