import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, Clock3, Coffee, History, Play, Plus, Save, Square } from 'lucide-react';

import { Button } from '../../../components/ui/button';
import { ExplorerPage, explorerItemClass } from '../../../components/explorer/ExplorerPage';
import { SectionCard } from '../components/WorkbenchUi';
import type { WorkbenchDailyReview, WorkbenchHabit, WorkbenchTodayStatus } from '../domain/types';
import { researchTrackingApi } from '../services/researchTrackingApi';

const FIELD = 'mt-1.5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';

function localToday() {
  const date = new Date(); const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function emptyForm() {
  return { accomplishments: '', obstacles: '', insights: '', tomorrowPriorities: '', mood: '3' };
}

function reviewForm(review: WorkbenchDailyReview | null) {
  if (!review) return emptyForm();
  return { accomplishments: review.accomplishments, obstacles: review.obstacles, insights: review.insights, tomorrowPriorities: review.tomorrowPriorities.join('\n'), mood: String(review.mood || 3) };
}

export default function DailyReviewCenter({ onMenuClick }: { onMenuClick?: () => void }) {
  const [date, setDate] = useState(localToday());
  const [status, setStatus] = useState<WorkbenchTodayStatus | null>(null);
  const [habits, setHabits] = useState<WorkbenchHabit[]>([]);
  const [history, setHistory] = useState<WorkbenchDailyReview[]>([]);
  const [form, setForm] = useState(emptyForm());
  const [focus, setFocus] = useState({ minutes: '30', taskTitle: '' });
  const [newHabit, setNewHabit] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (targetDate = date) => {
    setBusy(true); setError('');
    try {
      const [nextStatus, habitResult, reviews] = await Promise.all([
        researchTrackingApi.getTodayStatus(targetDate), researchTrackingApi.listHabits(targetDate), researchTrackingApi.listDailyReviews(45),
      ]);
      setStatus(nextStatus); setHabits(habitResult.habits); setHistory(reviews); setForm(reviewForm(nextStatus.review));
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : '加载今日状态失败'); }
    finally { setBusy(false); }
  }, [date]);

  useEffect(() => { void load(date); }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutate = useCallback(async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await operation(); await load(date); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : '保存失败'); setBusy(false); }
  }, [date, load]);

  const statusCards = useMemo(() => [
    { label: '工作时长', value: `${status?.workMinutes || 0} 分钟`, hint: `${status?.attendanceCount || 0} 个工作段` },
    { label: '专注时长', value: `${status?.focusMinutes || 0} 分钟`, hint: status?.currentTask?.title || '尚无当前任务' },
    { label: '习惯完成度', value: `${status?.habitCompletion || 0}%`, hint: `${status?.habitCompleted || 0}/${status?.habitTotal || 0} 已完成` },
    { label: '今日待办', value: `${status?.todayTodoCount || 0} 项`, hint: status?.working ? '当前正在工作' : '当前未打卡' },
    { label: '复盘状态', value: status?.reviewCompleted ? '已完成' : '待复盘', hint: status?.reviewCompleted ? '可以继续修改' : '写下今天的结论' },
    { label: '投稿进行中', value: `${status?.activeSubmissionCount || 0} 篇`, hint: '需跟进的活跃稿件' },
  ], [status]);

  return (
    <ExplorerPage
      onMenuClick={onMenuClick}
      eyebrow="Daily operating loop"
      title="今日状态与复盘"
      countLabel={status?.reviewCompleted ? '已复盘' : '待复盘'}
      searchPlaceholder="选择日期"
      searchValue={date}
      onSearchChange={(value) => { if (/^\d{4}-\d{2}-\d{2}$/.test(value)) setDate(value); }}
      sidebar={<><button type="button" className={explorerItemClass(date === localToday())} onClick={() => setDate(localToday())}><span>今天</span></button>{history.map((review) => <button key={review.id} type="button" className={explorerItemClass(review.date === date)} onClick={() => setDate(review.date)}><span className="min-w-0"><span className="block">{review.date}</span><span className="mt-1 block text-[11px] font-normal text-muted-foreground">心情 {review.mood || '-'} / 5</span></span></button>)}</>}
      resultsEyebrow="今日闭环"
      resultsTitle={date === localToday() ? '今日状态' : `${date} 状态`}
      resultsDescription="把工作打卡、专注、习惯、待办与每日复盘收在一处，并同步给 Pi。"
      resultsActions={<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-9 rounded-lg border bg-background px-3 text-sm" />}
    >
      <div className="space-y-4 p-5">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{statusCards.map((card) => <div key={card.label} className="rounded-xl border border-border/70 bg-card p-4"><div className="text-xs text-muted-foreground">{card.label}</div><div className="mt-1 text-xl font-semibold">{card.value}</div><div className="mt-1 truncate text-xs text-muted-foreground">{card.hint}</div></div>)}</div>
        {date === localToday() && <div className="grid gap-4 xl:grid-cols-2">
          <SectionCard title="工作与专注" icon={<Clock3 className="h-4 w-4 text-primary" />}><div className="flex flex-wrap gap-2"><Button disabled={busy || Boolean(status?.working)} onClick={() => void mutate(() => researchTrackingApi.startWork())}><Play className="h-4 w-4" />开始工作</Button><Button variant="outline" disabled={busy || !status?.working} onClick={() => void mutate(() => researchTrackingApi.endWork())}><Square className="h-4 w-4" />结束工作</Button></div><div className="mt-4 grid gap-2 sm:grid-cols-[110px_1fr_auto]"><input type="number" min="1" max="1440" className={`${FIELD} mt-0`} value={focus.minutes} onChange={(event) => setFocus({ ...focus, minutes: event.target.value })} aria-label="专注分钟" /><input className={`${FIELD} mt-0`} value={focus.taskTitle} onChange={(event) => setFocus({ ...focus, taskTitle: event.target.value })} placeholder="本次专注任务" /><Button variant="outline" disabled={busy || Number(focus.minutes) < 1} onClick={() => void mutate(async () => { await researchTrackingApi.logFocus({ date, minutes: Number(focus.minutes), taskTitle: focus.taskTitle.trim() || undefined }); setFocus({ ...focus, taskTitle: '' }); })}><Coffee className="h-4 w-4" />记入</Button></div></SectionCard>
          <SectionCard title="今日习惯" icon={<CheckCircle2 className="h-4 w-4 text-primary" />}><div className="space-y-2">{habits.map((habit) => <button key={habit.id} type="button" className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left" onClick={() => void mutate(() => researchTrackingApi.setHabitEntry(habit.id, date, { completed: !habit.completed }))}>{habit.completed ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-muted-foreground" />}<span className="text-sm">{habit.title}</span></button>)}</div><div className="mt-3 flex gap-2"><input className={`${FIELD} mt-0`} value={newHabit} onChange={(event) => setNewHabit(event.target.value)} placeholder="新增习惯，例如：阅读 30 分钟" /><Button variant="outline" disabled={busy || !newHabit.trim()} onClick={() => void mutate(async () => { await researchTrackingApi.createHabit(newHabit.trim()); setNewHabit(''); })}><Plus className="h-4 w-4" /></Button></div></SectionCard>
        </div>}
        <SectionCard title="每日复盘" icon={<History className="h-4 w-4 text-primary" />}><div className="grid gap-3 lg:grid-cols-2"><label className="text-xs font-medium">今天完成了什么<textarea rows={5} className={FIELD} value={form.accomplishments} onChange={(event) => setForm({ ...form, accomplishments: event.target.value })} /></label><label className="text-xs font-medium">卡点与障碍<textarea rows={5} className={FIELD} value={form.obstacles} onChange={(event) => setForm({ ...form, obstacles: event.target.value })} /></label><label className="text-xs font-medium">经验与洞察<textarea rows={5} className={FIELD} value={form.insights} onChange={(event) => setForm({ ...form, insights: event.target.value })} /></label><label className="text-xs font-medium">明日重点（每行一项）<textarea rows={5} className={FIELD} value={form.tomorrowPriorities} onChange={(event) => setForm({ ...form, tomorrowPriorities: event.target.value })} /></label></div><div className="mt-3 flex items-center justify-between gap-3"><label className="text-xs font-medium">今日心情 <select className="ml-2 h-9 rounded-lg border bg-background px-2" value={form.mood} onChange={(event) => setForm({ ...form, mood: event.target.value })}><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select></label><Button disabled={busy} onClick={() => void mutate(() => researchTrackingApi.saveDailyReview(date, { accomplishments: form.accomplishments, obstacles: form.obstacles, insights: form.insights, tomorrowPriorities: form.tomorrowPriorities.split('\n').map((item) => item.trim()).filter(Boolean), mood: Number(form.mood) }))}><Save className="h-4 w-4" />保存复盘</Button></div></SectionCard>
      </div>
    </ExplorerPage>
  );
}
