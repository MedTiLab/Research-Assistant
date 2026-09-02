import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AttachedPrompt } from '../../types/types';
import { useSkillWorkflowCategories } from '../../hooks/useSkillWorkflowCategories';
import {
  getPrimaryShortcutSkills,
  getSecondaryShortcutSkills,
  type SkillWorkflowCategoryDefinition,
} from '../../constants/skillWorkflowCategories';

interface SkillShortcutsPanelProps {
  setInput: React.Dispatch<React.SetStateAction<string>>;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  setAttachedPrompt?: (prompt: AttachedPrompt | null) => void;
}

function buildCategoryPrompt(
  t: (key: string, options?: Record<string, unknown>) => string,
  category: SkillWorkflowCategoryDefinition,
  skills: readonly string[],
) {
  const promptKey = `skillShortcuts.prompts.${category.key}`;
  const prompt = t(promptKey, { skills: skills.join(', ') });
  return prompt !== promptKey ? prompt : t('skillShortcuts.promptMulti', { skills: skills.join(', ') });
}

export default function SkillShortcutsPanel({
  setInput,
  textareaRef,
  setAttachedPrompt,
}: SkillShortcutsPanelProps) {
  const { t } = useTranslation('chat');
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [advancedOpenByCategory, setAdvancedOpenByCategory] = useState<Record<string, boolean>>({});
  const [selectedSkillsByCategory, setSelectedSkillsByCategory] = useState<Record<string, string[]>>({});
  const { categories } = useSkillWorkflowCategories();

  const inject = (
    prompt: string,
    icon: string,
    title: string,
    categoryKey: string,
    localization: NonNullable<AttachedPrompt['localization']>,
  ) => {
    if (setAttachedPrompt) {
      setAttachedPrompt({
        scenarioId: `skill-${categoryKey}`,
        scenarioIcon: icon,
        scenarioTitle: title,
        promptText: prompt,
        localization,
      });
      setTimeout(() => textareaRef.current?.focus(), 100);
    } else {
      setInput(prev => prev ? `${prompt}\n\n${prev}` : prompt);
      setTimeout(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        const cursor = el.value.length;
        el.setSelectionRange(cursor, cursor);
      }, 100);
    }
  };

  const handleSingleSkillUse = (skill: string, category: SkillWorkflowCategoryDefinition) => {
    inject(
      t('skillShortcuts.promptSingle', { skill }),
      category.icon,
      t(`skillShortcuts.categories.${category.key}`),
      category.key,
      {
        promptKey: 'skillShortcuts.promptSingle',
        titleKey: `skillShortcuts.categories.${category.key}`,
        skill,
      },
    );
  };

  const toggleSkillSelection = (categoryKey: string, skill: string) => {
    setSelectedSkillsByCategory((prev) => {
      const current = prev[categoryKey] || [];
      const exists = current.includes(skill);
      const next = exists ? current.filter((item) => item !== skill) : [...current, skill];
      return { ...prev, [categoryKey]: next };
    });
  };

  const handleUseSelected = (category: SkillWorkflowCategoryDefinition) => {
    const selected = selectedSkillsByCategory[category.key] || [];
    if (selected.length === 0) {
      return;
    }
    inject(
      buildCategoryPrompt(t, category, selected),
      category.icon,
      t(`skillShortcuts.categories.${category.key}`),
      category.key,
      {
        promptKey: `skillShortcuts.prompts.${category.key}`,
        titleKey: `skillShortcuts.categories.${category.key}`,
        skills: selected,
      },
    );
  };

  const clearSelected = (categoryKey: string) => {
    setSelectedSkillsByCategory((prev) => ({ ...prev, [categoryKey]: [] }));
  };

  const handleUseAll = (category: SkillWorkflowCategoryDefinition) => {
    const primarySkills = getPrimaryShortcutSkills(category);
    const prompt = category.autoRoutePromptKey
      ? t(category.autoRoutePromptKey)
      : buildCategoryPrompt(t, category, primarySkills);
    inject(
      prompt,
      category.icon,
      t(`skillShortcuts.categories.${category.key}`),
      category.key,
      {
        promptKey: category.autoRoutePromptKey || `skillShortcuts.prompts.${category.key}`,
        titleKey: `skillShortcuts.categories.${category.key}`,
        skills: primarySkills,
      },
    );
  };

  return (
    <div className="relative w-full mt-2 mb-2">
      {!isCollapsed && <div className="absolute bottom-full left-0 right-0 z-20 mb-2 rounded-xl border border-border/60 bg-card/95 shadow-xl backdrop-blur">
        <div className="px-4 pt-4 pb-3">
        <div className="grid grid-cols-3 gap-2">
          {categories.map((cat) => {
            const isExpanded = expandedCategory === cat.key;
            const primarySkills = getPrimaryShortcutSkills(cat);
            const secondarySkillCount = getSecondaryShortcutSkills(cat, primarySkills).length;
            return (
              <button
                key={cat.key}
                onClick={() => setExpandedCategory(isExpanded ? null : cat.key)}
                className={`
                  flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-left transition-all duration-150
                  ${isExpanded
                    ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/10'
                    : 'border-border/50 bg-card/60 hover:bg-card hover:border-border/80'
                  }
                `}
              >
                <span className="text-sm leading-none flex-shrink-0">{cat.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground leading-snug">
                    {t(`skillShortcuts.categories.${cat.key}`)}
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                    {secondarySkillCount > 0
                      ? t('skillShortcuts.coreCount', { count: primarySkills.length, total: cat.skills.length })
                      : t('skillShortcuts.skillCount', { count: cat.skills.length })}
                  </p>
                </div>
                <ChevronDown className={`w-3 h-3 text-muted-foreground flex-shrink-0 transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`} />
              </button>
            );
          })}
        </div>

        {expandedCategory && (() => {
          const cat = categories.find((c) => c.key === expandedCategory);
          if (!cat) return null;
          const selectedSkills = selectedSkillsByCategory[cat.key] || [];
          const selectedCount = selectedSkills.length;
          const primarySkills = getPrimaryShortcutSkills(cat);
          const secondarySkills = getSecondaryShortcutSkills(cat, primarySkills);
          const showAdvanced = Boolean(advancedOpenByCategory[cat.key]);
          const visibleSkills = showAdvanced ? [...primarySkills, ...secondarySkills] : primarySkills;
          return (
            <div className="mt-3 p-3 rounded-xl border border-border/40 bg-muted/30">
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <span className="text-sm font-medium text-foreground">
                  {cat.icon} {t(`skillShortcuts.categories.${cat.key}`)}
                </span>
                <div className="flex items-center gap-1.5">
                  {selectedCount > 0 ? (
                    <button
                      onClick={() => clearSelected(cat.key)}
                      className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1 rounded-lg hover:bg-muted"
                    >
                      {t('skillShortcuts.clearSelected')}
                    </button>
                  ) : null}
                  <button
                    onClick={() => handleUseSelected(cat)}
                    disabled={selectedCount === 0}
                    className={`
                      text-xs font-medium transition-colors px-2.5 py-1 rounded-lg
                      ${selectedCount === 0
                        ? 'text-muted-foreground/60 bg-muted/60 cursor-not-allowed'
                        : 'text-primary hover:text-primary/80 hover:bg-primary/5'
                      }
                    `}
                  >
                    {t('skillShortcuts.useSelected', { count: selectedCount })}
                  </button>
                  <button
                    onClick={() => handleUseAll(cat)}
                    className="text-xs font-medium text-primary hover:text-primary/80 transition-colors px-2.5 py-1 rounded-lg hover:bg-primary/5"
                  >
                    {cat.autoRoutePromptKey ? t('skillShortcuts.useAutoRoute') : t('skillShortcuts.useCore')}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {visibleSkills.map((skill) => (
                  <div key={skill} className="flex items-center gap-1">
                    <button
                      onClick={() => toggleSkillSelection(cat.key, skill)}
                      className={`
                        px-3 py-1.5 text-xs font-medium rounded-full border transition-colors
                        ${selectedSkills.includes(skill)
                          ? 'border-primary/50 bg-primary/10 text-primary'
                          : 'border-border/50 bg-background hover:bg-muted hover:border-border text-foreground'
                        }
                      `}
                    >
                      {skill}
                    </button>
                    <button
                      onClick={() => handleSingleSkillUse(skill, cat)}
                      className="px-2 py-1.5 text-[11px] font-medium rounded-full border border-border/50 bg-background hover:bg-muted hover:border-border transition-colors text-muted-foreground"
                      title={t('skillShortcuts.useSingle')}
                    >
                      +
                    </button>
                  </div>
                ))}
              </div>
              {secondarySkills.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAdvancedOpenByCategory((prev) => ({
                    ...prev,
                    [cat.key]: !prev[cat.key],
                  }))}
                  className="mt-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showAdvanced
                    ? t('skillShortcuts.hideAdvanced')
                    : t('skillShortcuts.showAdvanced', { count: secondarySkills.length })}
                </button>
              )}
            </div>
          );
        })()}
        </div>
      </div>}

      <div className="rounded-xl border border-border/50 bg-card/60">
        <button
          onClick={() => setIsCollapsed((c) => !c)}
          className="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors rounded-xl"
        >
          <h3 className="text-base font-semibold text-foreground">
            {t('skillShortcuts.title')}
          </h3>
          {isCollapsed ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </button>
      </div>
    </div>
  );
}
