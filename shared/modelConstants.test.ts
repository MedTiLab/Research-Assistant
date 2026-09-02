import { describe, expect, it } from 'vitest';

import {
  CLAUDE_MODELS,
  CODEX_MODELS,
  getClaudeModelContextWindow,
  getCodexModelContextWindow,
  normalizeCodexStoredModelSelection,
} from './modelConstants.js';

describe('Claude model constants', () => {
  it('auto-tracks Opus 5 and keeps an explicit Opus 5 option', () => {
    expect(CLAUDE_MODELS.DEFAULT).toBe('opus');
    expect(CLAUDE_MODELS.OPTIONS.find((option) => option.value === 'opus')?.label).toContain('currently 5');
    expect(CLAUDE_MODELS.OPTIONS.some((option) => option.value === 'claude-opus-5')).toBe(true);
  });

  it('uses the published 1M context window for current Opus models', () => {
    expect(getClaudeModelContextWindow('opus')).toBe(1_000_000);
    expect(getClaudeModelContextWindow('claude-opus-5')).toBe(1_000_000);
    expect(getClaudeModelContextWindow('claude-opus-4-8')).toBe(1_000_000);
  });
});

describe('Codex model constants', () => {
  it('uses GPT-5.6 Sol as the bundled default and exposes every GPT-5.6 tier', () => {
    expect(CODEX_MODELS.DEFAULT).toBe('gpt-5.6-sol');
    expect(CODEX_MODELS.OPTIONS.slice(0, 3).map((option) => option.value)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ]);
  });

  it('preserves every explicit runnable model selection', () => {
    expect(normalizeCodexStoredModelSelection('gpt-5.5')).toBe('gpt-5.5');
    expect(normalizeCodexStoredModelSelection('gpt-5.4')).toBe('gpt-5.4');
    expect(normalizeCodexStoredModelSelection('gpt-5.2-codex')).toBe('gpt-5.2-codex');
  });

  it('uses the published GPT-5.6 context window', () => {
    expect(getCodexModelContextWindow('gpt-5.6-sol')).toBe(1_050_000);
    expect(getCodexModelContextWindow('gpt-5.6-terra')).toBe(1_050_000);
    expect(getCodexModelContextWindow('gpt-5.6-luna')).toBe(1_050_000);
  });
});
