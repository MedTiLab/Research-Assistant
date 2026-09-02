import type {
  AgentSessionKey,
  AgentSessionScope,
  AppTab,
  ImportedProjectAnalysisPrompt,
  PendingAutoIntake,
  Project,
  ProjectSession,
  SessionMode,
  SessionProvider,
} from '../../../types/app';
import type { ProjectFileChatContextItem } from '../../../utils/projectFileChatContext';

export type Provider = SessionProvider;
export type SessionLifecycleHandler = (
  sessionId?: string | null,
  scope?: AgentSessionScope,
  previousSessionId?: string | null,
) => void;

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'readOnly' | 'ask' | 'auto';
export type ChatSidebarTab = 'context' | 'consultation' | 'files' | 'browser' | 'survey' | 'git';

export const VISIBLE_CHAT_SIDEBAR_TABS = ['browser', 'files', 'git'] as const satisfies readonly ChatSidebarTab[];

export function normalizeChatSidebarTab(value: unknown): ChatSidebarTab {
  return value === 'browser' || value === 'git' ? value : 'files';
}

export const RESUMING_STATUS_TEXT = 'Resuming...';

export interface ChatImage {
  data: string;
  name: string;
  mimeType?: string;
}

export interface ChatAttachment {
  name: string;
  kind: 'image' | 'pdf' | 'file';
  mimeType?: string;
  path?: string;
  extractedTextPreview?: string;
}

export interface QueuedChatTurn {
  id: string;
  content: string;
  attachments?: ChatAttachment[];
  createdAt: number;
}

export interface TaskContext {
  id?: string | number | null;
  title?: string | null;
  objective?: string | null;
  stage?: string | null;
  status?: string | null;
  priority?: string | null;
  description?: string | null;
  details?: string | null;
  testStrategy?: string | null;
  taskType?: string | null;
  nextActionPrompt?: string | null;
  whyNext?: string | null;
  requiredInputs?: string[] | null;
  suggestedSkills?: string[] | null;
  dependencies?: Array<string | number> | null;
  acceptanceCriteria?: unknown[] | null;
  expectedArtifacts?: string[] | null;
  allowedOutputRoots?: string[] | null;
  forbiddenChanges?: unknown[] | null;
  acceptedEvidence?: unknown[] | null;
  verificationMode?: string | null;
  acceptedInputFiles?: string[] | null;
  noArtifactExpected?: boolean | null;
  maxAttempts?: number | null;
  maxVerificationAttempts?: number | null;
}

export interface ToolResult {
  content?: unknown;
  isError?: boolean;
  timestamp?: string | number | Date;
  toolUseResult?: unknown;
  [key: string]: unknown;
}

export interface SubagentChildTool {
  toolId: string;
  toolName: string;
  toolInput: unknown;
  toolResult?: ToolResult | null;
  timestamp: Date;
}

export interface AttachedPrompt {
  scenarioId: string;
  scenarioIcon: string;
  scenarioTitle: string;
  promptText: string;
  localization?: {
    promptKey: string;
    titleKey?: string;
    skills?: string[];
    skill?: string;
  };
}

export interface SubagentState {
  childTools: SubagentChildTool[];
  currentToolIndex: number;
  isComplete: boolean;
  status?: string;
  updatedAt?: string;
}

export interface ChatMessage {
  type: string;
  content?: string;
  timestamp: string | number | Date;
  isOptimistic?: boolean;
  images?: ChatImage[];
  attachments?: ChatAttachment[];
  attachmentDelivery?: import('../utils/piAttachmentDelivery').PiAttachmentDelivery[];
  reasoning?: string;
  isThinking?: boolean;
  isStreaming?: boolean;
  isInteractivePrompt?: boolean;
  isSkillContent?: boolean;
  isToolUse?: boolean;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: ToolResult | null;
  toolId?: string;
  toolCallId?: string;
  isSubagentContainer?: boolean;
  subagentState?: SubagentState;
  attachedPrompt?: AttachedPrompt;
  errorType?: 'usage_limit' | 'overloaded' | 'network' | 'auth' | 'unknown';
  isRetryable?: boolean;
  [key: string]: unknown;
}

export interface ChatStatus {
  text: string;
  tokens: number;
  can_interrupt: boolean;
  startTime?: number;
}

export interface ProviderSettings {
  allowedTools: string[];
  disallowedTools: string[];
  skipPermissions: boolean;
  projectSortOrder: string;
  lastUpdated?: string;
  [key: string]: unknown;
}

export interface PermissionSuggestion {
  toolName: string;
  entry: string;
  isAllowed: boolean;
}

export interface PermissionGrantResult {
  success: boolean;
  alreadyAllowed?: boolean;
  updatedSettings?: ProviderSettings;
}

