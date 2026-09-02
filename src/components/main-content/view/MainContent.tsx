import React, { useEffect } from 'react';
import CompanionCenter from '../../../features/companions/CompanionCenter';
import MiniAppCenter from '../../../features/mini-apps/MiniAppCenter';

import ErrorBoundary from '../../ErrorBoundary';

import MainContentHeader from './subcomponents/MainContentHeader';
import MainContentStateView from './subcomponents/MainContentStateView';
import type { MainContentProps } from '../types/types';

import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useEditorSidebar } from '../hooks/useEditorSidebar';
import type { Project, SessionProvider } from '../../../types/app';
import {
  normalizeChatSidebarTab,
  type ChatMessage,
  type ChatSidebarTab,
} from '../../chat/types/types';
import {
  SIMPLE_BROWSER_NAVIGATE_EVENT,
  routeSimpleBrowserUrl,
} from '../../chat/utils/simpleBrowser';
import SelectionConsultationPanel, {
  type SelectionConsultationSeed,
} from '../../chat/view/subcomponents/SelectionConsultationPanel';
import type { ChatPromptDraft } from '../../../utils/chatPromptDraft';
import type { Reference } from '../../references/types';
import { api } from '../../../utils/api';
import { queueProjectFileChatContext } from '../../../utils/projectFileChatContext';
import type { ProjectFileChatContextItem } from '../../../utils/projectFileChatContext';
import {
  PROJECT_FILE_DELETED_EVENT,
  PROJECT_FILE_MOVED_EVENT,
  type ProjectFileMovedDetail,
} from '../../../utils/projectFileEvents';
import { getMedLibrarySection, isMedLibraryAppTab, resolveVisibleAppTab } from '../../../config/appModules';
import ProFeatureGate from '../../entitlements/ProFeatureGate';
import { CAPABILITIES } from '../../../hooks/useEntitlements';
import {
  RESEARCH_PIPELINE_STAGE_KEYS,
  countResearchStageArtifactsFromFileTree,
  createEmptyResearchStageArtifactCounts,
  type ResearchStageArtifactCounts,
} from '../../../utils/researchStageArtifacts';
import {
  resolveChatViewContinuity,
  type ChatViewContinuityState,
} from '../../chat/utils/sessionRealtimeIdentity';
import type { WorkbenchCommand } from '../../../features/research-secretary/domain/workbenchCommand';

const ChatInterface = React.lazy(() => import('../../chat/view/ChatInterface')) as any;
const ChatContextSidebar = React.lazy(() => import('../../chat/view/subcomponents/ChatContextSidebar')) as any;
const FileTree = React.lazy(() => import('../../FileTree')) as any;
const GitPanel = React.lazy(() => import('../../GitPanel')) as any;
const SurveyPage = React.lazy(() => import('../../survey/view/SurveyPage')) as any;
const TrashDashboard = React.lazy(() => import('../../project-dashboard/view/TrashDashboard')) as any;
const NewsDashboard = React.lazy(() => import('../../news-dashboard/view/NewsDashboard')) as any;
const MedicalLibraryDashboard = React.lazy(() => import('../../med-library-dashboard/view/MedicalLibraryDashboard')) as any;
const ConversationHistoryDashboard = React.lazy(() => import('../../conversation-history/ConversationHistoryDashboard')) as any;
const ResearchSecretaryDashboard = React.lazy(() => import('../../../features/research-secretary/dashboard/ResearchSecretaryDashboard')) as any;
const SubmissionCenter = React.lazy(() => import('../../../features/research-secretary/submissions/SubmissionCenter')) as any;
const ThesisCenter = React.lazy(() => import('../../../features/research-secretary/thesis/ThesisCenter')) as any;
const DailyReviewCenter = React.lazy(() => import('../../../features/research-secretary/review/DailyReviewCenter')) as any;
const MeetingCenter = React.lazy(() => import('../../../features/research-secretary/meetings/MeetingCenter')) as any;
const AdvisorActionCenter = React.lazy(() => import('../../../features/research-secretary/advisor/AdvisorActionCenter')) as any;
const AutomationCenter = React.lazy(() => import('../../../features/research-secretary/automation/AutomationCenter')) as any;
const SettingsPage = React.lazy(() => import('../../Settings')) as any;
const EditorSidebar = React.lazy(() => import('./subcomponents/EditorSidebar')) as any;
const AnyGitPanel = GitPanel as any;
const CHAT_SIDEBAR_WIDTH_STORAGE_KEY = 'chat-session-context-width';
const DEFAULT_CHAT_SIDEBAR_WIDTH = 480;
const MIN_CHAT_SIDEBAR_WIDTH = 360;
const MAX_CHAT_SIDEBAR_WIDTH = 840;

