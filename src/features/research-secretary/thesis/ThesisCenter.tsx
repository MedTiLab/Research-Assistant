import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, CheckCircle2, Circle, Clock3, Plus, RefreshCw } from 'lucide-react';

import type { Project } from '../../../types/app';
import { Button } from '../../../components/ui/button';
import { ExplorerPage, explorerItemClass } from '../../../components/explorer/ExplorerPage';
import { EmptyState, SectionCard } from '../components/WorkbenchUi';
import type { ThesisProject, ThesisStatus } from '../domain/types';
import { researchTrackingApi } from '../services/researchTrackingApi';

const FIELD = 'mt-1.5 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm';
const STATUS_LABELS: Record<ThesisStatus, string> = {
  planning: '规划中', writing: '撰写中', review: '修改审阅', submitted: '已提交', completed: '已完成',
};

function today() {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export default function ThesisCenter({ projects, onMenuClick }: { projects: Project[]; onMenuClick?: () => void }) {
  const [theses, setTheses] = useState<ThesisProject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThesisProject | null>(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ title: '', degree: '博士', targetDate: '', projectId: '' });
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
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : '加载毕业论文进度失败'); }
    finally { setBusy(false); }
  }, [selectedId]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const select = useCallback(async (id: string) => {
    setSelectedId(id); setBusy(true); setError('');
    try { setDetail(await researchTrackingApi.getThesis(id)); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : '加载论文详情失败'); }
    finally { setBusy(false); }
  }, []);

  const mutate = useCallback(async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try {
      await operation();
      if (selectedId) setDetail(await researchTrackingApi.getThesis(selectedId));
      setTheses(await researchTrackingApi.listTheses());
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : '保存失败'); }
    finally { setBusy(false); }
  }, [selectedId]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? theses.filter((item) => item.title.toLowerCase().includes(normalized)) : theses;
  }, [query, theses]);
  const projectNames = new Map(projects.map((project) => [project.name, project.displayName]));

  return (
    <ExplorerPage
      onMenuClick={onMenuClick}
      eyebrow="Thesis operations"
      title="毕业论文"
      countLabel={`${theses.length}`}
      searchPlaceholder="搜索论文…"
      searchValue={query}
      onSearchChange={setQuery}
      sidebar={<>{filtered.map((item) => <button key={item.id} type="button" onClick={() => void select(item.id)} className={explorerItemClass(item.id === selectedId)}><span className="min-w-0"><span className="block truncate">{item.title}</span><span className="mt-1 block text-[11px] font-normal text-muted-foreground">{STATUS_LABELS[item.status]} · {item.completion}%</span></span></button>)}</>}
      resultsEyebrow="论文进度"
      resultsTitle={detail?.title || '毕业论文进度'}
      resultsDescription="维护里程碑、章节与每日推进日志，数据可由 Pi 读取和更新。"
      resultsActions={<div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void load()}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /></Button><Button size="sm" onClick={() => setCreating((value) => !value)}><Plus className="h-4 w-4" />新建论文</Button></div>}
    >
      <div className="space-y-4 p-5">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>}
        {creating && <SectionCard title="登记毕业论文" icon={<BookOpenCheck className="h-4 w-4 text-primary" />}><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-medium">论文题目<input className={FIELD} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label><label className="text-xs font-medium">学位<input className={FIELD} value={form.degree} onChange={(event) => setForm({ ...form, degree: event.target.value })} /></label><label className="text-xs font-medium">目标日期<input type="date" className={FIELD} value={form.targetDate} onChange={(event) => setForm({ ...form, targetDate: event.target.value })} /></label><label className="text-xs font-medium">关联项目<select className={FIELD} value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}><option value="">不关联</option>{projects.map((project) => <option key={project.name} value={project.name}>{project.displayName}</option>)}</select></label></div><div className="mt-3 flex justify-end"><Button disabled={busy || !form.title.trim()} onClick={() => void mutate(async () => { const created = await researchTrackingApi.createThesis({ title: form.title.trim(), degree: form.degree.trim() || '博士', targetDate: form.targetDate || undefined, projectId: form.projectId || undefined }); setSelectedId(created.id); setDetail(created); setForm({ title: '', degree: '博士', targetDate: '', projectId: '' }); setCreating(false); })}>保存</Button></div></SectionCard>}
        {!detail && !creating && <EmptyState>尚未登记毕业论文。点击“新建论文”开始维护章节、里程碑和推进日志。</EmptyState>}
        {detail && <>
          <SectionCard title="总体进度" icon={<BookOpenCheck className="h-4 w-4 text-primary" />}><div className="grid gap-3 sm:grid-cols-4"><label className="text-xs font-medium">状态<select className={FIELD} value={detail.status} onChange={(event) => void mutate(() => researchTrackingApi.updateThesis(detail.id, { status: event.target.value as ThesisStatus }))}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-xs font-medium">完成度<input type="number" min="0" max="100" className={FIELD} value={detail.completion} onChange={(event) => void mutate(() => researchTrackingApi.updateThesis(detail.id, { completion: Number(event.target.value) }))} /></label><div className="sm:col-span-2 rounded-lg bg-muted/45 px-3 py-3 text-sm"><div className="font-medium">{projectNames.get(detail.projectId || '') || detail.degree}</div><div className="mt-1 text-xs text-muted-foreground">目标日期 {detail.targetDate || '未设置'}</div></div></div></SectionCard>
          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard title={`章节 ${detail.chapters?.length || 0}`}><div className="mb-3 flex gap-2"><input className={`${FIELD} mt-0`} placeholder="新增章节" value={chapterTitle} onChange={(event) => setChapterTitle(event.target.value)} /><Button disabled={busy || !chapterTitle.trim()} onClick={() => void mutate(async () => { await researchTrackingApi.addChapter(detail.id, { title: chapterTitle.trim(), orderIndex: detail.chapters?.length || 0 }); setChapterTitle(''); })}><Plus className="h-4 w-4" /></Button></div><div className="space-y-2">{detail.chapters?.map((chapter) => <div key={chapter.id} className="flex items-center gap-2 rounded-lg border px-3 py-2"><button type="button" onClick={() => void mutate(() => researchTrackingApi.updateChapter(chapter.id, { status: chapter.status === 'done' ? 'drafting' : 'done', completion: chapter.status === 'done' ? 60 : 100 }))}>{chapter.status === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-muted-foreground" />}</button><span className="min-w-0 flex-1 truncate text-sm">{chapter.title}</span><span className="text-xs text-muted-foreground">{chapter.completion}%</span></div>)}</div></SectionCard>
            <SectionCard title={`里程碑 ${detail.milestones?.length || 0}`}><div className="mb-3 grid gap-2 sm:grid-cols-[1fr_140px_auto]"><input className={`${FIELD} mt-0`} placeholder="新增里程碑" value={milestone.title} onChange={(event) => setMilestone({ ...milestone, title: event.target.value })} /><input type="date" className={`${FIELD} mt-0`} value={milestone.dueDate} onChange={(event) => setMilestone({ ...milestone, dueDate: event.target.value })} /><Button disabled={busy || !milestone.title.trim()} onClick={() => void mutate(async () => { await researchTrackingApi.addMilestone(detail.id, { title: milestone.title.trim(), dueDate: milestone.dueDate || undefined }); setMilestone({ title: '', dueDate: '' }); })}><Plus className="h-4 w-4" /></Button></div><div className="space-y-2">{detail.milestones?.map((item) => <div key={item.id} className="flex items-center gap-2 rounded-lg border px-3 py-2"><button type="button" onClick={() => void mutate(() => researchTrackingApi.updateMilestone(item.id, { status: item.status === 'done' ? 'in_progress' : 'done' }))}>{item.status === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Clock3 className="h-4 w-4 text-amber-600" />}</button><span className="min-w-0 flex-1 truncate text-sm">{item.title}</span><span className="text-xs text-muted-foreground">{item.dueDate || '无期限'}</span></div>)}</div></SectionCard>
          </div>
          <SectionCard title="记录今日推进"><div className="grid gap-2 sm:grid-cols-[140px_100px_100px_1fr_auto]"><input type="date" className={`${FIELD} mt-0`} value={progressLog.date} onChange={(event) => setProgressLog({ ...progressLog, date: event.target.value })} /><input type="number" min="0" className={`${FIELD} mt-0`} title="分钟" value={progressLog.minutes} onChange={(event) => setProgressLog({ ...progressLog, minutes: event.target.value })} /><input type="number" min="0" className={`${FIELD} mt-0`} title="字数" value={progressLog.words} onChange={(event) => setProgressLog({ ...progressLog, words: event.target.value })} /><input className={`${FIELD} mt-0`} placeholder="本次推进内容" value={progressLog.note} onChange={(event) => setProgressLog({ ...progressLog, note: event.target.value })} /><Button disabled={busy} onClick={() => void mutate(async () => { await researchTrackingApi.addThesisLog(detail.id, { date: progressLog.date, minutes: Number(progressLog.minutes) || 0, words: Number(progressLog.words) || 0, note: progressLog.note.trim() || undefined }); setProgressLog({ ...progressLog, note: '' }); })}>记录</Button></div></SectionCard>
        </>}
      </div>
    </ExplorerPage>
  );
}
