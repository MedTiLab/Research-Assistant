import { beforeAll, describe, expect, it } from 'vitest';
import type { WorkbenchFocusSession } from '../../../domain/types';
import FocusSessions, { sortFocusSessions, totalFocusMinutes } from './FocusSessions';
import { createWorkbenchI18n, renderWorkbench } from '../../../renderWithI18n';

function session(overrides: Partial<WorkbenchFocusSession> = {}): WorkbenchFocusSession {
  return {
    id: 'focus_1',
    date: '2026-09-02',
    minutes: 25,
    taskTitle: '写引言',
    createdAt: new Date(2026, 8, 2, 10, 5).toISOString(),
    ...overrides,
  };
}

describe('FocusSessions', () => {
  let i18n: Awaited<ReturnType<typeof createWorkbenchI18n>>;
  beforeAll(async () => {
    i18n = await createWorkbenchI18n('zh-CN');
  });

  it('lists each session with task title, logged time, and duration', () => {
    const markup = renderWorkbench(<FocusSessions sessions={[session()]} />, i18n);

    expect(markup).toContain('写引言');
    expect(markup).toContain('10:05');
    expect(markup).toContain('25 分钟');
  });

  it('falls back when a session has no task title', () => {
    const markup = renderWorkbench(<FocusSessions sessions={[session({ taskTitle: undefined })]} />, i18n);
    expect(markup).toContain('未命名专注');
  });

  it('shows an empty hint before the first focus log of the day', () => {
    const markup = renderWorkbench(<FocusSessions sessions={[]} />, i18n);
    expect(markup).toContain('今天还没有专注记录');
  });
});

describe('sortFocusSessions', () => {
  it('orders by createdAt ascending', () => {
    const early = session({ id: 'a', createdAt: new Date(2026, 8, 2, 9, 0).toISOString() });
    const late = session({ id: 'b', createdAt: new Date(2026, 8, 2, 11, 0).toISOString() });
    expect(sortFocusSessions([late, early]).map((item) => item.id)).toEqual(['a', 'b']);
  });
});

describe('totalFocusMinutes', () => {
  it('sums session minutes', () => {
    expect(totalFocusMinutes([session({ minutes: 25 }), session({ id: 'b', minutes: 50 })])).toBe(75);
  });
});
