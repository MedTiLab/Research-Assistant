import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../utils/api';
import {
  SKILL_WORKFLOW_CATEGORIES_UPDATED_EVENT,
  buildSkillWorkflowCategories,
  normalizeSkillIdentifier,
  parseSkillWorkflowCategoryConfig,
  type SkillWorkflowCategoryDefinition,
  type SkillWorkflowCategoryKey,
} from '../constants/skillWorkflowCategories';

type SkillMentionCandidate = {
  mention?: string;
  name?: string;
  dirPath?: string;
  sourcePath?: string;
};

type SkillWorkflowCategoryState = {
  categories: SkillWorkflowCategoryDefinition[];
  skillsByCategory: Record<SkillWorkflowCategoryKey, string[]>;
};

const initialCategories = buildSkillWorkflowCategories();

function visibleShortcutCategories(categories: SkillWorkflowCategoryDefinition[]): SkillWorkflowCategoryDefinition[] {
  return categories.filter((category) => category.key !== 'other' || category.skills.length > 0);
}

function toSkillsByCategory(categories: SkillWorkflowCategoryDefinition[]): Record<SkillWorkflowCategoryKey, string[]> {
  return Object.fromEntries(
    categories.map((category) => [category.key, [...category.skills]]),
  ) as Record<SkillWorkflowCategoryKey, string[]>;
}

function getInitialState(): SkillWorkflowCategoryState {
  return {
    categories: visibleShortcutCategories(initialCategories),
    skillsByCategory: toSkillsByCategory(initialCategories),
  };
}

export function useSkillWorkflowCategories(): SkillWorkflowCategoryState {
  const [state, setState] = useState<SkillWorkflowCategoryState>(() => getInitialState());

  const refresh = useCallback(async () => {
    try {
      const [configResponse, mentionsResponse] = await Promise.all([
        api.readGlobalSkillFile('skill-workflow-categories.json'),
        api.getSkillMentionCandidates(),
      ]);

      let assignments = new Map<string, SkillWorkflowCategoryKey>();
      let hiddenFromShortcuts = new Set<string>();
      if (configResponse.ok) {
        const payload = await configResponse.json();
        const config = JSON.parse(payload?.content || '{}');
        const parsed = parseSkillWorkflowCategoryConfig(config);
        assignments = parsed.assignments;
        hiddenFromShortcuts = parsed.hiddenFromShortcuts;
      }

      let installedSkills: Set<string> | undefined;
      if (mentionsResponse.ok) {
        const payload = await mentionsResponse.json();
        const candidates = Array.isArray(payload?.skills) ? payload.skills as SkillMentionCandidate[] : [];
        installedSkills = new Set<string>();
        for (const candidate of candidates) {
          [
            candidate.mention,
            candidate.name,
            candidate.dirPath,
            candidate.sourcePath,
          ].forEach((value) => {
            if (!value) return;
            installedSkills?.add(normalizeSkillIdentifier(value));
          });
        }
      }

      const categories = buildSkillWorkflowCategories(assignments, {
        installedSkills,
        hiddenFromShortcuts,
      });
      setState({
        categories: visibleShortcutCategories(categories),
        skillsByCategory: toSkillsByCategory(categories),
      });
    } catch {
      setState(getInitialState());
    }
  }, []);

  useEffect(() => {
    refresh();
    window.addEventListener(SKILL_WORKFLOW_CATEGORIES_UPDATED_EVENT, refresh);
    return () => {
      window.removeEventListener(SKILL_WORKFLOW_CATEGORIES_UPDATED_EVENT, refresh);
    };
  }, [refresh]);

  return state;
}
