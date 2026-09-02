import type { TFunction } from 'i18next';
import type { AgentSessionKey, Project } from '../../../types/app';
import { hasClientAgentSession } from '../../../utils/agentSessionIdentity';
import { stripInternalContextPrefix } from '../../../utils/sessionFormatting';
import type {
  AdditionalSessionsByProject,
  ProjectSortOrder,
  SettingsProject,
  SessionViewModel,
  SessionWithProvider,
} from '../types/types';

export const PROJECT_MANUAL_ORDER_STORAGE_KEY = 'med-help.projectManualOrder';
export const PROJECT_ORDER_CHANGED_EVENT = 'med-help-project-order-changed';
export const STARRED_SESSIONS_STORAGE_KEY = 'med-help.starredSessions';
export const SIDEBAR_SESSION_PAGE_SIZE = 5;

export const getSidebarVisibleSessionCount = ({
  sessionCount,
  revealedCount,
  selectedIndex,
  pageSize = SIDEBAR_SESSION_PAGE_SIZE,
}: {
  sessionCount: number;
  revealedCount: number;
  selectedIndex: number;
  pageSize?: number;
}): number => {
  if (sessionCount <= 0) {
    return 0;
  }

  const selectedVisibleCount = selectedIndex >= 0 ? selectedIndex + 1 : 0;
  return Math.min(sessionCount, Math.max(pageSize, revealedCount, selectedVisibleCount));
};

const isProjectSortOrder = (value: unknown): value is ProjectSortOrder =>
  value === 'name' || value === 'date' || value === 'manual';

export const readProjectSortOrder = (): ProjectSortOrder => {
  try {
    const rawSettings = localStorage.getItem('claude-settings');
    if (!rawSettings) {
      return 'date';
    }

    const settings = JSON.parse(rawSettings) as { projectSortOrder?: ProjectSortOrder };
    return isProjectSortOrder(settings.projectSortOrder) ? settings.projectSortOrder : 'date';
  } catch {
    return 'date';
  }
};

export const persistProjectSortOrder = (projectSortOrder: ProjectSortOrder) => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    const rawSettings = localStorage.getItem('claude-settings');
    const settings = rawSettings ? JSON.parse(rawSettings) as Record<string, unknown> : {};
    localStorage.setItem(
      'claude-settings',
      JSON.stringify({
        ...settings,
        projectSortOrder,
        lastUpdated: new Date().toISOString(),
      }),
    );
  } catch {
    try {
      localStorage.setItem(
        'claude-settings',
        JSON.stringify({
          projectSortOrder,
          lastUpdated: new Date().toISOString(),
        }),
      );
    } catch {
      // Keep UI responsive even if storage fails.
    }
  }
};

export const loadManualProjectOrder = (): string[] => {
  try {
    const saved = localStorage.getItem(PROJECT_MANUAL_ORDER_STORAGE_KEY);
    if (!saved) {
      return [];
    }

    const parsed = JSON.parse(saved) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((projectName): projectName is string => typeof projectName === 'string');
  } catch {
    return [];
  }
};

export const persistManualProjectOrder = (projectNames: string[]) => {
  try {
    const uniqueProjectNames = [...new Set(projectNames)];
    localStorage.setItem(PROJECT_MANUAL_ORDER_STORAGE_KEY, JSON.stringify(uniqueProjectNames));
  } catch {
    // Keep UI responsive even if storage fails.
  }
};

export const loadStarredProjects = (): Set<string> => {
  try {
    const saved = localStorage.getItem('starredProjects');
    return saved ? new Set<string>(JSON.parse(saved)) : new Set<string>();
  } catch {
    return new Set<string>();
  }
};

export const persistStarredProjects = (starredProjects: Set<string>) => {
  try {
    localStorage.setItem('starredProjects', JSON.stringify([...starredProjects]));
  } catch {
    // Keep UI responsive even if storage fails.
  }
};

export const getSessionFavoriteKey = (
  projectName: string,
  sessionId: string,
  provider: string,
): string => JSON.stringify([projectName, provider, sessionId]);

