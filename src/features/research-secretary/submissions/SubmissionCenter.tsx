import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Save } from 'lucide-react';
import type { Project } from '../../../types/app';
import { Button } from '../../../components/ui/button';
import { ExplorerPage, explorerItemClass } from '../../../components/explorer/ExplorerPage';
import { EmptyState, SectionCard } from '../components/WorkbenchUi';
import type { Manuscript, Submission, SubmissionStatus } from '../domain/types';
import { researchTrackingApi } from '../services/researchTrackingApi';
import SubmissionCard from './SubmissionCard';

type FilterValue = 'all' | 'attention' | 'active' | 'complete';
const FIELD = 'mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm';
const FILTERS: Array<{ value: FilterValue; label: string }> = [
  { value: 'all', label: '全部' }, { value: 'attention', label: '需要处理' }, { value: 'active', label: '审稿中' }, { value: 'complete', label: '已完成' },
];
const FILTER_GROUPS: Record<Exclude<FilterValue, 'all'>, SubmissionStatus[]> = {
  attention: ['minor_revision', 'major_revision', 'rejected', 'presubmission_check'],
  active: ['submitted', 'with_editor', 'under_review', 'resubmitted'],
  complete: ['accepted', 'proof', 'published'],
};
const STATUS_LABELS: Record<SubmissionStatus, string> = {
  draft: '草稿', journal_selected: '已选期刊', presubmission_check: '投稿前检查', submitted: '已投稿', with_editor: '编辑处理中', under_review: '外审中', minor_revision: '小修', major_revision: '大修', rejected: '拒稿', resubmitted: '已重投', accepted: '已接收', proof: '校样', published: '已发表',
};

