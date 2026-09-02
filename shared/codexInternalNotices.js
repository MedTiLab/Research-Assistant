const CODEX_SKILL_BUDGET_NOTICE_MAX_LENGTH = 800;

function normalizeInternalMarkup(text) {
  return typeof text === 'string'
    ? text
      .trim()
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;|&#34;|&#x22;/gi, '"')
      .replace(/&#39;|&#x27;/gi, "'")
    : '';
}

/**
 * Detect context injected by Codex itself for automatic goal continuation.
 * It is rollout metadata, not a user-authored chat message.
 */
export function isCodexInternalContextContent(text) {
  const normalized = normalizeInternalMarkup(text);
  return /^<codex_internal_context(?:\s|>)/i.test(normalized);
}

/**
 * Detect MedHelp prompt scaffolding that is sent to Codex for runtime behavior
 * but must never be rendered as conversation content.
 */
export function isCodexInternalPromptContent(text) {
  const normalized = typeof text === 'string' ? text.trim() : '';
  if (!normalized) {
    return false;
  }

  return (
    isCodexInternalContextContent(normalized)
    || /^#\s+MedHelp Skills(?:\s*\(|\s+Reminder\b)/i.test(normalized)
    || /^#\s+Project Instructions\s*\((?:AGENTS|CLAUDE)\.md\)/i.test(normalized)
    || (
      /^(?:<path_display_rule>|<research_lessons>|<execution_memory>|<analysis_preferences>|<user_preferences>|<user_memory>)/i.test(normalized)
      && /(?:^|\n)\s*User request:\s*(?:\n|$)/i.test(normalized)
    )
  );
}

/**
 * Codex SDK occasionally emits non-actionable client notices as message/error
 * content. These should not become visible chat errors in MedHelp.
 */
export function isCodexInternalNoticeContent(text) {
  const normalized = typeof text === 'string' ? text.trim() : '';
  if (!normalized || normalized.length > CODEX_SKILL_BUDGET_NOTICE_MAX_LENGTH) {
    return false;
  }

  const lower = normalized.toLowerCase();
  return (
    lower.includes('skill descriptions were shortened to fit')
    && lower.includes('skills context budget')
    && (
      lower.includes('codex can still see every skill')
      || lower.includes('disable unused skills or plugins')
    )
  );
}
