import { describe, expect, it } from 'vitest';
import { hasPiTokenBudget, piTokenBudget } from './piTokenBudget';

describe('Pi context usage', () => {
  it.each([
    { context: { tokens: 32000, contextWindow: 128000 } },
    { context: { used: 32000, total: 128000 } },
    { used: 32000, total: 128000 },
  ])('normalizes live, transcript and REST context snapshots: %j', (usage) => {
    expect(piTokenBudget(usage)).toMatchObject({ used: 32000, total: 128000, unsupportedContext: false });
    expect(hasPiTokenBudget(piTokenBudget(usage))).toBe(true);
  });

  it('does not replace missing or post-compaction context with lifetime billing totals', () => {
    expect(piTokenBudget({ totalTokens: 999999, input: 999998, output: 1 })).toBeNull();
    const unknown = piTokenBudget({ totalTokens: 999999, context: { tokens: null, contextWindow: 128000 } });
    expect(unknown).toMatchObject({ used: null, total: 128000 });
    expect(hasPiTokenBudget(unknown)).toBe(false);
  });

  it('preserves explicit zero and estimated context independently of usage breakdown', () => {
    const budget = piTokenBudget({ input: 80000, output: 200, cacheRead: 10000, context: { tokens: 0, contextWindow: 128000, estimated: true }, model: 'model' });
    expect(budget).toMatchObject({ used: 0, total: 128000, estimated: true, model: 'model', breakdown: { input: 80000, output: 200, cacheRead: 10000 } });
    expect(hasPiTokenBudget(budget)).toBe(true);
  });

  it.each([{ used: -1, total: 100 }, { used: NaN, total: 100 }, { used: 1, total: Infinity }, { used: 1, total: 0 }])('does not display invalid usage: %j', (usage) => {
    expect(hasPiTokenBudget(piTokenBudget(usage))).toBe(false);
  });
});
