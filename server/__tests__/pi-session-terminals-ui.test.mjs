import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const browserSuite = process.env.MEDHELP_BROWSER_TESTS === '1' ? describe : describe.skip;
browserSuite('Pi session sidebar without duplicate terminals', () => {
  it('keeps live todos and task details but never displays or polls a terminal list', async () => {
    const { build } = await import('esbuild');
    const { chromium } = await import('playwright');
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const bundled = await build({
      stdin: {
        resolveDir: root, loader: 'tsx',
        contents: `
          import React, {useState} from 'react';
          import {createRoot} from 'react-dom/client';
          import {createInstance} from 'i18next';
          import {I18nextProvider} from 'react-i18next';
          import chat from './src/i18n/locales/zh-CN/chat.json';
          import common from './src/i18n/locales/zh-CN/common.json';
          import ChatContextSidebar from './src/components/chat/view/subcomponents/ChatContextSidebar';
          const i18n = createInstance();
          const project = {name:'project', path:'/project', fullPath:'/project'};
          const messages = [{id:'terminal-open', type:'assistant', isToolUse:true, toolName:'TerminalOpen',
            toolInput:JSON.stringify({command:'echo ready', title:'Terminal only in conversation'}), timestamp:1,
            toolResult:{content:JSON.stringify({terminal_id:'pty-1',status:'exited',output:'ready'})}}];
          function Fixture() {
            const [session, setSession] = useState('saved');
            return <><button onClick={() => setSession('other')}>Switch session</button>
              <button onClick={() => window.dispatchEvent(new Event('medhelp-agent-work-changed'))}>Refresh work</button>
              <div style={{display:'flex',height:900}} data-chat-layout-root>
                <ChatContextSidebar selectedProject={project} selectedSession={null} currentSessionId={session}
                  provider="pi" chatMessages={messages} />
              </div></>;
          }
          i18n.init({lng:'zh-CN', resources:{'zh-CN':{chat,common}}}).then(() => createRoot(document.getElementById('root')).render(
            <I18nextProvider i18n={i18n}><Fixture /></I18nextProvider>
          ));
        `,
      },
      bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
      plugins: [{ name: 'sidebar-fixtures', setup(builder) {
        builder.onResolve({filter:/\/(FileTree|GitPanel|SurveyPage|ConversationMemoryPanel|SimpleBrowser)$/}, args => ({path:args.path,namespace:'unrelated-sidebar-tab'}));
        builder.onLoad({filter:/.*/,namespace:'unrelated-sidebar-tab'}, () => ({contents:'export default function UnusedPanel() {return null;}'}));
        builder.onResolve({filter:/\/hooks\/useDeviceSettings$/}, args => ({path:args.path,namespace:'device'}));
        builder.onLoad({filter:/.*/,namespace:'device'}, () => ({contents:'export const useDeviceSettings = () => ({isMobile:false});'}));
        builder.onResolve({filter:/\/contexts\/ThemeContext$/}, args => ({path:args.path,namespace:'theme'}));
        builder.onLoad({filter:/.*/,namespace:'theme'}, () => ({contents:'export const useTheme = () => ({uiFontScale:1});'}));
        builder.onResolve({ filter: /\/utils\/api$/ }, args => ({ path: args.path, namespace: 'sidebar-api' }));
        builder.onLoad({ filter: /.*/, namespace: 'sidebar-api' }, () => ({ contents: `export const api = {
          sessionMessages: () => fetch('/messages'),
          sessionContextReview: () => fetch('/review'),
          piSessionState: (project, session, options) => fetch('/state/' + session, options),
          piTerminals: (project, session) => fetch('/terminals/' + session),
        };` }));
      } }],
    });
    const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ channel: 'chrome', headless: true }));
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
      page.setDefaultTimeout(5000);
      const requests = [];
      let completed = false;
      await page.route('**/*', async route => {
        const pathname = new URL(route.request().url()).pathname;
        requests.push(pathname);
        if (pathname === '/messages') return route.fulfill({json:{messages:[]}});
        if (pathname === '/review') return route.fulfill({json:{reviews:{}}});
        if (pathname.startsWith('/state/')) {
          const session = pathname.split('/').at(-1);
          return route.fulfill({ json: {
            updatedAt:'2026-08-29T00:00:00Z',
            todos:Array.from({length:7}, (_, index) => ({id:'todo-'+index, content:session+' todo '+index, status:completed?'completed':'pending'})),
            tasks:[{id:'independent', title:session+' independent task', background:true, status:'running',description:'Independent task details'}],
            plan:{title:'Research plan',plan:'Keep this plan',status:'approved'},
          } });
        }
        if (pathname.startsWith('/terminals/')) return route.fulfill({json:[{id:'pty-1',title:'Unexpected duplicate terminal',status:'exited'}]});
        return route.fulfill(pathname === '/fixture.js'
          ? { contentType: 'application/javascript', body: bundled.outputFiles[0].text }
          : { contentType: 'text/html', body: '<div id="root"></div><script src="/fixture.js"></script>' });
      });
      await page.goto('http://pi-sidebar.test');
      await page.getByText('saved todo 0', {exact:true}).waitFor();
      await page.getByRole('button', {name:'查看全部 8 项',exact:true}).click();
      await page.getByText('saved todo 6', {exact:true}).waitFor();
      await page.getByRole('button', {name:/saved independent task/}).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByText('Independent task details', {exact:true}).waitFor();
      await dialog.getByRole('button', {name:'关闭',exact:true}).click();
      await page.getByRole('button', {name:'会话任务活动8',exact:true}).click();
      await page.getByText('saved todo 0', {exact:true}).waitFor({state:'hidden'});
      await page.getByRole('button', {name:'会话任务活动8',exact:true}).click();
      await page.getByText('saved todo 0', {exact:true}).waitFor();
      completed = true;
      const refreshed = page.waitForResponse('**/state/saved');
      await page.getByRole('button', {name:'Refresh work',exact:true}).click();
      await refreshed;
      await expect.poll(() => page.getByRole('button', {name:/saved todo 0/}).textContent()).toContain('已完成');
      await page.getByRole('button', {name:'Switch session',exact:true}).click();
      await page.getByText('other todo 0', {exact:true}).waitFor();
      expect(await page.getByText('saved todo 0', {exact:true}).count()).toBe(0);
      expect(await page.getByText('会话终端', {exact:true}).count()).toBe(0);
      expect(await page.getByText('Unexpected duplicate terminal', {exact:true}).count()).toBe(0);
      expect(await page.getByText('Terminal only in conversation', {exact:true}).count()).toBe(0);
      expect(requests.filter(path => path.startsWith('/terminals/'))).toEqual([]);
    } finally { await browser.close(); }
  }, 20000);
});
