import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CHAT_QUICK_ACTION_GROUPS,
  CHAT_QUICK_ACTION_SCENARIOS,
  type ChatQuickActionGroup,
  type GuidedPromptScenario,
} from '../../constants/guidedPromptScenarios';
import type { AttachedPrompt } from '../../types/types';
import { useGuidedPromptSkills } from '../../hooks/useGuidedPromptSkills';
import {
  buildGuidedPromptTemplate,
  getGuidedPromptKey,
} from '../../utils/guidedPromptTemplates';

interface GuidedPromptStarterProps {
  projectName: string;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  setAttachedPrompt?: (prompt: AttachedPrompt | null) => void;
  /** Retained for caller compatibility; quick actions are intentionally stage-independent. */
  currentStage?: number;
}

const QUICK_ACTION_ACCENTS: Record<string, string> = {
  'research-ideation': 'bg-amber-50 text-amber-600 dark:bg-amber-950/55 dark:text-amber-300',
  'read-paper': 'bg-green-50 text-green-600 dark:bg-green-950/55 dark:text-green-300',
  'paper-card': 'bg-lime-50 text-lime-700 dark:bg-lime-950/55 dark:text-lime-300',
  'verify-references': 'bg-sky-50 text-sky-600 dark:bg-sky-950/55 dark:text-sky-300',
  'deep-research': 'bg-cyan-50 text-cyan-600 dark:bg-cyan-950/55 dark:text-cyan-300',
  'writing-assistant': 'bg-purple-50 text-purple-600 dark:bg-purple-950/55 dark:text-purple-300',
  'make-presentation': 'bg-violet-50 text-violet-600 dark:bg-violet-950/55 dark:text-violet-300',
  'search-literature': 'bg-fuchsia-50 text-fuchsia-600 dark:bg-fuchsia-950/55 dark:text-fuchsia-300',
  'download-literature': 'bg-orange-50 text-orange-600 dark:bg-orange-950/55 dark:text-orange-300',
  'data-analysis': 'bg-blue-50 text-blue-600 dark:bg-blue-950/55 dark:text-blue-300',
  'research-design': 'bg-lime-50 text-lime-700 dark:bg-lime-950/55 dark:text-lime-300',
  'database-extraction': 'bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300',
  'experiment-log': 'bg-stone-100 text-stone-600 dark:bg-stone-900 dark:text-stone-300',
  'submit-manuscript': 'bg-rose-50 text-rose-600 dark:bg-rose-950/55 dark:text-rose-300',
  'proposal-writing': 'bg-amber-50 text-amber-700 dark:bg-amber-950/55 dark:text-amber-300',
  'paper-to-patent': 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/55 dark:text-yellow-300',
  'review-manuscript': 'bg-purple-50 text-purple-600 dark:bg-purple-950/55 dark:text-purple-300',
  'statistics-audit': 'bg-blue-50 text-blue-700 dark:bg-blue-950/55 dark:text-blue-300',
  'reply-reviewers': 'bg-rose-50 text-rose-700 dark:bg-rose-950/55 dark:text-rose-300',
  'scientific-figure': 'bg-cyan-50 text-cyan-600 dark:bg-cyan-950/55 dark:text-cyan-300',
  'mechanism-diagram': 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/55 dark:text-emerald-300',
  'graphical-abstract-quick': 'bg-violet-50 text-violet-600 dark:bg-violet-950/55 dark:text-violet-300',
  'mind-map': 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/55 dark:text-indigo-300',
  'today-tasks': 'bg-amber-50 text-amber-600 dark:bg-amber-950/55 dark:text-amber-300',
  'reply-advisor': 'bg-teal-50 text-teal-600 dark:bg-teal-950/55 dark:text-teal-300',
  'create-knowledge-base': 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/55 dark:text-indigo-300',
  'research-insights': 'bg-pink-50 text-pink-600 dark:bg-pink-950/55 dark:text-pink-300',
  'watch-news': 'bg-rose-50 text-rose-600 dark:bg-rose-950/55 dark:text-rose-300',
  'create-skill': 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/55 dark:text-emerald-300',
  'create-program': 'bg-sky-50 text-sky-600 dark:bg-sky-950/55 dark:text-sky-300',
  'create-automation': 'bg-orange-50 text-orange-600 dark:bg-orange-950/55 dark:text-orange-300',
};

