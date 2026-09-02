import { describe, expect, it } from 'vitest';

const browserSuite = process.env.MEDHELP_BROWSER_TESTS === '1' ? describe : describe.skip;
browserSuite('project trash settings', () => {
  it('lists projects only and restores/deletes the identified project through project endpoints', async () => {
    const { build } = await import('esbuild');
    const { chromium } = await import('playwright');
    const { fileURLToPath } = await import('node:url');
    const bundled = await build({
      stdin: {
        resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx',
        contents: `
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import { createInstance } from 'i18next';
          import { I18nextProvider } from 'react-i18next';
          import common from './src/i18n/locales/zh-CN/common.json';
          import sidebar from './src/i18n/locales/zh-CN/sidebar.json';
          import settings from './src/i18n/locales/zh-CN/settings.json';
          import TrashSettingsContent from './src/components/settings/TrashSettingsContent';
          const i18n = createInstance();
          i18n.init({lng:'zh-CN', resources:{'zh-CN':{common, sidebar, settings}}}).then(() =>
            createRoot(document.getElementById('root')).render(<I18nextProvider i18n={i18n}><TrashSettingsContent /></I18nextProvider>)
          );
        `,
      },
      bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
      plugins: [{ name: 'isolated-trash-api', setup(builder) {
        builder.onResolve({ filter: /\/utils\/api$/ }, (args) => ({ path: args.path, namespace: 'fixture-api' }));
        builder.onLoad({ filter: /.*/, namespace: 'fixture-api' }, () => ({ contents: `export const api = {
          trashedProjects: () => fetch('/api/projects/trash'),
          trashedSessions: () => fetch('/api/projects/trash/sessions'),
          restoreProject: name => fetch('/api/projects/trash/' + encodeURIComponent(name) + '/restore', {method:'POST'}),
          deleteTrashedProject: (name, mode) => fetch('/api/projects/trash/' + encodeURIComponent(name) + '?mode=' + mode, {method:'DELETE'}),
        };` }));
      } }],
    });
    const browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ channel: 'chrome', headless: true }));
    const requests = [];
    let failRefresh = false;
    let projects = ['one', 'two'].map(name => ({
      name, displayName: '同名项目', originalPath: '/original/' + name, fullPath: '/original/' + name,
      trashedAt: '2026-08-28T00:00:00Z', sessionCount: 3, canRestore: true, filesExist: true,
    }));
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        const method = route.request().method();
        if (url.pathname.startsWith('/api/')) {
          requests.push({ path: url.pathname + url.search, method });
          if (url.pathname === '/api/projects/trash') {
            return route.fulfill({ status: failRefresh ? 500 : 200, json: failRefresh ? { error: 'unavailable' } : projects });
          }
          if (method === 'POST' || method === 'DELETE') {
            const name = url.pathname.split('/')[4];
            projects = projects.filter(project => project.name !== name);
            return route.fulfill({ json: { success: true } });
          }
          return route.fulfill({ status: 500, json: { error: 'Session list must not be requested' } });
        }
        return route.fulfill(url.pathname === '/fixture.js'
          ? { contentType: 'application/javascript', body: bundled.outputFiles[0].text }
          : { contentType: 'text/html', body: '<div id="root"></div><script src="/fixture.js"></script>' });
      });
      await page.goto('http://project-trash.test');
      await page.getByText('/original/one', { exact: true }).waitFor();
      expect(await page.getByRole('heading', { name: '同名项目' }).count()).toBe(2);
      expect(requests).toEqual([{ path: '/api/projects/trash', method: 'GET' }]);

      failRefresh = true;
      await page.getByRole('button', { name: '刷新', exact: true }).click();
      await page.getByRole('alert').waitFor();
      expect(await page.getByRole('heading', { name: '同名项目' }).count()).toBe(2);
      failRefresh = false;
      await page.getByText('/original/one', { exact: true }).locator('..').locator('..').getByRole('button', { name: '恢复项目', exact: true }).click();
      await page.getByText('/original/one', { exact: true }).waitFor({ state: 'hidden' });
      await page.getByRole('alert').waitFor({ state: 'hidden' });
      expect(requests).toContainEqual({ path: '/api/projects/trash/one/restore', method: 'POST' });
      await page.getByRole('button', { name: '从回收站移除', exact: true }).click();
      expect(requests.filter(request => request.method === 'DELETE')).toHaveLength(0);
      await page.getByRole('button', { name: '仅删除记录', exact: true }).click();
      await page.getByRole('heading', { name: '回收站为空' }).waitFor();
      expect(requests.filter(request => request.method !== 'GET')).toEqual([
        { path: '/api/projects/trash/one/restore', method: 'POST' },
        { path: '/api/projects/trash/two?mode=logical', method: 'DELETE' },
      ]);
    } finally {
      await browser.close();
    }
  }, 20000);
});
