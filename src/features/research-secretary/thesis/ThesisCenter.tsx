import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpenCheck, CheckCircle2, Circle, Clock3, Plus, RefreshCw } from 'lucide-react';

import type { Project } from '../../../types/app';
import { Button } from '../../../components/ui/button';
import { ExplorerPage, explorerItemClass } from '../../../components/explorer/ExplorerPage';
import { EmptyState, SectionCard } from '../components/WorkbenchUi';
import type { ThesisProject, ThesisStatus } from '../domain/types';
import { researchTrackingApi } from '../services/researchTrackingApi';

const FIELD = 'mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm';
const THESIS_STATUSES: ThesisStatus[] = ['planning', 'writing', 'review', 'submitted', 'completed'];

function today() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export default function ThesisCenter({ projects, onMenuClick }: { projects: Project[]; onMenuClick?: () => void }) {
  const { t } = useTranslation('workbench');
  const [theses, setTheses] = useState<ThesisProject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThesisProject | null>(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ title: '', degree: '', targetDate: '', projectId: '' });
  const [chapterTitle, setChapterTitle] = useState('');
  const [milestone, setMilestone] = useState({ title: '', dueDate: '' });
  const [progressLog, setProgressLog] = useState({ date: today(), minutes: '60', words: '0', note: '' });

  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const rows = await researchTrackingApi.listTheses();
      setTheses(rows);
      const nextId = selectedId && rows.some((item) => item.id === selectedId) ? selectedId : rows[0]?.id || null;
      setSelectedId(nextId);
      setDetail(nextId ? await researchTrackingApi.getThesis(nextId) : null);
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : t('thesis.loadFailed')); }
    finally { setBusy(false); }
  }, [selectedId, t]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const select = useCallback(async (id: string) => {
    setSelectedId(id); setBusy(true); setError('');
    try { setDetail(await researchTrackingApi.getThesis(id)); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : t('thesis.loadDetailFailed')); }
    finally { setBusy(false); }
  }, [t]);

  const mutate = useCallback(async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try {
      await operation();
      if (selectedId) setDetail(await researchTrackingApi.getThesis(selectedId));
      setTheses(await researchTrackingApi.listTheses());
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : t('common.saveFailed')); }
    finally { setBusy(false); }
  }, [selectedId, t]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? theses.filter((item) => item.title.toLowerCase().includes(normalized)) : theses;
  }, [query, theses]);
  const projectNames = new Map(projects.map((project) => [project.name, project.displayName]));

  return (
    <ExplorerPage
      onMenuClick={onMenuClick}
      eyebrow="Thesis operations"
      title={t('thesis.title')}
      countLabel={`${theses.length}`}
      searchPlaceholder={t('thesis.searchPlaceholder')}
      searchValue={query}
      onSearchChange={setQuery}
      sidebar={<>{filtered.map((item) => <button key={item.id} type="button" onClick={() => void select(item.id)} className={explorerItemClass(item.id === selectedId)}><span className="min-w-0"><span className="block truncate">{item.title}</span><span className="mt-1 block text-[11px] font-normal text-muted-foreground">{t(`thesisStatus.${item.status}`)} · {item.completion}%</span></span></button>)}</>}
      resultsEyebrow={t('thesis.resultsEyebrow')}
      resultsTitle={detail?.title || t('thesis.resultsTitle')}
      resultsDescription={t('thesis.description')}
      resultsActions={<div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void load()}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /></Button><Button size="sm" onClick={() => setCreating((value) => !value)}><Plus className="h-4 w-4" />{t('thesis.newThesis')}</Button></div>}
    >
      <div className="space-y-4 p-5">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>}
        {creating && <SectionCard title={t('thesis.registerTitle')} icon={<BookOpenCheck className="h-4 w-4 text-primary" />}><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium">{t('thesis.thesisTitle')}<input className={FIELD} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label className="text-xs font-medium">{t('thesis.degree')}<input className={FIELD} value={form.degree} placeholder={t('thesis.degreeDefault')} onChange={(event) => setForm({ ...form, degree: event.target.value })} /></label><label className="text-xs font-medium">{t('thesis.targetDate')}<input type="date" className={FIELD} value={form.targetDate} onChange={(event) => setForm({ ...form, targetDate: event.target.value })} /></label><label className="text-xs font-medium">{t('thesis.project')}<select className={FIELD} value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}><option value="">{t('common.unlinked')}</option>{projects.map((project) => <option key={project.name} value={project.name}>{project.displayName}</option>)}</select></label></div><div className="mt-3 flex justify-end"><Button disabled={busy || !form.title.trim()} onClick={() => void mutate(async () => { const created = await researchTrackingApi.createThesis({ title: form.title.trim(), degree: form.degree.trim() || t('thesis.degreeDefault'), targetDate: form.targetDate || undefined, projectId: form.projectId || undefined }); setSelectedId(created.id); setDetail(created); setForm({ title: '', degree: '', targetDate: '', projectId: '' }); setCreating(false); })}>{t('common.save')}</Button></div></SectionCard>}
        {!detail && !creating && <EmptyState>{t('thesis.empty')}</EmptyState>}
        {detail && <>
          <SectionCard title={t('thesis.overall')} icon={<BookOpenCheck className="h-4 w-4 text-primary" />}><div className="grid gap-3 sm:grid-cols-4"><label className="text-xs font-medium">{t('thesis.status')}<select className={FIELD} value={detail.status} onChange={(event) => void mutate(() => researchTrackingApi.updateThesis(detail.id, { status: event.target.value as ThesisStatus }))}>{THESIS_STATUSES.map((value) => <option key={value} value={value}>{t(`thesisStatus.${value}`)}</option>)}</select></label><label className="text-xs font-medium">{t('thesis.completion')}<input type="number" min="0" max="100" className={FIELD} value={detail.completion} onChange={(event) => void mutate(() => researchTrackingApi.updateThesis(detail.id, { completion: Number(event.target.value) }))} /></label><div className="sm:col-span-2 rounded-lg bg-muted/45 px-3 py-3 text-sm"><div className="font-medium">{projectNames.get(detail.projectId || '') || detail.degree}</div><div className="mt-1 text-xs text-muted-foreground">{t('thesis.targetDateValue', { date: detail.targetDate || t('thesis.unset') })}</div></div></div></SectionCard>
          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard title={t('thesis.chapters', { count: detail.chapters?.length || 0 })}><div className="mb-3 flex gap-2"><input className={`${FIELD} mt-0`} placeholder={t('thesis.addChapter')} value={chapterTitle} onChange={(event) => setChapterTitle(event.target.value)} /><Button disabled={busy || !chapterTitle.trim()} onClick={() => void mutate(async () => { await researchTrackingApi.addChapter(detail.id, { title: chapterTitle.trim(), orderIndex: detail.chapters?.length || 0 }); setChapterTitle(''); })}><Plus className="h-4 w-4" /></Button></div><div className="space-y-2">{detail.chapters?.map((chapter) => <div key={chapter.id} className="flex items-center gap-2 rounded-lg border px-3 py-2"><button type="button" onClick={() => void mutate(() => researchTrackingApi.updateChapter(chapter.id, { status: chapter.status === 'done' ? 'drafting' : 'done', completion: chapter.status === 'done' ? 60 : 100 }))}>{chapter.status === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-muted-foreground" />}</button><span className="min-w-0 flex-1 truncate text-sm">{chapter.title}</span><span className="text-xs text-muted-foreground">{chapter.completion}%</span></div>)}</div></SectionCard>
            <SectionCard title={t('thesis.milestones', { count: detail.milestones?.length || 0 })}><div className="mb-3 grid gap-2 sm:grid-cols-[1fr_140px_auto]"><input className={`${FIELD} mt-0`} placeholder={t('thesis.addMilestone')} value={milestone.title} onChange={(event) => setMilestone({ ...milestone, title: event.target.value })} /><input type="date" className={`${FIELD} mt-0`} value={milestone.dueDate} onChange={(event) => setMilestone({ ...milestone, dueDate: event.target.value })} /><Button disabled={busy || !milestone.title.trim()} onClick={() => void mutate(async () => { await researchTrackingApi.addMilestone(detail.id, { title: milestone.title.trim(), dueDate: milestone.dueDate || undefined }); setMilestone({ title: '', dueDate: '' }); })}><Plus className="h-4 w-4" /></Button></div><div className="space-y-2">{detail.milestones?.map((item) => <div key={item.id} className="flex items-center gap-2 rounded-lg border px-3 py-2"><button type="button" onClick={() => void mutate(() => researchTrackingApi.updateMilestone(item.id, { status: item.status === 'done' ? 'in_progress' : 'done' }))}>{item.status === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Clock3 className="h-4 w-4 text-amber-600" />}</button><span className="min-w-0 flex-1 truncate text-sm">{item.title}</span><span className="text-xs text-muted-foreground">{item.dueDate || t('thesis.noDue')}</span></div>)}</div></SectionCard>
          </div>
          <SectionCard title={t('thesis.logProgress')}><div className="grid gap-2 sm:grid-cols-[140px_100px_100px_1fr_auto]"><input type="date" className={`${FIELD} mt-0`} value={progressLog.date} onChange={(event) => setProgressLog({ ...progressLog, date: event.target.value })} /><input type="number" min="0" className={`${FIELD} mt-0`} title={t('thesis.minutes')} value={progressLog.minutes} onChange={(event) => setProgressLog({ ...progressLog, minutes: event.target.value })} /><input type="number" min="0" className={`${FIELD} mt-0`} title={t('thesis.words')} value={progressLog.words} onChange={(event) => setProgressLog({ ...progressLog, words: event.target.value })} /><input className={`${FIELD} mt-0`} placeholder={t('thesis.notePlaceholder')} value={progressLog.note} onChange={(event) => setProgressLog({ ...progressLog, note: event.target.value })} /><Button disabled={busy} onClick={() => void mutate(async () => { await researchTrackingApi.addThesisLog(detail.id, { date: progressLog.date, minutes: Number(progressLog.minutes) || 0, words: Number(progressLog.words) || 0, note: progressLog.note.trim() || undefined }); setProgressLog({ ...progressLog, note: '' }); })}>{t('thesis.log')}</Button></div></SectionCard>
        </>}
      </div>
    </ExplorerPage>
  );
}
