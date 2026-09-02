import { useCallback, useEffect, useMemo, useState } from 'react';
import type React from 'react';
import type { TFunction } from 'i18next';
import { api } from '../../../utils/api';
import type { AgentSessionKey, Project, ProjectSession, SessionProvider } from '../../../types/app';
import type {
  AdditionalSessionsByProject,
  DeleteProjectConfirmation,
  LoadingSessionsByProject,
  ProjectSortOrder,
  SessionDeleteConfirmation,
  SessionWithProvider,
} from '../types/types';
import {
  getAllSessions,
  getSessionFavoriteKey,
  SIDEBAR_SESSION_PAGE_SIZE,
  loadManualProjectOrder,
  loadStarredProjects,
  loadStarredSessions,
  persistManualProjectOrder,
  persistProjectSortOrder,
  persistStarredProjects,
  persistStarredSessions,
  PROJECT_MANUAL_ORDER_STORAGE_KEY,
  PROJECT_ORDER_CHANGED_EVENT,
  readProjectSortOrder,
  sortProjects,
} from '../utils/utils';

type UseSidebarControllerArgs = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isLoading: boolean;
  isMobile: boolean;
  processingSessions?: Set<AgentSessionKey>;
  t: TFunction;
  onRefresh: () => Promise<void> | void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onSessionDelete?: (projectName: string, sessionId: string, provider: SessionProvider) => void;
  onProjectDelete?: (projectName: string) => void;
  setCurrentProject: (project: Project) => void;
  setSidebarVisible: (visible: boolean) => void;
  sidebarVisible: boolean;
};

