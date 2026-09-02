import express from 'express';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentServicesRouter } from '../routes/agent-services.js';
import { createPiResourcesRouter } from '../routes/pi-resources.js';

const servers = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); })));
});
async function serve(router, { local = false } = {}) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { if (local) req.localKernelSession = { userId: 'local-user' }; else req.user = { id: 'cloud-user' }; next(); });
  app.use(router);
  const server = app.listen(0, '127.0.0.1'); servers.push(server);
  await new Promise(resolve => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

describe('Pi MCP settings routes', () => {
  it.each([true, false])('preserves owner, project and storage scope for local=%s', async (local) => {
    const integrations = {
      list: vi.fn(async () => [{ id: 'remote', url: 'https://example.com/mcp' }]),
      configure: vi.fn(async () => ({ id: 'remote' })),
      remove: vi.fn(async () => ({ success: true })),
      execute: vi.fn(async () => ({ tools: [{ name: 'search' }] })),
    };
    const storageOptions = { dataDir: '/fixture' };
    const base = await serve(createAgentServicesRouter({ services: { integrations }, storageOptions }), { local });
    const scope = { userId: local ? 'local-user' : 'cloud-user', identity: expect.objectContaining({ ownerKey: local ? 'local-user' : 'cloud-user', projectKey: 'project-a' }), storageOptions, settingsScope: 'local' };
    expect((await fetch(`${base}/integrations?projectKey=project-a`)).status).toBe(200);
    expect(integrations.list).toHaveBeenCalledWith(scope, { includeConfig: true });
    expect((await fetch(`${base}/integrations?projectKey=project-a`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'remote' }) })).status).toBe(200);
    expect(integrations.configure).toHaveBeenCalledWith({ id: 'remote' }, scope);
    expect(await (await fetch(`${base}/integrations/remote/tools?projectKey=project-a`)).json()).toMatchObject({ tools: [{ name: 'search' }] });
    expect(integrations.execute).toHaveBeenCalledWith('integration_tools', { integration_id: 'remote' }, scope);
    expect((await fetch(`${base}/integrations/remote?projectKey=project-a`, { method: 'DELETE' })).status).toBe(200);
    expect(integrations.remove).toHaveBeenCalledWith('remote', scope);
    expect((await fetch(`${base}/integrations`)).status).toBe(400);
    expect((await fetch(`${base}/integrations?scope=user`)).status).toBe(200);
    expect(integrations.list).toHaveBeenLastCalledWith(expect.objectContaining({
      settingsScope: 'user', identity: expect.objectContaining({ projectKey: '__medhelp_user_global__' }),
    }), { includeConfig: true });
  });
  it('exposes automation create, update, manual run and delete operations', async () => {
    const execute = vi.fn(async (name, input) => ({ id: input.automation_id || 'automation-1', title: input.title, status: name === 'automation_delete' ? undefined : 'active', success: name === 'automation_delete' }));
    const base = await serve(createAgentServicesRouter({ services: { automations: { execute } } }), { local: true });
    const url = (suffix = '') => `${base}/automations${suffix}?projectKey=project-a`;
    const request = (suffix, method, body) => fetch(url(suffix), { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const model = { modelId: 'provider/alpha', modelProviderId: 'byok-openai-compatible', modelApi: 'openai-completions' };
    expect((await request('', 'POST', { title: 'Daily digest', prompt: 'Summarize updates', at: '2030-01-01T00:00:00Z', intervalMinutes: 1440, model })).status).toBe(201);
    expect((await request('/automation-1', 'PATCH', { title: 'Morning digest', prompt: 'Summarize the latest updates', at: '2030-01-02T08:00:00Z', intervalMinutes: 10080, model, status: 'paused' })).status).toBe(200);
    expect((await request('/automation-1/run', 'POST')).status).toBe(202);
    expect((await request('/automation-1', 'DELETE')).status).toBe(200);
    expect(execute.mock.calls.map(([name]) => name)).toEqual(['automation_create', 'automation_update', 'automation_run', 'automation_delete']);
    expect(execute).toHaveBeenNthCalledWith(1, 'automation_create', expect.objectContaining({ interval_minutes: 1440 }), expect.objectContaining({
      userId: 'local-user', identity: expect.objectContaining({ ownerKey: 'local-user', projectKey: 'project-a' }),
    }));
    expect(execute).toHaveBeenNthCalledWith(2, 'automation_update', expect.objectContaining({
      title: 'Morning digest', prompt: 'Summarize the latest updates', at: '2030-01-02T08:00:00Z', interval_minutes: 10080, model,
    }), expect.anything());
  });
  it('reports validated resources without private paths or secrets and respects disabled flags', async () => {
    const resolveMcp = vi.fn(async () => ({ servers: [{ name: 'tools', version: '1.0.0', server: { env: { TOKEN: 'secret' } } }], diagnostics: [], secretValues: ['secret'] }));
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-mcp-access-'));
    const base = await serve(createPiResourcesRouter({ resolveMcp, storageOptions: { dataDir } }), { local: true });
    const body = await (await fetch(`${base}/resources`)).json();
    expect(body).toMatchObject({ bundles: [{ name: 'tools' }], nativeExtensions: { supported: false, globalConfigLoaded: false } });
    expect(body.mcpPlugins).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'medhelp_workbench', allowed: true, kind: 'builtin' }),
      expect.objectContaining({ id: 'tools', allowed: false, kind: 'bundle' }),
    ]));
    expect(body).not.toHaveProperty('skills');
    expect(JSON.stringify(body)).not.toMatch(/secret|\/private/);
    const allowed = await fetch(`${base}/resources/mcp-access/medhelp_workbench`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ allowed: true }),
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ id: 'medhelp_workbench', allowed: true });
    expect(await (await fetch(`${base}/resources`)).json()).toMatchObject({
      mcpPlugins: expect.arrayContaining([expect.objectContaining({ id: 'medhelp_workbench', allowed: true })]),
    });
    expect((await fetch(`${base}/resources/mcp-access/not-installed`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ allowed: true }),
    })).status).toBe(404);
    expect(resolveMcp).toHaveBeenCalledWith({ dataDir });
    await fs.rm(dataDir, { recursive: true, force: true });
  });
});

