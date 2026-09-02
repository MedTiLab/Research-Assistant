import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import TodayAgenda from './TodayAgenda';
import { agendaForDate, buildAgenda } from './agenda';

const items = agendaForDate(
  buildAgenda(
    [{
      id: 'todo_1',
      title: '整理本周分析结果',
      date: '2026-09-01',
      completed: false,
      createdAt: new Date(2026, 8, 1, 9).toISOString(),
    }],
    [
      {
        id: 'demo:1',
        title: '准备组会结果页',
        status: 'todo',
        priority: 'high',
        dueAt: new Date(2026, 8, 1, 16).toISOString(),
        origin: 'taskmaster',
      },
      {
        id: 'action_9',
        title: '回复导师邮件',
        status: 'todo',
        priority: 'urgent',
        dueAt: new Date(2026, 8, 1, 11).toISOString(),
        origin: 'meeting_action',
      },
    ],
  ),
  '2026-09-01',
);

function render(overrides: Partial<Parameters<typeof TodayAgenda>[0]> = {}) {
  return renderToStaticMarkup(
    <TodayAgenda
      items={items}
      dateLabel="9月1日星期二"
      isToday
      todayPending={0}
      pendingKeys={new Set()}
      onAdd={vi.fn()}
      onToggle={vi.fn()}
      onDeleteTodo={vi.fn()}
      onOpenTask={vi.fn()}
      onGoToday={vi.fn()}
      {...overrides}
    />,
  );
}

describe('TodayAgenda', () => {
  it('lists personal todos and research tasks in one checkable list', () => {
    const markup = render();

    expect(markup).toContain('整理本周分析结果');
    expect(markup).toContain('准备组会结果页');
    expect(markup).toContain('回复导师邮件');
    expect(markup).toContain('aria-label="完成：准备组会结果页"');
    expect(markup).toContain('aria-label="完成：整理本周分析结果"');
    expect(markup).toContain('输入待办事项，按回车添加');
    expect(markup).toContain('3 项待完成 · 共 3 项');
  });

  it('labels where each research task comes from and only offers delete on personal todos', () => {
    const markup = render();

    expect(markup).toContain('>科研<');
    expect(markup).toContain('>组会<');
    expect(markup).toContain('aria-label="删除待办：整理本周分析结果"');
    expect(markup).not.toContain('aria-label="删除待办：准备组会结果页"');
    expect(markup).toContain('aria-label="打开任务：准备组会结果页"');
  });

  it('disables a row while its toggle is still in flight', () => {
    const markup = render({ pendingKeys: new Set(['todo:todo_1']) });

    expect(markup).toMatch(/disabled[^>]*aria-label="完成：整理本周分析结果"/);
  });

  it('keeps an empty day to a single hint line instead of a large empty box', () => {
    const markup = render({ items: [] });

    expect(markup).toContain('个人待办和到期的科研任务都会出现在这里');
    expect(markup).toContain('还没有安排，添加一个明确的下一步');
  });

  it('offers the way back when another day is selected and today still has work', () => {
    const markup = render({ items: [], isToday: false, todayPending: 7 });

    expect(markup).toContain('回到今天 · 7 项');
  });

  it('does not offer the way back when today is already clear', () => {
    const markup = render({ items: [], isToday: false, todayPending: 0 });

    expect(markup).not.toContain('回到今天');
  });
});
