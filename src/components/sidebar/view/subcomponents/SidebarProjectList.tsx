import { useState } from 'react';
import type React from 'react';
import type { TFunction } from 'i18next';
import type { LoadingProgress, Project, ProjectSession, SessionMode, SessionProvider } from '../../../../types/app';
import type {
  LoadingSessionsByProject,
  SessionWithProvider,
  TouchHandlerFactory,
} from '../../types/types';
import SidebarProjectItem from './SidebarProjectItem';
import SidebarProjectsState from './SidebarProjectsState';

export type ProjectDropPosition = 'before' | 'after';

export type SidebarProjectListProps = {
  projects: Project[];
  filteredProjects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  expandedProjects: Set<string>;
  editingProject: string | null;
  editingName: string;
  loadingSessions: LoadingSessionsByProject;
  initialSessionsLoaded: Set<string>;
  editingSession: string | null;
  editingSessionName: string;
  deletingProjects: Set<string>;
  getProjectSessions: (project: Project) => SessionWithProvider[];
  isProjectStarred: (projectName: string) => boolean;
  isSessionStarred: (projectName: string, sessionId: string, provider: SessionProvider) => boolean;
  onEditingNameChange: (value: string) => void;
  onToggleProject: (projectName: string) => void;
  onProjectSelect: (project: Project) => void;
  onToggleStarProject: (projectName: string) => void;
  onToggleStarSession: (projectName: string, sessionId: string, provider: SessionProvider) => void;
  onStartEditingProject: (project: Project) => void;
  onCancelEditingProject: () => void;
  onSaveProjectName: (projectName: string) => void;
  onDeleteProject: (project: Project) => void;
  onProjectReorder: (
    draggedProjectName: string,
    targetProjectName: string,
    position: ProjectDropPosition,
  ) => void;
  onSessionSelect: (session: SessionWithProvider, projectName: string) => void;
  onDeleteSession: (
    projectName: string,
    sessionId: string,
    sessionTitle: string,
    provider: SessionProvider,
  ) => void;
  onLoadMoreSessions: (project: Project) => void;
  onNewSession: (project: Project, mode?: SessionMode) => void;
  newSessionMode?: SessionMode;
  onEditingSessionNameChange: (value: string) => void;
  onStartEditingSession: (sessionId: string, initialName: string) => void;
  onCancelEditingSession: () => void;
  onSaveEditingSession: (projectName: string, sessionId: string, summary: string, provider: SessionProvider) => void;
  touchHandlerFactory: TouchHandlerFactory;
  t: TFunction;
};

export default function SidebarProjectList({
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
  onEditingNameChange,
  onToggleProject,
  onProjectSelect,
  onToggleStarProject,
  onToggleStarSession,
  onStartEditingProject,
  onCancelEditingProject,
  onSaveProjectName,
  onDeleteProject,
  onProjectReorder,
  onSessionSelect,
  onDeleteSession,
  onLoadMoreSessions,
  onNewSession,
  newSessionMode,
  onEditingSessionNameChange,
  onStartEditingSession,
  onCancelEditingSession,
  onSaveEditingSession,
  touchHandlerFactory,
  t,
}: SidebarProjectListProps) {
  const state = (
    <SidebarProjectsState
      isLoading={isLoading}
      loadingProgress={loadingProgress}
      projectsCount={projects.length}
      filteredProjectsCount={filteredProjects.length}
      t={t}
    />
  );

  const showProjects = !isLoading && projects.length > 0 && filteredProjects.length > 0;
  const canReorderProjects = showProjects && filteredProjects.length > 1;
  const [draggingProjectName, setDraggingProjectName] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    projectName: string;
    position: ProjectDropPosition;
  } | null>(null);

  const resetDragState = () => {
    setDraggingProjectName(null);
    setDropTarget(null);
  };

  const handleProjectDragStart = (event: React.DragEvent<HTMLDivElement>, projectName: string) => {
    if (!canReorderProjects) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', projectName);
    setDraggingProjectName(projectName);
  };

  const handleProjectDragOver = (event: React.DragEvent<HTMLDivElement>, projectName: string) => {
    if (!draggingProjectName || draggingProjectName === projectName) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const position: ProjectDropPosition = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';

    setDropTarget((previous) => {
      if (previous?.projectName === projectName && previous.position === position) {
        return previous;
      }

      return { projectName, position };
    });
  };

  const handleProjectDragLeave = (event: React.DragEvent<HTMLDivElement>, projectName: string) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }

    setDropTarget((previous) => (previous?.projectName === projectName ? null : previous));
  };

  const handleProjectDrop = (event: React.DragEvent<HTMLDivElement>, projectName: string) => {
    event.preventDefault();
    const draggedProjectName = draggingProjectName || event.dataTransfer.getData('text/plain');
    const position = dropTarget?.projectName === projectName ? dropTarget.position : 'before';

    if (draggedProjectName && draggedProjectName !== projectName) {
      onProjectReorder(draggedProjectName, projectName, position);
    }

    resetDragState();
  };

  return (
    <div className="md:space-y-1 pb-safe-area-inset-bottom">
      {!showProjects
        ? state
        : filteredProjects.map((project) => (
            <SidebarProjectItem
              key={project.name}
              project={project}
              selectedProject={selectedProject}
              selectedSession={selectedSession}
              isExpanded={expandedProjects.has(project.name)}
              isDeleting={deletingProjects.has(project.name)}
              isStarred={isProjectStarred(project.name)}
              editingProject={editingProject}
              editingName={editingName}
              sessions={getProjectSessions(project)}
              initialSessionsLoaded={initialSessionsLoaded.has(project.name)}
              isLoadingSessions={Boolean(loadingSessions[project.name])}
              editingSession={editingSession}
              editingSessionName={editingSessionName}
              onEditingNameChange={onEditingNameChange}
              onToggleProject={onToggleProject}
              onProjectSelect={onProjectSelect}
              onToggleStarProject={onToggleStarProject}
              isSessionStarred={isSessionStarred}
              onToggleStarSession={onToggleStarSession}
              onStartEditingProject={onStartEditingProject}
              onCancelEditingProject={onCancelEditingProject}
              onSaveProjectName={onSaveProjectName}
              onDeleteProject={onDeleteProject}
              isProjectDragEnabled={canReorderProjects}
              isDragging={draggingProjectName === project.name}
              dropPosition={dropTarget?.projectName === project.name ? dropTarget.position : null}
              onProjectDragStart={handleProjectDragStart}
              onProjectDragOver={handleProjectDragOver}
              onProjectDragLeave={handleProjectDragLeave}
              onProjectDrop={handleProjectDrop}
              onProjectDragEnd={resetDragState}
              onSessionSelect={onSessionSelect}
              onDeleteSession={onDeleteSession}
              onLoadMoreSessions={onLoadMoreSessions}
              onNewSession={onNewSession}
              newSessionMode={newSessionMode}
              onEditingSessionNameChange={onEditingSessionNameChange}
              onStartEditingSession={onStartEditingSession}
              onCancelEditingSession={onCancelEditingSession}
              onSaveEditingSession={onSaveEditingSession}
              touchHandlerFactory={touchHandlerFactory}
              t={t}
            />
          ))}
    </div>
  );
}
