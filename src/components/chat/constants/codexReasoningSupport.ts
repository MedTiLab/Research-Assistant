import type { CodexReasoningEffortId } from './codexReasoningEfforts';

const DEFAULT_ONLY: CodexReasoningEffortId[] = ['default'];
const FULL_REASONING_SET: CodexReasoningEffortId[] = ['default', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const GPT_5_6_REASONING_SET: CodexReasoningEffortId[] = [...FULL_REASONING_SET, 'max'];

export function getSupportedCodexReasoningEfforts(model: string): CodexReasoningEffortId[] {
  const normalized = typeof model === 'string' ? model.trim().toLowerCase() : '';

  if (!normalized) {
    return DEFAULT_ONLY;
  }

  if (/^gpt-5\.6(?:-|$)/.test(normalized)) {
    return GPT_5_6_REASONING_SET;
  }

  // The Codex CLI forwards reasoning effort to its configured provider.
  // Keep the control available for any explicit Codex model selection instead
  // of trying to maintain a stale allowlist in the UI.
  return FULL_REASONING_SET;
}

export function supportsExplicitCodexReasoningEffort(model: string): boolean {
  return getSupportedCodexReasoningEfforts(model).length > 1;
}
