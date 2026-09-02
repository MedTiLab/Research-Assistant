import type { TokenBudget } from '../types/types';

// Accept live SDK context, normalized transcript context and the flat REST
// snapshot. Never substitute lifetime/billing counters for occupied context.
export function piTokenBudget(value: any): TokenBudget | null {
  if (!value || typeof value !== 'object') return null;
  const context = 'used' in value || 'total' in value ? value : value.context;
  if (!context || typeof context !== 'object') return null;
  const used = 'tokens' in context ? context.tokens : context.used;
  const total = context.contextWindow ?? context.total;
  return {
    used: typeof used === 'number' && Number.isFinite(used) && used >= 0 ? used : null,
    total: typeof total === 'number' && Number.isFinite(total) && total > 0 ? total : null,
    estimated: Boolean(context.estimated),
    unsupportedContext: !(typeof total === 'number' && Number.isFinite(total) && total > 0),
    model: value.model || null,
    message: value.message,
    breakdown: value.breakdown || {
      input: value.inputTokens ?? value.input ?? value.input_tokens,
      output: value.outputTokens ?? value.output ?? value.output_tokens,
      cacheRead: value.cacheReadTokens ?? value.cacheRead ?? value.cache_read_tokens,
      cacheCreation: value.cacheCreationTokens ?? value.cacheWrite ?? value.cache_creation_tokens,
      reasoning: value.reasoningTokens ?? value.reasoning ?? value.reasoning_tokens,
    },
  };
}

export function hasPiTokenBudget(budget: TokenBudget | null): budget is TokenBudget {
  return budget?.used != null && budget.total != null && budget.total > 0;
}
