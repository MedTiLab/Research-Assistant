import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { WorkbenchTodayStatus } from '../../../domain/types';
import TodayStatusBar from './TodayStatusBar';
import { createWorkbenchI18n, renderWorkbench } from '../../../renderWithI18n';

const now = new Date(2026, 8, 2, 11, 0);

const status: WorkbenchTodayStatus = {
  date: '2026-09-02',
  working: false,
  workMinutes: 40,
  attendanceCount: 1,
  focusMinutes: 25,
  currentTask: { title: '整理组会材料', status: 'open' },
  todayTodoCount: 3,
  habitCompleted: 1,
  habitTotal: 2,
  habitCompletion: 50,
  reviewCompleted: false,
  review: null,
  activeSubmissionCount: 1,
};

describe('TodayStatusBar', () => {
  let i18n: Awaited<ReturnType<typeof createWorkbenchI18n>>;
  beforeAll(async () => {
    i18n = await createWorkbenchI18n('zh-CN');
  });

  it('keeps the countdown ring, presets and work toggle on the home panel', () => {
    const markup = renderWorkbench(
      <TodayStatusBar now={now} status={status} logs={[]} focusSessions={[]} dailyFocus="写论文引言" onRefresh={vi.fn()} />,
      i18n,
    );

    expect(markup).toContain('番茄时钟');
    expect(markup).toContain('25:00');
    expect(markup).toContain('15 分钟');
    expect(markup).toContain('25 分钟');
    expect(markup).toContain('50 分钟');
    expect(markup).toContain('开始专注');
    expect(markup).toContain('开始工作');
    expect(markup).toContain('写论文引言');
  });

  it('shows only work and focus totals, leaving habits and review to the signal list', () => {
    const markup = renderWorkbench(
      <TodayStatusBar now={now} status={status} logs={[]} focusSessions={[]} dailyFocus="" onRefresh={vi.fn()} />,
      i18n,
    );

    expect(markup).toContain('工作时长');
    expect(markup).toContain('40 分钟');
    expect(markup).toContain('专注时长');
    expect(markup).not.toContain('习惯完成度');
    expect(markup).not.toContain('复盘状态');
    expect(markup).not.toContain('投稿进行中');
  });

  it('folds the check-in and focus records behind the readouts instead of a separate panel', () => {
    const markup = renderWorkbench(
      <TodayStatusBar
        now={now}
        status={{ ...status, working: true }}
        logs={[{
          id: 'attendance_1',
          date: '2026-09-02',
          startedAt: new Date(2026, 8, 2, 9, 12).toISOString(),
          endedAt: new Date(2026, 8, 2, 10, 40).toISOString(),
          minutes: 88,
          open: false,
        }]}
        focusSessions={[{
          id: 'focus_1',
          date: '2026-09-02',
          minutes: 25,
          taskTitle: '写引言',
          createdAt: new Date(2026, 8, 2, 9, 40).toISOString(),
        }]}
        dailyFocus=""
        onRefresh={vi.fn()}
      />,
      i18n,
    );

    expect(markup).toContain('今天 1 段打卡');
    expect(markup).toContain('今天 1 段专注');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('09:12');
    expect(markup).not.toContain('写引言');
    expect(markup).toContain('结束工作');
  });
});
