import { isTemporaryAgentSessionId, parseAgentSessionKey } from '../../../shared/agentSessionIdentity';
import type { AgentSessionIdentity, RuntimeId, SessionProvider } from '../../types/app';
import {
  createClientAgentSessionIdentity,
  createClientAgentSessionKey,
  getRuntimeIdForSessionProvider,
} from '../../utils/agentSessionIdentity';

type ActiveSessionEntry =
  | string
  | {
      id?: unknown;
      sessionId?: unknown;
      runtimeId?: unknown;
      provider?: unknown;
      projectKey?: unknown;
      [key: string]: unknown;
    };

type ActiveSessionGroups = Partial<Record<SessionProvider | RuntimeId | string, ActiveSessionEntry[]>>;

const normalizeId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
};
export const getActiveSessionEntryId = (entry: unknown): string | null => {
  const directId = normalizeId(entry);
  if (directId) return directId;
  if (!entry || typeof entry !== 'object') return null;
  const activeEntry = entry as { id?: unknown; sessionId?: unknown };
  return normalizeId(activeEntry.id) || normalizeId(activeEntry.sessionId);
};

export const getActiveSessionEntryIdentity = (
  entry: unknown,
  groupRuntimeId?: string,
): AgentSessionIdentity | null => {
  if (!entry || typeof entry !== 'object') return null;
  const source = entry as Record<string, unknown>;
  return createClientAgentSessionIdentity(getActiveSessionEntryId(entry), {
    projectKey: normalizeId(source.projectKey),
    runtimeId: getRuntimeIdForSessionProvider(
      normalizeId(source.runtimeId) || normalizeId(source.provider) || groupRuntimeId,
    ),
  });
};

export const isTemporarySessionId = (sessionId: string): boolean => (
  isTemporaryAgentSessionId(sessionId)
);

export const collectActiveSessionKeys = (
  sessionGroups: unknown,
  processingSessions: Iterable<string> = [],
): Set<string> => {
  const sessionKeys = new Set<string>();
  const groups = sessionGroups && typeof sessionGroups === 'object'
    ? sessionGroups as ActiveSessionGroups
    : {};

  Object.entries(groups).forEach(([groupRuntimeId, group]) => {
    if (!Array.isArray(group)) return;
    group.forEach((entry) => {
      const identity = getActiveSessionEntryIdentity(entry, groupRuntimeId);
      if (identity) sessionKeys.add(createClientAgentSessionKey(identity.sessionId, identity) as string);
    });
  });

  for (const sessionKey of processingSessions) {
    const identity = parseAgentSessionKey(sessionKey);
    if (identity && isTemporaryAgentSessionId(identity.sessionId)) {
      sessionKeys.add(sessionKey);
    }
  }
  return sessionKeys;
};

/** @deprecated Use collectActiveSessionKeys; retained for extension compatibility. */
export const collectActiveSessionIds = collectActiveSessionKeys;

export const getLifecycleSessionIds = (message: unknown): string[] => {
  if (!message || typeof message !== 'object') return [];
  const source = message as Record<string, unknown>;
  return [source.sessionId, source.actualSessionId, source.previousSessionId]
    .map(normalizeId)
    .filter((sessionId, index, allIds): sessionId is string => (
      Boolean(sessionId) && allIds.indexOf(sessionId) === index
    ));
};

export const getLifecycleSessionIdentities = (
  message: unknown,
  fallback: { projectKey?: string | null; runtimeId?: RuntimeId | string | null } = {},
): AgentSessionIdentity[] => {
  if (!message || typeof message !== 'object') return [];
  const source = message as Record<string, unknown>;
  const projectKey = normalizeId(source.projectKey)
    || normalizeId(source.projectName)
    || normalizeId(fallback.projectKey);
  const runtimeId = getRuntimeIdForSessionProvider(
    normalizeId(source.runtimeId)
    || normalizeId(source.provider)
    || fallback.runtimeId,
  );
  if (!projectKey || !runtimeId) return [];

  return getLifecycleSessionIds(message)
    .map((sessionId) => createClientAgentSessionIdentity(sessionId, { projectKey, runtimeId }))
    .filter((identity): identity is AgentSessionIdentity => Boolean(identity));
};
