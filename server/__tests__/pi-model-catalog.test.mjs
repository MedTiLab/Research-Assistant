import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  PiManagedFreeCatalog,
  normalizePiManagedFreeModels,
} from '../services/pi-model-catalog.js';

const tempRoots = [];

async function createTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-pi-catalog-'));
  tempRoots.push(root);
  return root;
}

function response(status, payload, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => headers[String(name).toLowerCase()] || null,
    },
    text: async () => JSON.stringify(payload),
  };
}

function createCatalogOptions(root, overrides = {}) {
  return {
    enabled: true,
    baseUrl: 'https://inference.example.test/v1',
    catalogUrl: 'https://catalog.example.test/models',
    allowedHosts: ['inference.example.test', 'catalog.example.test'],
    apiKey: 'managed-secret',
    cachePath: path.join(root, 'catalog.json'),
    seedModels: [{ id: 'seed-model', api: 'openai-completions' }],
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('Pi managed-free catalog', () => {
  it('normalizes only supported text models and produces deterministic ordering', () => {
    expect(normalizePiManagedFreeModels([
      { id: 'z-model', api: 'openai-responses', contextWindow: 64_000 },
      { id: 'bad-api', api: 'anthropic-messages' },
      { id: 'a-model', api: 'openai-completions' },
      { id: 'a-model', api: 'openai-responses', name: 'A replacement' },
    ])).toEqual([
      expect.objectContaining({ id: 'a-model', api: 'openai-responses', label: 'A replacement' }),
      expect.objectContaining({ id: 'z-model', api: 'openai-responses', contextWindow: 64_000 }),
    ]);
  });

  it('refreshes an allowlisted catalog, increments revision, and keeps secrets out of public/cache data', async () => {
    const root = await createTempRoot();
    const catalog = new PiManagedFreeCatalog(createCatalogOptions(root, {
      fetchImpl: async () => response(200, {
        models: [
          { id: 'free-a', name: 'Free A', api: 'openai-responses', reasoning: true },
          { id: 'free-b', api: 'openai-completions' },
        ],
      }),
    }));

    const result = await catalog.getCatalog();
    expect(result).toMatchObject({
      configured: true,
      health: 'healthy',
      source: 'remote',
      revision: 2,
      modelId: 'free-a',
    });
    expect(result.models).toEqual([
      expect.objectContaining({
        value: 'free-a',
        modelProviderId: 'managed-free',
        modelApi: 'openai-responses',
        catalogRevision: 2,
        free: true,
      }),
      expect.objectContaining({ value: 'free-b' }),
    ]);
    expect(JSON.stringify(result)).not.toContain('managed-secret');
    expect(JSON.stringify(result)).not.toContain('inference.example.test');

    const cached = await fs.readFile(path.join(root, 'catalog.json'), 'utf8');
    expect(cached).not.toContain('managed-secret');
    expect(cached).not.toContain('inference.example.test');
  });

  it('uses last-known-good data when refresh fails without clearing the catalog', async () => {
    const root = await createTempRoot();
    const first = new PiManagedFreeCatalog(createCatalogOptions(root, {
      fetchImpl: async () => response(200, { models: [{ id: 'cached-free' }] }),
    }));
    await first.getCatalog();

    const second = new PiManagedFreeCatalog(createCatalogOptions(root, {
      fetchImpl: async () => {
        throw new Error('offline');
      },
    }));
    const result = await second.getCatalog({ force: true });
    expect(result).toMatchObject({
      configured: true,
      health: 'degraded',
      source: 'last-known-good',
      modelId: 'cached-free',
      error: { message: 'offline' },
    });
  });

  it('reports rate limiting with retry metadata while retaining the usable seed', async () => {
    const root = await createTempRoot();
    const now = Date.parse('2026-08-26T00:00:00.000Z');
    const catalog = new PiManagedFreeCatalog(createCatalogOptions(root, {
      now: () => now,
      fetchImpl: async () => response(429, {}, { 'retry-after': '120' }),
    }));

    const result = await catalog.getCatalog();
    expect(result).toMatchObject({
      configured: true,
      health: 'rate_limited',
      modelId: 'seed-model',
      retryAt: '2026-08-26T00:02:00.000Z',
      error: { code: 'PI_MANAGED_FREE_RATE_LIMITED' },
    });
  });

  it.each([
    [401, 'PI_MANAGED_FREE_CATALOG_AUTH_FAILED'],
    [404, 'PI_MANAGED_FREE_CATALOG_NOT_FOUND'],
    [503, 'PI_MANAGED_FREE_CATALOG_UPSTREAM_ERROR'],
  ])('maps catalog HTTP %i to %s while retaining the seed', async (status, code) => {
    const root = await createTempRoot();
    const catalog = new PiManagedFreeCatalog(createCatalogOptions(root, {
      fetchImpl: async () => response(status, {}),
    }));
    expect(await catalog.getCatalog()).toMatchObject({
      configured: true,
      health: 'degraded',
      modelId: 'seed-model',
      error: { code },
    });
  });

  it('reports invalid catalog JSON without dropping the usable seed', async () => {
    const root = await createTempRoot();
    const catalog = new PiManagedFreeCatalog(createCatalogOptions(root, {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => '{invalid',
      }),
    }));
    expect(await catalog.getCatalog()).toMatchObject({
      configured: true,
      health: 'degraded',
      modelId: 'seed-model',
      error: { code: 'PI_MANAGED_FREE_CATALOG_INVALID' },
    });
  });

  it('rejects stale revisions and models outside the catalog', async () => {
    const root = await createTempRoot();
    const catalog = new PiManagedFreeCatalog(createCatalogOptions(root, {
      fetchImpl: async () => response(200, {
        models: [{ id: 'free-a', api: 'openai-responses' }],
      }),
    }));
    const current = await catalog.getCatalog();

    await expect(catalog.resolveProviderConfig({
      modelId: 'free-a',
      catalogRevision: current.revision - 1,
      refresh: false,
    })).rejects.toMatchObject({ code: 'PI_CATALOG_REVISION_STALE' });
    await expect(catalog.resolveProviderConfig({
      modelId: 'not-allowlisted',
      catalogRevision: current.revision,
      refresh: false,
    })).rejects.toMatchObject({ code: 'PI_MODEL_NOT_FOUND' });

    await expect(catalog.resolveProviderConfig({
      modelId: 'free-a',
      catalogRevision: current.revision - 1,
      allowStale: true,
      refresh: false,
    })).resolves.toMatchObject({
      modelId: 'free-a',
      catalogRevision: current.revision,
    });
  });

  it('builds an immutable provider config without persisting the API key', async () => {
    const root = await createTempRoot();
    const catalog = new PiManagedFreeCatalog(createCatalogOptions(root, {
      fetchImpl: async () => response(200, {
        models: [{ id: 'free-a', api: 'openai-responses', contextWindow: 32_000 }],
      }),
    }));
    const current = await catalog.getCatalog();
    const config = await catalog.resolveProviderConfig({
      modelId: 'free-a',
      catalogRevision: current.revision,
      refresh: false,
    });

    expect(config).toMatchObject({
      providerId: 'managed-free',
      sdkProviderId: 'medhelp-managed-free',
      modelId: 'free-a',
      modelApi: 'openai-responses',
      catalogRevision: current.revision,
      secretEnv: { MEDHELP_PI_MANAGED_FREE_API_KEY: 'managed-secret' },
    });
    expect(JSON.stringify(config.modelConfig)).toContain('$MEDHELP_PI_MANAGED_FREE_API_KEY');
    expect(JSON.stringify(config.modelConfig)).not.toContain('managed-secret');
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('rejects configured endpoints outside the explicit host allowlist', async () => {
    const root = await createTempRoot();
    const catalog = new PiManagedFreeCatalog(createCatalogOptions(root, {
      allowedHosts: ['catalog.example.test'],
    }));
    const result = await catalog.getCatalog({ refresh: false });
    expect(result).toMatchObject({
      configured: false,
      health: 'unavailable',
      error: { code: 'PI_MANAGED_FREE_CONFIG_INVALID' },
    });
  });

  it('requires an explicit experimental flag before using an anonymous endpoint', async () => {
    const root = await createTempRoot();
    const unavailable = new PiManagedFreeCatalog(createCatalogOptions(root, {
      apiKey: null,
      fetchImpl: async () => response(200, { models: [{ id: 'anonymous-free' }] }),
    }));
    expect(await unavailable.getCatalog()).toMatchObject({
      configured: false,
      health: 'unavailable',
      error: { code: 'PI_MANAGED_FREE_NOT_CONFIGURED' },
    });

    const anonymous = new PiManagedFreeCatalog(createCatalogOptions(root, {
      apiKey: null,
      allowAnonymous: true,
      cachePath: path.join(root, 'anonymous-catalog.json'),
      fetchImpl: async () => response(200, { models: [{ id: 'anonymous-free' }] }),
    }));
    const current = await anonymous.getCatalog();
    const config = await anonymous.resolveProviderConfig({
      modelId: 'anonymous-free',
      catalogRevision: current.revision,
      refresh: false,
    });
    expect(current.configured).toBe(true);
    expect(config.secretEnv).toEqual({});
    expect(JSON.stringify(config.modelConfig)).not.toContain('apiKey');
  });
});
