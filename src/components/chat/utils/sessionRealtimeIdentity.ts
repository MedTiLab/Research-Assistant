import type { RuntimeId, SessionProvider } from '../../../types/app';
import { normalizeRuntimeId } from '../../../../shared/agentSessionIdentity';

type SessionIdentityMessage = {
  type?: unknown;
  data?: unknown;
  sessionId?: unknown;
  actualSessionId?: unknown;
  provider?: unknown;
  runtimeId?: unknown;
  projectKey?: unknown;
  projectName?: unknown;
  isProcessing?: unknown;
};

type ActiveSessionIdentityOptions = {
  isProcessing: boolean;
  currentSessionId?: string | null;
  selectedSessionId?: string | null;
  pendingSessionId?: string | null;
  promotedSessionIds?: ReadonlyMap<string, string>;
};

type ProcessingStatePropagationOptions = {
  isProcessing: boolean;
  currentSessionId?: string | null;
  selectedSessionId?: string | null;
};

type ConnectionRecoveryStatusOptions = {
  isProcessing: boolean;
  socketAvailable: boolean;
  localTurnAwaitingBackend: boolean;
};

type ChatViewIdentityOptions = {
  projectKey?: string | null;
  sessionId?: string | null;
  provider?: SessionProvider | null;
  draftRequestKey?: string | number | null;
};

export type ChatViewContinuityState = {
  projectKey: string;
  sessionId: string | null;
  provider: string;
  wasDraft: boolean;
  key: string;
  promotedSession?: {
    projectKey: string;
    sessionId: string;
    provider: string;
    key: string;
  } | null;
};

const COMPLETION_PROVIDERS: Record<string, SessionProvider> = {
  'claude-complete': 'claude',
  'codex-complete': 'codex',
  'pi-complete': 'pi',
  'localgpu-complete': 'local',
};

const MESSAGE_TYPE_PROVIDERS: Record<string, SessionProvider> = {
  'claude-response': 'claude',
  'claude-output': 'claude',
  'claude-status': 'claude',
  'claude-error': 'claude',
  'claude-complete': 'claude',
  'codex-response': 'codex',
  'codex-error': 'codex',
  'codex-complete': 'codex',
  'pi-response': 'pi',
  'pi-error': 'pi',
  'pi-complete': 'pi',
  'localgpu-response': 'local',
  'localgpu-error': 'local',
  'localgpu-complete': 'local',
};

const SESSION_PROVIDERS = new Set<SessionProvider>([
  'claude',
  'codex',
  'pi',
  'openrouter',
  'local',
]);

const normalizeSessionId = (value: unknown): string | null => (
  typeof value === 'string' && value.trim() ? value : null
);

const normalizeIdentityPart = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

/**
 * A chat surface owns exactly one project/provider/session identity for its
 * entire React lifetime. Changing any part must remount the surface so local
 * transcript, loading, timers, and async effects cannot be reused by another
 * conversation.
 */
export function getChatViewIdentityKey({
  projectKey,
  sessionId,
  provider,
  draftRequestKey,
}: ChatViewIdentityOptions): string {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const isDraftView = !normalizedSessionId || isTemporarySessionId(normalizedSessionId);
  const normalizedDraftRequestKey = typeof draftRequestKey === 'number'
    ? String(draftRequestKey)
    : normalizeIdentityPart(draftRequestKey);
  return JSON.stringify([
    normalizeIdentityPart(projectKey),
    isDraftView ? 'draft' : normalizeIdentityPart(provider) || 'unassigned-runtime',
    isDraftView
      ? `draft:${normalizedDraftRequestKey || 'initial'}`
      : normalizedSessionId,
  ]);
}

/**
 * Keep the mounted draft chat surface when the backend replaces its temporary
 * id with the real provider session id. Ordinary sidebar navigation still
 * receives a different key and remounts the surface for conversation safety.
 */
