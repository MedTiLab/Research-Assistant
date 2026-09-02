import { useCallback, useMemo } from 'react';

import { useAuth } from '../contexts/AuthContext';

export const CAPABILITIES = {
  pi: 'agent.pi',
  claude: 'agent.claude',
  codex: 'agent.codex',
  fileReveal: 'workspace.file.reveal',
  fileExpand: 'workspace.file.expand',
  computeResources: 'compute.resources',
  skillCatalog: 'skills.catalog',
  researchTasks: 'research.tasks',
  researchPipeline: 'research.pipeline',
  literatureMonitor: 'literature.monitor',
  variableCatalog: 'variables.catalog',
  variableDiscovery: 'variables.discovery',
  persistentMemory: 'memory.persistent',
  projectMemorySummary: 'memory.project_summary',
  conversationArchive: 'conversations.archive',
} as const;

export type Capability = typeof CAPABILITIES[keyof typeof CAPABILITIES];

type EntitledUser = {
  membershipPlan?: string | null;
  effectivePlan?: string | null;
  capabilities?: string[] | null;
} | null;

export function useEntitlements() {
  const { user } = useAuth() as { user: EntitledUser };
  const effectivePlan = String(user?.effectivePlan || user?.membershipPlan || 'free').toLowerCase();
  const capabilities = useMemo(
    () => new Set(
      Array.isArray(user?.capabilities)
        ? user.capabilities
        : effectivePlan === 'pro'
          ? Object.values(CAPABILITIES)
          : [],
    ),
    [effectivePlan, user?.capabilities],
  );
  const can = useCallback((capability: Capability | string) => capabilities.has(capability), [capabilities]);

  return {
    can,
    capabilities,
    effectivePlan,
    isPro: effectivePlan === 'pro',
  };
}