type TaskMasterContextValue = {
  currentProject?: Project | null;
  setCurrentProject?: ((project: Project) => void) | null;
};

function LazyTabFallback() {
  return (
    <div className="h-full w-full flex items-center justify-center text-muted-foreground">
      <div className="h-8 w-8 rounded-full border-2 border-muted border-t-primary animate-spin" />
    </div>
  );
}

function clampChatSidebarWidth(width: number) {
  return Math.min(MAX_CHAT_SIDEBAR_WIDTH, Math.max(MIN_CHAT_SIDEBAR_WIDTH, width));
}

function readStoredChatSidebarWidth() {
  if (typeof window === 'undefined') {
    return DEFAULT_CHAT_SIDEBAR_WIDTH;
  }

  const rawValue = window.localStorage.getItem(CHAT_SIDEBAR_WIDTH_STORAGE_KEY);
  const parsed = rawValue ? Number.parseInt(rawValue, 10) : NaN;
  return Number.isFinite(parsed) ? clampChatSidebarWidth(parsed) : DEFAULT_CHAT_SIDEBAR_WIDTH;
}

function MainContent({
  projects,
  trashProjects,
  selectedProject,
  selectedSession,
  draftOpenRequest,
  activeTab,
  setActiveTab,
  ws,
  sendMessage,
  latestMessage,
  isMobile,
  onMenuClick,
  isLoading,
  isTrashLoading,
  onInputFocusChange,
  onSessionActive,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  processingSessions,
  onReplaceTemporarySession,
  onNavigateToSession,
  onShowSettings,
  settingsInitialTab = 'user',
  onCloseSettings,
  externalMessageUpdate,
  newSessionResetKey,
  pendingAutoIntake,
  clearPendingAutoIntake,
  importedProjectAnalysisPrompt,
  clearImportedProjectAnalysisPrompt,
  onProjectSelect,
  onNewSession,
  onClearConversationFolder,
  onStartWorkspaceQa,
  onChatFromReference,
  onStartResearchFromNews,
  onCreateProjectFromPrompt,
  newSessionMode,
  onNewSessionModeChange,
}: MainContentProps) {
  const [chatViewContinuityState, setChatViewContinuityState] = React.useState<ChatViewContinuityState | null>(null);
  const selectedSessionId = selectedSession?.id || null;
  const latestRealtimeMessage = latestMessage as { type?: unknown; sessionId?: unknown } | null;
  const latestCreatedSessionId = latestRealtimeMessage?.type === 'session-created'
    && typeof latestRealtimeMessage.sessionId === 'string'
    ? latestRealtimeMessage.sessionId
    : null;
  const isDraftProjectPromotion = Boolean(
    chatViewContinuityState?.wasDraft
    && !selectedSessionId
    && selectedProject?.name
    && chatViewContinuityState.projectKey !== selectedProject.name
    && draftOpenRequest.projectName === selectedProject.name,
  );
  const chatViewContinuity = resolveChatViewContinuity({
    previous: chatViewContinuityState,
    // Project records are progressively hydrated; path/fullPath can appear or
    // change after a refresh. The encoded project name is the stable identity
    // used by session APIs, so it must be the only project component of the key.
    projectKey: selectedProject?.name || null,
    sessionId: selectedSessionId,
    provider: selectedSession?.__provider || null,
    draftRequestKey: draftOpenRequest.requestKey,
    isDraftPromotion: Boolean(
      selectedSessionId
      && latestCreatedSessionId === selectedSessionId,
    ),
    isDraftProjectPromotion,
  });
  const promotedChatView = chatViewContinuity.state.promotedSession;
  React.useLayoutEffect(() => {
    setChatViewContinuityState(chatViewContinuity.state);
  }, [
    chatViewContinuity.state.key,
    chatViewContinuity.state.projectKey,
    chatViewContinuity.state.provider,
    chatViewContinuity.state.sessionId,
    chatViewContinuity.state.wasDraft,
    promotedChatView?.key,
    promotedChatView?.projectKey,
    promotedChatView?.provider,
    promotedChatView?.sessionId,
  ]);
  const chatViewIdentityKey = chatViewContinuity.key;
  const { preferences } = useUiPreferences();
  const { autoExpandTools, showRawParameters, showThinking, autoScrollToBottom, sendByCtrlEnter } = preferences;

  const { currentProject, setCurrentProject } = useTaskMaster() as TaskMasterContextValue;
  const {
    editingFile,
    editorMode,
    editorWidth,
    editorExpanded,
    resizeHandleRef,
    handleFileOpen,
    handleCloseEditor,
    handleStartEditing,
    handleToggleEditorExpand,
    handleResizeStart,
  } = useEditorSidebar({
    activeTab,
    selectedProject,
    selectedSession,
    isMobile,
  });
  const selectedProjectName = selectedProject?.name || '';
  const selectedProjectRoot = selectedProject?.fullPath || selectedProject?.path || '';

  const handleReturnToEditorOrigin = React.useCallback(() => {
    const originTab = editingFile?.researchContext?.originTab;
    handleCloseEditor();
    if (originTab && originTab !== activeTab) {
      setActiveTab(originTab);
    }
  }, [activeTab, editingFile?.researchContext?.originTab, handleCloseEditor, setActiveTab]);

  const handleAddProjectFileToCurrentChat = React.useCallback((file: ProjectFileChatContextItem) => {
    if (!selectedProjectName) {
      return;
    }

    queueProjectFileChatContext(selectedProjectName, file);
    setActiveTab('chat');
  }, [selectedProjectName, setActiveTab]);

  useEffect(() => {
    if (selectedProject && selectedProject !== currentProject) {
      setCurrentProject?.(selectedProject);
    }
  }, [selectedProject, currentProject, setCurrentProject]);

  useEffect(() => {
    const visibleTab = resolveVisibleAppTab(activeTab, { hasSelectedProject: Boolean(selectedProject) });
    if (visibleTab !== activeTab) {
      setActiveTab(visibleTab);
    }
  }, [activeTab, selectedProject, setActiveTab]);

  const [stageArtifactCounts, setStageArtifactCounts] = React.useState<ResearchStageArtifactCounts>(
    () => createEmptyResearchStageArtifactCounts(),
  );

  const loadStageArtifactCounts = React.useCallback(async (signal?: AbortSignal) => {
    if (!selectedProjectName) {
      setStageArtifactCounts(createEmptyResearchStageArtifactCounts());
      return;
    }

    try {
      const response = await api.getFiles(selectedProjectName, {
        includeInternal: true,
        signal,
      });
      const tree = response?.ok ? await response.json().catch(() => []) : [];

      if (signal?.aborted) {
        return;
      }

      setStageArtifactCounts(
        countResearchStageArtifactsFromFileTree(
          Array.isArray(tree) ? tree : [],
          selectedProjectRoot,
        ),
      );
    } catch (error) {
      if (signal?.aborted) {
        return;
      }
      console.warn('Failed to load research stage artifacts:', error);
    }
  }, [selectedProjectName, selectedProjectRoot]);

  React.useEffect(() => {
    const controller = new AbortController();
    void loadStageArtifactCounts(controller.signal);
    return () => controller.abort();
  }, [loadStageArtifactCounts]);

  React.useEffect(() => {
    if (typeof window === 'undefined' || !selectedProjectName) {
      return undefined;
    }

    const handleProjectFileMoved = (event: Event) => {
      const detail = (event as CustomEvent<ProjectFileMovedDetail>).detail;
      if (detail?.projectName !== selectedProjectName) {
        return;
      }

      void loadStageArtifactCounts();
    };

    window.addEventListener(PROJECT_FILE_MOVED_EVENT, handleProjectFileMoved);
    window.addEventListener(PROJECT_FILE_DELETED_EVENT, handleProjectFileMoved);
    return () => {
      window.removeEventListener(PROJECT_FILE_MOVED_EVENT, handleProjectFileMoved);
      window.removeEventListener(PROJECT_FILE_DELETED_EVENT, handleProjectFileMoved);
    };
  }, [loadStageArtifactCounts, selectedProjectName]);

  React.useEffect(() => {
    if (!selectedProjectName || !latestMessage || typeof latestMessage !== 'object') {
      return undefined;
    }

    const message = latestMessage as {
      type?: unknown;
      phase?: unknown;
      projectName?: unknown;
    };
    const messageProjectName = typeof message.projectName === 'string' ? message.projectName : '';
    if (messageProjectName && messageProjectName !== selectedProjectName) {
      return undefined;
    }

    const messageType = typeof message.type === 'string' ? message.type : '';
    const shouldRefresh = messageType === 'projects_updated'
      || messageType === 'claude-complete'
      || messageType === 'codex-complete'
      || (messageType === 'loading_progress' && message.phase === 'complete');

    if (!shouldRefresh) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      void loadStageArtifactCounts();
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [latestMessage, loadStageArtifactCounts, selectedProjectName]);

  const latestArtifactStage = React.useMemo(() => {
    let latestStage: number | null = null;
    RESEARCH_PIPELINE_STAGE_KEYS.forEach((stage, index) => {
      if ((stageArtifactCounts[stage] ?? 0) > 0) {
        latestStage = index + 1;
      }
    });
    return latestStage;
  }, [stageArtifactCounts]);

  const derivedResearchStage = React.useMemo(
    () => (newSessionMode === 'workspace_qa' ? 3 : 1),
    [newSessionMode],
  );
  const currentResearchStage = latestArtifactStage ?? derivedResearchStage;

  const [chatSidebarLayout, setChatSidebarLayout] = React.useState(() => ({
    width: readStoredChatSidebarWidth(),
    collapsed: false,
  }));
  const [storedChatSidebarWidth, setStoredChatSidebarWidth] = React.useState(readStoredChatSidebarWidth);
  const [sidebarExpandSignal, setSidebarExpandSignal] = React.useState(0);
  React.useEffect(() => {
    if (chatSidebarLayout.width >= MIN_CHAT_SIDEBAR_WIDTH) {
      setStoredChatSidebarWidth(clampChatSidebarWidth(chatSidebarLayout.width));
    }
  }, [chatSidebarLayout.width]);

  const chatSidebarInset = activeTab === 'chat' && !isMobile && !editorExpanded && !editingFile
    ? chatSidebarLayout.width + (chatSidebarLayout.collapsed ? 0 : 4)
    : 0;
  const surveySidebarWidth = !isMobile && !editorExpanded
    ? (chatSidebarLayout.width >= MIN_CHAT_SIDEBAR_WIDTH
        ? clampChatSidebarWidth(chatSidebarLayout.width)
        : storedChatSidebarWidth)
    : undefined;
  const detachChatContextSidebar = activeTab === 'chat' && !isMobile && !editorExpanded && Boolean(selectedProject);
  const showDetachedChatSidebar = detachChatContextSidebar && !editingFile;
  const showTopDockedEditor = Boolean(editingFile) && !isMobile && !editorExpanded;
  const showRightSidePanel = showDetachedChatSidebar || showTopDockedEditor;
  const showExpandContextSidebar = activeTab === 'chat'
    && !isMobile
    && !editingFile
    && Boolean(selectedProject)
    && chatSidebarLayout.collapsed
    && chatSidebarLayout.width === 0;
  const handleExpandContextSidebar = React.useCallback(() => {
    setSidebarExpandSignal((current) => current + 1);
  }, []);
  const [contextSidebarTab, setContextSidebarTab] = React.useState<ChatSidebarTab>(() => {
    if (typeof window === 'undefined') {
      return 'files';
    }
    return normalizeChatSidebarTab(window.localStorage.getItem('chat-sidebar-active-tab'));
  });
  const [contextSidebarMessages, setContextSidebarMessages] = React.useState<ChatMessage[]>([]);
  const [selectionConsultationSeed, setSelectionConsultationSeed] = React.useState<SelectionConsultationSeed | null>(null);
  const [contextSidebarProvider, setContextSidebarProvider] = React.useState<SessionProvider>(
    selectedSession?.__provider || 'claude',
  );
  const [contextSidebarHandlers, setContextSidebarHandlers] = React.useState<{
    onStartTask: (prompt?: string, task?: {
      id?: string | number | null;
      title?: string | null;
      stage?: string | null;
    } | null) => void;
    onFileOpen: (filePath: string, diffInfo?: unknown) => void;
    onSummarizeMemory: () => void;
  } | null>(null);

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('chat-sidebar-active-tab', contextSidebarTab);
  }, [contextSidebarTab]);

  React.useEffect(() => {
    const handleBrowserNavigation = (event: Event) => {
      const url = (event as CustomEvent<{ url?: unknown }>).detail?.url;
      if (typeof url !== 'string') return;
      routeSimpleBrowserUrl(url, () => {
        setContextSidebarTab('browser');
        setSidebarExpandSignal((current) => current + 1);
      });
    };

    window.addEventListener(SIMPLE_BROWSER_NAVIGATE_EVENT, handleBrowserNavigation);
    return () => window.removeEventListener(SIMPLE_BROWSER_NAVIGATE_EVENT, handleBrowserNavigation);
  }, []);

  const handleSelectionConsultationChange = React.useCallback((seed: SelectionConsultationSeed | null) => {
    setSelectionConsultationSeed(seed);
    if (seed) {
      setContextSidebarTab('consultation');
      setSidebarExpandSignal((current) => current + 1);
      return;
    }
    setContextSidebarTab((current) => current === 'consultation' ? 'context' : current);
  }, []);

  React.useEffect(() => {
    if (activeTab !== 'survey' || !selectedProjectName || isMobile) {
      return;
    }

    setContextSidebarTab('survey');
    setSidebarExpandSignal((current) => current + 1);
    setActiveTab('chat');
  }, [activeTab, isMobile, selectedProjectName, setActiveTab]);

  React.useEffect(() => {
    setContextSidebarProvider(selectedSession?.__provider || 'claude');
  }, [selectedSession?.__provider, selectedSession?.id]);

  const handleNavigateBack = React.useCallback(() => {
    if (selectedProject) {
      setActiveTab(resolveVisibleAppTab('chat', { hasSelectedProject: true }));
      return;
    }

    setActiveTab(resolveVisibleAppTab('dashboard', { hasSelectedProject: false }));
  }, [selectedProject, setActiveTab]);

  const handleResearchSecretaryNavigate = React.useCallback((tab: import('../../../types/app').AppTab) => {
    if (!selectedProject && projects[0] && ['chat', 'context', 'survey', 'files', 'git'].includes(tab)) {
      onProjectSelect?.(projects[0]);
    }
    setActiveTab(tab);
  }, [onProjectSelect, projects, selectedProject, setActiveTab]);

  const handleResearchSecretaryCommand = React.useCallback(async (command: WorkbenchCommand) => {
    let targetProject = selectedProject ?? projects[0] ?? null;
    if (!targetProject && onCreateProjectFromPrompt) {
      targetProject = await onCreateProjectFromPrompt(command.prompt);
    }
    if (targetProject && onStartWorkspaceQa) {
      onStartWorkspaceQa(targetProject, command.prompt, { workbenchCommand: command });
    }
  }, [onCreateProjectFromPrompt, onStartWorkspaceQa, projects, selectedProject]);

  const handleMiniAppCreateWithAgent = React.useCallback(async (draft: ChatPromptDraft) => {
    const seedPrompt = draft.attachedPrompt?.promptText || draft.input;
    let targetProject = selectedProject ?? projects[0] ?? null;
    if (!targetProject && onCreateProjectFromPrompt) {
      targetProject = await onCreateProjectFromPrompt(seedPrompt);
    }
    if (targetProject && onStartResearchFromNews) {
      onStartResearchFromNews(targetProject, draft, 'mini_app_create');
    }
  }, [onCreateProjectFromPrompt, onStartResearchFromNews, projects, selectedProject]);

  if (isLoading) {
    return <MainContentStateView mode="loading" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  if (activeTab === 'dashboard') {
    return (
      <div className="h-full min-h-0 overflow-hidden">
        <React.Suspense fallback={<LazyTabFallback />}>
          <ResearchSecretaryDashboard
            projects={projects}
            onNavigate={handleResearchSecretaryNavigate}
            onCommand={handleResearchSecretaryCommand}
            onMenuClick={isMobile ? onMenuClick : undefined}
          />
        </React.Suspense>
      </div>
    );
  }

  if (activeTab === 'submissions') {
    return <div className="h-full min-h-0 overflow-hidden"><React.Suspense fallback={<LazyTabFallback />}><SubmissionCenter projects={projects} onMenuClick={isMobile ? onMenuClick : undefined} /></React.Suspense></div>;
  }

  if (activeTab === 'thesis') {
    return <div className="h-full min-h-0 overflow-hidden"><React.Suspense fallback={<LazyTabFallback />}><ThesisCenter projects={projects} onMenuClick={isMobile ? onMenuClick : undefined} /></React.Suspense></div>;
  }

  if (activeTab === 'dailyReview') {
    return <div className="h-full min-h-0 overflow-hidden"><React.Suspense fallback={<LazyTabFallback />}><DailyReviewCenter onMenuClick={isMobile ? onMenuClick : undefined} /></React.Suspense></div>;
  }

  if (activeTab === 'meetings') {
    return <div className="h-full min-h-0 overflow-hidden"><React.Suspense fallback={<LazyTabFallback />}><MeetingCenter projects={projects} onCommand={handleResearchSecretaryCommand} onMenuClick={isMobile ? onMenuClick : undefined} /></React.Suspense></div>;
  }

  if (activeTab === 'advisor') {
    return <div className="h-full min-h-0 overflow-hidden"><React.Suspense fallback={<LazyTabFallback />}><AdvisorActionCenter projects={projects} onMenuClick={isMobile ? onMenuClick : undefined} /></React.Suspense></div>;
  }

  if (activeTab === 'automation') {
    return <div className="h-full min-h-0 overflow-hidden"><React.Suspense fallback={<LazyTabFallback />}><AutomationCenter projects={projects} onRunCommand={handleResearchSecretaryCommand} onMenuClick={isMobile ? onMenuClick : undefined} /></React.Suspense></div>;
  }

  if (activeTab === 'companions') {
    return <CompanionCenter onMenuClick={isMobile ? onMenuClick : undefined} />;
  }

  if (activeTab === 'miniApps') {
    return <MiniAppCenter onMenuClick={isMobile ? onMenuClick : undefined} onCreateWithAgent={handleMiniAppCreateWithAgent} />;
  }

  if (activeTab === 'settings') {
    return (
      <div className="h-full min-h-0 overflow-hidden">
        <React.Suspense fallback={<LazyTabFallback />}>
          <SettingsPage
            isOpen
            onClose={onCloseSettings}
            projects={projects}
            initialTab={settingsInitialTab}
            onMenuClick={isMobile ? onMenuClick : undefined}
          />
        </React.Suspense>
      </div>
    );
  }

  if (activeTab === 'trash') {
    return (
      <div className="h-full flex flex-col">
        <MainContentHeader
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          selectedProject={null}
          selectedSession={null}
          isMobile={isMobile}
          onMenuClick={onMenuClick}
          onNavigateBack={handleNavigateBack}
        />

        <div className="flex-1 min-h-0 overflow-hidden">
          <React.Suspense fallback={<LazyTabFallback />}>
            <TrashDashboard
              projects={trashProjects}
              isLoading={Boolean(isTrashLoading)}
              onRefresh={async () => {
                await Promise.all([
                  window.refreshProjects?.(),
                  window.refreshTrashProjects?.(),
                ]);
              }}
            />
          </React.Suspense>
        </div>
      </div>
    );
  }

  if (activeTab === 'news') {
    return (
      <div className="h-full min-h-0 overflow-hidden">
        <ProFeatureGate capability={CAPABILITIES.literatureMonitor} feature="literatureMonitor">
          <React.Suspense fallback={<LazyTabFallback />}>
            <NewsDashboard
              chatTargetProject={selectedProject ?? currentProject ?? null}
              onStartResearchPrompt={
                onStartResearchFromNews
                  ? (project: Project, prompt: string | ChatPromptDraft) => {
                      onStartResearchFromNews(project, prompt);
                    }
                  : undefined
              }
            />
          </React.Suspense>
        </ProFeatureGate>
      </div>
    );
  }

  if (activeTab === 'conversationHistory') {
    return (
      <div className="h-full min-h-0 overflow-hidden">
        <ProFeatureGate capability={CAPABILITIES.conversationArchive} feature="conversationArchive">
          <React.Suspense fallback={<LazyTabFallback />}>
            <ConversationHistoryDashboard isMobile={isMobile} onMenuClick={onMenuClick} />
          </React.Suspense>
        </ProFeatureGate>
      </div>
    );
  }

  if (isMedLibraryAppTab(activeTab)) {
    return (
      <div className="h-full min-h-0 overflow-hidden">
        <React.Suspense fallback={<LazyTabFallback />}>
          <MedicalLibraryDashboard
            initialTab={getMedLibrarySection(activeTab)}
            chatTargetProject={selectedProject ?? currentProject ?? projects[0] ?? null}
            onSendToChat={onStartResearchFromNews}
          />
        </React.Suspense>
      </div>
    );
  }

  if (!selectedProject) {
    return <MainContentStateView mode="empty" isMobile={isMobile} onMenuClick={onMenuClick} />;
  }

  return (
    <div
      data-chat-layout-root=""
      className={
        showRightSidePanel
          ? 'grid h-full min-h-0 overflow-hidden'
          : 'flex h-full flex-col min-h-0 overflow-hidden'
      }
      style={
        showRightSidePanel
          ? {
              gridTemplateColumns: 'minmax(0, 1fr) auto',
              gridTemplateRows: 'auto minmax(0, 1fr)',
            }
          : undefined
      }
    >
      <div className={showRightSidePanel ? 'col-start-1 row-start-1 min-w-0' : undefined}>
        <MainContentHeader
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          isMobile={isMobile}
          onMenuClick={onMenuClick}
          onNavigateBack={handleNavigateBack}
          contentInsetRight={showRightSidePanel ? 0 : chatSidebarInset}
          showExpandContextSidebar={showExpandContextSidebar}
          onExpandContextSidebar={handleExpandContextSidebar}
        />
      </div>

      <div
        className={
          showRightSidePanel
            ? 'col-start-1 row-start-2 flex min-h-0 min-w-0 flex-col overflow-hidden'
            : 'flex flex-1 min-h-0 flex-col overflow-hidden'
        }
      >
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className={`flex flex-col min-h-0 overflow-hidden ${editorExpanded ? 'hidden' : ''} flex-1`}>
            <div className={`h-full ${activeTab === 'chat' ? 'block' : 'hidden'}`}>
              <ErrorBoundary showDetails>
                <React.Suspense fallback={<LazyTabFallback />}>
                  <ChatInterface
                    key={chatViewIdentityKey}
                    selectedProject={selectedProject}
                    selectedSession={selectedSession}
                    initialProjectFiles={
                      !selectedSession && draftOpenRequest.projectName === selectedProject?.name
                        ? draftOpenRequest.projectFiles
                        : []
                    }
                    ws={ws}
                    sendMessage={sendMessage}
                    latestMessage={latestMessage}
                    onFileOpen={handleFileOpen}
                    onInputFocusChange={onInputFocusChange}
                    onSessionActive={onSessionActive}
                    onSessionInactive={onSessionInactive}
                    onSessionProcessing={onSessionProcessing}
                    onSessionNotProcessing={onSessionNotProcessing}
                    processingSessions={processingSessions}
                    onReplaceTemporarySession={onReplaceTemporarySession}
                    onNavigateToSession={onNavigateToSession}
                    onShowSettings={onShowSettings}
                    autoExpandTools={autoExpandTools}
                    showRawParameters={showRawParameters}
                    showThinking={showThinking}
                    autoScrollToBottom={autoScrollToBottom}
                    sendByCtrlEnter={sendByCtrlEnter}
                    externalMessageUpdate={externalMessageUpdate}
                    newSessionResetKey={newSessionResetKey}
                    preserveDraftProjectRebind={isDraftProjectPromotion}
                    pendingAutoIntake={pendingAutoIntake}
                    clearPendingAutoIntake={clearPendingAutoIntake}
                    importedProjectAnalysisPrompt={importedProjectAnalysisPrompt}
                    clearImportedProjectAnalysisPrompt={clearImportedProjectAnalysisPrompt}
                    onStartWorkspaceQa={onStartWorkspaceQa}
                    newSessionMode={newSessionMode}
                    onNewSessionModeChange={onNewSessionModeChange}
                    currentResearchStage={currentResearchStage}
                    onNavigateAppTab={setActiveTab}
                    onContextSidebarLayoutChange={setChatSidebarLayout}
                    contextSidebarExpandSignal={sidebarExpandSignal}
                    detachContextSidebar={detachChatContextSidebar}
                    contextSidebarTab={contextSidebarTab}
                    onContextSidebarTabChange={setContextSidebarTab}
                    onContextSidebarMessagesChange={setContextSidebarMessages}
                    onContextSidebarProviderChange={setContextSidebarProvider}
                    onRegisterContextSidebarHandlers={setContextSidebarHandlers}
                    onCreateProjectFromPrompt={onCreateProjectFromPrompt}
                    onProjectSelect={onProjectSelect}
                    onStartConversationWithProject={(project: Project) => onNewSession?.(project, newSessionMode)}
                    onClearConversationFolder={() => {
                      const defaultConversationProject = projects.find((project) => project.isDefaultWorkspace);
                      if (defaultConversationProject) {
                        onClearConversationFolder?.(defaultConversationProject);
                      }
                    }}
                    onSelectionConsultationChange={handleSelectionConsultationChange}
                  />
                </React.Suspense>
              </ErrorBoundary>
            </div>

          {activeTab === 'context' && (
            <div className="h-full overflow-hidden">
              <React.Suspense fallback={<LazyTabFallback />}>
                <ChatContextSidebar
                  selectedProject={selectedProject}
                  selectedSession={selectedSession}
                  currentSessionId={selectedSession?.id || null}
                  provider={selectedSession?.__provider || 'claude'}
                  newSessionMode={newSessionMode}
                  chatMessages={[]}
                  onFileOpen={(filePath: string, diffInfo: any) => handleFileOpen(filePath, diffInfo as any)}
                  onStartWorkspaceQa={onStartWorkspaceQa}
                  onChatFromReference={onChatFromReference ? (ref: Reference) => onChatFromReference(selectedProject, ref) : undefined}
                  activeSidebarTab="context"
                  onNavigateAppTab={setActiveTab}
                />
              </React.Suspense>
            </div>
          )}

          {activeTab === 'files' && (
            <div className="h-full overflow-hidden">
              <React.Suspense fallback={<LazyTabFallback />}>
                <FileTree
                  selectedProject={selectedProject}
                  onFileOpen={handleFileOpen}
                  onStartWorkspaceQa={onStartWorkspaceQa}
                  enableAutoRefresh={false}
                />
              </React.Suspense>
            </div>
          )}

          {activeTab === 'git' && (
            <div className="flex-1 min-h-0 overflow-hidden">
              <React.Suspense fallback={<LazyTabFallback />}>
                <AnyGitPanel selectedProject={selectedProject} isMobile={isMobile} onFileOpen={handleFileOpen} />
              </React.Suspense>
            </div>
          )}

          {activeTab === 'survey' && (
            <div className="h-full overflow-hidden">
              <React.Suspense fallback={<LazyTabFallback />}>
                <SurveyPage
                  selectedProject={selectedProject}
                  onChatFromReference={onChatFromReference ? (ref: Reference) => onChatFromReference(selectedProject, ref) : undefined}
                  rightSidebarWidth={surveySidebarWidth}
                />
              </React.Suspense>
            </div>
          )}

          <div className={`h-full overflow-hidden ${activeTab === 'preview' ? 'block' : 'hidden'}`} />
        </div>

          {editingFile && !showTopDockedEditor && (
            <React.Suspense fallback={<LazyTabFallback />}>
              <EditorSidebar
                editingFile={editingFile}
                editorMode={editorMode}
                isMobile={isMobile}
                editorExpanded={editorExpanded}
                editorWidth={editorWidth}
                resizeHandleRef={resizeHandleRef}
                onResizeStart={handleResizeStart}
                onCloseEditor={handleCloseEditor}
                onStartEditing={handleStartEditing}
                onToggleEditorExpand={handleToggleEditorExpand}
                onReturnToOrigin={handleReturnToEditorOrigin}
                projectPath={selectedProject.fullPath || selectedProject.path}
                selectedProject={selectedProject}
                onStartWorkspaceQa={onStartWorkspaceQa}
                onAddProjectFileToCurrentChat={handleAddProjectFileToCurrentChat}
                fillSpace={false}
              />
            </React.Suspense>
          )}
        </div>
      </div>

      {showTopDockedEditor && editingFile && (
        <div className="col-start-2 row-start-1 row-span-2 flex min-h-0 flex-shrink-0 self-stretch overflow-hidden">
          <React.Suspense fallback={<LazyTabFallback />}>
            <EditorSidebar
              editingFile={editingFile}
              editorMode={editorMode}
              isMobile={isMobile}
              editorExpanded={editorExpanded}
              editorWidth={editorWidth}
              resizeHandleRef={resizeHandleRef}
              onResizeStart={handleResizeStart}
              onCloseEditor={handleCloseEditor}
              onStartEditing={handleStartEditing}
              onToggleEditorExpand={handleToggleEditorExpand}
              onReturnToOrigin={handleReturnToEditorOrigin}
              projectPath={selectedProject.fullPath || selectedProject.path}
              selectedProject={selectedProject}
              onStartWorkspaceQa={onStartWorkspaceQa}
              onAddProjectFileToCurrentChat={handleAddProjectFileToCurrentChat}
              fillSpace={false}
            />
          </React.Suspense>
        </div>
      )}

      {showDetachedChatSidebar && (
        <div
          className="col-start-2 row-start-1 row-span-2 flex min-h-0 flex-shrink-0 self-stretch"
          style={chatSidebarLayout.width > 0 ? { minWidth: chatSidebarLayout.width } : undefined}
        >
          <React.Suspense fallback={<LazyTabFallback />}>
            <ChatContextSidebar
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              currentSessionId={selectedSession?.id || null}
              provider={contextSidebarProvider}
              newSessionMode={newSessionMode}
              chatMessages={contextSidebarMessages}
              onFileOpen={(filePath: string, diffInfo: unknown) => {
                if (contextSidebarHandlers?.onFileOpen) {
                  contextSidebarHandlers.onFileOpen(filePath, diffInfo);
                  return;
                }
                handleFileOpen(filePath, diffInfo as any);
              }}
              onStartWorkspaceQa={onStartWorkspaceQa}
              onChatFromReference={onChatFromReference ? (ref: Reference) => onChatFromReference(selectedProject, ref) : undefined}
              activeSidebarTab={contextSidebarTab}
              onSidebarTabChange={setContextSidebarTab}
              onStartTask={contextSidebarHandlers?.onStartTask}
              onSummarizeMemory={contextSidebarHandlers?.onSummarizeMemory}
              onNavigateAppTab={setActiveTab}
              onLayoutChange={setChatSidebarLayout}
              expandSignal={sidebarExpandSignal}
              consultationContent={selectionConsultationSeed ? (
                <SelectionConsultationPanel
                  seed={selectionConsultationSeed}
                  selectedProject={selectedProject}
                  provider={selectionConsultationSeed.provider}
                  latestMessage={latestMessage}
                  sendMessage={sendMessage}
                  onClose={() => handleSelectionConsultationChange(null)}
                />
              ) : undefined}
            />
          </React.Suspense>
        </div>
      )}
    </div>
  );
}

export default React.memo(MainContent);
