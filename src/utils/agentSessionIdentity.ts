import {
  createAgentSessionIdentity,
  createAgentSessionKey,
  normalizeRuntimeId,
  parseAgentSessionKey,
} from '../../shared/agentSessionIdentity';
import type {
  AgentSessionIdentity,
  AgentSessionKey,
  RuntimeId,
  SessionProvider,
} from '../types/app';

export const CLIENT_AGENT_SESSION_OWNER_KEY = 'current-user';

export type ClientAgentSessionScope = {
  ownerKey?: string | null;
  projectKey?: string | null;
  runtimeId?: RuntimeId | string | null;
  provider?: SessionProvider | string | null;
};

export const getRuntimeIdForSessionProvider = (
  provider: SessionProvider | string | null | undefined,
): RuntimeId | null => normalizeRuntimeId(provider);

export const createClientAgentSessionIdentity = (
  sessionId: string | null | undefined,
  scope: ClientAgentSessionScope,
): AgentSessionIdentity | null => {
  const runtimeId = normalizeRuntimeId(scope.runtimeId ?? scope.provider);
  if (!sessionId || !scope.projectKey || !runtimeId) return null;
  return createAgentSessionIdentity({
    ownerKey: scope.ownerKey || CLIENT_AGENT_SESSION_OWNER_KEY,
    projectKey: scope.projectKey,
    runtimeId,
    sessionId,
  });
};

export const createClientAgentSessionKey = (
  sessionId: string | null | undefined,
  scope: ClientAgentSessionScope,
): AgentSessionKey | null => {
  const identity = createClientAgentSessionIdentity(sessionId, scope);
  return identity ? createAgentSessionKey(identity) : null;
};

export const hasClientAgentSession = (
  sessionKeys: ReadonlySet<string> | undefined,
  sessionId: string | null | undefined,
  scope: ClientAgentSessionScope,
): boolean => {
  const sessionKey = createClientAgentSessionKey(sessionId, scope);
  return Boolean(sessionKey && sessionKeys?.has(sessionKey));
};

export const getClientAgentSessionIdentities = (
  sessionKeys: Iterable<string>,
): AgentSessionIdentity[] => {
  const identities: AgentSessionIdentity[] = [];
  for (const sessionKey of sessionKeys) {
    const identity = parseAgentSessionKey(sessionKey);
    if (identity) identities.push(identity);
  }
  return identities;
};

