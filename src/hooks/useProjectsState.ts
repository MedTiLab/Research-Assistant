import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import { api } from '../utils/api';
import { queueWorkspaceQaDraft } from '../utils/workspaceQa';
import { formatWorkbenchCommandPrompt, type WorkbenchCommand } from '../features/research-secretary/domain/workbenchCommand';
import { queueReferenceChatDraft } from '../utils/referenceChatDraft';
import {
  createChatDraftOpenRequest,
  type ChatDraftOpenRequest,
  type ProjectFileChatContextItem,
} from '../utils/projectFileChatContext';
import { queueChatPromptDraftDeferred } from '../utils/chatPromptDraft';
import type { ChatPromptDraft } from '../utils/chatPromptDraft';
import { getChatMessagesStorageKey, safeLocalStorage } from '../components/chat/utils/chatStorage';
import {
  getGlobalDefaultAppTab,
  getProjectDefaultAppTab,
  isAppTabVisible,
  resolveVisibleAppTab,
} from '../config/appModules';
import { useOptionalLocalKernel } from '../state/localKernelStore';
import { setActiveLocalKernel } from '../services/localKernelConnection';
import {
  projectsSnapshotPreservesSelection,
  shouldRefreshSelectedSession,
} from './projectSessionRealtime';
import { shouldBlockProjectsFetch } from './projectLoading';
import {
  createClientAgentSessionKey,
  hasClientAgentSession,
} from '../utils/agentSessionIdentity';
import {
  isConversationFolderProject,
  resolvePreferredConversationFolder,
} from '../utils/draftProject';
import type { Reference } from '../components/references/types';
import { formatReferenceChatPrompt } from '../components/references/types';
import type {
  AppSocketMessage,
  AppTab,
  AgentSessionKey,
  ImportedProjectAnalysisPrompt,
  LoadingProgress,
  ProjectCreationOptions,
  Project,
  ProjectSession,
  ProjectSessionV2,
  ProjectsUpdatedMessage,
  PendingAutoIntake,
  SessionMode,
  SessionProvider,
  SessionTag,
  TrashProject,
  TrashSession,
} from '../types/app';

declare global {
  interface Window {
    handleProjectCreatedWithIntake?: (project: Project, options?: ProjectCreationOptions) => void;
    refreshProjects?: () => Promise<void>;
    refreshTrashProjects?: () => Promise<void>;
    refreshTrashSessions?: () => Promise<void>;
  }
}

const SESSION_MODE_STORAGE_KEY = 'med-help-new-session-mode';
const LEGACY_SESSION_MODE_STORAGE_KEYS = ['dr-claw-new-session-mode'];
const LAST_CONVERSATION_FOLDER_STORAGE_KEY = 'med-help-last-conversation-folder';

const isSessionMode = (value: string | null | undefined): value is SessionMode =>
  value === 'research' || value === 'workspace_qa' || value === 'consultation';

const readStoredNewSessionMode = (): SessionMode => {
  return 'research';
};

const persistNewSessionMode = (mode: SessionMode) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(SESSION_MODE_STORAGE_KEY, mode);
  LEGACY_SESSION_MODE_STORAGE_KEYS.forEach((key) => window.sessionStorage.removeItem(key));
};

type UseProjectsStateArgs = {
  sessionId?: string;
  navigate: NavigateFunction;
  latestMessage: AppSocketMessage | null;
  isMobile: boolean;
  activeSessions: Set<AgentSessionKey>;
  processingSessions: Set<AgentSessionKey>;
};

type SessionTagsUpdatedDetail = {
  projectName: string;
  sessionId: string;
  provider?: SessionProvider;
  tags: SessionTag[];
};

const serialize = (value: unknown) => JSON.stringify(value ?? null);

const projectsHaveChanges = (
  prevProjects: Project[],
  nextProjects: Project[],
  includeExternalSessions: boolean,
): boolean => {
  if (prevProjects.length !== nextProjects.length) {
    return true;
  }

  return nextProjects.some((nextProject, index) => {
    const prevProject = prevProjects[index];
    if (!prevProject) {
      return true;
    }

    const baseChanged =
      nextProject.name !== prevProject.name ||
      nextProject.displayName !== prevProject.displayName ||
      nextProject.fullPath !== prevProject.fullPath ||
      nextProject.isConversationWorkspace !== prevProject.isConversationWorkspace ||
      serialize(nextProject.sessionMeta) !== serialize(prevProject.sessionMeta) ||
      serialize(nextProject.sessions) !== serialize(prevProject.sessions) ||
      serialize(nextProject.runtimeSessions) !== serialize(prevProject.runtimeSessions);

    if (baseChanged) {
      return true;
    }

    if (!includeExternalSessions) {
      return false;
    }

    return (
      serialize(nextProject.codexSessions) !== serialize(prevProject.codexSessions) ||
      serialize(nextProject.piSessions) !== serialize(prevProject.piSessions) ||
      serialize(nextProject.openrouterSessions) !== serialize(prevProject.openrouterSessions) ||
      serialize(nextProject.localSessions) !== serialize(prevProject.localSessions)
    );
  });
};

const isProjectArray = (value: unknown): value is Project[] => Array.isArray(value);

const getProjectSessions = (project: Project): ProjectSession[] => {
  if (Array.isArray(project.runtimeSessions)) {
    return project.runtimeSessions;
  }

  return [
    ...(project.sessions ?? []),
    ...(project.codexSessions ?? []),
    ...(project.piSessions ?? []),
    ...(project.openrouterSessions ?? []),
    ...(project.localSessions ?? []),
  ];
};

const matchesSessionIdentity = (
  session: ProjectSession,
  detail: SessionTagsUpdatedDetail,
  providerHint?: SessionProvider,
): boolean => {
  if (session.id !== detail.sessionId) {
    return false;
  }

  if (!detail.provider) {
    return true;
  }

  return (session.__provider || providerHint || 'claude') === detail.provider;
};

const applySessionTagsToList = (
  sessions: ProjectSession[] | undefined,
  detail: SessionTagsUpdatedDetail,
  providerHint: SessionProvider,
): ProjectSession[] | undefined => {
  if (!Array.isArray(sessions)) {
    return sessions;
  }

  let changed = false;
  const nextSessions = sessions.map((session) => {
    if (!matchesSessionIdentity(session, detail, providerHint)) {
      return session;
    }

    if (serialize(session.tags) === serialize(detail.tags)) {
      return session;
    }

    changed = true;
    return {
      ...session,
      tags: detail.tags,
    };
  });

  return changed ? nextSessions : sessions;
};

