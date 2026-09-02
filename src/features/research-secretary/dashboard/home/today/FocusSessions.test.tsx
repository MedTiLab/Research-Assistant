import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WorkbenchFocusSession } from '../../../domain/types';
import FocusSessions, { sortFocusSessions, totalFocusMinutes } from './FocusSessions';

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
  it('lists each session with task title, logged time, and duration', () => {
    const markup = renderToStaticMarkup(<FocusSessions sessions={[session()]} />);

    expect(markup).toContain('写引言');
    expect(markup).toContain('10:05');
    expect(markup).toContain('25 分钟');
  });

  it('falls back when a session has no task title', () => {
    const markup = renderToStaticMarkup(<FocusSessions sessions={[session({ taskTitle: undefined })]} />);
    expect(markup).toContain('未命名专注');
  });

  it('shows an empty hint before the first focus log of the day', () => {
    const markup = renderToStaticMarkup(<FocusSessions sessions={[]} />);
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
