import type { ProviderSettings } from '../types/types';

export const CLAUDE_SETTINGS_KEY = 'claude-settings';
export const CODEX_SETTINGS_KEY = 'codex-settings';
const SESSION_TIMER_PREFIX = 'session_timer_start_';
const ABORT_REQUESTED_SESSION_KEY = 'chat_abort_requested_session_id';
const ABORT_REQUESTED_AT_KEY = 'chat_abort_requested_at';
const PENDING_SESSION_PREFIX = 'chat_pending_session_';
const CHAT_MESSAGES_CACHE_VERSION = 2;

type ChatMessagesCacheIdentity = {
  projectName: string;
  sessionId?: string | null;
  provider?: string | null;
};

type StoredChatMessagesCache<T> = {
  version: typeof CHAT_MESSAGES_CACHE_VERSION;
  identity: {
    projectName: string;
    sessionId: string | null;
    provider: string;
  };
  messages: T[];
};

const normalizeChatMessagesCacheIdentity = ({
  projectName,
  sessionId,
  provider,
}: ChatMessagesCacheIdentity) => ({
  projectName: projectName.trim(),
  sessionId: typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : null,
  provider: typeof provider === 'string' && provider.trim() ? provider.trim() : 'claude',
});

export function getChatMessagesStorageKey({
  projectName,
  sessionId,
  provider,
}: {
  projectName: string;
  sessionId?: string | null;
  provider?: string | null;
}) {
  const scope = sessionId
    ? `${provider || 'claude'}:${sessionId}`
    : 'draft';
  return `chat_messages_${projectName}:${scope}`;
}

export function getPendingSessionStorageKey(provider?: string | null): string {
  const normalizedProvider = typeof provider === 'string' && provider.trim()
    ? provider.trim()
    : 'claude';
  return `${PENDING_SESSION_PREFIX}${normalizedProvider}`;
}

export function persistPendingSessionId(
  provider: string | null | undefined,
  sessionId: string | null | undefined,
) {
  if (!sessionId) {
    return;
  }
  safeSessionStorage.setItem(getPendingSessionStorageKey(provider), sessionId);
  safeSessionStorage.removeItem('pendingSessionId');
}

export function readPendingSessionId(provider?: string | null): string | null {
  return safeSessionStorage.getItem(getPendingSessionStorageKey(provider));
}

export function clearPendingSessionId(
  provider?: string | null,
  expectedSessionId?: string | null,
) {
  const key = getPendingSessionStorageKey(provider);
  const current = safeSessionStorage.getItem(key);
  if (expectedSessionId && current && current !== expectedSessionId) {
    return;
  }
  safeSessionStorage.removeItem(key);
  safeSessionStorage.removeItem('pendingSessionId');
}

export function serializeChatMessagesCache<T>(
  identity: ChatMessagesCacheIdentity,
  messages: T[],
): string {
  const stored: StoredChatMessagesCache<T> = {
    version: CHAT_MESSAGES_CACHE_VERSION,
    identity: normalizeChatMessagesCacheIdentity(identity),
    messages,
  };
  return JSON.stringify(stored);
}

export function parseChatMessagesCache<T>(
  rawValue: string,
  identity: ChatMessagesCacheIdentity,
): T[] | null {
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    const expectedIdentity = normalizeChatMessagesCacheIdentity(identity);

    // Legacy caches were plain arrays and carried no ownership information.
    // Keep draft recovery, but never trust an unscoped persisted-session cache:
    // an older renderer could have written another session's transcript there.
    if (Array.isArray(parsed)) {
      return expectedIdentity.sessionId ? null : parsed as T[];
    }

    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const stored = parsed as Partial<StoredChatMessagesCache<T>>;
    if (
      stored.version !== CHAT_MESSAGES_CACHE_VERSION
      || !stored.identity
      || !Array.isArray(stored.messages)
    ) {
      return null;
    }

    const storedIdentity = normalizeChatMessagesCacheIdentity(stored.identity);
    if (
      storedIdentity.projectName !== expectedIdentity.projectName
      || storedIdentity.sessionId !== expectedIdentity.sessionId
      || storedIdentity.provider !== expectedIdentity.provider
    ) {
      return null;
    }

    return stored.messages;
  } catch {
    return null;
  }
}

const safeSessionStorage = {
  setItem: (key: string, value: string) => {
    try {
      sessionStorage.setItem(key, value);
    } catch (error) {
      console.error('sessionStorage setItem error:', error);
    }
  },
  getItem: (key: string): string | null => {
    try {
      return sessionStorage.getItem(key);
    } catch (error) {
      console.error('sessionStorage getItem error:', error);
      return null;
    }
  },
  removeItem: (key: string) => {
    try {
      sessionStorage.removeItem(key);
    } catch (error) {
      console.error('sessionStorage removeItem error:', error);
    }
  },
};

const isTemporarySessionId = (sessionId: string): boolean => (
  sessionId.startsWith('new-session-') || sessionId.startsWith('temp-')
);

export function getProviderSettingsKey(provider?: string) {
  switch (provider) {
    case 'codex': return CODEX_SETTINGS_KEY;
    default: return CLAUDE_SETTINGS_KEY;
  }
}

