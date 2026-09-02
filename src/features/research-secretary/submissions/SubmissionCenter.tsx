import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw, Save } from 'lucide-react';
import type { Project } from '../../../types/app';
import { Button } from '../../../components/ui/button';
import { ExplorerPage, explorerItemClass } from '../../../components/explorer/ExplorerPage';
import { EmptyState, SectionCard } from '../components/WorkbenchUi';
import type { Manuscript, Submission, SubmissionStatus } from '../domain/types';
import { SUBMISSION_STATUS_ORDER } from '../domain/status';
import { researchTrackingApi } from '../services/researchTrackingApi';
import SubmissionCard from './SubmissionCard';

type FilterValue = 'all' | 'attention' | 'active' | 'complete';
const FIELD = 'mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm';
const FILTERS: Array<{ value: FilterValue; labelKey: string }> = [
  { value: 'all', labelKey: 'submissions.filters.all' }, { value: 'attention', labelKey: 'submissions.filters.attention' }, { value: 'active', labelKey: 'submissions.filters.active' }, { value: 'complete', labelKey: 'submissions.filters.complete' },
];
const FILTER_GROUPS: Record<Exclude<FilterValue, 'all'>, SubmissionStatus[]> = {
  attention: ['minor_revision', 'major_revision', 'rejected', 'presubmission_check'],
  active: ['submitted', 'with_editor', 'under_review', 'resubmitted'],
  complete: ['accepted', 'proof', 'published'],
};

export default function SubmissionCenter({ projects, onMenuClick }: { projects: Project[]; onMenuClick?: () => void }) {
  const { t } = useTranslation('workbench');
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
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : t('submissions.loadFailed')); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const mutate = useCallback(async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await operation(); await load(); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : t('common.saveFailed')); setBusy(false); }
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

  return <ExplorerPage onMenuClick={onMenuClick} eyebrow="Research operations" title={t('submissions.title')} countLabel={`${submissions.length}`} searchPlaceholder={t('submissions.searchPlaceholder')} searchValue={searchQuery} onSearchChange={setSearchQuery}
    sidebar={<>{FILTERS.map((item) => <button key={item.value} type="button" onClick={() => { setFilter(item.value); setSelectedId(null); }} className={explorerItemClass(filter === item.value)}><span>{t(item.labelKey)}</span></button>)}{filtered.map((submission) => { const manuscript = manuscripts.find((item) => item.id === submission.manuscriptId); return <button key={submission.id} type="button" onClick={() => setSelectedId(submission.id)} className={explorerItemClass(selected?.id === submission.id)}><span className="min-w-0"><span className="block truncate">{manuscript?.shortTitle || manuscript?.title || submission.journal}</span><span className="mt-1 block truncate text-[11px] font-normal text-muted-foreground">{submission.journal}</span></span></button>; })}</>}
    resultsEyebrow={t('submissions.resultsEyebrow')} resultsTitle={selectedManuscript?.shortTitle || selectedManuscript?.title || selected?.journal || t('submissions.manuscriptDetail')} resultsDescription={t('submissions.description')}
    resultsActions={<div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void load()}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /></Button><Button size="sm" onClick={() => setCreating((value) => !value)}><Plus className="h-4 w-4" />{t('submissions.register')}</Button></div>}>
    <div className="space-y-4 p-5">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>}
      {creating && <SectionCard title={t('submissions.formTitle')}><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium">{t('submissions.manuscriptTitle')}<input className={FIELD} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label className="text-xs font-medium">{t('submissions.shortTitle')}<input className={FIELD} value={form.shortTitle} onChange={(event) => setForm({ ...form, shortTitle: event.target.value })} /></label><label className="text-xs font-medium">{t('submissions.journal')}<input className={FIELD} value={form.journal} onChange={(event) => setForm({ ...form, journal: event.target.value })} /></label><label className="text-xs font-medium">{t('submissions.project')}<select className={FIELD} value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}><option value="">{t('common.unlinked')}</option>{projects.map((project) => <option key={project.name} value={project.name}>{project.displayName}</option>)}</select></label><label className="text-xs font-medium">{t('submissions.deadline')}<input type="date" className={FIELD} value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} /></label><label className="text-xs font-medium">{t('submissions.nextAction')}<input className={FIELD} value={form.nextAction} onChange={(event) => setForm({ ...form, nextAction: event.target.value })} /></label></div><div className="mt-3 flex justify-end"><Button disabled={busy || !form.title.trim() || !form.journal.trim()} onClick={() => void mutate(async () => { const payload = await researchTrackingApi.createSubmission({ title: form.title.trim(), shortTitle: form.shortTitle.trim() || undefined, journal: form.journal.trim(), projectId: form.projectId || undefined, deadline: form.deadline || undefined, nextAction: form.nextAction.trim() || undefined }); setSelectedId(payload.submission.id); setCreating(false); setForm({ title: '', shortTitle: '', journal: '', projectId: '', deadline: '', nextAction: '' }); })}><Save className="h-4 w-4" />{t('common.save')}</Button></div></SectionCard>}
      {selected ? <><SubmissionCard submission={selected} manuscript={selectedManuscript} projectNames={projectNames} /><SectionCard title={t('submissions.updateStatus')}><div className="grid gap-3 sm:grid-cols-3"><label className="text-xs font-medium">{t('submissions.status')}<select className={FIELD} value={selected.status} onChange={(event) => void mutate(() => researchTrackingApi.updateSubmission(selected.id, { status: event.target.value as SubmissionStatus }))}>{SUBMISSION_STATUS_ORDER.map((value) => <option key={value} value={value}>{t(`submissionStatus.${value}`)}</option>)}</select></label><label className="text-xs font-medium">{t('submissions.deadline')}<input type="date" className={FIELD} value={selected.deadline?.slice(0, 10) || ''} onChange={(event) => void mutate(() => researchTrackingApi.updateSubmission(selected.id, { deadline: event.target.value || null }))} /></label><label className="text-xs font-medium">{t('submissions.completion')}<input type="number" min="0" max="100" className={FIELD} value={selectedManuscript?.completion || 0} onChange={(event) => void mutate(() => researchTrackingApi.updateSubmission(selected.id, { completion: Number(event.target.value) }))} /></label></div><label className="mt-3 block text-xs font-medium">{t('submissions.nextAction')}<input className={FIELD} value={selected.nextAction || ''} onChange={(event) => setSubmissions((current) => current.map((item) => item.id === selected.id ? { ...item, nextAction: event.target.value } : item))} onBlur={(event) => void mutate(() => researchTrackingApi.updateSubmission(selected.id, { nextAction: event.target.value.trim() || null }))} /></label><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{selected.documents.map((document) => <button key={document.kind} type="button" className={`rounded-lg border px-3 py-2 text-left text-xs ${document.ready ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200' : ''}`} onClick={() => void mutate(() => researchTrackingApi.updateSubmission(selected.id, { documents: selected.documents.map((item) => item.kind === document.kind ? { ...item, ready: !item.ready } : item) }))}>{document.ready ? '✓ ' : '○ '}{document.label}</button>)}</div></SectionCard></> : !creating && <EmptyState>{t('submissions.empty')}</EmptyState>}
    </div>
  </ExplorerPage>;
}
