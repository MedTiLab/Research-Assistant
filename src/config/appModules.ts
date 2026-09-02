import type { AppTab } from '../types/app';

export type AppModuleId =
  | 'dashboard'
  | 'projectProgress'
  | 'today'
  | 'submissions'
  | 'thesis'
  | 'dailyReview'
  | 'meetings'
  | 'advisor'
  | 'automation'
  | 'companions'
  | 'miniApps'
  | 'settings'
  | 'medlibrary'
  | 'news'
  | 'conversationHistory'
  | 'chat'
  | 'context'
  | 'survey'
  | 'files'
  | 'git'
  | 'trash';

export type AppModuleScope = 'global' | 'project' | 'system';

export type AppModuleDefinition = {
  id: AppModuleId;
  labelKey: string;
  scope: AppModuleScope;
  tabs: readonly AppTab[];
  visible: boolean;
  hiddenTabs?: readonly AppTab[];
  description: string;
};

/**
 * Frontend module registry.
 *
 * To hide a module during development, set `visible` to `false` below.
 * Vite hot module replacement updates the rendered navigation immediately.
 * Packaged builds still need to be rebuilt after changing this file.
 */
export const APP_MODULES: readonly AppModuleDefinition[] = [
  {
    id: 'dashboard',
    labelKey: 'common:tabs.dashboard',
    scope: 'global',
    tabs: ['dashboard'],
    visible: true,
    description: 'Cross-project research operations dashboard.',
  },
  {
    id: 'projectProgress',
    labelKey: 'common:tabs.projectProgress',
    scope: 'global',
    tabs: ['projectProgress'],
    visible: false,
    description: 'Retired project overview page. Kept hidden so persisted tabs redirect to Home.',
  },
  {
    id: 'today',
    labelKey: 'common:tabs.today',
    scope: 'global',
    tabs: ['today'],
    visible: false,
    description: 'Retired today page. Today tasks now live on Home; persisted tabs redirect there.',
  },
  {
    id: 'submissions',
    labelKey: 'common:tabs.submissions',
    scope: 'global',
    tabs: ['submissions'],
    visible: true,
    description: 'Durable manuscript submission tracking and revision deadlines.',
  },
  {
    id: 'thesis',
    labelKey: 'common:tabs.thesis',
    scope: 'global',
    tabs: ['thesis'],
    visible: true,
    description: 'Graduate thesis chapters, milestones, and progress logs.',
  },
  {
    id: 'dailyReview',
    labelKey: 'common:tabs.dailyReview',
    scope: 'global',
    tabs: ['dailyReview'],
    visible: true,
    description: 'Today status, work and focus records, habits, and daily review.',
  },
  {
    id: 'meetings',
    labelKey: 'common:tabs.meetings',
    scope: 'global',
    tabs: ['meetings'],
    visible: true,
    description: 'Research meetings and presentation preparation.',
  },
  {
    id: 'advisor',
    labelKey: 'common:tabs.advisor',
    scope: 'global',
    tabs: ['advisor'],
    visible: true,
    description: 'Advisor feedback, action items, and follow-up deadlines.',
  },
  {
    id: 'automation',
    labelKey: 'common:tabs.automation',
    scope: 'global',
    tabs: ['automation'],
    visible: true,
    description: 'Research secretary automations and run history.',
  },
  {
    id: 'companions',
    labelKey: 'common:tabs.companions',
    scope: 'global',
    tabs: ['companions'],
    visible: false,
    description: 'Retired desktop companions page. Kept hidden so persisted tabs redirect to Home.',
  },
  {
    id: 'miniApps',
    labelKey: 'common:tabs.miniApps',
    scope: 'global',
    tabs: ['miniApps'],
    visible: true,
    description: 'Personal sandboxed research apps that can be created, imported, opened, copied, and exported.',
  },
  {
    id: 'medlibrary',
    labelKey: 'common:tabs.medlibrary',
    scope: 'global',
    tabs: ['medlibrary', 'skills', 'variableOverview', 'variableKnowledgePubmedDiscovery', 'memorySummary'],
    visible: true,
    hiddenTabs: ['medlibrary', 'variableOverview', 'variableKnowledgePubmedDiscovery'],
    description: 'Resource library, variable discovery, reports, database list, and skills list.',
  },
  {
    id: 'news',
    labelKey: 'common:tabs.news',
    scope: 'global',
    tabs: ['news'],
    visible: true,
    description: 'Literature monitor and research news dashboard.',
  },
  {
    id: 'conversationHistory',
    labelKey: 'common:tabs.conversationHistory',
    scope: 'global',
    tabs: ['conversationHistory'],
    visible: true,
    description: 'Account-scoped conversation archive available across devices.',
  },
  {
    id: 'chat',
    labelKey: 'common:tabs.chat',
    scope: 'project',
    tabs: ['chat'],
    visible: true,
    description: 'Evidence and analysis chat workspace.',
  },
  {
    id: 'context',
    labelKey: 'common:tabs.context',
    scope: 'project',
    tabs: ['context'],
    visible: true,
    description: 'Session context panel and injected context review.',
  },
  {
    id: 'survey',
    labelKey: 'common:tabs.survey',
    scope: 'project',
    tabs: ['survey'],
    visible: true,
    description: 'Evidence review, project papers, literature graphs, and notes.',
  },
  {
    id: 'files',
    labelKey: 'common:tabs.files',
    scope: 'project',
    tabs: ['files', 'preview'],
    visible: true,
    description: 'Project file tree, file preview, and file editing surface.',
  },
  {
    id: 'git',
    labelKey: 'common:tabs.git',
    scope: 'project',
    tabs: ['git'],
    visible: false,
    description: 'Version control panel for project changes.',
  },
  {
    id: 'settings',
    labelKey: 'common:tabs.settings',
    scope: 'system',
    tabs: ['settings'],
    visible: true,
    description: 'Account, appearance, agents, and workspace settings.',
  },
  {
    id: 'trash',
    labelKey: 'common:tabs.trash',
    scope: 'system',
    tabs: ['trash'],
    visible: true,
    description: 'Trash dashboard for deleted projects and sessions.',
  },
];

