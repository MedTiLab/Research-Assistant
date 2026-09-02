import { describe, expect, it } from 'vitest';

import { DEFAULT_CODEX_REASONING_EFFORT } from './codexReasoningEfforts';
import {
  getSupportedCodexReasoningEfforts,
  supportsExplicitCodexReasoningEffort,
} from './codexReasoningSupport';

describe('Codex reasoning default', () => {
  it('uses high for new and migrated sessions', () => {
    expect(DEFAULT_CODEX_REASONING_EFFORT).toBe('high');
  });
});

describe('codexReasoningSupport', () => {
  it('returns explicit reasoning levels for configured Codex models', () => {
    expect(getSupportedCodexReasoningEfforts('gpt-5.4')).toEqual([
      'default',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    expect(supportsExplicitCodexReasoningEffort('gpt-5.4')).toBe(true);
    expect(supportsExplicitCodexReasoningEffort('gpt-5.3-codex')).toBe(true);
  });

  it('adds the GPT-5.6 max effort without exposing it on older models', () => {
    expect(getSupportedCodexReasoningEfforts('gpt-5.6-sol')).toEqual([
      'default',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
    ]);
    expect(getSupportedCodexReasoningEfforts('gpt-5.5')).not.toContain('max');
  });

  it('falls back to default-only support for empty model selections', () => {
    expect(getSupportedCodexReasoningEfforts('')).toEqual(['default']);
    expect(supportsExplicitCodexReasoningEffort('')).toBe(false);
  });
});
