import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDeviceSettings } from '../../../hooks/useDeviceSettings';
import { useLocalKernelUpdateCheck } from '../../../hooks/useLocalKernelUpdateCheck';
import { useDesktopAppUpdate } from '../../../hooks/useDesktopAppUpdate';
import { useUiPreferences } from '../../../hooks/useUiPreferences';
import { useSidebarController } from '../hooks/useSidebarController';
import { resolveSidebarUpdateChannel } from '../utils/updateChannel';
import { formatModShortcut, isApplePlatform } from '../utils/sidebarSearchPalette';
import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import SidebarIconRail from './subcomponents/SidebarIconRail';
import SidebarContent from './subcomponents/SidebarContent';
import SidebarModals from './subcomponents/SidebarModals';
import SidebarSearchPalette from './subcomponents/SidebarSearchPalette';
import { getDefaultConversationProject } from '../../../utils/draftProject';
import type { Project } from '../../../types/app';
import type { SidebarProjectListProps } from './subcomponents/SidebarProjectList';
import type { SidebarProps } from '../types/types';

type TaskMasterSidebarContext = {
  setCurrentProject: (project: Project) => void;
};

function Sidebar({
  projects,
  selectedProject,
  selectedSession,
  onProjectSelect,
  onSessionSelect,
  onNewSession,
  onSessionDelete,
  onProjectDelete,
  isLoading,
  loadingProgress,
  onRefresh,
  onShowSettings,
  isMobile,
  activeTab,
  processingSessions,
  onOpenDashboard,
  onOpenSubmissions,
  onOpenThesis,
  onOpenDailyReview,
  onOpenMeetings,
  onOpenAdvisor,
  onOpenAutomation,
  onOpenSkills,
  onOpenCompanions,
  onOpenMiniApps,
  onOpenNews,
  onOpenConversationHistory,
  newSessionMode,
  primaryNavCollapsed = false,
  primaryNavWidth,
  projectPaneVisible = true,
  onCollapsePrimaryNav,
  onExpandPrimaryNav,
  onCollapseProjectPane,
  onExpandProjectPane,
}: SidebarProps) {
  const versionReminderStorageKey = 'med-help.versionReminder';
  const { t } = useTranslation(['sidebar', 'common']);
  const { isPWA } = useDeviceSettings({ trackMobile: false });
  const { preferences, setPreference } = useUiPreferences();
  const { sidebarVisible } = preferences;
  const { setCurrentProject } = useTaskMaster() as TaskMasterSidebarContext;
  const localKernelUpdate = useLocalKernelUpdateCheck();
  const desktopAppUpdate = useDesktopAppUpdate();
  const [showLocalKernelUpdateModal, setShowLocalKernelUpdateModal] = useState(false);

  const {
    isSidebarCollapsed,
    expandedProjects,
    editingProject,
    editingName,
    loadingSessions,
    initialSessionsLoaded,
    isRefreshing,
    editingSession,
    editingSessionName,
    deletingProjects,
    deleteConfirmation,
    sessionDeleteConfirmation,
    showVersionModal,
    filteredProjects,
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
    collapseSidebar: handleCollapseSidebar,
    expandSidebar: handleExpandSidebar,
    setEditingName,
    setEditingSession,
    setEditingSessionName,
    setDeleteConfirmation,
    setSessionDeleteConfirmation,
    setShowVersionModal,
  } = useSidebarController({
    projects,
    selectedProject,
    selectedSession,
    isLoading,
    isMobile,
    t,
    onRefresh,
    onProjectSelect,
    onSessionSelect,
    onSessionDelete,
    onProjectDelete,
    setCurrentProject,
    setSidebarVisible: (visible) => setPreference('sidebarVisible', visible),
    sidebarVisible,
    processingSessions,
  });

  const dismissVersionReminder = () => {
    if (typeof window !== 'undefined' && desktopAppUpdate.latestVersion) {
      window.localStorage.setItem(
        versionReminderStorageKey,
        JSON.stringify({
          version: desktopAppUpdate.latestVersion,
          remindAt: Date.now() + VERSION_REMINDER_DELAY_MS,
        }),
      );
    }
    setShowVersionModal(false);
  };

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    document.documentElement.classList.toggle('pwa-mode', isPWA);
    document.body.classList.toggle('pwa-mode', isPWA);
  }, [isPWA]);

  const [showSearchPalette, setShowSearchPalette] = useState(false);
  const searchShortcut = formatModShortcut(isApplePlatform(), 'K');
  const defaultConversationProject = getDefaultConversationProject(projects);

  const handleNewConversation = () => {
    if (defaultConversationProject) {
      onNewSession(defaultConversationProject, newSessionMode);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault();
        setShowSearchPalette((open) => !open);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const footerUpdateChannel = resolveSidebarUpdateChannel({
    isDesktopShell: desktopAppUpdate.isDesktopShell,
    desktopUpdateAvailable: desktopAppUpdate.updateAvailable,
    localKernelUpdateAvailable: localKernelUpdate.updateAvailable,
  });
  const footerUpdateAvailable = footerUpdateChannel !== null;
  const desktopUpdateBusy = desktopAppUpdate.supported
    && ['downloading', 'verifying', 'installing'].includes(desktopAppUpdate.status);
  const desktopUpdateLabel = desktopAppUpdate.supported
    ? desktopAppUpdate.status === 'downloading'
      ? t('common:versionUpdate.desktop.statusBarDownloading', {
          progress: Math.round(desktopAppUpdate.progress || 0),
        })
      : desktopAppUpdate.status === 'verifying'
        ? t('common:versionUpdate.desktop.statusBarVerifying')
        : desktopAppUpdate.status === 'installing'
          ? t('common:versionUpdate.desktop.statusBarInstalling')
          : desktopAppUpdate.status === 'error'
            ? t('common:versionUpdate.desktop.statusBarRetry')
            : t('common:versionUpdate.buttons.updateNow')
    : undefined;
  const showFooterUpdateModal = () => {
    if (footerUpdateChannel === 'desktop') {
      if (desktopAppUpdate.supported) {
        void desktopAppUpdate.startUpdate().catch(() => {
          // The updater state keeps the left-bottom retry action visible.
        });
      } else {
        setShowVersionModal(true);
      }
      return;
    }
    if (footerUpdateChannel === 'localKernel') {
      setShowLocalKernelUpdateModal(true);
    }
  };

  const projectListProps: SidebarProjectListProps = {
    projects,
    filteredProjects,
    selectedProject,
    selectedSession,
    isLoading,
    loadingProgress,
    expandedProjects,
    editingProject,
    editingName,
    loadingSessions,
    initialSessionsLoaded,
    editingSession,
    editingSessionName,
    deletingProjects,
    getProjectSessions,
    isProjectStarred,
    isSessionStarred,
    onEditingNameChange: setEditingName,
    onToggleProject: toggleProject,
    onProjectSelect: handleProjectSelect,
    onToggleStarProject: toggleStarProject,
    onToggleStarSession: toggleStarSession,
    onStartEditingProject: startEditing,
    onCancelEditingProject: cancelEditing,
    onSaveProjectName: (projectName) => {
      void saveProjectName(projectName);
    },
    onDeleteProject: requestProjectDelete,
    onProjectReorder: reorderProjects,
    onSessionSelect: handleSessionClick,
    onDeleteSession: showDeleteSessionConfirmation,
    onLoadMoreSessions: (project) => {
      void loadMoreSessions(project);
    },
    onNewSession,
    newSessionMode,
    onEditingSessionNameChange: setEditingSessionName,
    onStartEditingSession: (sessionId, initialName) => {
      setEditingSession(sessionId);
      setEditingSessionName(initialName);
    },
    onCancelEditingSession: () => {
      setEditingSession(null);
      setEditingSessionName('');
    },
    onSaveEditingSession: (projectName, sessionId, summary, provider) => {
      void updateSessionSummary(projectName, sessionId, summary, provider);
    },
    touchHandlerFactory: handleTouchClick,
    t,
  };

  return (
    <>
      <SidebarModals
        deleteConfirmation={deleteConfirmation}
        onCancelDeleteProject={() => setDeleteConfirmation(null)}
        onConfirmDeleteProject={confirmDeleteProject}
        sessionDeleteConfirmation={sessionDeleteConfirmation}
        onCancelDeleteSession={() => setSessionDeleteConfirmation(null)}
        onConfirmDeleteSession={confirmDeleteSession}
        showVersionModal={showVersionModal || showLocalKernelUpdateModal}
        onCloseVersionModal={() => {
          setShowVersionModal(false);
          setShowLocalKernelUpdateModal(false);
        }}
        onLaterVersionModal={showLocalKernelUpdateModal
          ? () => setShowLocalKernelUpdateModal(false)
          : dismissVersionReminder}
        releaseInfo={showLocalKernelUpdateModal
          ? localKernelUpdate.releaseInfo
          : desktopAppUpdate.releaseInfo}
        currentVersion={showLocalKernelUpdateModal
          ? localKernelUpdate.currentVersion || ''
          : desktopAppUpdate.currentVersion}
        latestVersion={showLocalKernelUpdateModal
          ? localKernelUpdate.latestVersion
          : desktopAppUpdate.latestVersion}
        installMode={showLocalKernelUpdateModal ? 'npm' : 'git'}
        updateTarget={showLocalKernelUpdateModal ? 'localKernel' : 'app'}
        upgradeCommand={showLocalKernelUpdateModal ? localKernelUpdate.upgradeCommand : null}
        downloadUrl={showLocalKernelUpdateModal
          ? localKernelUpdate.downloadUrl
          : desktopAppUpdate.manualDownloadUrl}
        canAutoUpdate={showLocalKernelUpdateModal
          ? localKernelUpdate.canAutoUpdate
          : desktopAppUpdate.supported}
        onLocalKernelUpdate={showLocalKernelUpdateModal ? localKernelUpdate.startUpdate : undefined}
        onAppUpdate={!showLocalKernelUpdateModal && desktopAppUpdate.supported
          ? desktopAppUpdate.startUpdate
          : undefined}
        t={t}
      />

      {isSidebarCollapsed && isMobile ? (
        <SidebarIconRail
          activeTab={activeTab}
          onExpand={handleExpandSidebar}
          onOpenSearch={() => setShowSearchPalette(true)}
          searchShortcut={searchShortcut}
          onOpenDashboard={onOpenDashboard}
          onOpenConversationHistory={onOpenConversationHistory}
          onOpenSubmissions={onOpenSubmissions}
          onOpenThesis={onOpenThesis}
          onOpenDailyReview={onOpenDailyReview}
          onOpenMeetings={onOpenMeetings}
          onOpenAdvisor={onOpenAdvisor}
          onOpenAutomation={onOpenAutomation}
          onOpenSkills={onOpenSkills}
          onOpenCompanions={onOpenCompanions}
          onOpenMiniApps={onOpenMiniApps}
          onOpenNews={onOpenNews}
          onShowSettings={onShowSettings}
          updateAvailable={footerUpdateAvailable}
          updateBusy={desktopUpdateBusy}
          onShowVersionModal={showFooterUpdateModal}
          t={t}
        />
      ) : (
        <SidebarContent
          isPWA={isPWA}
          isMobile={isMobile}
          isLoading={isLoading}
          onOpenSearch={() => setShowSearchPalette(true)}
          searchShortcut={searchShortcut}
          onRefresh={() => {
            void refreshProjects();
          }}
          isRefreshing={isRefreshing}
          onCreateConversation={handleNewConversation}
          onCollapseSidebar={onCollapseProjectPane || handleCollapseSidebar}
          activeTab={activeTab}
          onOpenDashboard={onOpenDashboard}
          onOpenConversationHistory={onOpenConversationHistory}
          onOpenSubmissions={onOpenSubmissions}
          onOpenThesis={onOpenThesis}
          onOpenDailyReview={onOpenDailyReview}
          onOpenMeetings={onOpenMeetings}
          onOpenAdvisor={onOpenAdvisor}
          onOpenAutomation={onOpenAutomation}
          onOpenSkills={onOpenSkills}
          onOpenCompanions={onOpenCompanions}
          onOpenMiniApps={onOpenMiniApps}
          onOpenNews={onOpenNews}
          updateAvailable={footerUpdateAvailable}
          updateLabel={desktopUpdateLabel}
          updateBusy={desktopUpdateBusy}
          onShowVersionModal={showFooterUpdateModal}
          onShowSettings={onShowSettings}
          projectListProps={projectListProps}
          primaryNavCollapsed={primaryNavCollapsed}
          primaryNavWidth={primaryNavWidth}
          projectPaneVisible={projectPaneVisible}
          onCollapsePrimaryNav={onCollapsePrimaryNav}
          onExpandProjectPane={onExpandProjectPane}
          collapsedPrimaryNav={(
            <SidebarIconRail
              activeTab={activeTab}
              onExpand={onExpandPrimaryNav || handleExpandSidebar}
              projectPaneVisible={projectPaneVisible}
              onExpandProjectPane={onExpandProjectPane}
              onOpenSearch={() => setShowSearchPalette(true)}
              searchShortcut={searchShortcut}
              onOpenDashboard={onOpenDashboard}
              onOpenConversationHistory={onOpenConversationHistory}
              onOpenSubmissions={onOpenSubmissions}
              onOpenThesis={onOpenThesis}
              onOpenDailyReview={onOpenDailyReview}
              onOpenMeetings={onOpenMeetings}
              onOpenAdvisor={onOpenAdvisor}
              onOpenAutomation={onOpenAutomation}
              onOpenSkills={onOpenSkills}
              onOpenCompanions={onOpenCompanions}
              onOpenMiniApps={onOpenMiniApps}
              onOpenNews={onOpenNews}
              onShowSettings={onShowSettings}
              updateAvailable={footerUpdateAvailable}
              updateBusy={desktopUpdateBusy}
              onShowVersionModal={showFooterUpdateModal}
              t={t}
            />
          )}
          t={t}
        />
      )}

      <SidebarSearchPalette
        open={showSearchPalette}
        onClose={() => setShowSearchPalette(false)}
        projects={filteredProjects}
        getSessions={getProjectSessions}
        onSelectChat={(session, projectName) => {
          if (!expandedProjects.has(projectName)) {
            toggleProject(projectName);
          }
          handleSessionClick(session, projectName);
        }}
        onSelectProject={handleProjectSelect}
        onCreateConversation={handleNewConversation}
        onOpenConversationHistory={onOpenConversationHistory}
        t={t}
      />

    </>
  );
}

const VERSION_REMINDER_DELAY_MS = 24 * 60 * 60 * 1000;

export default Sidebar;