export default function SubmissionCenter({ projects, onMenuClick }: { projects: Project[]; onMenuClick?: () => void }) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [manuscripts, setManuscripts] = useState<Manuscript[]>([]);
  const [filter, setFilter] = useState<FilterValue>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ title: '', shortTitle: '', journal: '', projectId: '', deadline: '', nextAction: '' });
  const projectNames = new Map(projects.map((project) => [project.name, project.displayName]));

  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const payload = await researchTrackingApi.listSubmissions();
      setSubmissions(payload.submissions); setManuscripts(payload.manuscripts);
      setSelectedId((current) => current && payload.submissions.some((item) => item.id === current) ? current : payload.submissions[0]?.id || null);
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : '加载投稿记录失败'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const mutate = useCallback(async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await operation(); await load(); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : '保存失败'); setBusy(false); }
  }, [load]);

  const filtered = useMemo(() => {
    const base = filter === 'all' ? submissions : submissions.filter((item) => FILTER_GROUPS[filter].includes(item.status));
    const query = searchQuery.trim().toLowerCase();
    return query ? base.filter((item) => {
      const manuscript = manuscripts.find((entry) => entry.id === item.manuscriptId);
      return item.journal.toLowerCase().includes(query) || (manuscript?.title || '').toLowerCase().includes(query) || (manuscript?.shortTitle || '').toLowerCase().includes(query);
    }) : base;
  }, [filter, manuscripts, searchQuery, submissions]);
  const selected = submissions.find((item) => item.id === selectedId) || filtered[0] || null;
  const selectedManuscript = manuscripts.find((item) => item.id === selected?.manuscriptId);

  return <ExplorerPage onMenuClick={onMenuClick} eyebrow="Research operations" title="投稿目录" countLabel={`${submissions.length}`} searchPlaceholder="搜索期刊或稿件…" searchValue={searchQuery} onSearchChange={setSearchQuery}
    sidebar={<>{FILTERS.map((item) => <button key={item.value} type="button" onClick={() => { setFilter(item.value); setSelectedId(null); }} className={explorerItemClass(filter === item.value)}><span>{item.label}</span></button>)}{filtered.map((submission) => { const manuscript = manuscripts.find((item) => item.id === submission.manuscriptId); return <button key={submission.id} type="button" onClick={() => setSelectedId(submission.id)} className={explorerItemClass(selected?.id === submission.id)}><span className="min-w-0"><span className="block truncate">{manuscript?.shortTitle || manuscript?.title || submission.journal}</span><span className="mt-1 block truncate text-[11px] font-normal text-muted-foreground">{submission.journal}</span></span></button>; })}</>}
    resultsEyebrow="投稿中心" resultsTitle={selectedManuscript?.shortTitle || selectedManuscript?.title || selected?.journal || '稿件详情'} resultsDescription="统一查看稿件、期刊状态、修回材料、投稿邮件与 Deadline；Pi 可同步读写。"
    resultsActions={<div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void load()}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /></Button><Button size="sm" onClick={() => setCreating((value) => !value)}><Plus className="h-4 w-4" />登记稿件</Button></div>}>
    <div className="space-y-4 p-5">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>}
      {creating && <SectionCard title="登记稿件"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium">稿件标题<input className={FIELD} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label className="text-xs font-medium">短标题<input className={FIELD} value={form.shortTitle} onChange={(event) => setForm({ ...form, shortTitle: event.target.value })} /></label><label className="text-xs font-medium">目标期刊<input className={FIELD} value={form.journal} onChange={(event) => setForm({ ...form, journal: event.target.value })} /></label><label className="text-xs font-medium">关联项目<select className={FIELD} value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}><option value="">不关联</option>{projects.map((project) => <option key={project.name} value={project.name}>{project.displayName}</option>)}</select></label><label className="text-xs font-medium">截止日期<input type="date" className={FIELD} value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} /></label><label className="text-xs font-medium">下一步<input className={FIELD} value={form.nextAction} onChange={(event) => setForm({ ...form, nextAction: event.target.value })} /></label></div><div className="mt-3 flex justify-end"><Button disabled={busy || !form.title.trim() || !form.journal.trim()} onClick={() => void mutate(async () => { const payload = await researchTrackingApi.createSubmission({ title: form.title.trim(), shortTitle: form.shortTitle.trim() || undefined, journal: form.journal.trim(), projectId: form.projectId || undefined, deadline: form.deadline || undefined, nextAction: form.nextAction.trim() || undefined }); setSelectedId(payload.submission.id); setCreating(false); setForm({ title: '', shortTitle: '', journal: '', projectId: '', deadline: '', nextAction: '' }); })}><Save className="h-4 w-4" />保存</Button></div></SectionCard>}
      {selected ? <><SubmissionCard submission={selected} manuscript={selectedManuscript} projectNames={projectNames} /><SectionCard title="更新投稿状态"><div className="grid gap-3 sm:grid-cols-3"><label className="text-xs font-medium">状态<select className={FIELD} value={selected.status} onChange={(event) => void mutate(() => researchTrackingApi.updateSubmission(selected.id, { status: event.target.value as SubmissionStatus }))}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-xs font-medium">截止日期<input type="date" className={FIELD} value={selected.deadline?.slice(0, 10) || ''} onChange={(event) => void mutate(() => researchTrackingApi.updateSubmission(selected.id, { deadline: event.target.value || null }))} /></label><label className="text-xs font-medium">稿件完成度<input type="number" min="0" max="100" className={FIELD} value={selectedManuscript?.completion || 0} onChange={(event) => void mutate(() => researchTrackingApi.updateSubmission(selected.id, { completion: Number(event.target.value) }))} /></label></div><label className="mt-3 block text-xs font-medium">下一步<input className={FIELD} value={selected.nextAction || ''} onChange={(event) => setSubmissions((current) => current.map((item) => item.id === selected.id ? { ...item, nextAction: event.target.value } : item))} onBlur={(event) => void mutate(() => researchTrackingApi.updateSubmission(selected.id, { nextAction: event.target.value.trim() || null }))} /></label><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{selected.documents.map((document) => <button key={document.kind} type="button" className={`rounded-lg border px-3 py-2 text-left text-xs ${document.ready ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200' : ''}`} onClick={() => void mutate(() => researchTrackingApi.updateSubmission(selected.id, { documents: selected.documents.map((item) => item.kind === document.kind ? { ...item, ready: !item.ready } : item) }))}>{document.ready ? '✓ ' : '○ '}{document.label}</button>)}</div></SectionCard></> : !creating && <EmptyState>尚未登记投稿。点击“登记稿件”开始跟踪真实投稿进度。</EmptyState>}
    </div>
  </ExplorerPage>;
}
