import { describe, expect, it } from 'vitest';

const browserSuite = process.env.MEDHELP_BROWSER_TESTS === '1' ? describe : describe.skip;

browserSuite('Pi session state loading in React', () => {
  it('retries failures, keeps known progress and isolates errors and pending requests by session', async () => {
    const { build } = await import('esbuild');
    const { chromium } = await import('playwright');
    const { fileURLToPath } = await import('node:url');
    const bundled = await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../../src/components/chat/view/subcomponents/', import.meta.url)),
        loader: 'tsx',
        contents: `
          import React, { useState } from 'react';
          import { createRoot } from 'react-dom/client';
          import { createInstance } from 'i18next';
          import { I18nextProvider } from 'react-i18next';
          import chat from '../../../../i18n/locales/zh-CN/chat.json';
          import { usePiSessionState } from '../../../agent-work/usePiSessionState';
          import { AGENT_WORK_CHANGED } from '../../../agent-work/usePiSessionState';
          function SessionState({ projectName, sessionId }) {
            const {state, error, refresh} = usePiSessionState(projectName, sessionId);
            return <>{error && <span role="status" title={error}>
              {state ? 'Pi 进度更新失败（保留上次进度）' : 'Pi 进度加载失败'}
              <button aria-label="重试加载 Pi 进度" onClick={refresh}>重试</button>
            </span>}{state && <pre id="progress">{JSON.stringify(state)}</pre>}</>;
          }
          function Fixture() {
            const [session, setSession] = useState('saved');
            const [project, setProject] = useState('first');
            return <>
              <button id="saved" onClick={() => setSession('saved')}>Saved</button>
              <button id="temporary" onClick={() => setSession('temp-one')}>Temporary</button>
              <button id="new" onClick={() => setSession('new-session-one')}>New</button>
              <button id="slow" onClick={() => setSession('slow')}>Slow</button>
              <button id="project" onClick={() => setProject('second')}>Another project</button>
              <button id="none" onClick={() => setSession(null)}>No session</button>
              <button id="refresh" onClick={() => window.dispatchEvent(new Event(AGENT_WORK_CHANGED))}>Refresh</button>
              <div id="identity">{project}:{session}</div>
              <SessionState projectName={project} sessionId={session} />
            </>;
          }
          const i18n = createInstance();
          i18n.init({lng:'zh-CN', resources:{'zh-CN':{chat}}}).then(() =>
            createRoot(document.getElementById('root')).render(<I18nextProvider i18n={i18n}><Fixture /></I18nextProvider>)
          );
        `,
      },
      bundle: true, write: false, format: 'iife', platform: 'browser',
      plugins: [{ name: 'isolated-progress-api', setup(builder) {
        builder.onResolve({ filter: /\/contexts\/TaskMasterContext$/ }, () => ({ path: 'tasks', namespace: 'fixture-tasks' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture-tasks' }, () => ({ contents: 'export const useTaskMaster = () => ({ tasks: [] });' }));
        builder.onResolve({ filter: /\/utils\/api$/ }, () => ({ path: 'api', namespace: 'fixture-api' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture-api' }, () => ({ contents: `export const api = { piSessionState: (project, session, options) => fetch('/state/' + project + '/' + session, options) };` }));
      } }],
    });
    const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ channel: 'chrome', headless: true }));
    let fail = true, releaseSlow;
    const requests = [];
    try {
      const page = await browser.newPage();
      await page.clock.install();
      await page.route('**/*', async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname.startsWith('/state/')) {
          requests.push(pathname);
          if (pathname.endsWith('/slow')) await new Promise((resolve) => { releaseSlow = resolve; });
          await route.fulfill(fail
            ? { status: 503, json: { error: 'Unavailable' } }
            : { json: { todos: [{ content: 'Check sources', status: 'completed' }, { content: 'Write summary', status: 'pending' }], tasks: [] } }).catch(() => {});
        } else if (pathname === '/fixture.js') {
          await route.fulfill({ contentType: 'application/javascript', body: bundled.outputFiles[0].text });
        } else {
          await route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script src="/fixture.js"></script>' });
        }
      });
      await page.goto('http://pi-progress.test');
      await page.getByText('Pi 进度加载失败').waitFor();
      expect(await page.getByRole('status').getAttribute('title')).toContain('503');

      for (const id of ['temporary', 'new', 'none']) {
        await page.locator(`#${id}`).click();
        await page.getByRole('status').waitFor({ state: 'hidden' });
      }
      expect(requests).toEqual(['/state/first/saved']);

      await page.locator('#saved').click();
      await page.getByText('Pi 进度加载失败').waitFor();
      fail = false;
      await page.getByRole('button', { name: /重试加载 Pi 进度/ }).click();
      await page.locator('#progress').waitFor();
      expect(await page.getByRole('status').count()).toBe(0);

      fail = true;
      await page.locator('#refresh').click();
      await page.clock.runFor(150);
      await page.getByText('Pi 进度更新失败（保留上次进度）').waitFor();
      expect(await page.locator('#progress').count()).toBe(1);

      const slowRequest = page.waitForRequest('**/state/first/slow');
      await page.locator('#slow').click();
      await slowRequest;
      await page.getByRole('status').waitFor({ state: 'hidden' });
      await page.locator('#progress').waitFor({ state: 'hidden' });
      await page.clock.runFor(15001);
      await page.getByRole('status').waitFor();
      expect(await page.getByRole('status').getAttribute('title')).toContain('超时');
      releaseSlow?.(); releaseSlow = null;

      await page.locator('#none').click();
      await page.getByRole('status').waitFor({ state: 'hidden' });
      await page.locator('#project').click();
      fail = false;
      await page.locator('#saved').click();
      await page.locator('#progress').waitFor();
      expect(await page.getByRole('status').count()).toBe(0);
      expect(requests.at(-1)).toBe('/state/second/saved');
    } finally {
      releaseSlow?.();
      await browser.close();
    }
  }, 30000);
});

