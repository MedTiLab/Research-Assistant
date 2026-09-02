import { useCallback, useEffect, useMemo, useState } from 'react';
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

const statusLabels: Record<AutomationStatus, string> = { active: '运行中', paused: '已暂停', cancelled: '已归档', completed: '已完成' };
const runStatusLabels: Record<string, string> = { running: '执行中', completed: '成功', failed: '失败', cancelled: '已中止', interrupted: '意外中断' };
const repeatOptions = [
  { value: '', label: '不重复' },
  { value: '60', label: '每小时' },
  { value: '1440', label: '每天' },
  { value: '10080', label: '每周' },
  { value: '43200', label: '每 30 天' },
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

function scheduleLabel(item: Pick<AutomationRecord, 'intervalMinutes' | 'status'>) {
  if (!item.intervalMinutes) return item.status === 'completed' ? '单次任务已完成' : '单次执行';
  if (item.intervalMinutes % 10080 === 0) return `每 ${item.intervalMinutes / 10080} 周`;
  if (item.intervalMinutes % 1440 === 0) return `每 ${item.intervalMinutes / 1440} 天`;
  if (item.intervalMinutes % 60 === 0) return `每 ${item.intervalMinutes / 60} 小时`;
  return `每 ${item.intervalMinutes} 分钟`;
}

function modelKey(model?: AutomationModel | null) {
  return model ? `${model.modelProviderId}\u0000${model.modelId}\u0000${model.modelApi}` : '';
}

function modelForKey(key: string, models: AutomationModelOption[]): AutomationModel | null {
  const option = models.find((item) => modelKey(item) === key);
  return option ? { modelId: option.modelId, modelProviderId: option.modelProviderId, modelApi: option.modelApi } : null;
}

function defaultModelKey(models: AutomationModelOption[]) {
  const remembered = {
    modelId: localStorage.getItem('pi-model') || '',
    modelProviderId: localStorage.getItem('pi-model-provider') || '',
    modelApi: localStorage.getItem('pi-model-api') || '',
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

function timezoneLabel() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || '本机时区';
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
  const ready = Boolean(draft.projectKey && draft.title.trim() && draft.prompt.trim() && draft.at && modelForKey(draft.modelKey, models));
  const selectedInterval = repeatOptions.some((option) => option.value === draft.intervalMinutes);
  const scheduled = draft.at ? new Date(draft.at) : null;
  const scheduledLabel = scheduled && Number.isFinite(scheduled.getTime()) ? scheduled.toLocaleString() : '尚未设置';

  return <div className="flex h-full min-h-0 flex-col bg-background">
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-4 md:px-6">
      <button type="button" onClick={onCancel} className="rounded-lg p-2 hover:bg-muted" aria-label="返回自动化列表"><X className="h-4 w-4" /></button>
      <div><div className="font-semibold">{mode === 'create' ? '新建自动化' : '编辑自动化'}</div><div className="text-xs text-muted-foreground">设置 Agent 模型、执行时间、重复频率和任务指令</div></div>
      <button type="button" disabled={busy || modelsLoading || !ready} onClick={onSave} className="ml-auto inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{mode === 'create' ? '保存自动化' : '保存修改'}
      </button>
    </header>
    {(error || modelError) && <div role="alert" className="border-b border-destructive/30 bg-destructive/5 px-5 py-3 text-sm text-destructive">{error || modelError}</div>}
    <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-8"><div className="mx-auto max-w-2xl space-y-5 rounded-2xl border bg-card p-5 shadow-sm md:p-7">
      <label className="block text-sm font-medium">所属项目
        <select value={draft.projectKey} disabled={mode === 'edit'} onChange={(event) => onDraftChange({ ...draft, projectKey: event.target.value })} className="mt-2 w-full rounded-lg border bg-background px-3 py-2.5 disabled:opacity-60">
          <option value="">选择项目</option>{projects.map((project) => <option key={project.name} value={project.name}>{project.displayName || project.name}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium">名称
        <input maxLength={200} value={draft.title} onChange={(event) => onDraftChange({ ...draft, title: event.target.value })} placeholder="例如：每周文献进展汇总" className="mt-2 w-full rounded-lg border bg-background px-3 py-2.5" />
      </label>
      <label className="block text-sm font-medium">执行模型
        <select value={draft.modelKey} disabled={modelsLoading || models.length === 0} onChange={(event) => onDraftChange({ ...draft, modelKey: event.target.value })} className="mt-2 w-full rounded-lg border bg-background px-3 py-2.5 disabled:opacity-60">
          <option value="">{modelsLoading ? '正在加载模型…' : models.length ? '选择模型' : '没有可用模型'}</option>
          {models.map((model) => <option key={modelKey(model)} value={modelKey(model)}>{model.label}</option>)}
        </select>
        <span className="mt-1.5 block text-xs font-normal text-muted-foreground">模型会固定保存到这条自动化，不会随聊天窗口当前选择而变化。</span>
      </label>
      <label className="block text-sm font-medium">执行任务
        <textarea maxLength={16000} rows={7} value={draft.prompt} onChange={(event) => onDraftChange({ ...draft, prompt: event.target.value })} placeholder="清楚描述要检查的数据、产出格式和完成标准…" className="mt-2 w-full resize-y rounded-lg border bg-background px-3 py-2.5 leading-6" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">{mode === 'create' ? '首次执行时间' : '下次执行时间'}
          <input type="datetime-local" min={localDateTimeValue(new Date(Date.now() + 60_000))} value={draft.at} onChange={(event) => onDraftChange({ ...draft, at: event.target.value })} className="mt-2 w-full rounded-lg border bg-background px-3 py-2.5" />
        </label>
        <label className="block text-sm font-medium">重复频率
          <select value={draft.intervalMinutes} onChange={(event) => onDraftChange({ ...draft, intervalMinutes: event.target.value })} className="mt-2 w-full rounded-lg border bg-background px-3 py-2.5">
            {!selectedInterval && draft.intervalMinutes && <option value={draft.intervalMinutes}>每 {draft.intervalMinutes} 分钟（当前）</option>}
            {repeatOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      </div>
      <div className="rounded-xl bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">
        <div className="font-medium text-foreground">计划预览：{scheduledLabel}</div>
        <div>按 {timezoneLabel()} 显示；重复任务会从这个时间点开始，按所选频率继续运行。</div>
        <div className="mt-1">每次执行都会创建一个独立的 Pi Agent 会话，并在所属项目中以只读权限运行；后端需保持运行。</div>
      </div>
    </div></div>
  </div>;
}

export default function AutomationCenter({ projects, onMenuClick }: { projects: Project[]; onRunCommand?: (command: WorkbenchCommand) => void; onMenuClick?: () => void }) {
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
    setError(failures.length === projects.length ? String(failures[0]?.reason?.message || '自动化加载失败') : failures.length ? `${failures.length} 个项目的自动化暂时无法加载` : '');
    setLoading(false);
  }, [projects]);

  const loadModels = useCallback(async () => {
    setModelsLoading(true); setModelError('');
    try {
      const nextModels = await listAutomationModels();
      setModels(nextModels);
      if (!nextModels.length) setModelError('没有可用的 Pi 对话模型，请先到“设置 → medhelpOS → 模型”启用模型。');
    } catch (cause) {
      setModels([]); setModelError(cause instanceof Error ? cause.message : '模型列表加载失败');
    } finally { setModelsLoading(false); }
  }, []);

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

  const sidebar = <div className="space-y-3">
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted/60 p-1">{([{ id: 'active', label: '运行中' }, { id: 'paused', label: '已暂停' }, { id: 'archived', label: '归档' }] as const).map((entry) => <button key={entry.id} type="button" onClick={() => setTab(entry.id)} className={`rounded-lg px-2 py-2 text-xs font-medium ${tab === entry.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>{entry.label} · {counts[entry.id]}</button>)}</div>
    {loading ? <p className="px-1 py-8 text-center text-sm text-muted-foreground">正在加载自动化…</p> : visibleItems.length ? visibleItems.map((item) => <button key={`${item.projectKey}:${item.id}`} type="button" onClick={() => setSelectedId(item.id)} className={explorerItemClass(selected?.id === item.id)}><span className="min-w-0"><span className="block truncate">{item.title}</span><span className="mt-1 block truncate text-[11px] font-normal text-muted-foreground">{projectLabels.get(item.projectKey) || item.projectKey} · {scheduleLabel(item)}</span></span></button>) : <p className="px-1 py-8 text-center text-sm text-muted-foreground">{query ? '没有匹配的自动化' : `没有${tab === 'active' ? '运行中' : tab === 'paused' ? '已暂停' : '已归档'}的自动化`}</p>}
  </div>;

  const selectedModelLabel = selected?.model ? models.find((model) => modelKey(model) === modelKey(selected.model))?.label || selected.model.modelId : '执行时使用当前默认模型（旧任务）';

  return <ExplorerPage onMenuClick={onMenuClick} eyebrow="Research automation" title="自动化" countLabel={`${items.length}`} searchPlaceholder="搜索任务、项目或指令…" searchValue={query} onSearchChange={setQuery} sidebar={sidebar} resultsEyebrow={selected ? projectLabels.get(selected.projectKey) || selected.projectKey : '自动化'} resultsTitle={selected?.title || '自动化任务'} resultsDescription={selected ? `${scheduleLabel(selected)} · ${statusLabels[selected.status]}` : '定时执行文献追踪、投稿监控、汇报准备和其他研究工作。'} resultsActions={<div className="flex gap-2"><button type="button" disabled={loading || busy} onClick={() => void load()} className="rounded-lg border p-2 hover:bg-muted" aria-label="刷新自动化"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button><button type="button" disabled={!projects.length} onClick={beginCreate} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"><Plus className="h-4 w-4" />新建自动化</button></div>}>
    {error && <div role="alert" className="border-b border-destructive/30 bg-destructive/5 px-5 py-3 text-sm text-destructive">{error}</div>}
    {selected ? <div className="space-y-5 p-5 md:p-7">
      <section className="rounded-2xl border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><CalendarClock className="h-5 w-5" /></span><div className="min-w-0"><h2 className="truncate text-lg font-semibold">{selected.title}</h2><p className="mt-1 text-xs text-muted-foreground">{projectLabels.get(selected.projectKey) || selected.projectKey}</p></div></div><div className="flex items-center gap-2"><button type="button" disabled={modelsLoading || models.length === 0} onClick={() => beginEdit(selected)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"><Pencil className="h-3.5 w-3.5" />编辑设置</button><span className={`rounded-full px-3 py-1 text-xs font-medium ${selected.status === 'active' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : selected.status === 'paused' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-muted text-muted-foreground'}`}>{statusLabels[selected.status]}</span></div></div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl bg-muted/45 p-3"><div className="text-xs text-muted-foreground">执行模型</div><div className="mt-1 truncate text-sm font-medium" title={selectedModelLabel}>{selectedModelLabel}</div></div>
          <div className="rounded-xl bg-muted/45 p-3"><div className="text-xs text-muted-foreground">执行频率</div><div className="mt-1 text-sm font-medium">{scheduleLabel(selected)}</div></div>
          <div className="rounded-xl bg-muted/45 p-3"><div className="text-xs text-muted-foreground">下次执行</div><div className="mt-1 text-sm font-medium">{formatDate(selected.nextRunAt)}</div></div>
          <div className="rounded-xl bg-muted/45 p-3"><div className="text-xs text-muted-foreground">上次执行</div><div className="mt-1 text-sm font-medium">{formatDate(selected.lastRunAt)}</div></div>
        </div>
        <p className="mt-2 text-right text-[11px] text-muted-foreground">时间按 {timezoneLabel()} 显示</p>
        <div className="mt-4 rounded-xl border bg-background p-4"><div className="mb-2 text-xs font-medium text-muted-foreground">任务指令</div><p className="whitespace-pre-wrap text-sm leading-6">{selected.prompt}</p></div>
        <div className="mt-4 flex flex-wrap gap-2">
          {selected.status === 'active' ? <button type="button" disabled={busy} onClick={() => void mutate(selected, 'PATCH', '', { status: 'paused' })} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"><Pause className="h-4 w-4" />暂停</button> : selected.status === 'paused' ? <button type="button" disabled={busy} onClick={() => void mutate(selected, 'PATCH', '', { status: 'active' })} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"><RotateCcw className="h-4 w-4" />恢复</button> : null}
          {selected.status !== 'cancelled' && <button type="button" disabled={busy} onClick={() => void mutate(selected, 'POST', '/run')} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"><Play className="h-4 w-4" />立即执行</button>}
          {!['cancelled', 'completed'].includes(selected.status) ? <button type="button" disabled={busy} onClick={() => { if (confirm(`归档自动化“${selected.title}”？`)) void mutate(selected, 'PATCH', '', { status: 'cancelled' }); }} className="ml-auto inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"><Archive className="h-4 w-4" />归档</button> : <><button type="button" disabled={busy} onClick={() => void mutate(selected, 'PATCH', '', { status: 'active' })} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"><RotateCcw className="h-4 w-4" />恢复</button><button type="button" disabled={busy} onClick={() => { if (confirm(`永久删除自动化“${selected.title}”？此操作无法撤销。`)) void mutate(selected, 'DELETE'); }} className="ml-auto inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"><Trash2 className="h-4 w-4" />永久删除</button></>}
        </div>
      </section>
      <section className="rounded-2xl border bg-card p-5"><div className="flex items-center gap-2 font-semibold"><Clock3 className="h-4 w-4 text-primary" />最近一次执行</div>{selected.lastRunAt ? <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><span className="text-muted-foreground">开始时间：</span>{formatDate(selected.lastRunAt)}</div><div><span className="text-muted-foreground">结果：</span>{runStatusLabels[selected.lastStatus || ''] || selected.lastStatus || '等待结果'}</div>{selected.lastSessionId && <div className="sm:col-span-2"><span className="text-muted-foreground">独立 Agent 会话：</span><code className="text-xs">{selected.lastSessionId}</code></div>}{selected.lastError && <div className="rounded-lg bg-destructive/5 p-3 text-destructive sm:col-span-2">{selected.lastError}</div>}</div> : <p className="mt-3 text-sm text-muted-foreground">这项自动化还没有执行记录。</p>}
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-muted/45 p-3 text-xs leading-5 text-muted-foreground"><Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />每次运行都会新建独立的 Pi Agent 会话，不会向当前聊天追加消息；会话使用上方固定的模型与只读权限。</div>
      </section>
    </div> : <div className="flex h-full min-h-[360px] flex-col items-center justify-center p-8 text-center"><CalendarClock className="mb-3 h-10 w-10 text-primary" /><div className="font-semibold">{projects.length ? '还没有自动化任务' : '请先创建一个项目'}</div><p className="mt-1 max-w-md text-sm text-muted-foreground">创建后，任务会按计划在所属项目中运行，并保留最近一次执行状态。</p>{projects.length > 0 && <button type="button" onClick={beginCreate} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" />新建自动化</button>}</div>}
  </ExplorerPage>;
}
