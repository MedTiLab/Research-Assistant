function getFiniteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function findNestedTokenTotal(source, paths) {
  for (const path of paths) {
    let cursor = source;
    let missing = false;
    for (const key of path) {
      if (!cursor || typeof cursor !== 'object' || !(key in cursor)) {
        missing = true;
        break;
      }
      cursor = cursor[key];
    }
    if (!missing) {
      const candidate = getFiniteNumber(cursor);
      if (candidate != null) return candidate;
    }
  }
  return null;
}

export function buildCodexUnsupportedContextTokenUsage({
  total = 256000,
  lifetimeTokens = null,
} = {}) {
  return {
    used: null,
    total,
    unsupportedContext: true,
    message: 'Current context usage is unavailable for Codex sessions.',
    ...(lifetimeTokens != null ? { lifetimeTokens } : {}),
  };
}

export function buildCodexEstimatedContextTokenUsage({
  used,
  total = 256000,
  breakdown = null,
} = {}) {
  const normalizedUsed = getFiniteNumber(used);
  if (normalizedUsed == null) {
    return buildCodexUnsupportedContextTokenUsage({ total });
  }

  return {
    used: normalizedUsed,
    total,
    estimated: true,
    message: 'Estimated from the latest Codex request size.',
    ...(breakdown ? { breakdown } : {}),
  };
}

function buildBreakdown(source) {
  if (!source || typeof source !== 'object') return null;
  const breakdown = {
    input: getFiniteNumber(source.input_tokens) ?? 0,
    cacheRead: getFiniteNumber(source.cached_input_tokens ?? source.cache_read_input_tokens) ?? 0,
    cacheCreation: getFiniteNumber(source.cache_write_input_tokens ?? source.cache_creation_input_tokens) ?? 0,
    output: getFiniteNumber(source.output_tokens) ?? 0,
    reasoning: getFiniteNumber(source.reasoning_output_tokens) ?? 0,
  };
  return Object.values(breakdown).some((value) => value > 0) ? breakdown : null;
}

export function buildCodexTokenUsageFromTokenInfo(tokenInfo) {
  if (!tokenInfo || typeof tokenInfo !== 'object') {
    return null;
  }

  const contextWindow = getFiniteNumber(tokenInfo.model_context_window) ?? 256000;
  const contextFromPayload = findNestedTokenTotal(tokenInfo, [
    ['current_context_usage', 'total_tokens'],
    ['current_context_token_usage', 'total_tokens'],
    ['context_usage', 'total_tokens'],
    ['active_context_usage', 'total_tokens'],
    ['context_window_usage', 'total_tokens'],
  ]);
  const lifetimeTokens = findNestedTokenTotal(tokenInfo, [
    ['total_token_usage', 'total_tokens'],
    ['lifetime_token_usage', 'total_tokens'],
  ]);

  if (contextFromPayload != null) {
    const breakdown = buildBreakdown(
      tokenInfo.current_context_usage
      || tokenInfo.current_context_token_usage
      || tokenInfo.context_usage,
    );
    return {
      used: contextFromPayload,
      total: contextWindow,
      ...(breakdown ? { breakdown } : {}),
    };
  }

  const estimatedContext = findNestedTokenTotal(tokenInfo, [
    ['last_token_usage', 'total_tokens'],
    ['last_token_usage', 'input_tokens'],
  ]);

  if (estimatedContext != null) {
    return buildCodexEstimatedContextTokenUsage({
      used: estimatedContext,
      total: contextWindow,
      breakdown: buildBreakdown(tokenInfo.last_token_usage),
    });
  }

  return buildCodexUnsupportedContextTokenUsage({
    total: contextWindow,
    lifetimeTokens,
  });
}

export function buildCodexTokenUsageFromJsonl(fileContent) {
  const lines = String(fileContent || '').trim().split('\n').filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.type !== 'event_msg' || entry.payload?.type !== 'token_count' || !entry.payload?.info) {
        continue;
      }

      return buildCodexTokenUsageFromTokenInfo(entry.payload.info);
    } catch {
      // Ignore malformed lines and keep scanning backwards.
    }
  }

  return buildCodexUnsupportedContextTokenUsage();
}

export function buildCodexRealtimeTokenBudget(eventUsage, contextWindow = 256000) {
  const breakdown = buildBreakdown(eventUsage);
  const contextTokens = findNestedTokenTotal(eventUsage, [
    ['current_context_usage', 'total_tokens'],
    ['context_usage', 'total_tokens'],
    ['context_window_usage', 'total_tokens'],
    ['current_context_tokens'],
    ['context_tokens'],
  ]);

  if (contextTokens != null) {
    return {
      used: contextTokens,
      total: contextWindow,
      ...(breakdown ? { breakdown } : {}),
    };
  }

  const estimatedContext = findNestedTokenTotal(eventUsage, [
    ['last_token_usage', 'total_tokens'],
    ['last_token_usage', 'input_tokens'],
    ['input_tokens'],
  ]);

  if (estimatedContext != null) {
    return buildCodexEstimatedContextTokenUsage({
      used: estimatedContext,
      total: contextWindow,
      breakdown,
    });
  }

  return buildCodexUnsupportedContextTokenUsage({ total: contextWindow });
}
