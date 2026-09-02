import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Plus, Trash2, Edit3, Check, X, ToggleLeft, ToggleRight, Brain } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import ProFeatureGate from '../entitlements/ProFeatureGate';
import { CAPABILITIES } from '../../hooks/useEntitlements';

const CATEGORY_ACCENTS = {
  general: 'bg-slate-500',
  preference: 'bg-blue-500',
  context: 'bg-emerald-500',
  workflow: 'bg-amber-500',
};

const getProjectPath = (project) => project?.fullPath || project?.path || '';
const getProjectKey = (project) => project?.name || getProjectPath(project).split(/[\\/]+/).filter(Boolean).pop() || '';

function MemorySettingsContentBody({ projects = [] }) {
  const { t } = useTranslation('settings');
  const categories = useMemo(() => ([
    { value: 'general', label: t('memorySettings.categories.general') },
    { value: 'preference', label: t('memorySettings.categories.preference') },
    { value: 'context', label: t('memorySettings.categories.context') },
    { value: 'workflow', label: t('memorySettings.categories.workflow') },
  ]), [t]);
  const scopes = useMemo(() => ([
    { value: 'user', label: t('memorySettings.scopes.user') },
    { value: 'project', label: t('memorySettings.scopes.project') },
  ]), [t]);

  const [memories, setMemories] = useState([]);
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState('general');
  const [newScope, setNewScope] = useState('user');
  const [newProjectPath, setNewProjectPath] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState('');
  const [editCategory, setEditCategory] = useState('general');
  const [editScope, setEditScope] = useState('user');
  const [editProjectPath, setEditProjectPath] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const migrationAttemptedRef = useRef(false);

  useEffect(() => {
    if (!newProjectPath && Array.isArray(projects) && projects.length > 0) {
      setNewProjectPath(projects[0].fullPath || projects[0].path || '');
    }
  }, [newProjectPath, projects]);

  const migrateLegacyLocalMemories = useCallback(async () => {
    if (migrationAttemptedRef.current) {
      return;
    }
    migrationAttemptedRef.current = true;

    try {
      const localResponse = await api.settings.exportLocalMemories();
      if (!localResponse.ok) {
        return;
      }
      const localPayload = await localResponse.json().catch(() => ({}));
      const localMemories = Array.isArray(localPayload?.memories) ? localPayload.memories : [];
      if (localMemories.length > 0) {
        await api.settings.importMemories(localMemories);
      }
    } catch {
      // Legacy export is best-effort and is unavailable when no local Kernel is connected.
    }
  }, []);

  const fetchState = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
    }
    setError('');

    try {
      const [memoriesRes, settingsRes] = await Promise.all([
        api.settings.memory(),
        api.settings.memorySettings(),
      ]);

      if (!memoriesRes.ok || !settingsRes.ok) {
        throw new Error(t('memorySettings.messages.loadError'));
      }

      const memoriesData = await memoriesRes.json();
      const settingsData = await settingsRes.json();
      setMemories(Array.isArray(memoriesData.memories) ? memoriesData.memories : []);
      setGlobalEnabled(settingsData.enabled !== false);
    } catch (err) {
      setError(err.message || t('memorySettings.messages.loadError'));
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, [t]);

  useEffect(() => {
    void (async () => {
      await migrateLegacyLocalMemories();
      await fetchState();
    })();

    const refreshSilently = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void fetchState({ silent: true });
      }
    };
    const intervalId = window.setInterval(refreshSilently, 15_000);
    window.addEventListener('focus', refreshSilently);
    document.addEventListener('visibilitychange', refreshSilently);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshSilently);
      document.removeEventListener('visibilitychange', refreshSilently);
    };
  }, [fetchState, migrateLegacyLocalMemories]);

  const getCategoryLabel = (value) => categories.find((item) => item.value === value)?.label || categories[0].label;
  const getScopeLabel = (value) => scopes.find((item) => item.value === value)?.label || scopes[0].label;
  const getProjectPayload = (projectPath) => {
    const normalizedProjectPath = String(projectPath || '').trim();
    const project = projects.find((item) => getProjectPath(item) === normalizedProjectPath);
    return {
      projectPath: normalizedProjectPath || null,
      projectKey: project ? getProjectKey(project) : (normalizedProjectPath.split(/[\\/]+/).filter(Boolean).pop() || null),
    };
  };
  const findProjectForMemory = (memory) => projects.find((item) => (
    (memory?.project_key && getProjectKey(item) === memory.project_key)
    || (memory?.project_path && getProjectPath(item) === memory.project_path)
  ));
  const getProjectLabel = (memory) => {
    const project = findProjectForMemory(memory);
    return project?.displayName || project?.name || memory?.project_key || memory?.project_path || '';
  };

  const handleGlobalToggle = async () => {
    setSubmitting(true);
    setError('');
    try {
      const response = await api.settings.updateMemorySettings(!globalEnabled);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || t('memorySettings.messages.toggleError'));
      }

      const payload = await response.json();
      setGlobalEnabled(payload.enabled !== false);
    } catch (err) {
      setError(err.message || t('memorySettings.messages.toggleError'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreate = async () => {
    if (!newContent.trim()) {
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const projectPayload = getProjectPayload(newProjectPath);
      const response = await api.settings.createMemory({
        content: newContent.trim(),
        category: newCategory,
        scope: newScope,
        projectPath: null,
        projectKey: newScope === 'project' ? projectPayload.projectKey : null,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || t('memorySettings.messages.createError'));
      }

      setMemories((current) => [payload.memory, ...current]);
      setNewContent('');
      setNewCategory('general');
      setNewScope('user');
      setNewProjectPath(projects[0]?.fullPath || projects[0]?.path || '');
    } catch (err) {
      setError(err.message || t('memorySettings.messages.createError'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEdit = async (memoryId) => {
    if (!editContent.trim()) {
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const projectPayload = getProjectPayload(editProjectPath);
      const response = await api.settings.updateMemory(memoryId, {
        content: editContent.trim(),
        category: editCategory,
        scope: editScope,
        projectPath: null,
        projectKey: editScope === 'project' ? projectPayload.projectKey : null,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || t('memorySettings.messages.updateError'));
      }

      setMemories((current) => current.map((memory) => (
        memory.id === memoryId ? payload.memory : memory
      )));
      setEditingId(null);
      setEditContent('');
      setEditCategory('general');
      setEditScope('user');
      setEditProjectPath('');
    } catch (err) {
      setError(err.message || t('memorySettings.messages.updateError'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleMemory = async (memoryId, isEnabled) => {
    setSubmitting(true);
    setError('');
    try {
      const response = await api.settings.toggleMemory(memoryId, !isEnabled);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || t('memorySettings.messages.toggleItemError'));
      }

      setMemories((current) => current.map((memory) => (
        memory.id === memoryId ? payload.memory : memory
      )));
    } catch (err) {
      setError(err.message || t('memorySettings.messages.toggleItemError'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteMemory = async (memoryId) => {
    if (!window.confirm(t('memorySettings.messages.confirmDelete'))) {
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const response = await api.settings.deleteMemory(memoryId);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || t('memorySettings.messages.deleteError'));
      }

      setMemories((current) => current.filter((memory) => memory.id !== memoryId));
    } catch (err) {
      setError(err.message || t('memorySettings.messages.deleteError'));
    } finally {
      setSubmitting(false);
    }
  };

  const startEditing = (memory) => {
    const matchedProject = findProjectForMemory(memory);
    setEditingId(memory.id);
    setEditContent(memory.content || '');
    setEditCategory(memory.category || 'general');
    setEditScope(memory.scope || 'user');
    setEditProjectPath(getProjectPath(matchedProject) || memory.project_path || getProjectPath(projects[0]) || '');
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditContent('');
    setEditCategory('general');
    setEditScope('user');
    setEditProjectPath('');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
        {t('memorySettings.messages.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-blue-500" />
            <h3 className="text-lg font-medium text-foreground">
              {t('memorySettings.title')}
            </h3>
          </div>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {t('memorySettings.description')}
          </p>
        </div>

        <button
          type="button"
          onClick={handleGlobalToggle}
          disabled={submitting}
          className="flex items-center gap-2 text-sm font-medium self-start"
          title={globalEnabled ? t('memorySettings.actions.disable') : t('memorySettings.actions.enable')}
        >
          {globalEnabled ? (
            <ToggleRight className="w-8 h-8 text-blue-600" />
          ) : (
            <ToggleLeft className="w-8 h-8 text-gray-400" />
          )}
          <span className="text-muted-foreground">
            {globalEnabled ? t('memorySettings.status.enabled') : t('memorySettings.status.disabled')}
          </span>
        </button>
      </div>

      {!globalEnabled && (
        <div className="rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          {t('memorySettings.messages.disabledNotice')}
        </div>
      )}

      {error ? (
        <div className="rounded-lg border border-red-300/60 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="rounded-lg border border-border p-4 space-y-3">
        <div>
          <h4 className="text-sm font-medium text-foreground">
            {t('memorySettings.form.title')}
          </h4>
          <p className="text-xs text-muted-foreground mt-1">
            {t('memorySettings.form.help')}
          </p>
        </div>

        <textarea
          value={newContent}
          onChange={(event) => setNewContent(event.target.value)}
          maxLength={300}
          placeholder={t('memorySettings.form.placeholder')}
          className="w-full min-h-[88px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
        />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <select
              value={newCategory}
              onChange={(event) => setNewCategory(event.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {categories.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
            <select
              value={newScope}
              onChange={(event) => setNewScope(event.target.value)}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {scopes.map((scope) => (
                <option key={scope.value} value={scope.value}>
                  {scope.label}
                </option>
              ))}
            </select>
            {newScope === 'project' ? (
              <select
                value={newProjectPath}
                onChange={(event) => setNewProjectPath(event.target.value)}
                className="h-10 min-w-[220px] rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">{t('memorySettings.form.selectProject')}</option>
                {projects.map((project) => {
                  const projectPath = project.fullPath || project.path || '';
                  return (
                    <option key={projectPath || project.name} value={projectPath}>
                      {project.displayName || project.name}
                    </option>
                  );
                })}
              </select>
            ) : null}
            <span className="text-xs text-muted-foreground">
              {t('memorySettings.form.counter', { count: newContent.trim().length, max: 300 })}
            </span>
          </div>

          <Button
            type="button"
            size="sm"
            onClick={handleCreate}
            disabled={submitting || !newContent.trim() || (newScope === 'project' && !newProjectPath)}
            className="gap-2"
          >
            <Plus className="w-4 h-4" />
            {t('memorySettings.actions.add')}
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-foreground">
            {t('memorySettings.list.title', { count: memories.length })}
          </h4>
          <span className="text-xs text-muted-foreground">
            {t('memorySettings.list.scope')}
          </span>
        </div>

        {memories.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            {t('memorySettings.list.empty')}
          </div>
        ) : (
          <div className="space-y-3">
            {memories.map((memory) => {
              const accentClass = CATEGORY_ACCENTS[memory.category] || CATEGORY_ACCENTS.general;
              const createdAt = memory.created_at ? new Date(memory.created_at).toLocaleDateString() : '';

              return (
                <div
                  key={memory.id}
                  className={`rounded-lg border border-border p-4 transition-opacity ${memory.is_enabled ? 'opacity-100' : 'opacity-60'}`}
                >
                  {editingId === memory.id ? (
                    <div className="space-y-3">
                      <textarea
                        value={editContent}
                        onChange={(event) => setEditContent(event.target.value)}
                        maxLength={300}
                        className="w-full min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                      />
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <select
                          value={editCategory}
                          onChange={(event) => setEditCategory(event.target.value)}
                          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          {categories.map((category) => (
                            <option key={category.value} value={category.value}>
                              {category.label}
                            </option>
                          ))}
                        </select>
                        <select
                          value={editScope}
                          onChange={(event) => setEditScope(event.target.value)}
                          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                          {scopes.map((scope) => (
                            <option key={scope.value} value={scope.value}>
                              {scope.label}
                            </option>
                          ))}
                        </select>
                        {editScope === 'project' ? (
                          <select
                            value={editProjectPath}
                            onChange={(event) => setEditProjectPath(event.target.value)}
                            className="h-9 min-w-[220px] rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                          >
                            <option value="">{t('memorySettings.form.selectProject')}</option>
                            {projects.map((project) => {
                              const projectPath = project.fullPath || project.path || '';
                              return (
                                <option key={projectPath || project.name} value={projectPath}>
                                  {project.displayName || project.name}
                                </option>
                              );
                            })}
                          </select>
                        ) : null}
                        <div className="flex items-center gap-2">
                          <Button type="button" size="sm" variant="outline" onClick={cancelEditing} disabled={submitting}>
                            <X className="w-4 h-4" />
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleSaveEdit(memory.id)}
                            disabled={submitting || !editContent.trim() || (editScope === 'project' && !editProjectPath)}
                          >
                            <Check className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                          {memory.content}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="secondary" className="text-xs">
                            <span className={`mr-1 inline-block h-2 w-2 rounded-full ${accentClass}`} />
                            {getCategoryLabel(memory.category)}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {getScopeLabel(memory.scope)}
                          </Badge>
                          {memory.scope === 'project' && (memory.project_path || memory.project_key) ? (
                            <span>{getProjectLabel(memory)}</span>
                          ) : null}
                          {createdAt ? <span>{createdAt}</span> : null}
                          {!memory.is_enabled ? (
                            <span>{t('memorySettings.status.itemDisabled')}</span>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex items-center gap-1 self-start">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handleToggleMemory(memory.id, memory.is_enabled)}
                          disabled={submitting}
                          title={memory.is_enabled ? t('memorySettings.actions.disableItem') : t('memorySettings.actions.enableItem')}
                        >
                          {memory.is_enabled ? (
                            <ToggleRight className="w-5 h-5 text-blue-600" />
                          ) : (
                            <ToggleLeft className="w-5 h-5 text-gray-400" />
                          )}
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => startEditing(memory)} disabled={submitting}>
                          <Edit3 className="w-4 h-4" />
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => handleDeleteMemory(memory.id)} disabled={submitting}>
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>
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

function MemorySettingsContent(props) {
  return (
    <ProFeatureGate capability={CAPABILITIES.persistentMemory} feature="projectMemory" compact>
      <MemorySettingsContentBody {...props} />
    </ProFeatureGate>
  );
}

export default MemorySettingsContent;
