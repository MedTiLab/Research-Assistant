import type { AttachedPrompt } from '../types/types';

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function localizeAttachedPrompt(
  t: Translate,
  prompt: AttachedPrompt,
): AttachedPrompt {
  const localization = prompt.localization;
  if (!localization) {
    return prompt;
  }

  const scenarioTitle = localization.titleKey
    ? t(localization.titleKey)
    : prompt.scenarioTitle;
  const promptText = t(localization.promptKey, {
    ...(localization.titleKey ? { scenario: scenarioTitle } : {}),
    ...(localization.skills ? { skills: localization.skills.join(', ') } : {}),
    ...(localization.skill ? { skill: localization.skill } : {}),
  });

  if (scenarioTitle === prompt.scenarioTitle && promptText === prompt.promptText) {
    return prompt;
  }

  return {
    ...prompt,
    scenarioTitle,
    promptText,
  };
}

/**
 * Guided prompts end with a short, localized label describing the input that
 * the selected scenario needs (for example, "Literature to download:"). Use
 * that label as the composer placeholder instead of the broader research-stage
 * placeholder while the prompt capsule is attached.
 */
export function getAttachedPromptInputPlaceholder(promptText: string): string | null {
  const lastLine = promptText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  if (!lastLine || lastLine.length > 120 || !/[:：]$/u.test(lastLine)) {
    return null;
  }

  return lastLine;
}
