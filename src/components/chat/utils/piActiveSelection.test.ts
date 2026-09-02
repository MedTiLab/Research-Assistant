import { describe, expect, it } from 'vitest';

import { vi } from 'vitest';

import {
  applyAuthoritativePiSelection,
  getAuthoritativePiSelection,
} from './piActiveSelection';

describe('active Pi provider selection', () => {
  const availability = {
    cliAvailable: true, configured: true,
    modelId: 'deepseek/pro', modelProviderId: 'byok-openai-compatible', modelApi: 'openai-completions',
    models: ['deepseek/pro', 'deepseek/flash'].map((value) => ({
      value, modelProviderId: 'byok-openai-compatible', modelApi: 'openai-completions',
    })),
  };

  it('preserves a non-default model through repeated status refreshes and navigation', () => {
    const remembered = { modelId: 'deepseek/flash', modelProviderId: 'byok-openai-compatible', modelApi: 'openai-completions' };
    const cache = new Map(Object.entries({
      'pi-model': remembered.modelId, 'pi-model-provider': remembered.modelProviderId, 'pi-model-api': remembered.modelApi,
    }));
    const setModelId = vi.fn();
    for (let index = 0; index < 3; index++) {
      applyAuthoritativePiSelection(availability, {
        storage: { getItem: (key) => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) },
        setModelId, setModelProviderId: vi.fn(), setModelApi: vi.fn(),
      });
    }
    expect(setModelId.mock.calls).toEqual([['deepseek/flash'], ['deepseek/flash'], ['deepseek/flash']]);
    expect(cache.get('pi-model')).toBe('deepseek/flash');
  });

  it.each([
    ['another API with the same protocol', 'other/flash', 'openai-completions'],
    ['a disabled model', 'deepseek/disabled', 'openai-completions'],
    ['an outdated protocol', 'deepseek/flash', 'openai-responses'],
  ])('falls back to the active default for %s', (_reason, modelId, modelApi) => {
    expect(getAuthoritativePiSelection(availability, {
      modelId, modelProviderId: 'byok-openai-compatible', modelApi,
    })?.modelId).toBe('deepseek/pro');
  });

  it('returns DeepSeek even when the browser previously selected Claude', () => {
    const staleBrowserSelection = {
      modelId: 'claude/claude-sonnet-4-6',
      modelProviderId: 'byok-anthropic-compatible',
      modelApi: 'anthropic-messages',
    };
    const active = getAuthoritativePiSelection({
      cliAvailable: true,
      configured: true,
      modelId: 'deepseek/deepseek-v4-pro',
      modelProviderId: 'byok-openai-compatible',
      modelApi: 'openai-completions',
    });

    expect(active).not.toEqual(staleBrowserSelection);
    expect(active).toEqual({
      modelId: 'deepseek/deepseek-v4-pro',
      modelProviderId: 'byok-openai-compatible',
      modelApi: 'openai-completions',
    });
  });

  it('does not replace the selection with an incomplete status response', () => {
    expect(getAuthoritativePiSelection({
      cliAvailable: true,
      configured: false,
      modelId: null,
      modelProviderId: null,
      modelApi: null,
    })).toBeNull();
  });

  it('overwrites all stale Claude cache fields after DeepSeek becomes active', () => {
    const cache = new Map([
      ['pi-model', 'claude/claude-sonnet-4-6'],
      ['pi-model-provider', 'byok-anthropic-compatible'],
      ['pi-model-api', 'anthropic-messages'],
    ]);
    const setModelId = vi.fn();
    const setModelProviderId = vi.fn();
    const setModelApi = vi.fn();

    expect(applyAuthoritativePiSelection({
      cliAvailable: true,
      configured: true,
      modelId: 'deepseek/deepseek-v4-pro',
      modelProviderId: 'byok-openai-compatible',
      modelApi: 'openai-completions',
    }, {
      storage: { getItem: (key) => cache.get(key) ?? null, setItem: (key, value) => cache.set(key, value) },
      setModelId,
      setModelProviderId,
      setModelApi,
    })).toBe(true);

    expect(Object.fromEntries(cache)).toEqual({
      'pi-model': 'deepseek/deepseek-v4-pro',
      'pi-model-provider': 'byok-openai-compatible',
      'pi-model-api': 'openai-completions',
    });
    expect(setModelId).toHaveBeenCalledWith('deepseek/deepseek-v4-pro');
    expect(setModelProviderId).toHaveBeenCalledWith('byok-openai-compatible');
    expect(setModelApi).toHaveBeenCalledWith('openai-completions');
  });
});
