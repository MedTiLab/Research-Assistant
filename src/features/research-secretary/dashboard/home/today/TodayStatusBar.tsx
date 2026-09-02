import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Pause, Play, Square } from 'lucide-react';
import { cn } from '../../../../../lib/utils';
import type { WorkbenchAttendanceLog, WorkbenchFocusSession, WorkbenchTodayStatus } from '../../../domain/types';
import { researchTrackingApi } from '../../../services/researchTrackingApi';
import { GhostButton, PrimaryButton } from '../HomeUi';
import CheckInSegments, { formatDuration, sortSegments, totalSegmentMinutes } from './CheckInSegments';
import FocusSessions, { sortFocusSessions, totalFocusMinutes } from './FocusSessions';
import {
  BREAK_MINUTES,
  DEFAULT_FOCUS_MINUTES,
  FOCUS_PRESETS_MIN,
  displayFocusMinutes,
  elapsedMsOf,
  formatClock,
  idlePomodoro,
  liveWorkMinutes,
  loggableMinutes,
  pausePomodoro,
  readPomodoro,
  remainingMsOf,
  resumePomodoro,
  startBreak,
  startFocus,
  writePomodoro,
  type PomodoroSnapshot,
} from '../pomodoro';

type Props = {
  now: Date;
  status: WorkbenchTodayStatus | null;
  logs: WorkbenchAttendanceLog[];
  focusSessions: WorkbenchFocusSession[];
  dailyFocus: string;
  onRefresh: () => void;
};

type Drawer = 'work' | 'focus' | null;

function requestNotifyPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'default') void Notification.requestPermission();
}

function notify(title: string, body: string) {
  if (typeof window === 'undefined') return;
  if (window.medhelpDesktop?.showNotification) {
    void window.medhelpDesktop.showNotification({ title, body });
    void window.medhelpDesktop.playCompletionSound?.();
    return;
  }
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}