export function resolveChatViewContinuity({
  previous,
  projectKey,
  sessionId,
  provider,
  draftRequestKey,
  isDraftPromotion = false,
  isDraftProjectPromotion = false,
}: ChatViewIdentityOptions & {
  previous?: ChatViewContinuityState | null;
  isDraftPromotion?: boolean;
  isDraftProjectPromotion?: boolean;
}): { key: string; state: ChatViewContinuityState } {
  const normalizedProjectKey = normalizeIdentityPart(projectKey);
  const normalizedSessionId = normalizeSessionId(sessionId);
  const normalizedProvider = normalizeIdentityPart(provider) || 'unassigned-runtime';
  const wasDraft = !normalizedSessionId || isTemporarySessionId(normalizedSessionId);
  const defaultKey = getChatViewIdentityKey({
    projectKey,
    sessionId,
    provider,
    draftRequestKey,
  });

  let key = defaultKey;
  let promotedSession: ChatViewContinuityState['promotedSession'] = null;
  const existingPromotion = previous?.promotedSession;

  if (
    wasDraft
    && isDraftProjectPromotion
    && previous?.wasDraft
  ) {
    // The first submit moves the still-mounted draft from the virtual/default
    // workspace into its newly allocated conversation directory. This is one
    // logical chat, so changing only its backing project must not remount it.
    key = previous.key;
  } else if (
    !wasDraft
    && existingPromotion
    && existingPromotion.projectKey === normalizedProjectKey
    && existingPromotion.sessionId === normalizedSessionId
    && existingPromotion.provider === normalizedProvider
  ) {
    key = existingPromotion.key;
    promotedSession = existingPromotion;
  } else if (
    !wasDraft
    && isDraftPromotion
    && previous?.wasDraft
  ) {
    key = previous.key;
    promotedSession = {
      projectKey: normalizedProjectKey,
      sessionId: normalizedSessionId as string,
      provider: normalizedProvider,
      key,
    };
  }

  return {
    key,
    state: {
      projectKey: normalizedProjectKey,
      sessionId: normalizedSessionId,
      provider: normalizedProvider,
      wasDraft,
      key,
      promotedSession,
    },
  };
}

function isTemporarySessionId(value: unknown): boolean {
  const sessionId = normalizeSessionId(value);
  return Boolean(sessionId && (
    sessionId.startsWith('new-session-')
    || sessionId.startsWith('temp-')
  ));
}

export const promoteSessionId = (
  sessionId: string | null,
  promotedSessionIds?: ReadonlyMap<string, string>,
) => {
  if (!sessionId) return null;
  return promotedSessionIds?.get(sessionId) || sessionId;
};

/**
 * During a running turn, the live id is authoritative because the sidebar
 * selection can lag behind temporary-id promotion or socket reattachment.
 * When idle, ordinary sidebar navigation remains authoritative.
 */
export function resolveActiveSessionId({
  isProcessing,
  currentSessionId,
  selectedSessionId,
  pendingSessionId,
  promotedSessionIds,
}: ActiveSessionIdentityOptions): string | null {
  const selected = normalizeSessionId(selectedSessionId);

  // A real sidebar selection is an explicit user action and must always win.
  // pendingSessionId belongs to the turn that was started from a draft view;
  // keeping it authoritative after the user opens another real conversation
  // routes the background provider's stream into the newly selected view.
  if (selected && !isTemporarySessionId(selected)) {
    return promoteSessionId(selected, promotedSessionIds);
  }

  // A pending id represents a turn started from the draft/new-session view.
  // It is authoritative only while the view itself is still a draft. A stale
  // internal currentSessionId must never route another session's deltas,
  // submits, or aborts into a real selected conversation.
  const candidates = isProcessing && normalizeSessionId(pendingSessionId)
    ? [pendingSessionId, selectedSessionId, currentSessionId]
    : [selectedSessionId, currentSessionId, pendingSessionId];

  for (const candidate of candidates) {
    const normalized = normalizeSessionId(candidate);
    if (normalized) return promoteSessionId(normalized, promotedSessionIds);
  }
  return null;
}

/**
 * Local loading state can survive for one render while the user navigates
 * from a running conversation to another real sidebar session. That stale
 * render must not promote the newly selected session into the global active
 * set; only the session that already owns the view may be propagated.
 */
export function shouldPropagateProcessingState({
  isProcessing,
  currentSessionId,
  selectedSessionId,
}: ProcessingStatePropagationOptions): boolean {
  if (!isProcessing) {
    return false;
  }

  const selected = normalizeSessionId(selectedSessionId);
  if (!selected || isTemporarySessionId(selected)) {
    return true;
  }

  return normalizeSessionId(currentSessionId) === selected;
}

/**
 * "Resuming" describes an already-running turn whose realtime connection was
 * interrupted. A turn submitted locally has not been interrupted while it is
 * still waiting for its first backend event, even if the socket is briefly
 * unavailable and the outbound message is queued.
 */
