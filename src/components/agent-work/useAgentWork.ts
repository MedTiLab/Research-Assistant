import { useEffect, useMemo, useState } from 'react';
import { api } from '../../utils/api';
import { AGENT_WORK_CHANGED } from './usePiSessionState';

export type AgentWorkItem = {
  id?: string | null;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  sessionId?: string | null;
  runtimeId?: string | null;
  projectKey?: string | null;
  updatedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  toolName?: string | null;
  schedule?: string | null;
  kind?: string;
  terminal?: boolean;
  background?: boolean;
  childSessionId?: string;
};

export type AgentWorkSummary = {
  needsAttention: AgentWorkItem[];
  active: AgentWorkItem[];
  scheduled: AgentWorkItem[];
  recent: AgentWorkItem[];
};

const EMPTY_SUMMARY: AgentWorkSummary = {
  needsAttention: [],
  active: [],
  scheduled: [],
  recent: [],
};

export function useAgentWork(projectNames: string[], enabled = true) {
  const key = useMemo(
    () => [...new Set(projectNames.filter(Boolean))].sort().join('\u0000'),
    [projectNames],
  );
  const stableProjectNames = useMemo(() => key ? key.split('\u0000') : [], [key]);
  const [summary, setSummary] = useState<AgentWorkSummary>(EMPTY_SUMMARY);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enabled || stableProjectNames.length === 0) {
      setSummary(EMPTY_SUMMARY);
      return undefined;
    }
    let cancelled = false;
    let firstLoad = true;
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      if (firstLoad) setIsLoading(true);
      try {
        const response = await api.agentWork(stableProjectNames);
        if (!response.ok) return;
        const payload = await response.json();
        if (!cancelled) {
          setSummary({
            needsAttention: Array.isArray(payload.needsAttention) ? payload.needsAttention : [],
            active: Array.isArray(payload.active) ? payload.active : [],
            scheduled: Array.isArray(payload.scheduled) ? payload.scheduled : [],
            recent: Array.isArray(payload.recent) ? payload.recent : [],
          });
        }
      } catch {
        // Session/project refresh remains the fallback when the work index is unavailable.
      } finally {
        loading = false;
        firstLoad = false;
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    const invalidate = () => void load();
    window.addEventListener(AGENT_WORK_CHANGED, invalidate);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener(AGENT_WORK_CHANGED, invalidate);
    };
  }, [enabled, stableProjectNames]);

  return { summary, isLoading };
}
