import { describe, expect, it } from 'vitest';
import { formatCompactModelName, resolveModelOptions } from './CustomModelInput';

const modelId = 'deepseek/deepseek-v4-pro';
const label = 'DeepSeek / DeepSeek V4 Pro';
const fallback = [{ value: modelId, label: modelId, modelProviderId: 'deepseek' }];
const catalogue = [{ value: modelId, label, modelProviderId: 'deepseek', contextLength: 1_000_000 }];

describe('compact model trigger labels', () => {
  it('keeps the distinctive model name and drops provider prefixes or notes', () => {
    expect(formatCompactModelName('DeepSeek / DeepSeek V4 Pro')).toBe('DeepSeek V4 Pro');
    expect(formatCompactModelName('deepseek/deepseek-v4-pro')).toBe('deepseek-v4-pro');
    expect(formatCompactModelName('GPT-5.6 Sol (Current Default)')).toBe('GPT-5.6 Sol');
    expect(formatCompactModelName('Opus 4.8 (Pinned)')).toBe('Opus 4.8');
    expect(formatCompactModelName('Sonnet')).toBe('Sonnet');
  });
});

describe('model catalogue display names', () => {
  it('uses the Pi catalogue label without changing the executable model ID', () => {
    expect(resolveModelOptions('/api/pi/models', catalogue, fallback)).toEqual(catalogue);
    expect(resolveModelOptions('/api/pi/models', null, fallback)).toMatchObject(fallback);
    expect(resolveModelOptions('/api/pi/models', [], fallback)).toEqual([]);
  });

  it('does not merge different providers or distinct model variants', () => {
    const variants = [
      ...catalogue,
      { ...catalogue[0], modelProviderId: 'other', label: 'Other provider' },
      { ...catalogue[0], value: `${modelId}[1m]`, label: `${label} (1M)` },
    ];
    expect(resolveModelOptions('/api/pi/models', variants, fallback)).toEqual(variants);
  });

  it('excludes a stale selection from the loaded Pi catalogue and preserves non-Pi label precedence', () => {
    const missing = [{ value: 'unlisted-model', label: 'unlisted-model', modelProviderId: 'deepseek' }];
    expect(resolveModelOptions('/api/pi/models', catalogue, missing)).toEqual(catalogue);
    expect(resolveModelOptions('/api/settings/codex-models', catalogue, fallback)[0]).toMatchObject(fallback[0]);
  });
});
