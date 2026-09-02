import type { AppTab } from '../../../../types/app';
import { useState, type ReactNode } from 'react';
import { ScrollArea } from '../../../ui/scroll-area';
import type { TFunction } from 'i18next';
import { ChevronDown, ChevronRight, MessageSquarePlus, PanelLeftClose, RefreshCw, Search } from 'lucide-react';
import { Button } from '../../../ui/button';
import SidebarHeader from './SidebarHeader';
import SidebarFooter from './SidebarFooter';
import SidebarScrollableNav from './SidebarScrollableNav';
import SidebarProjectList, { type SidebarProjectListProps } from './SidebarProjectList';
import SidebarProjectControls from './SidebarProjectControls';
import SidebarProjectSessions from './SidebarProjectSessions';
import {
  SIDEBAR_DESKTOP_NAV_WIDTH,
  type SidebarNavTileHandlers,
} from './sidebarNavTiles';

type SidebarContentProps = SidebarNavTileHandlers & {
  isPWA: boolean;
  isMobile: boolean;
  isLoading: boolean;
  onOpenSearch: () => void;
  searchShortcut: string;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCreateConversation: () => void;
  onCollapseSidebar: () => void;
  activeTab: AppTab;
  updateAvailable: boolean;
  onShowVersionModal: () => void;
  updateLabel?: string;
  updateBusy?: boolean;
  onShowSettings: () => void;
  projectListProps: SidebarProjectListProps;
  primaryNavCollapsed?: boolean;
  primaryNavWidth?: number;
  projectPaneVisible?: boolean;
  collapsedPrimaryNav?: ReactNode;
  onCollapsePrimaryNav?: () => void;
  onExpandProjectPane?: () => void;
  t: TFunction;
};

