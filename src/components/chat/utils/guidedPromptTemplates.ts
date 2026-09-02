import type { GuidedPromptScenario } from '../constants/guidedPromptScenarios';

function toCamelCase(value: string) {
  return value.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

export function getGuidedPromptKey(scenario: GuidedPromptScenario) {
  return scenario.autoRoutePromptKey
    || `guidedStarter.prompts.${toCamelCase(scenario.id)}`;
}

export function buildGuidedPromptTemplate(
  t: (key: string, options?: Record<string, unknown>) => string,
  scenario: GuidedPromptScenario,
  skills: readonly string[],
) {
  if (scenario.autoRoutePromptKey) {
    return t(scenario.autoRoutePromptKey);
  }

  const promptKey = getGuidedPromptKey(scenario);
  const prompt = t(promptKey, {
    scenario: t(scenario.titleKey),
    skills: skills.join(', '),
  });
  if (prompt !== promptKey) {
    return prompt;
  }

  return [
    t('guidedStarter.template.intro', {
      scenario: t(scenario.titleKey),
      skills: skills.join(', '),
    }),
    '',
  ].join('\n');
}