export function useSidebarController({
  projects,
  selectedProject,
  selectedSession,
  isLoading,
  isMobile,
  processingSessions,
  t,
  onRefresh,
  onProjectSelect,
  onSessionSelect,
  onSessionDelete,
  onProjectDelete,
  setCurrentProject,
  setSidebarVisible,
  sidebarVisible,
}: UseSidebarControllerArgs) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [showNewProject, setShowNewProject] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [loadingSessions, setLoadingSessions] = useState<LoadingSessionsByProject>({});
  const [additionalSessions, setAdditionalSessions] = useState<AdditionalSessionsByProject>({});
  const [initialSessionsLoaded, setInitialSessionsLoaded] = useState<Set<string>>(new Set());
  const [projectSortOrder, setProjectSortOrder] = useState<ProjectSortOrder>(() => readProjectSortOrder());
  const [manualProjectOrder, setManualProjectOrder] = useState<string[]>(() => loadManualProjectOrder());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [projectHasMoreOverrides, setProjectHasMoreOverrides] = useState<Record<string, boolean>>({});
  const [editingSession, setEditingSession] = useState<string | null>(null);
  const [editingSessionName, setEditingSessionName] = useState('');
  const [deletingProjects, setDeletingProjects] = useState<Set<string>>(new Set());
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteProjectConfirmation | null>(null);
  const [sessionDeleteConfirmation, setSessionDeleteConfirmation] = useState<SessionDeleteConfirmation | null>(null);
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [starredProjects, setStarredProjects] = useState<Set<string>>(() => loadStarredProjects());
  const [starredSessions, setStarredSessions] = useState<Set<string>>(() => loadStarredSessions());

  const isSidebarCollapsed = !isMobile && !sidebarVisible;
  const projectMembershipKey = useMemo(
    () => projects.map((project) => project.name).sort().join('\u0000'),
    [projects],
  );

  useEffect(() => {
    const handleSessionListChanged = () => {
      void onRefresh();
    };
    window.addEventListener('medhelp-session-list-changed', handleSessionListChanged);
    return () => window.removeEventListener('medhelp-session-list-changed', handleSessionListChanged);
  }, [onRefresh]);

  useEffect(() => {
    setAdditionalSessions({});
    setInitialSessionsLoaded(new Set());
    setProjectHasMoreOverrides({});
  }, [projectMembershipKey]);

  useEffect(() => {
    if (selectedProject) {
      setExpandedProjects((prev) => {
        if (prev.has(selectedProject.name)) {
          return prev;
        }
        const next = new Set(prev);
        next.add(selectedProject.name);
        return next;
      });
    }
  }, [selectedSession, selectedProject]);

  useEffect(() => {
    if (projects.length > 0 && !isLoading) {
      const loadedProjects = new Set<string>();
      projects.forEach((project) => {
        if (project.sessions && project.sessions.length >= 0) {
          loadedProjects.add(project.name);
        }
      });
      setInitialSessionsLoaded(loadedProjects);
    }
  }, [projects, isLoading]);

  useEffect(() => {
    const loadProjectOrdering = () => {
      setProjectSortOrder(readProjectSortOrder());
      setManualProjectOrder(loadManualProjectOrder());
    };

    loadProjectOrdering();

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === 'claude-settings' || event.key === PROJECT_MANUAL_ORDER_STORAGE_KEY) {
        loadProjectOrdering();
      }
    };

    const handleProjectOrderChange = () => {
      loadProjectOrdering();
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener(PROJECT_ORDER_CHANGED_EVENT, handleProjectOrderChange);

    const interval = setInterval(() => {
      if (document.hasFocus()) {
        loadProjectOrdering();
      }
    }, 30000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener(PROJECT_ORDER_CHANGED_EVENT, handleProjectOrderChange);
      clearInterval(interval);
    };
  }, []);

  const handleTouchClick = useCallback(
    (callback: () => void) =>
      (event: React.TouchEvent<HTMLElement>) => {
        const target = event.target as HTMLElement;
        if (target.closest('.overflow-y-auto') || target.closest('[data-scroll-container]')) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        callback();
      },
    [],
  );

  const toggleProject = useCallback((projectName: string) => {
    setExpandedProjects((prev) => {
      const next = new Set<string>();
      if (!prev.has(projectName)) {
        next.add(projectName);
      }
      return next;
    });
  }, []);

  const handleSessionClick = useCallback(
    (session: SessionWithProvider, projectName: string) => {
      onSessionSelect({ ...session, __projectName: projectName });
    },
    [onSessionSelect],
  );

  const toggleStarProject = useCallback((projectName: string) => {
    setStarredProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectName)) {
        next.delete(projectName);
      } else {
        next.add(projectName);
      }

      persistStarredProjects(next);
      return next;
    });
  }, []);

  const isProjectStarred = useCallback(
    (projectName: string) => starredProjects.has(projectName),
    [starredProjects],
  );

  const toggleStarSession = useCallback((projectName: string, sessionId: string, provider: SessionProvider) => {
    const favoriteKey = getSessionFavoriteKey(projectName, sessionId, provider);
    setStarredSessions((previous) => {
      const next = new Set(previous);
      if (next.has(favoriteKey)) {
        next.delete(favoriteKey);
      } else {
        next.add(favoriteKey);
      }

      persistStarredSessions(next);
      return next;
    });
  }, []);

  const isSessionStarred = useCallback(
    (projectName: string, sessionId: string, provider: SessionProvider) => (
      starredSessions.has(getSessionFavoriteKey(projectName, sessionId, provider))
    ),
    [starredSessions],
  );

  const getProjectSessions = useCallback(
    (project: Project) => getAllSessions(project, additionalSessions, processingSessions, starredSessions),
    [additionalSessions, processingSessions, starredSessions],
  );

  const projectsWithSessionMeta = useMemo(
    () =>
      projects.map((project) => {
        const hasMoreOverride = projectHasMoreOverrides[project.name];
        if (hasMoreOverride === undefined) {
          return project;
        }

        return {
          ...project,
          sessionMeta: { ...project.sessionMeta, hasMore: hasMoreOverride },
        };
      }),
    [projectHasMoreOverrides, projects],
  );

  const sortedProjects = useMemo(
    () => sortProjects(
      projectsWithSessionMeta,
      projectSortOrder,
      starredProjects,
      additionalSessions,
      manualProjectOrder,
    ),
    [additionalSessions, manualProjectOrder, projectSortOrder, projectsWithSessionMeta, starredProjects],
  );

  const startEditing = useCallback((project: Project) => {
    setEditingProject(project.name);
    setEditingName(project.displayName);
  }, []);

  const cancelEditing = useCallback(() => {
    setEditingProject(null);
    setEditingName('');
  }, []);

  const saveProjectName = useCallback(
    async (projectName: string) => {
      try {
        const response = await api.renameProject(projectName, editingName);
        if (response.ok) {
          if (window.refreshProjects) {
            await window.refreshProjects();
          } else {
            console.warn('Project refresh is temporarily unavailable; the background watcher will synchronize it.');
          }
        } else {
          const errorText = await response.text().catch(() => '');
          let message = t('messages.renameProjectFailed');
          try {
            const parsed = errorText ? JSON.parse(errorText) : null;
            if (parsed?.error) {
              message = `${message}\n${parsed.error}`;
            }
          } catch {
            if (errorText.trim()) {
              message = `${message}\n${errorText.trim()}`;
            }
          }
          console.error('Failed to rename project', { status: response.status, error: errorText });
          alert(message);
        }
      } catch (error) {
        console.error('Error renaming project:', error);
        alert(t('messages.renameProjectError'));
      } finally {
        setEditingProject(null);
        setEditingName('');
      }
    },
    [editingName, t],
  );

  const showDeleteSessionConfirmation = useCallback(
    (
      projectName: string,
      sessionId: string,
      sessionTitle: string,
      provider: SessionDeleteConfirmation['provider'] = 'claude',
    ) => {
      setSessionDeleteConfirmation({ projectName, sessionId, sessionTitle, provider });
    },
    [],
  );

  const confirmDeleteSession = useCallback(async () => {
    if (!sessionDeleteConfirmation) {
      return;
    }

    const { projectName, sessionId, provider } = sessionDeleteConfirmation;
    setSessionDeleteConfirmation(null);

    try {
      const response = await api.deleteSession(projectName, sessionId, provider);

      if (response.ok) {
        setStarredSessions((previous) => {
          const favoriteKey = getSessionFavoriteKey(projectName, sessionId, provider);
          if (!previous.has(favoriteKey)) {
            return previous;
          }

          const next = new Set(previous);
          next.delete(favoriteKey);
          persistStarredSessions(next);
          return next;
        });
        onSessionDelete?.(projectName, sessionId, provider);
      } else {
        const errorText = await response.text();
        console.error('[Sidebar] Failed to delete session:', {
          status: response.status,
          error: errorText,
        });
        alert(t('messages.deleteSessionFailed'));
      }
    } catch (error) {
      console.error('[Sidebar] Error deleting session:', error);
      alert(t('messages.deleteSessionError'));
    }
  }, [onSessionDelete, sessionDeleteConfirmation, t]);

  const requestProjectDelete = useCallback(
    (project: Project) => {
      setDeleteConfirmation({
        project,
        sessionCount: getProjectSessions(project).length,
      });
    },
    [getProjectSessions],
  );

  const confirmDeleteProject = useCallback(async () => {
    if (!deleteConfirmation) {
      return;
    }

    const { project, sessionCount } = deleteConfirmation;
    const isEmpty = sessionCount === 0;

    // Optimistically remove from UI immediately to avoid flash
    setDeleteConfirmation(null);
    onProjectDelete?.(project.name);

    try {
      const response = await api.deleteProject(project.name, !isEmpty);

      if (!response.ok) {
        const error = (await response.json()) as { error?: string };
        if (window.refreshTrashProjects) {
          await window.refreshTrashProjects();
        } else {
          await onRefresh();
        }
        alert(error.error || t('messages.deleteProjectFailed'));
        return;
      }

      if (window.refreshTrashProjects) {
        await window.refreshTrashProjects();
      } else {
        await onRefresh();
      }
    } catch (error) {
      console.error('Error deleting project:', error);
      if (window.refreshTrashProjects) {
        await window.refreshTrashProjects();
      } else {
        await onRefresh();
      }
      alert(t('messages.deleteProjectError'));
    }
  }, [deleteConfirmation, onProjectDelete, onRefresh, t]);

  const loadMoreSessions = useCallback(
    async (project: Project) => {
      const hasMoreOverride = projectHasMoreOverrides[project.name];
      const canLoadMore =
        hasMoreOverride !== undefined ? hasMoreOverride : project.sessionMeta?.hasMore === true;
      if (!canLoadMore || loadingSessions[project.name]) {
        return;
      }

      setLoadingSessions((prev) => ({ ...prev, [project.name]: true }));

      try {
        const currentSessionCount =
          (project.sessions?.length || 0) + (additionalSessions[project.name]?.length || 0);
        const response = await api.sessions(project.name, SIDEBAR_SESSION_PAGE_SIZE, currentSessionCount);

        if (!response.ok) {
          return;
        }

        const result = (await response.json()) as {
          sessions?: ProjectSession[];
          hasMore?: boolean;
        };

        setAdditionalSessions((prev) => ({
          ...prev,
          [project.name]: [...(prev[project.name] || []), ...(result.sessions || [])],
        }));

        if (result.hasMore === false) {
          // Keep hasMore state in local hook state instead of mutating the project prop object.
          setProjectHasMoreOverrides((prev) => ({ ...prev, [project.name]: false }));
        }
      } catch (error) {
        console.error('Error loading more sessions:', error);
      } finally {
        setLoadingSessions((prev) => ({ ...prev, [project.name]: false }));
      }
    },
    [additionalSessions, loadingSessions, projectHasMoreOverrides],
  );

  const handleProjectSelect = useCallback(
    (project: Project) => {
      onProjectSelect(project);
      setCurrentProject(project);
    },
    [onProjectSelect, setCurrentProject],
  );

  const reorderProjects = useCallback(
    (draggedProjectName: string, targetProjectName: string, position: 'before' | 'after') => {
      if (draggedProjectName === targetProjectName) {
        return;
      }

      const currentOrder = sortedProjects.map((project) => project.name);
      if (!currentOrder.includes(draggedProjectName) || !currentOrder.includes(targetProjectName)) {
        return;
      }

      const nextOrder = currentOrder.filter((projectName) => projectName !== draggedProjectName);
      const targetIndex = nextOrder.indexOf(targetProjectName);
      if (targetIndex === -1) {
        return;
      }

      nextOrder.splice(position === 'before' ? targetIndex : targetIndex + 1, 0, draggedProjectName);

      setProjectSortOrder('manual');
      setManualProjectOrder(nextOrder);
      persistProjectSortOrder('manual');
      persistManualProjectOrder(nextOrder);
      window.dispatchEvent(new Event(PROJECT_ORDER_CHANGED_EVENT));
    },
    [sortedProjects],
  );

  const refreshProjects = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefresh]);

  const updateSessionSummary = useCallback(
    async (projectName: string, sessionId: string, summary: string, provider: SessionProvider = 'claude') => {
      try {
        const response = await api.renameSession(projectName, sessionId, summary, provider);
        if (response.ok) {
          if (window.refreshProjects) {
            await window.refreshProjects();
          } else {
            console.warn('Session refresh is temporarily unavailable; the background watcher will synchronize it.');
          }
        } else {
          console.error('Failed to rename session');
        }
      } catch (error) {
        console.error('Error renaming session:', error);
      } finally {
        setEditingSession(null);
        setEditingSessionName('');
      }
    },
    [],
  );

  const collapseSidebar = useCallback(() => {
    setSidebarVisible(false);
  }, [setSidebarVisible]);

  const expandSidebar = useCallback(() => {
    setSidebarVisible(true);
  }, [setSidebarVisible]);

  return {
    isSidebarCollapsed,
    expandedProjects,
    editingProject,
    showNewProject,
    editingName,
    loadingSessions,
    additionalSessions,
    initialSessionsLoaded,
    projectSortOrder,
    manualProjectOrder,
    isRefreshing,
    editingSession,
    editingSessionName,
    deletingProjects,
    deleteConfirmation,
    sessionDeleteConfirmation,
    showVersionModal,
    starredProjects,
    starredSessions,
    filteredProjects: sortedProjects,
    handleTouchClick,
    toggleProject,
    handleSessionClick,
    toggleStarProject,
    isProjectStarred,
    toggleStarSession,
    isSessionStarred,
    getProjectSessions,
    startEditing,
    cancelEditing,
    saveProjectName,
    showDeleteSessionConfirmation,
    confirmDeleteSession,
    requestProjectDelete,
    confirmDeleteProject,
    loadMoreSessions,
    handleProjectSelect,
    reorderProjects,
    refreshProjects,
    updateSessionSummary,
    collapseSidebar,
    expandSidebar,
    setShowNewProject,
    setEditingName,
    setEditingSession,
    setEditingSessionName,
    setDeleteConfirmation,
    setSessionDeleteConfirmation,
    setShowVersionModal,
  };
}
