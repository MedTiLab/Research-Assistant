import express from 'express';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createAgentServicesRouter } from '../routes/agent-services.js';
import { addPermissionPresets, hasPermissionRule } from '../agent-runtime/permission-rules.js';
import { readServiceState, serviceStatePath } from '../agent-runtime/durable-store.js';
import { PI_PERMISSION_PRESETS } from '../../shared/piPermissionPresets.js';

const browserSuite = process.env.MEDHELP_BROWSER_TESTS === '1' ? describe : describe.skip;
browserSuite('Pi command presets in settings', () => {
  it('adds one or all, persists, revokes, handles failures and isolates project switches', async () => {
    const { build } = await import('esbuild');
    const { chromium } = await import('playwright');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-pi-presets-'));
    const storageOptions = { dataDir: root };
    const identity = { ownerKey: 'fixture', projectKey: 'one', runtimeId: 'pi', sessionId: 'session' };
    let browser, server, releaseSlow;
    try {
      const bundled = await build({
        stdin: {
          resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx',
          contents: `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import AgentServicesSettings from './src/components/settings/AgentServicesSettings';
            createRoot(document.getElementById('root')).render(<AgentServicesSettings
              initialSection="permissions" projects={['one', 'two', 'slow'].map(name => ({name}))} />);
          `,
        },
        bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
        plugins: [{ name: 'fixture-auth', setup(builder) {
          builder.onResolve({ filter: /\/utils\/api$/ }, (args) => ({ path: args.path, namespace: 'fixture-auth' }));
          builder.onLoad({ filter: /.*/, namespace: 'fixture-auth' }, () => ({ contents: `
            export const authenticatedFetch = (url, options = {}) => fetch(url, {
              ...options, headers: {'content-type': 'application/json', ...options.headers}
            });
          ` }));
        } }],
      });
      let failAdd = false, failList = false;
      const mutations = [];
      const app = express(); app.use(express.json());
      app.get('/', (_req, res) => res.send('<div id="root"></div><script src="/fixture.js"></script>'));
      app.get('/fixture.js', (_req, res) => res.type('js').send(bundled.outputFiles[0].text));
      app.use('/api/agent-services', async (req, res, next) => {
        req.user = { id: identity.ownerKey };
        if (req.method === 'POST') {
          mutations.push({ project: req.query.projectKey, body: req.body });
          if (failAdd) return res.status(500).json({ error: '保存失败，请重试' });
        }
        if (req.method === 'GET' && req.path === '/permissions') {
          if (failList) return res.status(500).json({ error: '加载失败，请重试' });
          if (req.query.projectKey === 'slow') {
            const rows = await readServiceState(serviceStatePath({ ...identity, projectKey: 'slow' }, 'permissions', storageOptions));
            releaseSlow = () => { if (!res.writableEnded) res.json(rows); };
            return;
          }
        }
        next();
      }, createAgentServicesRouter({ services: {}, storageOptions }));
      server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ channel: 'chrome', headless: true }));
      const page = await browser.newPage(); page.setDefaultTimeout(5000);
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const addAll = () => page.getByRole('button', { name: '一次添加全部', exact: true });
      const addStatus = page.getByRole('button', { name: '添加 git status', exact: true });
      await expect.poll(() => addAll().isEnabled()).toBe(true);
      expect(mutations).toEqual([]);
      expect(await page.getByRole('group', { name: '快速添加常用命令' }).getByRole('button').count()).toBe(PI_PERMISSION_PRESETS.length + 1);

      await page.getByRole('combobox', { name: '项目' }).selectOption('');
      await page.getByText('请先选择项目').waitFor();
      expect(await addAll().isDisabled()).toBe(true);
      await page.getByRole('combobox', { name: '项目' }).selectOption('one');
      await expect.poll(() => addStatus.isEnabled()).toBe(true);
      failAdd = true;
      await addStatus.click(); await page.getByRole('alert').waitFor();
      expect(await addStatus.isEnabled()).toBe(true);
      expect(await page.getByRole('button', { name: '撤销', exact: true }).count()).toBe(0);
      failAdd = false;
      await addStatus.click();
      await expect.poll(() => page.getByRole('button', { name: '撤销', exact: true }).count()).toBe(1);
      await expect.poll(() => page.getByRole('combobox', { name: '项目' }).isEnabled()).toBe(true);
      expect(await addStatus.isDisabled()).toBe(true);
      expect(await hasPermissionRule(identity, 'bash', { command: 'git status', timeout: 1000 }, storageOptions)).toBe(true);
      await addAll().click();
      await page.getByRole('button', { name: '已全部添加', exact: true }).waitFor();
      expect(mutations.at(-1)).toEqual({ project: 'one', body: { presetIds: PI_PERMISSION_PRESETS.filter(preset => preset.id !== 'git-status').map(preset => preset.id) } });
      expect(await page.getByRole('button', { name: '撤销', exact: true }).count()).toBe(PI_PERMISSION_PRESETS.length);
      await page.reload();
      await page.getByRole('button', { name: '已全部添加', exact: true }).waitFor();
      await page.getByText('git status', { exact: true }).locator('../..').getByRole('button', { name: '撤销', exact: true }).click();
      await expect.poll(() => addStatus.isEnabled()).toBe(true);
      expect(await hasPermissionRule(identity, 'bash', { command: 'git status' }, storageOptions)).toBe(false);

      await addPermissionPresets({ ...identity, projectKey: 'slow' }, ['git-status'], storageOptions);
      await page.getByRole('combobox', { name: '项目' }).selectOption('slow');
      await expect.poll(() => Boolean(releaseSlow)).toBe(true);
      expect(await addAll().isDisabled()).toBe(true);
      await page.getByRole('combobox', { name: '项目' }).selectOption('two');
      await expect.poll(() => addAll().isEnabled()).toBe(true);
      const slowResponse = page.waitForResponse(response => response.url().includes('projectKey=slow'));
      releaseSlow(); await slowResponse;
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(await page.getByRole('button', { name: '撤销', exact: true }).count()).toBe(0);
      expect(await addStatus.isEnabled()).toBe(true);
      failList = true; await page.reload();
      await page.getByRole('alert').waitFor();
      expect(await addAll().isDisabled()).toBe(true);
      failList = false;
      await page.getByRole('button', { name: '刷新', exact: true }).click();
      await expect.poll(() => addAll().isEnabled()).toBe(true);
    } finally {
      releaseSlow?.();
      await browser?.close();
      if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30000);
});
