/**
 * Centralized Model Definitions
 * Single source of truth for all supported AI models
 */

/**
 * Claude (Anthropic) Models
 *
 * Prefer alias-based defaults (`opus`, `sonnet`, `haiku`) so upstream Claude
 * agent model upgrades flow through without changing this app every time.
 */
const CLAUDE_AUTO_DEFAULT_MODEL = 'opus';
const CLAUDE_AUTO_CURRENT_VERSION = '5';
const CLAUDE_DEFAULT_CONTEXT_WINDOW = 200000;
const CLAUDE_LONG_CONTEXT_WINDOW = 1000000;
const CLAUDE_LEGACY_AUTO_MIGRATION_MODELS = new Set([
  // Previous app default. Migrate it to the alias so future Anthropic upgrades
  // follow automatically instead of pinning users to an old revision.
  'claude-opus-4-6',
]);
const CLAUDE_ALIAS_MODELS = new Set(['sonnet', 'opus', 'haiku', 'opusplan', 'sonnet[1m]']);

export function normalizeClaudeStoredModelSelection(model) {
  const normalized = typeof model === 'string' ? model.trim() : '';

  if (!normalized) {
    return CLAUDE_MODELS.DEFAULT;
  }

  if (CLAUDE_LEGACY_AUTO_MIGRATION_MODELS.has(normalized)) {
    return CLAUDE_AUTO_DEFAULT_MODEL;
  }

  return normalized;
}

export function isClaudeModelSelection(model) {
  const normalized = typeof model === 'string' ? model.trim() : '';
  return CLAUDE_ALIAS_MODELS.has(normalized)
    || /^claude-(?:opus|sonnet|haiku|\d)[A-Za-z0-9._-]*$/i.test(normalized);
}

export function getClaudeModelContextWindow(model) {
  const normalized = typeof model === 'string' ? model.trim().toLowerCase() : '';
  const usesOneMillionContext = normalized === 'opus'
    || normalized === 'sonnet'
    || normalized === 'sonnet[1m]'
    || /^claude-(?:fable|mythos)-5(?:-|$)/.test(normalized)
    || /^claude-(?:opus|sonnet)-(?:5(?:-|$)|4-(?:6|7|8)(?:-|$))/.test(normalized);

  return usesOneMillionContext ? CLAUDE_LONG_CONTEXT_WINDOW : CLAUDE_DEFAULT_CONTEXT_WINDOW;
}

export const CLAUDE_MODELS = {
  // Aliases are auto-tracking; explicit versions remain available for pinning.
  OPTIONS: [
    { value: 'sonnet', label: 'Sonnet', contextLength: CLAUDE_LONG_CONTEXT_WINDOW },
    { value: 'opus', label: `Opus (Auto, currently ${CLAUDE_AUTO_CURRENT_VERSION})`, contextLength: CLAUDE_LONG_CONTEXT_WINDOW },
    { value: 'haiku', label: 'Haiku', contextLength: CLAUDE_DEFAULT_CONTEXT_WINDOW },
    { value: 'opusplan', label: 'Opus (Plan Mode Only)', contextLength: CLAUDE_LONG_CONTEXT_WINDOW },
    { value: 'sonnet[1m]', label: 'Sonnet [1M]', contextLength: CLAUDE_LONG_CONTEXT_WINDOW },
    { value: 'claude-opus-5', label: 'Opus 5 (Pinned)', contextLength: CLAUDE_LONG_CONTEXT_WINDOW },
    { value: 'claude-opus-4-8', label: 'Opus 4.8 (Pinned)', contextLength: CLAUDE_LONG_CONTEXT_WINDOW },
    { value: 'claude-opus-4-7', label: 'Opus 4.7 (Pinned)', contextLength: CLAUDE_LONG_CONTEXT_WINDOW },
    { value: 'claude-opus-4-6', label: 'Opus 4.6 (Pinned)', contextLength: CLAUDE_LONG_CONTEXT_WINDOW }
  ],

  ALLOWS_CUSTOM: true,

  MODEL_ENDPOINT: '/api/settings/claude-models',

  CUSTOM_STORAGE_KEY: 'claude-custom-models',

  DEFAULT: (typeof process !== 'undefined' && process.env?.ANTHROPIC_MODEL) || CLAUDE_AUTO_DEFAULT_MODEL
};

/**
 * Codex (OpenAI) Models
 */
