import crypto from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { resolveTrustedPiMcpServers } from '../pi-runtime/mcp-projection.js';
import { mutateServiceState, readServiceState, serviceStatePath } from './durable-store.js';
import { publicFetch, resolvePublicUrl } from './public-web.js';
import { DEFAULT_BACKEND_PORT, parsePortNumber } from '../utils/runtimePorts.js';
import {
  PI_BUILTIN_MCP_PLUGINS,
  PI_MCP_ACCESS_PROJECT_KEY,
  isPiMcpAllowed,
  readPiMcpAccess,
} from '../pi-runtime/mcp-access.js';

const safeId = (id) => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,126}$/.test(id || '');
const reservedMcpIds = new Set(PI_BUILTIN_MCP_PLUGINS.map((plugin) => plugin.id));
export const PI_GLOBAL_INTEGRATIONS_PROJECT_KEY = PI_MCP_ACCESS_PROJECT_KEY;
export function createAgentIntegrations({ makeClient = () => new Client({ name: 'medhelp-agent-services', version: '1.0.0' }), makeStdio = (config) => new StdioClientTransport(config), makeHttp = (url, config) => new StreamableHTTPClientTransport(url, config) } = {}) {
  const connections = new Map();
  const connecting = new Map();
  const pendingOAuth = new Map();
  const revisions = new Map();
  const mutations = new Map();
  const keyFor = (context, id) => JSON.stringify([context.identity.ownerKey, context.identity.projectKey, id]);
  const mutateConfig = (key, action) => {
    const operation = (mutations.get(key) || Promise.resolve()).then(action);
    const settled = operation.then(() => undefined, () => undefined);
    mutations.set(key, settled);
    settled.finally(() => { if (mutations.get(key) === settled) mutations.delete(key); });
    return operation;
  };
  const contextAt = (context, projectKey) => ({ ...context, identity: { ...context.identity, projectKey } });
  const savedConfigs = (context) => readServiceState(serviceStatePath(context.identity, 'integrations', context.storageOptions));
  const trustedServers = (context) => context.resourceProjection?.mcpServers
    || resolveTrustedPiMcpServers(context.storageOptions).then((projection) => projection.servers);
  const configs = async (context) => {
    const globalContext = contextAt(context, PI_GLOBAL_INTEGRATIONS_PROJECT_KEY);
    const [global, local, trusted, mcpAccess] = await Promise.all([
      savedConfigs(globalContext),
      context.identity.projectKey === PI_GLOBAL_INTEGRATIONS_PROJECT_KEY
        ? []
        : savedConfigs(context),
      trustedServers(context),
      readPiMcpAccess({ userId: context.identity.ownerKey, storageOptions: context.storageOptions || {} }),
    ]);
    const effective = new Map();
    const installedIds = new Set(trusted.map((entry) => entry.name));
    for (const entry of trusted.map(({ name, version, server }) => ({
      id: name,
      version,
      ...server,
      builtin: true,
      enabled: isPiMcpAllowed(mcpAccess, name),
      scopeProjectKey: PI_GLOBAL_INTEGRATIONS_PROJECT_KEY,
    }))) effective.set(entry.id, entry);
    for (const entry of global) if (!reservedMcpIds.has(entry.id) && !installedIds.has(entry.id)) effective.set(entry.id, { ...entry, scopeProjectKey: PI_GLOBAL_INTEGRATIONS_PROJECT_KEY });
    for (const entry of local) if (!reservedMcpIds.has(entry.id) && !installedIds.has(entry.id)) effective.set(entry.id, { ...entry, scopeProjectKey: context.identity.projectKey });
    return [...effective.values()];
  };
  const configContext = (context, config) => contextAt(context, config.scopeProjectKey || context.identity.projectKey);
  const close = async (key) => {
    const connection = connections.get(key);
    connections.delete(key);
    clearTimeout(connection?.timer);
    await connection?.client.close().catch(() => {});
  };
  const invalidate = async (context, id) => {
    const key = keyFor(context, id);
    revisions.set(key, (revisions.get(key) || 0) + 1);
    connecting.delete(key);
    for (const [state, pending] of pendingOAuth) {
      if (keyFor(pending.context, pending.id) === key) pendingOAuth.delete(state);
    }
    await close(key);
    await mutateServiceState(serviceStatePath(context.identity, 'oauth', context.storageOptions), (state) => {
      delete state[id];
      return state;
    }, {});
  };
  const oauthProvider = async (context, config, interactive = false, expectedRevision) => {
    const key = keyFor(context, config.id);
    const revision = expectedRevision ?? (revisions.get(key) || 0);
    const file = serviceStatePath(context.identity, 'oauth', context.storageOptions);
    const read = async () => {
      const state = await readServiceState(file, {});
      if ((revisions.get(key) || 0) !== revision) throw new Error('Integration configuration changed; connect again');
      return state[config.id] || {};
    };
    const update = (patch) => mutateServiceState(file, (state) => {
      if ((revisions.get(key) || 0) !== revision) throw new Error('Integration configuration changed; connect again');
      return { ...state, [config.id]: { ...state[config.id], ...patch } };
    }, {});
    const provider = {
      redirectUrl: config.redirectUri || `http://127.0.0.1:${globalThis.__MEDHELP_LOCAL_KERNEL_ADDRESS__?.port || parsePortNumber(process.env.PORT, DEFAULT_BACKEND_PORT)}/api/agent-services/oauth/callback`,
      get clientMetadata() { return { client_name: 'MedHelp', redirect_uris: [this.redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' }; },
      state: async () => {
        if (!interactive) throw new Error('Authorization required. Use mcp_authorize.');
        const state = crypto.randomBytes(32).toString('hex');
        const issuedAt = Date.now();
        for (const [key, pending] of pendingOAuth) if (issuedAt - pending.issuedAt > 600_000 || keyFor(pending.context, pending.id) === keyFor(context, config.id)) pendingOAuth.delete(key);
        pendingOAuth.set(state, { context, id: config.id, issuedAt });
        await update({ state, issuedAt });
        return state;
      },
      clientInformation: async () => (await read()).client,
      saveClientInformation: (client) => update({ client }),
      tokens: async () => (await read()).tokens,
      saveTokens: (tokens) => update({ tokens, state: null, verifier: null }),
      saveCodeVerifier: (verifier) => update({ verifier }),
      codeVerifier: async () => { const verifier = (await read()).verifier; if (!verifier) throw new Error('Authorization expired; start again'); return verifier; },
      redirectToAuthorization: async (url) => {
        if (!interactive) throw new Error('Authorization required. Use mcp_authorize.');
        await resolvePublicUrl(url);
        provider.authorizationUrl = String(url);
      },
      invalidateCredentials: async (scope) => {
        await update(scope === 'all' ? { client: null, tokens: null, verifier: null, state: null } : scope === 'client' ? { client: null } : scope === 'verifier' ? { verifier: null } : { tokens: null });
      },
    };
    return provider;
  };
  const connect = async (context, id, { interactive = false, callbackUrl = null, reauthorize = false } = {}) => {
    if (process.env.MEDHELP_PI_MCP_ENABLED === '0') throw new Error('MCP is disabled on this kernel');
    const lookupContext = context;
    let config = (await configs(lookupContext)).find((entry) => entry.id === id);
    if (!config) throw new Error('Integration is not configured for this project');
    context = configContext(context, config);
    const key = keyFor(context, id);
    while (mutations.has(key)) await mutations.get(key);
    config = (await configs(lookupContext)).find((entry) => entry.id === id);
    if (!config || keyFor(configContext(lookupContext, config), id) !== key) throw new Error('Integration configuration changed; connect again');
    const revision = revisions.get(key) || 0;
    if (config.enabled === false) throw new Error('Integration is disabled');
    if (connections.has(key) && !interactive) return connections.get(key);
    if (connecting.has(key)) return connecting.get(key);
    const operation = (async () => {
      await close(key);
      const client = makeClient();
      let authProvider;
      let transport;
      if (config.type === 'stdio') {
        if (!config.builtin) throw new Error('Local commands must be installed using the existing trusted MCP bundle installer');
        transport = makeStdio({ command: config.command, args: config.args, env: config.env, cwd: context.projectRoot, stderr: 'pipe' });
        transport.stderr?.resume?.();
      } else {
        await resolvePublicUrl(config.url);
        authProvider = await oauthProvider(context, config, interactive, revision);
        if (reauthorize) await authProvider.invalidateCredentials('tokens');
        transport = makeHttp(new URL(config.url), { authProvider, fetch: publicFetch, reconnectionOptions: { maxRetries: 2, initialReconnectionDelay: 1000, maxReconnectionDelay: 5000, reconnectionDelayGrowFactor: 2 } });
        if (callbackUrl) {
          const callback = new URL(callbackUrl);
          const state = callback.searchParams.get('state');
          const pending = pendingOAuth.get(state);
          const expected = new URL(authProvider.redirectUrl);
          if (!pending || pending.id !== id || keyFor(pending.context, id) !== key || Date.now() - pending.issuedAt > 600_000 || callback.origin !== expected.origin || callback.pathname !== expected.pathname || !callback.searchParams.get('code')) throw new Error('Invalid or expired OAuth callback');
          pendingOAuth.delete(state);
          await transport.finishAuth(callback.searchParams.get('code'));
        }
      }
      try {
        await client.connect(transport, { timeout: 15_000 });
        if ((revisions.get(key) || 0) !== revision) throw new Error('Integration configuration changed; connect again');
        const record = { client, transport, config, status: 'connected' };
        connections.set(key, record);
        client.onclose = () => { clearTimeout(record.timer); if (connections.get(key) === record) connections.delete(key); };
        record.timer = setTimeout(() => close(key).catch(() => {}), 15 * 60_000); record.timer.unref?.();
        return record;
      } catch (error) {
        await client.close().catch(() => {});
        if (authProvider?.authorizationUrl) return { status: 'needs_authorization', authorizationUrl: authProvider.authorizationUrl };
        throw new Error(`Integration connection failed: ${error.code || 'unavailable'}. Use mcp_reconnect or mcp_authorize.`);
      }
    })();
    connecting.set(key, operation);
    try { return await operation; } finally { if (connecting.get(key) === operation) connecting.delete(key); }
  };
  const service = {
    async list(context, { includeConfig = false } = {}) {
      const entries = context.settingsScope === 'local'
        ? (await savedConfigs(context)).map((entry) => ({ ...entry, scopeProjectKey: context.identity.projectKey }))
        : await configs(context);
      return Promise.all(entries.map(async (entry) => {
        const scopedContext = configContext(context, entry);
        const credentials = await readServiceState(serviceStatePath(scopedContext.identity, 'oauth', scopedContext.storageOptions), {});
        return {
          id: entry.id, type: entry.type, version: entry.version || undefined, installed: Boolean(entry.builtin), enabled: entry.enabled !== false,
          // Configuration is only returned to settings, not to model-visible tool output.
          ...(includeConfig && !entry.builtin ? { url: entry.url, redirectUri: entry.redirectUri } : {}),
          status: entry.enabled === false ? 'disabled' : connections.has(keyFor(scopedContext, entry.id)) ? 'connected' : credentials[entry.id]?.state ? 'needs_authorization' : 'disconnected',
        };
      }));
    },
    async configure(input, context) {
      if (!safeId(input.id)) throw new Error('Invalid integration id');
      if (reservedMcpIds.has(input.id)) throw new Error('This name is reserved for a built-in MCP plugin');
      return mutateConfig(keyFor(context, input.id), async () => {
        const existing = (await savedConfigs(context)).find((entry) => entry.id === input.id);
        const installed = (await trustedServers(context)).some((entry) => entry.name === input.id);
        if (installed) throw new Error('An installed MCP bundle already uses this name');
        if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('enabled must be a boolean');
        await resolvePublicUrl(input.url);
        if (!String(input.url).startsWith('https://')) throw new Error('Remote integrations require HTTPS');
        if (input.redirectUri) {
          const redirect = new URL(input.redirectUri);
          if (!(redirect.protocol === 'https:' || (redirect.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(redirect.hostname))) || redirect.username || redirect.password || redirect.search || redirect.hash || redirect.pathname !== '/api/agent-services/oauth/callback') throw new Error('Use this MedHelp server’s OAuth callback URL');
        }
        const record = { id: input.id, type: 'http', url: input.url, redirectUri: input.redirectUri || null, enabled: input.enabled ?? existing?.enabled ?? false };
        await invalidate(context, input.id);
        await mutateServiceState(serviceStatePath(context.identity, 'integrations', context.storageOptions), (rows) => {
          if (!rows.some((entry) => entry.id === input.id) && rows.length >= 32) throw new Error('At most 32 remote integrations can be saved per project');
          return [...rows.filter((entry) => entry.id !== input.id), record];
        });
        return { id: record.id, status: 'configured' };
      });
    },
    async remove(id, context) {
      if (!safeId(id)) throw new Error('Invalid integration id');
      return mutateConfig(keyFor(context, id), async () => {
        if ((await trustedServers(context)).some((entry) => entry.name === id)) throw new Error('Installed bundles cannot be deleted from project connections');
        await invalidate(context, id);
        await mutateServiceState(serviceStatePath(context.identity, 'integrations', context.storageOptions), (rows) => rows.filter((entry) => entry.id !== id));
        return { success: true };
      });
    },
    async execute(name, input, context) {
      if (name === 'integration_list') {
        return service.list(context);
      }
      const id = input.integration_id;
      if (!safeId(id)) throw new Error('Invalid integration id');
      if (name === 'mcp_reconnect') await close(keyFor(context, id));
      const connection = await connect(context, id, { interactive: name === 'mcp_authorize', callbackUrl: input.callback_url, reauthorize: input.reauthorize === true });
      if (connection.status !== 'connected') return connection;
      if (name === 'mcp_authorize') return { status: 'connected', integration_id: id };
      if (['integration_tools', 'mcp_reconnect'].includes(name)) {
        const tools = [];
        let cursor;
        do {
          const page = await connection.client.listTools(cursor ? { cursor } : {}, { timeout: 15_000 });
          tools.push(...page.tools);
          cursor = page.nextCursor;
        } while (cursor && tools.length < 128);
        let bytes = 0;
        connection.tools = tools.slice(0, 128).filter((tool) => { bytes += JSON.stringify(tool).length; return bytes < 96_000; });
        return { integration_id: id, status: 'connected', tools: connection.tools };
      }
      if (!connection.tools?.some((tool) => tool.name === input.tool)) throw new Error('Discover this exact tool using integration_tools before calling it');
      try {
        const result = await connection.client.callTool({ name: input.tool, arguments: input.arguments || {} }, undefined, { timeout: 60_000, signal: context.signal });
        const fullText = (result.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
        const text = context.identity?.runtimeId === 'pi' ? fullText : fullText.slice(0, 48_000);
        const resources = (result.content || []).filter((part) => part.type === 'resource_link').slice(0, 20).map(({ uri, name, mimeType }) => ({ uri, name, mimeType }));
        if (result.isError) throw new Error(text || 'Integration tool failed');
        const images = name === 'media_generate' ? (result.content || []).filter((part) => part.type === 'image' && ['image/png', 'image/jpeg', 'image/webp'].includes(part.mimeType) && typeof part.data === 'string' && part.data.length <= 8_000_000).slice(0, 4) : [];
        return { integration_id: id, tool: input.tool, text, resources, ...(images.length ? { images } : {}), untrusted: true };
      } catch (error) {
        // Never retry side effects after an ambiguous disconnect. Reconnect on the next explicit call.
        await close(keyFor(context, id));
        throw new Error(`Integration call failed; outcome may be unknown. Check before retrying. ${String(error.code || 'call_failed')}`);
      }
    },
    async completeOAuth({ state, code }) {
      const pending = pendingOAuth.get(state);
      if (!pending) throw new Error('Authorization expired; start again');
      const config = (await configs(pending.context)).find((entry) => entry.id === pending.id);
      const provider = await oauthProvider(pending.context, config, true);
      const callback = new URL(provider.redirectUrl);
      callback.searchParams.set('state', state); callback.searchParams.set('code', code);
      return service.execute('mcp_authorize', { integration_id: pending.id, callback_url: String(callback) }, pending.context);
    },
    async shutdown() { await Promise.allSettled([...connections.keys()].map(close)); pendingOAuth.clear(); },
  };
  return service;
}
