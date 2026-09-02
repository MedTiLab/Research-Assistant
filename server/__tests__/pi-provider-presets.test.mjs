import { describe, expect, it } from 'vitest';

import {
  getPiDomesticProviderPreset,
  inferPiProviderPreset,
  mergePiDomesticPresetModels,
  PI_DOMESTIC_PROVIDER_PRESETS,
  PI_OFFICIAL_PROVIDER_PRESETS,
} from '../../shared/piProviderPresets.js';

describe('Pi domestic provider presets', () => {
  it('includes native Gemini image generation and editing models', () => {
    const gemini = PI_OFFICIAL_PROVIDER_PRESETS.find((preset) => preset.id === 'official-gemini');
    expect(gemini).toMatchObject({
      name: 'Gemini / Google AI',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    });
    expect(gemini.models.map((model) => model.id)).toEqual([
      'gemini-3.1-flash-image',
      'gemini-3.1-flash-lite-image',
      'gemini-3-pro-image',
      'gemini-2.5-flash-image',
    ]);
  });

  it('covers the qm_research provider catalog with unique HTTPS endpoints and model ids', () => {
    const ids = PI_DOMESTIC_PROVIDER_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining([
      'deepseek',
      'bailian',
      'bailian-plan',
      'zhipu',
      'glm-coding-plan',
      'kimi',
      'kimi-coding',
      'minimax',
      'stepfun',
      'step-plan',
      'xiaomi-mimo',
      'sensenova',
      'volcengine',
    ]));

    for (const preset of PI_DOMESTIC_PROVIDER_PRESETS) {
      expect(new URL(preset.baseUrl).protocol).toBe('https:');
      expect(new URL(preset.apiKeyUrl).protocol).toBe('https:');
      expect(preset.models.length).toBeGreaterThan(0);
      expect(new Set(preset.models.map((model) => model.id)).size).toBe(preset.models.length);
    }
  });

  it('merges new preset models without discarding saved customizations or additions', () => {
    const models = mergePiDomesticPresetModels('deepseek', [
      { id: 'deepseek-v4-pro', label: 'My DeepSeek label', enabled: false },
      { id: 'private-finetune', label: 'Private model' },
    ]);

    expect(models).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'deepseek-v4-pro', label: 'My DeepSeek label', enabled: false }),
      expect.objectContaining({ id: 'deepseek-v4-pro[1m]' }),
      expect.objectContaining({ id: 'deepseek-v4-flash' }),
      expect.objectContaining({ id: 'private-finetune' }),
    ]));
    expect(getPiDomesticProviderPreset('DEEPSEEK')?.id).toBe('deepseek');
  });

  it('recognizes model-less official providers saved before automatic model setup', () => {
    expect(inferPiProviderPreset({
      providerType: 'byok-anthropic-compatible',
      baseUrl: 'https://api.anthropic.com',
      models: [],
    })?.id).toBe('official-anthropic');
    expect(inferPiProviderPreset({
      providerType: 'byok-openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      models: [{ id: 'user-selected-model' }],
    })).toBeNull();
  });
});
