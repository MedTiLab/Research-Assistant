import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Sidebar from '../sidebar/view/Sidebar';
import { useDesktopCompanionSync } from '../../features/companions/useDesktopCompanionSync';
import MainContent from '../main-content/view/MainContent';
import MobileNav from '../MobileNav';

import { useWebSocket } from '../../contexts/WebSocketContext';
import { useAuth } from '../../contexts/AuthContext';
import { useLocalKernel } from '../../state/localKernelStore';
import { useDeviceSettings } from '../../hooks/useDeviceSettings';
import { useSessionProtection } from '../../hooks/useSessionProtection';
import { useProjectsState } from '../../hooks/useProjectsState';
import { useInteractionTelemetry } from '../../hooks/useInteractionTelemetry';
import { useUiPreferences } from '../../hooks/useUiPreferences';
import { isTelemetryEnabled, TELEMETRY_SETTINGS_EVENT } from '../../utils/telemetry';
import { getDesktopRuntimeInfo } from '../../utils/desktopRuntime';
import {
  SIDEBAR_DESKTOP_NAV_WIDTH,
  SIDEBAR_ICON_RAIL_WIDTH,
} from '../sidebar/view/subcomponents/sidebarNavTiles';
import {
  armTaskCompletionSound,
  notifyTaskCompletion,
  primeTaskCompletionAudio,
} from '../../utils/taskCompletionSound';
import {
  clearSessionAbortRequested,
  clearSessionTimerStart,
  clearTemporarySessionTimerStarts,
  isSessionAbortRequested,
  persistSessionTimerStart,
} from '../chat/utils/chatStorage';
import { createClientAgentSessionKey } from '../../utils/agentSessionIdentity';
import {
  collectActiveSessionKeys,
  getLifecycleSessionIdentities,
  getLifecycleSessionIds,
} from './sessionActivity';
const SESSION_FINISHED_MESSAGE_TYPES = new Set([
  'claude-complete',
  'codex-complete',
  'localgpu-complete',
  'session-aborted',
  'claude-error',
  'codex-error',
  'localgpu-error',
]);

const SESSION_SUCCESS_MESSAGE_TYPES = new Set([
  'claude-complete',
  'codex-complete',
  'localgpu-complete',
]);

const SESSION_PROGRESS_MESSAGE_TYPES = new Set([
  'claude-response',
  'codex-response',
  'localgpu-response',
]);

function createColumnResizeShield() {
  const shield = document.createElement('div');
  shield.setAttribute('aria-hidden', 'true');
  shield.dataset.columnResizeShield = 'true';
  Object.assign(shield.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    cursor: 'col-resize',
    background: 'transparent',
  });
  document.body.appendChild(shield);
  return () => shield.remove();
}

