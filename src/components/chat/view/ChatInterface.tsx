import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTaskMaster } from '../../../contexts/TaskMasterContext';
import { useTranslation } from 'react-i18next';
import ChatMessagesPane from './subcomponents/ChatMessagesPane';
import ChatComposer from './subcomponents/ChatComposer';
import ProjectCreationWizard from '../../ProjectCreationWizard';
import ChatContextSidebar from './subcomponents/ChatContextSidebar';
import GuidedPromptStarter from './subcomponents/GuidedPromptStarter';
import MessageShareDialog from './subcomponents/MessageShareDialog';
import RewindConfirmDialog from './subcomponents/RewindConfirmDialog';
import SelectionConsultationPanel, {
  type SelectionConsultationSeed,
} from './subcomponents/SelectionConsultationPanel';
import { RESUMING_STATUS_TEXT, normalizeChatSidebarTab } from '../types/types';
import type { ChatInterfaceProps, ChatMessage, QueuedChatTurn, TaskContext } from '../types/types';
import type { ChatSidebarTab } from '../types/types';
import type { ProviderAvailability } from '../types/types';
import { useChatProviderState } from '../hooks/useChatProviderState';
import { useChatSessionState } from '../hooks/useChatSessionState';
import { useChatRealtimeHandlers } from '../hooks/useChatRealtimeHandlers';
import { useChatComposerState } from '../hooks/useChatComposerState';
import { useDeviceSettings } from '../../../hooks/useDeviceSettings';
import type { Provider } from '../types/types';
import { authenticatedFetch } from '../../../utils/api';
import { api } from '../../../utils/api';
import { getActiveLocalKernel } from '../../../services/localKernelConnection';
import { readCliAvailability, writeCliAvailability } from '../../../utils/cliAvailability';
import { applyAuthoritativePiSelection } from '../utils/piActiveSelection';
import { ANALYSIS_PROVIDERS, canStartImportedProjectAnalysis, getImportedProjectAnalysisModels } from '../utils/importedProjectAnalysis';
import { clearSessionTimerStart, getChatMessagesStorageKey, safeLocalStorage } from '../utils/chatStorage';
import { Button } from '../../ui/button';
import type { PendingAutoIntake, Project, ProjectSession, SessionProvider } from '../../../types/app';
import { normalizeCodexStoredModelSelection } from '../../../../shared/modelConstants';
import { isTemporaryAgentSessionId, normalizeRuntimeId } from '../../../../shared/agentSessionIdentity';
import { getProviderDisplayName } from '../utils/chatFormatting';
import { stageIdFromIndex } from '../constants/researchStageMapping';
import { buildSelectionConsultationContext } from '../utils/selectionConsultation';
import { getAttachedPromptInputPlaceholder } from '../utils/attachedPromptLocalization';
import { resolveComposerPlaceholderKind } from '../utils/composerPlaceholder';
import { isConversationFolderProject } from '../../../utils/draftProject';
import {
  resolveActiveSessionId,
  shouldShowConnectionRecoveryStatus,
  shouldPropagateProcessingState,
} from '../utils/sessionRealtimeIdentity';


const DEFAULT_PROVIDER_AVAILABILITY = {
  pi: { cliAvailable: false, configured: false, cliCommand: null, installHint: 'Pi Runtime is not configured.' },
} satisfies Partial<Record<Provider, ProviderAvailability>>;

const WEBSOCKET_DISCONNECT_GRACE_MS = 12_000;

const INTAKE_GREETING = `Hello! I'm your MedHelp research assistant, here to help you set up your research pipeline.\n\nTo get started, could you tell me about your research field or topic?`;

const getAutoIntakePrompt = (pendingAutoIntake?: PendingAutoIntake | null) => {
  const prompt = pendingAutoIntake?.prompt?.trim();
  return prompt || null;
};

const getAutoIntakeTriggerId = (pendingAutoIntake?: PendingAutoIntake | null) => {
  const triggerId = pendingAutoIntake?.triggerId?.trim();
  return triggerId || null;
};

const getAutoIntakeStorageKey = (projectName: string, triggerId?: string | null) =>
  triggerId ? `intake_triggered_${projectName}_${triggerId}` : `intake_triggered_${projectName}`;

const getImportedProjectAnalysisStorageKey = (projectName: string) => `imported_project_analysis_prompt_${projectName}`;

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
  provider?: Provider;
};

