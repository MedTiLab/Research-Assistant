import { useCallback, useState } from 'react';

import { parseAgentSessionKey } from '../../shared/agentSessionIdentity';
import type { AgentSessionKey } from '../types/app';
import {
  createClientAgentSessionKey,
  type ClientAgentSessionScope,
} from '../utils/agentSessionIdentity';

export type SessionProtectionHandler = (
  sessionId?: string | null,
  scope?: ClientAgentSessionScope,
) => void;

export type SessionPromotionHandler = (
  realSessionId?: string | null,
  scope?: ClientAgentSessionScope,
  previousSessionId?: string | null,
) => void;

export function useSessionProtection() {
  const [activeSessions, setActiveSessions] = useState<Set<AgentSessionKey>>(new Set());
  const [processingSessions, setProcessingSessions] = useState<Set<AgentSessionKey>>(new Set());

  const markSessionAsActive = useCallback<SessionProtectionHandler>((sessionId, scope = {}) => {
    const sessionKey = createClientAgentSessionKey(sessionId, scope);
    if (!sessionKey) return;
    setActiveSessions((prev) => new Set([...prev, sessionKey]));
  }, []);

  const markSessionAsInactive = useCallback<SessionProtectionHandler>((sessionId, scope = {}) => {
    const sessionKey = createClientAgentSessionKey(sessionId, scope);
    if (!sessionKey) return;
    setActiveSessions((prev) => {
      const next = new Set(prev);
      next.delete(sessionKey);
      return next;
    });
  }, []);

  const markSessionAsProcessing = useCallback<SessionProtectionHandler>((sessionId, scope = {}) => {
    const sessionKey = createClientAgentSessionKey(sessionId, scope);
    if (!sessionKey) return;
    setProcessingSessions((prev) => new Set([...prev, sessionKey]));
  }, []);

  const markSessionAsNotProcessing = useCallback<SessionProtectionHandler>((sessionId, scope = {}) => {
    const sessionKey = createClientAgentSessionKey(sessionId, scope);
    if (!sessionKey) return;
    setProcessingSessions((prev) => {
      const next = new Set(prev);
      next.delete(sessionKey);
      return next;
    });
  }, []);

  const replaceTemporarySession = useCallback<SessionPromotionHandler>((
    realSessionId,
    scope = {},
    previousSessionId,
  ) => {
    const realSessionKey = createClientAgentSessionKey(realSessionId, scope);
    if (!realSessionKey) return;
    const previousSessionKey = createClientAgentSessionKey(previousSessionId, scope);

    const promote = (previous: Set<AgentSessionKey>) => {
      const next = new Set(previous);
      if (previousSessionKey) next.delete(previousSessionKey);
      next.add(realSessionKey);
      return next;
    };
    setActiveSessions(promote);
    setProcessingSessions(promote);
  }, []);

  const syncProcessingSessions = useCallback((sessionKeys: Iterable<string>) => {
    const next = new Set<AgentSessionKey>();
    for (const sessionKey of sessionKeys) {
      if (parseAgentSessionKey(sessionKey)) {
        next.add(sessionKey as AgentSessionKey);
      }
    }
    setProcessingSessions((prev) => {
      if (prev.size === next.size && [...prev].every((sessionKey) => next.has(sessionKey))) {
        return prev;
      }
      return next;
    });
  }, []);

  return {
    activeSessions,
    processingSessions,
    markSessionAsActive,
    markSessionAsInactive,
    markSessionAsProcessing,
    markSessionAsNotProcessing,
    replaceTemporarySession,
    syncProcessingSessions,
  };
}
