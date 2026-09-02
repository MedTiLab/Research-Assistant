import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Archive, Bot, CalendarClock, Clock3, Loader2, Pause, Pencil, Play, Plus, RefreshCw, RotateCcw, Save, Trash2, X } from 'lucide-react';
import type { Project } from '../../../types/app';
import { ExplorerPage, explorerItemClass } from '../../../components/explorer/ExplorerPage';
import type { WorkbenchCommand } from '../domain/workbenchCommand';
import {
  automationRequestJson,
  listAutomationModels,
  listAutomationRecords,
  type AutomationModel,
  type AutomationModelOption,
  type AutomationRecord,
  type AutomationStatus,
} from '../services/automationsApi';

type AutomationTab = 'active' | 'paused' | 'archived';
type AutomationDraft = { projectKey: string; title: string; prompt: string; at: string; intervalMinutes: string; modelKey: string };

const REPEAT_OPTIONS = [
  { value: '', labelKey: 'automation.repeat.none' },
  { value: '60', labelKey: 'automation.repeat.hourly' },
  { value: '1440', labelKey: 'automation.repeat.daily' },
  { value: '10080', labelKey: 'automation.repeat.weekly' },
  { value: '43200', labelKey: 'automation.repeat.monthly' },
];

function localDateTimeValue(date = new Date(Date.now() + 60 * 60_000)) {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function editableRunTime(value?: string | null) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) && date.getTime() > Date.now() ? localDateTimeValue(date) : localDateTimeValue();
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function scheduleLabel(item: Pick<AutomationRecord, 'intervalMinutes' | 'status'>, t: TFunction) {
  if (!item.intervalMinutes) return item.status === 'completed' ? t('automation.repeat.onceDone') : t('automation.repeat.once');
  if (item.intervalMinutes % 10080 === 0) return t('automation.repeat.everyWeeks', { count: item.intervalMinutes / 10080 });
  if (item.intervalMinutes % 1440 === 0) return t('automation.repeat.everyDays', { count: item.intervalMinutes / 1440 });
  if (item.intervalMinutes % 60 === 0) return t('automation.repeat.everyHours', { count: item.intervalMinutes / 60 });
  return t('automation.repeat.everyMinutes', { count: item.intervalMinutes });
}

function modelKey(model?: AutomationModel | null) {
  return model ? `${model.modelProviderId}\u0000${model.modelId}\u0000${model.modelApi}` : '';
}

function modelForKey(key: string, models: AutomationModelOption[]): AutomationModel | null {
  const option = models.find((item) => modelKey(item) === key);
  return option ? { modelId: option.modelId, modelProviderId: option.modelProviderId, modelApi: option.modelApi } : null;
}

function defaultModelKey(models: AutomationModelOption[]) {
  const storage = typeof localStorage === 'undefined' ? null : localStorage;
  const remembered = {
    modelId: storage?.getItem('pi-model') || '',
    modelProviderId: storage?.getItem('pi-model-provider') || '',
    modelApi: storage?.getItem('pi-model-api') || '',
  };
  return modelKey(models.find((model) => modelKey(model) === modelKey(remembered)) || models[0]);
}

function blankDraft(projectKey: string, models: AutomationModelOption[]): AutomationDraft {
  return { projectKey, title: '', prompt: '', at: localDateTimeValue(), intervalMinutes: '', modelKey: defaultModelKey(models) };
}

function editDraft(item: AutomationRecord, models: AutomationModelOption[]): AutomationDraft {
  const selectedModelKey = modelKey(item.model);
  return {
    projectKey: item.projectKey,
    title: item.title,
    prompt: item.prompt,
    at: editableRunTime(item.nextRunAt),
    intervalMinutes: item.intervalMinutes ? String(item.intervalMinutes) : '',
    modelKey: models.some((model) => modelKey(model) === selectedModelKey) ? selectedModelKey : defaultModelKey(models),
  };
}

function timezoneLabel(t: TFunction) {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || t('automation.localTz');
}

