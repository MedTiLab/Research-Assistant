import { describe, expect, it } from 'vitest';
import {
  BREAK_MINUTES,
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
} from './pomodoro';

describe('pomodoro', () => {
  it('counts down only while running', () => {
    const started = startFocus('写引言', 25, 1_000);
    expect(remainingMsOf(started, 1_000)).toBe(25 * 60_000);
    expect(remainingMsOf(started, 1_000 + 12_000)).toBe(25 * 60_000 - 12_000);

    const paused = pausePomodoro(started, 1_000 + 12_000);
    expect(paused.running).toBe(false);
    expect(remainingMsOf(paused, 1_000 + 60_000)).toBe(25 * 60_000 - 12_000);

    const resumed = resumePomodoro(paused, 5_000);
    expect(remainingMsOf(resumed, 8_000)).toBe(25 * 60_000 - 15_000);
  });

  it('formats the remaining clock and ignores sub-minute leftovers for logging', () => {
    expect(formatClock(25 * 60_000)).toBe('25:00');
    expect(formatClock(61_000)).toBe('01:01');
    expect(formatClock(500)).toBe('00:01');
    expect(loggableMinutes(29_000)).toBe(0);
    expect(loggableMinutes(30_000)).toBe(1);
    expect(loggableMinutes(25 * 60_000)).toBe(25);
  });

  it('adds live work and in-progress focus minutes on top of the last server snapshot', () => {
    expect(liveWorkMinutes(40, false, 0, 120_000)).toBe(40);
    expect(liveWorkMinutes(40, true, 0, 120_000)).toBe(42);

    const focus = startFocus('组会材料', 25, 0);
    expect(displayFocusMinutes(10, focus, 3 * 60_000)).toBe(13);
    expect(displayFocusMinutes(10, idlePomodoro(), 3 * 60_000)).toBe(10);
  });

  it('starts a 5-minute break after a focus session and persists snapshots', () => {
    const now = 9_000;
    const next = startBreak('写引言', now);
    expect(next.phase).toBe('break');
    expect(next.durationMs).toBe(BREAK_MINUTES * 60_000);
    expect(elapsedMsOf(next, now)).toBe(0);

    const storage = new Map<string, string>();
    const snapshot = startFocus('数据清洗', 15, now);
    writePomodoro({ setItem: (key, value) => storage.set(key, value) }, snapshot);
    const restored = readPomodoro({ getItem: (key) => storage.get(key) ?? null });
    expect(restored).toEqual(snapshot);
  });

  it('restores a paused snapshot without treating null startedAt as epoch', () => {
    const paused = pausePomodoro(startFocus('数据清洗', 25, 1_000), 4_000);
    expect(paused.startedAt).toBeNull();
    expect(paused.running).toBe(false);

    const storage = new Map<string, string>();
    writePomodoro({ setItem: (key, value) => storage.set(key, value) }, paused);
    const restored = readPomodoro({ getItem: (key) => storage.get(key) ?? null });

    expect(restored.startedAt).toBeNull();
    expect(remainingMsOf(restored, 999_999)).toBe(paused.remainingMs);
  });
});
