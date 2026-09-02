import { userDb, userPreferenceMemoryDb } from '../database/db.js';
import { buildUserMemoryBlock } from '../user-memory/automatic-user-memory.js';

export const USER_PREFERENCE_MEMORY_MAX_ITEMS = 20;
export const USER_PREFERENCE_MEMORY_MAX_CONTENT_LENGTH = 300;
export const USER_PREFERENCE_MEMORY_CATEGORIES = ['general', 'preference', 'context', 'workflow'];
export const USER_PREFERENCE_MEMORY_SCOPES = ['user', 'project'];
export const ANALYSIS_LANGUAGE_PREFERENCES = ['auto', 'python', 'r'];

export function normalizeUserPreferenceMemoryCategory(category) {
  const normalized = typeof category === 'string' ? category.trim().toLowerCase() : '';
  return USER_PREFERENCE_MEMORY_CATEGORIES.includes(normalized) ? normalized : 'general';
}

export function normalizeUserPreferenceMemoryScope(scope) {
  const normalized = typeof scope === 'string' ? scope.trim().toLowerCase() : '';
  return USER_PREFERENCE_MEMORY_SCOPES.includes(normalized) ? normalized : 'user';
}

export function sanitizeUserPreferenceMemoryContent(content) {
  return String(content || '')
    .replace(/<\/?user_preferences>/gi, ' ')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeAnalysisLanguagePreference(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return ANALYSIS_LANGUAGE_PREFERENCES.includes(normalized) ? normalized : 'auto';
}

export function normalizeUserPreferenceProjectKey(projectKey, projectPath = null) {
  const explicitKey = typeof projectKey === 'string' ? projectKey.trim() : '';
  if (explicitKey) {
    return explicitKey;
  }

  const normalizedPath = typeof projectPath === 'string' ? projectPath.trim() : '';
  return normalizedPath.split(/[\\/]+/).filter(Boolean).pop() || '';
}

export function buildAnalysisLanguagePreferenceBlock(options = {}) {
  const analysisLanguage = normalizeAnalysisLanguagePreference(options.analysisLanguage);
  if (analysisLanguage === 'auto') {
    return '';
  }

  const preferenceLine = analysisLanguage === 'r'
    ? '- Prefer R for statistical analysis code, scripts, package choices, and runnable examples unless the user explicitly asks for another language.'
    : '- Prefer Python for data analysis code, scripts, package choices, and runnable examples unless the user explicitly asks for another language.';

  return [
    '<analysis_preferences>',
    'Preferred analysis language for this conversation:',
    preferenceLine,
    'Apply this only when the task involves code, data analysis, or an executable workflow.',
    '</analysis_preferences>',
  ].join('\n');
}

export function buildUserPreferenceMemoryBlock(userId, options = {}) {
  const normalizedUserId = Number(userId);
  const preferenceContext = options.preferenceContext && typeof options.preferenceContext === 'object'
    ? options.preferenceContext
    : null;
  const hasDatabaseUser = Number.isInteger(normalizedUserId) && normalizedUserId > 0;

  if (!preferenceContext && !hasDatabaseUser) {
    return '';
  }

  if (preferenceContext ? preferenceContext.enabled === false : !userPreferenceMemoryDb.getMemoryEnabled(normalizedUserId)) {
    return '';
  }

  const requestedLimit = Number.isFinite(options.maxItems)
    ? Math.floor(Number(options.maxItems))
    : 5;
  const maxItems = Math.max(1, Math.min(5, requestedLimit));
  const normalizedProjectPath = typeof options.projectPath === 'string' ? options.projectPath.trim() : '';
  const normalizedProjectKey = normalizeUserPreferenceProjectKey(options.projectKey, normalizedProjectPath);
  const profile = preferenceContext ? null : userDb.getProfile(normalizedUserId);
  const aboutYou = sanitizeUserPreferenceMemoryContent(
    preferenceContext ? preferenceContext.aboutYou : profile?.about_you,
  );
  const memories = preferenceContext
    ? (Array.isArray(preferenceContext.memories) ? preferenceContext.memories : [])
      .filter((memory) => {
        const scope = normalizeUserPreferenceMemoryScope(memory?.scope);
        if (scope !== 'project') {
          return true;
        }
        const memoryProjectPath = typeof memory?.projectPath === 'string'
          ? memory.projectPath.trim()
          : (typeof memory?.project_path === 'string' ? memory.project_path.trim() : '');
        const memoryProjectKey = normalizeUserPreferenceProjectKey(
          memory?.projectKey ?? memory?.project_key,
          memoryProjectPath,
        );
        return Boolean(
          (normalizedProjectKey && memoryProjectKey === normalizedProjectKey)
          || (normalizedProjectPath && memoryProjectPath === normalizedProjectPath)
        );
      })
      .slice(0, maxItems)
    : userPreferenceMemoryDb.getEnabled(normalizedUserId, {
      limit: maxItems,
      projectPath: normalizedProjectPath || null,
      projectKey: normalizedProjectKey || null,
    });

  if (!aboutYou && (!Array.isArray(memories) || memories.length === 0)) {
    return '';
  }

  const lines = ['<user_preferences>', 'Saved user preferences:'];

  if (aboutYou) {
    lines.push(`- [about_you] ${aboutYou}`);
  }

  for (const memory of memories) {
    const sanitizedContent = sanitizeUserPreferenceMemoryContent(memory?.content);
    if (!sanitizedContent) {
      continue;
    }

    const categoryPrefix = memory?.category && memory.category !== 'general'
      ? `[${memory.category}] `
      : '';
    const scopePrefix = memory?.scope === 'project'
      ? '[project] '
      : '';
    lines.push(`- ${scopePrefix}${categoryPrefix}${sanitizedContent}`);
  }

  if (lines.length <= 2) {
    return '';
  }

  lines.push('Honor these preferences when relevant, but always follow the user\'s explicit request first.');
  lines.push('</user_preferences>');

  return lines.join('\n');
}

export function prependUserPreferenceMemoryToPrompt(prompt, userId, options = {}) {
  const promptText = typeof prompt === 'string' ? prompt : '';
  const hasUserPreferencesBlock = /<user_preferences>[\s\S]*?(?:<\/user_preferences>|$)/i.test(promptText);
  const hasUserMemoryBlock = /<user_memory>[\s\S]*?(?:<\/user_memory>|$)/i.test(promptText);
  const hasAnalysisPreferencesBlock = /<analysis_preferences>[\s\S]*?(?:<\/analysis_preferences>|$)/i.test(promptText);
  const prefixBlocks = [];

  if (!hasAnalysisPreferencesBlock) {
    const analysisBlock = buildAnalysisLanguagePreferenceBlock({
      ...options,
      analysisLanguage: options.analysisLanguage
        || options.preferenceContext?.analysisLanguagePreference,
    });
    if (analysisBlock) {
      prefixBlocks.push(analysisBlock);
    }
  }

  if (!hasUserPreferencesBlock) {
    const memoryBlock = buildUserPreferenceMemoryBlock(userId, options);
    if (memoryBlock) {
      prefixBlocks.push(memoryBlock);
    }
  }

  if (!hasUserMemoryBlock) {
    const userMemoryBlock = buildUserMemoryBlock(userId, {
      memoryContext: options.userMemoryContext,
      query: promptText,
    });
    if (userMemoryBlock) {
      prefixBlocks.push(userMemoryBlock);
    }
  }

  if (prefixBlocks.length === 0) {
    return promptText;
  }

  const body = promptText.trim() || options.fallbackCommand || 'Continue with the current task.';
  return `${prefixBlocks.join('\n\n')}\n\n${body}`;
}
