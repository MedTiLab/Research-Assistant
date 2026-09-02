import { AlertTriangle, ArchiveRestore, FolderX, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '../../../utils/api';
import type { TrashProject } from '../../../types/app';
import { Button } from '../../ui/button';
import { formatTimeAgo } from '../../../utils/dateUtils';

type TrashDashboardProps = {
  projects: TrashProject[];
  onRefresh: () => Promise<void> | void;
  isLoading?: boolean;
};

type DeleteMode = 'logical' | 'physical';

function getProjectTrashKey(project: TrashProject) {
  return `${project.name}:${project.trashedAt || ''}`;
}

export default function TrashDashboard({ projects, onRefresh, isLoading = false }: TrashDashboardProps) {
  const { t } = useTranslation(['common', 'sidebar']);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TrashProject | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [locallyRemovedProjectKeys, setLocallyRemovedProjectKeys] = useState<Set<string>>(() => new Set());

  const visibleProjects = projects.filter((project) => !locallyRemovedProjectKeys.has(getProjectTrashKey(project)));
  const hasServerTrashItems = projects.length > 0;

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const currentProjectKeys = new Set(projects.map(getProjectTrashKey));
    setLocallyRemovedProjectKeys((previousKeys) => {
      const nextKeys = new Set(Array.from(previousKeys).filter((key) => currentProjectKeys.has(key)));
      return nextKeys.size === previousKeys.size ? previousKeys : nextKeys;
    });
  }, [projects]);

  const refreshTrashInBackground = () => {
    void Promise.resolve().then(() => onRefresh()).catch((error) => {
      console.error('Failed to refresh trash after action:', error);
    });
  };

  const removeProjectLocally = (project: TrashProject) => {
    const projectKey = getProjectTrashKey(project);
    setLocallyRemovedProjectKeys((previousKeys) => {
      const nextKeys = new Set(previousKeys);
      nextKeys.add(projectKey);
      return nextKeys;
    });
  };

  const handleRestore = async (project: TrashProject) => {
    setErrorMessage(null);
    setLoadingKey(`restore:${project.name}`);
    try {
      const response = await api.restoreProject(project.name);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error?.error || t('sidebar:messages.deleteProjectFailed'));
      }
      removeProjectLocally(project);
      refreshTrashInBackground();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('sidebar:messages.deleteProjectError'));
    } finally {
      setLoadingKey(null);
    }
  };

  const handleDelete = async (project: TrashProject, mode: DeleteMode) => {
    setErrorMessage(null);
    setLoadingKey(`${mode}:${project.name}`);
    try {
      const response = await api.deleteTrashedProject(project.name, mode);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error?.error || t('sidebar:messages.deleteProjectFailed'));
      }
      removeProjectLocally(project);
      setDeleteTarget(null);
      refreshTrashInBackground();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : t('sidebar:messages.deleteProjectError'));
    } finally {
      setLoadingKey(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-b from-background via-background to-muted/20">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        {errorMessage && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
            {errorMessage}
          </div>
        )}
        {isLoading && !hasServerTrashItems ? (
          <div className="rounded-3xl border border-border bg-card/70 px-8 py-16 text-center shadow-sm">
            <div className="mx-auto h-16 w-16 animate-pulse rounded-2xl bg-muted" />
            <p className="mt-6 text-sm text-muted-foreground">{t('common:status.loading')}</p>
          </div>
        ) : visibleProjects.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-card/70 px-8 py-16 text-center shadow-sm">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Trash2 className="h-7 w-7" />
            </div>
            <h2 className="mt-6 text-2xl font-semibold text-foreground">{t('common:projectDashboard.trashEmptyTitle')}</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
              {t('common:projectDashboard.trashEmptyDescription')}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {visibleProjects.map((project) => {
              const restoreKey = `restore:${project.name}`;
              const logicalKey = `logical:${project.name}`;
              const physicalKey = `physical:${project.name}`;

              return (
                <div
                  key={project.name}
                  className="rounded-3xl border border-border/60 bg-card/90 p-5 shadow-sm backdrop-blur"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                        <Trash2 className="h-3.5 w-3.5" />
                        {t('common:projectDashboard.trashBadge')}
                      </div>
                      <h3 className="mt-2 text-xl font-semibold text-foreground">{project.displayName || project.name}</h3>
                      <p className="mt-1 break-all text-sm text-muted-foreground">{project.originalPath || project.fullPath || project.name}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full border border-border/60 px-3 py-1">
                          {t('common:projectDashboard.trashDeletedAt', {
                            time: formatTimeAgo(project.trashedAt, currentTime, t),
                          })}
                        </span>
                        <span className="rounded-full border border-border/60 px-3 py-1">
                          {t('common:projectDashboard.trashSessions', { count: project.sessionCount ?? 0 })}
                        </span>
                        {!project.filesExist && (
                          <span className="rounded-full border border-amber-300/60 bg-amber-50 px-3 py-1 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                            {t('common:projectDashboard.trashFilesMissing')}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      <Button
                        variant="outline"
                        onClick={() => handleRestore(project)}
                        disabled={loadingKey !== null || !project.canRestore}
                      >
                        <ArchiveRestore className="mr-2 h-4 w-4" />
                        {loadingKey === restoreKey
                          ? t('common:status.loading')
                          : t('common:projectDashboard.restoreProject')}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setDeleteTarget(project)}
                        disabled={loadingKey !== null}
                      >
                        <FolderX className="mr-2 h-4 w-4" />
                        {t('common:projectDashboard.deleteFromTrash')}
                      </Button>
                    </div>
                  </div>

                  {deleteTarget?.name === project.name && (
                    <div className="mt-4 rounded-2xl border border-red-200 bg-red-50/80 p-4 dark:border-red-900/60 dark:bg-red-950/20">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" />
                        <div className="flex-1">
                          <h4 className="text-sm font-semibold text-foreground">
                            {t('common:projectDashboard.trashDeleteTitle')}
                          </h4>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {t('common:projectDashboard.trashDeleteDescription')}
                          </p>
                          <div className="mt-4 flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              onClick={() => setDeleteTarget(null)}
                              disabled={loadingKey !== null}
                            >
                              {t('sidebar:actions.cancel')}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => handleDelete(project, 'logical')}
                              disabled={loadingKey !== null}
                            >
                              {loadingKey === logicalKey
                                ? t('common:status.loading')
                                : t('common:projectDashboard.logicalDelete')}
                            </Button>
                            <Button
                              variant="destructive"
                              onClick={() => handleDelete(project, 'physical')}
                              disabled={loadingKey !== null}
                            >
                              {loadingKey === physicalKey
                                ? t('common:status.loading')
                                : t('common:projectDashboard.physicalDelete')}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
