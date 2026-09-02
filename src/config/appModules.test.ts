import { describe, expect, it } from 'vitest';

import {
  APP_MODULES,
  getAppModuleIdForTab,
  getGlobalDefaultAppTab,
  getMedLibrarySection,
  getProjectDefaultAppTab,
  isAppModuleVisible,
  isAppTabVisible,
  isGlobalWorkspaceTab,
  isMedLibraryAppTab,
  resolveVisibleAppTab,
} from './appModules';

describe('app module registry', () => {
  it('keeps module ids and app tabs unique', () => {
    const moduleIds = APP_MODULES.map((module) => module.id);
    expect(new Set(moduleIds).size).toBe(moduleIds.length);

    const appTabs = APP_MODULES.flatMap((module) => module.tabs);
    expect(new Set(appTabs).size).toBe(appTabs.length);
  });

  it('maps every configured tab back to its module', () => {
    APP_MODULES.forEach((module) => {
      module.tabs.forEach((tab) => {
        expect(getAppModuleIdForTab(tab)).toBe(module.id);
      });
    });
  });

  it('redirects hidden tabs to a visible fallback when one exists', () => {
    APP_MODULES.forEach((module) => {
      module.tabs.forEach((tab) => {
        const resolvedTab = resolveVisibleAppTab(tab, { hasSelectedProject: module.scope === 'project' });
        expect(isAppTabVisible(resolvedTab) || resolvedTab === tab).toBe(true);
      });
    });
  });
});

describe('app module defaults', () => {
  it('opens the research secretary dashboard on the global home screen', () => {
    expect(getGlobalDefaultAppTab()).toBe('dashboard');
  });

  it('opens chat only after entering a project', () => {
    expect(getProjectDefaultAppTab()).toBe('chat');
  });

  it('hides the unused project overview page', () => {
    expect(isAppModuleVisible('projectProgress')).toBe(false);
    expect(isAppTabVisible('projectProgress')).toBe(false);
    expect(resolveVisibleAppTab('projectProgress')).toBe('dashboard');
  });

  it('keeps today tasks on Home instead of a separate page', () => {
    expect(isAppModuleVisible('today')).toBe(false);
    expect(isAppTabVisible('today')).toBe(false);
    expect(resolveVisibleAppTab('today')).toBe('dashboard');
  });

  it('hides the unused desktop companions page', () => {
    expect(isAppModuleVisible('companions')).toBe(false);
    expect(isAppTabVisible('companions')).toBe(false);
    expect(resolveVisibleAppTab('companions')).toBe('dashboard');
  });
});

describe('med library rail sections', () => {
  it('hides the resource library and variable pages from navigation', () => {
    expect(isAppTabVisible('medlibrary')).toBe(false);
    expect(isAppTabVisible('variableOverview')).toBe(false);
    expect(isAppTabVisible('variableKnowledgePubmedDiscovery')).toBe(false);
    expect(isAppTabVisible('skills')).toBe(true);
    expect(isAppTabVisible('memorySummary')).toBe(true);
  });

  it('maps each resource tab to its library section', () => {
    expect(getMedLibrarySection('medlibrary')).toBe('skills');
    expect(getMedLibrarySection('skills')).toBe('skills');
    expect(getMedLibrarySection('variableOverview')).toBe('variableOverview');
    expect(getMedLibrarySection('variableKnowledgePubmedDiscovery')).toBe('variableDiscovery');
    expect(getMedLibrarySection('memorySummary')).toBe('reports');
  });

  it('treats resource and activity tabs as global workspace surfaces', () => {
    expect(isMedLibraryAppTab('variableOverview')).toBe(true);
    expect(isMedLibraryAppTab('memorySummary')).toBe(true);
    expect(isGlobalWorkspaceTab('news')).toBe(true);
    expect(isGlobalWorkspaceTab('conversationHistory')).toBe(true);
    expect(isGlobalWorkspaceTab('submissions')).toBe(true);
    expect(isGlobalWorkspaceTab('automation')).toBe(true);
    expect(isGlobalWorkspaceTab('companions')).toBe(true);
    expect(isGlobalWorkspaceTab('miniApps')).toBe(true);
    expect(isGlobalWorkspaceTab('settings')).toBe(true);
    expect(isGlobalWorkspaceTab('chat')).toBe(false);
  });
});