export default function GuidedPromptStarter({
  projectName: _projectName,
  setInput,
  textareaRef,
  setAttachedPrompt,
}: GuidedPromptStarterProps) {
  const { t } = useTranslation(['chat', 'common']);
  const { getScenarioSkills } = useGuidedPromptSkills();
  const [activeGroupId, setActiveGroupId] = useState<ChatQuickActionGroup['id']>(CHAT_QUICK_ACTION_GROUPS[0].id);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [selectedSkillsByScenario, setSelectedSkillsByScenario] = useState<Record<string, string[]>>({});

  const injectTemplate = (scenario: GuidedPromptScenario, skills: string[]) => {
    const nextValue = buildGuidedPromptTemplate(t, scenario, skills);
    if (setAttachedPrompt) {
      setAttachedPrompt({
        scenarioId: scenario.id,
        scenarioIcon: scenario.icon,
        scenarioTitle: t(scenario.titleKey),
        promptText: nextValue,
        localization: {
          promptKey: getGuidedPromptKey(scenario),
          titleKey: scenario.titleKey,
          skills,
        },
      });
      setTimeout(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
      }, 100);
    } else {
      setInput(prev => prev ? `${nextValue}\n\n${prev}` : nextValue);
      setTimeout(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const cursor = el.value.length;
        el.setSelectionRange(cursor, cursor);
      }, 100);
    }
  };

  const handleScenarioSelect = (scenario: GuidedPromptScenario) => {
    const skills = getScenarioSkills(scenario);
    injectTemplate(scenario, skills);
    setSelectedSkillsByScenario((previous) => ({ ...previous, [scenario.id]: skills }));
    setSelectedScenarioId(skills.length > 0 ? scenario.id : null);
  };

  const activeScenario = selectedScenarioId
    ? CHAT_QUICK_ACTION_SCENARIOS.find((scenario) => scenario.id === selectedScenarioId) || null
    : null;
  const activeScenarioSkills = activeScenario ? getScenarioSkills(activeScenario) : [];
  const activeSelectedSkills = activeScenario
    ? (selectedSkillsByScenario[activeScenario.id] || []).filter((skill) => activeScenarioSkills.includes(skill))
    : [];

  const toggleSkillSelection = (scenarioId: string, skill: string) => {
    setSelectedSkillsByScenario((previous) => {
      const current = previous[scenarioId] || [];
      const next = current.includes(skill)
        ? current.filter((item) => item !== skill)
        : [...current, skill];
      return { ...previous, [scenarioId]: next };
    });
  };

  const applySelectedSkills = () => {
    if (!activeScenario) return;
    injectTemplate(activeScenario, activeSelectedSkills);
    setSelectedScenarioId(null);
  };

  const activeGroup = CHAT_QUICK_ACTION_GROUPS.find((group) => group.id === activeGroupId)
    || CHAT_QUICK_ACTION_GROUPS[0];
  const activeGroupScenarios = activeGroup.scenarioIds
    .map((scenarioId) => CHAT_QUICK_ACTION_SCENARIOS.find((scenario) => scenario.id === scenarioId))
    .filter((scenario): scenario is GuidedPromptScenario => Boolean(scenario));

  return (
    <div className="medhelp-guided-prompt-starter relative z-30 mx-auto mt-2 w-full max-w-5xl px-4 pb-2 sm:pb-4 md:pb-6">
      <div className="overflow-x-auto pb-1">
        <div className="flex w-full min-w-max gap-1 rounded-full border border-border/45 bg-muted/30 p-1">
          {CHAT_QUICK_ACTION_GROUPS.map((group) => (
            <button
              key={group.id}
              type="button"
              onClick={() => {
                setActiveGroupId(group.id);
                setSelectedScenarioId(null);
              }}
              aria-pressed={activeGroupId === group.id}
              className={`flex-1 whitespace-nowrap rounded-full px-3 py-2 text-sm font-semibold transition-colors ${
                activeGroupId === group.id
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(group.titleKey)}
            </button>
          ))}
        </div>
      </div>

      <section className="mt-2 rounded-2xl border border-border/45 bg-muted/25 px-2 py-4 dark:bg-white/[0.025] sm:px-3 sm:py-5">
        <div className="flex w-full flex-wrap items-stretch">
          {activeGroupScenarios.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              onClick={() => handleScenarioSelect(scenario)}
              title={t(scenario.descriptionKey)}
              className="group flex min-w-[5.75rem] flex-1 flex-col items-center gap-2 px-2 py-1 text-center text-foreground transition-colors hover:text-foreground"
            >
              <span
                className={`flex h-12 w-12 items-center justify-center rounded-full text-xl shadow-sm transition-all duration-150 group-hover:-translate-y-0.5 group-hover:shadow-md group-active:scale-95 sm:h-14 sm:w-14 sm:text-2xl ${QUICK_ACTION_ACCENTS[scenario.id]}`}
              >
                {scenario.icon}
              </span>
              <span className="max-w-[7.5rem] text-sm font-semibold leading-5">
                {t(scenario.titleKey)}
              </span>
            </button>
          ))}
        </div>
      </section>

      {activeScenario && (
        <div className="mt-2 rounded-2xl border border-border/55 bg-card/95 px-4 py-3 shadow-lg shadow-black/5 backdrop-blur-md dark:bg-neutral-950/95">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {activeScenario.icon} {t(activeScenario.titleKey)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('guidedStarter.selectSkillsHint')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedScenarioId(null)}
              className="rounded-full px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {t('guidedStarter.closeSkillPicker')}
            </button>
          </div>

          <div className="mt-3 flex max-h-32 flex-wrap gap-2 overflow-y-auto">
            {activeScenarioSkills.map((skill) => {
              const isSelected = activeSelectedSkills.includes(skill);
              return (
                <button
                  key={skill}
                  type="button"
                  onClick={() => toggleSkillSelection(activeScenario.id, skill)}
                  aria-pressed={isSelected}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                    isSelected
                      ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                      : 'border-border/60 bg-background text-muted-foreground hover:border-primary/35 hover:text-foreground'
                  }`}
                >
                  {skill}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={applySelectedSkills}
              className="rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              {t('guidedStarter.applySelectedSkills', { count: activeSelectedSkills.length })}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
