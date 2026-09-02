import { describe, expect, it } from 'vitest';

import {
  mergeRuntimeUsage,
  normalizeClaudeRuntimeUsage,
  normalizeCodexRuntimeUsage,
  normalizePiRuntimeUsage,
} from '../agent-runtime/usage.js';

describe('agent runtime usage', () => {
  it('normalizes Claude usage with its existing cache-inclusive total semantics', () => {
    expect(normalizeClaudeRuntimeUsage({
      input_tokens: 10,
      output_tokens: 4,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 2,
    })).toEqual({
      provider: 'claude',
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 3,
      cacheCreationTokens: 2,
      reasoningTokens: null,
      context: null,
      totalTokens: 19,
      rawSemantics: 'claude',
    });
  });

  it('reuses the Codex context budget and does not double-count cache or reasoning', () => {
    expect(normalizeCodexRuntimeUsage({
      input_tokens: 10,
      cached_input_tokens: 3,
      output_tokens: 4,
      reasoning_output_tokens: 2,
      current_context_usage: { total_tokens: 14 },
      model_context_window: 258_400,
    })).toEqual({
      provider: 'codex',
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 3,
      cacheCreationTokens: 0,
      reasoningTokens: 2,
      context: {
        used: 14,
        total: 258_400,
        estimated: false,
      },
      totalTokens: 14,
      rawSemantics: 'codex',
    });
  });

  it('merges turns while retaining the latest context snapshot', () => {
    const usages = [
      normalizeCodexRuntimeUsage({
        used: 8,
        total: 100,
        breakdown: { input: 5, output: 2, cacheRead: 1, reasoning: 1 },
      }),
      normalizeCodexRuntimeUsage({
        used: 13,
        total: 100,
        breakdown: { input: 7, output: 3, cacheRead: 2, reasoning: 2 },
      }),
    ];

    expect(mergeRuntimeUsage('codex', usages)).toMatchObject({
      inputTokens: 12,
      outputTokens: 5,
      cacheReadTokens: 3,
      reasoningTokens: 3,
      context: { used: 13, total: 100, estimated: false },
      totalTokens: 17,
    });
  });

  it('normalizes Pi SDK counters without double-counting cache or reasoning', () => {
    expect(normalizePiRuntimeUsage({
      input: 11,
      output: 5,
      cacheRead: 3,
      cacheWrite: 2,
      reasoning: 1,
      totalTokens: 16,
      context: { tokens: 16, contextWindow: 128000 },
    })).toEqual({
      provider: 'pi',
      inputTokens: 11,
      outputTokens: 5,
      cacheReadTokens: 3,
      cacheCreationTokens: 2,
      reasoningTokens: 1,
      context: { used: 16, total: 128000, estimated: false },
      totalTokens: 16,
      rawSemantics: 'pi',
    });
  });
});