const applySessionTagsToProject = (
  project: Project,
  detail: SessionTagsUpdatedDetail,
): Project => {
  if (!project || project.name !== detail.projectName) {
    return project;
  }

  const nextClaudeSessions = applySessionTagsToList(project.sessions, detail, 'claude');
  const nextCodexSessions = applySessionTagsToList(project.codexSessions, detail, 'codex');
  const nextPiSessions = applySessionTagsToList(project.piSessions, detail, 'pi');
  const nextOpenrouterSessions = applySessionTagsToList(project.openrouterSessions, detail, 'openrouter');
  const nextLocalSessions = applySessionTagsToList(project.localSessions, detail, 'local');
  const nextRuntimeSessions = applySessionTagsToList(project.runtimeSessions, detail, 'claude') as
    | ProjectSessionV2[]
    | undefined;

  if (
    nextClaudeSessions === project.sessions &&
    nextCodexSessions === project.codexSessions &&
    nextPiSessions === project.piSessions &&
    nextOpenrouterSessions === project.openrouterSessions &&
    nextLocalSessions === project.localSessions &&
    nextRuntimeSessions === project.runtimeSessions
  ) {
    return project;
  }

  return {
    ...project,
    sessions: nextClaudeSessions,
    codexSessions: nextCodexSessions,
    piSessions: nextPiSessions,
    openrouterSessions: nextOpenrouterSessions,
    localSessions: nextLocalSessions,
    runtimeSessions: nextRuntimeSessions,
  };
};

  const buildTransientSession = (
    sessionId: string,
    provider: ProjectSession['__provider'] = 'pi',
    projectName?: string,
  ): ProjectSession => ({
    id: sessionId,
    name: 'Auto Research Session',
    summary: 'Auto Research Session',
    mode: 'research',
    __provider: provider,
    __projectName: projectName,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  });

