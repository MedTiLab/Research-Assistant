import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import TodayCalendar from './TodayCalendar';
import { getMonthGrid, getWeekDates, toLocalDateKey } from './calendarGrid';

const now = new Date(2026, 8, 1, 10, 30);

describe('calendarGrid', () => {
  it('builds a Monday-to-Sunday week without UTC date drift', () => {
    expect(getWeekDates(now).map(toLocalDateKey)).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ]);
  });

  it('builds a six-week month grid that includes adjacent-month dates', () => {
    const dates = getMonthGrid(now).map(toLocalDateKey);

    expect(dates).toHaveLength(42);
    expect(dates[0]).toBe('2026-08-31');
    expect(dates[41]).toBe('2026-10-11');
  });
});

describe('TodayCalendar', () => {
  it('opens on the week view with day, week, month and year available', () => {
    const markup = renderToStaticMarkup(
      <TodayCalendar now={now} selectedDate="2026-09-01" counts={new Map()} onSelectDate={vi.fn()} />,
    );

    expect(markup).toContain('2026年8月31日 — 9月6日');
    expect(markup).toContain('aria-label="上一周期"');
    expect(markup).toContain('aria-label="下一周期"');
    expect(markup).toMatch(/aria-pressed="true"[^>]*>周<\/button>/);
    expect(markup).toMatch(/>日<\/button>.*>周<\/button>.*>月<\/button>.*>年<\/button>/);
  });

  it('marks each day with how many items are still unfinished', () => {
    const markup = renderToStaticMarkup(
      <TodayCalendar
        now={now}
        selectedDate="2026-09-01"
        counts={new Map([['2026-09-01', 3]])}
        onSelectDate={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="9月1日，3项待办"');
    expect(markup).toContain('aria-label="9月2日，0项待办"');
    expect(markup).toMatch(/aria-label="9月1日，3项待办"[\s\S]*?>3</);
  });
});
