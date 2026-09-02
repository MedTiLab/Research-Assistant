import { buildCodexRealtimeTokenBudget } from '../utils/sessionTokenUsage.js';

function finiteTokenCount(value, fallback = 0) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function normalizeContext(context) {
  if (!context || typeof context !== 'object') {
    return null;
  }

  return {
    used: Number.isFinite(context.used) ? Number(context.used) : null,
    total: Number.isFinite(context.total) ? Number(context.total) : null,
    estimated: Boolean(context.estimated),
    ...(context.unsupportedContext ? { unsupportedContext: true } : {}),
  };
}

export function createEmptyRuntimeUsage(provider) {
  return {
    provider,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: provider === 'claude' ? null : 0,
    context: null,
    totalTokens: 0,
    rawSemantics: provider,
  };
}

export function normalizeClaudeRuntimeUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const inputTokens = finiteTokenCount(usage.input_tokens);
  const outputTokens = finiteTokenCount(usage.output_tokens);
  const cacheReadTokens = finiteTokenCount(usage.cache_read_input_tokens);
  const cacheCreationTokens = finiteTokenCount(usage.cache_creation_input_tokens);

  return {
    provider: 'claude',
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    reasoningTokens: null,
    context: null,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
    rawSemantics: 'claude',
  };
}

export function normalizeCodexRuntimeUsage(usage, { contextWindow } = {}) {
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const source = usage.usage && typeof usage.usage === 'object' ? usage.usage : usage;
  const tokenBudget = (
    ('used' in source || 'unsupportedContext' in source || source.breakdown)
      ? source
      : buildCodexRealtimeTokenBudget(source, contextWindow || source.model_context_window)
  );
  const breakdown = tokenBudget.breakdown || {};
  const inputTokens = finiteTokenCount(breakdown.input);
  const outputTokens = finiteTokenCount(breakdown.output);

  return {
    provider: 'codex',
    inputTokens,
    outputTokens,
    cacheReadTokens: finiteTokenCount(breakdown.cacheRead),
    cacheCreationTokens: finiteTokenCount(breakdown.cacheCreation),
    reasoningTokens: finiteTokenCount(breakdown.reasoning),
    context: normalizeContext(tokenBudget),
    // Codex cache and reasoning counters may be subsets of input/output. Keep
    // them as detail fields instead of adding them into the billable total.
    totalTokens: inputTokens + outputTokens,
    rawSemantics: 'codex',
  };
}

export function normalizePiRuntimeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const source = usage.usage && typeof usage.usage === 'object' ? usage.usage : usage;
  const inputTokens = finiteTokenCount(source.inputTokens ?? source.input_tokens ?? source.input);
  const outputTokens = finiteTokenCount(source.outputTokens ?? source.output_tokens ?? source.output);
  const cacheReadTokens = finiteTokenCount(
    source.cacheReadTokens ?? source.cache_read_tokens ?? source.cacheRead ?? source.cached_tokens,
  );
  const cacheCreationTokens = finiteTokenCount(
    source.cacheCreationTokens ?? source.cache_creation_tokens ?? source.cacheWrite,
  );
  const reasoningValue = source.reasoningTokens ?? source.reasoning_tokens ?? source.reasoning;
  const reasoningTokens = Number.isFinite(reasoningValue) ? Number(reasoningValue) : null;
  const contextSource = source.context && typeof source.context === 'object'
    ? source.context
    : null;
  return {
    provider: 'pi',
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    reasoningTokens,
    totalTokens: Number.isFinite(source.totalTokens ?? source.total_tokens)
      ? Number(source.totalTokens ?? source.total_tokens)
      : inputTokens + outputTokens,
    context: contextSource ? {
      used: Number.isFinite(contextSource.used ?? contextSource.tokens)
        ? Number(contextSource.used ?? contextSource.tokens)
        : null,
      total: Number.isFinite(contextSource.total ?? contextSource.contextWindow)
        ? Number(contextSource.total ?? contextSource.contextWindow)
        : null,
      estimated: Boolean(contextSource.estimated),
    } : null,
    rawSemantics: 'pi',
  };
}

export function normalizeRuntimeUsage(provider, usage, options = {}) {
  if (provider === 'claude') {
    return normalizeClaudeRuntimeUsage(usage);
  }
  if (provider === 'codex') {
    return normalizeCodexRuntimeUsage(usage, options);
  }
  if (provider === 'pi') {
    return normalizePiRuntimeUsage(usage);
  }
  return null;
}

export function mergeRuntimeUsage(provider, usages) {
  const merged = createEmptyRuntimeUsage(provider);

  for (const usage of usages || []) {
    if (!usage || usage.provider !== provider) {
      continue;
    }
    merged.inputTokens += usage.inputTokens || 0;
    merged.outputTokens += usage.outputTokens || 0;
    merged.cacheReadTokens += usage.cacheReadTokens || 0;
    merged.cacheCreationTokens += usage.cacheCreationTokens || 0;
    if (provider !== 'claude') {
      merged.reasoningTokens += usage.reasoningTokens || 0;
    }
    if (usage.context) {
      merged.context = usage.context;
    }
  }

  merged.totalTokens = provider === 'claude'
    ? merged.inputTokens
      + merged.outputTokens
      + merged.cacheReadTokens
      + merged.cacheCreationTokens
    : merged.inputTokens + merged.outputTokens;

  return merged;
}