function CountdownRing({
  remainingMs,
  durationMs,
  tone,
}: {
  remainingMs: number;
  durationMs: number;
  tone: 'idle' | 'focus' | 'break';
}) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const progress = durationMs > 0 ? Math.min(1, remainingMs / durationMs) : 0;
  const stroke = tone === 'focus' ? 'stroke-primary' : tone === 'break' ? 'stroke-clinical-evidence' : 'stroke-border';

  return (
    <svg viewBox="0 0 72 72" className="h-[72px] w-[72px] flex-shrink-0" aria-hidden>
      <circle cx="36" cy="36" r={radius} fill="none" className="stroke-border/80" strokeWidth="5" />
      <circle
        cx="36"
        cy="36"
        r={radius}
        fill="none"
        className={cn('transition-[stroke-dasharray] duration-500', stroke)}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${circumference * progress} ${circumference}`}
        transform="rotate(-90 36 36)"
      />
    </svg>
  );
}

function Readout({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums leading-tight text-foreground">{value}</div>
      {hint && <div className="truncate text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export default function TodayStatusBar({ now, status, logs, focusSessions, dailyFocus, onRefresh }: Props) {
  const nowMs = now.getTime();
  const [snapshot, setSnapshot] = useState<PomodoroSnapshot>(() => readPomodoro(typeof window === 'undefined' ? null : window.localStorage));
  const [taskDraft, setTaskDraft] = useState(() => dailyFocus || status?.currentTask?.title || '');
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const snapshotRef = useRef(snapshot);
  const completingRef = useRef(false);
  const fetchedAtRef = useRef(nowMs);

  useEffect(() => { snapshotRef.current = snapshot; }, [snapshot]);
  useEffect(() => { fetchedAtRef.current = nowMs; }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (snapshot.phase !== 'idle') return;
    if (dailyFocus.trim()) setTaskDraft(dailyFocus);
  }, [dailyFocus, snapshot.phase]);

  const apply = useCallback((next: PomodoroSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
    writePomodoro(typeof window === 'undefined' ? null : window.localStorage, next);
  }, []);

  const remainingMs = remainingMsOf(snapshot, nowMs);
  const workMinutes = liveWorkMinutes(status?.workMinutes || 0, Boolean(status?.working), fetchedAtRef.current, nowMs);
  const focusMinutes = displayFocusMinutes(status?.focusMinutes || 0, snapshot, nowMs);
  const taskTitle = (snapshot.phase === 'idle' ? taskDraft : snapshot.taskTitle).trim();
  const segments = sortSegments(logs);
  const segmentTotal = totalSegmentMinutes(segments, nowMs);
  const focusOrdered = sortFocusSessions(focusSessions);
  const focusLoggedTotal = totalFocusMinutes(focusOrdered);

  const ensureWorking = useCallback(async () => {
    if (status?.working) return;
    try {
      await researchTrackingApi.startWork();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      if (!/already open/i.test(message)) throw cause;
    }
  }, [status?.working]);

  const finishPhase = useCallback(async () => {
    const current = snapshotRef.current;
    const at = Date.now();
    if (current.phase === 'focus') {
      const minutes = loggableMinutes(elapsedMsOf(current, at));
      apply(startBreak(current.taskTitle, at));
      completingRef.current = false;
      notify('专注结束', minutes > 0 ? `已记入 ${minutes} 分钟，休息 ${BREAK_MINUTES} 分钟。` : `休息 ${BREAK_MINUTES} 分钟，或再开一轮。`);
      if (minutes > 0) {
        try {
          await researchTrackingApi.logFocus({ minutes, taskTitle: current.taskTitle || undefined });
          onRefresh();
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : '记录专注时长失败');
        }
      }
      return;
    }
    if (current.phase === 'break') {
      apply(idlePomodoro(DEFAULT_FOCUS_MINUTES, current.taskTitle));
      notify('休息结束', '可以开始下一轮专注。');
    }
    completingRef.current = false;
  }, [apply, onRefresh]);

  useEffect(() => {
    if (snapshot.phase === 'idle' || !snapshot.running) return;
    if (remainingMsOf(snapshot, nowMs) > 0) return;
    if (completingRef.current) return;
    completingRef.current = true;
    void finishPhase();
  }, [finishPhase, nowMs, snapshot]);

  const beginFocus = useCallback(async (minutes = DEFAULT_FOCUS_MINUTES) => {
    setBusy(true);
    setError('');
    requestNotifyPermission();
    try {
      await ensureWorking();
      apply(startFocus(taskDraft || dailyFocus, minutes, Date.now()));
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '开始专注失败');
    } finally {
      setBusy(false);
    }
  }, [apply, dailyFocus, ensureWorking, onRefresh, taskDraft]);

  const stopFocus = useCallback(async () => {
    const current = snapshotRef.current;
    const minutes = current.phase === 'focus' ? loggableMinutes(elapsedMsOf(current, Date.now())) : 0;
    apply(idlePomodoro(DEFAULT_FOCUS_MINUTES, current.taskTitle || taskDraft));
    setBusy(true);
    setError('');
    try {
      if (minutes > 0) {
        await researchTrackingApi.logFocus({ minutes, taskTitle: current.taskTitle || undefined });
        onRefresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '结束专注失败');
    } finally {
      setBusy(false);
    }
  }, [apply, onRefresh, taskDraft]);

  const toggleWork = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      if (status?.working) await researchTrackingApi.endWork();
      else await ensureWorking();
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '更新工作打卡失败');
    } finally {
      setBusy(false);
    }
  }, [ensureWorking, onRefresh, status?.working]);

  const clearWork = useCallback(async () => {
    if (typeof window !== 'undefined' && !window.confirm('清零今天的全部工作打卡？时长会回到 0。')) return;
    setBusy(true);
    setError('');
    try {
      await researchTrackingApi.clearAttendance(status?.date);
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '清零工作时长失败');
    } finally {
      setBusy(false);
    }
  }, [onRefresh, status?.date]);

  const clearFocus = useCallback(async () => {
    if (typeof window !== 'undefined' && !window.confirm('清零今天的全部专注记录？时长会回到 0。')) return;
    setBusy(true);
    setError('');
    try {
      await researchTrackingApi.clearFocusSessions(status?.date);
      if (snapshotRef.current.phase === 'focus') {
        apply(idlePomodoro(DEFAULT_FOCUS_MINUTES, snapshotRef.current.taskTitle || taskDraft));
      }
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '清零专注时长失败');
    } finally {
      setBusy(false);
    }
  }, [apply, onRefresh, status?.date, taskDraft]);

  const deleteWorkSegment = useCallback(async (id: string) => {
    setBusy(true);
    setError('');
    try {
      await researchTrackingApi.deleteAttendance(id);
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除打卡记录失败');
    } finally {
      setBusy(false);
    }
  }, [onRefresh]);

  const deleteFocusSession = useCallback(async (id: string) => {
    setBusy(true);
    setError('');
    try {
      await researchTrackingApi.deleteFocusSession(id);
      onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除专注记录失败');
    } finally {
      setBusy(false);
    }
  }, [onRefresh]);

  const toggleDrawer = (next: Drawer) => {
    setDrawer((current) => (current === next ? null : next));
  };

  const phaseLabel = snapshot.phase === 'focus'
    ? (snapshot.running ? '专注中' : '专注已暂停')
    : snapshot.phase === 'break'
      ? (snapshot.running ? '休息中' : '休息已暂停')
      : '番茄时钟';

  return (
    <div className="border-b border-border/60 px-4 py-3 sm:px-5">
      {/* Two fixed rows: the clock never has to compete with the buttons for width, so the
          task input and the phase label keep their space at any panel size. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-[240px] flex-1 items-center gap-3">
          <CountdownRing
            remainingMs={snapshot.phase === 'idle' ? snapshot.durationMs : remainingMs}
            durationMs={snapshot.durationMs}
            tone={snapshot.phase}
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[28px] font-semibold leading-none tabular-nums text-foreground">
                {formatClock(snapshot.phase === 'idle' ? snapshot.durationMs : remainingMs)}
              </span>
              <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">{phaseLabel}</span>
            </div>
            {snapshot.phase === 'idle' ? (
              <input
                value={taskDraft}
                onChange={(event) => setTaskDraft(event.target.value)}
                placeholder="本次专注任务，默认用今日焦点"
                className="mt-1.5 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/70"
              />
            ) : (
              <div className="mt-1.5 truncate text-sm text-muted-foreground">{taskTitle || '未命名专注'}</div>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={() => toggleDrawer('work')}
            aria-expanded={drawer === 'work'}
            className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-muted/60"
          >
            <Readout
              label="工作时长"
              value={`${workMinutes} 分钟`}
              hint={segments.length > 0 ? `今天 ${segments.length} 段打卡` : '还没有打卡'}
            />
            <ChevronDown className={cn('h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform', drawer === 'work' && 'rotate-180')} />
          </button>
          <button
            type="button"
            onClick={() => toggleDrawer('focus')}
            aria-expanded={drawer === 'focus'}
            className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-muted/60"
          >
            <Readout
              label="专注时长"
              value={`${focusMinutes} 分钟`}
              hint={focusOrdered.length > 0 ? `今天 ${focusOrdered.length} 段专注` : (status?.working ? '正在工作' : '未开始工作')}
            />
            <ChevronDown className={cn('h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform', drawer === 'focus' && 'rotate-180')} />
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {snapshot.phase === 'idle' ? (
          <>
            {FOCUS_PRESETS_MIN.map((minutes) => (
              <button
                key={minutes}
                type="button"
                disabled={busy}
                onClick={() => void beginFocus(minutes)}
                className={cn(
                  'h-8 whitespace-nowrap rounded-lg border px-2 text-[11px] font-medium tabular-nums transition-colors',
                  minutes === DEFAULT_FOCUS_MINUTES
                    ? 'border-primary/30 bg-primary/10 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:border-primary/35 hover:text-foreground',
                )}
              >
                {minutes} 分钟
              </button>
            ))}
            <PrimaryButton className="h-8 whitespace-nowrap px-3 text-xs" disabled={busy} onClick={() => void beginFocus()}>
              <Play className="h-3.5 w-3.5" />开始专注
            </PrimaryButton>
          </>
        ) : (
          <>
            <GhostButton
              className="h-8 whitespace-nowrap px-3 text-xs"
              disabled={busy}
              onClick={() => apply(snapshot.running ? pausePomodoro(snapshot, Date.now()) : resumePomodoro(snapshot, Date.now()))}
            >
              {snapshot.running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {snapshot.running ? '暂停' : '继续'}
            </GhostButton>
            <GhostButton className="h-8 whitespace-nowrap px-3 text-xs" disabled={busy} onClick={() => void stopFocus()}>
              <Square className="h-3.5 w-3.5" />结束
            </GhostButton>
            {snapshot.phase === 'break' && (
              <PrimaryButton className="h-8 whitespace-nowrap px-3 text-xs" disabled={busy} onClick={() => void beginFocus()}>
                <Play className="h-3.5 w-3.5" />下一轮
              </PrimaryButton>
            )}
          </>
        )}
        <GhostButton className="h-8 whitespace-nowrap px-3 text-xs" disabled={busy} onClick={() => void toggleWork()}>
          {status?.working ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {status?.working ? '结束工作' : '开始工作'}
        </GhostButton>
      </div>

      {drawer === 'work' && (
        <div className="mt-3 rounded-xl border border-border/60 bg-muted/25 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[11px] text-muted-foreground">
              {segments.length > 0
                ? `今天 ${segments.length} 段 · 共 ${formatDuration(segmentTotal)}`
                : '一天内可以多次开始和结束工作'}
            </div>
            <GhostButton
              className="h-7 whitespace-nowrap px-2 text-[11px]"
              disabled={busy || segments.length === 0}
              onClick={() => void clearWork()}
            >
              清零
            </GhostButton>
          </div>
          <CheckInSegments logs={segments} now={now} busy={busy} onDelete={(id) => void deleteWorkSegment(id)} />
        </div>
      )}

      {drawer === 'focus' && (
        <div className="mt-3 rounded-xl border border-border/60 bg-muted/25 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[11px] text-muted-foreground">
              {focusOrdered.length > 0
                ? `今天 ${focusOrdered.length} 段 · 已记入 ${formatDuration(focusLoggedTotal)}`
                : '番茄结束后会按任务名记入专注时长'}
            </div>
            <GhostButton
              className="h-7 whitespace-nowrap px-2 text-[11px]"
              disabled={busy || focusOrdered.length === 0}
              onClick={() => void clearFocus()}
            >
              清零
            </GhostButton>
          </div>
          <FocusSessions sessions={focusOrdered} busy={busy} onDelete={(id) => void deleteFocusSession(id)} />
        </div>
      )}

      {error && <div className="mt-2 text-xs text-destructive">{error}</div>}
    </div>
  );
}