export const loadStarredSessions = (): Set<string> => {
  try {
    const saved = localStorage.getItem(STARRED_SESSIONS_STORAGE_KEY);
    if (!saved) {
      return new Set<string>();
    }

    const parsed = JSON.parse(saved) as unknown;
    return Array.isArray(parsed)
      ? new Set(parsed.filter((key): key is string => typeof key === 'string'))
      : new Set<string>();
  } catch {
    return new Set<string>();
  }
};

export const persistStarredSessions = (starredSessions: Set<string>) => {
  try {
    localStorage.setItem(STARRED_SESSIONS_STORAGE_KEY, JSON.stringify([...starredSessions]));
  } catch {
    // Keep UI responsive even if storage fails.
  }
};

export const getSessionDate = (session: SessionWithProvider): Date => {
  if (session.__provider === 'codex' || session.__provider === 'pi') {
    return new Date(session.lastActivity || session.createdAt || 0);
  }

  return new Date(session.lastActivity || 0);
};

export const getSessionName = (session: SessionWithProvider, t: TFunction): string => {
  const name = session.summary || session.name || t('projects.newSession');
  return stripInternalContextPrefix(name) || t('projects.newSession');
};

export const getSessionMode = (session: SessionWithProvider) => {
  if (session.mode === 'workspace_qa' || session.mode === 'research') {
    return session.mode;
  }

  if (typeof window !== 'undefined' && session.__projectName) {
    const storedMode = window.localStorage.getItem(`session_mode_${session.__projectName}_${session.id}`);
    if (storedMode === 'workspace_qa') {
      return 'workspace_qa';
    }
  }

  return 'research';
};

export const createSessionViewModel = (
  session: SessionWithProvider,
  t: TFunction,
): SessionViewModel => {
  return {
    isCodexSession: session.__provider === 'codex',
    isActive: Boolean(session.__isProcessing),
    sessionName: getSessionName(session, t),
    messageCount: Number(session.messageCount || 0),
    mode: getSessionMode(session),
  };
};

export const getAllSessions = (
  project: Project,
  additionalSessions: AdditionalSessionsByProject,
  processingSessions: Set<AgentSessionKey> = new Set(),
  starredSessions: Set<string> = new Set(),
): SessionWithProvider[] => {
  const runtimeSessions = Array.isArray(project.runtimeSessions) ? project.runtimeSessions : null;
  const persistedPiSessions = runtimeSessions
    ? runtimeSessions.filter((session) => (session.__provider || session.runtimeId) === 'pi')
    : (project.piSessions || []);
  const piSessions = [
    ...persistedPiSessions,
    ...(additionalSessions[project.name] || []).filter((session) => (
      !session.__provider || session.__provider === 'pi'
    )),
  ].map((session) => ({
    ...session,
    __provider: 'pi' as const,
    __projectName: project.name,
    __isProcessing: hasClientAgentSession(processingSessions, session.id, {
      projectKey: project.name,
      runtimeId: 'pi',
    }),
  }));

  return piSessions
    .filter((session) => session.mode !== 'consultation')
    .sort((a, b) => {
      const aStarred = starredSessions.has(getSessionFavoriteKey(project.name, a.id, a.__provider));
      const bStarred = starredSessions.has(getSessionFavoriteKey(project.name, b.id, b.__provider));
      if (aStarred !== bStarred) {
        return aStarred ? -1 : 1;
      }

      return getSessionDate(b).getTime() - getSessionDate(a).getTime();
    });
};

export const getProjectLastActivity = (
  project: Project,
  additionalSessions: AdditionalSessionsByProject,
): Date => {
  const sessions = getAllSessions(project, additionalSessions);
  if (sessions.length === 0) {
    if (project.createdAt) {
      return new Date(project.createdAt);
    }
    return new Date();
  }

  const latestSession = sessions.reduce((latest, session) => {
    const sessionDate = getSessionDate(session);
    return sessionDate > latest ? sessionDate : latest;
  }, new Date(0));

  // A project's creation time may be newer than its oldest session activity.
  // Use whichever is more recent so that freshly created projects with no
  // activity don't sink below older projects that happen to share the same day.
  if (project.createdAt) {
    const created = new Date(project.createdAt);
    return created > latestSession ? created : latestSession;
  }

  return latestSession;
};