function ChatInterface({
  selectedProject,
  selectedSession,
  initialProjectFiles = [],
  ws,
  sendMessage,
  latestMessage,
  onFileOpen,
  onInputFocusChange,
  onSessionActive,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  processingSessions,
  onReplaceTemporarySession,
  onNavigateToSession,
  onShowSettings,
  autoExpandTools,
  showRawParameters,
  showThinking,
  autoScrollToBottom,
  sendByCtrlEnter,
  externalMessageUpdate,
  newSessionResetKey = 0,
  preserveDraftProjectRebind = false,
  pendingAutoIntake,
  clearPendingAutoIntake,
  importedProjectAnalysisPrompt,
  clearImportedProjectAnalysisPrompt,
  onStartWorkspaceQa,
  newSessionMode = 'research',
  onNewSessionModeChange,
  currentResearchStage,
  onNavigateAppTab,
  onContextSidebarLayoutChange,
  contextSidebarExpandSignal = 0,
  detachContextSidebar = false,
  contextSidebarTab,
  onContextSidebarTabChange,
  onContextSidebarMessagesChange,
  onContextSidebarProviderChange,
  onRegisterContextSidebarHandlers,
  onCreateProjectFromPrompt,
  onProjectSelect,
  onStartConversationWithProject,
  onClearConversationFolder,
  onSelectionConsultationChange,
}: ChatInterfaceProps) {
  const { refreshTasks } = useTaskMaster();
  const { t, i18n } = useTranslation('chat');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const [messageShareUrl, setMessageShareUrl] = useState('');
  const [isRewindConfirmOpen, setIsRewindConfirmOpen] = useState(false);
  const [showFolderConnector, setShowFolderConnector] = useState(false);
  const [selectionConsultationSeed, setSelectionConsultationSeed] = useState<SelectionConsultationSeed | null>(null);
  const [queuedTurns, setQueuedTurns] = useState<QueuedChatTurn[]>([]);
  const handleQueuedTurnAdded = useCallback((turn: QueuedChatTurn) => {
    setQueuedTurns((previous) => previous.some((item) => item.id === turn.id)
      ? previous
      : [...previous, turn]);
  }, []);
  const [internalSidebarTab, setInternalSidebarTab] = useState<ChatSidebarTab>(() => {
    if (typeof window === 'undefined') {
      return 'files';
    }
    return normalizeChatSidebarTab(window.localStorage.getItem('chat-sidebar-active-tab'));
  });
  const sidebarTab = contextSidebarTab ?? internalSidebarTab;
  const setSidebarTab = useCallback((nextTab: ChatSidebarTab | ((prev: ChatSidebarTab) => ChatSidebarTab)) => {
    const requestedTab = typeof nextTab === 'function'
      ? nextTab(contextSidebarTab ?? internalSidebarTab)
      : nextTab;
    const resolvedTab = normalizeChatSidebarTab(requestedTab);
    if (onContextSidebarTabChange) {
      onContextSidebarTabChange(resolvedTab);
      return;
    }
    setInternalSidebarTab(resolvedTab);
  }, [contextSidebarTab, internalSidebarTab, onContextSidebarTabChange]);

  const streamBufferRef = useRef('');
  const streamTimerRef = useRef<number | null>(null);
  const pendingViewSessionRef = useRef<PendingViewSession | null>(null);
  const lastWsDisconnectNoticeRef = useRef<number>(0);
  const wsDisconnectTimerRef = useRef<number | null>(null);
  const localTurnAwaitingBackendRef = useRef(false);
  const localTurnBaselineMessageRef = useRef<unknown>(latestMessage);
  const handleChatFilePreviewOpen = useCallback((filePath: string, diffInfo?: unknown) => {
    if (!filePath.trim()) {
      return;
    }
    onFileOpen?.(filePath, diffInfo);
  }, [onFileOpen]);

  const resetStreamingState = useCallback(() => {
    if (streamTimerRef.current) {
      clearTimeout(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    streamBufferRef.current = '';
  }, []);

  const {
    provider,
    setProvider,
    claudeModel,
    setClaudeModel,
    codexModel,
    setCodexModel,
    piModel,
    setPiModel,
    piModelProviderId,
    setPiModelProviderId,
    piModelApi,
    setPiModelApi,
    piCatalogRevision,
    setPiCatalogRevision,
    permissionMode,
    permissionModes,
    selectPermissionMode,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    cyclePermissionMode,
  } = useChatProviderState({
    selectedSession,
  });

  const sessionActivityScope = useMemo(() => {
    const runtimeId = normalizeRuntimeId(provider);
    return runtimeId && selectedProject?.name
      ? { projectKey: selectedProject.name, runtimeId }
      : undefined;
  }, [provider, selectedProject?.name]);
  const onScopedSessionActive = useCallback((sessionId?: string | null) => {
    onSessionActive?.(sessionId, sessionActivityScope);
  }, [onSessionActive, sessionActivityScope]);
  const onScopedSessionInactive = useCallback((sessionId?: string | null) => {
    onSessionInactive?.(sessionId, sessionActivityScope);
  }, [onSessionInactive, sessionActivityScope]);
  const onScopedSessionProcessing = useCallback((sessionId?: string | null) => {
    onSessionProcessing?.(sessionId, sessionActivityScope);
  }, [onSessionProcessing, sessionActivityScope]);
  const onScopedSessionNotProcessing = useCallback((sessionId?: string | null) => {
    onSessionNotProcessing?.(sessionId, sessionActivityScope);
  }, [onSessionNotProcessing, sessionActivityScope]);
  const {
    chatMessages,
    setChatMessages,
    isLoading,
    setIsLoading,
    currentSessionId,
    setCurrentSessionId,
    sessionMessages,
    setSessionMessages,
    isLoadingSessionMessages,
    isLoadingMoreMessages,
    hasOlderMessages,
    handleLoadOlderMessages,
    isSystemSessionChange,
    setIsSystemSessionChange,
    canAbortSession,
    setCanAbortSession,
    isUserScrolledUp,
    setIsUserScrolledUp,
    tokenBudget,
    setTokenBudget,
    visibleMessages,
    claudeStatus,
    setClaudeStatus,
    statusTextOverride,
    setStatusTextOverride,
    createDiff,
    scrollContainerRef,
    scrollToBottom,
    scrollToBottomAndReset,
    handleScroll,
    requestTranscriptReconcile,
    resolveSessionStatusCheck,
  } = useChatSessionState({
    selectedProject,
    selectedSession,
    provider,
    ws,
    sendMessage,
    autoScrollToBottom,
    externalMessageUpdate,
    processingSessions,
    resetStreamingState,
    pendingViewSessionRef,
    preserveDraftProjectRebind,
    onSessionInactive: onScopedSessionInactive,
    onSessionNotProcessing: onScopedSessionNotProcessing,
  });

  const onScopedReplaceTemporarySession = useCallback((realSessionId?: string | null) => {
    const previousSessionId = isTemporaryAgentSessionId(currentSessionId)
      ? currentSessionId
      : null;
    onReplaceTemporarySession?.(realSessionId, sessionActivityScope, previousSessionId);
  }, [currentSessionId, onReplaceTemporarySession, sessionActivityScope]);

  const chatMessagesRef = useRef(chatMessages);
  chatMessagesRef.current = chatMessages;

  const setComposerIsLoading = useCallback((loading: boolean) => {
    if (loading) {
      localTurnAwaitingBackendRef.current = true;
      localTurnBaselineMessageRef.current = latestMessage;
    } else {
      localTurnAwaitingBackendRef.current = false;
    }
    setIsLoading(loading);
  }, [latestMessage, setIsLoading]);

  useEffect(() => {
    if (selectedSession?.__provider === provider) {
      return;
    }
    if (
      localTurnAwaitingBackendRef.current
      && localTurnBaselineMessageRef.current !== latestMessage
    ) {
      localTurnAwaitingBackendRef.current = false;
    }
  }, [latestMessage]);

  const lastHandledNewSessionResetKeyRef = useRef(0);
  useEffect(() => {
    if (
      newSessionResetKey <= lastHandledNewSessionResetKeyRef.current
      || selectedSession?.id
      || (typeof window !== 'undefined' && window.location.pathname !== '/')
    ) {
      return;
    }

    lastHandledNewSessionResetKeyRef.current = newSessionResetKey;
    const pendingSessionId = pendingViewSessionRef.current?.sessionId || currentSessionId;
    clearSessionTimerStart(pendingSessionId);
    pendingViewSessionRef.current = null;
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem('pendingSessionId');
    }
    if (selectedProject?.name) {
      safeLocalStorage.removeItem(getChatMessagesStorageKey({ projectName: selectedProject.name }));
    }
    resetStreamingState();
    localTurnAwaitingBackendRef.current = false;
    setChatMessages([]);
    setSessionMessages([]);
    setCurrentSessionId(null);
    setIsLoading(false);
    setCanAbortSession(false);
    setClaudeStatus(null);
    setStatusTextOverride(null);
    setPendingPermissionRequests([]);
  }, [
    currentSessionId,
    newSessionResetKey,
    resetStreamingState,
    selectedProject?.name,
    selectedSession?.id,
    setCanAbortSession,
    setChatMessages,
    setClaudeStatus,
    setCurrentSessionId,
    setIsLoading,
    setPendingPermissionRequests,
    setSessionMessages,
    setStatusTextOverride,
  ]);

  const handleShareAssistantMessage = useCallback(async (message: ChatMessage) => {
    if (!selectedProject || !selectedSession) {
      throw new Error('No active session selected');
    }

    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (!content) {
      throw new Error('Message content is empty');
    }

    const response = await api.shares.createMessage({
      projectName: selectedProject.name,
      sessionId: selectedSession.id,
      provider,
      visibility: 'public',
      content,
      timestamp: message.timestamp,
      title: 'MedHelp shared answer',
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(data?.error || 'Failed to create message share');
    }

    const shareUrl = data?.url || data?.share?.url;
    if (!shareUrl) {
      throw new Error('Failed to create message share');
    }

    setMessageShareUrl(shareUrl);
  }, [provider, selectedProject, selectedSession]);

  // A token refresh, laptop wake, browser network transition, or Local Kernel probe can
  // briefly replace the socket without stopping the agent. Preserve the processing state
  // while WebSocketContext reconnects; useChatSessionState rechecks the backend as soon as
  // the replacement socket is available.
  useEffect(() => {
    if (ws) {
      if (wsDisconnectTimerRef.current) {
        clearTimeout(wsDisconnectTimerRef.current);
        wsDisconnectTimerRef.current = null;
      }
      setStatusTextOverride((previous) => (
        previous === RESUMING_STATUS_TEXT ? null : previous
      ));
      return;
    }

    if (!isLoading) {
      return;
    }

    const showRecoveryStatus = shouldShowConnectionRecoveryStatus({
      isProcessing: isLoading,
      socketAvailable: Boolean(ws),
      localTurnAwaitingBackend: localTurnAwaitingBackendRef.current,
    });
    setStatusTextOverride((previous) => {
      if (showRecoveryStatus) {
        return RESUMING_STATUS_TEXT;
      }
      return previous === RESUMING_STATUS_TEXT ? null : previous;
    });
    if (wsDisconnectTimerRef.current) {
      return;
    }

    wsDisconnectTimerRef.current = window.setTimeout(() => {
      wsDisconnectTimerRef.current = null;
      setIsLoading(false);
      setCanAbortSession(false);
      setClaudeStatus(null);
      setStatusTextOverride(null);
      setPendingPermissionRequests([]);
      localTurnAwaitingBackendRef.current = false;
      resetStreamingState();

      const activeSessionId = resolveActiveSessionId({
        isProcessing: true,
        currentSessionId,
        selectedSessionId: selectedSession?.id,
        pendingSessionId: pendingViewSessionRef.current?.sessionId,
      });
      if (activeSessionId) {
        clearSessionTimerStart(activeSessionId);
        onScopedSessionInactive(activeSessionId);
        onScopedSessionNotProcessing(activeSessionId);
      }

      const now = Date.now();
      if (now - lastWsDisconnectNoticeRef.current < WEBSOCKET_DISCONNECT_GRACE_MS) {
        return;
      }
      lastWsDisconnectNoticeRef.current = now;

      setChatMessages((previous) => [
        ...previous,
        {
          type: 'error',
          content: 'Unable to restore the agent connection. The session status could not be confirmed; please reconnect before retrying.',
          timestamp: new Date(),
        },
      ]);
    }, WEBSOCKET_DISCONNECT_GRACE_MS);

    return () => {
      if (wsDisconnectTimerRef.current) {
        clearTimeout(wsDisconnectTimerRef.current);
        wsDisconnectTimerRef.current = null;
      }
    };
  }, [
    isLoading,
    resetStreamingState,
    setCanAbortSession,
    setChatMessages,
    setClaudeStatus,
    setIsLoading,
    setPendingPermissionRequests,
    setStatusTextOverride,
    onScopedSessionInactive,
    onScopedSessionNotProcessing,
    currentSessionId,
    latestMessage,
    selectedSession?.id,
    ws,
  ]);

  const {
    input,
    setInput,
    attachedPrompt,
    setAttachedPrompt,
    textareaRef,
    inputHighlightRef,
    isTextareaExpanded,
    thinkingMode,
    setThinkingMode,
    codexReasoningEffort,
    setCodexReasoningEffort,
    slashCommandsCount,
    filteredCommands,
    frequentCommands,
    commandQuery,
    showCommandMenu,
    selectedCommandIndex,
    resetCommandMenuState,
    handleCommandSelect,
    handleToggleCommandMenu,
    showFileDropdown,
    filteredFiles,
    selectedFileIndex,
    renderInputWithMentions,
    selectFile,
    attachedFiles,
    removeAttachedFile,
    attachedProjectFiles,
    attachProjectFiles,
    removeAttachedProjectFile,
    uploadingFiles,
    fileErrors,
    getRootProps,
    getInputProps,
    isDragActive,
    openFilePicker,
    handleSubmit,
    handleSteerSubmit,
    handleInputChange,
    handleKeyDown,
    handlePaste,
    handleTextareaClick,
    handleTextareaInput,
    syncInputOverlayScroll,
    handleClearInput,
    handleAbortSession,
    handleTranscript,
    handlePermissionDecision,
    handleGrantToolPermission,
    handleInputFocusChange,
    isInputFocused,
    intakeGreeting,
    setIntakeGreeting,
    setPendingStageTagKeys,
    setPendingTaskContext,
    submitProgrammaticInput,
  } = useChatComposerState({
    selectedProject,
    selectedSession,
    initialProjectFiles,
    currentSessionId,
    provider,
    permissionMode,
    cyclePermissionMode,
    claudeModel,
    codexModel,
    piModel,
    piModelProviderId,
    piModelApi,
    piCatalogRevision,
    isLoading,
    canAbortSession,
    tokenBudget,
    sendMessage,
    sendByCtrlEnter,
    onSessionActive: onScopedSessionActive,
    onSessionInactive: onScopedSessionInactive,
    onSessionNotProcessing: onScopedSessionNotProcessing,
    onInputFocusChange,
    onFileOpen: handleChatFilePreviewOpen,
    onShowSettings,
    pendingViewSessionRef,
    scrollToBottom,
    setChatMessages,
    setSessionMessages,
    setIsLoading: setComposerIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setIsUserScrolledUp,
    pendingPermissionRequests,
    setPendingPermissionRequests,
    newSessionMode,
    onCreateProjectFromPrompt,
    onQueuedTurnAdded: handleQueuedTurnAdded,
  });

  const lastClearedComposerResetKeyRef = useRef(0);
  useEffect(() => {
    if (
      newSessionResetKey <= lastClearedComposerResetKeyRef.current
      || selectedSession?.id
      || (typeof window !== 'undefined' && window.location.pathname !== '/')
    ) {
      return;
    }

    lastClearedComposerResetKeyRef.current = newSessionResetKey;
    handleClearInput();
  }, [handleClearInput, newSessionResetKey, selectedSession?.id]);

  useChatRealtimeHandlers({
    latestMessage,
    onPiPermissionModeChange: selectPermissionMode,
    provider,
    selectedProject,
    selectedSession,
    currentSessionId,
    isLoading,
    setCurrentSessionId,
    setChatMessages,
    chatMessagesRef,
    setIsLoading,
    setCanAbortSession,
    setClaudeStatus,
    setStatusTextOverride,
    setTokenBudget,
    setIsSystemSessionChange,
    setPendingPermissionRequests,
    setQueuedTurns,
    pendingViewSessionRef,
    streamBufferRef,
    streamTimerRef,
    onSessionInactive: onScopedSessionInactive,
    onSessionProcessing: onScopedSessionProcessing,
    onSessionNotProcessing: onScopedSessionNotProcessing,
    onSessionStatusResolved: resolveSessionStatusCheck,
    onReplaceTemporarySession: onScopedReplaceTemporarySession,
    onNavigateToSession,
    requestTranscriptReconcile,
  });

  const queueSessionId = selectedSession?.id || pendingViewSessionRef.current?.sessionId || currentSessionId || null;

  useEffect(() => {
    setQueuedTurns([]);
    if (!queueSessionId || (provider !== 'claude' && provider !== 'codex' && provider !== 'pi')) return;
    sendMessage({
      type: 'agent-turn-queue-status',
      provider,
      runtimeId: provider,
      projectKey: selectedProject?.name,
      sessionId: queueSessionId,
    });
  }, [provider, queueSessionId, selectedProject?.name, sendMessage]);

  const handleEditQueuedTurn = useCallback((itemId: string, content: string) => {
    if (!queueSessionId || (provider !== 'claude' && provider !== 'codex' && provider !== 'pi')) return;
    setQueuedTurns((previous) => previous.map((item) => item.id === itemId ? { ...item, content } : item));
    sendMessage({ type: 'agent-turn-update', provider, runtimeId: provider, projectKey: selectedProject?.name, sessionId: queueSessionId, itemId, content });
  }, [provider, queueSessionId, selectedProject?.name, sendMessage]);

  const handleRemoveQueuedTurn = useCallback((itemId: string) => {
    if (!queueSessionId || (provider !== 'claude' && provider !== 'codex' && provider !== 'pi')) return;
    setQueuedTurns((previous) => previous.filter((item) => item.id !== itemId));
    sendMessage({ type: 'agent-turn-remove', provider, runtimeId: provider, projectKey: selectedProject?.name, sessionId: queueSessionId, itemId });
  }, [provider, queueSessionId, selectedProject?.name, sendMessage]);

  const handleReorderQueuedTurns = useCallback((itemIds: string[]) => {
    if (!queueSessionId || (provider !== 'claude' && provider !== 'codex' && provider !== 'pi')) return;
    setQueuedTurns((previous) => {
      const byId = new Map(previous.map((item) => [item.id, item]));
      const reordered = itemIds.map((itemId) => byId.get(itemId)).filter((item): item is QueuedChatTurn => Boolean(item));
      return reordered.length === previous.length ? reordered : previous;
    });
    sendMessage({ type: 'agent-turn-reorder', provider, runtimeId: provider, projectKey: selectedProject?.name, sessionId: queueSessionId, itemIds });
  }, [provider, queueSessionId, selectedProject?.name, sendMessage]);

  const handleClearQueuedTurns = useCallback(() => {
    if (!queueSessionId || (provider !== 'claude' && provider !== 'codex' && provider !== 'pi')) return;
    setQueuedTurns([]);
    sendMessage({ type: 'agent-turn-clear', provider, runtimeId: provider, projectKey: selectedProject?.name, sessionId: queueSessionId });
  }, [provider, queueSessionId, selectedProject?.name, sendMessage]);

  const isEmpty = chatMessages.length === 0 && !selectedSession && !currentSessionId;

  const handleConsultSelection = useCallback((selectedText: string) => {
    const normalizedSelection = selectedText.trim();
    if (!normalizedSelection || (provider !== 'claude' && provider !== 'codex')) {
      return;
    }
    const nextSeed: SelectionConsultationSeed = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      selectedText: normalizedSelection,
      conversationContext: buildSelectionConsultationContext(chatMessagesRef.current),
      provider,
    };
    setSelectionConsultationSeed(nextSeed);
    onSelectionConsultationChange?.(nextSeed);
    setSidebarTab('consultation');
  }, [onSelectionConsultationChange, provider, setSidebarTab]);

  const closeSelectionConsultation = useCallback(() => {
    setSelectionConsultationSeed(null);
    onSelectionConsultationChange?.(null);
    setSidebarTab('context');
  }, [onSelectionConsultationChange, setSidebarTab]);

  const handleRetry = useCallback(() => {
    const msgs = chatMessagesRef.current;
    let lastUserMessage: (typeof msgs)[number] | undefined;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].type === 'user') { lastUserMessage = msgs[i]; break; }
    }
    if (!lastUserMessage?.content) return;
    submitProgrammaticInput(lastUserMessage.content);
  }, [submitProgrammaticInput]);

  const handleStartTaskInChat = useCallback((prompt?: string, task?: TaskContext & {
    inputsNeeded?: string[] | null;
    guidance?: {
      whyNext?: string | null;
      requiredInputs?: string[] | null;
      suggestedSkills?: string[] | null;
      nextActionPrompt?: string | null;
    } | null;
  } | null) => {
    const nextPrompt = prompt && prompt.trim()
      ? prompt.trim()
      : t('tasks.nextTaskPrompt', { defaultValue: 'Start the next task' });
    const stage = String(task?.stage || '').trim().toLowerCase();
    const guidance = task?.guidance || null;

    setPendingStageTagKeys(stage ? [stage] : []);
    setPendingTaskContext(task ? {
      id: task.id ?? null,
      title: task.title ?? null,
      objective: task.objective ?? null,
      stage: stage || null,
      status: task.status ?? null,
      priority: task.priority ?? null,
      description: task.description ?? null,
      details: task.details ?? null,
      testStrategy: task.testStrategy ?? null,
      taskType: task.taskType ?? null,
      nextActionPrompt: task.nextActionPrompt || guidance?.nextActionPrompt || prompt || null,
      whyNext: task.whyNext || guidance?.whyNext || null,
      requiredInputs: guidance?.requiredInputs || task.inputsNeeded || null,
      suggestedSkills: guidance?.suggestedSkills || task.suggestedSkills || null,
      dependencies: task.dependencies || null,
      acceptanceCriteria: task.acceptanceCriteria || null,
      expectedArtifacts: task.expectedArtifacts || null,
      allowedOutputRoots: task.allowedOutputRoots || null,
      forbiddenChanges: task.forbiddenChanges || null,
      acceptedEvidence: task.acceptedEvidence || null,
      verificationMode: task.verificationMode || null,
      acceptedInputFiles: task.acceptedInputFiles || null,
      noArtifactExpected: task.noArtifactExpected ?? null,
      maxAttempts: task.maxAttempts ?? null,
      maxVerificationAttempts: task.maxVerificationAttempts ?? null,
    } : null);
    setSidebarTab('context');

    window.setTimeout(() => {
      submitProgrammaticInput(nextPrompt);
    }, 0);
  }, [setPendingStageTagKeys, setPendingTaskContext, submitProgrammaticInput, t]);

  const autoIntakeTriggeredRef = useRef(false);
  const lastAutoIntakeTriggerIdRef = useRef<string | null>(null);
  const [importedProjectAnalysisProvider, setImportedProjectAnalysisProvider] = React.useState<Provider>('pi');
  const [pendingImportedProjectAnalysisSubmit, setPendingImportedProjectAnalysisSubmit] = React.useState<{
    prompt: string;
    provider: Provider;
  } | null>(null);
  const shouldShowImportedProjectAnalysisPrompt = useMemo(() => {
    if (!importedProjectAnalysisPrompt || !selectedProject || selectedSession || isLoading) {
      return false;
    }

    const targetProjectName = importedProjectAnalysisPrompt.project?.name;
    if (!targetProjectName || targetProjectName !== selectedProject.name) {
      return false;
    }

    if (chatMessages.length > 0) {
      return false;
    }

    if (typeof window === 'undefined') {
      return true;
    }

    const dismissedKey = getImportedProjectAnalysisStorageKey(selectedProject.name);
    return sessionStorage.getItem(dismissedKey) !== 'dismissed';
  }, [chatMessages.length, importedProjectAnalysisPrompt, isLoading, selectedProject, selectedSession]);
  const [providerAvailability, setProviderAvailability] = React.useState<Partial<Record<Provider, ProviderAvailability>>>(() => {
    const cached = readCliAvailability();

    return {
      pi: cached.pi ?? DEFAULT_PROVIDER_AVAILABILITY.pi,
    };
  });
  const importedProjectAnalysisModel = useMemo(() => {
    if (importedProjectAnalysisProvider === 'pi') return piModel;
    return '';
  }, [claudeModel, codexModel, piModel, importedProjectAnalysisProvider]);
  const importedProjectAnalysisModels = useMemo(() => getImportedProjectAnalysisModels(
    importedProjectAnalysisProvider,
    providerAvailability[importedProjectAnalysisProvider],
  ), [importedProjectAnalysisProvider, providerAvailability]);
  const canAnalyzeImportedProject = canStartImportedProjectAnalysis(
    importedProjectAnalysisProvider,
    importedProjectAnalysisModel,
    providerAvailability[importedProjectAnalysisProvider],
  );

  useEffect(() => {
    let cancelled = false;

    let requestSequence = 0;
    const loadProviderAvailability = async () => {
      const sequence = ++requestSequence;
      const checks: Array<{ provider: Provider; endpoint: string; fallbackCommand: string; strict?: boolean }> = [
        { provider: 'pi', endpoint: '/api/cli/pi/status', fallbackCommand: 'pi', strict: true },
      ];

      const results = await Promise.all(checks.map(async ({ provider: nextProvider, endpoint, fallbackCommand, strict }) => {
        try {
          const statusEndpoint = getActiveLocalKernel()
            ? endpoint.replace('/api/cli/', '/api/local/cli/')
            : endpoint;
          const response = await authenticatedFetch(statusEndpoint);
          const data = await response.json();
          if (!response.ok) {
            throw new Error(data?.error || `HTTP ${response.status}`);
          }
          const piConfigured = nextProvider !== 'pi' || data.configured === true;
          return [nextProvider, {
            // Runtime installation and model-provider configuration are separate
            // states. Treating an unconfigured provider as a missing Pi Host leaves
            // the UI stuck on "Install required" even after the Host is prepared.
            cliAvailable: data.cliAvailable !== false,
            configured: nextProvider === 'pi'
              ? (data.cliAvailable !== false ? piConfigured : undefined)
              : true,
            cliCommand: data.cliCommand || fallbackCommand,
            installHint: data.installHint || (!piConfigured ? t('providerSelection.piConfigurationRequired') : null),
            modelProviderId: data.modelProviderId || null,
            modelId: data.modelId || null,
            modelApi: data.modelApi || null,
            models: Array.isArray(data.models) ? data.models : undefined,
            catalogRevision: Number.isInteger(data.catalogRevision) ? data.catalogRevision : null,
            catalogHealth: data.catalogHealth || null,
            retryAt: data.retryAt || null,
            privacyNotice: data.privacyNotice || null,
            priceNotice: data.priceNotice || null,
          }] as const;
        } catch {
          return [nextProvider, {
            cliAvailable: !strict,
            configured: undefined,
            cliCommand: strict ? null : fallbackCommand,
            installHint: strict ? 'Pi Runtime status is unavailable.' : null,
          }] as const;
        }
      }));

      if (cancelled || sequence !== requestSequence) {
        return;
      }

      const nextAvailability = Object.fromEntries(results) as Partial<Record<Provider, ProviderAvailability>>;
      for (const [nextProvider, availability] of Object.entries(nextAvailability) as Array<[Provider, ProviderAvailability]>) {
        writeCliAvailability(nextProvider, {
          cliAvailable: availability.cliAvailable,
          cliCommand: availability.cliCommand ?? null,
          installHint: availability.installHint ?? null,
        });
      }

      setProviderAvailability(nextAvailability);
      applyAuthoritativePiSelection(nextAvailability.pi, {
        storage: localStorage,
        setModelId: setPiModel,
        setModelProviderId: setPiModelProviderId,
        setModelApi: setPiModelApi,
      });
      const configuredCatalogRevision = nextAvailability.pi?.catalogRevision;
      if (Number.isInteger(configuredCatalogRevision)) {
        setPiCatalogRevision(configuredCatalogRevision ?? null);
        localStorage.setItem('pi-catalog-revision', String(configuredCatalogRevision));
      }
    };

    void loadProviderAvailability();
    window.addEventListener('pi-provider-config-changed', loadProviderAvailability);

    return () => {
      cancelled = true;
      window.removeEventListener('pi-provider-config-changed', loadProviderAvailability);
    };
  }, [
    setPiCatalogRevision,
    setPiModel,
    setPiModelApi,
    setPiModelProviderId,
    t,
  ]);

  useEffect(() => {
    // An opened transcript owns its provider identity. A transient CLI/Kernel
    // status failure must not switch Pi -> Claude while the session-selection
    // effect simultaneously switches Claude -> Pi; that feedback loop causes
    // the entire conversation surface to continuously remount and shake.
    if (selectedSession?.id && selectedSession.__provider) {
      return;
    }
    if (
      providerAvailability[provider]?.cliAvailable === false
      || providerAvailability[provider]?.planLocked === true
    ) {
      const fallbackProvider = (['pi'] as const).find(
        (candidate) => (
          providerAvailability[candidate]?.cliAvailable !== false
          && providerAvailability[candidate]?.planLocked !== true
        ),
      );

      if (fallbackProvider && fallbackProvider !== provider) {
        setProvider(fallbackProvider);
        localStorage.setItem('selected-provider', fallbackProvider);
      }
    }
  }, [provider, providerAvailability, selectedSession?.__provider, setProvider]);

  useEffect(() => {
    if (
      providerAvailability[importedProjectAnalysisProvider]?.cliAvailable !== false
      && providerAvailability[importedProjectAnalysisProvider]?.planLocked !== true
    ) {
      return;
    }

    const fallbackProvider = ANALYSIS_PROVIDERS.find(
      ({ id }) => (
        providerAvailability[id]?.cliAvailable !== false
        && providerAvailability[id]?.planLocked !== true
      ),
    )?.id;

    if (fallbackProvider && fallbackProvider !== importedProjectAnalysisProvider) {
      setImportedProjectAnalysisProvider(fallbackProvider);
    }
  }, [importedProjectAnalysisProvider, providerAvailability]);

  useEffect(() => {
    if (!pendingImportedProjectAnalysisSubmit) {
      return;
    }

    if (provider !== pendingImportedProjectAnalysisSubmit.provider) {
      return;
    }

    const prompt = pendingImportedProjectAnalysisSubmit.prompt;
    setPendingImportedProjectAnalysisSubmit(null);
    submitProgrammaticInput(prompt);
  }, [pendingImportedProjectAnalysisSubmit, provider, submitProgrammaticInput]);

  useEffect(() => {
    const triggerId = getAutoIntakeTriggerId(pendingAutoIntake);
    if (triggerId && lastAutoIntakeTriggerIdRef.current !== triggerId) {
      autoIntakeTriggeredRef.current = false;
      lastAutoIntakeTriggerIdRef.current = triggerId;
    }

    if (!pendingAutoIntake || newSessionMode !== 'research') {
      autoIntakeTriggeredRef.current = false;
      return;
    }

    if (
      autoIntakeTriggeredRef.current ||
      !selectedProject ||
      selectedSession ||
      isLoading ||
      chatMessages.length > 0
    ) return;

    const intakeKey = getAutoIntakeStorageKey(selectedProject.name, triggerId);
    if (sessionStorage.getItem(intakeKey)) {
      clearPendingAutoIntake?.();
      return;
    }

    autoIntakeTriggeredRef.current = true;
    sessionStorage.setItem(intakeKey, 'true');

    const autoIntakePrompt = getAutoIntakePrompt(pendingAutoIntake);

    if (autoIntakePrompt) {
      clearPendingAutoIntake?.();
      submitProgrammaticInput(autoIntakePrompt);
      return;
    }

    clearPendingAutoIntake?.();

    setIntakeGreeting(INTAKE_GREETING);
  }, [
    pendingAutoIntake,
    selectedProject,
    selectedSession,
    isLoading,
    chatMessages.length,
    clearPendingAutoIntake,
    setIntakeGreeting,
    submitProgrammaticInput,
    newSessionMode,
  ]);

  useEffect(() => {
    if (selectedSession?.mode) {
      onNewSessionModeChange?.(selectedSession.mode);
    }
  }, [onNewSessionModeChange, selectedSession?.id, selectedSession?.mode]);

  useEffect(() => {
    if (typeof window !== 'undefined' && !onContextSidebarTabChange) {
      window.localStorage.setItem('chat-sidebar-active-tab', sidebarTab);
    }
  }, [onContextSidebarTabChange, sidebarTab]);

  useEffect(() => {
    onContextSidebarMessagesChange?.(chatMessages);
  }, [chatMessages, onContextSidebarMessagesChange]);

  useEffect(() => {
    onContextSidebarProviderChange?.(provider);
  }, [onContextSidebarProviderChange, provider]);

  useEffect(() => {
    if (!isLoading || !canAbortSession) {
      return;
    }

    const handleGlobalEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.repeat || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      handleAbortSession();
    };

    document.addEventListener('keydown', handleGlobalEscape, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleGlobalEscape, { capture: true });
    };
  }, [canAbortSession, handleAbortSession, isLoading]);

  const trackedProcessingSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    const shouldTrackAsProcessing =
      claudeStatus?.text !== RESUMING_STATUS_TEXT
      && shouldPropagateProcessingState({
        isProcessing: isLoading,
        currentSessionId,
        selectedSessionId: selectedSession?.id,
      });
    if (!shouldTrackAsProcessing) {
      trackedProcessingSessionIdRef.current = null;
      return;
    }

    const processingSessionId = resolveActiveSessionId({
      isProcessing: true,
      currentSessionId,
      selectedSessionId: selectedSession?.id,
      pendingSessionId: pendingViewSessionRef.current?.sessionId,
    });
    if (
      processingSessionId
      && trackedProcessingSessionIdRef.current !== processingSessionId
      && onScopedSessionProcessing
    ) {
      onScopedSessionProcessing(processingSessionId);
      trackedProcessingSessionIdRef.current = processingSessionId;
    }
  }, [claudeStatus?.text, currentSessionId, isLoading, onScopedSessionProcessing, selectedSession?.id]);

  useEffect(() => {
    return () => {
      resetStreamingState();
    };
  }, [resetStreamingState]);

  useEffect(() => {
    if (!latestMessage?.type) {
      return;
    }

    if (
      latestMessage.type === 'claude-complete' ||
      latestMessage.type === 'codex-complete' ||
      latestMessage.type === 'pi-complete'
    ) {
      refreshTasks?.();
    }
  }, [latestMessage, refreshTasks]);

  const handleImportedProjectAnalysisDismiss = useCallback(() => {
    if (typeof window !== 'undefined' && selectedProject) {
      sessionStorage.setItem(getImportedProjectAnalysisStorageKey(selectedProject.name), 'dismissed');
    }
    clearImportedProjectAnalysisPrompt?.();
  }, [clearImportedProjectAnalysisPrompt, selectedProject]);

  const handleImportedProjectAnalysisModelChange = useCallback((nextModel: string) => {
    if (importedProjectAnalysisProvider === 'claude') {
      setClaudeModel(nextModel);
      localStorage.setItem('claude-model', nextModel);
      return;
    }

    if (importedProjectAnalysisProvider === 'codex') {
      const normalizedModel = normalizeCodexStoredModelSelection(nextModel);
      setCodexModel(normalizedModel);
      localStorage.setItem('codex-model', normalizedModel);
      return;
    }

    if (importedProjectAnalysisProvider === 'pi') {
      const option = importedProjectAnalysisModels.find((model) => model.value === nextModel);
      if (!option?.modelProviderId || !option.modelApi) return;
      setPiModel(option.value);
      setPiModelProviderId(option.modelProviderId);
      setPiModelApi(option.modelApi);
      localStorage.setItem('pi-model', option.value);
      localStorage.setItem('pi-model-provider', option.modelProviderId);
      localStorage.setItem('pi-model-api', option.modelApi);
    }
  }, [importedProjectAnalysisProvider, importedProjectAnalysisModels, setClaudeModel, setCodexModel, setPiModel, setPiModelProviderId, setPiModelApi]);

  const handleImportedProjectAnalysisConfirm = useCallback(() => {
    const prompt = importedProjectAnalysisPrompt?.prompt?.trim();
    if (!prompt || !selectedProject) {
      clearImportedProjectAnalysisPrompt?.();
      return;
    }
    if (!canAnalyzeImportedProject || pendingImportedProjectAnalysisSubmit) {
      return;
    }

    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(getImportedProjectAnalysisStorageKey(selectedProject.name));
    }

    setProvider(importedProjectAnalysisProvider);
    localStorage.setItem('selected-provider', importedProjectAnalysisProvider);

    clearImportedProjectAnalysisPrompt?.();
    setPendingImportedProjectAnalysisSubmit({
      prompt,
      provider: importedProjectAnalysisProvider,
    });
  }, [
    clearImportedProjectAnalysisPrompt,
    importedProjectAnalysisPrompt?.prompt,
    importedProjectAnalysisProvider,
    canAnalyzeImportedProject,
    pendingImportedProjectAnalysisSubmit,
    selectedProject,
    setProvider,
  ]);

  const handleSidebarTabChange = useCallback((nextTab: ChatSidebarTab) => {
    setSidebarTab(nextTab);
  }, [setSidebarTab]);

  const handleSummarizeMemory = useCallback(() => {
    submitProgrammaticInput(t('sessionContext.memory.prompts.review'));
  }, [submitProgrammaticInput, t]);

  const handleRewindCurrentChanges = useCallback(() => {
    setIsRewindConfirmOpen(true);
  }, []);

  const confirmRewindCurrentChanges = useCallback(() => {
    setIsRewindConfirmOpen(false);
    submitProgrammaticInput('/rewind');
  }, [submitProgrammaticInput]);

  useEffect(() => {
    if (!onRegisterContextSidebarHandlers) {
      return undefined;
    }

    onRegisterContextSidebarHandlers({
      onStartTask: handleStartTaskInChat,
      onFileOpen: handleChatFilePreviewOpen,
      onSummarizeMemory: handleSummarizeMemory,
    });

    return () => {
      onRegisterContextSidebarHandlers(null);
    };
  }, [handleChatFilePreviewOpen, handleStartTaskInChat, handleSummarizeMemory, onRegisterContextSidebarHandlers]);

  const activeProcessingStatus = useMemo(() => {
    if (claudeStatus) {
      return {
        ...claudeStatus,
        text: statusTextOverride || claudeStatus.text,
      };
    }

    if (statusTextOverride) {
      return {
        text: statusTextOverride,
        tokens: 0,
        can_interrupt: true,
      };
    }

    return null;
  }, [claudeStatus, statusTextOverride]);

  const compactSessionId = selectedSession?.id || currentSessionId || null;
  const handleForkSessionCreated = useCallback((forkedSession: ProjectSession & { __provider: SessionProvider }) => {
    onNavigateToSession?.(forkedSession.id, forkedSession.__provider, selectedProject?.name);
  }, [onNavigateToSession, selectedProject?.name]);
  const canCompactContext = Boolean(
    (provider === 'codex' || provider === 'pi')
    && compactSessionId
    && !compactSessionId.startsWith('new-session-')
    && !isLoading,
  );
  const handleCompactContext = useCallback(async () => {
    if (!['codex', 'pi'].includes(provider) || !compactSessionId) {
      throw new Error(t('tokenUsage.compact.noSession', { defaultValue: 'Open a saved session first.' }));
    }
    const url = provider === 'pi'
      ? `/api/pi/projects/${encodeURIComponent(selectedProject?.name || '')}/sessions/${encodeURIComponent(compactSessionId)}/compact`
      : `/api/codex/sessions/${encodeURIComponent(compactSessionId)}/compact`;
    const response = await authenticatedFetch(url, {
      method: 'POST',
      ...(provider === 'pi' ? { body: JSON.stringify({ model: piModel, modelProviderId: piModelProviderId, modelApi: piModelApi }) } : {}),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result?.error || t('tokenUsage.compact.failed'));
    }
    if (provider === 'pi') {
      setTokenBudget({ used: result.context?.tokens ?? null, total: result.context?.contextWindow ?? null, estimated: Boolean(result.context?.estimated), model: result.model || piModel });
      return i18n.language.startsWith('zh') ? '上下文已压缩' : 'Context compacted';
    }

    // Compaction is persisted asynchronously by the runtime. Refresh the
    // effective-context reading shortly after the native request completes.
    window.setTimeout(async () => {
      try {
        const usageResponse = await authenticatedFetch(
          `/api/projects/${encodeURIComponent(selectedProject?.name || '')}/sessions/${encodeURIComponent(compactSessionId)}/token-usage?provider=codex`,
        );
        if (usageResponse.ok) setTokenBudget(await usageResponse.json());
      } catch (error) {
        console.warn('Failed to refresh context usage after compaction:', error);
      }
    }, 1200);

    return t('tokenUsage.compact.started');
  }, [compactSessionId, provider, selectedProject?.name, setTokenBudget, piModel, piModelProviderId, piModelApi, t, i18n.language]);

  if (!selectedProject) {
    const selectedProviderLabel = getProviderDisplayName(provider);

    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-muted-foreground">
          <p className="text-sm">
            {t('projectSelection.startChatWithProvider', {
              provider: selectedProviderLabel,
              defaultValue: 'Select a project to start chatting with {{provider}}',
            })}
          </p>
        </div>
      </div>
    );
  }

  const chatMessagesPane = (
    <ChatMessagesPane
      scrollContainerRef={scrollContainerRef}
      onWheel={handleScroll}
      onTouchMove={handleScroll}
      isLoadingSessionMessages={isLoadingSessionMessages}
      chatMessages={chatMessages}
      selectedSession={selectedSession}
      intakeGreeting={intakeGreeting}
      currentSessionId={currentSessionId}
      provider={provider}
      isLoadingMoreMessages={isLoadingMoreMessages}
      hasOlderMessages={hasOlderMessages}
      onLoadOlderMessages={handleLoadOlderMessages}
      visibleMessages={visibleMessages}
      createDiff={createDiff}
      onFileOpen={handleChatFilePreviewOpen}
      onShowSettings={onShowSettings}
      onGrantToolPermission={handleGrantToolPermission}
      autoExpandTools={autoExpandTools}
      showRawParameters={showRawParameters}
      showThinking={showThinking}
      selectedProject={selectedProject}
      isLoading={isLoading}
      status={activeProcessingStatus}
      newSessionMode={newSessionMode}
      onRetry={handleRetry}
      onRewind={provider === 'pi' ? undefined : handleRewindCurrentChanges}
      onShareAssistantMessage={handleShareAssistantMessage}
      onConsultSelection={provider === 'claude' || provider === 'codex' ? handleConsultSelection : undefined}
      onForkSessionCreated={onNavigateToSession ? handleForkSessionCreated : undefined}
    />
  );

  const chatComposer = (
    <ChatComposer
      pendingPermissionRequests={pendingPermissionRequests}
      handlePermissionDecision={handlePermissionDecision}
      handleGrantToolPermission={handleGrantToolPermission}
      isLoading={isLoading}
      onAbortSession={handleAbortSession}
      queuedTurns={queuedTurns}
      onEditQueuedTurn={handleEditQueuedTurn}
      onRemoveQueuedTurn={handleRemoveQueuedTurn}
      onReorderQueuedTurns={handleReorderQueuedTurns}
      onClearQueuedTurns={handleClearQueuedTurns}
      onStartTask={handleStartTaskInChat}
      provider={provider}
      permissionMode={permissionMode}
      permissionModes={permissionModes}
      onPermissionModeChange={selectPermissionMode}
      onModeSwitch={cyclePermissionMode}
      thinkingMode={thinkingMode}
      setThinkingMode={setThinkingMode}
      codexReasoningEffort={codexReasoningEffort}
      setCodexReasoningEffort={setCodexReasoningEffort}
      tokenBudget={tokenBudget}
      onCompactContext={provider === 'codex' ? handleCompactContext : undefined}
      canCompactContext={canCompactContext}
      slashCommandsCount={slashCommandsCount}
      onToggleCommandMenu={handleToggleCommandMenu}
      hasInput={Boolean(input.trim()) || attachedFiles.length > 0 || attachedProjectFiles.length > 0}
      onClearInput={handleClearInput}
      isUserScrolledUp={isUserScrolledUp}
      hasMessages={chatMessages.length > 0}
      onScrollToBottom={scrollToBottomAndReset}
      onSubmit={handleSubmit}
      onSteer={handleSteerSubmit}
      isDragActive={isDragActive}
      attachedFiles={attachedFiles}
      onRemoveFile={removeAttachedFile}
      attachedProjectFiles={attachedProjectFiles}
      onRemoveProjectFile={removeAttachedProjectFile}
      uploadingFiles={uploadingFiles}
      fileErrors={fileErrors}
      showFileDropdown={showFileDropdown}
      filteredFiles={filteredFiles}
      selectedFileIndex={selectedFileIndex}
      onSelectFile={selectFile}
      filteredCommands={filteredCommands}
      selectedCommandIndex={selectedCommandIndex}
      onCommandSelect={handleCommandSelect}
      onCloseCommandMenu={resetCommandMenuState}
      isCommandMenuOpen={showCommandMenu}
      frequentCommands={commandQuery ? [] : frequentCommands}
      getRootProps={getRootProps as (...args: unknown[]) => Record<string, unknown>}
      getInputProps={getInputProps as (...args: unknown[]) => Record<string, unknown>}
      openFilePicker={openFilePicker}
      inputHighlightRef={inputHighlightRef}
      renderInputWithMentions={renderInputWithMentions}
      textareaRef={textareaRef}
      input={input}
      setInput={setInput}
      onInputChange={handleInputChange}
      onTextareaClick={handleTextareaClick}
      onTextareaKeyDown={handleKeyDown}
      onTextareaPaste={handlePaste}
      onTextareaScrollSync={syncInputOverlayScroll}
      onTextareaInput={handleTextareaInput}
      onInputFocusChange={handleInputFocusChange}
      isInputFocused={isInputFocused}
      placeholder={(() => {
        const fallbackPlaceholder = t('input.placeholder');
        const attachedPromptPlaceholder = attachedPrompt
          ? getAttachedPromptInputPlaceholder(attachedPrompt.promptText)
          : null;
        const placeholderKind = resolveComposerPlaceholderKind({
          hasAttachedPromptPlaceholder: Boolean(attachedPromptPlaceholder),
          isEmpty,
          sessionMode: newSessionMode,
          hasConnectedProjectFolder: isConversationFolderProject(selectedProject),
          hasResearchStage: Boolean(currentResearchStage),
        });
        if (placeholderKind === 'attachedPrompt' && attachedPromptPlaceholder) {
          return attachedPromptPlaceholder;
        }
        if (placeholderKind === 'workspaceQa') {
          return t('session.mode.workspaceQaPlaceholder', {
            defaultValue: 'Ask about any file, module, or implementation detail...',
          });
        }
        if (placeholderKind === 'connectedProject') {
          return t('input.connectedProjectPlaceholder');
        }
        if (placeholderKind === 'researchStage' && currentResearchStage) {
          const stageId = stageIdFromIndex(currentResearchStage);
          const stagePlaceholder = t(`stagePlaceholder.${stageId}`, {
            defaultValue: fallbackPlaceholder,
            provider: getProviderDisplayName(provider),
          });
          return stagePlaceholder || fallbackPlaceholder;
        }
        return fallbackPlaceholder;
      })()}
      isTextareaExpanded={isTextareaExpanded}
      sendByCtrlEnter={sendByCtrlEnter}
      onTranscript={handleTranscript}
      projectName={selectedProject?.name}
      sessionId={selectedSession?.id || currentSessionId}
      onReferenceContext={(context) => {
        setInput((prev) => prev ? `${prev}\n\n${context}` : context);
      }}
      attachedPrompt={attachedPrompt}
      onRemoveAttachedPrompt={() => setAttachedPrompt(null)}
      onUpdateAttachedPrompt={(text) =>
        setAttachedPrompt((prev) => prev
          ? { ...prev, promptText: text, localization: undefined }
          : null)
      }
      setAttachedPrompt={setAttachedPrompt}
      centered={isEmpty}
      setProvider={(nextProvider) => setProvider(nextProvider as Provider)}
      claudeModel={claudeModel}
      setClaudeModel={setClaudeModel}
      codexModel={codexModel}
      setCodexModel={setCodexModel}
      piModel={piModel}
      setPiModel={setPiModel}
      piModelProviderId={piModelProviderId}
      setPiModelProviderId={setPiModelProviderId}
      piModelApi={piModelApi}
      setPiModelApi={setPiModelApi}
      piCatalogRevision={piCatalogRevision}
      setPiCatalogRevision={setPiCatalogRevision}
      providerAvailability={providerAvailability}
      onOpenFolder={isEmpty && (selectedProject?.isDefaultWorkspace || selectedProject?.isConversationWorkspace)
        ? () => setShowFolderConnector(true)
        : undefined}
      workspaceLabel={isEmpty
        && !selectedSession
        && !selectedProject?.isDefaultWorkspace
        && !selectedProject?.isConversationWorkspace
        ? selectedProject?.displayName
        : undefined}
      onRemoveWorkspace={isEmpty && !selectedSession ? onClearConversationFolder : undefined}
    />
  );

  return (
    <>
      <div
        data-chat-layout-root=""
        className={`medical-chat-layout h-full flex min-h-0 ${isMobile ? 'flex-col' : 'flex-row'}`}
      >
        <div className="medical-chat-primary flex min-h-0 min-w-0 flex-1 flex-col">
          <div className={`medical-chat-feed flex min-h-0 flex-1 flex-col ${isEmpty ? 'panel-scroll-area justify-start overflow-y-auto pt-[18vh]' : ''}`}>
            {shouldShowImportedProjectAnalysisPrompt && (
              <div className="mx-auto mt-4 w-full max-w-3xl px-3 sm:px-4">
                <div className="rounded-xl border border-border bg-card/95 shadow-sm px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-4">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">Analyze Imported Project?</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Start a new session to scan this workspace, analyze the project structure and implementation, and summarize next steps.
                      </p>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                      <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2 sm:gap-4">
                        <label className="flex min-w-0 flex-col gap-1.5">
                          <span className="text-xs font-medium text-muted-foreground">Provider</span>
                          <select
                            value={importedProjectAnalysisProvider}
                            onChange={(event) => setImportedProjectAnalysisProvider(event.target.value as Provider)}
                            className="w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                          >
                            {ANALYSIS_PROVIDERS.map(({ id, label }) => {
                              const planLocked = providerAvailability[id]?.planLocked === true;
                              const unavailable = providerAvailability[id]?.cliAvailable === false || planLocked;
                              const piNotConfigured = id === 'pi' && providerAvailability[id]?.configured === false;
                              return (
                                <option key={id} value={id} disabled={unavailable}>
                                  {planLocked
                                    ? `${label} (${t('providerSelection.proOnly')})`
                                    : unavailable
                                      ? `${label} (${t(piNotConfigured ? 'providerSelection.piNotConfigured' : 'providerSelection.notInstalled')})`
                                      : label}
                                </option>
                              );
                            })}
                          </select>
                        </label>

                        <label className="flex min-w-0 flex-col gap-1.5">
                          <span className="text-xs font-medium text-muted-foreground">Model</span>
                          <select
                            value={importedProjectAnalysisModel}
                            onChange={(event) => handleImportedProjectAnalysisModelChange(event.target.value)}
                            disabled={importedProjectAnalysisModels.length === 0}
                            className="w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                          >
                            {importedProjectAnalysisModels.length === 0 && (
                              <option value="">{t('providerSelection.piNotConfigured')}</option>
                            )}
                            {importedProjectAnalysisModels.map(({ value, label }) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="flex gap-2 sm:flex-shrink-0">
                        <Button variant="outline" onClick={handleImportedProjectAnalysisDismiss}>
                          Not Now
                        </Button>
                        <Button
                          onClick={handleImportedProjectAnalysisConfirm}
                          disabled={
                            Boolean(pendingImportedProjectAnalysisSubmit)
                            || !canAnalyzeImportedProject
                          }
                        >
                          Analyze Project
                        </Button>
                      </div>
                    </div>

                    {providerAvailability[importedProjectAnalysisProvider]?.cliAvailable === false && (
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        {providerAvailability[importedProjectAnalysisProvider]?.installHint || 'Selected provider is not installed.'}
                      </p>
                    )}
                    {providerAvailability[importedProjectAnalysisProvider]?.planLocked === true && (
                      <p className="text-xs text-muted-foreground">
                        {t('providerSelection.agentUpgradeHint')}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {chatMessagesPane}
            {chatComposer}
            {selectedProject && isEmpty && newSessionMode === 'research' && !shouldShowImportedProjectAnalysisPrompt && (
              <GuidedPromptStarter
                projectName={selectedProject.name}
                setInput={setInput}
                textareaRef={textareaRef}
                setAttachedPrompt={setAttachedPrompt}
                currentStage={currentResearchStage}
              />
            )}
          </div>
        </div>

        {!isMobile && !detachContextSidebar && (
          <ChatContextSidebar
            selectedProject={selectedProject}
            selectedSession={selectedSession}
            currentSessionId={currentSessionId}
          provider={provider}
          newSessionMode={newSessionMode}
          chatMessages={chatMessages}
          onFileOpen={handleChatFilePreviewOpen}
          onSummarizeMemory={handleSummarizeMemory}
          onStartWorkspaceQa={onStartWorkspaceQa}
          activeSidebarTab={sidebarTab}
          onSidebarTabChange={handleSidebarTabChange}
          onStartTask={handleStartTaskInChat}
          onNavigateAppTab={onNavigateAppTab}
          onLayoutChange={onContextSidebarLayoutChange}
          expandSignal={contextSidebarExpandSignal}
          consultationContent={selectionConsultationSeed && selectedProject ? (
            <SelectionConsultationPanel
              seed={selectionConsultationSeed}
              selectedProject={selectedProject}
              provider={provider}
              claudeModel={claudeModel}
              codexModel={codexModel}
              latestMessage={latestMessage}
              sendMessage={sendMessage}
              onClose={closeSelectionConsultation}
            />
          ) : undefined}
        />
      )}
      </div>

      {messageShareUrl && (
        <MessageShareDialog
          url={messageShareUrl}
          onClose={() => setMessageShareUrl('')}
        />
      )}

      {isRewindConfirmOpen && (
        <RewindConfirmDialog
          onCancel={() => setIsRewindConfirmOpen(false)}
          onConfirm={confirmRewindCurrentChanges}
        />
      )}

      {showFolderConnector && (
        <ProjectCreationWizard
          connectFolderOnly
          onClose={() => setShowFolderConnector(false)}
          onProjectCreated={(project: Project) => {
            setShowFolderConnector(false);
            onStartConversationWithProject?.(project);
            void window.refreshProjects?.();
          }}
        />
      )}

    </>
  );
}

export default React.memo(ChatInterface);
