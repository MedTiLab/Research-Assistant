import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';

import { api, authenticatedFetch } from '../../../utils/api';
import { RESUMING_STATUS_TEXT } from '../types/types';
import type { ChatMessage, Provider, TokenBudget } from '../types/types';
import type { AgentSessionKey, Project, ProjectSession } from '../../../types/app';
import { hasClientAgentSession } from '../../../utils/agentSessionIdentity';
import { isVirtualDefaultDraftProject } from '../../../utils/draftProject';
import {
  clearSessionTimerStart,
  getChatMessagesStorageKey,
  isSessionAbortRequested,
  parseChatMessagesCache,
  readSessionTimerStart,
  safeLocalStorage,
  serializeChatMessagesCache,
} from '../utils/chatStorage';
import {
  convertSessionMessages,
  createCachedDiffCalculator,
  type DiffCalculator,
} from '../utils/messageTransforms';
import {
  getTranscriptPageStart,
  loadTranscriptWindow,
  reconcilePersistedSessionMessages,
  shouldHoldLiveTranscript,
} from '../utils/sessionTranscriptReconciliation';
import { retainCodexTodoSnapshot } from '../utils/codexTodoList';
import { hasPiTokenBudget, piTokenBudget } from '../utils/piTokenBudget';
import {
  resolveActiveSessionId,
  shouldPreserveLiveSessionOnRefresh,
} from '../utils/sessionRealtimeIdentity';
import {
  getAnchoredScrollTop,
  getNextVisibleMessageCount,
  HISTORY_TOP_PREFETCH_PX,
  shouldLoadOlderHistory,
} from '../utils/historyScroll';
import { CAPABILITIES, useEntitlements } from '../../../hooks/useEntitlements';

const MESSAGES_PER_PAGE = 50;
const INITIAL_VISIBLE_MESSAGES = 100;
const TOP_LOAD_LOCK_RELEASE_PX = 20;
const TOP_LOAD_LOCK_RELEASE_DELAY_MS = 350;
/** Grace period for WebSocket status-check response before clearing stale resume state */
const STATUS_VALIDATION_TIMEOUT_MS = 5000;
const ACTIVE_SESSION_STATUS_POLL_MS = 15_000;
const ACTIVE_SESSION_STATUS_POLL_INITIAL_DELAY_MS = 30_000;
const COMPLETION_RECONCILE_DELAYS_MS = [150, 600, 1_500] as const;

type PendingViewSession = {
  sessionId: string | null;
  startedAt: number;
  provider?: Provider;
};

type TranscriptReconcileRequest = {
  sequence: number;
  projectName: string;
  sessionId: string;
  provider: Provider;
};

interface UseChatSessionStateArgs {
  selectedProject: Project | null;
  selectedSession: ProjectSession | null;
  provider: Provider;
  ws: WebSocket | null;
  sendMessage: (message: unknown) => void;
  autoScrollToBottom?: boolean;
  externalMessageUpdate?: number;
  processingSessions?: Set<AgentSessionKey>;
  resetStreamingState: () => void;
  pendingViewSessionRef: MutableRefObject<PendingViewSession | null>;
  preserveDraftProjectRebind?: boolean;
  onSessionInactive?: (sessionId?: string | null) => void;
  onSessionNotProcessing?: (sessionId?: string | null) => void;
}

interface ScrollRestoreState {
  height: number;
  top: number;
}