export function shouldShowConnectionRecoveryStatus({
  isProcessing,
  socketAvailable,
  localTurnAwaitingBackend,
}: ConnectionRecoveryStatusOptions): boolean {
  return isProcessing && !socketAvailable && !localTurnAwaitingBackend;
}

export function shouldPreserveLiveSessionOnRefresh({
  isProcessing,
  currentSessionId,
  selectedSessionId,
  selectionChanged,
}: {
  isProcessing: boolean;
  currentSessionId?: string | null;
  selectedSessionId?: string | null;
  selectionChanged: boolean;
}) {
  return Boolean(
    isProcessing
    && !selectionChanged
    && normalizeSessionId(currentSessionId)
    && !normalizeSessionId(selectedSessionId),
  );
}

export function shouldAlignViewWithSession({
  targetSessionId,
  currentSessionId,
  selectedSessionId,
  pendingSessionId,
  promotedSessionIds,
}: {
  targetSessionId?: string | null;
  currentSessionId?: string | null;
  selectedSessionId?: string | null;
  pendingSessionId?: string | null;
  promotedSessionIds?: ReadonlyMap<string, string>;
}): boolean {
  const target = promoteSessionId(normalizeSessionId(targetSessionId), promotedSessionIds);
  if (!target) return false;

  const selected = normalizeSessionId(selectedSessionId);
  const promotedSelected = promoteSessionId(selected, promotedSessionIds);
  if (selected && !isTemporarySessionId(selected)) {
    return promotedSelected === target;
  }

  const candidates = [selected, currentSessionId, pendingSessionId]
    .map((sessionId) => normalizeSessionId(sessionId))
    .filter((sessionId): sessionId is string => Boolean(sessionId));

  return candidates.some((sessionId) => (
    promoteSessionId(sessionId, promotedSessionIds) === target
    || isTemporarySessionId(sessionId)
  ));
}

export function shouldAdoptCreatedSession({
  currentSessionId,
  selectedSessionId,
  pendingSessionId,
  previousSessionId,
  hasPendingView,
}: {
  currentSessionId?: string | null;
  selectedSessionId?: string | null;
  pendingSessionId?: string | null;
  previousSessionId?: string | null;
  hasPendingView: boolean;
}): boolean {
  const current = normalizeSessionId(currentSessionId);
  const selected = normalizeSessionId(selectedSessionId);
  const pending = normalizeSessionId(pendingSessionId);
  const previous = normalizeSessionId(previousSessionId);

  // A real sidebar selection is an explicit user choice. A global
  // session-created event may only replace it when the server says that exact
  // selected id was promoted.
  if (selected && !isTemporarySessionId(selected)) {
    return Boolean(previous && previous === selected);
  }

  if (previous && [current, selected, pending].includes(previous)) {
    return true;
  }

  return Boolean(
    isTemporarySessionId(current)
    || isTemporarySessionId(selected)
    || (hasPendingView && (!pending || isTemporarySessionId(pending))),
  );
}

export function getRealtimeMessageSessionIds(
  message: SessionIdentityMessage | null | undefined,
  promotedSessionIds?: ReadonlyMap<string, string>,
): string[] {
  const ids = [message?.actualSessionId, message?.sessionId]
    .map(normalizeSessionId)
    .filter((sessionId): sessionId is string => Boolean(sessionId))
    .map((sessionId) => promoteSessionId(sessionId, promotedSessionIds) || sessionId);
  return [...new Set(ids)];
}

export function realtimeMessageMatchesSession(
  message: SessionIdentityMessage | null | undefined,
  activeSessionId: string | null,
  promotedSessionIds?: ReadonlyMap<string, string>,
) {
  const promotedActiveSessionId = promoteSessionId(activeSessionId, promotedSessionIds);
  if (!promotedActiveSessionId) return false;
  return getRealtimeMessageSessionIds(message, promotedSessionIds).includes(promotedActiveSessionId);
}

export function getRealtimeMessageProvider(
  message: SessionIdentityMessage | null | undefined,
): SessionProvider | null {
  const explicitProvider = typeof message?.provider === 'string'
    ? message.provider as SessionProvider
    : null;
  if (explicitProvider && SESSION_PROVIDERS.has(explicitProvider)) {
    return explicitProvider;
  }

  const messageType = typeof message?.type === 'string' ? message.type : '';
  return MESSAGE_TYPE_PROVIDERS[messageType] || null;
}

