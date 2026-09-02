import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarRange } from 'lucide-react';
import { workbenchLocale } from '../../i18n';
import type { ResearchTask, WorkbenchAttendanceLog, WorkbenchFocusSession, WorkbenchTodayStatus } from '../../domain/types';
import { Panel, PanelHead } from './HomeUi';
import TodayStatusBar from './today/TodayStatusBar';
import TodayCalendar from './today/TodayCalendar';
import TodayAgenda from './today/TodayAgenda';
import { agendaForDate, buildAgenda, pendingCountByDate, type AgendaItem, type CalendarTodo } from './today/agenda';
import { fromLocalDateKey, toLocalDateKey } from './today/calendarGrid';

type Props = {
  now: Date;
  status: WorkbenchTodayStatus | null;
  logs: WorkbenchAttendanceLog[];
  focusSessions: WorkbenchFocusSession[];
  tasks: ResearchTask[];
  todos: CalendarTodo[];
  dailyFocus: string;
  onRefresh: () => void;
  onAddTodo: (date: string, title: string) => void;
  onToggleTodo: (id: string) => Promise<void>;
  onDeleteTodo: (id: string) => void;
  onToggleTask: (task: ResearchTask, done: boolean) => Promise<void>;
  onOpenTasks: () => void;
};

export default function HomeToday({
  now,
  status,
  logs,
  focusSessions,
  tasks,
  todos,
  dailyFocus,
  onRefresh,
  onAddTodo,
  onToggleTodo,
  onDeleteTodo,
  onToggleTask,
  onOpenTasks,
}: Props) {
  const { t, i18n } = useTranslation('workbench');
  const [selectedDate, setSelectedDate] = useState(() => toLocalDateKey(now));
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(() => new Set());

  const agenda = useMemo(() => buildAgenda(todos, tasks), [tasks, todos]);
  const counts = useMemo(() => pendingCountByDate(agenda), [agenda]);
  const dayItems = useMemo(() => agendaForDate(agenda, selectedDate), [agenda, selectedDate]);

  const todayKey = toLocalDateKey(now);
  const dateLabel = new Intl.DateTimeFormat(workbenchLocale(i18n.language), { month: 'long', day: 'numeric', weekday: 'long' })
    .format(fromLocalDateKey(selectedDate));

  /** Both sources write over the network, so a row stays disabled until its own write settles. */
  const toggle = useCallback((item: AgendaItem) => {
    setPendingKeys((current) => new Set(current).add(item.key));
    const done = item.source === 'todo'
      ? onToggleTodo(item.todo.id)
      : onToggleTask(item.task, !item.completed);
    void done.finally(() => setPendingKeys((current) => {
      const next = new Set(current);
      next.delete(item.key);
      return next;
    }));
  }, [onToggleTask, onToggleTodo]);

  const openToday = counts.get(todayKey) || 0;

  return (
    <Panel className="flex min-h-0 flex-col xl:h-full xl:overflow-hidden">
      <PanelHead
        icon={<CalendarRange className="h-3.5 w-3.5" />}
        title={t('home.todayTitle')}
        hint={openToday > 0 ? t('home.todayHintOpen', { count: openToday }) : t('home.todayHintDone')}
      />

      <TodayStatusBar
        now={now}
        status={status}
        logs={logs}
        focusSessions={focusSessions}
        dailyFocus={dailyFocus}
        onRefresh={onRefresh}
      />

      {/* Stacked, not side by side: with the sidebar and the conversation list open this panel is
          only ~500px wide, and a seven-column week strip in half of that collapses into unreadable
          vertical text. Full width works at every panel size. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-4 sm:px-5 xl:overflow-y-auto xl:overscroll-contain xl:[scrollbar-gutter:stable]">
        <div className="flex-shrink-0">
          <TodayCalendar now={now} selectedDate={selectedDate} counts={counts} onSelectDate={setSelectedDate} />
        </div>
        <TodayAgenda
          items={dayItems}
          dateLabel={dateLabel}
          isToday={selectedDate === todayKey}
          todayPending={openToday}
          pendingKeys={pendingKeys}
          onAdd={(title) => onAddTodo(selectedDate, title)}
          onToggle={toggle}
          onDeleteTodo={onDeleteTodo}
          onOpenTask={onOpenTasks}
          onGoToday={() => setSelectedDate(todayKey)}
        />
      </div>
    </Panel>
  );
}
