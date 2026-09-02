import { useEffect, useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '../../../ui/button';
import type { Project, ProjectSession, SessionMode, SessionProvider } from '../../../../types/app';
import type { SessionWithProvider, TouchHandlerFactory } from '../../types/types';
import {
  getSidebarVisibleSessionCount,
  SIDEBAR_SESSION_PAGE_SIZE,
} from '../../utils/utils';
import SidebarSessionItem from './SidebarSessionItem';

type SidebarProjectSessionsProps = {
  project: Project;
  isExpanded: boolean;
  flat?: boolean;
  showNewSessionAction?: boolean;
  sessions: SessionWithProvider[];
  selectedSession: ProjectSession | null;
  initialSessionsLoaded: boolean;
  isLoadingSessions: boolean;
  editingSession: string | null;
  editingSessionName: string;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: SessionProvider) => void;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: SessionProvider,
  ) => void;
  isSessionStarred: (projectName: string, sessionId: string, provider: SessionProvider) => boolean;
  onToggleStarSession: (projectName: string, sessionId: string, provider: SessionProvider) => void;
  onLoadMoreSessions: (project: Project) => void;
  onNewSession: (project: Project, mode?: SessionMode) => void;
  newSessionMode?: SessionMode;
  touchHandlerFactory: TouchHandlerFactory;
  t: TFunction;
};

function SessionListSkeleton() {
  return (
    <>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="p-2 rounded-md">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-muted rounded-full animate-pulse" />
            <div className="h-3 flex-1 bg-muted rounded animate-pulse" style={{ width: `${60 + index * 15}%` }} />
          </div>
        </div>
      ))}
    </>
  );
}

export default function SidebarProjectSessions({
  project,
  isExpanded,
  flat = false,
  showNewSessionAction = true,
  sessions,
  selectedSession,
  initialSessionsLoaded,
  isLoadingSessions,
  editingSession,
  editingSessionName,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  onProjectSelect,
  onSessionSelect,
  onDeleteSession,
  isSessionStarred,
  onToggleStarSession,
  onLoadMoreSessions,
  onNewSession,
  newSessionMode = 'research',
  touchHandlerFactory,
  t,
}: SidebarProjectSessionsProps) {
  const [revealedCount, setRevealedCount] = useState(SIDEBAR_SESSION_PAGE_SIZE);

  useEffect(() => {
    if (!isExpanded) {
      setRevealedCount(SIDEBAR_SESSION_PAGE_SIZE);
    }
  }, [isExpanded, project.name]);

  if (!isExpanded) {
    return null;
  }

  const hasSessions = sessions.length > 0;
  const selectedIndex = selectedSession
    ? sessions.findIndex((session) => session.id === selectedSession.id)
    : -1;
  const visibleCount = getSidebarVisibleSessionCount({
    sessionCount: sessions.length,
    revealedCount,
    selectedIndex,
  });
  const visibleSessions = sessions.slice(0, visibleCount);
  const hasHiddenLoadedSessions = sessions.length > visibleCount;
  const hasMoreSessions = hasHiddenLoadedSessions || project.sessionMeta?.hasMore === true;

  const handleShowMore = () => {
    setRevealedCount((currentCount) => currentCount + SIDEBAR_SESSION_PAGE_SIZE);
    if (!hasHiddenLoadedSessions) {
      onLoadMoreSessions(project);
    }
  };

  return (
    <div className={flat ? 'space-y-1' : 'ml-3 space-y-1 border-l border-border pl-3'}>
      {!initialSessionsLoaded ? (
        <SessionListSkeleton />
      ) : !hasSessions && !isLoadingSessions ? (
        <div className="py-2 px-3 text-left">
          <p className="text-xs text-muted-foreground">{t('sessions.noSessions')}</p>
        </div>
      ) : (
        visibleSessions.map((session) => (
          <SidebarSessionItem
            key={session.id}
            project={project}
            session={session}
            selectedSession={selectedSession}
            editingSession={editingSession}
            editingSessionName={editingSessionName}
            onEditingSessionNameChange={onEditingSessionNameChange}
            onStartEditingSession={onStartEditingSession}
            onCancelEditingSession={onCancelEditingSession}
            onSaveEditingSession={onSaveEditingSession}
            onSessionSelect={onSessionSelect}
            onDeleteSession={onDeleteSession}
            isStarred={isSessionStarred(project.name, session.id, session.__provider)}
            onToggleStar={() => onToggleStarSession(project.name, session.id, session.__provider)}
            touchHandlerFactory={touchHandlerFactory}
            t={t}
          />
        ))
      )}

      {hasSessions && hasMoreSessions && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-center gap-2 mt-2 text-muted-foreground"
          onClick={handleShowMore}
          disabled={isLoadingSessions}
        >
          {isLoadingSessions ? (
            <>
              <div className="w-3 h-3 animate-spin rounded-full border border-muted-foreground border-t-transparent" />
              {t('sessions.loading')}
            </>
          ) : (
            <>
              <ChevronDown className="w-3 h-3" />
              {t('sessions.showMore')}
            </>
          )}
        </Button>
      )}

      {showNewSessionAction && !project.isDefaultWorkspace && (
        <>
          <div className="md:hidden px-3 pb-2">
            <button
              className="w-full h-8 bg-primary hover:bg-primary/90 text-primary-foreground rounded-md flex items-center justify-center gap-2 font-medium text-xs active:scale-[0.98] transition-all duration-150 overflow-hidden"
              onClick={() => {
                onProjectSelect(project);
                onNewSession(project, newSessionMode);
              }}
            >
              <Plus className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">{t('sessions.newSession')}</span>
            </button>
          </div>

          <Button
            variant="default"
            size="sm"
            className="hidden md:flex w-full justify-start gap-2 mt-1 h-8 min-w-0 overflow-hidden text-xs font-medium bg-primary hover:bg-primary/90 text-primary-foreground transition-colors"
            onClick={() => onNewSession(project, newSessionMode)}
          >
            <Plus className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{t('sessions.newSession')}</span>
          </Button>
        </>
      )}
    </div>
  );
}