browserSuite('research task progress during Pi project updates', () => {
  it('keeps loaded tasks during metadata updates and failed background refreshes', async () => {
    const { build } = await import('esbuild');
    const { chromium } = await import('playwright');
    const { fileURLToPath } = await import('node:url');
    const bundle = await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../../src/contexts/', import.meta.url)), loader: 'tsx',
        contents: `
          import React, { useState } from 'react';
          import { createRoot } from 'react-dom/client';
          import { TaskMasterProvider, useTaskMaster } from './TaskMasterContext';
          function Fixture() {
            const tasks = useTaskMaster();
            window.selectProject = (name, revision = 0) => tasks.setCurrentProject({ name, revision });
            window.refresh = tasks.refreshTasks;
            return <pre id="state">{JSON.stringify({ tasks: tasks.tasks, loading: tasks.isLoadingTasks, next: tasks.nextTask })}</pre>;
          }
          createRoot(document.getElementById('root')).render(<TaskMasterProvider><Fixture /></TaskMasterProvider>);
        `,
      },
      bundle: true, write: false, format: 'iife', platform: 'browser',
      plugins: [{ name: 'task-fixture', setup(builder) {
        builder.onResolve({ filter: /\/(utils\/api|AuthContext|WebSocketContext|state\/localKernelStore|hooks\/useEntitlements)$/ }, ({ path }) => ({ path, namespace: 'task-fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'task-fixture' }, ({ path }) => ({ contents:
          path.endsWith('/api') ? `export const api = { get: (path, options) => fetch('/api' + path, options) };`
          : path.endsWith('AuthContext') ? `const state = { user: {id: 1}, token: 'fixture', isLoading: false }; export const useAuth = () => state;`
          : path.endsWith('WebSocketContext') ? `export const useWebSocket = () => ({latestMessage: null});`
          : path.endsWith('localKernelStore') ? `export const useOptionalLocalKernel = () => null;`
          : `export const CAPABILITIES = { researchTasks: 'tasks' }; export const useEntitlements = () => ({can: () => true});`
        }));
      } }],
    });
    const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ channel: 'chrome', headless: true }));
    let release, fail = false;
    const requests = [];
    try {
      const page = await browser.newPage();
      await page.route('**/*', async (route) => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname.startsWith('/api/taskmaster/tasks/')) {
          requests.push(pathname);
          if (fail) await new Promise((resolve) => { release = resolve; });
          await route.fulfill(fail ? { status: 503, json: { message: 'Unavailable' } }
            : { json: { tasks: [{ id: 'one', title: pathname.split('/').at(-1), status: 'pending' }] } }).catch(() => {});
        } else if (pathname.startsWith('/api/')) {
          await route.fulfill({ json: pathname === '/api/projects' ? [] : {} });
        } else {
          await route.fulfill(pathname === '/fixture.js'
            ? { contentType: 'application/javascript', body: bundle.outputFiles[0].text }
            : { contentType: 'text/html', body: '<div id="root"></div><script src="/fixture.js"></script>' });
        }
      });
      await page.goto('http://tasks.test');
      await page.locator('#state').waitFor();
      await page.evaluate(() => window.selectProject('first'));
      await page.waitForFunction(() => JSON.parse(document.querySelector('#state').textContent).next?.title === 'first');
      const initial = await page.locator('#state').textContent();
      for (let revision = 1; revision < 8; revision++) {
        await page.evaluate((revision) => window.selectProject('first', revision), revision);
      }
      expect(await page.locator('#state').textContent()).toBe(initial);
      expect(requests).toEqual(['/api/taskmaster/tasks/first']);
      fail = true;
      const request = page.waitForRequest('**/api/taskmaster/tasks/first');
      await page.evaluate(() => { void window.refresh(); });
      await request;
      expect(JSON.parse(await page.locator('#state').textContent())).toMatchObject({ loading: false, tasks: [{ title: 'first' }] });
      release(); release = null;
      await page.waitForResponse('**/api/taskmaster/tasks/first');
      expect(JSON.parse(await page.locator('#state').textContent())).toMatchObject({ loading: false, tasks: [{ title: 'first' }] });
      fail = false;
      await page.evaluate(() => window.selectProject('second'));
      await page.waitForFunction(() => JSON.parse(document.querySelector('#state').textContent).next?.title === 'second');
      expect(requests).toEqual(['/api/taskmaster/tasks/first', '/api/taskmaster/tasks/first', '/api/taskmaster/tasks/second']);
    } finally { release?.(); await browser.close(); }
  }, 30000);
});

