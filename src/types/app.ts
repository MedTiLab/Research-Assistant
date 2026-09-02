import type {
  AgentSessionIdentity as SharedAgentSessionIdentity,
  AgentSessionKey as SharedAgentSessionKey,
  RuntimeId as SharedRuntimeId,
} from '../../shared/agentSessionIdentity';

export type RuntimeId = SharedRuntimeId;
export type AgentSessionIdentity = SharedAgentSessionIdentity;
export type AgentSessionKey = SharedAgentSessionKey;
export type AgentSessionScope = Partial<Pick<AgentSessionIdentity, 'ownerKey' | 'projectKey' | 'runtimeId'>>;

export type ModelProviderId =
  | 'anthropic'
  | 'openai'
  | 'managed-free'
  | 'byok-openai-compatible'
  | 'byok-anthropic-compatible'
  | 'local-openai-compatible';

export interface ModelSelection {
  runtimeId: RuntimeId;
  modelProviderId: ModelProviderId;
  modelId: string;
  catalogRevision: number | null;
}

export type SessionProvider = 'claude' | 'codex' | 'pi' | 'openrouter' | 'local';

export type SessionMode = 'research' | 'workspace_qa' | 'consultation';

export interface SessionTag {
  id: number;
  projectName?: string;
  tagKey: string;
  tagType: 'stage' | string;
  label: string;
  color?: string | null;
  sortOrder?: number;
  metadata?: Record<string, unknown> | null;
  source?: string | null;
  linkedBy?: string | null;
  linkedAt?: string | null;
  linkMetadata?: Record<string, unknown> | null;
  createdAt?: string;
}

export interface PendingAutoIntake {
  prompt?: string | null;
  triggerId?: string | null;
}

export interface ImportedProjectAnalysisPrompt {
  project: Project;
  prompt: string;
}

export interface ProjectCreationOptions {
  autoIntake?: PendingAutoIntake | null;
  importedProjectAnalysisPrompt?: ImportedProjectAnalysisPrompt | null;
}

export type AppTab =
  | 'dashboard'
  | 'projectProgress'
  | 'today'
  | 'submissions'
  | 'thesis'
  | 'dailyReview'
  | 'meetings'
  | 'advisor'
  | 'automation'
  | 'companions'
  | 'miniApps'
  | 'settings'
  | 'trash'
  | 'conversationHistory'
  | 'chat'
  | 'context'
  | 'survey'
  | 'files'
  | 'git'
  | 'skills'
  | 'preview'
  | 'news'
  | 'medlibrary'
  | 'variableOverview'
  | 'variableKnowledgePubmedDiscovery'
  | 'memorySummary';

export interface AccountConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface AccountConversation {
  id: string;
  sessionId: string;
  provider: SessionProvider;
  title: string;
  projectLabel?: string | null;
  messageCount: number;
  messages?: AccountConversationMessage[];
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ProjectSession {
  id: string;
  title?: string;
  summary?: string;
  name?: string;
  mode?: SessionMode;
  tags?: SessionTag[];
  createdAt?: string;
  created_at?: string;
  updated_at?: string;
  lastActivity?: string;
  messageCount?: number;
  sessionKey?: AgentSessionKey | string;
  sessionId?: string;
  runtimeId?: RuntimeId;
  projectKey?: string;
  modelProviderId?: ModelProviderId | string;
  modelId?: string;
  modelApi?: string;
  catalogRevision?: number | null;
  __provider?: SessionProvider;
  __projectName?: string;
  [key: string]: unknown;
}

export interface ProjectSessionV2 extends ProjectSession {
  sessionKey: AgentSessionKey | string;
  sessionId: string;
  runtimeId: RuntimeId;
  projectKey: string;
}

export interface ProjectSessionMeta {
  total?: number;
  hasMore?: boolean;
  [key: string]: unknown;
}

export interface ProjectTaskmasterInfo {
  hasTaskmaster?: boolean;
  status?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Project {
  name: string;
  displayName: string;
  fullPath: string;
  path?: string;
  isDefaultWorkspace?: boolean;
  isConversationWorkspace?: boolean;
  createdAt?: string;
  sessions?: ProjectSession[];
  codexSessions?: ProjectSession[];
  piSessions?: ProjectSession[];
  openrouterSessions?: ProjectSession[];
  localSessions?: ProjectSession[];
  runtimeSessions?: ProjectSessionV2[];
  sessionMeta?: ProjectSessionMeta;
  taskmaster?: ProjectTaskmasterInfo;
  [key: string]: unknown;
}

export interface TrashProject {
  name: string;
  displayName: string;
  fullPath: string;
  path?: string;
  originalPath?: string;
  trashPath?: string;
  claudeTrashPath?: string;
  trashedAt: string;
  sessionCount?: number;
  canRestore?: boolean;
  filesExist?: boolean;
  [key: string]: unknown;
}

export interface TrashSession {
  id: string;
  projectName: string;
  projectDisplayName?: string;
  provider: SessionProvider;
  displayName: string;
  trashedAt: string;
  lastActivity?: string | null;
  messageCount?: number;
  [key: string]: unknown;
}

export interface LoadingProgress {
  type?: 'loading_progress';
  phase?: string;
  current: number;
  total: number;
  currentProject?: string;
  [key: string]: unknown;
}

export interface ProjectsUpdatedMessage {
  type: 'projects_updated';
  projects: Project[];
  changedFile?: string;
  [key: string]: unknown;
}

export interface ActiveSessionsMessage {
  type: 'active-sessions';
  sessions?: Partial<Record<SessionProvider | RuntimeId, Array<string | {
    id?: string;
    sessionId?: string;
    sessionKey?: string;
    runtimeId?: RuntimeId;
    provider?: SessionProvider | RuntimeId;
    projectKey?: string | null;
    startTime?: number;
  }>>> & {
    claude?: Array<string | { id?: string; sessionId?: string; projectKey?: string | null; startTime?: number }>;
    codex?: Array<string | { id?: string; sessionId?: string; projectKey?: string | null; startTime?: number }>;
    openrouter?: Array<string | { id?: string; sessionId?: string; projectKey?: string | null; startTime?: number }>;
    local?: Array<string | { id?: string; sessionId?: string; projectKey?: string | null; startTime?: number }>;
  };
  [key: string]: unknown;
}

export interface LoadingProgressMessage extends LoadingProgress {
  type: 'loading_progress';
}

export type AppSocketMessage =
  | LoadingProgressMessage
  | ProjectsUpdatedMessage
  | ActiveSessionsMessage
  | { type?: string; [key: string]: unknown };