export function getRealtimeMessageRuntimeId(
  message: SessionIdentityMessage | null | undefined,
): RuntimeId | null {
  const explicitRuntimeValue = typeof message?.runtimeId === 'string'
    ? message.runtimeId
    : message?.provider;
  const explicitRuntimeId = normalizeRuntimeId(explicitRuntimeValue);
  if (explicitRuntimeId) return explicitRuntimeId;

  // Existing Claude/Codex transports predate runtimeId. This compatibility
  // map is intentionally closed; new runtimes must send runtimeId explicitly.
  const legacyProvider = getRealtimeMessageProvider(message);
  return normalizeRuntimeId(legacyProvider);
}

export function realtimeMessageMatchesView(
  message: SessionIdentityMessage | null | undefined,
  {
    activeSessionId,
    activeProvider,
    activeRuntimeId,
    activeProjectKey,
    promotedSessionIds,
  }: {
    activeSessionId: string | null;
    activeProvider?: SessionProvider | null;
    activeRuntimeId?: RuntimeId | null;
    activeProjectKey?: string | null;
    promotedSessionIds?: ReadonlyMap<string, string>;
  },
): boolean {
  if (!realtimeMessageMatchesSession(message, activeSessionId, promotedSessionIds)) {
    return false;
  }

  const messageProjectKey = normalizeIdentityPart(message?.projectKey)
    || normalizeIdentityPart(message?.projectName);
  if (
    normalizeIdentityPart(activeProjectKey)
    && messageProjectKey
    && messageProjectKey !== normalizeIdentityPart(activeProjectKey)
  ) {
    return false;
  }

  const expectedRuntimeId = activeRuntimeId || normalizeRuntimeId(activeProvider);
  const messageRuntimeId = getRealtimeMessageRuntimeId(message);
  if (expectedRuntimeId && messageRuntimeId) {
    return expectedRuntimeId === messageRuntimeId;
  }

  const messageProvider = getRealtimeMessageProvider(message);
  return !activeProvider || !messageProvider || messageProvider === activeProvider;
}

export function getCompletionSessionIdentity(
  message: SessionIdentityMessage | null | undefined,
): {
  sessionId: string;
  provider: SessionProvider;
  runtimeId: RuntimeId | null;
  projectKey: string | null;
} | null {
  const messageType = typeof message?.type === 'string' ? message.type : '';
  const provider = COMPLETION_PROVIDERS[messageType];
  const sessionId = normalizeSessionId(message?.actualSessionId)
    || normalizeSessionId(message?.sessionId);
  return provider && sessionId ? {
    sessionId,
    provider,
    runtimeId: getRealtimeMessageRuntimeId(message),
    projectKey: normalizeSessionId(message?.projectKey) || normalizeSessionId(message?.projectName),
  } : null;
}

export function getTerminalTranscriptIdentity(
  message: SessionIdentityMessage | null | undefined,
  {
    currentSessionId,
    selectedSessionId,
    pendingSessionId,
    fallbackProvider,
  }: {
    currentSessionId?: string | null;
    selectedSessionId?: string | null;
    pendingSessionId?: string | null;
    fallbackProvider: SessionProvider;
  },
): { sessionId: string; provider: SessionProvider } | null {
  const completionIdentity = getCompletionSessionIdentity(message);
  if (completionIdentity) {
    return completionIdentity;
  }

  const messageType = typeof message?.type === 'string' ? message.type : '';
  const dataType = message?.data && typeof message.data === 'object' && 'type' in message.data
    ? String((message.data as { type?: unknown }).type || '')
    : '';
  let provider: SessionProvider | null = null;

  if (messageType === 'codex-response' && (dataType === 'turn_complete' || dataType === 'turn_failed')) {
    provider = 'codex';
  } else if (messageType === 'claude-response' && dataType === 'result') {
    provider = 'claude';
  } else if (messageType === 'session-status' && message?.isProcessing === false) {
    provider = ['claude', 'codex', 'pi', 'openrouter', 'local'].includes(String(message.provider))
      ? message.provider as SessionProvider
      : fallbackProvider;
  }

  if (!provider) {
    return null;
  }

  const sessionId = normalizeSessionId(message?.actualSessionId)
    || normalizeSessionId(message?.sessionId)
    || normalizeSessionId(currentSessionId)
    || normalizeSessionId(pendingSessionId)
    || normalizeSessionId(selectedSessionId);
  return sessionId ? { sessionId, provider } : null;
}