export function useProjectsState({
  sessionId,
  navigate,
  latestMessage,
  isMobile,
  activeSessions,
  processingSessions,
}: UseProjectsStateArgs) {
  const localKernel = useOptionalLocalKernel();
  const [projects, setProjects] = useState<Project[]>([]);
  const consumedProjectMessageRef = useRef<AppSocketMessage | null>(null);
  const [trashProjects, setTrashProjects] = useState<TrashProject[]>([]);
  const [trashSessions, setTrashSessions] = useState<TrashSession[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedSession, setSelectedSession] = useState<ProjectSession | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>(() => getGlobalDefaultAppTab());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [isLoadingTrashProjects, setIsLoadingTrashProjects] = useState(false);
  const [isLoadingTrashSessions, setIsLoadingTrashSessions] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState<LoadingProgress | null>(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState('user');
  const [externalMessageUpdate, setExternalMessageUpdate] = useState(0);
  const [newSessionResetKey, setNewSessionResetKey] = useState(0);
  const [pendingAutoIntake, setPendingAutoIntake] = useState<PendingAutoIntake | null>(null);
  const [importedProjectAnalysisPrompt, setImportedProjectAnalysisPrompt] = useState<ImportedProjectAnalysisPrompt | null>(null);
  const [newSessionMode, setNewSessionMode] = useState<SessionMode>(() => readStoredNewSessionMode());
  const [draftOpenRequest, setDraftOpenRequest] = useState<ChatDraftOpenRequest>({
    requestKey: 0,
    projectName: null,
    projectFiles: [],
  });

  const loadingProgressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectsUpdateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectsReconcileTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectsReconcileAttemptsRef = useRef(0);
  const fetchProjectsRef = useRef<(() => Promise<void>) | null>(null);
  const pendingDraftProjectRef = useRef<Project | null>(null);
  const pendingProjectsMessageRef = useRef<ProjectsUpdatedMessage | null>(null);
  const fetchProjectsSeqRef = useRef(0);
  const lastSyncedRouteSessionIdRef = useRef<string | null>(null);
  const hasCompletedInitialProjectsFetchRef = useRef(false);
  const localKernelIsRequired = Boolean(localKernel?.isRequired);
  const localKernelEndpoint = localKernel?.state === 'connected' ? localKernel.endpoint : null;
  const localKernelSessionToken = localKernel?.state === 'connected' ? localKernel.sessionToken : null;
  const localKernelProjectSourceKey =
    localKernelEndpoint?.httpBaseUrl && localKernelSessionToken
      ? `${localKernelEndpoint.httpBaseUrl}:${localKernelSessionToken}`
      : null;
  const selectedProjectRef = useRef<Project | null>(selectedProject);
  const selectedSessionRef = useRef<ProjectSession | null>(selectedSession);
  selectedProjectRef.current = selectedProject;
  selectedSessionRef.current = selectedSession;

  useEffect(() => {
    projectsReconcileAttemptsRef.current = 0;
  }, [selectedProject?.name, selectedSession?.id, selectedSession?.__provider]);

  const scheduleProjectsReconcile = useCallback(() => {
    if (projectsReconcileTimeoutRef.current || projectsReconcileAttemptsRef.current >= 4) {
      return;
    }

    projectsReconcileAttemptsRef.current += 1;
    const delay = 250 * projectsReconcileAttemptsRef.current;
    projectsReconcileTimeoutRef.current = setTimeout(() => {
      projectsReconcileTimeoutRef.current = null;
      void fetchProjectsRef.current?.();
    }, delay);
  }, []);

  const prepareProjectsApiRoute = useCallback(() => {
    if (localKernelEndpoint && localKernelSessionToken) {
      setActiveLocalKernel(localKernelEndpoint, localKernelSessionToken);
      return true;
    }

    return !localKernelIsRequired;
  }, [localKernelEndpoint, localKernelIsRequired, localKernelSessionToken]);

  const recordProjectOpen = useCallback((project: Project | null | undefined, source = 'project_select') => {
    if (!project?.name) {
      return;
    }

    void api.user.recordProjectOpen(project, source).catch((error) => {
      console.warn('Failed to record project activity:', error);
    });
  }, []);

  const rememberConversationFolder = useCallback((project: Project | null | undefined) => {
    if (isConversationFolderProject(project)) {
      safeLocalStorage.setItem(LAST_CONVERSATION_FOLDER_STORAGE_KEY, project.name);
    }
  }, []);

  const beginFreshDraft = useCallback((
    projectName: string,
    projectFiles: ProjectFileChatContextItem[] = [],
  ) => {
    safeLocalStorage.removeItem(getChatMessagesStorageKey({ projectName }));
    safeLocalStorage.removeItem(`draft_input_${projectName}`);
    setDraftOpenRequest((current) => createChatDraftOpenRequest(current, projectName, projectFiles));
  }, []);

  const fetchProjects = useCallback(async () => {
    const seq = fetchProjectsSeqRef.current + 1;
    const shouldBlockUi = shouldBlockProjectsFetch(hasCompletedInitialProjectsFetchRef.current);
    fetchProjectsSeqRef.current = seq;
    try {
      if (shouldBlockUi) {
        setIsLoadingProjects(true);
      }
      if (!prepareProjectsApiRoute()) {
        return;
      }

      const projectsResponse = await api.projects();
      if (!projectsResponse.ok) {
        throw new Error(`Failed to fetch projects: ${projectsResponse.status}`);
      }
      const projectData = (await projectsResponse.json()) as Project[];
      if (!isProjectArray(projectData)) {
        throw new Error('Projects API returned a non-array payload');
      }
      if (fetchProjectsSeqRef.current !== seq) {
        return;
      }

      if (!projectsSnapshotPreservesSelection(
        projectData,
        selectedProjectRef.current,
        selectedSessionRef.current,
      )) {
        scheduleProjectsReconcile();
        return;
      }

      projectsReconcileAttemptsRef.current = 0;

      void api.auth.reportProjectCount(projectData.length).catch((error) => {
        console.warn('Failed to report current project count:', error);
      });

      setProjects((prevProjects) => {
        if (prevProjects.length === 0) {
          return projectData;
        }

        return projectsHaveChanges(prevProjects, projectData, true)
          ? projectData
          : prevProjects;
      });
      setSelectedProject((prevProject) => {
        if (!prevProject) {
          return prevProject;
        }

        const refreshedProject = projectData.find((project) => project.name === prevProject.name);
        if (!refreshedProject) {
          return prevProject;
        }

        return serialize(refreshedProject) !== serialize(prevProject)
          ? refreshedProject
          : prevProject;
      });
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      if (fetchProjectsSeqRef.current === seq) {
        hasCompletedInitialProjectsFetchRef.current = true;
        if (shouldBlockUi) {
          setIsLoadingProjects(false);
        }
      }
    }
  }, [prepareProjectsApiRoute, scheduleProjectsReconcile]);
  fetchProjectsRef.current = fetchProjects;

  const fetchTrashProjects = useCallback(async () => {
    try {
      setIsLoadingTrashProjects(true);
      const response = await api.trashedProjects();
      if (!response.ok) {
        return;
      }

      const trashData = (await response.json()) as TrashProject[];
      setTrashProjects(trashData);
    } catch (error) {
      console.error('Error fetching trashed projects:', error);
    } finally {
      setIsLoadingTrashProjects(false);
    }
  }, []);

  const fetchTrashSessions = useCallback(async () => {
    try {
      setIsLoadingTrashSessions(true);
      const response = await api.trashedSessions();
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as TrashSession[];
      setTrashSessions(data);
    } catch (error) {
      console.error('Error fetching trashed sessions:', error);
    } finally {
      setIsLoadingTrashSessions(false);
    }
  }, []);

  useEffect(() => {
    if (localKernelIsRequired && !localKernelProjectSourceKey) {
      return;
    }

    void fetchProjects();
  }, [fetchProjects, localKernelIsRequired, localKernelProjectSourceKey]);

  useEffect(() => {
    if (activeTab === 'trash') {
      void fetchTrashProjects();
      void fetchTrashSessions();
    }
  }, [activeTab, fetchTrashProjects, fetchTrashSessions]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.refreshTrashSessions = async () => {
      await fetchTrashSessions();
    };
    return () => {
      if (window.refreshTrashSessions) {
        delete window.refreshTrashSessions;
      }
    };
  }, [fetchTrashSessions]);

  // TODO: Replace CustomEvent-based session-tags-updated with a shared state
  // manager (e.g., Zustand store or React context) to avoid global event bus coupling.
  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleSessionTagsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<SessionTagsUpdatedDetail>).detail;
      if (
        !detail
        || !detail.projectName
        || !detail.sessionId
        || !Array.isArray(detail.tags)
      ) {
        return;
      }

      setProjects((prevProjects) => {
        let changed = false;
        const nextProjects = prevProjects.map((project) => {
          const updatedProject = applySessionTagsToProject(project, detail);
          if (updatedProject !== project) {
            changed = true;
          }
          return updatedProject;
        });
        return changed ? nextProjects : prevProjects;
      });

      setSelectedProject((prevProject) => {
        if (!prevProject) {
          return prevProject;
        }

        const nextProject = applySessionTagsToProject(prevProject, detail);
        return nextProject;
      });

      setSelectedSession((prevSession) => {
        if (!prevSession || !matchesSessionIdentity(prevSession, detail)) {
          return prevSession;
        }

        if (serialize(prevSession.tags) === serialize(detail.tags)) {
          return prevSession;
        }

        return {
          ...prevSession,
          tags: detail.tags,
        };
      });
    };

    window.addEventListener('session-tags-updated', handleSessionTagsUpdated as EventListener);
    return () => {
      window.removeEventListener('session-tags-updated', handleSessionTagsUpdated as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!latestMessage || consumedProjectMessageRef.current === latestMessage) {
      return;
    }
    consumedProjectMessageRef.current = latestMessage;

    if (
      latestMessage.type === 'session-created'
      && latestMessage.sessionId
      && latestMessage.provider
      && latestMessage.mode !== 'consultation'
    ) {
      const createdSessionId = latestMessage.sessionId as string;
      const rawMode = latestMessage.mode;
      const modeValue = typeof rawMode === 'string' ? rawMode : null;
      const sessionMode: SessionMode = isSessionMode(modeValue) ? modeValue : 'research';
      const createdProvider = latestMessage.provider as ProjectSession['__provider'];
      const createdDisplayName = latestMessage.displayName as string | undefined;
      const createdProjectName = latestMessage.projectName as string | undefined;
      const fallbackDisplayName =
        createdProvider === 'claude' ? 'Untitled Session'
          : createdProvider === 'codex' ? 'Codex Session'
          : createdProvider === 'openrouter' ? 'OpenRouter Session'
          : createdProvider === 'local' ? 'Local GPU Session'
          : 'New Session';

      setProjects((prevProjects) => prevProjects.map((project) => {
        const updateSessionList = (
          sessions: ProjectSession[] | undefined,
          provider: ProjectSession['__provider'],
        ): ProjectSession[] | undefined => {
          if (!Array.isArray(sessions)) {
            return sessions;
          }

          let changed = false;
          const nextSessions = sessions.map((session) => {
            if (
              session.id !== createdSessionId
              || (session.__provider || provider) !== createdProvider
            ) {
              return session;
            }

            changed = true;
            return {
              ...session,
              mode: sessionMode,
              __provider: session.__provider || provider,
            };
          });

          return changed ? nextSessions : sessions;
        };

        const nextProject = {
          ...project,
          sessions: updateSessionList(project.sessions, 'claude'),
          codexSessions: updateSessionList(project.codexSessions, 'codex'),
          piSessions: updateSessionList(project.piSessions, 'pi'),
          openrouterSessions: updateSessionList(project.openrouterSessions, 'openrouter'),
          localSessions: updateSessionList(project.localSessions, 'local'),
          runtimeSessions: updateSessionList(project.runtimeSessions, createdProvider) as
            | ProjectSessionV2[]
            | undefined,
        };

        if (createdProjectName && project.name === createdProjectName && createdProvider) {
          const sessionArrayKey = createdProvider === 'claude' ? 'sessions'
            : createdProvider === 'codex' ? 'codexSessions'
            : createdProvider === 'pi' ? 'piSessions'
            : createdProvider === 'openrouter' ? 'openrouterSessions'
            : createdProvider === 'local' ? 'localSessions'
            : null;

          if (sessionArrayKey) {
            const arr = (nextProject[sessionArrayKey] as ProjectSession[] | undefined) || [];
            const alreadyExists = arr.some((s) => s.id === createdSessionId);
            if (!alreadyExists) {
              const newSession: ProjectSession = {
                id: createdSessionId,
                name: createdDisplayName || fallbackDisplayName,
                summary: createdDisplayName || fallbackDisplayName,
                mode: sessionMode,
                __provider: createdProvider,
                __projectName: project.name,
                createdAt: new Date().toISOString(),
                lastActivity: new Date().toISOString(),
              };
              (nextProject as Record<string, unknown>)[sessionArrayKey] = [newSession, ...arr];

              if (Array.isArray(nextProject.runtimeSessions)) {
                const runtimeId = createdProvider === 'codex'
                  ? 'codex'
                  : createdProvider === 'pi'
                    ? 'pi'
                    : 'claude';
                const sessionKey = createClientAgentSessionKey(createdSessionId, {
                  projectKey: project.name,
                  runtimeId,
                });
                const existsInRuntimeSessions = nextProject.runtimeSessions.some((session) =>
                  session.id === createdSessionId && session.__provider === createdProvider,
                );

                if (sessionKey && !existsInRuntimeSessions) {
                  const runtimeSession: ProjectSessionV2 = {
                    ...newSession,
                    sessionKey,
                    sessionId: createdSessionId,
                    projectKey: project.name,
                    runtimeId,
                  };
                  nextProject.runtimeSessions = [runtimeSession, ...nextProject.runtimeSessions];
                }
              }
            }
          }
        }

        return nextProject;
      }));

      setSelectedSession((previous) => {
        if (
          !previous
          || previous.id !== createdSessionId
          || (previous.__provider && previous.__provider !== createdProvider)
        ) {
          return previous;
        }

        const resolvedDisplayName = createdDisplayName || fallbackDisplayName;
        return {
          ...previous,
          name: resolvedDisplayName,
          summary: resolvedDisplayName,
          mode: sessionMode,
          __provider: previous.__provider || createdProvider,
          __projectName: previous.__projectName || createdProjectName,
        };
      });
    }

    if (latestMessage.type === 'loading_progress') {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }

      setLoadingProgress(latestMessage as LoadingProgress);

      if (latestMessage.phase === 'complete') {
        loadingProgressTimeoutRef.current = setTimeout(() => {
          setLoadingProgress(null);
          loadingProgressTimeoutRef.current = null;
        }, 500);
      }

      return;
    }

    if (shouldRefreshSelectedSession(latestMessage, selectedSession)) {
      setExternalMessageUpdate((prev) => prev + 1);
      return;
    }

    if (latestMessage.type !== 'projects_updated') {
      return;
    }

    pendingProjectsMessageRef.current = latestMessage as ProjectsUpdatedMessage;

    if (projectsUpdateDebounceRef.current) {
      return;
    }

    projectsUpdateDebounceRef.current = setTimeout(() => {
      projectsUpdateDebounceRef.current = null;
      const projectsMessage = pendingProjectsMessageRef.current;
      pendingProjectsMessageRef.current = null;

      if (!projectsMessage) {
        return;
      }

      if (projectsMessage.changedFile && selectedSession && selectedProject) {
        const normalized = projectsMessage.changedFile.replace(/\\/g, '/');
        const changedFileParts = normalized.split('/');

        if (changedFileParts.length >= 2) {
          const filename = changedFileParts[changedFileParts.length - 1];
          const changedSessionId = filename.replace('.jsonl', '');

          if (changedSessionId === selectedSession.id) {
            const isSessionActive = hasClientAgentSession(activeSessions, selectedSession.id, {
              projectKey: selectedProject.name,
              runtimeId: selectedSession.__provider || 'claude',
            });

            if (!isSessionActive) {
              setExternalMessageUpdate((prev) => prev + 1);
            }
          }
        }
      }

      const updatedProjects = projectsMessage.projects;
      if (!isProjectArray(updatedProjects)) {
        return;
      }

      if (localKernelProjectSourceKey && projects.length > 0 && updatedProjects.length === 0) {
        void fetchProjects();
        return;
      }

      if (!projectsSnapshotPreservesSelection(updatedProjects, selectedProject, selectedSession)) {
        // A live project/session has not reached this independently generated
        // snapshot yet. Keep the mounted chat and reconcile automatically.
        scheduleProjectsReconcile();
        return;
      }

      projectsReconcileAttemptsRef.current = 0;

      setProjects(updatedProjects);
      if (activeTab === 'trash') {
        void fetchTrashProjects();
      }

      if (!selectedProject) {
        return;
      }

      const updatedSelectedProject = updatedProjects.find(
        (project) => project.name === selectedProject.name,
      );

      if (!updatedSelectedProject) {
        return;
      }

      if (serialize(updatedSelectedProject) !== serialize(selectedProject)) {
        setSelectedProject(updatedSelectedProject);
      }

      if (!selectedSession) {
        return;
      }

      const updatedSelectedSession = getProjectSessions(updatedSelectedProject).find(
        (session) => session.id === selectedSession.id
          && (!selectedSession.__provider || session.__provider === selectedSession.__provider),
      );

      if (!updatedSelectedSession) {
        setSelectedSession(null);
        return;
      }

      if (serialize(updatedSelectedSession) !== serialize(selectedSession)) {
        setSelectedSession(updatedSelectedSession);
      }
    }, 250);
  }, [activeTab, activeSessions, fetchProjects, fetchTrashProjects, latestMessage, localKernelProjectSourceKey, projects, scheduleProjectsReconcile, selectedProject, selectedSession]);

  useEffect(() => {
    return () => {
      if (loadingProgressTimeoutRef.current) {
        clearTimeout(loadingProgressTimeoutRef.current);
        loadingProgressTimeoutRef.current = null;
      }
      if (projectsUpdateDebounceRef.current) {
        clearTimeout(projectsUpdateDebounceRef.current);
        projectsUpdateDebounceRef.current = null;
      }
      if (projectsReconcileTimeoutRef.current) {
        clearTimeout(projectsReconcileTimeoutRef.current);
        projectsReconcileTimeoutRef.current = null;
      }
      pendingProjectsMessageRef.current = null;
    };
  }, []);

  const handleNavigateToSession = useCallback((
    targetSessionId: string,
    targetProvider?: ProjectSession['__provider'],
    targetProjectName?: string,
  ) => {
    if (!targetSessionId) {
      return;
    }

    const shouldSwitchTab = !selectedSession || selectedSession.id !== targetSessionId;
    let matchedProject: Project | null = null;
    let matchedSession: ProjectSession | null = null;

    const targetProject = targetProjectName
      ? projects.find((project) => project.name === targetProjectName)
        || (pendingDraftProjectRef.current?.name === targetProjectName
          ? pendingDraftProjectRef.current
          : null)
      : null;
    const normalizedTargetProvider = targetProvider;

    const projectsToSearch = targetProject ? [targetProject] : projects;
    for (const project of projectsToSearch) {
      const runtimeSession = project.runtimeSessions?.find((session) =>
        session.id === targetSessionId
        && (!normalizedTargetProvider || session.__provider === normalizedTargetProvider),
      );
      if (runtimeSession) {
        matchedProject = project;
        matchedSession = runtimeSession;
        break;
      }

      const claudeSession = project.sessions?.find((session) => session.id === targetSessionId);
      if (claudeSession && (!normalizedTargetProvider || normalizedTargetProvider === 'claude')) {
        matchedProject = project;
        matchedSession = { ...claudeSession, __provider: 'claude' };
        break;
      }

      const codexSession = project.codexSessions?.find((session) => session.id === targetSessionId);
      if (codexSession && (!normalizedTargetProvider || normalizedTargetProvider === 'codex')) {
        matchedProject = project;
        matchedSession = { ...codexSession, __provider: 'codex' };
        break;
      }

      const piSession = project.piSessions?.find((session) => session.id === targetSessionId);
      if (piSession && (!normalizedTargetProvider || normalizedTargetProvider === 'pi')) {
        matchedProject = project;
        matchedSession = { ...piSession, __provider: 'pi' };
        break;
      }

      const openrouterSession = project.openrouterSessions?.find((session) => session.id === targetSessionId);
      if (openrouterSession && (!normalizedTargetProvider || normalizedTargetProvider === 'openrouter')) {
        matchedProject = project;
        matchedSession = { ...openrouterSession, __provider: 'openrouter' };
        break;
      }

      const localSession = project.localSessions?.find((session) => session.id === targetSessionId);
      if (localSession && (!normalizedTargetProvider || normalizedTargetProvider === 'local')) {
        matchedProject = project;
        matchedSession = { ...localSession, __provider: 'local' };
        break;
      }
    }

    const providerHint = normalizedTargetProvider ?? matchedSession?.__provider;
    const sessionToSelect =
      matchedSession
      || (normalizedTargetProvider ? buildTransientSession(targetSessionId, providerHint, targetProject?.name || selectedProject?.name) : null);

    const projectToSelect = matchedProject || targetProject;
    if (projectToSelect && selectedProject?.name !== projectToSelect.name) {
      recordProjectOpen(projectToSelect, 'session_navigation');
      setSelectedProject(projectToSelect);
    }

    if (projectToSelect?.name === pendingDraftProjectRef.current?.name) {
      pendingDraftProjectRef.current = null;
    }

    if (sessionToSelect && (selectedSession?.id !== targetSessionId || selectedSession.__provider !== sessionToSelect.__provider)) {
      setSelectedSession(sessionToSelect);
    }

    if (shouldSwitchTab) {
      setActiveTab('chat');
    }

    if (sessionToSelect) {
      navigate(`/session/${targetSessionId}`);
    }
  }, [navigate, projects, recordProjectOpen, selectedProject?.name, selectedSession?.id, selectedSession?.__provider]);

  useEffect(() => {
    if (!sessionId) {
      lastSyncedRouteSessionIdRef.current = null;
      return;
    }
    if (
      projects.length === 0
      || lastSyncedRouteSessionIdRef.current === sessionId
    ) {
      return;
    }

    lastSyncedRouteSessionIdRef.current = sessionId;
    handleNavigateToSession(sessionId);
  }, [sessionId, projects, handleNavigateToSession]);

  const handleProjectSelect = useCallback(
    (project: Project) => {
      // A folder returned by the connect flow is already authoritative. Add it
      // immediately so the sidebar does not depend on a later manual refresh.
      setProjects((currentProjects) => (
        currentProjects.some((currentProject) => currentProject.name === project.name)
          ? currentProjects
          : [...currentProjects, project]
      ));
      rememberConversationFolder(project);
      recordProjectOpen(project, 'project_select');
      setSelectedProject(project);
      setSelectedSession(null);
      persistNewSessionMode('research');
      setNewSessionMode('research');
      // Selecting a project from the sidebar means entering that project's
      // conversation context. The full-width file browser has its own explicit
      // entry point and must not take over on a project-name click.
      setActiveTab(resolveVisibleAppTab(getProjectDefaultAppTab(), { hasSelectedProject: true }));
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [isMobile, navigate, recordProjectOpen, rememberConversationFolder],
  );

  const handleSessionSelect = useCallback(
    (session: ProjectSession) => {
      const sessionProject = session.__projectName
        ? projects.find((project) => project.name === session.__projectName) || null
        : null;
      rememberConversationFolder(sessionProject);
      if (sessionProject && selectedProject?.name !== sessionProject.name) {
        recordProjectOpen(sessionProject, 'session_navigation');
        setSelectedProject(sessionProject);
      }
      setSelectedSession(session);

      if (session.mode) {
        persistNewSessionMode(session.mode);
        setNewSessionMode(session.mode);
      }

      if (activeTab !== 'git' && activeTab !== 'preview') {
        setActiveTab(resolveVisibleAppTab('chat', { hasSelectedProject: true }));
      }

      if (isMobile) {
        const sessionProjectName = session.__projectName;
        const currentProjectName = selectedProject?.name;

        if (sessionProjectName !== currentProjectName) {
          setSidebarOpen(false);
        }
      }

      navigate(`/session/${session.id}`);
    },
    [activeTab, isMobile, navigate, projects, recordProjectOpen, rememberConversationFolder, selectedProject?.name],
  );

  const activateFreshSession = useCallback(
    (project: Project) => {
      beginFreshDraft(project.name);
      recordProjectOpen(project, 'new_session');
      setNewSessionResetKey((previous) => previous + 1);
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab(resolveVisibleAppTab('chat', { hasSelectedProject: true }));
      persistNewSessionMode('research');
      setNewSessionMode('research');
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [beginFreshDraft, isMobile, navigate, recordProjectOpen],
  );

  const createConversationProject = useCallback(async () => {
    if (!prepareProjectsApiRoute()) {
      throw new Error('Local workspace is not ready yet');
    }

    const response = await api.createConversationWorkspace();
    const payload = await response.json();
    if (!response.ok || !payload?.project?.name) {
      throw new Error(payload?.error || 'Failed to create conversation folder');
    }

    const project = payload.project as Project;
    setProjects((currentProjects) => {
      const existingIndex = currentProjects.findIndex((item) => item.name === project.name);
      if (existingIndex < 0) return [...currentProjects, project];
      return currentProjects.map((item, index) => index === existingIndex ? project : item);
    });
    return project;
  }, [prepareProjectsApiRoute]);

  const handleNewSession = useCallback(
    (project: Project, _mode: SessionMode = 'research') => {
      if (project.isDefaultWorkspace) {
        const preferredFolder = resolvePreferredConversationFolder(
          projects,
          selectedProject,
          safeLocalStorage.getItem(LAST_CONVERSATION_FOLDER_STORAGE_KEY),
        );
        if (preferredFolder) {
          rememberConversationFolder(preferredFolder);
          activateFreshSession(preferredFolder);
          return;
        }

        // Opening a blank conversation must not allocate a directory. The
        // composer creates its isolated workspace only when the first message
        // is actually submitted.
        activateFreshSession(project);
        void api.cleanupConversationWorkspaces()
          .catch((error) => {
            console.warn('Failed to clean unused conversation folders:', error);
          });
        return;
      }

      setProjects((currentProjects) => (
        currentProjects.some((currentProject) => currentProject.name === project.name)
          ? currentProjects
          : [...currentProjects, project]
      ));
      rememberConversationFolder(project);
      activateFreshSession(project);
    },
    [activateFreshSession, projects, rememberConversationFolder, selectedProject],
  );

  const handleClearConversationFolder = useCallback(
    (defaultConversationProject: Project) => {
      // Removing the attached folder is itself a fresh blank-conversation
      // request. Reset the composer and draft cache instead of treating the
      // default workspace as ordinary project navigation.
      activateFreshSession(defaultConversationProject);
    },
    [activateFreshSession],
  );

  const handleStartWorkspaceQa = useCallback(
    (project: Project, prompt: string, options?: { projectFiles?: ProjectFileChatContextItem[]; workbenchCommand?: WorkbenchCommand }) => {
      beginFreshDraft(project.name, options?.projectFiles);
      recordProjectOpen(project, 'workspace_qa');
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab(resolveVisibleAppTab('chat', { hasSelectedProject: true }));
      persistNewSessionMode('research');
      setNewSessionMode('research');
      if (prompt.trim()) {
        queueWorkspaceQaDraft(
          project.name,
          options?.workbenchCommand
            ? formatWorkbenchCommandPrompt(options.workbenchCommand)
            : prompt,
        );
      }
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [beginFreshDraft, isMobile, navigate, recordProjectOpen],
  );

  const handleChatFromReference = useCallback(
    (project: Project, ref: Reference) => {
      beginFreshDraft(project.name);
      recordProjectOpen(project, 'reference_chat');
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab(resolveVisibleAppTab('chat', { hasSelectedProject: true }));
      persistNewSessionMode('research');
      setNewSessionMode('research');
      queueReferenceChatDraft(project.name, {
        text: formatReferenceChatPrompt(ref),
        referenceId: ref.id,
        pdfCached: ref.pdf_cached === 1,
      });
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [beginFreshDraft, isMobile, navigate, recordProjectOpen],
  );

  /** Literature monitor: ingest paper into project KB + library, then open chat with draft. */
  const handleStartResearchFromNews = useCallback(
    (project: Project, prompt: string | ChatPromptDraft, source = 'news_research') => {
      beginFreshDraft(project.name);
      recordProjectOpen(project, source);
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab(resolveVisibleAppTab('chat', { hasSelectedProject: true }));
      persistNewSessionMode('research');
      setNewSessionMode('research');
      queueChatPromptDraftDeferred(project.name, prompt);
      navigate('/');

      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [beginFreshDraft, isMobile, navigate, recordProjectOpen],
  );

  const handleProjectCreatedWithIntake = useCallback(
    (project: Project, options?: ProjectCreationOptions) => {
      setProjects((currentProjects) => (
        currentProjects.some((currentProject) => currentProject.name === project.name)
          ? currentProjects
          : [...currentProjects, project]
      ));
      beginFreshDraft(project.name);
      recordProjectOpen(project, 'project_created');
      setSelectedProject(project);
      setSelectedSession(null);
      setActiveTab(resolveVisibleAppTab('chat', { hasSelectedProject: true }));
      setPendingAutoIntake(options?.autoIntake ?? null);
      setImportedProjectAnalysisPrompt(options?.importedProjectAnalysisPrompt ?? null);
      navigate('/');
      void fetchProjects();
      if (isMobile) setSidebarOpen(false);
    },
    [beginFreshDraft, fetchProjects, isMobile, navigate, recordProjectOpen],
  );

  const handleCreateDraftProjectFromPrompt = useCallback(
    async (_prompt: string) => {
      const conversationProject = await createConversationProject();
      // The composer is already submitting the first message. Rebind that
      // in-flight draft to its new directory without triggering the full
      // new-session reset, which would erase the optimistic message.
      recordProjectOpen(conversationProject, 'conversation_workspace_created');
      pendingDraftProjectRef.current = conversationProject;
      setDraftOpenRequest((current) => ({
        ...current,
        projectName: conversationProject.name,
      }));
      // Keep the mounted blank draft on the default conversation surface.
      // The session-created event will promote project + session together;
      // switching the project here remounts the in-flight composer and drops
      // the optimistic first message before the provider returns a real ID.
      return conversationProject;
    },
    [createConversationProject, recordProjectOpen],
  );

  const clearPendingAutoIntake = useCallback(() => setPendingAutoIntake(null), []);
  const clearImportedProjectAnalysisPrompt = useCallback(() => setImportedProjectAnalysisPrompt(null), []);

  const handleOpenDashboard = useCallback(() => {
    setSelectedProject(null);
    setSelectedSession(null);
    setActiveTab(resolveVisibleAppTab('dashboard', { hasSelectedProject: false }));
    navigate('/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile, navigate]);

  const handleOpenTrash = useCallback(() => {
    const targetTab = resolveVisibleAppTab('trash', { hasSelectedProject: false });
    setSelectedProject(null);
    setSelectedSession(null);
    setActiveTab(targetTab);
    if (targetTab === 'trash') {
      void fetchTrashProjects();
      void fetchTrashSessions();
    }
    navigate('/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [fetchTrashProjects, fetchTrashSessions, isMobile, navigate]);

  const openGlobalWorkspaceTab = useCallback((tab: AppTab) => {
    setSelectedSession(null);
    setActiveTab(resolveVisibleAppTab(tab, { hasSelectedProject: Boolean(selectedProject) }));
    navigate('/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile, navigate, selectedProject]);

  const handleOpenSkills = useCallback(() => {
    openGlobalWorkspaceTab('skills');
  }, [openGlobalWorkspaceTab]);

  const handleOpenNews = useCallback(() => {
    openGlobalWorkspaceTab('news');
  }, [openGlobalWorkspaceTab]);

  const handleOpenMedLibrary = useCallback(() => {
    openGlobalWorkspaceTab('medlibrary');
  }, [openGlobalWorkspaceTab]);

  const handleOpenVariableOverview = useCallback(() => {
    openGlobalWorkspaceTab('variableOverview');
  }, [openGlobalWorkspaceTab]);

  const handleOpenVariableDiscovery = useCallback(() => {
    openGlobalWorkspaceTab('variableKnowledgePubmedDiscovery');
  }, [openGlobalWorkspaceTab]);

  const handleOpenMemorySummary = useCallback(() => {
    openGlobalWorkspaceTab('memorySummary');
  }, [openGlobalWorkspaceTab]);

  const handleOpenConversationHistory = useCallback(() => {
    openGlobalWorkspaceTab('conversationHistory');
  }, [openGlobalWorkspaceTab]);

  const handleOpenSubmissions = useCallback(() => {
    openGlobalWorkspaceTab('submissions');
  }, [openGlobalWorkspaceTab]);

  const handleOpenThesis = useCallback(() => {
    openGlobalWorkspaceTab('thesis');
  }, [openGlobalWorkspaceTab]);

  const handleOpenDailyReview = useCallback(() => {
    openGlobalWorkspaceTab('dailyReview');
  }, [openGlobalWorkspaceTab]);

  const handleOpenMeetings = useCallback(() => {
    openGlobalWorkspaceTab('meetings');
  }, [openGlobalWorkspaceTab]);

  const handleOpenAdvisor = useCallback(() => {
    openGlobalWorkspaceTab('advisor');
  }, [openGlobalWorkspaceTab]);

  const handleOpenAutomation = useCallback(() => {
    openGlobalWorkspaceTab('automation');
  }, [openGlobalWorkspaceTab]);

  const handleOpenCompanions = useCallback(() => {
    openGlobalWorkspaceTab('companions');
  }, [openGlobalWorkspaceTab]);

  const handleOpenMiniApps = useCallback(() => {
    openGlobalWorkspaceTab('miniApps');
  }, [openGlobalWorkspaceTab]);

  const openSettings = useCallback((tab = 'user') => {
    setSettingsInitialTab(tab);
    openGlobalWorkspaceTab('settings');
  }, [openGlobalWorkspaceTab]);

  const closeSettings = useCallback(() => {
    setActiveTab(resolveVisibleAppTab(
      selectedProject ? getProjectDefaultAppTab() : getGlobalDefaultAppTab(),
      { hasSelectedProject: Boolean(selectedProject) },
    ));
    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile, selectedProject]);

  const handleOpenVariablePubMedDiscovery = useCallback(() => {
    const canOpenVariableDiscovery = isAppTabVisible('variableKnowledgePubmedDiscovery');
    setSelectedProject(null);
    setSelectedSession(null);
    setActiveTab(canOpenVariableDiscovery
      ? 'variableKnowledgePubmedDiscovery'
      : resolveVisibleAppTab('variableKnowledgePubmedDiscovery', { hasSelectedProject: false }));
    navigate(canOpenVariableDiscovery ? '/variable-knowledge/pubmed-discovery' : '/');

    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [isMobile, navigate]);

  const handleSessionDelete = useCallback(
    (projectName: string, sessionIdToDelete: string, provider: SessionProvider) => {
      if (
        selectedProject?.name === projectName
        && selectedSession?.id === sessionIdToDelete
        && (!selectedSession.__provider || selectedSession.__provider === provider)
      ) {
        setSelectedSession(null);
        navigate('/');
      }

      const filterOut = (list: ProjectSession[] | undefined, providerHint: SessionProvider) =>
        list?.filter((session) =>
          session.id !== sessionIdToDelete || (session.__provider || providerHint) !== provider,
        ) ?? [];

      setProjects((prevProjects) =>
        prevProjects.map((project) => project.name !== projectName ? project : ({
          ...project,
          sessions: filterOut(project.sessions, 'claude'),
          codexSessions: filterOut(project.codexSessions, 'codex'),
          piSessions: filterOut(project.piSessions, 'pi'),
          openrouterSessions: filterOut(project.openrouterSessions, 'openrouter'),
          localSessions: filterOut(project.localSessions, 'local'),
          runtimeSessions: filterOut(project.runtimeSessions, provider) as ProjectSessionV2[],
          sessionMeta: provider === 'claude'
            ? {
                ...project.sessionMeta,
                total: Math.max(0, (project.sessionMeta?.total as number | undefined ?? 0) - 1),
              }
            : project.sessionMeta,
        })),
      );

      void fetchTrashProjects();
      void fetchTrashSessions();
    },
    [fetchTrashProjects, fetchTrashSessions, navigate, selectedProject?.name, selectedSession],
  );

  const handleSidebarRefresh = useCallback(async () => {
    try {
      if (!prepareProjectsApiRoute()) {
        return;
      }

      const [projectsResponse, trashResponse] = await Promise.all([
        api.projects(),
        api.trashedProjects(),
      ]);
      if (!projectsResponse.ok) {
        throw new Error(`Failed to refresh projects: ${projectsResponse.status}`);
      }
      const freshProjects = (await projectsResponse.json()) as Project[];
      if (!isProjectArray(freshProjects)) {
        throw new Error('Projects API returned a non-array payload');
      }
      const freshTrashProjects = trashResponse.ok ? await trashResponse.json() as TrashProject[] : [];

      setProjects((prevProjects) =>
        projectsHaveChanges(prevProjects, freshProjects, true) ? freshProjects : prevProjects,
      );
      setTrashProjects(freshTrashProjects);

      if (!selectedProject) {
        return;
      }

      const refreshedProject = freshProjects.find((project) => project.name === selectedProject.name);
      if (!refreshedProject) {
        return;
      }

      if (serialize(refreshedProject) !== serialize(selectedProject)) {
        setSelectedProject(refreshedProject);
      }

      if (!selectedSession) {
        return;
      }

      const refreshedSession = getProjectSessions(refreshedProject).find(
        (session) => session.id === selectedSession.id
          && (!selectedSession.__provider || session.__provider === selectedSession.__provider),
      );

      if (refreshedSession) {
        // Keep provider metadata stable when refreshed payload doesn't include __provider.
        const normalizedRefreshedSession =
          refreshedSession.__provider || !selectedSession.__provider
            ? refreshedSession
            : { ...refreshedSession, __provider: selectedSession.__provider };

        if (serialize(normalizedRefreshedSession) !== serialize(selectedSession)) {
          setSelectedSession(normalizedRefreshedSession);
        }
      }
    } catch (error) {
      console.error('Error refreshing sidebar:', error);
    }
  }, [prepareProjectsApiRoute, selectedProject, selectedSession]);

  const handleProjectDelete = useCallback(
    (projectName: string) => {
      if (selectedProject?.name === projectName) {
        setSelectedProject(null);
        setSelectedSession(null);
        navigate('/');
      }

      setProjects((prevProjects) => prevProjects.filter((project) => project.name !== projectName));
    },
    [navigate, selectedProject?.name],
  );

  const sidebarSharedProps = useMemo(
    () => ({
      projects,
      selectedProject,
      selectedSession,
      onProjectSelect: handleProjectSelect,
      onSessionSelect: handleSessionSelect,
      onNewSession: handleNewSession,
      onSessionDelete: handleSessionDelete,
      onProjectDelete: handleProjectDelete,
      isLoading: isLoadingProjects,
      isTrashLoading: isLoadingTrashProjects,
      isTrashSessionsLoading: isLoadingTrashSessions,
      loadingProgress,
      onRefresh: handleSidebarRefresh,
      onShowSettings: () => openSettings('user'),
      isMobile,
      activeTab,
      processingSessions,
      onOpenDashboard: handleOpenDashboard,
      onOpenTrash: handleOpenTrash,
      onOpenNews: handleOpenNews,
      onOpenMedLibrary: handleOpenMedLibrary,
      onOpenSkills: handleOpenSkills,
      onOpenVariableOverview: handleOpenVariableOverview,
      onOpenVariableDiscovery: handleOpenVariableDiscovery,
      onOpenMemorySummary: handleOpenMemorySummary,
      onOpenConversationHistory: handleOpenConversationHistory,
      onOpenSubmissions: handleOpenSubmissions,
      onOpenThesis: handleOpenThesis,
      onOpenDailyReview: handleOpenDailyReview,
      onOpenMeetings: handleOpenMeetings,
      onOpenAdvisor: handleOpenAdvisor,
      onOpenAutomation: handleOpenAutomation,
      onOpenCompanions: handleOpenCompanions,
      onOpenMiniApps: handleOpenMiniApps,
      onImportedProjectCreated: handleProjectCreatedWithIntake,
      importedProjectAnalysisPrompt,
      onDismissImportedProjectAnalysisPrompt: clearImportedProjectAnalysisPrompt,
      newSessionMode,
    }),
    [
      activeTab,
      clearImportedProjectAnalysisPrompt,
      handleNewSession,
      handleOpenDashboard,
      handleOpenNews,
      handleOpenMedLibrary,
      handleOpenSkills,
      handleOpenVariableOverview,
      handleOpenVariableDiscovery,
      handleOpenMemorySummary,
      handleOpenConversationHistory,
      handleOpenSubmissions,
      handleOpenThesis,
      handleOpenDailyReview,
      handleOpenMeetings,
      handleOpenAdvisor,
      handleOpenAutomation,
      handleOpenCompanions,
      handleOpenMiniApps,
      handleOpenTrash,
      handleProjectCreatedWithIntake,
      handleProjectDelete,
      handleProjectSelect,
      handleSessionDelete,
      handleSessionSelect,
      handleSidebarRefresh,
      importedProjectAnalysisPrompt,
      isLoadingProjects,
      isLoadingTrashProjects,
      isLoadingTrashSessions,
      isMobile,
      loadingProgress,
      newSessionMode,
      openSettings,
      processingSessions,
      projects,
      selectedProject,
      selectedSession,
    ],
  );

  return {
    projects,
    trashProjects,
    trashSessions,
    selectedProject,
    selectedSession,
    draftOpenRequest,
    activeTab,
    sidebarOpen,
    isLoadingProjects,
    isLoadingTrashProjects,
    isLoadingTrashSessions,
    loadingProgress,
    isInputFocused,
    settingsInitialTab,
    externalMessageUpdate,
    newSessionResetKey,
    importedProjectAnalysisPrompt,
    newSessionMode,
    setNewSessionMode,
    setActiveTab,
    setSidebarOpen,
    setIsInputFocused,
    openSettings,
    closeSettings,
    fetchProjects,
    fetchTrashProjects,
    fetchTrashSessions,
    sidebarSharedProps,
    handleProjectSelect,
    handleSessionSelect,
    handleNavigateToSession,
    handleOpenDashboard,
    handleOpenTrash,
    handleOpenSkills,
    handleOpenNews,
    handleOpenMedLibrary,
    handleOpenConversationHistory,
    handleOpenSubmissions,
    handleOpenMeetings,
    handleOpenAdvisor,
    handleOpenAutomation,
    handleOpenCompanions,
    handleOpenMiniApps,
    handleOpenVariableOverview,
    handleOpenVariableDiscovery,
    handleOpenMemorySummary,
    handleOpenVariablePubMedDiscovery,
    handleNewSession,
    handleClearConversationFolder,
    handleStartWorkspaceQa,
    handleChatFromReference,
    handleStartResearchFromNews,
    handleSessionDelete,
    handleProjectDelete,
    handleSidebarRefresh,
    pendingAutoIntake,
    handleProjectCreatedWithIntake,
    handleCreateDraftProjectFromPrompt,
    clearPendingAutoIntake,
    clearImportedProjectAnalysisPrompt,
  };
}