export const safeLocalStorage = {
  setItem: (key: string, value: string) => {
    try {
      if (key.startsWith('chat_messages_') && typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          const messages = Array.isArray(parsed)
            ? parsed
            : parsed && typeof parsed === 'object' && Array.isArray(parsed.messages)
              ? parsed.messages
              : null;
          if (messages && messages.length > 50) {
            const truncated = messages.slice(-50);
            value = JSON.stringify(Array.isArray(parsed)
              ? truncated
              : { ...parsed, messages: truncated });
          }
        } catch (parseError) {
          console.warn('Could not parse chat messages for truncation:', parseError);
        }
      }

      localStorage.setItem(key, value);
    } catch (error: any) {
      if (error?.name === 'QuotaExceededError') {
        console.warn('localStorage quota exceeded, clearing old data');

        const keys = Object.keys(localStorage);
        const chatKeys = keys.filter((k) => k.startsWith('chat_messages_')).sort();

        if (chatKeys.length > 3) {
          chatKeys.slice(0, chatKeys.length - 3).forEach((k) => {
            localStorage.removeItem(k);
          });
        }

        const draftKeys = keys.filter((k) => k.startsWith('draft_input_'));
        draftKeys.forEach((k) => {
          localStorage.removeItem(k);
        });

        try {
          localStorage.setItem(key, value);
        } catch (retryError) {
          console.error('Failed to save to localStorage even after cleanup:', retryError);
          if (key.startsWith('chat_messages_') && typeof value === 'string') {
            try {
              const parsed = JSON.parse(value);
              const messages = Array.isArray(parsed)
                ? parsed
                : parsed && typeof parsed === 'object' && Array.isArray(parsed.messages)
                  ? parsed.messages
                  : null;
              if (messages && messages.length > 10) {
                const minimal = messages.slice(-10);
                localStorage.setItem(key, JSON.stringify(Array.isArray(parsed)
                  ? minimal
                  : { ...parsed, messages: minimal }));
              }
            } catch (finalError) {
              console.error('Final save attempt failed:', finalError);
            }
          }
        }
      } else {
        console.error('localStorage error:', error);
      }
    }
  },
  getItem: (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.error('localStorage getItem error:', error);
      return null;
    }
  },
  removeItem: (key: string) => {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error('localStorage removeItem error:', error);
    }
  },
};

export function persistSessionTimerStart(sessionId: string | null | undefined, startTime: number | null | undefined) {
  if (!sessionId || !Number.isFinite(startTime)) {
    return;
  }

  safeSessionStorage.setItem(`${SESSION_TIMER_PREFIX}${sessionId}`, String(startTime));
}

export function readSessionTimerStart(sessionId: string | null | undefined): number | null {
  if (!sessionId) {
    return null;
  }

  const raw = safeSessionStorage.getItem(`${SESSION_TIMER_PREFIX}${sessionId}`);
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function clearSessionTimerStart(sessionId: string | null | undefined) {
  if (!sessionId) {
    return;
  }

  safeSessionStorage.removeItem(`${SESSION_TIMER_PREFIX}${sessionId}`);
}

export function clearTemporarySessionTimerStarts() {
  try {
    const keysToRemove: string[] = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (!key?.startsWith(SESSION_TIMER_PREFIX)) {
        continue;
      }

      const sessionId = key.slice(SESSION_TIMER_PREFIX.length);
      if (isTemporarySessionId(sessionId)) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach((key) => sessionStorage.removeItem(key));
  } catch (error) {
    console.error('sessionStorage clear temporary timers error:', error);
  }
}

export function moveSessionTimerStart(fromSessionId: string | null | undefined, toSessionId: string | null | undefined) {
  if (!fromSessionId || !toSessionId || fromSessionId === toSessionId) {
    return;
  }

  const startTime = readSessionTimerStart(fromSessionId);
  if (!Number.isFinite(startTime)) {
    return;
  }

  persistSessionTimerStart(toSessionId, startTime);
  clearSessionTimerStart(fromSessionId);
}

export function markSessionAbortRequested(sessionId: string | null | undefined) {
  if (!sessionId) {
    return;
  }

  safeSessionStorage.setItem(ABORT_REQUESTED_SESSION_KEY, sessionId);
  safeSessionStorage.setItem(ABORT_REQUESTED_AT_KEY, String(Date.now()));
}

export function readSessionAbortRequested(): string | null {
  return safeSessionStorage.getItem(ABORT_REQUESTED_SESSION_KEY);
}

export function isSessionAbortRequested(sessionId: string | null | undefined): boolean {
  if (!sessionId) {
    return false;
  }

  return readSessionAbortRequested() === sessionId;
}

export function clearSessionAbortRequested(sessionId?: string | null) {
  const current = readSessionAbortRequested();
  if (sessionId && current && current !== sessionId) {
    return;
  }

  safeSessionStorage.removeItem(ABORT_REQUESTED_SESSION_KEY);
  safeSessionStorage.removeItem(ABORT_REQUESTED_AT_KEY);
}

export function getProviderSettings(provider?: string): ProviderSettings {
  const raw = safeLocalStorage.getItem(getProviderSettingsKey(provider));
  if (!raw) {
    return {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false,
      projectSortOrder: 'date',
    };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      ...parsed,
      allowedTools: Array.isArray(parsed.allowedTools) ? parsed.allowedTools : [],
      disallowedTools: Array.isArray(parsed.disallowedTools) ? parsed.disallowedTools : [],
      skipPermissions: Boolean(parsed.skipPermissions),
      projectSortOrder: parsed.projectSortOrder || 'date',
    };
  } catch {
    return {
      allowedTools: [],
      disallowedTools: [],
      skipPermissions: false,
      projectSortOrder: 'date',
    };
  }
}
