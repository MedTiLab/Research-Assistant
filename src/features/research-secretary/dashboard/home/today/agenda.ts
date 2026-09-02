import type { ResearchTask } from '../../../domain/types';
import { toLocalDateKey } from './calendarGrid';

export type CalendarTodo = {
  id: string;
  title: string;
  date: string;
  completed: boolean;
  createdAt: string;
};

/**
 * One row of the day list. Personal todos and dated research tasks look the same to the reader,
 * but they are toggled through different APIs, so the origin travels with the item.
 */
export type AgendaItem = {
  key: string;
  title: string;
  date: string;
  completed: boolean;
} & (
  | { source: 'todo'; todo: CalendarTodo }
  | { source: 'task'; task: ResearchTask }
);

/** Tasks carry a due time and lead the day; todos belong to the day as a whole and follow. */
function groupRank(item: AgendaItem) {
  return item.source === 'task' ? 0 : 1;
}

function sortValue(item: AgendaItem) {
  const raw = item.source === 'task' ? item.task.dueAt : item.todo.createdAt;
  const value = raw ? new Date(raw).getTime() : Number.NaN;
  return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
}

export function buildAgenda(todos: CalendarTodo[], tasks: ResearchTask[]): AgendaItem[] {
  const items: AgendaItem[] = todos.map((todo) => ({
    key: `todo:${todo.id}`,
    title: todo.title,
    date: todo.date,
    completed: todo.completed,
    source: 'todo',
    todo,
  }));

  tasks.forEach((task) => {
    if (task.status === 'done' || !task.dueAt) return;
    const due = new Date(task.dueAt);
    if (Number.isNaN(due.getTime())) return;
    items.push({
      key: `task:${task.id}`,
      title: task.title,
      date: toLocalDateKey(due),
      completed: false,
      source: 'task',
      task,
    });
  });

  return items;
}

export function agendaForDate(items: AgendaItem[], date: string) {
  return items
    .filter((item) => item.date === date)
    .sort((left, right) => (
      Number(left.completed) - Number(right.completed)
      || groupRank(left) - groupRank(right)
      || sortValue(left) - sortValue(right)
      || left.key.localeCompare(right.key)
    ));
}

export function pendingCountByDate(items: AgendaItem[]) {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    if (item.completed) return;
    counts.set(item.date, (counts.get(item.date) || 0) + 1);
  });
  return counts;
}
