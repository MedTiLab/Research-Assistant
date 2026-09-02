import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('workbench');
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
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : t('review.loadFailed')); }
    finally { setBusy(false); }
  }, [date]);

  useEffect(() => { void load(date); }, [date]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutate = useCallback(async (operation: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await operation(); await load(date); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : t('common.saveFailed')); setBusy(false); }
  }, [date, load]);

  const statusCards = useMemo(() => [
    { label: t('review.cards.work'), value: t('duration.minutes', { count: status?.workMinutes || 0 }), hint: t('review.cards.workHint', { count: status?.attendanceCount || 0 }) },
    { label: t('review.cards.focus'), value: t('duration.minutes', { count: status?.focusMinutes || 0 }), hint: status?.currentTask?.title || t('review.cards.noTask') },
    { label: t('review.cards.habits'), value: `${status?.habitCompletion || 0}%`, hint: t('review.cards.habitsHint', { completed: status?.habitCompleted || 0, total: status?.habitTotal || 0 }) },
    { label: t('review.cards.todos'), value: t('review.cards.todosValue', { count: status?.todayTodoCount || 0 }), hint: status?.working ? t('review.cards.working') : t('review.cards.notWorking') },
    { label: t('review.cards.review'), value: status?.reviewCompleted ? t('review.cards.reviewDone') : t('review.cards.reviewPending'), hint: status?.reviewCompleted ? t('review.cards.reviewDoneHint') : t('review.cards.reviewPendingHint') },
    { label: t('review.cards.submissions'), value: t('review.cards.submissionsValue', { count: status?.activeSubmissionCount || 0 }), hint: t('review.cards.submissionsHint') },
  ], [status, t]);

  return (
    <ExplorerPage
      onMenuClick={onMenuClick}
      eyebrow="Daily operating loop"
      title={t('review.title')}
      countLabel={status?.reviewCompleted ? t('review.reviewed') : t('review.pending')}
      searchPlaceholder={t('review.searchPlaceholder')}
      searchValue={date}
      onSearchChange={(value) => { if (/^\d{4}-\d{2}-\d{2}$/.test(value)) setDate(value); }}
      sidebar={<><button type="button" className={explorerItemClass(date === localToday())} onClick={() => setDate(localToday())}><span>{t('common.today')}</span></button>{history.map((review) => <button key={review.id} type="button" className={explorerItemClass(review.date === date)} onClick={() => setDate(review.date)}><span className="min-w-0"><span className="block">{review.date}</span><span className="mt-1 block text-[11px] font-normal text-muted-foreground">{t('review.mood', { mood: review.mood || '-' })}</span></span></button>)}</>}
      resultsEyebrow={t('review.resultsEyebrow')}
      resultsTitle={date === localToday() ? t('review.resultsTitleToday') : t('review.resultsTitleDate', { date })}
      resultsDescription={t('review.resultsDescription')}
      resultsActions={<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-9 rounded-lg border bg-background px-3 text-sm" />}
    >
      <div className="space-y-4 p-5">
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{statusCards.map((card) => <div key={card.label} className="rounded-xl border border-border/70 bg-card p-4"><div className="text-xs text-muted-foreground">{card.label}</div><div className="mt-1 text-xl font-semibold">{card.value}</div><div className="mt-1 truncate text-xs text-muted-foreground">{card.hint}</div></div>)}</div>
        {date === localToday() && <div className="grid gap-4 xl:grid-cols-2">
          <SectionCard title={t('review.workAndFocus')} icon={<Clock3 className="h-4 w-4 text-primary" />}><div className="flex flex-wrap gap-2"><Button disabled={busy || Boolean(status?.working)} onClick={() => void mutate(() => researchTrackingApi.startWork())}><Play className="h-4 w-4" />{t('review.startWork')}</Button><Button variant="outline" disabled={busy || !status?.working} onClick={() => void mutate(() => researchTrackingApi.endWork())}><Square className="h-4 w-4" />{t('review.endWork')}</Button></div><div className="mt-4 grid gap-2 sm:grid-cols-[110px_1fr_auto]"><input type="number" min="1" max="1440" className={`${FIELD} mt-0`} value={focus.minutes} onChange={(event) => setFocus({ ...focus, minutes: event.target.value })} aria-label={t('review.focusMinutes')} /><input className={`${FIELD} mt-0`} value={focus.taskTitle} onChange={(event) => setFocus({ ...focus, taskTitle: event.target.value })} placeholder={t('review.focusTask')} /><Button variant="outline" disabled={busy || Number(focus.minutes) < 1} onClick={() => void mutate(async () => { await researchTrackingApi.logFocus({ date, minutes: Number(focus.minutes), taskTitle: focus.taskTitle.trim() || undefined }); setFocus({ ...focus, taskTitle: '' }); })}><Coffee className="h-4 w-4" />{t('review.logFocus')}</Button></div></SectionCard>
          <SectionCard title={t('review.habitsTitle')} icon={<CheckCircle2 className="h-4 w-4 text-primary" />}><div className="space-y-2">{habits.map((habit) => <button key={habit.id} type="button" className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left" onClick={() => void mutate(() => researchTrackingApi.setHabitEntry(habit.id, date, { completed: !habit.completed }))}>{habit.completed ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-muted-foreground" />}<span className="text-sm">{habit.title}</span></button>)}</div><div className="mt-3 flex gap-2"><input className={`${FIELD} mt-0`} value={newHabit} onChange={(event) => setNewHabit(event.target.value)} placeholder={t('review.habitPlaceholder')} /><Button variant="outline" disabled={busy || !newHabit.trim()} onClick={() => void mutate(async () => { await researchTrackingApi.createHabit(newHabit.trim()); setNewHabit(''); })}><Plus className="h-4 w-4" /></Button></div></SectionCard>
        </div>}
        <SectionCard title={t('review.sectionTitle')} icon={<History className="h-4 w-4 text-primary" />}><div className="grid gap-3 lg:grid-cols-2"><label className="text-xs font-medium">{t('review.accomplishments')}<textarea rows={5} className={FIELD} value={form.accomplishments} onChange={(event) => setForm({ ...form, accomplishments: event.target.value })} /></label><label className="text-xs font-medium">{t('review.obstacles')}<textarea rows={5} className={FIELD} value={form.obstacles} onChange={(event) => setForm({ ...form, obstacles: event.target.value })} /></label><label className="text-xs font-medium">{t('review.insights')}<textarea rows={5} className={FIELD} value={form.insights} onChange={(event) => setForm({ ...form, insights: event.target.value })} /></label><label className="text-xs font-medium">{t('review.tomorrow')}<textarea rows={5} className={FIELD} value={form.tomorrowPriorities} onChange={(event) => setForm({ ...form, tomorrowPriorities: event.target.value })} /></label></div><div className="mt-3 flex items-center justify-between gap-3"><label className="text-xs font-medium">{t('review.moodLabel')} <select className="ml-2 h-9 rounded-lg border bg-background px-2" value={form.mood} onChange={(event) => setForm({ ...form, mood: event.target.value })}><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option></select></label><Button disabled={busy} onClick={() => void mutate(() => researchTrackingApi.saveDailyReview(date, { accomplishments: form.accomplishments, obstacles: form.obstacles, insights: form.insights, tomorrowPriorities: form.tomorrowPriorities.split('\n').map((item) => item.trim()).filter(Boolean), mood: Number(form.mood) }))}><Save className="h-4 w-4" />{t('review.saveReview')}</Button></div></SectionCard>
      </div>
    </ExplorerPage>
  );
}
