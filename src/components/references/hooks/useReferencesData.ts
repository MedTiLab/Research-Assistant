import { useState, useEffect, useCallback } from 'react';
import { api } from '../../../utils/api';
import type {
  ProjectReference,
  ProjectReferenceStats,
  Reference,
  ReferenceTag,
  ZoteroStatus,
} from '../types';

interface UseReferencesDataOptions {
  projectName?: string;
  autoFetch?: boolean;
}

export function useReferencesData({ projectName, autoFetch = true }: UseReferencesDataOptions = {}) {
  const [references, setReferences] = useState<Reference[]>([]);
  const [projectReferences, setProjectReferences] = useState<ProjectReference[]>([]);
  const [projectReferenceStats, setProjectReferenceStats] = useState<ProjectReferenceStats>({
    total_count: 0,
    linked_count: 0,
    local_only_count: 0,
    local_artifact_count: 0,
  });
  const [tags, setTags] = useState<ReferenceTag[]>([]);
  const [zoteroStatus, setZoteroStatus] = useState<ZoteroStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchReferences = useCallback(async (search?: string, filterTags?: string[]) => {
    try {
      setLoading(true);
      setError(null);
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (filterTags && filterTags.length > 0) params.tags = filterTags.join(',');
      const res = await api.references.list(params);
      if (!res.ok) throw new Error('Failed to fetch references');
      const data = await res.json();
      setReferences(data.references || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchProjectReferences = useCallback(async () => {
    if (!projectName) {
      setProjectReferences([]);
      setProjectReferenceStats({
        total_count: 0,
        linked_count: 0,
        local_only_count: 0,
        local_artifact_count: 0,
      });
      return;
    }
    try {
      const res = await api.references.aggregatedProjectRefs(projectName);
      if (!res.ok) throw new Error('Failed to fetch project references');
      const data = await res.json();
      setProjectReferences(data.references || []);
      setProjectReferenceStats(data.stats || {
        total_count: 0,
        linked_count: 0,
        local_only_count: 0,
        local_artifact_count: 0,
      });
    } catch (err) {
      console.error('Error fetching project references:', err);
      setProjectReferences([]);
      setProjectReferenceStats({
        total_count: 0,
        linked_count: 0,
        local_only_count: 0,
        local_artifact_count: 0,
      });
    }
  }, [projectName]);

  const fetchTags = useCallback(async () => {
    try {
      const res = await api.references.tags();
      if (!res.ok) throw new Error('Failed to fetch tags');
      const data = await res.json();
      setTags(data.tags || []);
    } catch (err) {
      console.error('Error fetching tags:', err);
    }
  }, []);

  const checkZoteroStatus = useCallback(async () => {
    try {
      const res = await api.references.zoteroStatus();
      if (res.ok) {
        const data = await res.json();
        setZoteroStatus(data);
        return data;
      } else {
        const fallback = {
          connected: false,
          mode: null,
          localAvailable: false,
          localRunning: false,
          localApiDisabled: false,
          endpoint: null,
          detail: null,
        } as ZoteroStatus;
        setZoteroStatus(fallback);
        return fallback;
      }
    } catch {
      const fallback = {
        connected: false,
        mode: null,
        localAvailable: false,
        localRunning: false,
        localApiDisabled: false,
        endpoint: null,
        detail: null,
      } as ZoteroStatus;
      setZoteroStatus(fallback);
      return fallback;
    }
  }, []);

  const linkToProject = useCallback(async (referenceId: string) => {
    if (!projectName) return;
    try {
      const res = await api.references.linkToProject(projectName, referenceId);
      if (res.ok) {
        await fetchProjectReferences();
      }
    } catch (err) {
      console.error('Error linking reference:', err);
    }
  }, [projectName, fetchProjectReferences]);

  const unlinkFromProject = useCallback(async (referenceId: string) => {
    if (!projectName) return;
    try {
      const res = await api.references.unlinkFromProject(projectName, referenceId);
      if (res.ok) {
        await fetchProjectReferences();
      }
    } catch (err) {
      console.error('Error unlinking reference:', err);
    }
  }, [projectName, fetchProjectReferences]);

  const bulkUnlinkFromProject = useCallback(async (referenceIds: string[]) => {
    if (!projectName) return;
    if (!referenceIds || referenceIds.length === 0) return;

    const idSet = new Set(referenceIds);
    // Optimistic UI update: remove from project list immediately.
    setProjectReferences(prev => prev.filter(r => !idSet.has(r.id)));

    try {
      const results = await Promise.all(
        referenceIds.map((id) => api.references.unlinkFromProject(projectName, id)),
      );
      const failed = results.some((r) => !r.ok);
      if (failed) {
        throw new Error('Failed to unlink one or more references');
      }
    } catch (err) {
      console.error('Error bulk unlinking references:', err);
      // If something fails, fetch again to reconcile local state with server state.
      await fetchProjectReferences();
      return;
    }

    await fetchProjectReferences();
  }, [projectName, fetchProjectReferences]);

  const deleteReference = useCallback(async (referenceId: string) => {
    try {
      const res = await api.references.delete(referenceId);
      if (!res.ok) throw new Error('Failed to delete reference');
      setReferences(prev => prev.filter(r => r.id !== referenceId));
      setProjectReferences(prev => prev.filter(r => r.id !== referenceId));
    } catch (err) {
      console.error('Error deleting reference:', err);
      throw err;
    }
  }, []);

  const bulkDeleteReferences = useCallback(async (referenceIds: string[]) => {
    if (referenceIds.length === 0) return;
    try {
      const res = await api.references.bulkDelete(referenceIds);
      if (!res.ok) throw new Error('Failed to delete references');
      const idSet = new Set(referenceIds);
      setReferences(prev => prev.filter(r => !idSet.has(r.id)));
      setProjectReferences(prev => prev.filter(r => !idSet.has(r.id)));
    } catch (err) {
      console.error('Error bulk-deleting references:', err);
      throw err;
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([
      fetchReferences(),
      fetchProjectReferences(),
      fetchTags(),
      checkZoteroStatus(),
    ]);
  }, [fetchReferences, fetchProjectReferences, fetchTags, checkZoteroStatus]);

  useEffect(() => {
    if (autoFetch) {
      void refresh();
    }
  }, [autoFetch, refresh]);

  useEffect(() => {
    const onRefsUpdated = () => {
      void refresh();
    };
    window.addEventListener('references-library-updated', onRefsUpdated);
    return () => window.removeEventListener('references-library-updated', onRefsUpdated);
  }, [refresh]);

  return {
    references,
    projectReferences,
    projectReferenceStats,
    tags,
    zoteroStatus,
    loading,
    error,
    fetchReferences,
    fetchProjectReferences,
    fetchTags,
    checkZoteroStatus,
    linkToProject,
    unlinkFromProject,
    bulkUnlinkFromProject,
    deleteReference,
    bulkDeleteReferences,
    refresh,
  };
}
