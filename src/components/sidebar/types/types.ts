import type React from 'react';
import type { AgentSessionKey, AppTab, LoadingProgress, Project, ProjectCreationOptions, ProjectSession, SessionMode, SessionProvider, TrashProject } from '../../../types/app';

export type ProjectSortOrder = 'name' | 'date' | 'manual';

export type SessionWithProvider = ProjectSession & {
  __provider: SessionProvider;
  __isProcessing?: boolean;
};

export type AdditionalSessionsByProject = Record<string, ProjectSession[]>;
export type LoadingSessionsByProject = Record<string, boolean>;

export type DeleteProjectConfirmation = {
  project: Project;
  sessionCount: number;
};

export type DeleteTrashProjectConfirmation = {
  project: TrashProject;
};

export type SessionDeleteConfirmation = {
  projectName: string;
  sessionId: string;
  sessionTitle: string;
  provider: SessionProvider;
};

export type SidebarProps = {
  projects: Project[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  onProjectSelect: (project: Project) => void;
  onSessionSelect: (session: ProjectSession) => void;
  onNewSession: (project: Project, mode?: SessionMode) => void;
  onSessionDelete?: (projectName: string, sessionId: string, provider: SessionProvider) => void;
  onProjectDelete?: (projectName: string) => void;
  isLoading: boolean;
  loadingProgress: LoadingProgress | null;
  onRefresh: () => Promise<void> | void;
  onShowSettings: () => void;
  isMobile: boolean;
  activeTab: AppTab;
  processingSessions?: Set<AgentSessionKey>;
  onOpenDashboard: () => void;
  onOpenTrash: () => void;
  onOpenNews: () => void;
  onOpenMedLibrary: () => void;
  onOpenSkills: () => void;
  onOpenVariableOverview: () => void;
  onOpenVariableDiscovery: () => void;
  onOpenMemorySummary: () => void;
  onOpenConversationHistory: () => void;
  onOpenSubmissions: () => void;
  onOpenThesis: () => void;
  onOpenDailyReview: () => void;
  onOpenMeetings: () => void;
  onOpenAdvisor: () => void;
  onOpenAutomation: () => void;
  onOpenCompanions: () => void;
  onOpenMiniApps: () => void;
  onImportedProjectCreated?: (project: Project, options?: ProjectCreationOptions) => void;
  newSessionMode?: SessionMode;
  primaryNavCollapsed?: boolean;
  primaryNavWidth?: number;
  projectPaneVisible?: boolean;
  onCollapsePrimaryNav?: () => void;
  onExpandPrimaryNav?: () => void;
  onCollapseProjectPane?: () => void;
  onExpandProjectPane?: () => void;
};

export type SessionViewModel = {
  isCodexSession: boolean;
  isActive: boolean;
  sessionName: string;
  messageCount: number;
  mode: SessionMode;
};

export type TouchHandlerFactory = (
  callback: () => void,
) => (event: React.TouchEvent<HTMLElement>) => void;

export type SettingsProject = Pick<Project, 'name' | 'displayName' | 'fullPath' | 'path'>;
