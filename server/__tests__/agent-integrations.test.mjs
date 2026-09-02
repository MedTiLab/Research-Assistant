import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../agent-runtime/public-web.js', () => ({ publicFetch: vi.fn(), resolvePublicUrl: async (value) => ({ url: new URL(value) }) }));
import { createAgentIntegrations, PI_GLOBAL_INTEGRATIONS_PROJECT_KEY } from '../agent-runtime/integrations.js';
import { readServiceState, serviceStatePath } from '../agent-runtime/durable-store.js';
import { setPiMcpAccess } from '../pi-runtime/mcp-access.js';

let root, context, service;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-integrations-'));
  context = { identity: { ownerKey: 'one', projectKey: 'project', sessionId: 's', runtimeId: 'pi' }, projectRoot: root, storageOptions: { dataDir: root }, resourceProjection: { mcpServers: [] } };
});
afterEach(async () => { await service?.shutdown(); await fs.rm(root, { recursive: true, force: true }); });

describe('MCP connection lifecycle', () => {
  it('denies installed MCP bundles until the user explicitly allows access', async () => {
    service = createAgentIntegrations();
    await expect(service.configure({ id: 'medhelp_workbench', url: 'https://example.com/mcp' }, context))
      .rejects.toThrow('reserved');
    await service.configure({ id: 'remote-default', url: 'https://example.com/mcp' }, context);
    expect(await service.list(context)).toContainEqual(expect.objectContaining({
      id: 'remote-default', enabled: false, status: 'disabled',
    }));
    await service.remove('remote-default', context);
    const installed = {
      ...context,
      resourceProjection: {
        mcpServers: [{ name: 'builtin', version: '1.0.0', server: { type: 'stdio', command: '/node', args: [], env: {} } }],
      },
    };
    expect(await service.list(installed)).toContainEqual(expect.objectContaining({
      id: 'builtin', enabled: false, status: 'disabled',
    }));
    await expect(service.execute('integration_tools', { integration_id: 'builtin' }, installed)).rejects.toThrow('disabled');
    await setPiMcpAccess('builtin', true, { userId: 'one', storageOptions: context.storageOptions });
    expect(await service.list(installed)).toContainEqual(expect.objectContaining({
      id: 'builtin', enabled: true, status: 'disconnected',
    }));
  });

  it('merges user-scoped connections into every project and lets project scope shadow them', async () => {
    service = createAgentIntegrations({ makeClient: () => ({ connect: async () => {}, close: async () => {}, listTools: async () => ({ tools: [] }) }), makeHttp: () => ({}) });
    const globalContext = { ...context, identity: { ...context.identity, projectKey: PI_GLOBAL_INTEGRATIONS_PROJECT_KEY } };
    await service.configure({ id: 'shared', url: 'https://global.example/mcp', enabled: true }, globalContext);
    expect(await service.execute('integration_list', {}, context)).toEqual([
      expect.objectContaining({ id: 'shared' }),
    ]);
    const otherProject = { ...context, identity: { ...context.identity, projectKey: 'other-project' } };
    expect(await service.execute('integration_list', {}, otherProject)).toEqual([
      expect.objectContaining({ id: 'shared' }),
    ]);
    await service.execute('integration_tools', { integration_id: 'shared' }, otherProject);
    await service.configure({ id: 'shared', url: 'https://local.example/mcp', enabled: true }, context);
    expect(await service.list(context, { includeConfig: true })).toContainEqual(expect.objectContaining({ url: 'https://local.example/mcp', status: 'disconnected' }));
    expect(await service.list(otherProject, { includeConfig: true })).toContainEqual(expect.objectContaining({ url: 'https://global.example/mcp', status: 'connected' }));
  });
  it('waits for an in-progress disable before accepting new connections', async () => {
    let releaseClose;
    const connect = vi.fn(async () => {});
    service = createAgentIntegrations({ makeClient: () => ({
      connect, close: () => new Promise(resolve => { releaseClose = resolve; }), listTools: async () => ({ tools: [] }),
    }), makeHttp: () => ({}) });
    await service.configure({ id: 'remote', url: 'https://remote.example/mcp', enabled: true }, context);
    await service.execute('integration_tools', { integration_id: 'remote' }, context);
    const disable = service.configure({ id: 'remote', url: 'https://remote.example/mcp', enabled: false }, context);
    await vi.waitFor(() => expect(releaseClose).toBeTypeOf('function'));
    const next = service.execute('integration_tools', { integration_id: 'remote' }, context).catch(error => error);
    releaseClose(); await disable;
    expect((await next).message).toContain('disabled');
    expect(connect).toHaveBeenCalledTimes(1);
  });
  it('edits, disables and deletes only project-owned connections, clearing OAuth credentials', async () => {
    service = createAgentIntegrations();
    await service.configure({ id: 'remote', url: 'https://remote.example/mcp', enabled: true }, context);
    const { mutateServiceState } = await import('../agent-runtime/durable-store.js');
    const oauthFile = serviceStatePath(context.identity, 'oauth', context.storageOptions);
    await mutateServiceState(oauthFile, () => ({ remote: { tokens: { access_token: 'old-token' }, client: { client_secret: 'old-client' } } }), {});
    await service.configure({ id: 'remote', url: 'https://new.example/mcp', enabled: false }, context);
    expect(await readServiceState(oauthFile, {})).toEqual({});
    expect(await service.list(context, { includeConfig: true })).toEqual([
      expect.objectContaining({ id: 'remote', url: 'https://new.example/mcp', enabled: false, status: 'disabled' }),
    ]);
    expect(JSON.stringify(await service.execute('integration_list', {}, context))).not.toContain('https://new.example');
    await expect(service.execute('integration_tools', { integration_id: 'remote' }, context)).rejects.toThrow('disabled');
    await service.remove('remote', { ...context, identity: { ...context.identity, projectKey: 'other' } });
    expect(await service.execute('integration_list', {}, context)).toHaveLength(1);
    await service.remove('remote', context);
    expect(await service.execute('integration_list', {}, context)).toEqual([]);
    const installed = { ...context, resourceProjection: { mcpServers: [{ name: 'builtin', server: { type: 'stdio', command: '/node', env: { SECRET: 'do-not-expose' } } }] } };
    await expect(service.configure({ id: 'builtin', url: 'https://new.example/mcp' }, installed)).rejects.toThrow('already uses this name');
    await expect(service.remove('builtin', installed)).rejects.toThrow('cannot be deleted');
    expect(JSON.stringify(await service.execute('integration_list', {}, installed))).not.toContain('do-not-expose');
  });
  it('does not retain an in-flight connection after deletion', async () => {
    let release;
    const close = vi.fn(async () => {});
    service = createAgentIntegrations({ makeClient: () => ({ connect: () => new Promise(resolve => { release = resolve; }), close }), makeHttp: () => ({}) });
    await service.configure({ id: 'remote', url: 'https://remote.example/mcp', enabled: true }, context);
    const pending = service.execute('integration_tools', { integration_id: 'remote' }, context).catch(error => error);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await service.remove('remote', context);
    release();
    expect(await pending).toBeInstanceOf(Error);
    expect(close).toHaveBeenCalled();
    expect(await service.execute('integration_list', {}, context)).toEqual([]);
  });
  it('loads tool schemas only when requested, reconnects, and never replays ambiguous mutations', async () => {
    const call = vi.fn(async () => ({ content: [{ type: 'text', text: 'done' }] }));
    const clients = [];
    const makeClient = () => { const client = { connect: vi.fn(async () => {}), close: vi.fn(async () => client.onclose?.()), listTools: vi.fn(async () => ({ tools: [{ name: 'send', inputSchema: { type: 'object' } }] })), callTool: call }; clients.push(client); return client; };
    service = createAgentIntegrations({ makeClient, makeHttp: () => ({}) });
    await service.configure({ id: 'remote', url: 'https://remote.example/mcp', enabled: true }, context);
    expect(await service.execute('integration_list', {}, context)).toEqual([expect.objectContaining({ id: 'remote', status: 'disconnected' })]);
    expect(clients).toHaveLength(0);
    await service.execute('integration_tools', { integration_id: 'remote' }, context);
    expect(clients[0].listTools).toHaveBeenCalledTimes(1);
    expect(await service.execute('integration_call', { integration_id: 'remote', tool: 'send', arguments: { value: 'hello' } }, context)).toMatchObject({ text: 'done' });
    call.mockRejectedValueOnce(Object.assign(new Error('lost after dispatch'), { code: 'ECONNRESET' }));
    await expect(service.execute('integration_call', { integration_id: 'remote', tool: 'send', arguments: {} }, context)).rejects.toThrow('outcome may be unknown');
    expect(call).toHaveBeenCalledTimes(2);
    await service.execute('mcp_reconnect', { integration_id: 'remote' }, context);
    expect(clients).toHaveLength(2);
    expect(call).toHaveBeenCalledTimes(2);
    await expect(service.execute('integration_call', { integration_id: 'remote', tool: 'unknown', arguments: {} }, context)).rejects.toThrow('Discover');
    await expect(service.execute('integration_tools', { integration_id: 'remote' }, { ...context, identity: { ...context.identity, ownerKey: 'two' } })).rejects.toThrow('not configured');
  });
  it('supports PKCE/state authorization, token reuse, explicit reauthorization and replay rejection', async () => {
    let lastState;
    const makeHttp = (_url, { authProvider }) => ({ authProvider, finishAuth: async (code) => { expect(code).toBe('valid-code'); expect(await authProvider.codeVerifier()).toBe('secret-verifier'); await authProvider.saveTokens({ access_token: 'private-token', token_type: 'Bearer' }); } });
    const makeClient = () => ({
      connect: async (transport) => {
        const provider = transport.authProvider;
        if (await provider.tokens()) return;
        lastState = await provider.state();
        await provider.saveCodeVerifier('secret-verifier');
        await provider.redirectToAuthorization(new URL(`https://auth.example/authorize?state=${lastState}`));
        throw new Error('Unauthorized');
      }, close: async () => {},
    });
    service = createAgentIntegrations({ makeClient, makeHttp });
    await service.configure({ id: 'oauth', url: 'https://remote.example/mcp', enabled: true }, context);
    const started = await service.execute('mcp_authorize', { integration_id: 'oauth' }, context);
    expect(started).toMatchObject({ status: 'needs_authorization', authorizationUrl: expect.stringContaining(lastState) });
    const state = lastState;
    await expect(service.completeOAuth({ state: 'wrong', code: 'valid-code' })).rejects.toThrow('expired');
    expect(await service.completeOAuth({ state, code: 'valid-code' })).toMatchObject({ status: 'connected' });
    await expect(service.completeOAuth({ state, code: 'valid-code' })).rejects.toThrow('expired');
    expect(JSON.stringify(await service.execute('integration_list', {}, context))).not.toContain('private-token');
    const saved = await readServiceState(serviceStatePath(context.identity, 'oauth', context.storageOptions), {});
    expect(saved.oauth.tokens.access_token).toBe('private-token');
    const stat = await fs.stat(serviceStatePath(context.identity, 'oauth', context.storageOptions));
    expect(stat.mode & 0o777).toBe(0o600);
    expect(await service.execute('mcp_authorize', { integration_id: 'oauth', reauthorize: true }, context)).toMatchObject({ status: 'needs_authorization' });
    expect(lastState).not.toBe(state);
  });
});