function AutomationForm({ mode, projects, draft, models, modelsLoading, modelError, busy, error, onDraftChange, onCancel, onSave }: {
  mode: 'create' | 'edit';
  projects: Project[];
  draft: AutomationDraft;
  models: AutomationModelOption[];
  modelsLoading: boolean;
  modelError: string;
  busy: boolean;
  error: string;
  onDraftChange: (next: AutomationDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation('workbench');
  const ready = Boolean(draft.projectKey && draft.title.trim() && draft.prompt.trim() && draft.at && modelForKey(draft.modelKey, models));
  const selectedInterval = REPEAT_OPTIONS.some((option) => option.value === draft.intervalMinutes);
  const scheduled = draft.at ? new Date(draft.at) : null;
  const scheduledLabel = scheduled && Number.isFinite(scheduled.getTime()) ? scheduled.toLocaleString() : t('automation.notScheduled');

  return <div className="flex h-full min-h-0 flex-col bg-background">
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4 md:px-6">
      <button type="button" onClick={onCancel} className="rounded-lg p-2 hover:bg-muted" aria-label={t('automation.back')}><X className="h-4 w-4" /></button>
      <div><div className="font-semibold">{mode === 'create' ? t('automation.createTitle') : t('automation.editTitle')}</div><div className="text-xs text-muted-foreground">{t('automation.formHint')}</div></div>
      <button type="button" disabled={busy || modelsLoading || !ready} onClick={onSave} className="ml-auto inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{mode === 'create' ? t('automation.saveCreate') : t('automation.saveEdit')}
      </button>
    </header>
    {(error || modelError) && <div role="alert" className="border-b border-destructive/30 bg-destructive/5 px-5 py-3 text-sm text-destructive">{error || modelError}</div>}
    <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-8"><div className="mx-auto max-w-2xl space-y-5 rounded-2xl border bg-card p-5 shadow-sm md:p-7">
      <label className="block text-sm font-medium">{t('automation.project')}
        <select value={draft.projectKey} disabled={mode === 'edit'} onChange={(event) => onDraftChange({ ...draft, projectKey: event.target.value })} className="mt-2 w-full rounded-lg border bg-background px-3 py-2.5 disabled:opacity-60">
          <option value="">{t('automation.selectProject')}</option>{projects.map((project) => <option key={project.name} value={project.name}>{project.displayName || project.name}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium">{t('automation.name')}
        <input maxLength={200} value={draft.title} onChange={(event) => onDraftChange({ ...draft, title: event.target.value })} placeholder={t('automation.namePlaceholder')} className="mt-2 w-full rounded-lg border bg-background px-3 py-2.5" />
      </label>
      <label className="block text-sm font-medium">{t('automation.model')}
        <select value={draft.modelKey} disabled={modelsLoading || models.length === 0} onChange={(event) => onDraftChange({ ...draft, modelKey: event.target.value })} className="mt-2 w-full rounded-lg border bg-background px-3 py-2.5 disabled:opacity-60">
          <option value="">{modelsLoading ? t('automation.loadingModels') : models.length ? t('automation.selectModel') : t('automation.noModels')}</option>
          {models.map((model) => <option key={modelKey(model)} value={modelKey(model)}>{model.label}</option>)}
        </select>
        <span className="mt-1.5 block text-xs font-normal text-muted-foreground">{t('automation.modelHint')}</span>
      </label>
      <label className="block text-sm font-medium">{t('automation.prompt')}
        <textarea maxLength={16000} rows={7} value={draft.prompt} onChange={(event) => onDraftChange({ ...draft, prompt: event.target.value })} placeholder={t('automation.promptPlaceholder')} className="mt-2 w-full resize-y rounded-lg border bg-background px-3 py-2.5 leading-6" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">{mode === 'create' ? t('automation.firstRun') : t('automation.nextRun')}
          <input type="datetime-local" min={localDateTimeValue(new Date(Date.now() + 60_000))} value={draft.at} onChange={(event) => onDraftChange({ ...draft, at: event.target.value })} className="mt-2 w-full rounded-lg border bg-background px-3 py-2.5" />
        </label>
        <label className="block text-sm font-medium">{t('automation.frequency')}
          <select value={draft.intervalMinutes} onChange={(event) => onDraftChange({ ...draft, intervalMinutes: event.target.value })} className="mt-2 w-full rounded-lg border bg-background px-3 py-2.5">
            {!selectedInterval && draft.intervalMinutes && <option value={draft.intervalMinutes}>{t('automation.repeat.currentMinutes', { count: Number(draft.intervalMinutes) })}</option>}
            {REPEAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
          </select>
        </label>
      </div>
      <div className="rounded-xl bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">
        <div className="font-medium text-foreground">{t('automation.preview', { time: scheduledLabel })}</div>
        <div>{t('automation.previewHint', { tz: timezoneLabel(t) })}</div>
        <div className="mt-1">{t('automation.previewAgent')}</div>
      </div>
    </div></div>
  </div>;
}

export default function AutomationCenter({ projects, onMenuClick }: { projects: Project[]; onRunCommand?: (command: WorkbenchCommand) => void; onMenuClick?: () => void }) {
  const { t } = useTranslation('workbench');
  const [items, setItems] = useState<AutomationRecord[]>([]);
  const [models, setModels] = useState<AutomationModelOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<AutomationTab>('active');
  const [loading, setLoading] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [modelError, setModelError] = useState('');
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [draft, setDraft] = useState<AutomationDraft>(() => blankDraft(projects[0]?.name || '', []));
  const projectLabels = useMemo(() => new Map(projects.map((project) => [project.name, project.displayName || project.name])), [projects]);

  const load = useCallback(async () => {
    if (!projects.length) { setItems([]); setLoading(false); return; }
    setLoading(true);
    const { records, failures } = await listAutomationRecords(projects);
    setItems(records);
    setError(failures.length === projects.length ? String(failures[0]?.reason?.message || t('automation.loadFailed')) : failures.length ? t('automation.partialLoad', { count: failures.length }) : '');
    setLoading(false);
  }, [projects, t]);

  const loadModels = useCallback(async () => {
    setModelsLoading(true); setModelError('');
    try {
      const nextModels = await listAutomationModels();
      setModels(nextModels);
      if (!nextModels.length) setModelError(t('automation.noPiModels'));
    } catch (cause) {
      setModels([]); setModelError(cause instanceof Error ? cause.message : t('automation.modelsFailed'));
    } finally { setModelsLoading(false); }
  }, [t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadModels(); }, [loadModels]);

  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesTab = tab === 'active' ? item.status === 'active' : tab === 'paused' ? item.status === 'paused' : ['cancelled', 'completed'].includes(item.status);
      return matchesTab && (!normalized || `${item.title} ${item.prompt} ${projectLabels.get(item.projectKey) || item.projectKey}`.toLowerCase().includes(normalized));
    });
  }, [items, projectLabels, query, tab]);
  const selected = visibleItems.find((item) => item.id === selectedId) || visibleItems[0] || null;
  const counts = useMemo(() => ({ active: items.filter((item) => item.status === 'active').length, paused: items.filter((item) => item.status === 'paused').length, archived: items.filter((item) => ['cancelled', 'completed'].includes(item.status)).length }), [items]);

  const mutate = async (item: AutomationRecord, method: 'PATCH' | 'POST' | 'DELETE', suffix = '', body?: object) => {
    setBusy(true); setError('');
    try {
      await automationRequestJson(`/api/agent-services/automations/${encodeURIComponent(item.id)}${suffix}?projectKey=${encodeURIComponent(item.projectKey)}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      await load(); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return false; }
    finally { setBusy(false); }
  };

  const beginCreate = () => { setError(''); setDraft(blankDraft(projects[0]?.name || '', models)); setFormMode('create'); };
  const beginEdit = (item: AutomationRecord) => { setError(''); setDraft(editDraft(item, models)); setFormMode('edit'); };

  const saveForm = async () => {
    const model = modelForKey(draft.modelKey, models);
    if (!draft.projectKey || !draft.title.trim() || !draft.prompt.trim() || !draft.at || !model) return;
    const body = { title: draft.title.trim(), prompt: draft.prompt.trim(), at: new Date(draft.at).toISOString(), intervalMinutes: draft.intervalMinutes ? Number(draft.intervalMinutes) : null, model };
    if (formMode === 'edit' && selected) {
      const movedToActive = selected.status === 'completed';
      if (await mutate(selected, 'PATCH', '', body)) { if (movedToActive) setTab('active'); setFormMode(null); }
      return;
    }
    setBusy(true); setError('');
    try {
      const created = await automationRequestJson<AutomationRecord>(`/api/agent-services/automations?projectKey=${encodeURIComponent(draft.projectKey)}`, { method: 'POST', body: JSON.stringify(body) });
      setFormMode(null); setTab('active'); setSelectedId(created.id); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  if (formMode) return <AutomationForm mode={formMode} projects={projects} draft={draft} models={models} modelsLoading={modelsLoading} modelError={modelError} busy={busy} error={error} onDraftChange={setDraft} onCancel={() => setFormMode(null)} onSave={() => void saveForm()} />;

  const tabs: Array<{ id: AutomationTab; labelKey: string }> = [
    { id: 'active', labelKey: 'automation.tabs.active' },
    { id: 'paused', labelKey: 'automation.tabs.paused' },
    { id: 'archived', labelKey: 'automation.tabs.archived' },
  ];
  const sidebar = <div className="space-y-3">
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/60 p-1">{tabs.map((entry) => <button key={entry.id} type="button" onClick={() => setTab(entry.id)} className={`rounded-lg px-2 py-2 text-xs font-medium ${tab === entry.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{t(entry.labelKey)} · {counts[entry.id]}</button>)}</div>
    {loading ? <p className="px-1 py-8 text-center text-sm text-muted-foreground">{t('automation.loading')}</p> : visibleItems.length ? visibleItems.map((item) => <button key={`${item.projectKey}:${item.id}`} type="button" onClick={() => setSelectedId(item.id)} className={explorerItemClass(selected?.id === item.id)}><span className="min-w-0"><span className="block truncate">{item.title}</span><span className="mt-1 block truncate text-[11px] font-normal text-muted-foreground">{projectLabels.get(item.projectKey) || item.projectKey} · {scheduleLabel(item, t)}</span></span></button>) : <p className="px-1 py-8 text-center text-sm text-muted-foreground">{query ? t('automation.noMatch') : t('automation.noneForTab', { tab: t(`automation.tabs.${tab}`) })}</p>}
  </div>;

  const selectedModelLabel = selected?.model ? models.find((model) => modelKey(model) === modelKey(selected.model))?.label || selected.model.modelId : t('automation.legacyModel');
  const statusLabel = (status: AutomationStatus) => t(`automation.status.${status}`);

  return <ExplorerPage onMenuClick={onMenuClick} eyebrow="Research automation" title={t('automation.title')} countLabel={`${items.length}`} searchPlaceholder={t('automation.searchPlaceholder')} searchValue={query} onSearchChange={setQuery} sidebar={sidebar} resultsEyebrow={selected ? projectLabels.get(selected.projectKey) || selected.projectKey : t('automation.title')} resultsTitle={selected?.title || t('automation.taskFallback')} resultsDescription={selected ? `${scheduleLabel(selected, t)} · ${statusLabel(selected.status)}` : t('automation.description')} resultsActions={<div className="flex gap-2"><button type="button" disabled={loading || busy} onClick={() => void load()} className="rounded-lg border p-2 hover:bg-muted" aria-label={t('automation.refresh')}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button><button type="button" disabled={!projects.length} onClick={beginCreate} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"><Plus className="h-4 w-4" />{t('automation.create')}</button></div>}>
    {error && <div role="alert" className="border-b border-destructive/30 bg-destructive/5 px-5 py-3 text-sm text-destructive">{error}</div>}
    {selected ? <div className="space-y-5 p-5 md:p-7">
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><CalendarClock className="h-5 w-5" /></span><div className="min-w-0"><h2 className="truncate text-lg font-semibold">{selected.title}</h2><p className="mt-1 text-xs text-muted-foreground">{projectLabels.get(selected.projectKey) || selected.projectKey}</p></div></div><div className="flex items-center gap-2"><button type="button" disabled={modelsLoading || models.length === 0} onClick={() => beginEdit(selected)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"><Pencil className="h-3.5 w-3.5" />{t('automation.edit')}</button><span className={`rounded-full px-3 py-1 text-xs font-medium ${selected.status === 'active' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : selected.status === 'paused' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-muted text-muted-foreground'}`}>{statusLabel(selected.status)}</span></div></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl bg-muted/45 p-3"><div className="text-xs text-muted-foreground">{t('automation.modelCard')}</div><div className="mt-1 truncate text-sm font-medium" title={selectedModelLabel}>{selectedModelLabel}</div></div>
          <div className="rounded-xl bg-muted/45 p-3"><div className="text-xs text-muted-foreground">{t('automation.frequencyCard')}</div><div className="mt-1 text-sm font-medium">{scheduleLabel(selected, t)}</div></div>
          <div className="rounded-xl bg-muted/45 p-3"><div className="text-xs text-muted-foreground">{t('automation.nextRunCard')}</div><div className="mt-1 text-sm font-medium">{formatDate(selected.nextRunAt)}</div></div>
          <div className="rounded-xl bg-muted/45 p-3"><div className="text-xs text-muted-foreground">{t('automation.lastRunCard')}</div><div className="mt-1 text-sm font-medium">{formatDate(selected.lastRunAt)}</div></div>
        </div>
        <p className="mt-2 text-right text-[11px] text-muted-foreground">{t('automation.tzHint', { tz: timezoneLabel(t) })}</p>
        <div className="mt-4 rounded-xl border bg-background p-4"><div className="mb-2 text-xs font-medium text-muted-foreground">{t('automation.promptCard')}</div><p className="whitespace-pre-wrap text-sm leading-6">{selected.prompt}</p></div>
        <div className="mt-4 flex flex-wrap gap-2">
          {selected.status === 'active' ? <button type="button" disabled={busy} onClick={() => void mutate(selected, 'PATCH', '', { status: 'paused' })} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"><Pause className="h-4 w-4" />{t('automation.pause')}</button> : selected.status === 'paused' ? <button type="button" disabled={busy} onClick={() => void mutate(selected, 'PATCH', '', { status: 'active' })} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"><RotateCcw className="h-4 w-4" />{t('automation.resume')}</button> : null}
          {selected.status !== 'cancelled' && <button type="button" disabled={busy} onClick={() => void mutate(selected, 'POST', '/run')} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"><Play className="h-4 w-4" />{t('automation.runNow')}</button>}
          {!['cancelled', 'completed'].includes(selected.status) ? <button type="button" disabled={busy} onClick={() => { if (confirm(t('automation.archiveConfirm', { title: selected.title }))) void mutate(selected, 'PATCH', '', { status: 'cancelled' }); }} className="ml-auto inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"><Archive className="h-4 w-4" />{t('automation.archive')}</button> : <><button type="button" disabled={busy} onClick={() => void mutate(selected, 'PATCH', '', { status: 'active' })} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"><RotateCcw className="h-4 w-4" />{t('automation.resume')}</button><button type="button" disabled={busy} onClick={() => { if (confirm(t('automation.deleteConfirm', { title: selected.title }))) void mutate(selected, 'DELETE'); }} className="ml-auto inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"><Trash2 className="h-4 w-4" />{t('automation.deleteForever')}</button></>}
        </div>
      </section>
      <section className="rounded-2xl border bg-card p-5"><div className="flex items-center gap-2 font-semibold"><Clock3 className="h-4 w-4 text-primary" />{t('automation.lastRunTitle')}</div>{selected.lastRunAt ? <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><span className="text-muted-foreground">{t('automation.startedAt')}</span>{formatDate(selected.lastRunAt)}</div><div><span className="text-muted-foreground">{t('automation.result')}</span>{t(`automation.runStatus.${selected.lastStatus || 'running'}`, { defaultValue: selected.lastStatus || t('automation.waitingResult') })}</div>{selected.lastSessionId && <div className="sm:col-span-2"><span className="text-muted-foreground">{t('automation.session')}</span><code className="text-xs">{selected.lastSessionId}</code></div>}{selected.lastError && <div className="rounded-lg bg-destructive/5 p-3 text-destructive sm:col-span-2">{selected.lastError}</div>}</div> : <p className="mt-3 text-sm text-muted-foreground">{t('automation.noRuns')}</p>}
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-muted/45 p-3 text-xs leading-5 text-muted-foreground"><Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{t('automation.runHint')}</div>
      </section>
    </div> : <div className="flex h-full min-h-[360px] flex-col items-center justify-center p-8 text-center"><CalendarClock className="mb-3 h-10 w-10 text-primary" /><div className="font-semibold">{projects.length ? t('automation.emptyTitle') : t('automation.needProject')}</div><p className="mt-1 max-w-md text-sm text-muted-foreground">{t('automation.emptyHint')}</p>{projects.length > 0 && <button type="button" onClick={beginCreate} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" />{t('automation.create')}</button>}</div>}
  </ExplorerPage>;
}