export function useChatSessionState({
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
  preserveDraftProjectRebind = false,
  onSessionInactive,
  onSessionNotProcessing,
}: UseChatSessionStateArgs) {
  const { can } = useEntitlements();
  const canSyncConversationArchive = can(CAPABILITIES.conversationArchive);
  const selectedProjectName = selectedProject?.name || null;
  const selectedSessionId = selectedSession?.id || null;
  const selectedSessionProvider = selectedSession?.__provider || null;
  const selectedViewProvider = selectedSessionProvider || provider;
  const isTrackedProcessingSession = (sessionId?: string | null, runtimeId = selectedViewProvider) => (
    hasClientAgentSession(processingSessions, sessionId, {
      projectKey: selectedProjectName,
      runtimeId,
    })
  );
  const persistedInitialStartTime = selectedSession?.id ? readSessionTimerStart(selectedSession.id) : null;

  const [chatMessages, _setChatMessages] = useState<ChatMessage[]>(() => {
    if (typeof window !== 'undefined' && selectedProject?.name && !isVirtualDefaultDraftProject(selectedProject)) {
      const storageKey = getChatMessagesStorageKey({
        projectName: selectedProject.name,
        sessionId: selectedSession?.id,
        provider: selectedSession?.__provider,
      });
      const saved = safeLocalStorage.getItem(storageKey);
      if (saved) {
        const cachedMessages = parseChatMessagesCache<ChatMessage>(saved, {
          projectName: selectedProject.name,
          sessionId: selectedSession?.id,
          provider: selectedSession?.__provider,
        });
        if (cachedMessages) {
          return cachedMessages;
        }
        safeLocalStorage.removeItem(storageKey);
      }
      return [];
    }
    return [];
  });

  const setChatMessages = useCallback((updater: React.SetStateAction<ChatMessage[]>) => {
    _setChatMessages((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      let hasChanges = false;
      const final = next.map((msg) => {
        if (!msg.id && !msg.messageId && !msg.toolId && !msg.toolCallId && !msg.blobId && !msg.rowid && !msg.sequence) {
          hasChanges = true;
          return { ...msg, messageId: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).substring(2, 15) };
        }
        return msg;
      });
      return hasChanges ? final : next;
    });
  }, []);

  const [isLoading, setIsLoading] = useState(() => {
    if (isTrackedProcessingSession(selectedSession?.id)) {
      return true;
    }
    if (
      persistedInitialStartTime
      && selectedSession?.id
      && (selectedSession.id.startsWith('new-session-') || selectedSession.id.startsWith('temp-'))
    ) {
      return true;
    }
    return false;
  });
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(selectedSession?.id || null);
  const [sessionMessages, setSessionMessages] = useState<any[]>([]);
  const [isLoadingSessionMessages, setIsLoadingSessionMessages] = useState(false);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isSystemSessionChange, setIsSystemSessionChange] = useState(false);
  const [canAbortSession, setCanAbortSession] = useState(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [tokenBudget, storeTokenBudget] = useState<TokenBudget | null>(null);
  const tokenBudgetRevisionRef = useRef(0);
  const setTokenBudget = useCallback((budget: TokenBudget | null) => {
    tokenBudgetRevisionRef.current += 1;
    storeTokenBudget(budget);
  }, []);
  const [visibleMessageCount, setVisibleMessageCount] = useState(INITIAL_VISIBLE_MESSAGES);
  const [claudeStatus, setClaudeStatus] = useState<{ text: string; tokens: number; can_interrupt: boolean; startTime?: number } | null>(() => {
    const selectedSessionIsConfirmedProcessing = Boolean(
      isTrackedProcessingSession(selectedSession?.id),
    );
    if (!persistedInitialStartTime || !selectedSessionIsConfirmedProcessing) {
      return null;
    }

    return {
      text: RESUMING_STATUS_TEXT,
      tokens: 0,
      can_interrupt: true,
      startTime: persistedInitialStartTime,
    };
  });
  const [statusTextOverride, setStatusTextOverride] = useState<string | null>(null);
  const [pendingStatusValidationSessionId, setPendingStatusValidationSessionId] = useState<string | null>(null);
  const [completionReconcileRequest, setCompletionReconcileRequest] = useState<TranscriptReconcileRequest | null>(null);
  const [isCompletionReconcileActive, setIsCompletionReconcileActive] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isLoadingSessionRef = useRef(false);
  const isLoadingMoreRef = useRef(false);
  const topLoadLockRef = useRef(false);
  const topLoadLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScrollRestoreRef = useRef<ScrollRestoreState | null>(null);
  const pendingInitialScrollRef = useRef(true);
  const messagesOffsetRef = useRef(0);
  const piHistoryWindowRef = useRef<{ key: string; start: number } | null>(null);
  const scrollPositionRef = useRef({ height: 0, top: 0 });
  const cloudSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCloudSyncKeyRef = useRef<string | null>(null);
  const completionReconcileSequenceRef = useRef(0);
  const activeCompletionReconcileSequenceRef = useRef(0);
  const lastCompletionReconcileRequestRef = useRef<{ key: string; requestedAt: number } | null>(null);
  const transcriptViewIdentityRef = useRef({
    projectName: selectedProjectName,
    selectedSessionId,
    currentSessionId,
  });
  transcriptViewIdentityRef.current = {
    projectName: selectedProjectName,
    selectedSessionId,
    currentSessionId,
  };
  const loadedSelectionKeyRef = useRef([
    selectedProjectName || '',
    selectedSessionId || '',
    selectedSessionProvider || '',
  ].join(':'));
  const persistedChatViewIdentityRef = useRef([
    selectedProjectName || '',
    selectedSessionId || '',
    selectedSessionProvider || '',
  ].join(':'));
  const selectionLoadSequenceRef = useRef(0);
  const selectedViewIdentityRef = useRef({
    projectName: selectedProjectName,
    sessionId: selectedSessionId,
    provider: selectedViewProvider,
    isDefaultWorkspace: selectedProject?.isDefaultWorkspace === true,
  });

  const createDiff = useMemo<DiffCalculator>(() => createCachedDiffCalculator(), []);

  useLayoutEffect(() => {
    const previousIdentity = selectedViewIdentityRef.current;
    const identityUnchanged =
      previousIdentity.projectName === selectedProjectName
      && previousIdentity.sessionId === selectedSessionId
      && previousIdentity.provider === selectedViewProvider;
    if (identityUnchanged) {
      return;
    }

    const isDraftWorkspaceRebind = Boolean(
      preserveDraftProjectRebind
      && !previousIdentity.sessionId
      && !selectedSessionId
      && pendingViewSessionRef.current,
    );

    selectedViewIdentityRef.current = {
      projectName: selectedProjectName,
      sessionId: selectedSessionId,
      provider: selectedViewProvider,
      isDefaultWorkspace: selectedProject?.isDefaultWorkspace === true,
    };

    // The first message promotes the placeholder conversation into a real
    // directory while submission is already in flight. This is a workspace
    // rebind, not navigation, so preserve the optimistic message and loading
    // state instead of clearing the chat view.
    if (isDraftWorkspaceRebind) {
      return;
    }

    const isRealSession = Boolean(
      selectedSessionId
      && !selectedSessionId.startsWith('new-session-')
      && !selectedSessionId.startsWith('temp-'),
    );
    const isPromotionFromDraft = Boolean(
      isRealSession
      && (!previousIdentity.sessionId
        || previousIdentity.sessionId.startsWith('new-session-')
        || previousIdentity.sessionId.startsWith('temp-')),
    );

    // Opening a real sidebar conversation severs ownership of any draft/live
    // turn that belonged to the previous view. This ref is read by realtime
    // routing before React state updates settle, so clear it synchronously.
    if (isRealSession) {
      pendingViewSessionRef.current = null;
    }

    if (!isPromotionFromDraft) {
      piHistoryWindowRef.current = null;
      resetStreamingState();
      setChatMessages([]);
      setSessionMessages([]);
    }

    setCurrentSessionId(selectedSessionId);
    const selectedSessionIsProcessing = Boolean(
      isTrackedProcessingSession(selectedSessionId),
    );

    // Provider/session activity is view-local. Clear the previous provider's
    // visual state before paint so a running Codex turn cannot surface a
    // Claude stop button or resume bar after sidebar navigation.
    setIsLoading(selectedSessionIsProcessing);
    setCanAbortSession(selectedSessionIsProcessing);
    setClaudeStatus(null);
    setStatusTextOverride(null);
    setPendingStatusValidationSessionId(null);
  }, [
    pendingViewSessionRef,
    preserveDraftProjectRebind,
    processingSessions,
    resetStreamingState,
    selectedProjectName,
    selectedProject?.isConversationWorkspace,
    selectedProject?.isDefaultWorkspace,
    selectedSessionId,
    selectedViewProvider,
    setChatMessages,
  ]);

  useLayoutEffect(() => {
    const isRealSelectedSession = Boolean(
      selectedSessionId
      && !selectedSessionId.startsWith('new-session-')
      && !selectedSessionId.startsWith('temp-'),
    );
    if (
      !isRealSelectedSession
      || !processingSessions
      || isTrackedProcessingSession(selectedSessionId)
      || (!isLoading && !canAbortSession && !claudeStatus && !statusTextOverride)
    ) {
      return;
    }

    // For a real sidebar selection, the backend-derived active-session set is
    // authoritative. Background provider events may keep their own turn alive,
    // but they must never leave loading/abort UI on an inactive selected view.
    setIsLoading(false);
    setCanAbortSession(false);
    setClaudeStatus(null);
    setStatusTextOverride(null);
  }, [
    canAbortSession,
    claudeStatus,
    isLoading,
    processingSessions,
    selectedSessionId,
    statusTextOverride,
  ]);

  const releaseTopLoadLock = useCallback(() => {
    topLoadLockRef.current = false;
    if (topLoadLockTimerRef.current) {
      clearTimeout(topLoadLockTimerRef.current);
      topLoadLockTimerRef.current = null;
    }
  }, []);

  const scheduleTopLoadLockRelease = useCallback((delay = TOP_LOAD_LOCK_RELEASE_DELAY_MS) => {
    if (topLoadLockTimerRef.current) {
      clearTimeout(topLoadLockTimerRef.current);
    }
    topLoadLockTimerRef.current = setTimeout(() => {
      topLoadLockRef.current = false;
      topLoadLockTimerRef.current = null;
    }, delay);
  }, []);

  const pendingStatusValidationSessionIdRef = useRef(pendingStatusValidationSessionId);
  const hasOptimisticMessagesRef = useRef(false);
  const isLoadingRef = useRef(isLoading);
  useEffect(() => () => {
    if (topLoadLockTimerRef.current) {
      clearTimeout(topLoadLockTimerRef.current);
      topLoadLockTimerRef.current = null;
    }
  }, []);
  useEffect(() => {
    pendingStatusValidationSessionIdRef.current = pendingStatusValidationSessionId;
  }, [pendingStatusValidationSessionId]);
  useEffect(() => {
    hasOptimisticMessagesRef.current = chatMessages.some((message) => message.isOptimistic);
  }, [chatMessages]);
  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  const markSessionStatusCheckPending = useCallback((sessionId?: string | null) => {
    if (!sessionId) {
      return;
    }

    setPendingStatusValidationSessionId(sessionId);
  }, []);

  const resolveSessionStatusCheck = useCallback((sessionId?: string | null) => {
    if (!sessionId) {
      return;
    }

    setPendingStatusValidationSessionId((previous) => (previous === sessionId ? null : previous));
  }, []);

  const loadSessionMessages = useCallback(
    async (
      projectName: string,
      sessionId: string,
      loadMore = false,
      provider: Provider | string = 'claude',
      silent = false,
      shouldApply: () => boolean = () => true,
      signal?: AbortSignal,
    ) => {
      if (!projectName || !sessionId) {
        return [] as any[];
      }

      const isInitialLoad = !loadMore;
      const usageRevision = tokenBudgetRevisionRef.current;
      if (isInitialLoad && !silent) {
        setIsLoadingSessionMessages(true);
      } else if (!isInitialLoad) {
        setIsLoadingMoreMessages(true);
      }

      try {
        const currentOffset = loadMore ? messagesOffsetRef.current : 0;
        const historyKey = JSON.stringify([projectName, provider, sessionId]);
        const previousPiWindow = piHistoryWindowRef.current?.key === historyKey
          ? piHistoryWindowRef.current
          : null;
        const fetchPage = async (limit: number) => {
          const response = await (api.sessionMessages as any)(
            projectName, sessionId, limit, currentOffset, provider, { signal },
          );
          if (!response.ok) throw new Error('Failed to load session messages');
          return response.json();
        };
        const data = provider === 'pi' && !loadMore
          ? await loadTranscriptWindow({
            fetchPage,
            // Completion can precede the first history load for a new chat.
            // In that case the live turn owns the transcript from its start.
            start: previousPiWindow?.start ?? (silent ? 0 : null),
            pageSize: MESSAGES_PER_PAGE,
          })
          : await fetchPage(MESSAGES_PER_PAGE);
        if (!shouldApply()) {
          return [];
        }
        console.log('[DEBUG] Received session messages data:', data);
        if (isInitialLoad && data.tokenUsage && usageRevision === tokenBudgetRevisionRef.current) {
          const budget = provider === 'pi' ? piTokenBudget(data.tokenUsage) : data.tokenUsage;
          if (provider !== 'pi' || hasPiTokenBudget(budget)) setTokenBudget(budget);
        }

        if (data.hasMore !== undefined) {
          const loadedCount = data.messages?.length || 0;
          if (provider === 'pi') {
            const start = getTranscriptPageStart({ ...data, offset: currentOffset });
            if (start !== null) piHistoryWindowRef.current = { key: historyKey, start };
          }
          // Pi refreshes the whole loaded window, including any new records.
          // Other providers still merge a newest page onto their loaded history
          // and must not reset that history's pagination cursor back to 50.
          if (!silent || provider === 'pi') {
            setHasMoreMessages(Boolean(data.hasMore));
            messagesOffsetRef.current = currentOffset + loadedCount;
          }
          return data.messages || [];
        }

        const messages = data.messages || [];
        if (!silent) {
          setHasMoreMessages(false);
          messagesOffsetRef.current = messages.length;
        }
        return messages;
      } catch (error) {
        if ((error as { name?: string })?.name === 'AbortError') {
          return [];
        }
        console.error('Error loading session messages:', error);
        return [];
      } finally {
        if (isInitialLoad && !silent && shouldApply()) {
          setIsLoadingSessionMessages(false);
        } else if (!isInitialLoad && shouldApply()) {
          setIsLoadingMoreMessages(false);
        }
      }
    },
    [],
  );

  const requestTranscriptReconcile = useCallback((request: {
    projectName?: string | null;
    sessionId?: string | null;
    provider?: Provider | null;
  }) => {
    const projectName = typeof request.projectName === 'string' ? request.projectName.trim() : '';
    const sessionId = typeof request.sessionId === 'string' ? request.sessionId.trim() : '';
    if (!projectName || !sessionId || !request.provider) {
      return;
    }

    const key = `${projectName}:${request.provider}:${sessionId}`;
    const now = Date.now();
    const previousRequest = lastCompletionReconcileRequestRef.current;
    // Inner provider completion, outer completion, and the authoritative status
    // response can arrive together. One retry loop is enough for the same turn.
    if (previousRequest?.key === key && now - previousRequest.requestedAt < 5_000) {
      return;
    }

    lastCompletionReconcileRequestRef.current = { key, requestedAt: now };
    completionReconcileSequenceRef.current += 1;
    // Raise the guard in the same React batch that clears the live loading
    // state, before the persisted snapshot synchronization effect can run.
    setIsCompletionReconcileActive(true);
    setCompletionReconcileRequest({
      sequence: completionReconcileSequenceRef.current,
      projectName,
      sessionId,
      provider: request.provider,
    });
  }, []);

  const convertedMessages = useMemo(() => {
    return convertSessionMessages(sessionMessages);
  }, [sessionMessages]);

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, []);

  const scrollToBottomAndReset = useCallback(() => {
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    requestAnimationFrame(scrollToBottom);
  }, [scrollToBottom]);

  const isNearBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return false;
    }
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight < 50;
  }, []);

  const loadOlderMessages = useCallback(
    async (container: HTMLDivElement) => {
      if (!container || isLoadingMoreRef.current || isLoadingMoreMessages) {
        return false;
      }

      if (chatMessages.length > visibleMessageCount) {
        pendingScrollRestoreRef.current = {
          height: container.scrollHeight,
          top: container.scrollTop,
        };
        setVisibleMessageCount((previousCount) => (
          getNextVisibleMessageCount(previousCount, chatMessages.length)
        ));
        return true;
      }

      if (!hasMoreMessages || !selectedSession || !selectedProject) {
        return false;
      }

      const sessionProvider = selectedSession.__provider || 'claude';

      isLoadingMoreRef.current = true;
      const previousScrollHeight = container.scrollHeight;
      const previousScrollTop = container.scrollTop;

      try {
        const moreMessages = await loadSessionMessages(
          selectedProject.name,
          selectedSession.id,
          true,
          sessionProvider,
        );

        if (moreMessages.length === 0) {
          return false;
        }

        pendingScrollRestoreRef.current = {
          height: previousScrollHeight,
          top: previousScrollTop,
        };
        setSessionMessages((previous) => [...moreMessages, ...previous]);
        // Keep the rendered window in sync with top-pagination so newly loaded history becomes visible.
        setVisibleMessageCount((previousCount) => previousCount + moreMessages.length);
        return true;
      } finally {
        isLoadingMoreRef.current = false;
      }
    },
    [
      chatMessages.length,
      hasMoreMessages,
      isLoadingMoreMessages,
      loadSessionMessages,
      selectedProject,
      selectedSession,
      visibleMessageCount,
    ],
  );

  const handleScroll = useCallback(async () => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const nearBottom = isNearBottom();
    setIsUserScrolledUp(!nearBottom);

    const hasHiddenMessages = chatMessages.length > visibleMessageCount;
    const shouldLoad = shouldLoadOlderHistory({
      scrollTop: container.scrollTop,
      hasHiddenMessages,
      hasMoreMessages,
      isLoading: isLoadingMoreRef.current || isLoadingMoreMessages,
    });
    if (!shouldLoad) {
      if (container.scrollTop > HISTORY_TOP_PREFETCH_PX) {
        releaseTopLoadLock();
      }
      return;
    }

    if (topLoadLockRef.current) {
      if (container.scrollTop > TOP_LOAD_LOCK_RELEASE_PX) {
        releaseTopLoadLock();
      } else {
        return;
      }
    }

    const didLoad = await loadOlderMessages(container);
    if (didLoad) {
      topLoadLockRef.current = true;
      scheduleTopLoadLockRelease();
    }
  }, [
    chatMessages.length,
    hasMoreMessages,
    isLoadingMoreMessages,
    isNearBottom,
    loadOlderMessages,
    releaseTopLoadLock,
    scheduleTopLoadLockRelease,
    visibleMessageCount,
  ]);

  const handleLoadOlderMessages = useCallback(async () => {
    const container = scrollContainerRef.current;
    if (container) await loadOlderMessages(container);
  }, [loadOlderMessages]);

  useLayoutEffect(() => {
    if (!pendingScrollRestoreRef.current || !scrollContainerRef.current) {
      return;
    }

    const { height, top } = pendingScrollRestoreRef.current;
    const container = scrollContainerRef.current;
    const newScrollHeight = container.scrollHeight;
    const nextScrollTop = getAnchoredScrollTop(height, top, newScrollHeight);
    container.scrollTop = nextScrollTop;
    pendingScrollRestoreRef.current = null;
    if (nextScrollTop > TOP_LOAD_LOCK_RELEASE_PX) {
      releaseTopLoadLock();
    } else {
      scheduleTopLoadLockRelease(150);
    }
  }, [chatMessages.length, releaseTopLoadLock, scheduleTopLoadLockRelease, visibleMessageCount]);

  useEffect(() => {
    pendingInitialScrollRef.current = true;
    releaseTopLoadLock();
    pendingScrollRestoreRef.current = null;
    setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
    setIsUserScrolledUp(false);
  }, [releaseTopLoadLock, selectedProject?.name, selectedSession?.id]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (
      !container
      || isLoadingSessionMessages
      || isLoadingMoreMessages
      || pendingInitialScrollRef.current
    ) {
      return;
    }

    const hasHiddenMessages = chatMessages.length > visibleMessageCount;
    const viewportNeedsHistory = container.scrollHeight <= container.clientHeight + HISTORY_TOP_PREFETCH_PX;
    if (viewportNeedsHistory && (hasHiddenMessages || hasMoreMessages)) {
      void loadOlderMessages(container);
    }
  }, [
    chatMessages.length,
    hasMoreMessages,
    isLoadingMoreMessages,
    isLoadingSessionMessages,
    loadOlderMessages,
    visibleMessageCount,
  ]);

  useEffect(() => {
    if (!pendingInitialScrollRef.current || !scrollContainerRef.current || isLoadingSessionMessages) {
      return;
    }

    if (chatMessages.length === 0) {
      pendingInitialScrollRef.current = false;
      return;
    }

    pendingInitialScrollRef.current = false;
    setTimeout(() => {
      scrollToBottom();
      void handleScroll();
    }, 200);
  }, [chatMessages.length, handleScroll, isLoadingSessionMessages, scrollToBottom]);

  useEffect(() => {
    const selectionLoadSequence = selectionLoadSequenceRef.current + 1;
    selectionLoadSequenceRef.current = selectionLoadSequence;
    let disposed = false;
    const abortController = new AbortController();
    let loadingRefReleaseTimer: ReturnType<typeof setTimeout> | null = null;
    const isCurrentSelectionLoad = () => (
      !disposed && selectionLoadSequenceRef.current === selectionLoadSequence
    );

    const loadMessages = async () => {
      const nextSelectionKey = [
        selectedProjectName || '',
        selectedSessionId || '',
        selectedSessionProvider || '',
      ].join(':');
      const selectionChanged = loadedSelectionKeyRef.current !== nextSelectionKey;
      loadedSelectionKeyRef.current = nextSelectionKey;

      if (shouldPreserveLiveSessionOnRefresh({
        isProcessing: isLoadingRef.current,
        currentSessionId,
        selectedSessionId,
        selectionChanged,
      })) {
        markSessionStatusCheckPending(currentSessionId);
        sendMessage({
          type: 'check-session-status',
          sessionId: currentSessionId,
          provider: pendingViewSessionRef.current?.provider || provider,
          runtimeId: pendingViewSessionRef.current?.provider || provider,
          projectKey: selectedProjectName,
        });
        return;
      }

      if (selectedSessionId && selectedProjectName) {
        const currentProvider = selectedViewProvider || (localStorage.getItem('selected-provider') as Provider) || 'claude';
        isLoadingSessionRef.current = true;

        const sessionChanged = currentSessionId !== selectedSessionId;
        if (sessionChanged) {
          if (!isSystemSessionChange) {
            resetStreamingState();
            pendingViewSessionRef.current = null;
            setChatMessages([]);
            setSessionMessages([]);
            setClaudeStatus(null);
            setCanAbortSession(false);
          }

          messagesOffsetRef.current = 0;
          setHasMoreMessages(false);
          setVisibleMessageCount(INITIAL_VISIBLE_MESSAGES);
          setTokenBudget(null);
          
          // Only set isLoading to false if it's NOT in the processingSessions set
          const isProcessing =
            isTrackedProcessingSession(selectedSessionId, currentProvider) ||
            pendingStatusValidationSessionIdRef.current === selectedSessionId;
          if (!isProcessing) {
            setIsLoading(false);
          }
        }

        // Always check status for a selected session, especially after returning
        // to the chat tab. sendMessage queues while the socket reconnects.
        markSessionStatusCheckPending(selectedSessionId);
        sendMessage({
          type: 'check-session-status',
          sessionId: selectedSessionId,
          provider: currentProvider,
          runtimeId: currentProvider,
          projectKey: selectedProjectName,
        });

        setCurrentSessionId(selectedSessionId);

        if (!isSystemSessionChange) {
          const messages = await loadSessionMessages(
            selectedProjectName,
            selectedSessionId,
            false,
            currentProvider,
            false,
            isCurrentSelectionLoad,
            abortController.signal,
          );
          if (isCurrentSelectionLoad()) {
            setSessionMessages(messages);
          }
        } else {
          setIsSystemSessionChange(false);
        }
      } else {
        const isTemporaryNewSession =
          !currentSessionId ||
          currentSessionId.startsWith('new-session-');
        const shouldPreservePendingNewSession =
          Boolean(pendingViewSessionRef.current) ||
          (isTemporaryNewSession && (isLoadingRef.current || hasOptimisticMessagesRef.current));

        if (!isSystemSessionChange && !shouldPreservePendingNewSession) {
          resetStreamingState();
          pendingViewSessionRef.current = null;
          setChatMessages([]);
          setSessionMessages([]);
          setClaudeStatus(null);
          setCanAbortSession(false);
          setIsLoading(false);
        }

        if (!shouldPreservePendingNewSession) {
          setCurrentSessionId(null);
        }
        messagesOffsetRef.current = 0;
        setHasMoreMessages(false);
        if (!shouldPreservePendingNewSession) {
          setTokenBudget(null);
        }
      }

      loadingRefReleaseTimer = setTimeout(() => {
        if (isCurrentSelectionLoad()) {
          isLoadingSessionRef.current = false;
        }
      }, 250);
    };

    void loadMessages();
    return () => {
      disposed = true;
      abortController.abort();
      if (loadingRefReleaseTimer) {
        clearTimeout(loadingRefReleaseTimer);
      }
    };
  }, [
    // Intentionally exclude currentSessionId: this effect sets it and should not retrigger another full load.
    isSystemSessionChange,
    loadSessionMessages,
    pendingViewSessionRef,
    resetStreamingState,
    markSessionStatusCheckPending,
    selectedProjectName,
    selectedSessionId,
    selectedViewProvider,
    sendMessage,
    ws,
  ]);

  useEffect(() => {
    if (!externalMessageUpdate || !selectedSessionId || !selectedProjectName) {
      return;
    }

    requestTranscriptReconcile({
      projectName: selectedProjectName,
      sessionId: selectedSessionId,
      provider:
        selectedSessionProvider ||
        (localStorage.getItem('selected-provider') as Provider) ||
        'claude',
    });
  }, [
    externalMessageUpdate,
    requestTranscriptReconcile,
    selectedProjectName,
    selectedSessionId,
    selectedSessionProvider,
  ]);

  useEffect(() => {
    if (!completionReconcileRequest) {
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();
    const timeoutIds = new Set<number>();
    const request = completionReconcileRequest;
    activeCompletionReconcileSequenceRef.current = request.sequence;
    setIsCompletionReconcileActive(true);

    const wait = (delayMs: number) => new Promise<void>((resolve) => {
      const timeoutId = window.setTimeout(() => {
        timeoutIds.delete(timeoutId);
        resolve();
      }, delayMs);
      timeoutIds.add(timeoutId);
    });

    const isRequestedSessionVisible = () => {
      const visibleIdentity = transcriptViewIdentityRef.current;
      return visibleIdentity.projectName === request.projectName
        && [
          visibleIdentity.currentSessionId,
          visibleIdentity.selectedSessionId,
          pendingViewSessionRef.current?.sessionId,
        ].includes(request.sessionId);
    };

    const applyPersistedSnapshot = (messages: any[]) => {
      const offsetBeforeReconcile = messagesOffsetRef.current;
      setSessionMessages((previous) => {
        const reconciled = reconcilePersistedSessionMessages(previous, messages);
        const appendedCount = Math.max(0, reconciled.length - previous.length);
        if (appendedCount > 0 && request.provider !== 'pi') {
          // Use max rather than += so React development-mode updater retries
          // cannot advance the pagination cursor twice.
          messagesOffsetRef.current = Math.max(
            messagesOffsetRef.current,
            offsetBeforeReconcile + appendedCount,
          );
        }
        return reconciled;
      });
    };

    const reconcileCompletedTranscript = async () => {
      let receivedSnapshot = false;
      let previousDelay = 0;
      for (const delay of COMPLETION_RECONCILE_DELAYS_MS) {
        await wait(delay - previousDelay);
        previousDelay = delay;
        if (cancelled) return;

        if (!isRequestedSessionVisible()) {
          break;
        }

        try {
          const messages = await loadSessionMessages(
            request.projectName,
            request.sessionId,
            false,
            request.provider,
            true,
            isRequestedSessionVisible,
            abortController.signal,
          );
          if (cancelled) return;
          if (!isRequestedSessionVisible()) {
            break;
          }
          receivedSnapshot = true;
          // Apply the first advancing snapshot immediately. Later retry pages
          // are merged only if persistence progressed, so an identical retry
          // retains the existing state reference and does not move the UI.
          applyPersistedSnapshot(messages);
        } catch (error) {
          console.error('Error reconciling messages after completion:', error);
        }
      }
      if (!cancelled && receivedSnapshot && isRequestedSessionVisible()) {
        const shouldAutoScroll = Boolean(autoScrollToBottom) && isNearBottom();
        if (shouldAutoScroll) {
          const timeoutId = window.setTimeout(() => {
            timeoutIds.delete(timeoutId);
            if (!cancelled) scrollToBottom();
          }, 200);
          timeoutIds.add(timeoutId);
        }
      }
      if (activeCompletionReconcileSequenceRef.current === request.sequence) {
        setIsCompletionReconcileActive(false);
      }
    };

    void reconcileCompletedTranscript();

    return () => {
      cancelled = true;
      abortController.abort();
      if (activeCompletionReconcileSequenceRef.current === request.sequence) {
        setIsCompletionReconcileActive(false);
      }
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeoutIds.clear();
    };
  }, [
    autoScrollToBottom,
    completionReconcileRequest,
    isNearBottom,
    loadSessionMessages,
    pendingViewSessionRef,
    scrollToBottom,
  ]);

  useEffect(() => {
    if (selectedSession?.id) {
      pendingViewSessionRef.current = null;
    }
  }, [pendingViewSessionRef, selectedSession?.id]);

  useEffect(() => {
    // Sync converted messages to chat state.
    // We update even for empty arrays to clear old state when switching to an empty session.
    setChatMessages((previous) => {
      const optimisticMessages = previous.filter((message) => message.isOptimistic);
      const messagesWithCodexTodo = retainCodexTodoSnapshot(
        previous,
        convertedMessages,
        selectedSessionId || currentSessionId,
      );

      if (shouldHoldLiveTranscript({
        liveMessageCount: previous.length,
        persistedMessageCount: convertedMessages.length,
        isProcessing: isLoading,
        isLoadingPersistedMessages: isLoadingSessionMessages,
        isCompletionReconcileActive,
      })) {
        return previous;
      }

      if (optimisticMessages.length === 0) {
        return messagesWithCodexTodo;
      }

      const normalizedPersistedUserMessages = new Set(
        messagesWithCodexTodo
          .filter((message) => message.type === 'user' && typeof message.content === 'string')
          .map((message) => String(message.content || '').trim()),
      );

      const unmatchedOptimistic = optimisticMessages.filter((message) => {
        const normalizedContent = String(message.content || '').trim();
        return normalizedContent && !normalizedPersistedUserMessages.has(normalizedContent);
      });

      if (unmatchedOptimistic.length > 0) {
        return previous;
      }

      return messagesWithCodexTodo;
    });
  }, [convertedMessages, currentSessionId, isCompletionReconcileActive, isLoading, isLoadingSessionMessages, selectedSessionId, setChatMessages]);

  useEffect(() => {
    const viewIdentity = [
      selectedProjectName || '',
      selectedSessionId || '',
      selectedSessionProvider || '',
    ].join(':');

    // React effects for a newly selected conversation can still observe the
    // previous conversation's chatMessages for one commit. Never persist that
    // stale snapshot under the new provider/session cache key.
    if (persistedChatViewIdentityRef.current !== viewIdentity) {
      persistedChatViewIdentityRef.current = viewIdentity;
      return;
    }

    if (selectedProject?.name && !isVirtualDefaultDraftProject(selectedProject) && chatMessages.length > 0) {
      safeLocalStorage.setItem(
        getChatMessagesStorageKey({
          projectName: selectedProject.name,
          sessionId: selectedSession?.id,
          provider: selectedSession?.__provider,
        }),
        serializeChatMessagesCache({
          projectName: selectedProject.name,
          sessionId: selectedSession?.id,
          provider: selectedSession?.__provider,
        }, chatMessages),
      );
    }
  }, [
    chatMessages,
    selectedProject,
    selectedProjectName,
    selectedSessionProvider,
    selectedSessionId,
  ]);

  useEffect(() => {
    if (cloudSyncTimerRef.current) {
      clearTimeout(cloudSyncTimerRef.current);
      cloudSyncTimerRef.current = null;
    }

    const sessionId = selectedSession?.id;
    if (
      !canSyncConversationArchive
      || isLoading
      || !selectedProject
      || isVirtualDefaultDraftProject(selectedProject)
      || !sessionId
      || sessionId.startsWith('new-session-')
      || chatMessages.length === 0
    ) {
      return undefined;
    }

    const sessionProvider = selectedSession.__provider || 'claude';
    const lastVisibleMessage = [...chatMessages]
      .reverse()
      .find((message) => message.type === 'user' || message.type === 'assistant');
    const syncKey = [
      sessionProvider,
      sessionId,
      chatMessages.length,
      String(lastVisibleMessage?.content || '').length,
      String(lastVisibleMessage?.timestamp || ''),
    ].join(':');
    if (lastCloudSyncKeyRef.current === syncKey) {
      return undefined;
    }

    cloudSyncTimerRef.current = setTimeout(() => {
      void api.conversations.syncFromSession({
        projectName: selectedProject.name,
        projectKey: selectedSession.projectKey || selectedProject.name,
        projectLabel: selectedProject.displayName || '',
        sessionId,
        sessionKey: selectedSession.sessionKey || null,
        runtimeId: selectedSession.runtimeId || (sessionProvider === 'codex' ? 'codex' : 'claude'),
        provider: sessionProvider,
        title: selectedSession.summary || selectedSession.title || selectedSession.name || '',
      }).then((response: Response) => {
        if (response.ok) {
          lastCloudSyncKeyRef.current = syncKey;
        } else {
          console.warn('Failed to sync conversation to the account archive:', response.status);
        }
      }).catch((error: unknown) => {
        console.warn('Failed to sync conversation to the account archive:', error);
      });
    }, 1200);

    return () => {
      if (cloudSyncTimerRef.current) {
        clearTimeout(cloudSyncTimerRef.current);
        cloudSyncTimerRef.current = null;
      }
    };
  }, [
    canSyncConversationArchive,
    chatMessages,
    isLoading,
    selectedProject,
    selectedSession?.__provider,
    selectedSession?.id,
    selectedSession?.name,
    selectedSession?.summary,
    selectedSession?.title,
  ]);

  useEffect(() => {
    if (!selectedProjectName || !selectedSessionId || /^(new-session-|temp-)/.test(selectedSessionId)) {
      setTokenBudget(null);
      return;
    }

    const sessionProvider = selectedSessionProvider || provider;
    let cancelled = false;
    const controller = new AbortController();
    const usageRevision = tokenBudgetRevisionRef.current;
    const timeout = window.setTimeout(() => controller.abort(), 15000);

    const fetchInitialTokenUsage = async () => {
      try {
        const url = `/api/projects/${encodeURIComponent(selectedProjectName)}/sessions/${encodeURIComponent(selectedSessionId)}/token-usage?provider=${encodeURIComponent(sessionProvider)}`;
        const response = await authenticatedFetch(url, { signal: controller.signal });
        if (response.ok) {
          const data = await response.json();
          if (cancelled || usageRevision !== tokenBudgetRevisionRef.current) return;
          const budget = sessionProvider === 'pi' ? piTokenBudget(data) : data as TokenBudget;
          if (sessionProvider !== 'pi' || hasPiTokenBudget(budget)) setTokenBudget(budget);
        }
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) console.error('Failed to fetch initial token usage:', error);
      } finally { window.clearTimeout(timeout); }
    };

    fetchInitialTokenUsage();
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timeout); };
  }, [selectedProjectName, selectedSessionId, selectedSessionProvider, provider, setTokenBudget]);

  const visibleMessages = useMemo(() => {
    if (chatMessages.length <= visibleMessageCount) {
      return chatMessages;
    }
    return chatMessages.slice(-visibleMessageCount);
  }, [chatMessages, visibleMessageCount]);

  useEffect(() => {
    if (!autoScrollToBottom && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      scrollPositionRef.current = {
        height: container.scrollHeight,
        top: container.scrollTop,
      };
    }
  });

  useEffect(() => {
    if (!scrollContainerRef.current || chatMessages.length === 0) {
      return;
    }

    if (isLoadingMoreRef.current || isLoadingMoreMessages || pendingScrollRestoreRef.current) {
      return;
    }

    if (autoScrollToBottom) {
      if (!isUserScrolledUp) {
        setTimeout(() => scrollToBottom(), 50);
      }
      return;
    }

    const container = scrollContainerRef.current;
    const prevHeight = scrollPositionRef.current.height;
    const prevTop = scrollPositionRef.current.top;
    const newHeight = container.scrollHeight;
    const heightDiff = newHeight - prevHeight;

    if (heightDiff > 0 && prevTop > 0) {
      container.scrollTop = prevTop + heightDiff;
    }
  }, [autoScrollToBottom, chatMessages.length, isLoadingMoreMessages, isUserScrolledUp, scrollToBottom]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    const activeViewSessionId = resolveActiveSessionId({
      isProcessing: isLoading,
      currentSessionId,
      selectedSessionId: selectedSession?.id,
      pendingSessionId: pendingViewSessionRef.current?.sessionId,
    });
    if (!activeViewSessionId) {
      return;
    }

    const persistedStartTime = readSessionTimerStart(activeViewSessionId);
    const isTrackedProcessing = isTrackedProcessingSession(activeViewSessionId);
    if (persistedStartTime && isTrackedProcessing) {
      setClaudeStatus((previous) => {
        if (previous?.startTime === persistedStartTime) {
          return previous;
        }

        return {
          text: previous?.text || RESUMING_STATUS_TEXT,
          tokens: previous?.tokens || 0,
          can_interrupt: previous?.can_interrupt !== false,
          startTime: persistedStartTime,
        };
      });
    }

    const isAbortPending = isSessionAbortRequested(activeViewSessionId);
    const shouldBeProcessing = isTrackedProcessing && !isAbortPending;

    if (shouldBeProcessing && !isLoading) {
      setIsLoading(true);
      setCanAbortSession(true);
    }
  }, [currentSessionId, isLoading, pendingStatusValidationSessionId, processingSessions, selectedSession?.id]);

  useEffect(() => {
    const activeViewSessionId = resolveActiveSessionId({
      isProcessing: isLoading,
      currentSessionId,
      selectedSessionId: selectedSession?.id,
      pendingSessionId: pendingViewSessionRef.current?.sessionId,
    });
    if (!activeViewSessionId || pendingStatusValidationSessionId !== activeViewSessionId) {
      return;
    }

    const persistedStartTime = readSessionTimerStart(activeViewSessionId);
    if (!persistedStartTime) {
      return;
    }
    if (isSessionAbortRequested(activeViewSessionId)) {
      setPendingStatusValidationSessionId((previous) => (previous === activeViewSessionId ? null : previous));
      clearSessionTimerStart(activeViewSessionId);
      onSessionInactive?.(activeViewSessionId);
      onSessionNotProcessing?.(activeViewSessionId);
      setIsLoading(false);
      setCanAbortSession(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const latestPersistedStartTime = readSessionTimerStart(activeViewSessionId);
      if (latestPersistedStartTime !== persistedStartTime) {
        return;
      }
      if (isTrackedProcessingSession(activeViewSessionId)) {
        return;
      }

      clearSessionTimerStart(activeViewSessionId);
      setPendingStatusValidationSessionId((previous) => (previous === activeViewSessionId ? null : previous));
      setClaudeStatus((previous) => (previous?.text === RESUMING_STATUS_TEXT ? null : previous));
      onSessionInactive?.(activeViewSessionId);
      onSessionNotProcessing?.(activeViewSessionId);
      setIsLoading(false);
      setCanAbortSession(false);
    }, STATUS_VALIDATION_TIMEOUT_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [
    currentSessionId,
    isLoading,
    onSessionInactive,
    onSessionNotProcessing,
    pendingStatusValidationSessionId,
    processingSessions,
    selectedSession?.id,
  ]);

  // A provider can finish after its terminal WebSocket event was lost. Polling
  // real active session ids makes the backend authoritative and prevents the
  // elapsed-time indicator from running forever on a completed task.
  useEffect(() => {
    const activeViewSessionId = resolveActiveSessionId({
      isProcessing: isLoading,
      currentSessionId,
      selectedSessionId: selectedSession?.id,
      pendingSessionId: pendingViewSessionRef.current?.sessionId,
    });
    if (
      !isLoading
      || !activeViewSessionId
      || activeViewSessionId.startsWith('new-session-')
      || !ws
      || ws.readyState !== WebSocket.OPEN
    ) {
      return undefined;
    }

    const currentProvider = (
      selectedSessionId === activeViewSessionId
        ? selectedViewProvider
          || safeLocalStorage.getItem('selected-provider')
          || 'claude'
        : pendingViewSessionRef.current?.provider || provider
    ) as Provider;
    const checkStatus = () => {
      sendMessage({
        type: 'check-session-status',
        sessionId: activeViewSessionId,
        provider: currentProvider,
        runtimeId: currentProvider,
        projectKey: selectedProjectName,
      });
    };

    let intervalId: number | null = null;
    const initialTimeoutId = window.setTimeout(() => {
      checkStatus();
      intervalId = window.setInterval(checkStatus, ACTIVE_SESSION_STATUS_POLL_MS);
    }, ACTIVE_SESSION_STATUS_POLL_INITIAL_DELAY_MS);

    return () => {
      window.clearTimeout(initialTimeoutId);
      if (intervalId !== null) window.clearInterval(intervalId);
    };
  }, [
    currentSessionId,
    isLoading,
    provider,
    selectedSession?.id,
    selectedViewProvider,
    sendMessage,
    ws,
  ]);

  return {
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
    hasOlderMessages: hasMoreMessages || chatMessages.length > visibleMessageCount,
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
    isNearBottom,
    handleScroll,
    loadSessionMessages,
    requestTranscriptReconcile,
    resolveSessionStatusCheck,
  };
}