browserSuite('project progress for all providers', () => {
  it('keeps one project card for every provider without fetching duplicate Pi session progress', async () => {
    const { build } = await import('esbuild');
    const { chromium } = await import('playwright');
    const { fileURLToPath } = await import('node:url');
    const { default: postcss } = await import('postcss');
    const { default: tailwindcss } = await import('tailwindcss');
    const { default: tailwindConfig } = await import('../../tailwind.config.js');
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const css = await postcss([tailwindcss({ ...tailwindConfig, content: [
      `${root}src/components/chat/view/subcomponents/ChatTaskProgressPill.tsx`,
      `${root}src/components/chat/view/subcomponents/TaskProgressCard.tsx`,
    ] })]).process('@tailwind base; @tailwind utilities;', { from: undefined });
    const bundle = await build({
      stdin: { resolveDir: root, loader: 'tsx', contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { createInstance } from 'i18next';
        import { I18nextProvider } from 'react-i18next';
        import chat from './src/i18n/locales/zh-CN/chat.json';
        import ChatTaskProgressPill from './src/components/chat/view/subcomponents/ChatTaskProgressPill';
        function Fixture() {
          const [provider, setProvider] = useState('pi');
          const [compact, setCompact] = useState(true);
          const [session, setSession] = useState('saved');
          window.showProvider = setProvider;
          window.showCompact = setCompact;
          window.showSession = setSession;
          return <div style={{position:'fixed', bottom:80, left:16, right:16, maxWidth:780, margin:'auto'}}>
            <ChatTaskProgressPill provider={provider} projectName="fixture" sessionId={session} compact={compact}
              onShowAllTasks={() => {window.allTaskClicks = (window.allTaskClicks || 0) + 1;}}
              onStartTask={(prompt, task) => {window.startedTask = {prompt, title:task.title};}} />
          </div>;
        }
        const i18n = createInstance();
        i18n.init({lng:'zh-CN', resources:{'zh-CN':{chat}}}).then(() =>
          createRoot(document.getElementById('root')).render(<I18nextProvider i18n={i18n}><Fixture /></I18nextProvider>)
        );
      ` },
      bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
      plugins: [{ name: 'shared-progress-fixture', setup(builder) {
        builder.onResolve({ filter: /\/contexts\/TaskMasterContext$/ }, () => ({ path: 'tasks', namespace: 'progress-fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'progress-fixture' }, () => ({ contents: `
          const task = {id:'active', title:'原始项目任务：Collect and triage the core DKD literature set', status:'in-progress', stage:'survey', nextActionPrompt:'Continue research'};
          export const useTaskMaster = () => ({tasks:[task, {id:'done', status:'done', stage:'survey'}, {id:'pending', status:'pending', stage:'survey'}], nextTask:task});
        ` }));
        builder.onResolve({ filter: /\/utils\/api$/ }, () => ({ path: 'api', namespace: 'progress-api' }));
        builder.onLoad({ filter: /.*/, namespace: 'progress-api' }, () => ({ contents: `export const api = {piSessionState:(project,session,options)=>fetch('/state/'+session,options)};` }));
      } }],
    });
    const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ channel: 'chrome', headless: true }));
    try {
      const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
      page.setDefaultTimeout(5000);
      const stateRequests = [];
      await page.route('**/*', async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname.startsWith('/state/')) {
          stateRequests.push(pathname);
          return route.fulfill({ json: pathname.endsWith('/empty') ? {} : {
            todos: Array.from({length:7}, (_, index) => ({ id:`todo-${index}`, content:`会话待办 ${index}：` + '核对数据来源与分析变量；'.repeat(8), status:index<2?'completed':index===2?'in_progress':'pending' })),
            tasks: [{id:'child', title:'Independent research', background:true, status:'failed'}],
          } });
        }
        return route.fulfill(pathname === '/fixture.js'
          ? { contentType:'application/javascript', body:bundle.outputFiles[0].text }
          : { contentType:'text/html', body:`<style>${css.css}</style><div id="root"></div><script src="/fixture.js"></script>` });
      });
      await page.goto('http://shared-progress.test');
      const session = page.getByRole('group', { name:'会话待办进度', exact:true });
      const project = page.getByRole('group', { name:'项目任务进度', exact:true });
      await project.waitFor();
      expect(await session.count()).toBe(0);
      expect(await page.getByRole('group').count()).toBe(1);
      const cardMetrics = group => group.locator(':scope > div').evaluate(element => {
        const style = getComputedStyle(element);
        return {height:element.getBoundingClientRect().height, radius:style.borderRadius, padding:style.padding,
          fonts:[...element.querySelectorAll('p')].map(p => getComputedStyle(p).fontSize),
          icon:element.querySelector('svg').getBoundingClientRect().height};
      });
      const projectMetrics = await cardMetrics(project);
      expect(projectMetrics.height).toBe(40);
      await project.getByRole('button').click();
      const projectPanel = page.getByRole('region', {name:'项目任务进度', exact:true});
      await projectPanel.waitFor();
      expect(await page.getByRole('region').count()).toBe(1);
      expect(await projectPanel.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
      expect(await projectPanel.getByRole('progressbar').getAttribute('aria-valuemax')).toBe('3');
      await projectPanel.getByRole('button', {name:'全部任务',exact:true}).click();
      expect(await page.evaluate(() => window.allTaskClicks)).toBe(1);
      await page.keyboard.press('Escape');
      await projectPanel.waitFor({state:'hidden'});
      expect(await project.getByRole('button').evaluate(element => element === document.activeElement)).toBe(true);

      for (const width of [760, 360]) {
        await page.setViewportSize({width,height:850});
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        for (const label of ['项目任务进度']) {
          const group = page.getByRole('group', {name:label,exact:true});
          await group.getByRole('button').click();
          const panel = page.getByRole('region', {name:label,exact:true});
          const box = await panel.boundingBox();
          expect(box.x).toBeGreaterThanOrEqual(16);
          expect(box.x + box.width).toBeLessThanOrEqual(width - 16);
          await page.mouse.click(width/2, 20);
          await panel.waitFor({state:'hidden'});
        }
      }
      await page.setViewportSize({width:1000,height:850});
      for (const provider of ['claude', 'codex']) {
        await page.evaluate(provider => window.showProvider(provider), provider);
        await session.waitFor({state:'hidden'});
        expect(await cardMetrics(project)).toEqual(projectMetrics);
        await project.getByRole('button').click();
        await page.getByRole('region', {name:'项目任务进度',exact:true}).waitFor();
        await page.keyboard.press('Escape');
      }
      expect(stateRequests).toEqual([]);
      await page.evaluate(() => window.showCompact(false));
      await project.getByRole('button', {name:'在对话中使用',exact:true}).click();
      expect(await page.evaluate(() => window.startedTask)).toEqual({prompt:'Continue research',title:'原始项目任务：Collect and triage the core DKD literature set'});
      await page.evaluate(() => {window.showCompact(true);window.showProvider('pi');});
      await page.evaluate(() => window.showSession('empty'));
      expect(await session.count()).toBe(0);
      expect(await project.count()).toBe(1);
      expect(stateRequests).toEqual([]);
    } finally { await browser.close(); }
  }, 30000);
});