const CODEX_AUTO_DEFAULT_MODEL = 'gpt-5.6-sol';
// Used only for unknown/custom Codex model ids when the runtime has not yet
// reported its modelContextWindow. Known models and live telemetry always win.
const CODEX_DEFAULT_CONTEXT_WINDOW = 256000;
const CODEX_LONG_CONTEXT_WINDOW = 400000;
const CODEX_ONE_MILLION_CONTEXT_WINDOW = 1000000;
const CODEX_5_6_CONTEXT_WINDOW = 1050000;
export const CODEX_MODEL_CONTEXT_WINDOWS = {
  'gpt-5.6': CODEX_5_6_CONTEXT_WINDOW,
  'gpt-5.6-sol': CODEX_5_6_CONTEXT_WINDOW,
  'gpt-5.6-terra': CODEX_5_6_CONTEXT_WINDOW,
  'gpt-5.6-luna': CODEX_5_6_CONTEXT_WINDOW,
  'gpt-5.5': CODEX_ONE_MILLION_CONTEXT_WINDOW,
  'gpt-5.4': CODEX_ONE_MILLION_CONTEXT_WINDOW,
  'gpt-5.4-mini': CODEX_LONG_CONTEXT_WINDOW,
  'gpt-5.3-codex': CODEX_LONG_CONTEXT_WINDOW,
  'gpt-5.2-codex': CODEX_LONG_CONTEXT_WINDOW,
  'gpt-5.2': CODEX_DEFAULT_CONTEXT_WINDOW,
  'gpt-5.1-codex': CODEX_LONG_CONTEXT_WINDOW,
  'gpt-5-codex': CODEX_LONG_CONTEXT_WINDOW,
};
const CODEX_UNSUPPORTED_MODEL_PATTERNS = [
  /^gpt-image(?:-|$)/i,
  /^dall-e(?:-|$)/i,
  /^tts(?:-|$)/i,
  /^whisper(?:-|$)/i,
  /^text-embedding(?:-|$)/i,
  /^text-moderation(?:-|$)/i,
  /^omni-moderation(?:-|$)/i,
  /(?:^|[-_.])embedding(?:[-_.]|$)/i,
  /(?:^|[-_.])image(?:[-_.]|$)/i,
  /(?:^|[-_.])audio(?:[-_.]|$)/i,
  /(?:^|[-_.])realtime(?:[-_.]|$)/i,
];

export function isCodexExecutableModel(model) {
  const normalized = typeof model === 'string' ? model.trim() : '';
  if (!normalized || !/^[A-Za-z0-9._-]+$/.test(normalized)) {
    return false;
  }

  return !CODEX_UNSUPPORTED_MODEL_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function normalizeCodexStoredModelSelection(model) {
  const normalized = typeof model === 'string' ? model.trim() : '';

  if (!normalized || !isCodexExecutableModel(normalized)) {
    return CODEX_MODELS.DEFAULT;
  }

  // A valid stored value is an explicit user selection. Defaults are applied
  // only when storage is empty/invalid; never rewrite an older runnable model
  // merely because a newer default exists.
  return normalized;
}

export function isCodexModelSelection(model) {
  // Codex CLI delegates model resolution to the configured provider, but
  // modality-only models returned by /v1/models cannot run Codex agent turns.
  return isCodexExecutableModel(model);
}

export function getCodexModelContextWindow(model) {
  const normalized = typeof model === 'string' ? model.trim().toLowerCase() : '';
  return CODEX_MODEL_CONTEXT_WINDOWS[normalized] || CODEX_DEFAULT_CONTEXT_WINDOW;
}

export const CODEX_MODELS = {
  OPTIONS: [
    { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol (Current Default)', contextLength: CODEX_5_6_CONTEXT_WINDOW },
    { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', contextLength: CODEX_5_6_CONTEXT_WINDOW },
    { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', contextLength: CODEX_5_6_CONTEXT_WINDOW },
    { value: 'gpt-5.5', label: 'GPT-5.5', contextLength: CODEX_ONE_MILLION_CONTEXT_WINDOW },
    { value: 'gpt-5.4', label: 'GPT-5.4', contextLength: CODEX_ONE_MILLION_CONTEXT_WINDOW },
    { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', contextLength: CODEX_LONG_CONTEXT_WINDOW },
    { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', contextLength: CODEX_LONG_CONTEXT_WINDOW },
    { value: 'gpt-5.2', label: 'GPT-5.2', contextLength: CODEX_DEFAULT_CONTEXT_WINDOW },
  ],

  ALLOWS_CUSTOM: true,

  MODEL_ENDPOINT: '/api/settings/codex-models',

  CUSTOM_STORAGE_KEY: 'codex-custom-models',

  DEFAULT: CODEX_AUTO_DEFAULT_MODEL
};

// Non-agent OpenAI models used by bounded media workflows. Keep these here so
// routes and services never pin model ids independently.
export const OPENAI_MEDIA_MODELS = Object.freeze({
  TRANSCRIPTION: (typeof process !== 'undefined' && process.env?.OPENAI_TRANSCRIPTION_MODEL) || 'whisper-1',
  MEETING_SUMMARY: (typeof process !== 'undefined' && process.env?.OPENAI_MEETING_SUMMARY_MODEL) || 'gpt-4o-mini',
});

/**
 * Pi Runtime models are supplied by the authenticated server control plane.
 * Managed-free intentionally has no bundled public endpoint or credential;
 * deployments opt in and publish an allowlisted catalog at runtime.
 */
export const PI_MODEL_APIS = Object.freeze([
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
]);

export const PI_MODEL_PROVIDER_IDS = Object.freeze([
  'managed-free',
  'byok-openai-compatible',
  'byok-anthropic-compatible',
  'local-openai-compatible',
]);

export const PI_MODELS = Object.freeze({
  OPTIONS: Object.freeze([]),
  ALLOWS_CUSTOM: false,
  MODEL_ENDPOINT: '/api/pi/models',
  CUSTOM_STORAGE_KEY: 'pi-custom-models',
  DEFAULT: '',
});

/**
 * Local GPU Models (populated dynamically from Ollama)
 */
export const LOCAL_MODELS = {
  OPTIONS: [],

  IS_LOCAL: true,

  DEFAULT: ''
};
