import { useEffect, useMemo, useState } from 'react';

import { api } from '../../../utils/api';
import {
  buildProjectUsageRefreshKey,
  type ProjectTokenUsageSummary,
} from '../utils/projectStats';
import type { Project } from '../../../types/app';

export function useProjectTokenUsageSummary(projects: Project[]) {
  const [tokenUsageSummary, setTokenUsageSummary] = useState<ProjectTokenUsageSummary | null>(null);
  const projectUsageRefreshKey = useMemo(
    () => buildProjectUsageRefreshKey(projects),
    [projects],
  );

  useEffect(() => {
    let cancelled = false;

    if (projects.length === 0) {
      setTokenUsageSummary(null);
      return () => {
        cancelled = true;
      };
    }

    const fetchProjectTokenUsageSummary = async () => {
      try {
        const response = await api.projectTokenUsageSummary(projects);
        if (!response.ok) {
          throw new Error(`Failed to fetch token usage summary: ${response.status}`);
        }

        const data = await response.json() as ProjectTokenUsageSummary;
        if (!cancelled) {
          setTokenUsageSummary(data);
        }
      } catch (error) {
        console.error('Error fetching project token usage summary:', error);
        if (!cancelled) {
          setTokenUsageSummary(null);
        }
      }
    };

    void fetchProjectTokenUsageSummary();

    return () => {
      cancelled = true;
    };
  }, [projectUsageRefreshKey, projects]);

  return tokenUsageSummary;
}
