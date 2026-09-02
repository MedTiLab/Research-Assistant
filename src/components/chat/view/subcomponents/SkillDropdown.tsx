import React, { useEffect, useMemo, useRef, useState } from 'react';

import type { AttachedPrompt } from '../../types/types';
import {
  CHAT_QUICK_ACTION_GROUPS,
  CHAT_QUICK_ACTION_SCENARIOS,
  type GuidedPromptScenario,
} from '../../constants/guidedPromptScenarios';
import { useGuidedPromptSkills } from '../../hooks/useGuidedPromptSkills';
import {
  buildGuidedPromptTemplate,
  getGuidedPromptKey,
} from '../../utils/guidedPromptTemplates';

interface SkillDropdownProps {
  setInput: React.Dispatch<React.SetStateAction<string>>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  setAttachedPrompt?: React.Dispatch<React.SetStateAction<AttachedPrompt | null>>;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export default function SkillDropdown({
  setInput,
  textareaRef,
  setAttachedPrompt,
  t,
}: SkillDropdownProps) {
  const [open, setOpen] = useState(false);
  const [expandedScenarioId, setExpandedScenarioId] = useState<string | null>(null);
  const [selectedSkillsByScenario, setSelectedSkillsByScenario] = useState<Record<string, string[]>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    getScenarioSkills,
    isScenarioUsingFallback,
    isSkillInventoryLoaded,
  } = useGuidedPromptSkills();

  const shortcutGroups = useMemo(
    () => CHAT_QUICK_ACTION_GROUPS.map((group) => ({
      ...group,
      scenarios: group.scenarioIds
        .map((scenarioId) => CHAT_QUICK_ACTION_SCENARIOS.find((scenario) => scenario.id === scenarioId))
        .filter((scenario): scenario is GuidedPromptScenario => Boolean(scenario?.skills.length)),
    })).filter((group) => group.scenarios.length > 0),
    [],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setExpandedScenarioId(null);
      }
    };

    if (open) {
      document.addEventListener('mousedown', handlePointerDown);
    }

    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const inject = (scenario: GuidedPromptScenario, skills: string[], useSelectedSkills = false) => {
    const promptScenario = useSelectedSkills
      ? { ...scenario, autoRoutePromptKey: undefined }
      : scenario;
    const prompt = buildGuidedPromptTemplate(t, promptScenario, skills);

    if (setAttachedPrompt) {
      setAttachedPrompt({
        scenarioId: scenario.id,
        scenarioIcon: scenario.icon,
        scenarioTitle: t(scenario.titleKey),
        promptText: prompt,
        localization: {
          promptKey: getGuidedPromptKey(promptScenario),
          titleKey: scenario.titleKey,
          skills,
        },
      });
      setTimeout(() => textareaRef.current?.focus(), 100);
    } else {
      setInput((previous) => previous ? `${prompt}\n\n${previous}` : prompt);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }

    setOpen(false);
    setExpandedScenarioId(null);
  };

  const toggleSkillSelection = (scenarioId: string, skill: string) => {
    setSelectedSkillsByScenario((prev) => {
      const current = prev[scenarioId] || [];
      const exists = current.includes(skill);
      const next = exists ? current.filter((item) => item !== skill) : [...current, skill];
      return { ...prev, [scenarioId]: next };
    });
  };

  const clearSelected = (scenarioId: string) => {
    setSelectedSkillsByScenario((prev) => ({ ...prev, [scenarioId]: [] }));
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border/50 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-all duration-150"
      >
        <span>⚡</span>
        <span>{t('skillShortcuts.title')}</span>
        <svg className="w-3 h-3 text-muted-foreground/60 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 bottom-full mb-1 left-0 w-72 max-h-[360px] bg-popover border border-border rounded-xl shadow-xl overflow-y-auto">
          {shortcutGroups.map((group) => (
            <section key={group.id} className="border-b border-border/45 last:border-b-0">
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
                {t(group.titleKey)}
              </div>

              <div className="px-2 pb-2">
                {group.scenarios.map((scenario) => {
                  const isScenarioExpanded = expandedScenarioId === scenario.id;
                  const scenarioSkills = getScenarioSkills(scenario);
                  const selectedSkills = (selectedSkillsByScenario[scenario.id] || [])
                    .filter((skill) => scenarioSkills.includes(skill));
                  const selectedCount = selectedSkills.length;

                  return (
                    <div key={scenario.id} className="rounded-lg">
                      <button
                        type="button"
                        onClick={() => setExpandedScenarioId(isScenarioExpanded ? null : scenario.id)}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors ${
                          isScenarioExpanded ? 'bg-primary/8 text-foreground font-medium' : 'text-muted-foreground hover:bg-muted/50'
                        }`}
                      >
                        <span className="text-sm leading-none">{scenario.icon}</span>
                        <span className="min-w-0 flex-1 truncate">{t(scenario.titleKey)}</span>
                        <span className="text-[9px] text-muted-foreground/60">
                          {scenario.autoRoutePromptKey ? t('skillShortcuts.useAutoRoute') : scenarioSkills.length}
                        </span>
                      </button>

                      {isScenarioExpanded && (
                        <div className="px-2 pb-2">
                          {isSkillInventoryLoaded && isScenarioUsingFallback(scenario) && (
                            <p className="mb-2 text-[10px] leading-4 text-muted-foreground">
                              {t('guidedStarter.noAvailableSkillsFallback')}
                            </p>
                          )}

                          <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                            {scenarioSkills.map((skill) => {
                              const isSelected = selectedSkills.includes(skill);
                              return (
                                <div key={skill} className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => toggleSkillSelection(scenario.id, skill)}
                                    aria-pressed={isSelected}
                                    className={`rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                                      isSelected
                                        ? 'border-primary/50 bg-primary/10 text-primary'
                                        : 'border-border/50 bg-background text-foreground hover:border-border hover:bg-muted'
                                    }`}
                                  >
                                    {skill}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => inject(scenario, [skill], true)}
                                    className="rounded-full border border-border/50 bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
                                    title={t('skillShortcuts.useSingle')}
                                  >
                                    +
                                  </button>
                                </div>
                              );
                            })}
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {selectedCount > 0 && (
                              <button
                                type="button"
                                onClick={() => clearSelected(scenario.id)}
                                className="rounded-full px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                              >
                                {t('skillShortcuts.clearSelected')}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => inject(scenario, selectedSkills, true)}
                              disabled={selectedCount === 0}
                              className={`rounded-full px-2 py-1 text-[10px] font-medium transition-colors ${
                                selectedCount === 0
                                  ? 'cursor-not-allowed bg-muted/60 text-muted-foreground/60'
                                  : 'text-primary hover:bg-primary/5 hover:text-primary/80'
                              }`}
                            >
                              {t('skillShortcuts.useSelected', { count: selectedCount })}
                            </button>
                            <button
                              type="button"
                              onClick={() => inject(scenario, scenarioSkills)}
                              className="rounded-full px-2 py-1 text-[10px] font-medium text-primary transition-colors hover:bg-primary/5 hover:text-primary/80"
                            >
                              {scenario.autoRoutePromptKey ? t('guidedStarter.useAutoRoute') : t('guidedStarter.useAllSkills')}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