export default function SidebarContent({
  isPWA,
  isMobile,
  isLoading,
  onOpenSearch,
  searchShortcut,
  onRefresh,
  isRefreshing,
  onCreateConversation,
  onCollapseSidebar,
  activeTab,
  onOpenDashboard,
  onOpenConversationHistory,
  onOpenSubmissions,
  onOpenThesis,
  onOpenDailyReview,
  onOpenMeetings,
  onOpenAdvisor,
  onOpenAutomation,
  onOpenSkills,
  onOpenNews,
  onOpenCompanions,
  onOpenMiniApps,
  updateAvailable,
  onShowVersionModal,
  updateLabel,
  updateBusy,
  onShowSettings,
  projectListProps,
  primaryNavCollapsed = false,
  primaryNavWidth = SIDEBAR_DESKTOP_NAV_WIDTH,
  projectPaneVisible = true,
  collapsedPrimaryNav,
  onCollapsePrimaryNav,
  onExpandProjectPane,
  t,
}: SidebarContentProps) {
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const regularProjectListProps: SidebarProjectListProps = {
    ...projectListProps,
    projects: projectListProps.projects.filter((project) => (
      !project.isDefaultWorkspace && !project.isConversationWorkspace
    )),
    filteredProjects: projectListProps.filteredProjects.filter((project) => (
      !project.isDefaultWorkspace && !project.isConversationWorkspace
    )),
  };
  const conversationCandidates = projectListProps.projects.filter((project) => (
    project.isDefaultWorkspace || project.isConversationWorkspace
  ));
  const conversationProjects = conversationCandidates.filter((project) => (
    projectListProps.getProjectSessions(project).length > 0
    || project.name === projectListProps.selectedProject?.name
  ));
  if (conversationProjects.length === 0) {
    const defaultConversationProject = conversationCandidates.find((project) => project.isDefaultWorkspace);
    if (defaultConversationProject) {
      conversationProjects.push(defaultConversationProject);
    }
  }

  const renderProjectSections = () => {
    if (isLoading) {
      return <SidebarProjectList {...projectListProps} />;
    }

    return (
      <div className="space-y-2">
        <section>
          <button
            type="button"
            className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
            onClick={() => setProjectsExpanded((expanded) => !expanded)}
            aria-expanded={projectsExpanded}
          >
            {projectsExpanded
              ? <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
            <span>{t('projects.sectionTitle')}</span>
          </button>
          {projectsExpanded && <SidebarProjectList {...regularProjectListProps} />}
        </section>

        <section>
          <div className="flex h-8 items-center px-2 text-xs font-semibold text-muted-foreground">
            <span>{t('projects.conversations')}</span>
          </div>
          {conversationProjects.map((conversationProject) => (
              <SidebarProjectSessions
                key={conversationProject.name}
                flat
                showNewSessionAction={false}
                project={conversationProject}
                isExpanded
                sessions={projectListProps.getProjectSessions(conversationProject)}
                selectedSession={projectListProps.selectedSession}
                initialSessionsLoaded
                isLoadingSessions={Boolean(projectListProps.loadingSessions[conversationProject.name])}
                editingSession={projectListProps.editingSession}
                editingSessionName={projectListProps.editingSessionName}
                onEditingSessionNameChange={projectListProps.onEditingSessionNameChange}
                onStartEditingSession={projectListProps.onStartEditingSession}
                onCancelEditingSession={projectListProps.onCancelEditingSession}
                onSaveEditingSession={projectListProps.onSaveEditingSession}
                onProjectSelect={projectListProps.onProjectSelect}
                onSessionSelect={projectListProps.onSessionSelect}
                onDeleteSession={projectListProps.onDeleteSession}
                isSessionStarred={projectListProps.isSessionStarred}
                onToggleStarSession={projectListProps.onToggleStarSession}
                onLoadMoreSessions={projectListProps.onLoadMoreSessions}
                onNewSession={projectListProps.onNewSession}
                newSessionMode={projectListProps.newSessionMode}
                touchHandlerFactory={projectListProps.touchHandlerFactory}
                t={t}
              />
          ))}
        </section>
      </div>
    );
  };

  const projectPane = (
    <div className="medical-project-pane flex h-full min-w-0 flex-1 flex-col">
      <div className="medical-project-pane-header hidden h-[45px] flex-shrink-0 items-center justify-between px-2 md:flex">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 rounded-lg bg-primary/10 px-2.5 font-medium text-primary hover:bg-primary/15 hover:text-primary"
          onClick={onCreateConversation}
          title={t('tooltips.newConversation')}
          aria-label={t('tooltips.newConversation')}
        >
          <MessageSquarePlus className="h-4 w-4" />
          <span className="text-xs">{t('projects.newConversation')}</span>
        </Button>
        <div className="flex flex-shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
            onClick={onOpenSearch}
            title={`${t('searchPalette.open')} (${searchShortcut})`}
            aria-label={`${t('searchPalette.open')} (${searchShortcut})`}
          >
            <Search className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
            onClick={onRefresh}
            disabled={isRefreshing}
            title={t('tooltips.refresh')}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 rounded-lg p-0 text-muted-foreground hover:bg-accent/80 hover:text-foreground"
            onClick={onCollapseSidebar}
            title={t('tooltips.hideSidebar')}
          >
            <PanelLeftClose className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="hidden nav-divider md:block" />

      <ScrollArea
        className="sidebar-scroll-area min-h-0 flex-1 md:px-2 md:py-2"
        viewportClassName="panel-scroll-area overflow-y-auto overscroll-contain"
      >
        <div className="space-y-2">
          {renderProjectSections()}
        </div>
      </ScrollArea>
    </div>
  );

  return (
    <div
      className="medical-workbench-sidebar h-full flex flex-col bg-background/80 backdrop-blur-sm md:select-none w-full"
      style={{}}
    >
      <div className="hidden h-full min-h-0 md:flex">
        {primaryNavCollapsed ? collapsedPrimaryNav : <div
          className="medical-primary-nav flex h-full flex-shrink-0 flex-col"
          style={{ width: primaryNavWidth }}
        >
          <SidebarHeader
            isPWA={isPWA}
            isMobile={isMobile}
            onOpenSearch={onOpenSearch}
            searchShortcut={searchShortcut}
            onRefresh={onRefresh}
            isRefreshing={isRefreshing}
            onCollapseSidebar={onCollapseSidebar}
            showDesktopActions={false}
            onCollapsePrimaryNav={onCollapsePrimaryNav}
            onExpandProjectPane={onExpandProjectPane}
            projectPaneVisible={projectPaneVisible}
            t={t}
          />
          <ScrollArea
            className="sidebar-scroll-area min-h-0 flex-1 px-2 py-2"
            viewportClassName="panel-scroll-area overflow-y-auto overscroll-contain"
          >
            {!isLoading && (
              <SidebarScrollableNav
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
                onOpenNews={onOpenNews}
                onOpenCompanions={onOpenCompanions}
                onOpenMiniApps={onOpenMiniApps}
                t={t}
              />
            )}
          </ScrollArea>
          <SidebarFooter
            updateAvailable={updateAvailable}
            onShowVersionModal={onShowVersionModal}
            updateLabel={updateLabel}
            updateBusy={updateBusy}
            onShowSettings={onShowSettings}
            settingsActive={activeTab === 'settings'}
            t={t}
          />
        </div>}
        {projectPaneVisible && projectPane}
      </div>

      <div className="flex h-full min-h-0 flex-col md:hidden">
        <SidebarHeader
          isPWA={isPWA}
          isMobile={isMobile}
          onOpenSearch={onOpenSearch}
          searchShortcut={searchShortcut}
          onRefresh={onRefresh}
          isRefreshing={isRefreshing}
          onCollapseSidebar={onCollapseSidebar}
          t={t}
        />
        <ScrollArea
          className="sidebar-scroll-area min-h-0 flex-1 py-2"
          viewportClassName="panel-scroll-area overflow-y-auto overscroll-contain"
        >
          <div className="space-y-2">
            {!isLoading && (
              <SidebarProjectControls
                onCreateConversation={onCreateConversation}
                t={t}
              />
            )}
            {!isLoading && (
              <SidebarScrollableNav
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
                onOpenNews={onOpenNews}
                onOpenCompanions={onOpenCompanions}
                onOpenMiniApps={onOpenMiniApps}
                t={t}
              />
            )}
            {renderProjectSections()}
          </div>
        </ScrollArea>
        <SidebarFooter
          updateAvailable={updateAvailable}
          onShowVersionModal={onShowVersionModal}
          updateLabel={updateLabel}
          updateBusy={updateBusy}
          onShowSettings={onShowSettings}
          settingsActive={activeTab === 'settings'}
          t={t}
        />
      </div>
    </div>
  );
}
