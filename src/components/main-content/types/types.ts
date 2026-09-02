import type { Dispatch, MouseEvent, RefObject, SetStateAction } from 'react';
import type {
  AppTab,
  AgentSessionKey,
  AgentSessionScope,
  ImportedProjectAnalysisPrompt,
  PendingAutoIntake,
  Project,
  ProjectSession,
  SessionMode,
  SessionProvider,
  TrashProject,
  TrashSession,
} from '../../../types/app';
import type { Reference } from '../../references/types';
import type { ChatPromptDraft } from '../../../utils/chatPromptDraft';
import type {
  ChatDraftOpenRequest,
  ProjectFileChatContextItem,
} from '../../../utils/projectFileChatContext';
import type { WorkbenchCommand } from '../../../features/research-secretary/domain/workbenchCommand';

export type SessionLifecycleHandler = (
  sessionId?: string | null,
  scope?: AgentSessionScope,
  previousSessionId?: string | null,
) => void;

export interface DiffInfo {
  old_string?: string;
  new_string?: string;
  [key: string]: unknown;
}

export type EditorSidebarMode = 'preview' | 'edit';

export type EditorAnalysisStage =
  | 'literature'
  | 'survey'
  | 'ideation'
  | 'experiment'
  | 'publication'
  | 'promotion'
  | 'reports'
  | 'drafts'
  | 'workspace'
  | 'unknown';

export type EditorEvidenceKind =
  | 'chat-diff'
  | 'chat-session'
  | 'workspace-file'
  | 'git-change'
  | 'survey-artifact'
  | 'project-material';

export interface EditorResearchContext {
  originTab: AppTab;
  originDetail?: string;
  analysisStage: EditorAnalysisStage;
  evidenceKind: EditorEvidenceKind;
}

export interface EditingFile {
  name: string;
  path: string;
  projectName?: string;
  diffInfo?: DiffInfo | null;
  researchContext?: EditorResearchContext;
  [key: string]: unknown;
}

export interface MainContentProps {
  projects: Project[];
  trashProjects: TrashProject[];
  trashSessions: TrashSession[];
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  draftOpenRequest: ChatDraftOpenRequest;
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  latestMessage: unknown;
  isMobile: boolean;
  onMenuClick: () => void;
  isLoading: boolean;
  isTrashLoading?: boolean;
  onInputFocusChange: (focused: boolean) => void;
  onSessionActive: SessionLifecycleHandler;
  onSessionInactive: SessionLifecycleHandler;
  onSessionProcessing: SessionLifecycleHandler;
  onSessionNotProcessing: SessionLifecycleHandler;
  processingSessions: Set<AgentSessionKey>;
  onReplaceTemporarySession: SessionLifecycleHandler;
  onNavigateToSession: (
    targetSessionId: string,
    targetProvider?: SessionProvider,
    targetProjectName?: string,
  ) => void;
  onShowSettings: () => void;
  settingsInitialTab?: string;
  onCloseSettings?: () => void;
  externalMessageUpdate: number;
  newSessionResetKey: number;
  pendingAutoIntake?: PendingAutoIntake | null;
  clearPendingAutoIntake?: () => void;
  importedProjectAnalysisPrompt?: ImportedProjectAnalysisPrompt | null;
  clearImportedProjectAnalysisPrompt?: () => void;
  onProjectSelect: (project: Project) => void;
  onNewSession?: (project: Project, mode?: SessionMode) => void;
  onClearConversationFolder?: (defaultConversationProject: Project) => void;
  onStartWorkspaceQa?: (project: Project, prompt: string, options?: { projectFiles?: ProjectFileChatContextItem[]; workbenchCommand?: WorkbenchCommand }) => void;
  onChatFromReference?: (project: Project, ref: Reference) => void;
  onStartResearchFromNews?: (project: Project, prompt: string | ChatPromptDraft, source?: string) => void;
  onCreateProjectFromPrompt?: (prompt: string) => Promise<Project>;
  newSessionMode?: SessionMode;
  onNewSessionModeChange?: (mode: SessionMode) => void;
}

export interface MainContentHeaderProps {
  activeTab: AppTab;
  setActiveTab?: Dispatch<SetStateAction<AppTab>>;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isMobile: boolean;
  onMenuClick: () => void;
  onNavigateBack?: () => void;
  contentInsetRight?: number;
  showExpandContextSidebar?: boolean;
  onExpandContextSidebar?: () => void;
}

export interface MainContentTitleProps {
  activeTab: AppTab;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  isMobile: boolean;
  compact?: boolean;
}

export interface MainContentStateViewProps {
  mode: 'loading' | 'empty';
  isMobile: boolean;
  onMenuClick: () => void;
}

export interface MobileMenuButtonProps {
  onMenuClick: () => void;
  compact?: boolean;
}

export interface EditorSidebarProps {
  editingFile: EditingFile | null;
  editorMode: EditorSidebarMode;
  isMobile: boolean;
  editorExpanded: boolean;
  editorWidth: number;
  resizeHandleRef: RefObject<HTMLDivElement>;
  onResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onCloseEditor: () => void;
  onStartEditing: () => void;
  onToggleEditorExpand: () => void;
  onReturnToOrigin: () => void;
  projectPath?: string;
  selectedProject?: Project | null;
  onStartWorkspaceQa?: (project: Project, prompt: string, options?: { projectFiles?: ProjectFileChatContextItem[]; workbenchCommand?: WorkbenchCommand }) => void;
  onAddProjectFileToCurrentChat?: (file: ProjectFileChatContextItem) => void;
  fillSpace?: boolean;
}
