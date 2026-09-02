import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../utils/api';
import type { GuidedPromptScenario } from '../constants/guidedPromptScenarios';

interface SkillTreeNode {
  name: string;
  type: 'directory' | 'file';
  children?: SkillTreeNode[];
}

function normalizeSkillName(value: string) {
  return value.trim().toLowerCase();
}

function collectSkillNames(nodes: SkillTreeNode[]) {
  const discovered = new Set<string>();

  const collect = (children: SkillTreeNode[]) => {
    for (const node of children) {
      if (node.type !== 'directory') {
        continue;
      }
      const hasSkillMd = (node.children || []).some(
        (child) => child.type === 'file' && child.name === 'SKILL.md',
      );
      if (hasSkillMd) {
        discovered.add(normalizeSkillName(node.name));
      }
      if (Array.isArray(node.children) && node.children.length > 0) {
        collect(node.children);
      }
    }
  };

  collect(nodes);
  return discovered;
}

export function useGuidedPromptSkills() {
  const [availableSkills, setAvailableSkills] = useState<Set<string> | null>(null);
  const [isSkillInventoryLoaded, setIsSkillInventoryLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchSkills = async () => {
      try {
        const response = await api.getGlobalSkills();
        if (!response.ok) {
          if (!cancelled) {
            setIsSkillInventoryLoaded(true);
          }
          return;
        }

        const payload = (await response.json()) as SkillTreeNode[];
        if (!cancelled) {
          setAvailableSkills(collectSkillNames(payload));
          setIsSkillInventoryLoaded(true);
        }
      } catch {
        if (!cancelled) {
          setIsSkillInventoryLoaded(true);
        }
      }
    };

    fetchSkills();
    return () => {
      cancelled = true;
    };
  }, []);

  const getScenarioSkills = useCallback((scenario: GuidedPromptScenario) => {
    const matchedSkills = availableSkills
      ? scenario.skills.filter((skill) => availableSkills.has(normalizeSkillName(skill)))
      : [];
    return matchedSkills.length > 0 ? matchedSkills : scenario.skills;
  }, [availableSkills]);

  const isScenarioUsingFallback = useCallback((scenario: GuidedPromptScenario) => {
    if (!isSkillInventoryLoaded || !availableSkills) {
      return false;
    }
    return !scenario.skills.some((skill) => availableSkills.has(normalizeSkillName(skill)));
  }, [availableSkills, isSkillInventoryLoaded]);

  return {
    availableSkills,
    getScenarioSkills,
    isScenarioUsingFallback,
    isSkillInventoryLoaded,
  };
}
