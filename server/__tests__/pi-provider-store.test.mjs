import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
const originalLocalKernel = process.env.MEDHELP_LOCAL_KERNEL;
let tempRoot = null;

async function loadStore() {
  vi.resetModules();
  const database = await import('../database/db.js');
  await database.initializeDatabase();
  const store = await import('../pi-runtime/provider-store.js');
  return { database, store };
}

describe('Pi provider and model settings', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-pi-provider-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
    delete process.env.MEDHELP_LOCAL_KERNEL;
  });

  afterEach(async () => {
    vi.resetModules();
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;
    if (originalLocalKernel === undefined) delete process.env.MEDHELP_LOCAL_KERNEL;
    else process.env.MEDHELP_LOCAL_KERNEL = originalLocalKernel;
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  });

  it('saves a paired cloud account provider without creating a local login user', async () => {
    process.env.MEDHELP_LOCAL_KERNEL = '1';
    const { database, store } = await loadStore();
    const cloudUserId = 7001;
    const provider = store.upsertPiProvider(cloudUserId, {
      name: 'Desktop API',
      providerType: 'byok-openai-compatible',
      baseUrl: 'https://models.example.test/v1',
      apiKey: 'desktop-secret-1234',
    });
    expect(provider).toMatchObject({ keyConfigured: true, keyLast4: '1234' });
    store.savePiProviderModels(cloudUserId, provider.id, { models: [{ id: 'desktop-model' }] });
    expect(store.resolveStoredPiProviderSelection(cloudUserId, {})).toMatchObject({
      apiKey: 'desktop-secret-1234', model: { id: 'desktop-model' },
    });
    expect(store.listPiProviders(7002).providers).toEqual([]);
    expect(JSON.stringify(store.listPiProviders(cloudUserId))).not.toContain('desktop-secret');
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM users').get().count).toBe(0);
    expect(database.db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(database.db.pragma('foreign_key_check')).toEqual([]);
  });

  it('keeps API keys write-only and isolates providers by account', async () => {
    const { database, store } = await loadStore();
    const userA = database.userDb.createUser('pi-provider-a', 'hash');
    const userB = database.userDb.createUser('pi-provider-b', 'hash');

    const provider = store.upsertPiProvider(userA.id, {
      name: 'Example API',
      providerType: 'byok-openai-compatible',
      baseUrl: 'https://models.example.test/v1',
      apiKey: 'super-secret-key-1234',
      modelApi: 'openai-completions',
    });

    expect(provider).toMatchObject({ keyConfigured: true, keyLast4: '1234' });
    expect(JSON.stringify(store.listPiProviders(userA.id))).not.toContain('super-secret-key');
    expect(store.listPiProviders(userB.id).providers).toEqual([]);
    expect(() => store.upsertPiProvider(userB.id, {
      name: 'Missing key',
      providerType: 'byok-openai-compatible',
      baseUrl: 'https://models.example.test/v1',
      modelApi: 'openai-completions',
    })).toThrow(/API Key is required/);
    expect(store.listPiProviders(userB.id).providers).toEqual([]);
  });

  it('keeps cloud credentials separate from matching local user IDs across reloads and key updates', async () => {
    const { database, store } = await loadStore();
    const localUser = database.userDb.createUser('legacy-user', 'hash');
    const input = { name: 'Same API', providerType: 'byok-openai-compatible', baseUrl: 'https://models.example.test/v1' };
    const hosted = store.upsertPiProvider(localUser.id, { ...input, apiKey: 'hosted-secret-1111' });
    process.env.MEDHELP_LOCAL_KERNEL = '1';
    expect(store.listPiProviders(localUser.id).providers).toEqual([]);
    const local = store.upsertPiProvider(localUser.id, { ...input, apiKey: 'desktop-secret-2222' });
    store.savePiProviderModels(localUser.id, local.id, { models: [{ id: 'desktop-model' }] });
    const { store: reloaded } = await loadStore();
    expect(reloaded.resolveStoredPiProviderSelection(localUser.id, {})).toMatchObject({ apiKey: 'desktop-secret-2222' });
    expect(reloaded.upsertPiProvider(localUser.id, { id: local.id, apiKey: 'rotated-secret-3333' })).toMatchObject({ keyLast4: '3333' });
    expect(reloaded.resolveStoredPiProviderSelection(localUser.id, {})).toMatchObject({ apiKey: 'rotated-secret-3333' });
    expect(reloaded.deletePiProvider(localUser.id + 1, local.id)).toBe(false);
    expect(reloaded.deletePiProvider(localUser.id, local.id)).toBe(true);
    expect(database.localPiProviderDb.getCredential(localUser.id, local.id)).toBeNull();
    delete process.env.MEDHELP_LOCAL_KERNEL;
    expect(reloaded.listPiProviders(localUser.id).providers).toEqual([
      expect.objectContaining({ id: hosted.id, keyConfigured: true, keyLast4: '1111' }),
    ]);
  });

  it('separates provider credentials from enabled model selection', async () => {
    const { database, store } = await loadStore();
    const user = database.userDb.createUser('pi-model-user', 'hash');
    const provider = store.upsertPiProvider(user.id, {
      name: 'Example API',
      providerType: 'byok-openai-compatible',
      baseUrl: 'https://models.example.test/v1',
      apiKey: 'model-secret-5678',
      modelApi: 'openai-completions',
    });

    store.savePiProviderModels(user.id, provider.id, {
      activeModelId: 'model-a',
      models: [
        { id: 'model-a', enabled: true, contextWindow: 64000, maxTokens: 8000 },
        { id: 'model-b', enabled: false },
      ],
    });

    expect(store.listEnabledPiModels(user.id)).toEqual([
      expect.objectContaining({
        value: `${provider.id}/model-a`,
        modelProviderId: 'byok-openai-compatible',
      }),
    ]);
    expect(store.resolveStoredPiProviderSelection(user.id, {
      modelProviderId: 'byok-openai-compatible',
      modelId: `${provider.id}/model-a`,
    })).toMatchObject({
      apiKey: 'model-secret-5678',
      selectionModelId: `${provider.id}/model-a`,
      model: { id: 'model-a', contextWindow: 64000, maxTokens: 8000 },
    });

    const { getPiProviderStatusForRuntime, resolvePiProviderConfigForRuntime } = await import(
      '../pi-runtime/provider-config.js'
    );
    const runtimeConfig = await resolvePiProviderConfigForRuntime({
      modelProviderId: 'byok-openai-compatible',
      modelId: `${provider.id}/model-a`,
    }, {
      userId: user.id,
      env: {
        MEDHELP_PI_MODEL: 'environment-model-must-not-win',
        MEDHELP_PI_API_KEY: 'environment-secret-must-not-win',
      },
    });
    expect(runtimeConfig).toMatchObject({
      modelId: 'model-a',
      selectionModelId: `${provider.id}/model-a`,
      source: 'user-settings',
      secretEnv: { MEDHELP_PI_STORED_PROVIDER_API_KEY: 'model-secret-5678' },
    });
    expect(JSON.stringify(runtimeConfig.modelConfig)).not.toContain('model-secret-5678');
    expect(await getPiProviderStatusForRuntime({ userId: user.id, env: {} })).toMatchObject({
      configured: true,
      modelId: `${provider.id}/model-a`,
      source: 'user-settings',
    });
  });

  it('seeds every model when a domestic provider preset is configured', async () => {
    const { database, store } = await loadStore();
    const user = database.userDb.createUser('pi-domestic-preset-user', 'hash');

    const provider = store.upsertPiProvider(user.id, {
      presetId: 'bailian',
      apiKey: 'bailian-secret-1234',
    });

    expect(provider).toMatchObject({
      presetId: 'bailian',
      name: '阿里云百炼',
      providerType: 'byok-openai-compatible',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      activeModelId: 'qwen3.8-max',
      enabledModelCount: 9,
    });
    expect(store.listPiProviderModels(user.id, provider.id).models).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'qwen3.8-max', label: 'Qwen 3.8 Max', contextWindow: 983616 }),
      expect.objectContaining({ id: 'deepseek-v4-pro', enabled: true }),
    ]));
    expect(store.listEnabledPiModels(user.id)).toHaveLength(9);
  });

  it('reports task and vision counts for every configured provider', async () => {
    const { database, store } = await loadStore();
    const user = database.userDb.createUser('pi-capability-count-user', 'hash');

    const openai = store.upsertPiProvider(user.id, {
      presetId: 'official-openai',
      apiKey: 'openai-secret-1234',
    });
    const zhipu = store.upsertPiProvider(user.id, {
      presetId: 'zhipu',
      apiKey: 'zhipu-secret-5678',
    });

    const providers = store.listPiProviders(user.id).providers;
    expect(providers.find((provider) => provider.id === openai.id)).toMatchObject({
      capabilityModelCounts: {
        image_generation: 2,
        image_edit: 2,
        speech_synthesis: 1,
        speech_recognition: 1,
      },
    });
    expect(providers.find((provider) => provider.id === zhipu.id)).toMatchObject({
      capabilityModelCounts: {
        vision: 1,
        image_generation: 1,
        video_generation: 1,
        speech_synthesis: 1,
        speech_recognition: 1,
        embedding: 1,
        rerank: 1,
      },
    });
  });

  it('lists only enabled models of the active API, including after an API switch', async () => {
    const { database, store } = await loadStore();
    const user = database.userDb.createUser('active-api-models', 'hash');
    const first = store.upsertPiProvider(user.id, { name: 'First', providerType: 'byok-openai-compatible', baseUrl: 'https://first.example.test/v1', apiKey: 'test-first-key' });
    const second = store.upsertPiProvider(user.id, { name: 'Second', providerType: 'byok-openai-compatible', baseUrl: 'https://second.example.test/v1', apiKey: 'test-second-key' });
    for (const provider of [first, second]) {
      store.savePiProviderModels(user.id, provider.id, { models: [{ id: 'shared-model' }, { id: 'disabled', enabled: false }] });
    }
    expect(store.listEnabledPiModels(user.id).map((model) => model.value)).toEqual([`${first.id}/shared-model`]);
    store.setActivePiProvider(user.id, second.id);
    expect(store.listEnabledPiModels(user.id).map((model) => model.value)).toEqual([`${second.id}/shared-model`]);
    const { getPiProviderStatusForRuntime } = await import('../pi-runtime/provider-config.js');
    expect((await getPiProviderStatusForRuntime({ userId: user.id, env: {} })).models).toEqual(store.listEnabledPiModels(user.id));
    store.savePiProviderModels(user.id, second.id, { models: [{ id: 'shared-model', enabled: false }] });
    expect(store.listEnabledPiModels(user.id)).toEqual([]);
  });

  it('serves the same account-scoped catalogue on list and refresh without querying managed models', async () => {
    process.env.MEDHELP_LOCAL_KERNEL = '1';
    const { store } = await loadStore();
    const userId = 7001;
    const provider = store.upsertPiProvider(userId, { name: 'Active', providerType: 'local-openai-compatible', baseUrl: 'http://localhost:1234/v1' });
    store.savePiProviderModels(userId, provider.id, { models: [{ id: 'active-model' }] });
    const { piModelCatalog } = await import('../services/pi-model-catalog.js');
    const getCatalog = vi.spyOn(piModelCatalog, 'getCatalog').mockRejectedValue(new Error('managed catalog must not be used'));
    const refresh = vi.spyOn(piModelCatalog, 'refresh').mockRejectedValue(new Error('managed catalog must not be used'));
    const { default: express } = await import('express');
    const { default: router } = await import('../routes/pi-models.js');
    const app = express();
    app.use((req, _res, next) => { req.localKernelSession = { userId: Number(req.headers['x-test-user']) }; next(); });
    app.use('/api/pi', router);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      for (const [suffix, method] of [['/models', 'GET'], ['/models/refresh', 'POST']]) {
        for (const account of [userId, 7002]) {
          const response = await fetch(`http://127.0.0.1:${server.address().port}/api/pi${suffix}`, { method, headers: { 'x-test-user': String(account) } });
          expect(response.status).toBe(200);
          expect(await response.json()).toMatchObject({ configured: account === userId, models: account === userId ? store.listEnabledPiModels(userId) : [] });
        }
      }
      expect(getCatalog).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      getCatalog.mockRestore(); refresh.mockRestore();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('keeps the selected vendor identity while allowing an independent compatibility choice', async () => {
    const { database, store } = await loadStore();
    const user = database.userDb.createUser('pi-preset-identity-user', 'hash');

    const provider = store.upsertPiProvider(user.id, {
      presetId: 'deepseek',
      name: 'DeepSeek',
      providerType: 'byok-anthropic-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      modelApi: 'anthropic-messages',
      apiKey: 'deepseek-secret-1234',
    });

    expect(provider).toMatchObject({
      id: 'deepseek',
      presetId: 'deepseek',
      name: 'DeepSeek',
      providerType: 'byok-anthropic-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      modelApi: 'anthropic-messages',
      active: true,
    });
    expect(store.listPiProviders(user.id)).toMatchObject({
      activeProviderId: 'deepseek',
      providers: [expect.objectContaining({
        id: 'deepseek',
        name: 'DeepSeek',
        active: true,
      })],
    });
    expect(await store.resolveStoredPiProviderSelection(user.id, {})).toMatchObject({
      providerRef: 'deepseek',
      providerName: 'DeepSeek',
      providerId: 'byok-anthropic-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      model: { id: 'deepseek-v4-pro', api: 'anthropic-messages' },
    });
  });

  it('switches from Claude to DeepSeek without changing either provider name', async () => {
    const { database, store } = await loadStore();
    const user = database.userDb.createUser('pi-provider-switch-user', 'hash');
    const claude = store.upsertPiProvider(user.id, {
      presetId: 'official-anthropic',
      apiKey: 'claude-secret-1234',
    });
    const deepSeek = store.upsertPiProvider(user.id, {
      presetId: 'deepseek',
      apiKey: 'deepseek-secret-5678',
    });

    expect(store.setActivePiProvider(user.id, deepSeek.id)).toMatchObject({
      id: 'deepseek',
      name: 'DeepSeek',
      active: true,
    });
    expect(store.listPiProviders(user.id)).toMatchObject({
      activeProviderId: 'deepseek',
      providers: [
        expect.objectContaining({ id: claude.id, name: 'Claude', active: false }),
        expect.objectContaining({ id: deepSeek.id, name: 'DeepSeek', active: true }),
      ],
    });

    const { getPiProviderStatusForRuntime } = await import('../pi-runtime/provider-config.js');
    expect(await getPiProviderStatusForRuntime({ userId: user.id, env: {} })).toMatchObject({
      configured: true,
      providerRef: 'deepseek',
      providerName: 'DeepSeek',
      modelId: 'deepseek/deepseek-v4-pro',
    });
  });

  it('rejects unknown provider preset ids', async () => {
    const { database, store } = await loadStore();
    const user = database.userDb.createUser('pi-invalid-preset-user', 'hash');

    expect(() => store.upsertPiProvider(user.id, {
      presetId: 'not-a-real-preset',
      apiKey: 'secret',
    })).toThrowError(expect.objectContaining({ code: 'PI_PROVIDER_PRESET_INVALID' }));
  });

  it('auto-configures an official API that was saved without a separate model step', async () => {
    const { database, store } = await loadStore();
    const user = database.userDb.createUser('pi-official-provider-user', 'hash');

    const provider = store.upsertPiProvider(user.id, {
      name: 'Claude',
      providerType: 'byok-anthropic-compatible',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'official-anthropic-secret',
      modelApi: 'anthropic-messages',
    });

    expect(provider).toMatchObject({
      presetId: 'official-anthropic',
      activeModelId: 'claude-sonnet-4-6',
      enabledModelCount: 9,
    });
    expect(await store.resolveStoredPiProviderSelection(user.id, {})).toMatchObject({
      model: { id: 'claude-sonnet-4-6', reasoning: true },
    });
  });

  it('does not treat environment credentials as a signed-in user setting', async () => {
    const { database } = await loadStore();
    const user = database.userDb.createUser('pi-no-env-fallback', 'hash');
    const { getPiProviderStatusForRuntime } = await import('../pi-runtime/provider-config.js');

    expect(await getPiProviderStatusForRuntime({
      userId: user.id,
      env: {
        MEDHELP_PI_MODEL: 'environment-model',
        MEDHELP_PI_API_KEY: 'environment-secret',
      },
    })).toMatchObject({
      configured: false,
      source: 'user-settings',
      code: 'PI_PROVIDER_NOT_CONFIGURED',
    });
  });

  it('discovers models without enabling them automatically', async () => {
    const { database, store } = await loadStore();
    const user = database.userDb.createUser('pi-discovery-user', 'hash');
    const provider = store.upsertPiProvider(user.id, {
      name: 'Discovery API',
      providerType: 'byok-openai-compatible',
      baseUrl: 'https://models.example.test/v1',
      apiKey: 'discovery-secret',
      modelApi: 'openai-completions',
    });
    const fetchImpl = vi.fn(async (_url, options) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ id: 'discovered-a' }] }),
      requestHeaders: options.headers,
    }));

    const result = await store.discoverPiProviderModels(user.id, provider.id, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://models.example.test/v1/models',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer discovery-secret' }) }),
    );
    expect(result.models).toEqual([
      expect.objectContaining({ id: 'discovered-a', enabled: false, source: 'discovered' }),
    ]);
    expect(store.listEnabledPiModels(user.id)).toEqual([]);
  });

  it('discovers native Gemini models with the Google API key header', async () => {
    const { database, store } = await loadStore();
    const user = database.userDb.createUser('pi-gemini-discovery-user', 'hash');
    const provider = store.upsertPiProvider(user.id, {
      presetId: 'official-gemini',
      apiKey: 'gemini-secret-key',
    });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ models: [] }),
    }));

    await store.discoverPiProviderModels(user.id, provider.id, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-goog-api-key': 'gemini-secret-key' }),
      }),
    );
    expect(fetchImpl.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
  });

  it('discovers Claude models with Anthropic authentication and runs them natively', async () => {
    const { database, store } = await loadStore();
    const user = database.userDb.createUser('pi-anthropic-user', 'hash');
    const provider = store.upsertPiProvider(user.id, {
      name: 'Claude API',
      providerType: 'byok-anthropic-compatible',
      baseUrl: 'https://claude.example.test',
      apiKey: 'anthropic-discovery-secret',
      modelApi: 'anthropic-messages',
    });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: [{ id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' }],
      }),
    }));

    const discovered = await store.discoverPiProviderModels(user.id, provider.id, { fetchImpl });

    expect(provider).toMatchObject({
      providerType: 'byok-anthropic-compatible',
      baseUrl: 'https://claude.example.test',
      modelApi: 'anthropic-messages',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://claude.example.test/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'anthropic-discovery-secret',
          'anthropic-version': '2023-06-01',
        }),
      }),
    );
    expect(fetchImpl.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
    expect(discovered.models).toEqual([
      expect.objectContaining({
        id: 'claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6',
        api: 'anthropic-messages',
        enabled: false,
      }),
    ]);

    store.savePiProviderModels(user.id, provider.id, {
      activeModelId: 'claude-sonnet-4-6',
      models: discovered.models.map((model) => ({ ...model, enabled: true })),
    });
    const { resolvePiProviderConfigForRuntime } = await import('../pi-runtime/provider-config.js');
    const runtimeConfig = await resolvePiProviderConfigForRuntime({
      modelProviderId: 'byok-anthropic-compatible',
      modelId: `${provider.id}/claude-sonnet-4-6`,
    }, { userId: user.id, env: {} });
    expect(runtimeConfig.modelConfig.providers['medhelp-byok-anthropic-compatible']).toMatchObject({
      api: 'anthropic-messages',
      authHeader: false,
      apiKey: '$MEDHELP_PI_STORED_PROVIDER_API_KEY',
    });
    expect(JSON.stringify(runtimeConfig.modelConfig)).not.toContain('anthropic-discovery-secret');
  });

  it('does not allow OpenAI and Anthropic protocols to be mixed', async () => {
    const { database, store } = await loadStore();
    const user = database.userDb.createUser('pi-provider-protocol-user', 'hash');

    expect(() => store.upsertPiProvider(user.id, {
      name: 'Invalid Claude API',
      providerType: 'byok-anthropic-compatible',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'anthropic-secret',
      modelApi: 'openai-completions',
    })).toThrowError(expect.objectContaining({ code: 'PI_PROVIDER_MODEL_API_INVALID' }));
  });

  it('tests unsaved provider connectivity without writing credentials', async () => {
    const { database, store } = await loadStore();
    const user = database.userDb.createUser('pi-provider-test-user', 'hash');
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }),
    }));

    const result = await store.testPiProviderConnection(user.id, {
      name: 'DeepSeek',
      providerType: 'byok-openai-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'sk-test-unsaved',
      modelApi: 'openai-completions',
    }, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test-unsaved' }),
      }),
    );
    expect(result).toMatchObject({ connected: true, modelCount: 2, status: 200 });
    expect(store.listPiProviders(user.id).providers).toEqual([]);
  });

  it('reuses a saved API key when testing an edited provider', async () => {
    const { database, store } = await loadStore();
    const user = database.userDb.createUser('pi-provider-test-saved-user', 'hash');
    const provider = store.upsertPiProvider(user.id, {
      name: 'DeepSeek',
      providerType: 'byok-openai-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'saved-secret-key',
      modelApi: 'openai-completions',
    });
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [] }),
    }));

    const result = await store.testPiProviderConnection(user.id, {
      id: provider.id,
      providerType: 'byok-openai-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      modelApi: 'openai-completions',
    }, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer saved-secret-key' }),
      }),
    );
    expect(result).toMatchObject({ connected: true, modelCount: 0, status: 200 });
  });

  it('rejects a connectivity test when the provider returns an auth error', async () => {
    const { database, store } = await loadStore();
    const user = database.userDb.createUser('pi-provider-test-auth-user', 'hash');
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: 'Incorrect API key' } }),
    }));

    await expect(store.testPiProviderConnection(user.id, {
      providerType: 'byok-openai-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'bad-key',
      modelApi: 'openai-completions',
    }, { fetchImpl })).rejects.toMatchObject({
      code: 'PI_PROVIDER_DISCOVERY_REJECTED',
      statusCode: 502,
    });
    expect(store.listPiProviders(user.id).providers).toEqual([]);
  });
});