export const sortProjects = (
  projects: Project[],
  projectSortOrder: ProjectSortOrder,
  starredProjects: Set<string>,
  additionalSessions: AdditionalSessionsByProject,
  manualProjectOrder: string[] = [],
): Project[] => {
  const defaultProjects = projects.filter((project) => project.isDefaultWorkspace === true);
  const byName = projects.filter((project) => project.isDefaultWorkspace !== true);
  const effectiveProjectSortOrder = projectSortOrder === 'manual' ? 'date' : projectSortOrder;

  if (projectSortOrder === 'manual' && manualProjectOrder.length > 0) {
    const manualOrderIndex = new Map<string, number>();
    manualProjectOrder.forEach((projectName, index) => {
      if (!manualOrderIndex.has(projectName)) {
        manualOrderIndex.set(projectName, index);
      }
    });

    byName.sort((projectA, projectB) => {
      const aStarred = starredProjects.has(projectA.name);
      const bStarred = starredProjects.has(projectB.name);

      if (aStarred && !bStarred) {
        return -1;
      }

      if (!aStarred && bStarred) {
        return 1;
      }

      const projectAIndex = manualOrderIndex.get(projectA.name);
      const projectBIndex = manualOrderIndex.get(projectB.name);
      const projectAIsOrdered = projectAIndex !== undefined;
      const projectBIsOrdered = projectBIndex !== undefined;

      if (projectAIsOrdered && projectBIsOrdered) {
        return projectAIndex - projectBIndex;
      }

      // Projects missing from the saved manual order are newly added or restored.
      // Keep them visible at the top of their starred/non-starred group.
      if (!projectAIsOrdered && projectBIsOrdered) {
        return -1;
      }

      if (projectAIsOrdered && !projectBIsOrdered) {
        return 1;
      }

      return (
        getProjectLastActivity(projectB, additionalSessions).getTime() -
        getProjectLastActivity(projectA, additionalSessions).getTime()
      );
    });

    return [...defaultProjects, ...byName];
  }

  byName.sort((projectA, projectB) => {
    const aStarred = starredProjects.has(projectA.name);
    const bStarred = starredProjects.has(projectB.name);

    if (aStarred && !bStarred) {
      return -1;
    }

    if (!aStarred && bStarred) {
      return 1;
    }

    if (effectiveProjectSortOrder === 'date') {
      return (
        getProjectLastActivity(projectB, additionalSessions).getTime() -
        getProjectLastActivity(projectA, additionalSessions).getTime()
      );
    }

    return (projectA.displayName || projectA.name).localeCompare(projectB.displayName || projectB.name);
  });

  return [...defaultProjects, ...byName];
};

export const projectMatchesSearch = (project: Project, normalizedSearch: string): boolean => {
  if (!normalizedSearch) {
    return true;
  }

  const displayName = (project.displayName || project.name).toLowerCase();
  const projectName = project.name.toLowerCase();
  return displayName.includes(normalizedSearch) || projectName.includes(normalizedSearch);
};

export const sessionMatchesSearch = (
  session: SessionWithProvider,
  normalizedSearch: string,
  t: TFunction,
): boolean => {
  if (!normalizedSearch) {
    return true;
  }

  return getSessionName(session, t).toLowerCase().includes(normalizedSearch);
};

export const filterProjects = (projects: Project[], searchFilter: string): Project[] => {
  const normalizedSearch = searchFilter.trim().toLowerCase();
  if (!normalizedSearch) {
    return projects;
  }

  return projects.filter((project) => projectMatchesSearch(project, normalizedSearch));
};

export const normalizeProjectForSettings = (project: Project): SettingsProject => {
  const fallbackPath =
    typeof project.fullPath === 'string' && project.fullPath.length > 0
      ? project.fullPath
      : typeof project.path === 'string'
      ? project.path
      : '';

  return {
    name: project.name,
    displayName:
      typeof project.displayName === 'string' && project.displayName.trim().length > 0
        ? project.displayName
        : project.name,
    fullPath: fallbackPath,
    path:
      typeof project.path === 'string' && project.path.length > 0
        ? project.path
        : fallbackPath,
  };
};
