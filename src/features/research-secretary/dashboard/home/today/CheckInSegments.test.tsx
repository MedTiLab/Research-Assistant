import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WorkbenchAttendanceLog } from '../../../domain/types';
import CheckInSegments, { formatDuration, segmentMinutes, totalSegmentMinutes } from './CheckInSegments';

const now = new Date(2026, 8, 2, 14, 30);

function log(overrides: Partial<WorkbenchAttendanceLog> = {}): WorkbenchAttendanceLog {
  return {
    id: 'attendance_1',
    date: '2026-09-02',
    startedAt: new Date(2026, 8, 2, 9, 12).toISOString(),
    endedAt: new Date(2026, 8, 2, 11, 40).toISOString(),
    minutes: 148,
    open: false,
    ...overrides,
  };
}

describe('CheckInSegments', () => {
  it('lists each finished segment with its time range and duration', () => {
    const markup = renderToStaticMarkup(<CheckInSegments logs={[log()]} now={now} />);

    expect(markup).toContain('09:12');
    expect(markup).toContain('11:40');
    expect(markup).toContain('2 小时 28 分钟');
  });

  it('counts an open segment against the live clock rather than the fetched minutes', () => {
    const markup = renderToStaticMarkup(
      <CheckInSegments
        logs={[log({ id: 'attendance_open', startedAt: new Date(2026, 8, 2, 13, 30).toISOString(), endedAt: undefined, minutes: 1, open: true })]}
        now={now}
      />,
    );

    expect(markup).toContain('进行中');
    expect(markup).toContain('工作中');
    expect(markup).toContain('已工作 1 小时');
  });

  it('shows an empty hint before the first check-in of the day', () => {
    const markup = renderToStaticMarkup(<CheckInSegments logs={[]} now={now} />);

    expect(markup).toContain('今天还没有打卡记录');
  });

  it('orders segments by start time regardless of the incoming order', () => {
    const early = log({ id: 'a', startedAt: new Date(2026, 8, 2, 9, 0).toISOString(), endedAt: new Date(2026, 8, 2, 10, 0).toISOString(), minutes: 60 });
    const late = log({ id: 'b', startedAt: new Date(2026, 8, 2, 13, 0).toISOString(), endedAt: new Date(2026, 8, 2, 14, 0).toISOString(), minutes: 60 });
    const markup = renderToStaticMarkup(<CheckInSegments logs={[late, early]} now={now} />);

    expect(markup.indexOf('09:00')).toBeLessThan(markup.indexOf('13:00'));
  });
});

describe('formatDuration', () => {
  it('renders hours and minutes in Chinese, collapsing empty parts', () => {
    expect(formatDuration(0)).toBe('不足 1 分钟');
    expect(formatDuration(28)).toBe('28 分钟');
    expect(formatDuration(60)).toBe('1 小时');
    expect(formatDuration(148)).toBe('2 小时 28 分钟');
  });
});

describe('segmentMinutes', () => {
  it('trusts the server minutes for a closed segment', () => {
    expect(segmentMinutes(log(), now.getTime())).toBe(148);
  });

  it('recomputes an open segment from its start time', () => {
    const open = log({ startedAt: new Date(2026, 8, 2, 14, 0).toISOString(), endedAt: undefined, minutes: 0, open: true });
    expect(segmentMinutes(open, now.getTime())).toBe(30);
  });
});

describe('totalSegmentMinutes', () => {
  it('adds closed and open segments together', () => {
    const open = log({ id: 'b', startedAt: new Date(2026, 8, 2, 14, 0).toISOString(), endedAt: undefined, minutes: 0, open: true });
    expect(totalSegmentMinutes([log(), open], now.getTime())).toBe(178);
  });
});
