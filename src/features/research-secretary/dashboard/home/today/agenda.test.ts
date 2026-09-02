import { describe, expect, it } from 'vitest';
import type { ResearchTask } from '../../../domain/types';
import { agendaForDate, buildAgenda, pendingCountByDate, type CalendarTodo } from './agenda';

function todo(overrides: Partial<CalendarTodo> = {}): CalendarTodo {
  return {
    id: 'todo_1',
    title: '整理分析结果',
    date: '2026-09-02',
    completed: false,
    createdAt: new Date(2026, 8, 2, 9, 0).toISOString(),
    ...overrides,
  };
}

function task(overrides: Partial<ResearchTask> = {}): ResearchTask {
  return {
    id: 'demo:1',
    title: '准备组会结果页',
    status: 'todo',
    priority: 'high',
    dueAt: new Date(2026, 8, 2, 16, 0).toISOString(),
    origin: 'taskmaster',
    ...overrides,
  };
}

describe('buildAgenda', () => {
  it('merges personal todos and dated research tasks into one list', () => {
    const items = buildAgenda([todo()], [task()]);

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.source)).toContain('todo');
    expect(items.map((item) => item.source)).toContain('task');
    expect(items.every((item) => item.date === '2026-09-02')).toBe(true);
  });

  it('drops tasks without a due date, since they have no day to sit on', () => {
    expect(buildAgenda([], [task({ dueAt: undefined })])).toHaveLength(0);
  });

  it('drops tasks that are already done, so the calendar only tracks live work', () => {
    expect(buildAgenda([], [task({ status: 'done' })])).toHaveLength(0);
  });

  it('gives todos and tasks distinct keys even when their ids collide', () => {
    const items = buildAgenda([todo({ id: 'x' })], [task({ id: 'x' })]);

    expect(new Set(items.map((item) => item.key)).size).toBe(2);
  });
});

describe('agendaForDate', () => {
  it('puts unfinished items first and finished ones last', () => {
    const items = agendaForDate(
      buildAgenda(
        [todo({ id: 'a', title: '已完成的事', completed: true }), todo({ id: 'b', title: '未完成的事' })],
        [],
      ),
      '2026-09-02',
    );

    expect(items.map((item) => item.title)).toEqual(['未完成的事', '已完成的事']);
  });

  it('orders research tasks by due time ahead of undated personal todos', () => {
    const items = agendaForDate(
      buildAgenda(
        [todo({ id: 'a', title: '个人待办' })],
        [
          task({ id: 'demo:2', title: '晚一点的任务', dueAt: new Date(2026, 8, 2, 18).toISOString() }),
          task({ id: 'demo:1', title: '早一点的任务', dueAt: new Date(2026, 8, 2, 10).toISOString() }),
        ],
      ),
      '2026-09-02',
    );

    expect(items.map((item) => item.title)).toEqual(['早一点的任务', '晚一点的任务', '个人待办']);
  });

  it('keeps other days out of the selected day', () => {
    const items = agendaForDate(buildAgenda([todo({ date: '2026-09-03' })], []), '2026-09-02');

    expect(items).toHaveLength(0);
  });
});

describe('pendingCountByDate', () => {
  it('counts only unfinished items per day', () => {
    const counts = pendingCountByDate(buildAgenda(
      [
        todo({ id: 'a' }),
        todo({ id: 'b', completed: true }),
        todo({ id: 'c', date: '2026-09-03' }),
      ],
      [task()],
    ));

    expect(counts.get('2026-09-02')).toBe(2);
    expect(counts.get('2026-09-03')).toBe(1);
  });
});