export default function AppContent() {
  useDesktopCompanionSync();
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const { t } = useTranslation('common');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const isDesktopShell = getDesktopRuntimeInfo().isDesktopShell;
  const { ws, sendMessage, latestMessage, isConnected } = useWebSocket();
  const { refreshOnboardingStatus } = useAuth();
  const localKernel = useLocalKernel();
  const { preferences } = useUiPreferences();
  const { sidebarVisible } = preferences;

  const {
    activeSessions,
    processingSessions,
    markSessionAsActive,
    markSessionAsInactive,
    markSessionAsProcessing,
    markSessionAsNotProcessing,
    replaceTemporarySession,
    syncProcessingSessions,
  } = useSessionProtection();

  const {
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
    sidebarSharedProps,
    handleProjectSelect,
    handleNewSession,
    handleClearConversationFolder,
    handleNavigateToSession,
    handleStartWorkspaceQa,
    handleChatFromReference,
    handleStartResearchFromNews,
    handleOpenVariablePubMedDiscovery,
    pendingAutoIntake,
    handleProjectCreatedWithIntake,
    handleCreateDraftProjectFromPrompt,
    clearPendingAutoIntake,
    clearImportedProjectAnalysisPrompt,
  } = useProjectsState({
    sessionId,
    navigate,
    latestMessage,
    isMobile,
    activeSessions,
    processingSessions,
  });

  useEffect(() => window.medhelpDesktop?.onOpenAppTab?.((tab) => {
    setActiveTab(tab);
    setSidebarOpen(false);
  }), [setActiveTab, setSidebarOpen]);

  useEffect(() => {
    if (!isConnected) {
      return;
    }

    sendMessage({ type: 'get-active-sessions' });
  }, [isConnected, sendMessage]);

  useEffect(() => {
    if (!preferences.completionSoundEnabled) {
      return undefined;
    }

    let primed = false;
    const primeAudio = () => {
      if (primed) return;
      primed = true;
      void primeTaskCompletionAudio();
      window.removeEventListener('pointerdown', primeAudio);
      window.removeEventListener('keydown', primeAudio);
    };

    window.addEventListener('pointerdown', primeAudio, { once: true });
    window.addEventListener('keydown', primeAudio, { once: true });
    return () => {
      window.removeEventListener('pointerdown', primeAudio);
      window.removeEventListener('keydown', primeAudio);
    };
  }, [preferences.completionSoundEnabled]);

  useEffect(() => {
    if (localKernel.isRequired && localKernel.state === 'connected') {
      void refreshOnboardingStatus();
    }
  }, [localKernel.isRequired, localKernel.state, refreshOnboardingStatus]);

  useEffect(() => {
    const messageType = typeof latestMessage?.type === 'string' ? latestMessage.type : '';
    const messageSessionId =
      typeof latestMessage?.sessionId === 'string' && latestMessage.sessionId.trim()
        ? latestMessage.sessionId
        : null;
    const lifecycleSessionIds = getLifecycleSessionIds(latestMessage);
    const primarySessionId = messageSessionId || lifecycleSessionIds[0] || null;
    const lifecycleIdentities = getLifecycleSessionIdentities(latestMessage, {
      projectKey: selectedProject?.name,
      runtimeId: selectedSession?.__provider,
    });
    const primaryIdentity = lifecycleIdentities.find((identity) => identity.sessionId === primarySessionId)
      || lifecycleIdentities[0]
      || null;
    const sessionScope = primaryIdentity ? {
      ownerKey: primaryIdentity.ownerKey,
      projectKey: primaryIdentity.projectKey,
      runtimeId: primaryIdentity.runtimeId,
    } : undefined;

    if (!primarySessionId) {
      return;
    }

    if (messageType === 'session-created') {
      armTaskCompletionSound(primarySessionId, lifecycleSessionIds);
      lifecycleSessionIds
        .filter((sessionId) => sessionId !== primarySessionId)
        .forEach((sessionId) => {
          clearSessionTimerStart(sessionId);
          clearSessionAbortRequested(sessionId);
          markSessionAsInactive(sessionId, sessionScope);
          markSessionAsNotProcessing(sessionId, sessionScope);
        });

      clearTemporarySessionTimerStarts();
      if (Number.isFinite(latestMessage.startTime)) {
        persistSessionTimerStart(primarySessionId, latestMessage.startTime);
      }
      const previousSessionId = lifecycleSessionIds.find((id) => id !== primarySessionId) || null;
      replaceTemporarySession(primarySessionId, sessionScope, previousSessionId);
      return;
    }

    if (SESSION_PROGRESS_MESSAGE_TYPES.has(messageType)) {
      armTaskCompletionSound(primarySessionId, lifecycleSessionIds);
    }

    if (messageType === 'session-status') {
      if (latestMessage.isProcessing) {
        armTaskCompletionSound(primarySessionId, lifecycleSessionIds);
        if (Number.isFinite(latestMessage.startTime)) {
          persistSessionTimerStart(primarySessionId, latestMessage.startTime);
        }
        markSessionAsActive(primarySessionId, sessionScope);
        markSessionAsProcessing(primarySessionId, sessionScope);
        return;
      }

      const primarySessionKey = createClientAgentSessionKey(primarySessionId, sessionScope || {});
      const wasProcessing = Boolean(primarySessionKey && processingSessions.has(primarySessionKey));
      const wasAbortRequested = isSessionAbortRequested(primarySessionId);
      if (wasProcessing && !wasAbortRequested) {
        const visibleSessionId = selectedSession?.id || sessionId || null;
        void notifyTaskCompletion({
          sessionId: primarySessionId,
          relatedSessionIds: lifecycleSessionIds,
          isBackgroundConversation: activeTab === 'settings' || activeTab !== 'chat' || primarySessionId !== visibleSessionId,
        });
      }

      clearSessionTimerStart(primarySessionId);
      clearSessionAbortRequested(primarySessionId);
      markSessionAsInactive(primarySessionId, sessionScope);
      markSessionAsNotProcessing(primarySessionId, sessionScope);
      return;
    }

    if (!SESSION_FINISHED_MESSAGE_TYPES.has(messageType)) {
      return;
    }

    const sessionIdsToClear = lifecycleSessionIds.length > 0 ? lifecycleSessionIds : [primarySessionId];
    if (SESSION_SUCCESS_MESSAGE_TYPES.has(messageType)) {
      const visibleSessionId = selectedSession?.id || sessionId || null;
      const completionMatchesVisibleConversation = sessionIdsToClear.includes(visibleSessionId || '');
      void notifyTaskCompletion({
        sessionId: primarySessionId,
        relatedSessionIds: sessionIdsToClear,
        isBackgroundConversation: activeTab === 'settings' || activeTab !== 'chat' || !completionMatchesVisibleConversation,
      });
    }
    sessionIdsToClear.forEach((sessionId) => {
      clearSessionTimerStart(sessionId);
      clearSessionAbortRequested(sessionId);
      markSessionAsInactive(sessionId, sessionScope);
      markSessionAsNotProcessing(sessionId, sessionScope);
    });
    clearTemporarySessionTimerStarts();
  }, [
    latestMessage,
    markSessionAsActive,
    markSessionAsInactive,
    markSessionAsNotProcessing,
    markSessionAsProcessing,
    processingSessions,
    replaceTemporarySession,
    activeTab,
    selectedSession?.id,
    selectedSession?.__provider,
    selectedProject?.name,
    sessionId,
  ]);

  useEffect(() => {
    if (latestMessage?.type !== 'meeting-reminder') return;
    const reminder = latestMessage.reminder;
    if (!reminder || typeof reminder !== 'object') return;
    const title = typeof reminder.title === 'string' ? reminder.title : '科研秘书提醒';
    const body = typeof reminder.body === 'string' ? reminder.body : '';

    if (window.medhelpDesktop?.showNotification) {
      void window.medhelpDesktop.showNotification({ title, body });
      return;
    }
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
      return;
    }
    if (Notification.permission === 'default') {
      void Notification.requestPermission().then((permission) => {
        if (permission === 'granted') new Notification(title, { body });
      });
    }
  }, [latestMessage]);

  useEffect(() => {
    if (latestMessage?.type !== 'active-sessions') {
      return;
    }

    syncProcessingSessions(collectActiveSessionKeys(latestMessage.sessions, processingSessions));
  }, [latestMessage, processingSessions, syncProcessingSessions]);

  useInteractionTelemetry({
    selectedProjectName: selectedProject?.name || null,
    selectedSessionId: selectedSession?.id || sessionId || null,
    activeTab: activeTab || null,
    routePath: location.pathname || null,
  });

  useEffect(() => {
    if (
      location.pathname === '/variable-knowledge/pubmed-discovery'
      && activeTab !== 'variableKnowledgePubmedDiscovery'
    ) {
      handleOpenVariablePubMedDiscovery();
    }
  }, [activeTab, handleOpenVariablePubMedDiscovery, location.pathname]);

  useEffect(() => {
    window.refreshProjects = fetchProjects;

    return () => {
      if (window.refreshProjects === fetchProjects) {
        delete window.refreshProjects;
      }
    };
  }, [fetchProjects]);

  useEffect(() => {
    window.refreshTrashProjects = fetchTrashProjects;

    return () => {
      if (window.refreshTrashProjects === fetchTrashProjects) {
        delete window.refreshTrashProjects;
      }
    };
  }, [fetchTrashProjects]);

  useEffect(() => {
    window.openSettings = openSettings;

    return () => {
      if (window.openSettings === openSettings) {
        delete window.openSettings;
      }
    };
  }, [openSettings]);

  useEffect(() => {
    window.handleProjectCreatedWithIntake = handleProjectCreatedWithIntake;

    return () => {
      if (window.handleProjectCreatedWithIntake === handleProjectCreatedWithIntake) {
        delete window.handleProjectCreatedWithIntake;
      }
    };
  }, [handleProjectCreatedWithIntake]);

  useEffect(() => {
    if (!isConnected) {
      return;
    }

    const syncTelemetrySetting = () => {
      sendMessage({
        type: 'telemetry-settings',
        enabled: isTelemetryEnabled(),
      });
    };

    syncTelemetrySetting();
    window.addEventListener(TELEMETRY_SETTINGS_EVENT, syncTelemetrySetting);
    return () => {
      window.removeEventListener(TELEMETRY_SETTINGS_EVENT, syncTelemetrySetting);
    };
  }, [isConnected, sendMessage]);

  const SIDEBAR_MIN = 220;
  const SIDEBAR_MAX = 480;
  const SIDEBAR_DEFAULT = 288; // w-72
  const PRIMARY_NAV_MIN = 148;
  const PRIMARY_NAV_MAX = 280;
  const PRIMARY_NAV_DEFAULT = SIDEBAR_DESKTOP_NAV_WIDTH;
  const STORAGE_KEY = 'med-help-sidebar-width';
  const PRIMARY_NAV_STORAGE_KEY = 'med-help-primary-nav-width';
  const PRIMARY_NAV_COLLAPSED_STORAGE_KEY = 'med-help-primary-nav-collapsed';
  const PROJECT_PANE_VISIBLE_STORAGE_KEY = 'med-help-project-pane-visible';
  const LEGACY_STORAGE_KEYS = ['dr-claw-sidebar-width', 'vibelab-sidebar-width'];

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
      ?? LEGACY_STORAGE_KEYS.map((key) => localStorage.getItem(key)).find((value) => value != null)
      ?? null;
    const parsed = saved ? Number(saved) : NaN;
    return Number.isFinite(parsed) && parsed >= SIDEBAR_MIN && parsed <= SIDEBAR_MAX
      ? parsed
      : SIDEBAR_DEFAULT;
  });
  const [primaryNavWidth, setPrimaryNavWidth] = useState(() => {
    const saved = Number(localStorage.getItem(PRIMARY_NAV_STORAGE_KEY));
    return Number.isFinite(saved) && saved >= PRIMARY_NAV_MIN && saved <= PRIMARY_NAV_MAX
      ? saved
      : PRIMARY_NAV_DEFAULT;
  });
  const [primaryNavCollapsed, setPrimaryNavCollapsed] = useState(
    () => localStorage.getItem(PRIMARY_NAV_COLLAPSED_STORAGE_KEY) === 'true',
  );
  const [projectPaneVisible, setProjectPaneVisible] = useState(
    () => localStorage.getItem(PROJECT_PANE_VISIBLE_STORAGE_KEY) !== 'false',
  );
  const primaryNavRenderedWidth = primaryNavCollapsed
    ? Number.parseFloat(SIDEBAR_ICON_RAIL_WIDTH) * 16
    : primaryNavWidth;
  const desktopSidebarWidth = projectPaneVisible
    ? primaryNavRenderedWidth + sidebarWidth
    : primaryNavRenderedWidth;

  const isResizing = useRef(false);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    setIsSidebarResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const removeResizeShield = createColumnResizeShield();

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const projectPaneWidth = ev.clientX - primaryNavRenderedWidth;
      const newWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, projectPaneWidth));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      isResizing.current = false;
      setIsSidebarResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onMouseUp);
      removeResizeShield();
      setSidebarWidth((w) => {
        localStorage.setItem(STORAGE_KEY, String(w));
        LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
        return w;
      });
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', onMouseUp);
  }, [primaryNavRenderedWidth]);

  const handlePrimaryNavResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsSidebarResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const removeResizeShield = createColumnResizeShield();

    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = Math.min(PRIMARY_NAV_MAX, Math.max(PRIMARY_NAV_MIN, ev.clientX));
      setPrimaryNavWidth(newWidth);
    };

    const onMouseUp = () => {
      setIsSidebarResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('blur', onMouseUp);
      removeResizeShield();
      setPrimaryNavWidth((width) => {
        localStorage.setItem(PRIMARY_NAV_STORAGE_KEY, String(width));
        return width;
      });
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    window.addEventListener('blur', onMouseUp);
  }, []);

  const setPrimaryNavCollapsePreference = useCallback((collapsed: boolean) => {
    setPrimaryNavCollapsed(collapsed);
    localStorage.setItem(PRIMARY_NAV_COLLAPSED_STORAGE_KEY, String(collapsed));
  }, []);

  const setProjectPaneVisibility = useCallback((visible: boolean) => {
    setProjectPaneVisible(visible);
    localStorage.setItem(PROJECT_PANE_VISIBLE_STORAGE_KEY, String(visible));
  }, []);

  return (
    <div className={`medical-workbench-shell fixed inset-0 flex bg-background ${isDesktopShell ? 'medhelp-desktop-window' : ''}`}>
      {!isMobile ? (
        <div
          className={`medical-workbench-sidebar-frame relative z-20 h-full flex-shrink-0 border-r border-transparent ${isSidebarResizing ? '' : 'transition-[width] duration-150 ease-out'}`}
          style={{ width: desktopSidebarWidth }}
        >
          <div className="h-full">
            <Sidebar
              {...sidebarSharedProps}
              primaryNavCollapsed={primaryNavCollapsed}
              primaryNavWidth={primaryNavWidth}
              projectPaneVisible={projectPaneVisible}
              onCollapsePrimaryNav={() => setPrimaryNavCollapsePreference(true)}
              onExpandPrimaryNav={() => setPrimaryNavCollapsePreference(false)}
              onCollapseProjectPane={() => setProjectPaneVisibility(false)}
              onExpandProjectPane={() => setProjectPaneVisibility(true)}
            />
          </div>
          {!primaryNavCollapsed && (
            <div
              className="medical-sidebar-resize-handle absolute bottom-0 top-0 z-20 w-1 cursor-col-resize"
              style={{ left: primaryNavWidth - 2 }}
              onMouseDown={handlePrimaryNavResizeStart}
              role="separator"
              aria-orientation="vertical"
              aria-label="调整功能导航宽度"
            />
          )}
          {projectPaneVisible && (
            <div
              className="medical-sidebar-resize-handle absolute top-0 right-0 z-10 h-full w-1 cursor-col-resize"
              onMouseDown={handleResizeStart}
              role="separator"
              aria-orientation="vertical"
              aria-label="调整项目栏宽度"
            />
          )}
        </div>
      ) : (
        <div
          className={`fixed inset-0 z-50 flex transition-all duration-150 ease-out ${sidebarOpen ? 'opacity-100 visible' : 'opacity-0 invisible'
            }`}
        >
          <button
            className="fixed inset-0 bg-background/60 backdrop-blur-sm transition-opacity duration-150 ease-out"
            onClick={(event) => {
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            onTouchStart={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSidebarOpen(false);
            }}
            aria-label={t('versionUpdate.ariaLabels.closeSidebar')}
          />
          <div
            className={`relative w-[85vw] max-w-sm sm:w-80 h-full bg-card shadow-[8px_0_22px_-14px_rgba(15,23,42,0.38)] dark:shadow-[8px_0_24px_-14px_rgba(0,0,0,0.72)] transform transition-transform duration-150 ease-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'
              }`}
            onClick={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
          >
            <Sidebar {...sidebarSharedProps} />
          </div>
        </div>
      )}

      <div className={`medical-workbench-main flex-1 flex flex-col min-w-0 ${isMobile ? 'pb-mobile-nav' : ''}`}>
        <MainContent
          projects={projects}
          trashProjects={trashProjects}
          trashSessions={trashSessions}
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          draftOpenRequest={draftOpenRequest}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          ws={ws}
          sendMessage={sendMessage}
          latestMessage={latestMessage}
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
          isLoading={isLoadingProjects}
          isTrashLoading={isLoadingTrashProjects}
          onInputFocusChange={setIsInputFocused}
          onSessionActive={markSessionAsActive}
          onSessionInactive={markSessionAsInactive}
          onSessionProcessing={markSessionAsProcessing}
          onSessionNotProcessing={markSessionAsNotProcessing}
          processingSessions={processingSessions}
          onReplaceTemporarySession={replaceTemporarySession}
          onNavigateToSession={(targetSessionId: string, targetProvider?, targetProjectName?) =>
            handleNavigateToSession(targetSessionId, targetProvider, targetProjectName)}
          onShowSettings={() => openSettings()}
          settingsInitialTab={settingsInitialTab}
          onCloseSettings={closeSettings}
          externalMessageUpdate={externalMessageUpdate}
          newSessionResetKey={newSessionResetKey}
          pendingAutoIntake={pendingAutoIntake}
          clearPendingAutoIntake={clearPendingAutoIntake}
          importedProjectAnalysisPrompt={importedProjectAnalysisPrompt}
          clearImportedProjectAnalysisPrompt={clearImportedProjectAnalysisPrompt}
          onProjectSelect={handleProjectSelect}
          onNewSession={handleNewSession}
          onClearConversationFolder={handleClearConversationFolder}
          onStartWorkspaceQa={handleStartWorkspaceQa}
          onChatFromReference={handleChatFromReference}
          onStartResearchFromNews={handleStartResearchFromNews}
          newSessionMode={newSessionMode}
          onNewSessionModeChange={setNewSessionMode}
          onCreateProjectFromPrompt={handleCreateDraftProjectFromPrompt}
        />
      </div>

      {isMobile && (
        <MobileNav
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          isInputFocused={isInputFocused}
          hasSelectedProject={Boolean(selectedProject)}
        />
      )}

    </div>
  );
}
