export const POMODORO_STORAGE_KEY = 'research-secretary:pomodoro';
export const FOCUS_PRESETS_MIN = [15, 25, 50] as const;
export const DEFAULT_FOCUS_MINUTES = 25;
export const BREAK_MINUTES = 5;

export type PomodoroPhase = 'idle' | 'focus' | 'break';

export type PomodoroSnapshot = {
  phase: PomodoroPhase;
  durationMs: number;
  remainingMs: number;
  running: boolean;
  startedAt: number | null;
  taskTitle: string;
};

export function minutesToMs(minutes: number) {
  return Math.max(1, minutes) * 60_000;
}

export function idlePomodoro(minutes = DEFAULT_FOCUS_MINUTES, taskTitle = ''): PomodoroSnapshot {
  const durationMs = minutesToMs(minutes);
  return {
    phase: 'idle',
    durationMs,
    remainingMs: durationMs,
    running: false,
    startedAt: null,
    taskTitle,
  };
}

export function remainingMsOf(snapshot: PomodoroSnapshot, nowMs: number) {
  if (!snapshot.running || snapshot.startedAt == null) return Math.max(0, snapshot.remainingMs);
  return Math.max(0, snapshot.remainingMs - (nowMs - snapshot.startedAt));
}

export function elapsedMsOf(snapshot: PomodoroSnapshot, nowMs: number) {
  return Math.max(0, snapshot.durationMs - remainingMsOf(snapshot, nowMs));
}

export function formatClock(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function loggableMinutes(elapsedMs: number) {
  if (elapsedMs < 30_000) return 0;
  return Math.max(1, Math.round(elapsedMs / 60_000));
}

export function liveWorkMinutes(workMinutes: number, working: boolean, fetchedAtMs: number, nowMs: number) {
  if (!working) return workMinutes;
  return workMinutes + Math.max(0, Math.floor((nowMs - fetchedAtMs) / 60_000));
}

export function displayFocusMinutes(focusMinutes: number, snapshot: PomodoroSnapshot, nowMs: number) {
  if (snapshot.phase !== 'focus') return focusMinutes;
  return focusMinutes + Math.floor(elapsedMsOf(snapshot, nowMs) / 60_000);
}

export function pausePomodoro(snapshot: PomodoroSnapshot, nowMs: number): PomodoroSnapshot {
  return {
    ...snapshot,
    remainingMs: remainingMsOf(snapshot, nowMs),
    running: false,
    startedAt: null,
  };
}

export function resumePomodoro(snapshot: PomodoroSnapshot, nowMs: number): PomodoroSnapshot {
  if (snapshot.phase === 'idle') return snapshot;
  return {
    ...snapshot,
    remainingMs: remainingMsOf(snapshot, nowMs),
    running: true,
    startedAt: nowMs,
  };
}

export function startFocus(taskTitle: string, minutes = DEFAULT_FOCUS_MINUTES, nowMs = Date.now()): PomodoroSnapshot {
  const durationMs = minutesToMs(minutes);
  return {
    phase: 'focus',
    durationMs,
    remainingMs: durationMs,
    running: true,
    startedAt: nowMs,
    taskTitle: taskTitle.trim(),
  };
}

export function startBreak(taskTitle: string, nowMs = Date.now()): PomodoroSnapshot {
  const durationMs = minutesToMs(BREAK_MINUTES);
  return {
    phase: 'break',
    durationMs,
    remainingMs: durationMs,
    running: true,
    startedAt: nowMs,
    taskTitle,
  };
}

export function readPomodoro(storage: Pick<Storage, 'getItem'> | null | undefined): PomodoroSnapshot {
  const fallback = idlePomodoro();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(POMODORO_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PomodoroSnapshot>;
    if (parsed.phase !== 'idle' && parsed.phase !== 'focus' && parsed.phase !== 'break') return fallback;
    if (!Number.isFinite(parsed.durationMs) || !Number.isFinite(parsed.remainingMs)) return fallback;
    return {
      phase: parsed.phase,
      durationMs: Math.max(1, Number(parsed.durationMs)),
      remainingMs: Math.max(0, Number(parsed.remainingMs)),
      running: Boolean(parsed.running),
      startedAt: typeof parsed.startedAt === 'number' && Number.isFinite(parsed.startedAt) ? parsed.startedAt : null,
      taskTitle: typeof parsed.taskTitle === 'string' ? parsed.taskTitle : '',
    };
  } catch {
    return fallback;
  }
}

export function writePomodoro(storage: Pick<Storage, 'setItem'> | null | undefined, snapshot: PomodoroSnapshot) {
  if (!storage) return;
  storage.setItem(POMODORO_STORAGE_KEY, JSON.stringify(snapshot));
}