export interface PendingPermissionRequest {
  requestId: string;
  toolName: string;
  input?: unknown;
  context?: unknown;
  sessionId?: string | null;
  provider?: SessionProvider;
  runtimeId?: SessionProvider;
  projectKey?: string | null;
  receivedAt?: Date;
}

export interface TokenBudget {
  used?: number | null;
  total?: number | null;
  estimated?: boolean;
  unsupportedContext?: boolean;
  message?: string;
  lifetimeTokens?: number;
  model?: string | null;
  breakdown?: {
    input?: number;
    cacheRead?: number;
    cacheCreation?: number;
    output?: number;
    reasoning?: number;
  };
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface Question {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface ChatInterfaceProps {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  initialProjectFiles?: ProjectFileChatContextItem[];
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  latestMessage: any;
  onFileOpen?: (filePath: string, diffInfo?: any) => void;
  onInputFocusChange?: (focused: boolean) => void;
  onSessionActive?: SessionLifecycleHandler;
  onSessionInactive?: SessionLifecycleHandler;
  onSessionProcessing?: SessionLifecycleHandler;
  onSessionNotProcessing?: SessionLifecycleHandler;
  processingSessions?: Set<AgentSessionKey>;
  onReplaceTemporarySession?: SessionLifecycleHandler;
  onNavigateToSession?: (
    targetSessionId: string,
    targetProvider?: SessionProvider,
    targetProjectName?: string,
  ) => void;
  onShowSettings?: () => void;
  autoExpandTools?: boolean;
  showRawParameters?: boolean;
  showThinking?: boolean;
  autoScrollToBottom?: boolean;
  sendByCtrlEnter?: boolean;
  externalMessageUpdate?: number;
  /** Changes whenever the user explicitly requests a blank conversation. */
  newSessionResetKey?: number;
  /** Keeps the first optimistic message mounted while a blank draft receives its own project. */
  preserveDraftProjectRebind?: boolean;
  onTaskClick?: (...args: unknown[]) => void;
  pendingAutoIntake?: PendingAutoIntake | null;
  clearPendingAutoIntake?: () => void;
  importedProjectAnalysisPrompt?: ImportedProjectAnalysisPrompt | null;
  clearImportedProjectAnalysisPrompt?: () => void;
  onStartWorkspaceQa?: (project: Project, prompt: string, options?: { projectFiles?: ProjectFileChatContextItem[] }) => void;
  onCreateProjectFromPrompt?: (prompt: string) => Promise<Project>;
  onProjectSelect?: (project: Project) => void;
  onStartConversationWithProject?: (project: Project) => void;
  onClearConversationFolder?: () => void;
  onSelectionConsultationChange?: (seed: import('../view/subcomponents/SelectionConsultationPanel').SelectionConsultationSeed | null) => void;
  initialInputDraft?: string | null;
  newSessionMode?: SessionMode;
  onNewSessionModeChange?: (mode: SessionMode) => void;
  /**
   * 1-based research workflow stage index propagated from the parent layout
   * (ResearchStageBar). When provided, the chat surface tailors its
   * placeholder, guided-prompt scenarios, and stage hint banner to match the
   * 5-stage research pipeline.
   */
  currentResearchStage?: number;
  onNavigateAppTab?: (tab: AppTab) => void;
  onContextSidebarLayoutChange?: (layout: { width: number; collapsed: boolean }) => void;
  contextSidebarExpandSignal?: number;
  /** When true, parent renders ChatContextSidebar and receives live chat state via the callbacks below. */
  detachContextSidebar?: boolean;
  contextSidebarTab?: ChatSidebarTab;
  onContextSidebarTabChange?: (tab: ChatSidebarTab) => void;
  onContextSidebarMessagesChange?: (messages: ChatMessage[]) => void;
  onContextSidebarProviderChange?: (provider: SessionProvider) => void;
  onRegisterContextSidebarHandlers?: (handlers: {
    onStartTask: (prompt?: string, task?: {
      id?: string | number | null;
      title?: string | null;
      stage?: string | null;
    } | null) => void;
    onFileOpen: (filePath: string, diffInfo?: unknown) => void;
    onSummarizeMemory: () => void;
  } | null) => void;
}

export interface ProviderAvailability {
  cliAvailable: boolean;
  configured?: boolean;
  cliCommand?: string | null;
  installHint?: string | null;
  planLocked?: boolean;
  disabledReason?: string | null;
  modelProviderId?: string | null;
  modelId?: string | null;
  modelApi?: string | null;
  models?: Array<{ value: string; label?: string; modelProviderId: string; modelApi: string }>;
  catalogRevision?: number | null;
  catalogHealth?: 'healthy' | 'degraded' | 'disabled' | 'rate_limited' | 'unavailable' | null;
  retryAt?: string | null;
  privacyNotice?: string | null;
  priceNotice?: string | null;
}