export const GLOBAL_FALLBACK_TABS: readonly AppTab[] = [
  'dashboard',
  'projectProgress',
  'today',
  'submissions',
  'thesis',
  'dailyReview',
  'news',
  'meetings',
  'advisor',
  'automation',
  'companions',
  'miniApps',
  'conversationHistory',
  'trash',
];
export const PROJECT_FALLBACK_TABS: readonly AppTab[] = ['chat', 'context', 'survey', 'files', 'git'];

export const MED_LIBRARY_APP_TABS: readonly AppTab[] = [
  'medlibrary',
  'skills',
  'variableOverview',
  'variableKnowledgePubmedDiscovery',
  'memorySummary',
];

export type MedLibrarySection = 'skills' | 'variableOverview' | 'variableDiscovery' | 'reports';

export function isMedLibraryAppTab(tab: AppTab): boolean {
  return (MED_LIBRARY_APP_TABS as readonly string[]).includes(tab);
}

export function getMedLibrarySection(tab: AppTab): MedLibrarySection {
  if (tab === 'variableOverview') return 'variableOverview';
  if (tab === 'variableKnowledgePubmedDiscovery') return 'variableDiscovery';
  if (tab === 'memorySummary') return 'reports';
  return 'skills';
}

export function isGlobalWorkspaceTab(tab: AppTab): boolean {
  return tab === 'dashboard'
    || tab === 'projectProgress'
    || tab === 'today'
    || tab === 'submissions'
    || tab === 'thesis'
    || tab === 'dailyReview'
    || tab === 'meetings'
    || tab === 'advisor'
    || tab === 'automation'
    || tab === 'companions'
    || tab === 'miniApps'
    || tab === 'settings'
    || tab === 'trash'
    || tab === 'news'
    || tab === 'conversationHistory'
    || isMedLibraryAppTab(tab);
}

const MODULES_BY_ID = APP_MODULES.reduce((accumulator, module) => {
  accumulator[module.id] = module;
  return accumulator;
}, {} as Record<AppModuleId, AppModuleDefinition>);

const TAB_TO_MODULE_ID = APP_MODULES.reduce((accumulator, module) => {
  module.tabs.forEach((tab) => {
    accumulator[tab] = module.id;
  });
  return accumulator;
}, {} as Partial<Record<AppTab, AppModuleId>>);

export function getAppModuleDefinition(moduleId: AppModuleId) {
  return MODULES_BY_ID[moduleId];
}

export function getVisibleAppModules(scope?: AppModuleScope) {
  return APP_MODULES.filter((module) => module.visible && (!scope || module.scope === scope));
}

export function isAppModuleVisible(moduleId: AppModuleId) {
  return MODULES_BY_ID[moduleId]?.visible !== false;
}

export function getAppModuleIdForTab(tab: AppTab) {
  return TAB_TO_MODULE_ID[tab] ?? null;
}

export function isAppTabVisible(tab: AppTab) {
  const moduleId = getAppModuleIdForTab(tab);
  if (!moduleId) {
    return true;
  }
  const module = MODULES_BY_ID[moduleId];
  if (module.visible === false) {
    return false;
  }
  return !module.hiddenTabs?.includes(tab);
}

export function getVisibleAppTabs() {
  return APP_MODULES.flatMap((module) => (
    module.visible
      ? module.tabs.filter((tab) => !module.hiddenTabs?.includes(tab))
      : []
  ));
}

export function getGlobalDefaultAppTab() {
  return GLOBAL_FALLBACK_TABS.find(isAppTabVisible) ?? 'dashboard';
}

export function getProjectDefaultAppTab() {
  return PROJECT_FALLBACK_TABS.find(isAppTabVisible) ?? getGlobalDefaultAppTab();
}

export function resolveVisibleAppTab(
  requestedTab: AppTab,
  options: { hasSelectedProject?: boolean } = {},
): AppTab {
  if (isAppTabVisible(requestedTab)) {
    return requestedTab;
  }

  const fallbackTabs = options.hasSelectedProject
    ? [...PROJECT_FALLBACK_TABS, ...GLOBAL_FALLBACK_TABS]
    : GLOBAL_FALLBACK_TABS;

  return fallbackTabs.find(isAppTabVisible) ?? requestedTab;
}
