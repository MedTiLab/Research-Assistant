import { useEffect, useRef } from 'react';
import { applyPiAttachmentDelivery } from '../utils/piAttachmentDelivery';
import { getAgentBrowserSidebarUrl, requestSimpleBrowserSearch } from '../utils/simpleBrowser';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  buildAssistantMessages,
  decodeHtmlEntities,
  formatUsageLimitText,
  unescapeWithMathProtection,
} from '../utils/chatFormatting';
import { parseAskUserAnswers, mergeAnswersIntoToolInput } from '../utils/messageTransforms';
import { mergeFinalAssistantMessages } from '../utils/realtimeMessageMerge';
import { upsertCodexTodoSnapshot } from '../utils/codexTodoList';
import {
  clearPendingSessionId,
  clearSessionAbortRequested,
  clearSessionTimerStart,
  getChatMessagesStorageKey,
  isSessionAbortRequested,
  moveSessionTimerStart,
  persistPendingSessionId,
  persistSessionTimerStart,
  readPendingSessionId,
  readSessionTimerStart,
  safeLocalStorage,
  serializeChatMessagesCache,
} from '../utils/chatStorage';
import i18n from '../../../i18n/config';
import type { ChatMessage, PendingPermissionRequest, QueuedChatTurn, TokenBudget } from '../types/types';
import type { Project, ProjectSession, SessionProvider } from '../../../types/app';
import {
  isCodexInternalNoticeContent,
  isCodexInternalPromptContent,
} from '../../../../shared/codexInternalNotices.js';
import { isResumingStatusText } from '../utils/statusText';
import { canonicalAgentToolName } from '../../../../shared/agentRuntimeEvents.js';
import { isSubagentComplete, subagentStatus } from '../../../../shared/agentToolPresentation.js';
import { applyPiTaskState, discardPiFailedAttempt } from '../utils/piTaskState';
import { piTokenBudget } from '../utils/piTokenBudget';
import { appendStreamingContent, finalizeStreamingContent } from '../utils/streamingMessages';
import { AGENT_WORK_CHANGED, PI_SESSION_STATE } from '../../agent-work/usePiSessionState';
import {
  getCompletionSessionIdentity,
  getTerminalTranscriptIdentity,
  realtimeMessageMatchesView,
  resolveActiveSessionId,
  shouldAdoptCreatedSession,
  shouldAlignViewWithSession,
} from '../utils/sessionRealtimeIdentity';

declare global {
  interface Window {
    __medhelpChatMetrics?: {
      enabled: boolean;
      lastSendAt?: number;
      lastProvider?: SessionProvider;
      lastSessionId?: string | null;
      lastCommandType?: string;
      firstTokenAt?: number;
      serverPhases?: Record<string, {
        timestampMs: number;
        sinceReceivedMs: number;
        sincePreviousMs: number;
      }>;
    };
  }
}

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
  provider?: SessionProvider;
};

type LatestChatMessage = {
  type?: string;
  data?: any;
  sessionId?: string;
  requestId?: string;
  toolName?: string;
  input?: unknown;
  context?: unknown;
  error?: string;
  tool?: string;
  exitCode?: number;
  isProcessing?: boolean;
  actualSessionId?: string;
  [key: string]: any;
};

interface UseChatRealtimeHandlersArgs {
  latestMessage: LatestChatMessage | null;
  provider: SessionProvider;
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  currentSessionId: string | null;
  isLoading: boolean;
  setCurrentSessionId: (sessionId: string | null) => void;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  chatMessagesRef: MutableRefObject<ChatMessage[]>;
  setIsLoading: (loading: boolean) => void;
  setCanAbortSession: (canAbort: boolean) => void;
  setClaudeStatus: Dispatch<SetStateAction<{ text: string; tokens: number; can_interrupt: boolean; startTime?: number } | null>>;
  setStatusTextOverride: Dispatch<SetStateAction<string | null>>;
  setTokenBudget: (budget: TokenBudget | null) => void;
  setIsSystemSessionChange: (isSystemSessionChange: boolean) => void;
  setPendingPermissionRequests: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  onPiPermissionModeChange?: (mode: 'ask' | 'plan') => void;
  setQueuedTurns: Dispatch<SetStateAction<QueuedChatTurn[]>>;
  pendingViewSessionRef: MutableRefObject<PendingViewSession | null>;
  streamBufferRef: MutableRefObject<string>;
  streamTimerRef: MutableRefObject<number | null>;
  onSessionInactive?: (sessionId?: string | null) => void;
  onSessionProcessing?: (sessionId?: string | null) => void;
  onSessionNotProcessing?: (sessionId?: string | null) => void;
  onSessionStatusResolved?: (sessionId?: string | null, isProcessing?: boolean) => void;
  onReplaceTemporarySession?: (sessionId?: string | null) => void;
  onNavigateToSession?: (
    sessionId: string,
    sessionProvider?: SessionProvider,
    targetProjectName?: string,
  ) => void;
  requestTranscriptReconcile: (request: {
    projectName?: string | null;
    sessionId?: string | null;
    provider?: SessionProvider | null;
  }) => void;
}

const isCodexStartupDiagnosticContent = (text: unknown): boolean => {
  const normalizedText = typeof text === 'string' ? text.trim() : '';
  if (!normalizedText) {
    return false;
  }
  if (isCodexInternalNoticeContent(normalizedText)) {
    return true;
  }
  if (isCodexInternalPromptContent(normalizedText)) {
    return true;
  }

  const lines = normalizedText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const diagnosticPatterns = [
    /^⚠\s*Skipped loading .*invalid SKILL\.md files?/i,
    /^⚠\s*\/.*SKILL\.md:\s*invalid YAML:/i,
    /^⚠\s*MCP client for .* failed to start:/i,
    /^⚠\s*The figma MCP server is not logged in\./i,
    /^⚠\s*Heads up, you have less than \d+% of your .* limit left\./i,
    /^•\s*Starting MCP servers/i,
  ];

  const matchedDiagnosticLines = lines.reduce((count, line) => (
    diagnosticPatterns.some((pattern) => pattern.test(line)) ? count + 1 : count
  ), 0);

  return matchedDiagnosticLines >= 2 || /^•\s*Starting MCP servers/i.test(normalizedText);
};

const appendStreamingChunk = (
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  chunk: string,
  newline = false,
  piMessageId?: string,
) => {
  if (!chunk) {
    return;
  }

  setChatMessages((previous) => appendStreamingContent(previous, chunk, newline, piMessageId));
};

const finalizeStreamingMessage = (setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>, piMessageId?: string) => {
  setChatMessages((previous) => finalizeStreamingContent(previous, piMessageId));
};

const isLegacyTaskMasterInstallError = (value: unknown): boolean => {
  const normalized = String(value || '').toLowerCase();
  if (!normalized.includes('taskmaster')) {
    return false;
  }

  return normalized.includes('not installed') || normalized.includes('not configured');
};

