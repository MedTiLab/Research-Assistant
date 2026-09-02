import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWebSocket } from '../../../contexts/WebSocketContext';
import type { ResearchSecretarySnapshot } from '../domain/types';
import type { Project } from '../../../types/app';
import { createHttpResearchSecretaryApi } from './httpResearchSecretaryApi';

const EMPTY_SNAPSHOT: ResearchSecretarySnapshot = {
  tasks: [], theses: [], manuscripts: [], submissions: [], advisorActions: [], meetings: [], presentations: [],
  literatureAlerts: [], artifacts: [], agentRuns: [], automationJobs: [], automationRuns: [],
};

export function useResearchSecretarySnapshot(projects: Project[] = []) {
  const { latestMessage } = useWebSocket();
  const api = useMemo(() => createHttpResearchSecretaryApi(), []);
  const [snapshot, setSnapshot] = useState<ResearchSecretarySnapshot>(EMPTY_SNAPSHOT);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setSnapshot(await api.getSnapshot(projects));
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '加载科研工作台失败');
    } finally {
      setIsLoading(false);
    }
  }, [api, projects]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (latestMessage?.type === 'workbench-updated') void refresh();
  }, [latestMessage, refresh]);
  return { api, snapshot, isLoading, error, refresh };
}