const browserSuite = process.env.MEDHELP_BROWSER_TESTS === '1' ? describe : describe.skip;
browserSuite('Pi MCP and plugins settings UI', () => {
  it('imports, tests, inspects tools, edits, disables, deletes and navigates real resource views', async () => {
    const { build } = await import('esbuild');
    const { chromium } = await import('playwright');
    const { fileURLToPath } = await import('node:url');
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-pi-mcp-ui-'));
    let browser;
    try {
      const bundled = await build({
        stdin: { resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx', contents: `
          import React from 'react'; import { createRoot } from 'react-dom/client';
          import i18n from 'i18next'; import { initReactI18next } from 'react-i18next';
          import settings from './src/i18n/locales/zh-CN/settings.json';
          import PiMcpSettings from './src/components/settings/PiMcpSettings';
          i18n.use(initReactI18next).init({lng:'zh-CN',resources:{'zh-CN':{settings}}});
          function App() { return <PiMcpSettings projects={[{name:'one'},{name:'two'},{name:'slow'}]} />; }
          createRoot(document.getElementById('root')).render(<App />);
        ` },
        bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
        plugins: [{ name: 'fixture-auth', setup(builder) {
          builder.onResolve({ filter: /\/utils\/api$/ }, args => ({ path: args.path, namespace: 'fixture-auth' }));
          builder.onLoad({ filter: /.*/, namespace: 'fixture-auth' }, () => ({ contents: 'export const authenticatedFetch = (url, options) => fetch(url, options);' }));
        } }],
      });
      const records = new Map(); const mutations = []; const pluginAccess = new Map(); let failList = false;
      const app = express(); app.use(express.json());
      app.get('/', (_req, res) => res.send('<div id="root"></div><script src="/fixture.js"></script>'));
      app.get('/fixture.js', (_req, res) => res.type('js').send(bundled.outputFiles[0].text));
      app.get('/api/pi/resources', (_req, res) => res.json({ mcpEnabled: true, bundles: [], mcpPlugins: [
        { id: 'medhelp_workbench', version: 'builtin', kind: 'builtin', allowed: pluginAccess.get('medhelp_workbench') !== false },
        { id: 'medhelp_compute', version: 'builtin', kind: 'builtin', allowed: pluginAccess.get('medhelp_compute') === true },
      ], nativeExtensions: { supported: false }, diagnostics: { mcp: [] } }));
      app.put('/api/pi/resources/mcp-access/:id', (req, res) => { pluginAccess.set(req.params.id, req.body.allowed === true); res.json({ success: true, id: req.params.id, allowed: req.body.allowed === true }); });
      app.use('/api/pi/services', (req, _res, next) => { req.user = { id: 'fixture' }; next(); }, createAgentServicesRouter({ services: { integrations: {
        list: async context => {
          if (failList) throw new Error('Fixture list failed');
          return records.get(context.identity.projectKey) || [];
        },
        configure: async (input, context) => {
          mutations.push(input);
          const key = context.identity.projectKey;
          records.set(key, [...(records.get(key) || []).filter(entry => entry.id !== input.id), { ...input, type: 'http', installed: false, status: input.enabled ? 'disconnected' : 'disabled' }]);
          return { status: 'configured' };
        },
        remove: async (id, context) => { records.set(context.identity.projectKey, (records.get(context.identity.projectKey) || []).filter(entry => entry.id !== id)); return { success: true }; },
        execute: async (name) => name === 'mcp_authorize' ? { authorizationUrl: 'https://auth.example/authorize', status: 'needs_authorization' } : { status: 'connected', tools: [{ name: 'search_papers', description: 'Find papers', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }] },
      } } }));
      const server = app.listen(0, '127.0.0.1'); servers.push(server);
      await new Promise(resolve => server.once('listening', resolve));
      browser = await chromium.launch({ headless: true }).catch(() => chromium.launch({ channel: 'chrome', headless: true }));
      const page = await browser.newPage(); page.setDefaultTimeout(5000);
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const button = name => page.getByRole('button', { name, exact: true });
      await expect.poll(() => button('刷新').isEnabled()).toBe(true);
      const workbenchCard = page.getByRole('article', { name: 'medhelp_workbench', exact: true });
      await workbenchCard.getByText('科研工作台', { exact: true }).waitFor();
      expect(await page.getByRole('article').first().getAttribute('aria-label')).toBe('medhelp_workbench');
      expect(await workbenchCard.getByRole('switch').getAttribute('aria-checked')).toBe('true');
      await workbenchCard.getByRole('switch').click();
      await expect.poll(() => workbenchCard.getByRole('switch').getAttribute('aria-checked')).toBe('false');
      await workbenchCard.getByRole('switch').click();
      await expect.poll(() => workbenchCard.getByRole('switch').getAttribute('aria-checked')).toBe('true');
      await button('添加 MCP').click(); await button('导入 JSON').click();
      await page.getByRole('textbox', { name: '导入 JSON' }).fill('{"mcpServers":{"papers":{"url":"https://example.com/mcp"}}}');
      await button('解析并检查').click();
      expect(await page.getByRole('textbox', { name: '连接名称', exact: true }).inputValue()).toBe('papers');
      expect(mutations).toEqual([]);
      await button('保存连接').click();
      const card = page.getByRole('article', { name: 'papers', exact: true }); await card.waitFor();
      await card.getByText('用户级', { exact: true }).waitFor();
      await card.getByRole('switch').click();
      await card.getByRole('button', { name: '测试连接', exact: true }).click();
      await card.getByText('连接成功', { exact: true }).waitFor();
      await card.getByText('search_papers', { exact: true }).waitFor();
      await card.getByRole('button', { name: '编辑', exact: true }).click();
      expect(await page.getByRole('textbox', { name: '连接名称', exact: true }).isDisabled()).toBe(true);
      await page.getByRole('textbox', { name: 'MCP HTTPS 地址' }).fill('https://new.example/mcp');
      await button('保存连接').click(); await card.getByText('https://new.example/mcp', { exact: true }).waitFor();
      await card.getByRole('switch').click();
      await expect.poll(() => card.getByRole('switch').getAttribute('aria-checked')).toBe('false');
      expect(await card.getByRole('button', { name: '测试连接' }).isDisabled()).toBe(true);
      await card.getByRole('switch').click();
      await card.getByRole('button', { name: '授权', exact: true }).click();
      expect(await page.getByRole('link').getAttribute('href')).toBe('https://auth.example/authorize');
      await button('添加 MCP').click(); await button('项目级').click();
      await page.getByRole('combobox', { name: '项目' }).selectOption('one');
      await page.getByRole('textbox', { name: '连接名称', exact: true }).fill('local-tools');
      await page.getByRole('textbox', { name: 'MCP HTTPS 地址' }).fill('https://local.example/mcp');
      await button('保存连接').click();
      const localCard = page.getByRole('article', { name: 'local-tools', exact: true });
      await localCard.getByText('项目级', { exact: true }).waitFor();
      await localCard.getByText('one', { exact: true }).waitFor();
      expect(await page.getByRole('article').count()).toBe(4);
      page.once('dialog', dialog => dialog.accept());
      await card.getByRole('button', { name: '删除', exact: true }).click();
      await expect.poll(() => page.getByRole('article').count()).toBe(3);
      await localCard.waitFor();
      failList = true; await button('刷新').click(); await page.getByRole('alert').waitFor();
      failList = false; await button('刷新').click(); await expect.poll(() => page.getByRole('alert').count()).toBe(0);
      await page.reload(); await button('添加 MCP').click(); await button('离线包').click();
      expect(await button('安装离线包').isDisabled()).toBe(true);
      await page.getByLabel('选择 MCP 离线包').setInputFiles({ name: 'sample.mcpb', mimeType: 'application/zip', buffer: Buffer.from('fixture') });
      expect(await button('安装离线包').isDisabled()).toBe(true);
      await page.getByRole('checkbox').check(); expect(await button('安装离线包').isEnabled()).toBe(true);
      await button('关闭').click(); await button('添加 MCP').click(); await button('离线包').click();
      expect(await button('安装离线包').isDisabled()).toBe(true);
      expect(await page.getByRole('checkbox').isChecked()).toBe(false);
    } finally { await browser?.close(); await fs.rm(root, { recursive: true, force: true }); }
  }, 30000);
});