export function useChatRealtimeHandlers({
  latestMessage,
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
  onPiPermissionModeChange,
  setQueuedTurns,
  pendingViewSessionRef,
  streamBufferRef,
  streamTimerRef,
  onSessionInactive,
  onSessionProcessing,
  onSessionNotProcessing,
  onSessionStatusResolved,
  onReplaceTemporarySession,
  onNavigateToSession,
  requestTranscriptReconcile,
}: UseChatRealtimeHandlersArgs) {
  const lastProcessedMessageRef = useRef<LatestChatMessage | null>(null);
  const firstTokenLoggedRef = useRef<number | null>(null);
  const promotedSessionIdsRef = useRef(new Map<string, string>());
  const piStreamMessageIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (provider !== 'pi') return;
    const update = (event: Event) => {
      const { projectName, sessionId, state } = (event as CustomEvent).detail || {};
      if (projectName !== selectedProject?.name || sessionId !== (selectedSession?.id || currentSessionId)) return;
      if (Array.isArray(state?.tasks)) setChatMessages((previous) => applyPiTaskState(previous, state.tasks));
    };
    window.addEventListener(PI_SESSION_STATE, update);
    return () => window.removeEventListener(PI_SESSION_STATE, update);
  }, [provider, selectedProject?.name, selectedSession?.id, currentSessionId, setChatMessages]);

  // Helper: Handle structured assistant content
  const handleStructuredAssistantMessage = (structuredData: any, rawData: any) => {
    // New assistant message = previous tool execution done; clear override.
    // If this message contains a new Bash tool_use, it will be re-set below (React batches both updates).
    setStatusTextOverride(null);

    const parentToolUseId = rawData?.parentToolUseId;
    const newMessages: any[] = [];
    const childToolUpdates: { parentId: string; child: any }[] = [];

    structuredData.content.forEach((part: any) => {
      if (part.type === 'thinking' || part.type === 'reasoning') {
        const thinkingText = part.thinking || part.reasoning || part.text || '';
        if (thinkingText.trim()) {
          newMessages.push({
            type: 'assistant',
            content: unescapeWithMathProtection(thinkingText),
            timestamp: new Date(),
            isThinking: true,
            isStreaming: true,
          });
        }
        return;
      }

      if (part.type === 'tool_use') {
        if (['Bash', 'run_shell_command'].includes(part.name)) {
          // Set running code status when command starts
          setStatusTextOverride(i18n.t('chat:status.runningCode'));
        }
        const toolInput = part.input ? JSON.stringify(part.input, null, 2) : '';

        if (parentToolUseId) {
          childToolUpdates.push({
            parentId: parentToolUseId,
            child: {
              toolId: part.id,
              toolName: part.name,
              toolInput: part.input,
              toolResult: null,
              timestamp: new Date(),
            },
          });
          return;
        }

        const isSubagentContainer = canonicalAgentToolName(part.name) === 'Task';
        newMessages.push({
          type: 'assistant',
          content: '',
          timestamp: new Date(),
          isToolUse: true,
          toolName: canonicalAgentToolName(part.name),
          toolInput,
          toolId: part.id,
          toolResult: null,
          isSubagentContainer,
          subagentState: isSubagentContainer
            ? { childTools: [], currentToolIndex: -1, isComplete: false }
            : undefined,
        });
        return;
      }

      if (part.type === 'text' && part.text?.trim()) {
        let content = decodeHtmlEntities(part.text);
        content = formatUsageLimitText(content);
        newMessages.push(...buildAssistantMessages(content, new Date()));
      }
    });

    if (newMessages.length > 0 || childToolUpdates.length > 0) {
      setChatMessages((previous) => {
        let updated = previous;
        if (childToolUpdates.length > 0) {
          updated = updated.map((message) => {
            if (!message.isSubagentContainer) return message;
            const updates = childToolUpdates.filter((u) => u.parentId === message.toolId);
            if (updates.length === 0) return message;
            const existingChildren = message.subagentState?.childTools || [];
            const newChildren = updates.map((u) => u.child);
            return {
              ...message,
              subagentState: {
                childTools: [...existingChildren, ...newChildren],
                currentToolIndex: existingChildren.length + newChildren.length - 1,
                isComplete: false,
              },
            };
          });
        }
        if (newMessages.length > 0) {
          // The final SDK envelope can race the last buffered delta. Reconcile
          // it with the active stream instead of rendering a second answer.
          updated = mergeFinalAssistantMessages(updated, newMessages);
        }
        return updated;
      });
    }
  };

  // Helper: Handle simple text assistant message
  const handleSimpleAssistantMessage = (structuredData: any) => {
    let content = decodeHtmlEntities(structuredData.content);
    content = formatUsageLimitText(content);

    setChatMessages((previous) => mergeFinalAssistantMessages(
      previous,
      buildAssistantMessages(content, new Date()),
    ));
  };

  // Helper: Handle user tool results
  const handleUserToolResults = (structuredData: any, rawData: any) => {
    const parentToolUseId = rawData?.parentToolUseId;
    const toolResults = structuredData.content.filter((part: any) => part.type === 'tool_result');
    const textParts = structuredData.content.filter((part: any) => part.type === 'text');

    if (textParts.length > 0) {
      const textContent = textParts.map((p: any) => p.text || '').join('\n');
      const isSkillText =
        textContent.includes('Base directory for this skill:') ||
        textContent.startsWith('<command-name>') ||
        textContent.startsWith('<command-message>') ||
        textContent.startsWith('<command-args>') ||
        textContent.startsWith('<local-command-stdout>') ||
        (toolResults.length > 0 && !textContent.startsWith('<system-reminder>'));
      if (isSkillText && textContent.trim()) {
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'user',
            content: textContent,
            timestamp: new Date(),
            isSkillContent: true,
          },
        ]);
      }
    }

    if (toolResults.length > 0) {
      // Reset "running code" status when tool results arrive (tool execution finished)
      setStatusTextOverride(null);

      setChatMessages((previous) =>
        previous.map((message) => {
          for (const part of toolResults) {
            if (parentToolUseId && message.toolId === parentToolUseId && message.isSubagentContainer) {
              const updatedChildren = message.subagentState!.childTools.map((child: any) => {
                if (child.toolId === part.tool_use_id) {
                  return {
                    ...child,
                    toolResult: {
                      content: part.content,
                      isError: part.is_error,
                      timestamp: new Date(),
                    },
                  };
                }
                return child;
              });
              if (updatedChildren !== message.subagentState!.childTools) {
                return {
                  ...message,
                  subagentState: {
                    ...message.subagentState!,
                    childTools: updatedChildren,
                  },
                };
              }
            }

            if (message.isToolUse && message.toolId === part.tool_use_id) {
              const result: any = {
                ...message,
                toolResult: {
                  content: part.content,
                  isError: part.is_error,
                  timestamp: new Date(),
                },
              };
              if (message.toolName === 'AskUserQuestion' && part.content) {
                const resultStr = typeof part.content === 'string' ? part.content : JSON.stringify(part.content);
                const parsedAnswers = parseAskUserAnswers(resultStr);
                if (parsedAnswers) {
                  result.toolInput = mergeAnswersIntoToolInput(String(message.toolInput || '{}'), parsedAnswers);
                }
              }
              if (message.isSubagentContainer && message.subagentState) {
                result.subagentState = {
                  ...message.subagentState,
                  isComplete: isSubagentComplete(result.toolResult),
                  status: subagentStatus(result.toolResult),
                };
              }
              return result;
            }
          }
          return message;
        }),
      );
    }
  };

  useEffect(() => {
    if (!latestMessage) {
      return;
    }

    if (lastProcessedMessageRef.current === latestMessage) {
      return;
    }
    lastProcessedMessageRef.current = latestMessage;

    // Consultation sessions are rendered by the isolated right-side panel.
    // Never let their global session-created event navigate or mutate the main chat.
    if (latestMessage.type === 'session-created' && latestMessage.mode === 'consultation') {
      return;
    }

    // Message unwrapping rules:
    // - For streaming events (content_block_delta/stop/...), keep the top-level envelope.
    // - For SDK "assistant/result" wrappers that contain a Claude-formatted `.message`, unwrap to `.message`
    //   so the existing rendering paths (role/content) work.
    const rawData = latestMessage.data;
    const rawType =
      rawData && typeof rawData === 'object' && typeof (rawData as any).type === 'string'
        ? String((rawData as any).type)
        : null;
    const isStreamingEnvelope = rawType
      ? [
          'content_block_start',
          'content_block_delta',
          'content_block_stop',
          'message_start',
          'message_delta',
          'message_stop',
          'system',
        ].includes(rawType)
      : false;
    const messageData =
      !isStreamingEnvelope &&
      rawData &&
      typeof rawData === 'object' &&
      (rawType === 'assistant' || rawType === 'result' || rawType === 'user') &&
      (rawData as any).message
        ? (rawData as any).message
        : rawData?.message || rawData;
    const structuredMessageData =
      messageData && typeof messageData === 'object' ? (messageData as Record<string, any>) : null;
    const rawStructuredData =
      latestMessage.data && typeof latestMessage.data === 'object'
        ? (latestMessage.data as Record<string, any>)
        : null;

    const globalMessageTypes = [
      'projects_updated',
      'taskmaster-project-updated',
      'project-memory-updated',
      'session-created',
      'agent-turn-metric',
    ];
    const isGlobalMessage = globalMessageTypes.includes(String(latestMessage.type));
    const lifecycleMessageTypes = new Set([
      'claude-complete',
      'codex-complete',
      'pi-complete',
      'localgpu-complete',
      'session-aborted',
      'claude-error',
      'codex-error',
      'pi-error',
      'localgpu-error',
    ]);

    const isClaudeSystemInit =
      latestMessage.type === 'claude-response' &&
      structuredMessageData &&
      structuredMessageData.type === 'system' &&
      structuredMessageData.subtype === 'init';

    const systemInitSessionId = isClaudeSystemInit
      ? structuredMessageData?.session_id
      : null;

    const activeViewSessionId = resolveActiveSessionId({
      // A provider may emit an inner turn_complete before the outer completion
      // envelope. Keep the live id authoritative for that terminal envelope
      // even if the inner event has already cleared the loading flag.
      isProcessing: isLoading || lifecycleMessageTypes.has(String(latestMessage.type)),
      currentSessionId,
      selectedSessionId: selectedSession?.id,
      pendingSessionId: pendingViewSessionRef.current?.sessionId,
      promotedSessionIds: promotedSessionIdsRef.current,
    });
    const activeViewProvider = (
      selectedSession?.__provider
      || pendingViewSessionRef.current?.provider
      || provider
    ) as SessionProvider;
    const terminalTranscriptIdentity = getTerminalTranscriptIdentity(latestMessage, {
      currentSessionId,
      selectedSessionId: selectedSession?.id,
      pendingSessionId: pendingViewSessionRef.current?.sessionId,
      fallbackProvider: provider,
    });
    const isSystemInitForView =
      systemInitSessionId && (!activeViewSessionId || systemInitSessionId === activeViewSessionId);
    const shouldBypassSessionFilter = isGlobalMessage || Boolean(isSystemInitForView);
    const isUnscopedError =
      !latestMessage.sessionId &&
      pendingViewSessionRef.current &&
      !pendingViewSessionRef.current.sessionId &&
      (latestMessage.type === 'claude-error' ||
        latestMessage.type === 'codex-error' ||
        latestMessage.type === 'pi-error');

    const handleBackgroundLifecycle = (sessionId?: string) => {
      if (!sessionId) {
        return;
      }
      clearSessionTimerStart(sessionId);
      onSessionInactive?.(sessionId);
      onSessionNotProcessing?.(sessionId);
      onSessionStatusResolved?.(sessionId, false);
    };

    const persistStartTime = (startTime?: number | null, ...sessionIds: Array<string | null | undefined>) => {
      if (!Number.isFinite(startTime)) {
        return;
      }

      const targetSessionId = sessionIds.find((sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.length > 0);
      if (!targetSessionId) {
        return;
      }

      persistSessionTimerStart(targetSessionId, startTime);
    };

    const syncClaudeStatusStartTime = (startTime?: number | null, fallbackText = 'Processing') => {
      if (!Number.isFinite(startTime)) {
        return;
      }

      const normalizedStartTime = startTime as number;

      setClaudeStatus((prev) => ({
        // A live provider event proves that reconnect/resume has completed.
        text: !prev?.text || isResumingStatusText(prev.text) ? fallbackText : prev.text,
        tokens: prev?.tokens || 0,
        can_interrupt: prev?.can_interrupt !== undefined ? prev.can_interrupt : true,
        startTime: normalizedStartTime,
      }));
    };

    const clearLoadingIndicators = () => {
      setIsLoading(false);
      setCanAbortSession(false);
      setClaudeStatus(null);
      setStatusTextOverride(null);
    };

    const flushAndFinalizePendingStream = () => {
      if (streamTimerRef.current) {
        clearTimeout(streamTimerRef.current);
        streamTimerRef.current = null;
      }
      const chunk = streamBufferRef.current;
      streamBufferRef.current = '';
      appendStreamingChunk(setChatMessages, chunk, false, provider === 'pi' ? piStreamMessageIdRef.current : undefined);
      finalizeStreamingMessage(setChatMessages, provider === 'pi' ? piStreamMessageIdRef.current : undefined);
    };

    const markSessionsAsCompleted = (...sessionIds: Array<string | null | undefined>) => {
      const normalizedSessionIds = sessionIds.filter((id): id is string => typeof id === 'string' && id.length > 0);
      normalizedSessionIds.forEach((sessionId) => {
        clearSessionTimerStart(sessionId);
        onSessionInactive?.(sessionId);
        onSessionNotProcessing?.(sessionId);
        onSessionStatusResolved?.(sessionId, false);
      });
    };

    const persistLiveTranscriptForSession = (
      sessionId: string,
      sessionProvider: SessionProvider,
      projectName?: string,
    ) => {
      const targetProjectName = projectName || selectedProject?.name;
      if (!targetProjectName || chatMessagesRef.current.length === 0) {
        return;
      }
      const identity = {
        projectName: targetProjectName,
        sessionId,
        provider: sessionProvider,
      };
      safeLocalStorage.setItem(
        getChatMessagesStorageKey(identity),
        serializeChatMessagesCache(identity, chatMessagesRef.current),
      );
    };

    const alignViewWithSession = (
      sessionId: string | null | undefined,
      sessionProvider: SessionProvider,
      projectName?: string,
    ) => {
      if (!sessionId) return;
      if (!shouldAlignViewWithSession({
        targetSessionId: sessionId,
        currentSessionId,
        selectedSessionId: selectedSession?.id,
        pendingSessionId: pendingViewSessionRef.current?.sessionId,
        promotedSessionIds: promotedSessionIdsRef.current,
      })) {
        return;
      }

      // A session ID change may remount the view. Make the current live
      // transcript recoverable under the destination identity before navigation.
      persistLiveTranscriptForSession(sessionId, sessionProvider, projectName);

      if (currentSessionId !== sessionId) {
        setCurrentSessionId(sessionId);
      }
      if (
        selectedSession?.id !== sessionId
        || selectedSession.__provider !== sessionProvider
      ) {
        setIsSystemSessionChange(true);
        onNavigateToSession?.(
          sessionId,
          sessionProvider,
          projectName || selectedProject?.name,
        );
      }
    };

    const alignViewWithCompletedSession = (projectName?: string) => {
      const completedIdentity = getCompletionSessionIdentity(latestMessage);
      if (!completedIdentity) return;
      alignViewWithSession(completedIdentity.sessionId, completedIdentity.provider, projectName);
    };

    const reconcileTerminalTranscript = (
      sessionId: string | null | undefined,
      sessionProvider: SessionProvider,
      projectName?: string,
    ) => {
      requestTranscriptReconcile({
        projectName: projectName || selectedProject?.name,
        sessionId,
        provider: sessionProvider,
      });
    };

    if (!shouldBypassSessionFilter) {
      if (!activeViewSessionId) {
        if (latestMessage.sessionId && lifecycleMessageTypes.has(String(latestMessage.type))) {
          handleBackgroundLifecycle(latestMessage.sessionId);
        }
        if (!isUnscopedError) {
          return;
        }
      }

      if (!latestMessage.sessionId && !isUnscopedError) {
        return;
      }

      if (!realtimeMessageMatchesView(latestMessage, {
        activeSessionId: activeViewSessionId,
        activeProvider: activeViewProvider,
        activeProjectKey: selectedProject?.name,
        promotedSessionIds: promotedSessionIdsRef.current,
      })) {
        if (latestMessage.sessionId && lifecycleMessageTypes.has(String(latestMessage.type))) {
          handleBackgroundLifecycle(latestMessage.sessionId);
        }
        return;
      }
    }

    const suppressWhileAbortRequestedTypes = new Set([
      'claude-response',
      'claude-output',
      'localgpu-response',
      'codex-response',
      'pi-response',
      'claude-status',
    ]);
    const isAbortRequestedForMessageSession = isSessionAbortRequested(latestMessage.sessionId || null);
    if (isAbortRequestedForMessageSession && suppressWhileAbortRequestedTypes.has(String(latestMessage.type))) {
      return;
    }

    switch (latestMessage.type) {
      case 'session-created':
        if (latestMessage.sessionId) {
          const createdSessionId = latestMessage.sessionId;
          const previousSessionId =
            typeof latestMessage.previousSessionId === 'string' && latestMessage.previousSessionId.trim()
              ? latestMessage.previousSessionId
              : null;
          const shouldAdoptCreatedSessionEvent = shouldAdoptCreatedSession({
            currentSessionId,
            selectedSessionId: selectedSession?.id,
            pendingSessionId: pendingViewSessionRef.current?.sessionId,
            previousSessionId,
            hasPendingView: Boolean(pendingViewSessionRef.current),
          });

          if (!shouldAdoptCreatedSessionEvent) {
            break;
          }

          const createdSessionProvider =
            (latestMessage.provider as SessionProvider | undefined) || provider;
          const pendingStartTime = pendingViewSessionRef.current?.startedAt;
          const temporarySessionId = currentSessionId?.startsWith('new-session-') ? currentSessionId : null;
          const pendingTemporarySessionId = pendingViewSessionRef.current?.sessionId?.startsWith('new-session-')
            ? pendingViewSessionRef.current.sessionId
            : null;
          [temporarySessionId, pendingTemporarySessionId, previousSessionId]
            .filter((sessionId): sessionId is string => Boolean(sessionId))
            .forEach((sessionId) => promotedSessionIdsRef.current.set(sessionId, createdSessionId));
          if (temporarySessionId) {
            moveSessionTimerStart(temporarySessionId, createdSessionId);
          }
          if (previousSessionId && previousSessionId !== createdSessionId) {
            moveSessionTimerStart(previousSessionId, createdSessionId);
            onSessionInactive?.(previousSessionId);
            onSessionNotProcessing?.(previousSessionId);
            onSessionStatusResolved?.(previousSessionId, false);
          }
          persistStartTime(
            typeof latestMessage.startTime === 'number' ? latestMessage.startTime : pendingStartTime,
            createdSessionId,
          );
          const createdProjectName =
            typeof latestMessage.projectName === 'string' && latestMessage.projectName.trim()
              ? latestMessage.projectName
              : selectedProject?.name;

          // Navigation can remount the chat view when a draft receives its real
          // provider ID. Seed that real-session cache first so the optimistic user
          // bubble survives even if React cannot preserve the component instance.
          persistLiveTranscriptForSession(
            createdSessionId,
            createdSessionProvider,
            createdProjectName,
          );

          if (createdProjectName && latestMessage.mode && createdSessionId) {
            safeLocalStorage.setItem(`session_mode_${createdProjectName}_${createdSessionId}`, String(latestMessage.mode));
          }
          persistPendingSessionId(createdSessionProvider, createdSessionId);
          setCurrentSessionId(createdSessionId);
          if (
            pendingViewSessionRef.current
            && (
              !pendingViewSessionRef.current.sessionId
              || pendingViewSessionRef.current.sessionId === temporarySessionId
              || pendingViewSessionRef.current.sessionId === pendingTemporarySessionId
              || pendingViewSessionRef.current.sessionId === previousSessionId
            )
          ) {
            pendingViewSessionRef.current.sessionId = createdSessionId;
          }
          setIsSystemSessionChange(true);
          onReplaceTemporarySession?.(createdSessionId);
          onNavigateToSession?.(createdSessionId, createdSessionProvider, createdProjectName);
          setPendingPermissionRequests((previous) =>
            previous.map((request) =>
              request.sessionId ? request : { ...request, sessionId: createdSessionId },
            ),
          );
        }
        break;

      case 'token-budget':
        if (latestMessage.data) {
          setTokenBudget(latestMessage.data);
        }
        break;

      case 'agent-turn-steered': {
        const steeredItem = latestMessage.item;
        if (steeredItem?.id && steeredItem?.content) {
          setChatMessages((previous) => previous.some((message) => message.messageId === steeredItem.id)
            ? previous
            : [
                ...previous,
                {
                  type: 'user',
                  content: String(steeredItem.content),
                  isOptimistic: true,
                  messageId: String(steeredItem.id),
                  attachments: Array.isArray(steeredItem.attachments) && steeredItem.attachments.length > 0
                    ? steeredItem.attachments
                    : undefined,
                  timestamp: Number.isFinite(steeredItem.createdAt) ? steeredItem.createdAt : Date.now(),
                },
              ]);
        }
        setStatusTextOverride(i18n.t('chat:steer.accepted'));
        setIsLoading(true);
        setCanAbortSession(true);
        onSessionProcessing?.(latestMessage.sessionId || currentSessionId || selectedSession?.id);
        break;
      }

      case 'agent-turn-steer-error':
        setChatMessages((previous) => [
          ...previous,
          {
            type: 'error',
            content: latestMessage.error || i18n.t('chat:steer.failed'),
            timestamp: new Date(),
            isRetryable: true,
          },
        ]);
        break;

      case 'agent-turn-queue-updated': {
        const items = Array.isArray(latestMessage.items) ? latestMessage.items : [];
        setQueuedTurns(items.map((item: any) => ({
          id: String(item.id),
          content: String(item.content || ''),
          attachments: Array.isArray(item.attachments) ? item.attachments : [],
          createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
        })));
        break;
      }

      case 'agent-turn-queue-started': {
        const startedItem = latestMessage.item;
        const remaining = Array.isArray(latestMessage.remaining) ? latestMessage.remaining : [];
        setQueuedTurns(remaining.map((item: any) => ({
          id: String(item.id),
          content: String(item.content || ''),
          attachments: Array.isArray(item.attachments) ? item.attachments : [],
          createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
        })));
        if (startedItem?.id && startedItem?.content) {
          setChatMessages((previous) => previous.some((message) => message.messageId === startedItem.id)
            ? previous
            : [
                ...previous,
                {
                  type: 'user',
                  content: String(startedItem.content),
                  isOptimistic: true,
                  messageId: String(startedItem.id),
                  attachments: Array.isArray(startedItem.attachments) && startedItem.attachments.length > 0
                    ? startedItem.attachments
                    : undefined,
                  timestamp: Number.isFinite(startedItem.createdAt) ? startedItem.createdAt : Date.now(),
                },
              ]);
        }
        const queuedSessionId = latestMessage.sessionId || currentSessionId || selectedSession?.id;
        const queuedStartTime = Date.now();
        persistStartTime(queuedStartTime, queuedSessionId);
        setIsLoading(true);
        setCanAbortSession(true);
        setClaudeStatus({ text: 'Processing', tokens: 0, can_interrupt: true, startTime: queuedStartTime });
        onSessionProcessing?.(queuedSessionId);
        onSessionStatusResolved?.(queuedSessionId, true);
        break;
      }

      case 'agent-turn-metric': {
        if (typeof window === 'undefined') break;
        const metrics = window.__medhelpChatMetrics;
        const metric = latestMessage.data;
        if (!metrics?.enabled || !metric?.phase) break;
        if (metrics.lastProvider && metric.provider && metrics.lastProvider !== metric.provider) break;
        metrics.serverPhases = {
          ...(metrics.serverPhases || {}),
          [metric.phase]: {
            timestampMs: Number(metric.timestampMs) || Date.now(),
            sinceReceivedMs: Number(metric.sinceReceivedMs) || 0,
            sincePreviousMs: Number(metric.sincePreviousMs) || 0,
          },
        };
        if (metric.phase === 'first_text') {
          const shouldCaptureBrowserReceipt = (
            typeof metrics.lastSendAt === 'number'
            && firstTokenLoggedRef.current !== metrics.lastSendAt
          );
          if (shouldCaptureBrowserReceipt) {
            metrics.firstTokenAt = performance.now();
            firstTokenLoggedRef.current = metrics.lastSendAt ?? null;
          }
          const browserLatency = (
            typeof metrics.lastSendAt === 'number'
            && typeof metrics.firstTokenAt === 'number'
          )
            ? `${Math.round(metrics.firstTokenAt - metrics.lastSendAt)}ms`
            : 'n/a';
          // eslint-disable-next-line no-console
          console.log(
            `[Chat metrics] ${metric.provider || 'agent'} send→firstText=${browserLatency}; `
            + `server received→firstText=${Math.round(metric.sinceReceivedMs || 0)}ms`,
          );
        }
        if (metric.phase === 'completed') {
          // eslint-disable-next-line no-console
          console.log('[Chat metrics] server phase timeline', metrics.serverPhases);
        }
        break;
      }

      case 'claude-response': {
        if (messageData && typeof messageData === 'object' && messageData.type) {
          if (Number.isFinite(messageData.startTime)) {
            persistStartTime(messageData.startTime, latestMessage.sessionId, currentSessionId, selectedSession?.id);
            syncClaudeStatusStartTime(messageData.startTime);
          }
          if (messageData.type === 'content_block_delta' && messageData.delta?.text) {
            if (typeof window !== 'undefined') {
              const metrics = window.__medhelpChatMetrics;
              if (
                metrics?.enabled
                && typeof metrics.lastSendAt === 'number'
                && firstTokenLoggedRef.current !== metrics.lastSendAt
              ) {
                const now = performance.now();
                metrics.firstTokenAt = now;
                firstTokenLoggedRef.current = metrics.lastSendAt;
                // eslint-disable-next-line no-console
                console.log(`[Chat metrics] send→firstToken=${Math.round(now - metrics.lastSendAt)}ms (claude-response delta)`);
              }
            }
            setIsLoading(true);
            setStatusTextOverride(null);
            const decodedText = decodeHtmlEntities(messageData.delta.text);
            streamBufferRef.current += decodedText;
            if (!streamTimerRef.current) {
              streamTimerRef.current = window.setTimeout(() => {
                const chunk = streamBufferRef.current;
                streamBufferRef.current = '';
                streamTimerRef.current = null;
                appendStreamingChunk(setChatMessages, chunk, false);
              }, 16);
            }
            return;
          }
          if (
            messageData.type === 'content_block_delta'
            && (messageData.delta?.thinking || messageData.delta?.type === 'thinking_delta')
          ) {
            setIsLoading(true);
            setStatusTextOverride(i18n.t('chat:status.reasoning'));
            return;
          }
          if (messageData.type === 'content_block_stop') {
            if (streamTimerRef.current) {
              clearTimeout(streamTimerRef.current);
              streamTimerRef.current = null;
            }
            const chunk = streamBufferRef.current;
            streamBufferRef.current = '';
            appendStreamingChunk(setChatMessages, chunk, false);
            finalizeStreamingMessage(setChatMessages);
            return;
          }
        }

        if (isClaudeSystemInit && structuredMessageData?.session_id && isSystemInitForView) {
          if (!currentSessionId || structuredMessageData.session_id !== currentSessionId) {
            console.log('Claude CLI session duplication or new init detected');
            setIsSystemSessionChange(true);
            onNavigateToSession?.(structuredMessageData.session_id, 'claude', selectedProject?.name);
            return;
          }
        }

        if (structuredMessageData && Array.isArray(structuredMessageData.content) && structuredMessageData.role === 'assistant') {
          // The final SDK envelope is authoritative. Drain and cancel the 30ms
          // delta buffer first so a trailing timer cannot append a transient
          // second copy after the final message has already been reconciled.
          flushAndFinalizePendingStream();
          handleStructuredAssistantMessage(structuredMessageData, rawStructuredData);
        } else if (structuredMessageData && structuredMessageData.role === 'assistant' && typeof structuredMessageData.content === 'string' && structuredMessageData.content.trim()) {
          flushAndFinalizePendingStream();
          handleSimpleAssistantMessage(structuredMessageData);
        }

        if (structuredMessageData?.role === 'user' && Array.isArray(structuredMessageData.content)) {
          handleUserToolResults(structuredMessageData, rawStructuredData);
        }

        // Claude's SDK result is itself a terminal signal. The outer
        // claude-complete envelope can be lost if the local socket is replaced
        // between these two events, so reconcile the persisted transcript now.
        if (rawType === 'result') {
          const completedSessionId = terminalTranscriptIdentity?.sessionId
            || latestMessage.sessionId
            || currentSessionId
            || selectedSession?.id;
          flushAndFinalizePendingStream();
          clearLoadingIndicators();
          markSessionsAsCompleted(completedSessionId, currentSessionId, selectedSession?.id);
          alignViewWithSession(completedSessionId, 'claude', selectedProject?.name);
          reconcileTerminalTranscript(completedSessionId, 'claude', selectedProject?.name);
        }
        break;
      }

      case 'pi-response': {
        const piEnvelope = latestMessage.data;
        const piEvent = piEnvelope?.event;
        const piData = piEnvelope?.data || {};
        if (!piEvent) break;
        if (piEvent === 'attachment_delivery') {
          setChatMessages((previous) => applyPiAttachmentDelivery(previous, piData.attachments));
          return;
        }
        if (piEvent === 'assistant_message_start') {
          flushAndFinalizePendingStream();
          piStreamMessageIdRef.current = piData.messageId;
          return;
        }
        if (['todo_snapshot', 'task_created', 'task_updated', 'artifact_created', 'context_item_added', 'plan_updated', 'tool_completed'].includes(piEvent)) {
          window.dispatchEvent(new Event(AGENT_WORK_CHANGED));
        }
        if (piEvent === 'auto_retry_start') {
          if (streamTimerRef.current) window.clearTimeout(streamTimerRef.current);
          streamTimerRef.current = null; streamBufferRef.current = '';
          setChatMessages((previous) => discardPiFailedAttempt(previous, piData.messageId));
          setStatusTextOverride(i18n.language.startsWith('zh') ? `正在重试 ${piData.attempt || 1}/${piData.maxAttempts || '?'}…` : `Retrying ${piData.attempt || 1}/${piData.maxAttempts || '?'}…`);
          return;
        }
        if (piEvent === 'auto_compaction_start') {
          setStatusTextOverride(i18n.language.startsWith('zh') ? '正在压缩上下文…' : 'Compacting context…');
          return;
        }
        if (piEvent === 'auto_retry_end' || piEvent === 'auto_compaction_end') {
          setStatusTextOverride(piData.success === false ? (piData.error || (i18n.language.startsWith('zh') ? '操作未完成' : 'Operation did not complete')) : null);
          if (piData.context) setTokenBudget({ used: piData.context.tokens, total: piData.context.contextWindow, estimated: Boolean(piData.context.estimated) });
          return;
        }
        if (piEvent === 'tool_updated') {
          setChatMessages((previous) => previous.map((message) => message.isToolUse && message.toolId === piData.toolCallId
            ? { ...message, toolResult: { content: piData.output, streaming: true } } : message));
          return;
        }
        if (piEvent === 'permission_mode_changed' && piData.permissionMode === 'ask') {
          onPiPermissionModeChange?.('ask');
          return;
        }
        if (piEvent === 'plan_mode_entered') {
          onPiPermissionModeChange?.('plan');
          return;
        }

        if (piEvent === 'text_delta' && typeof piData.text === 'string') {
          piStreamMessageIdRef.current = piData.messageId;
          setIsLoading(true);
          setCanAbortSession(true);
          setStatusTextOverride(null);
          streamBufferRef.current += decodeHtmlEntities(piData.text);
          if (!streamTimerRef.current) {
            streamTimerRef.current = window.setTimeout(() => {
              const chunk = streamBufferRef.current;
              streamBufferRef.current = '';
              streamTimerRef.current = null;
              appendStreamingChunk(setChatMessages, chunk, false, piData.messageId);
            }, 16);
          }
          return;
        }
        if (piEvent === 'thinking_delta') {
          setIsLoading(true);
          setStatusTextOverride(i18n.t('chat:status.reasoning'));
          if (typeof piData.text === 'string' && piData.text) {
            setChatMessages((previous) => {
              const updated = [...previous];
              const last = updated[updated.length - 1];
              if (last?.isThinking && last?.isStreaming) {
                updated[updated.length - 1] = {
                  ...last,
                  content: `${last.content || ''}${decodeHtmlEntities(piData.text)}`,
                  piMessageId: piData.messageId,
                };
              } else {
                updated.push({
                  type: 'assistant',
                  content: decodeHtmlEntities(piData.text),
                  piMessageId: piData.messageId,
                  timestamp: new Date(),
                  isThinking: true,
                  isStreaming: true,
                });
              }
              return updated;
            });
          }
          return;
        }
        if (piEvent === 'tool_started') {
          flushAndFinalizePendingStream();
          setStatusTextOverride(i18n.t('chat:status.processing'));
          const isSubagentContainer = canonicalAgentToolName(piData.toolName) === 'Task';
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'assistant',
              content: '',
              timestamp: new Date(),
              isToolUse: true,
              toolName: canonicalAgentToolName(piData.toolName) || 'Read',
              toolInput: piData.input || {},
              nativeToolName: piData.nativeToolName || piData.toolName,
              nativeToolInput: piData.nativeToolInput || piData.input,
              toolId: piData.toolCallId,
              toolCallId: piData.toolCallId,
              toolResult: null,
              isSubagentContainer,
              subagentState: isSubagentContainer
                ? { childTools: [], currentToolIndex: -1, isComplete: false }
                : undefined,
            },
          ]);
          return;
        }
        if (piEvent === 'tool_completed') {
          const sidebarUrl = getAgentBrowserSidebarUrl(piData);
          if (sidebarUrl) requestSimpleBrowserSearch(sidebarUrl);
          setStatusTextOverride(null);
          setChatMessages((previous) => {
            const updated = [...previous];
            for (let index = updated.length - 1; index >= 0; index -= 1) {
              if (updated[index].isToolUse && updated[index].toolId === piData.toolCallId) {
                updated[index] = {
                  ...updated[index],
                  toolResult: {
                    content: piData.output,
                    isError: Boolean(piData.isError),
                    timestamp: new Date(),
                  },
                  subagentState: updated[index].isSubagentContainer
                    ? { ...(updated[index].subagentState || { childTools: [], currentToolIndex: -1 }),
                        isComplete: isSubagentComplete({ content: piData.output, isError: piData.isError }),
                        status: subagentStatus({ content: piData.output, isError: piData.isError }) }
                    : updated[index].subagentState,
                };
                break;
              }
            }
            return updated;
          });
          return;
        }
        if (piEvent === 'task_updated' && piData.task) {
          setChatMessages((previous) => applyPiTaskState(previous, [piData.task]));
          return;
        }
        if (piEvent === 'usage') {
          const budget = piTokenBudget(piData);
          if (budget) setTokenBudget(budget);
        }
        break;
      }

      case 'localgpu-response': {
        // Local GPU messages are usually nested under data, but older/alternate
        // transports may send payload directly as latestMessage.data.
        const container = latestMessage.data;
        const orData =
          container && typeof container === 'object' && 'data' in (container as any)
            ? (container as any).data
            : container;
        if (orData && typeof orData === 'object') {
          const startTime = Number.isFinite((orData as any).startTime)
            ? (orData as any).startTime
            : Number.isFinite((container as any)?.startTime)
            ? (container as any).startTime
            : null;
          if (Number.isFinite(startTime)) {
            persistStartTime(startTime, latestMessage.sessionId, currentSessionId, selectedSession?.id);
            syncClaudeStatusStartTime(startTime);
          }

          if (orData.type === 'assistant_message' && orData.message?.content) {
            setIsLoading(true);
            setStatusTextOverride(null);
            const text = orData.message.content;
            streamBufferRef.current += text;
            if (!streamTimerRef.current) {
              streamTimerRef.current = window.setTimeout(() => {
                const chunk = streamBufferRef.current;
                streamBufferRef.current = '';
                streamTimerRef.current = null;
                appendStreamingChunk(setChatMessages, chunk, false);
              }, 16);
            }
            return;
          }

          if (orData.type === 'structured_turn' && orData.message) {
            flushAndFinalizePendingStream();
            handleStructuredAssistantMessage(orData.message, orData);
            return;
          }

          if (orData.type === 'structured_result' && orData.message) {
            handleUserToolResults(orData.message, orData);
            return;
          }

          if (orData.type === 'tool_use') {
            flushAndFinalizePendingStream();
            if (['Bash', 'bash', 'run_shell_command'].includes(orData.toolName)) {
              setStatusTextOverride(i18n.t('chat:status.runningCode'));
            }
            const toolInput = orData.toolInput ? JSON.stringify(orData.toolInput, null, 2) : '';
            setChatMessages((prev) => [
              ...prev,
              {
                type: 'assistant' as const,
                content: '',
                timestamp: new Date(),
                isToolUse: true,
                toolName: orData.toolName,
                toolInput,
                toolId: orData.toolCallId,
                toolResult: null,
              },
            ]);
            return;
          }

          if (orData.type === 'tool_result') {
            setStatusTextOverride(null);
            setChatMessages((prev) => {
              const updated = [...prev];
              for (let i = updated.length - 1; i >= 0; i--) {
                if (updated[i].isToolUse && updated[i].toolId === orData.toolCallId) {
                  updated[i] = {
                    ...updated[i],
                    toolResult: {
                      content: orData.output,
                      isError: orData.isError || false,
                      timestamp: new Date(),
                    },
                  };
                  break;
                }
              }
              return updated;
            });
            return;
          }
        }
        break;
      }

      case 'claude-output': {
        const cleaned = String(latestMessage.data || '');
        if (cleaned.trim()) {
          streamBufferRef.current += streamBufferRef.current ? `\n${cleaned}` : cleaned;
          if (!streamTimerRef.current) {
            streamTimerRef.current = window.setTimeout(() => {
              const chunk = streamBufferRef.current;
              streamBufferRef.current = '';
              streamTimerRef.current = null;
              appendStreamingChunk(setChatMessages, chunk, true);
            }, 16);
          }
        }
        break;
      }

      case 'claude-complete':
      case 'localgpu-complete':
      case 'pi-complete': {
        const completedProvider: SessionProvider = latestMessage.type === 'localgpu-complete'
          ? 'local'
          : latestMessage.type === 'pi-complete'
            ? 'pi'
            : 'claude';
        const pendingSessionId = readPendingSessionId(completedProvider);
        const completedSessionId = latestMessage.sessionId || currentSessionId || pendingSessionId;
        flushAndFinalizePendingStream();
        clearLoadingIndicators();
        clearSessionAbortRequested(completedSessionId);
        markSessionsAsCompleted(completedSessionId, currentSessionId, selectedSession?.id, pendingSessionId);
        alignViewWithCompletedSession(selectedProject?.name);
        reconcileTerminalTranscript(completedSessionId, completedProvider, selectedProject?.name);
        if (pendingSessionId && !currentSessionId && latestMessage.exitCode === 0) {
          setCurrentSessionId(pendingSessionId);
          clearPendingSessionId(completedProvider, pendingSessionId);
        }
        setPendingPermissionRequests([]);
        break;
      }

      case 'claude-error':
      case 'localgpu-error':
      case 'pi-error': {
        if (isLegacyTaskMasterInstallError(latestMessage.error)) {
          break;
        }
        const erroredSessionId =
          latestMessage.sessionId ||
          pendingViewSessionRef.current?.sessionId ||
          currentSessionId ||
          selectedSession?.id ||
          null;
        flushAndFinalizePendingStream();
        clearLoadingIndicators();
        clearSessionAbortRequested(erroredSessionId);
        markSessionsAsCompleted(erroredSessionId, currentSessionId, selectedSession?.id);
        // Clear pendingSessionId for the errored session (not all sessions — other tabs may be active)
        if (typeof window !== 'undefined') {
          const errorProvider: SessionProvider = latestMessage.type === 'localgpu-error'
            ? 'local'
            : latestMessage.type === 'pi-error'
              ? 'pi'
              : 'claude';
          const pendingSessionId = readPendingSessionId(errorProvider);
          if (pendingSessionId && (!erroredSessionId || pendingSessionId === erroredSessionId)) {
            clearPendingSessionId(errorProvider, pendingSessionId);
          }
        }
        setPendingPermissionRequests([]);
        const details = typeof latestMessage.details === 'string' ? latestMessage.details.trim() : '';
        const errorContent = details
          ? `Error: ${latestMessage.error}\n\n<details><summary>Technical details</summary>\n\n\`\`\`text\n${details.slice(0, 8000)}\n\`\`\`\n</details>`
          : `Error: ${latestMessage.error}`;
        setChatMessages((previous) => {
          const last = previous[previous.length - 1];
          if (last?.type === 'error' && String(last.content || '') === errorContent) {
            return previous;
          }
          return [
            ...previous,
            {
              type: 'error',
              content: errorContent,
              timestamp: new Date(),
              errorType: latestMessage.errorType,
              isRetryable: latestMessage.isRetryable === true,
            },
          ];
        });
        break;
      }

      case 'codex-response': {
        const codexData = latestMessage.data;
        if (!codexData) break;

        if (Number.isFinite(codexData.startTime)) {
          persistStartTime(codexData.startTime, latestMessage.sessionId, currentSessionId, selectedSession?.id);
          syncClaudeStatusStartTime(codexData.startTime);
        }

        setIsLoading(true);
        if (codexData.type === 'item') {
          const itemId = codexData.itemId;
          const lifecycle = codexData.lifecycle; // 'started' | 'updated' | 'completed' | 'other'

          switch (codexData.itemType) {
            case 'agent_message':
              if (codexData.message?.content?.trim()) {
                const content = decodeHtmlEntities(codexData.message.content);
                if (isCodexStartupDiagnosticContent(content)) {
                  break;
                }

                // Server marks system prompts; also detect on frontend as fallback
                const isSystemPrompt = codexData.isSystemPrompt ||
                  /^#\s+(AGENTS|SKILL|INSTRUCTIONS)/m.test(content) ||
                  content.includes('<INSTRUCTIONS>') ||
                  content.includes('</INSTRUCTIONS>') ||
                  /^#+\s+.*instructions\s+for\s+\//im.test(content) ||
                  (content.includes('Base directory for this skill:') && content.length > 500) ||
                  (content.length > 2000 && /^\d+\)\s/m.test(content) && /\bskill\b/i.test(content)) ||
                  ((content.match(/SKILL\.md\)/g) || []).length >= 3) ||
                  content.includes('### How to use skills') ||
                  content.includes('## How to use skills') ||
                  isCodexInternalNoticeContent(content) ||
                  isCodexInternalPromptContent(content) ||
                  (content.includes('Trigger rules:') && content.includes('skill') && content.length > 500);

                if (isSystemPrompt) {
                  // Compatibility fallback for old backends: internal prompt
                  // echoes are never conversation messages.
                  break;
                } else {
                  setStatusTextOverride(null);
                  setChatMessages((previous) => {
                    const existingIndex = itemId
                      ? previous.findIndex((message) => (
                        message.codexItemId === itemId
                        && message.type === 'assistant'
                        && !message.isToolUse
                      ))
                      : -1;
                    if (existingIndex >= 0) {
                      const updated = [...previous];
                      updated[existingIndex] = {
                        ...updated[existingIndex],
                        content,
                        isStreaming: lifecycle !== 'completed',
                      };
                      return updated;
                    }
                    return [
                      ...previous,
                      {
                        type: 'assistant',
                        content,
                        timestamp: new Date(),
                        isStreaming: lifecycle !== 'completed',
                        codexItemId: itemId || undefined,
                      },
                    ];
                  });
                }
              }
              break;

            case 'reasoning':
              // Codex reasoning items are very brief status notes (e.g. "Planning API path inspection")
              // They add noise without value - skip them entirely for Codex sessions
              break;

            case 'command_execution':
              if (lifecycle !== 'completed') {
                setStatusTextOverride(i18n.t('chat:status.runningCode'));
              } else {
                setStatusTextOverride(null);
              }
              if (codexData.command) {
                const exitCode = codexData.exitCode;
                const output = codexData.output;
                const isStartupDiagnosticOutput = isCodexStartupDiagnosticContent(output);
                // Wrap command in object format expected by Bash ToolRenderer
                const bashToolInput = { command: codexData.command };

                if (lifecycle === 'completed' && itemId) {
                  // Update existing tool message if it was added on 'started'
                  setChatMessages((previous) => {
                    const existingIdx = previous.findIndex(
                      (m) => m.codexItemId === itemId && m.isToolUse,
                    );
                    if (isStartupDiagnosticOutput) {
                      if (existingIdx < 0) {
                        return previous;
                      }
                      const updated = [...previous];
                      updated.splice(existingIdx, 1);
                      return updated;
                    }
                    if (existingIdx >= 0) {
                      const updated = [...previous];
                      updated[existingIdx] = {
                        ...updated[existingIdx],
                        toolResult: output != null ? {
                          content: output,
                          isError: exitCode != null && exitCode !== 0,
                        } : null,
                        exitCode,
                      };
                      return updated;
                    }
                    // Not found, add new
                    return [
                      ...previous,
                      {
                        type: 'assistant',
                        content: '',
                        timestamp: new Date(),
                        isToolUse: true,
                        toolName: 'Bash',
                        toolInput: bashToolInput,
                        toolResult: output != null ? {
                          content: output,
                          isError: exitCode != null && exitCode !== 0,
                        } : null,
                        exitCode,
                        codexItemId: itemId,
                      },
                    ];
                  });
                } else {
                  if (isStartupDiagnosticOutput) {
                    break;
                  }
                  // 'started' or no lifecycle - add new tool message
                  setChatMessages((previous) => [
                    ...previous,
                    {
                      type: 'assistant',
                      content: '',
                      timestamp: new Date(),
                      isToolUse: true,
                      toolName: 'Bash',
                      toolInput: bashToolInput,
                      toolResult: output != null ? {
                        content: output,
                        isError: exitCode != null && exitCode !== 0,
                        } : null,
                      exitCode,
                      codexItemId: itemId,
                    },
                  ]);
                }
              }
              break;

            case 'file_change':
              setStatusTextOverride(
                lifecycle === 'completed' ? null : i18n.t('chat:status.working'),
              );
              if (codexData.changes?.length > 0) {
                const changesList = codexData.changes
                  .map((change: { kind: string; path: string }) => `${change.kind}: ${change.path}`)
                  .join('\n');

                if (lifecycle === 'completed' && itemId) {
                  setChatMessages((previous) => {
                    const existingIdx = previous.findIndex(
                      (m) => m.codexItemId === itemId && m.isToolUse,
                    );
                    if (existingIdx >= 0) {
                      const updated = [...previous];
                      updated[existingIdx] = {
                        ...updated[existingIdx],
                        toolInput: changesList,
                        toolResult: {
                          content: `Status: ${codexData.status}`,
                          isError: false,
                        },
                      };
                      return updated;
                    }
                    return [
                      ...previous,
                      {
                        type: 'assistant',
                        content: '',
                        timestamp: new Date(),
                        isToolUse: true,
                        toolName: 'FileChanges',
                        toolInput: changesList,
                        toolResult: {
                          content: `Status: ${codexData.status}`,
                          isError: false,
                        },
                        codexItemId: itemId,
                      },
                    ];
                  });
                } else {
                  setChatMessages((previous) => [
                    ...previous,
                    {
                      type: 'assistant',
                      content: '',
                      timestamp: new Date(),
                      isToolUse: true,
                      toolName: 'FileChanges',
                      toolInput: changesList,
                      toolResult: codexData.status ? {
                        content: `Status: ${codexData.status}`,
                        isError: false,
                      } : null,
                      codexItemId: itemId,
                    },
                  ]);
                }
              }
              break;

            case 'mcp_tool_call': {
              setStatusTextOverride(
                lifecycle === 'completed' ? null : i18n.t('chat:status.working'),
              );
              const toolResult = codexData.result
                ? {
                    content: typeof codexData.result === 'string'
                      ? codexData.result
                      : JSON.stringify(codexData.result, null, 2),
                    isError: false,
                  }
                : codexData.error?.message
                ? { content: codexData.error.message, isError: true }
                : null;

              if (lifecycle === 'completed' && itemId) {
                setChatMessages((previous) => {
                  const existingIdx = previous.findIndex(
                    (m) => m.codexItemId === itemId && m.isToolUse,
                  );
                  if (existingIdx >= 0) {
                    const updated = [...previous];
                    updated[existingIdx] = {
                      ...updated[existingIdx],
                      toolName: `${codexData.server}:${codexData.tool}`,
                      toolInput: JSON.stringify(codexData.arguments, null, 2),
                      toolResult,
                    };
                    return updated;
                  }
                  return [
                    ...previous,
                    {
                      type: 'assistant',
                      content: '',
                      timestamp: new Date(),
                      isToolUse: true,
                      toolName: `${codexData.server}:${codexData.tool}`,
                      toolInput: JSON.stringify(codexData.arguments, null, 2),
                      toolResult,
                      codexItemId: itemId,
                    },
                  ];
                });
              } else {
                setChatMessages((previous) => [
                  ...previous,
                  {
                    type: 'assistant',
                    content: '',
                    timestamp: new Date(),
                    isToolUse: true,
                    toolName: `${codexData.server}:${codexData.tool}`,
                    toolInput: JSON.stringify(codexData.arguments, null, 2),
                    toolResult,
                    codexItemId: itemId,
                  },
                ]);
              }
              break;
            }

            case 'web_search': {
              setStatusTextOverride(
                lifecycle === 'completed' ? null : i18n.t('chat:status.analyzing'),
              );
              const query = codexData.query || 'Searching...';
              if (lifecycle === 'completed' && itemId) {
                // Update existing or add new
                setChatMessages((previous) => {
                  const existingIdx = previous.findIndex(
                    (m) => m.codexItemId === itemId && m.isToolUse,
                  );
                  if (existingIdx >= 0) {
                    // Already shown from 'started', no update needed for web_search
                    return previous;
                  }
                  return [
                    ...previous,
                    {
                      type: 'assistant',
                      content: '',
                      timestamp: new Date(),
                      isToolUse: true,
                      toolName: 'WebSearch',
                      toolInput: { command: query },
                      toolResult: null,
                      codexItemId: itemId,
                    },
                  ];
                });
              } else {
                setChatMessages((previous) => [
                  ...previous,
                  {
                    type: 'assistant',
                    content: '',
                    timestamp: new Date(),
                    isToolUse: true,
                    toolName: 'WebSearch',
                    toolInput: { command: query },
                    toolResult: null,
                    codexItemId: itemId,
                  },
                ]);
              }
              break;
            }

            case 'todo_list':
              setStatusTextOverride(null);
              setChatMessages((previous) => upsertCodexTodoSnapshot(previous, {
                ...codexData,
                sessionId: latestMessage.sessionId || currentSessionId || selectedSession?.id || null,
              }));
              break;

            case 'error':
              if (codexData.message?.content) {
                if (isCodexStartupDiagnosticContent(codexData.message.content)) {
                  break;
                }
                setChatMessages((previous) => [
                  ...previous,
                  {
                    type: 'error',
                    content: codexData.message.content,
                    timestamp: new Date(),
                  },
                ]);
              }
              break;

            default:
              console.log('[Codex] Unhandled item type:', codexData.itemType, codexData);
          }
        }

        if (codexData.type === 'turn_started') {
          setStatusTextOverride(i18n.t('chat:status.processing'));
        } else if (codexData.type === 'status') {
          setStatusTextOverride(
            codexData.status === 'reasoning'
              ? i18n.t('chat:status.reasoning')
              : i18n.t('chat:status.processing'),
          );
        }

        if (codexData.type === 'turn_complete' || codexData.type === 'turn_failed') {
          const completedSessionId =
            terminalTranscriptIdentity?.sessionId
            || latestMessage.sessionId
            || currentSessionId
            || readPendingSessionId('codex')
            || selectedSession?.id;
          clearLoadingIndicators();
          markSessionsAsCompleted(completedSessionId, currentSessionId, selectedSession?.id);
          alignViewWithSession(completedSessionId, 'codex', selectedProject?.name);
          reconcileTerminalTranscript(completedSessionId, 'codex', selectedProject?.name);
          if (codexData.type === 'turn_failed') {
            if (isCodexInternalNoticeContent(codexData.error?.message)) {
              break;
            }
            setChatMessages((previous) => [...previous, { type: 'error', content: codexData.error?.message || 'Turn failed', timestamp: new Date() }]);
          }
        }
        break;
      }

      case 'codex-complete': {
        const codexPendingSessionId = readPendingSessionId('codex');
        const codexActualSessionId = latestMessage.actualSessionId || codexPendingSessionId;
        const codexCompletedSessionId = latestMessage.sessionId || currentSessionId || codexPendingSessionId;
        const codexProjectName =
          typeof latestMessage.projectName === 'string' && latestMessage.projectName.trim()
            ? latestMessage.projectName
            : selectedProject?.name;
        clearLoadingIndicators();
        clearSessionAbortRequested(codexCompletedSessionId);
        markSessionsAsCompleted(codexCompletedSessionId, codexActualSessionId, currentSessionId, selectedSession?.id, codexPendingSessionId);
        const shouldPromoteActualSessionId =
          typeof codexActualSessionId === 'string'
          && codexActualSessionId.length > 0
          && codexActualSessionId !== currentSessionId;
        if (shouldPromoteActualSessionId) {
          if (codexCompletedSessionId && codexCompletedSessionId !== codexActualSessionId) {
            moveSessionTimerStart(codexCompletedSessionId, codexActualSessionId);
            onSessionInactive?.(codexCompletedSessionId);
            onSessionNotProcessing?.(codexCompletedSessionId);
            onSessionStatusResolved?.(codexCompletedSessionId, false);
          }
          setCurrentSessionId(codexActualSessionId);
          onReplaceTemporarySession?.(codexActualSessionId);
        }
        alignViewWithCompletedSession(codexProjectName);
        reconcileTerminalTranscript(codexActualSessionId || codexCompletedSessionId, 'codex', codexProjectName);
        clearPendingSessionId('codex', codexPendingSessionId);
        break;
      }

      case 'codex-error':
        if (isLegacyTaskMasterInstallError(latestMessage.error)) break;
        if (isCodexInternalNoticeContent(latestMessage.error)) {
          flushAndFinalizePendingStream();
          clearLoadingIndicators();
          clearSessionAbortRequested(latestMessage.sessionId || currentSessionId || selectedSession?.id || null);
          markSessionsAsCompleted(latestMessage.sessionId, currentSessionId, selectedSession?.id);
          break;
        }
        flushAndFinalizePendingStream();
        clearLoadingIndicators();
        clearSessionAbortRequested(latestMessage.sessionId || currentSessionId || selectedSession?.id || null);
        markSessionsAsCompleted(latestMessage.sessionId, currentSessionId, selectedSession?.id);
        setPendingPermissionRequests([]);
        setChatMessages((previous) => [...previous, { type: 'error', content: latestMessage.error || 'An error occurred with Codex', timestamp: new Date(), errorType: latestMessage.errorType, isRetryable: latestMessage.isRetryable === true }]);
        break;

      case 'session-aborted': {
        const abortedProvider = (latestMessage.provider || activeViewProvider) as SessionProvider;
        const pendingSessionId = typeof window !== 'undefined'
          ? readPendingSessionId(abortedProvider)
          : null;
        const abortedSessionId = latestMessage.sessionId || currentSessionId;
        // Always clear any persisted "resuming" marker for this session.
        // Otherwise the UI can get stuck in RESUMING even though the backend considers it finished.
        if (abortedSessionId) {
          clearSessionTimerStart(abortedSessionId);
        }
        if (pendingSessionId && pendingSessionId === abortedSessionId) {
          clearSessionTimerStart(pendingSessionId);
        }
        if (latestMessage.success !== false) {
          clearLoadingIndicators();
          clearSessionAbortRequested(abortedSessionId);
          markSessionsAsCompleted(abortedSessionId, currentSessionId, selectedSession?.id, pendingSessionId);
          if (pendingSessionId && (!abortedSessionId || pendingSessionId === abortedSessionId)) {
            clearPendingSessionId(abortedProvider, pendingSessionId);
          }
          setPendingPermissionRequests([]);
          setChatMessages((previous) => [...previous, { type: 'assistant', content: 'Session interrupted by user.', timestamp: new Date() }]);
        } else {
          clearLoadingIndicators();
          clearSessionAbortRequested(abortedSessionId);
          setPendingPermissionRequests([]);
          setChatMessages((previous) => [...previous, { type: 'error', content: 'Session has already finished.', timestamp: new Date() }]);
        }
        break;
      }

      case 'session-status': {
        const statusSessionId = latestMessage.sessionId;
        if (isSessionAbortRequested(statusSessionId) && latestMessage.isProcessing !== false) {
          return;
        }
        const visibleSessionId = selectedSession?.id || currentSessionId;
        const statusProvider = latestMessage.provider as SessionProvider | undefined;
        const isCurrentSession = statusSessionId === visibleSessionId
          && (!statusProvider || statusProvider === activeViewProvider);
        if (isCurrentSession && latestMessage.isProcessing) {
          persistStartTime(latestMessage.startTime, statusSessionId, currentSessionId, selectedSession?.id);
          setIsLoading(true);
          setCanAbortSession(true);
          onSessionProcessing?.(statusSessionId);
          onSessionStatusResolved?.(statusSessionId, true);
          // If we have a startTime from the backend, sync our status
          if (Number.isFinite(latestMessage.startTime)) {
            // An active backend response means reconnect has finished.
            syncClaudeStatusStartTime(latestMessage.startTime, 'Processing');
          }
        } else if (isCurrentSession && latestMessage.isProcessing === false) {
          const shouldReconcileInactiveStatus = Boolean(
            isSessionAbortRequested(statusSessionId)
            || (isLoading && readSessionTimerStart(statusSessionId))
          );
          const transcriptProvider = (
            terminalTranscriptIdentity?.provider
            || latestMessage.provider
            || (statusSessionId === selectedSession?.id ? selectedSession.__provider : null)
            || provider
          ) as SessionProvider;
          clearSessionAbortRequested(statusSessionId);
          clearSessionTimerStart(statusSessionId);
          clearLoadingIndicators();
          onSessionNotProcessing?.(statusSessionId);
          onSessionStatusResolved?.(statusSessionId, false);
          // This is the authoritative reconnect fallback when every terminal
          // provider envelope was missed while the socket was unavailable.
          if (shouldReconcileInactiveStatus) {
            reconcileTerminalTranscript(statusSessionId, transcriptProvider, selectedProject?.name);
          }
        }
        break;
      }

      case 'agent-permission-request':
      case 'claude-permission-request': {
        const { requestId, toolName, input: toolInput } = latestMessage;
        if (!requestId || !toolName) break;

        setPendingPermissionRequests((previous) => {
          if (previous.some((p) => p.requestId === requestId)) return previous;
          return [
            ...previous,
            {
              requestId,
              toolName,
              input: toolInput,
              sessionId: latestMessage.sessionId || currentSessionId,
              provider: (latestMessage.provider || latestMessage.runtimeId || 'claude') as PendingPermissionRequest['provider'],
              runtimeId: (latestMessage.runtimeId || latestMessage.provider || 'claude') as PendingPermissionRequest['runtimeId'],
              projectKey: latestMessage.projectKey || null,
              receivedAt: new Date(),
            },
          ];
        });
        
        // Ensure UI is in loading/waiting state
        setIsLoading(true);
        setCanAbortSession(true);
        break;
      }

      case 'agent-permission-cancelled':
      case 'claude-permission-cancelled': {
        const { requestId, reason } = latestMessage;
        if (!requestId) break;
        setPendingPermissionRequests((previous) => previous.filter((p) => p.requestId !== requestId));
        // Pi reports an unanswered interaction in its tool result. A separate
        // assistant notice here can arrive during the model's next response.
        if (reason === 'timeout' && latestMessage.runtimeId !== 'pi' && latestMessage.provider !== 'pi') {
          setChatMessages((previous) => [
            ...previous,
            {
              type: 'assistant',
              content: 'The pending interaction timed out and was cancelled automatically.',
              timestamp: new Date(),
            },
          ]);
        }
        break;
      }

      case 'claude-status': {
        const statusData = latestMessage.data || latestMessage;
        persistStartTime(statusData.startTime, latestMessage.sessionId, currentSessionId, selectedSession?.id);
        const statusInfo = {
          text: statusData.message || statusData.status || 'Claude Code is working...',
          tokens: statusData.tokens || statusData.token_count || 0,
          can_interrupt: statusData.can_interrupt !== false,
          startTime: statusData.startTime,
        };
        setClaudeStatus((previous) => ({
          ...statusInfo,
          startTime: Number.isFinite(statusInfo.startTime) ? statusInfo.startTime : previous?.startTime,
        }));
        setIsLoading(true);
        setCanAbortSession(statusInfo.can_interrupt);
        break;
      }
      default:
        break;
    }
  }, [
    latestMessage, provider, selectedProject, selectedSession, currentSessionId, isLoading, setCurrentSessionId,
    setChatMessages, setIsLoading, setCanAbortSession, setClaudeStatus, setStatusTextOverride, setTokenBudget,
    setIsSystemSessionChange, setPendingPermissionRequests, onPiPermissionModeChange, setQueuedTurns, onSessionInactive, onSessionProcessing,
    onSessionNotProcessing, onSessionStatusResolved, onReplaceTemporarySession, onNavigateToSession,
    requestTranscriptReconcile,
  ]);
}
