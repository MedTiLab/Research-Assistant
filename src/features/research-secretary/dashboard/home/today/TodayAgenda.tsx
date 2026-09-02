import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ExternalLink, ListChecks, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../../../../components/ui/button';
import { Input } from '../../../../../components/ui/input';
import { cn } from '../../../../../lib/utils';
import type { ResearchTask } from '../../../domain/types';
import { workbenchLocale } from '../../../i18n';
import type { AgendaItem } from './agenda';

const PRIORITY_DOT: Record<ResearchTask['priority'], string> = {
  urgent: 'bg-destructive',
  high: 'bg-clinical-warning',
  medium: 'bg-primary',
  low: 'bg-muted-foreground/45',
};

function formatDueTime(dueAt: string, locale: string) {
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(due);
}

type Props = {
  items: AgendaItem[];
  dateLabel: string;
  isToday: boolean;
  /** Unfinished items on today, so another day's empty list can offer the way back. */
  todayPending: number;
  pendingKeys: Set<string>;
  onAdd: (title: string) => void;
  onToggle: (item: AgendaItem) => void;
  onDeleteTodo: (id: string) => void;
  onOpenTask: () => void;
  onGoToday: () => void;
};

export default function TodayAgenda({
  items,
  dateLabel,
  isToday,
  todayPending,
  pendingKeys,
  onAdd,
  onToggle,
  onDeleteTodo,
  onOpenTask,
  onGoToday,
}: Props) {
  const { t, i18n } = useTranslation('workbench');
  const locale = workbenchLocale(i18n.language);
  const [draft, setDraft] = useState('');
  const openCount = items.filter((item) => !item.completed).length;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = draft.trim();
    if (!title) return;
    onAdd(title);
    setDraft('');
  };

  return (
    <div className="flex flex-shrink-0 flex-col">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-foreground">{dateLabel}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {items.length > 0 ? t('agenda.summary', { open: openCount, total: items.length }) : t('agenda.emptyHint')}
          </div>
        </div>
        {isToday ? (
          <span className="flex-shrink-0 rounded-full bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">{t('common.today')}</span>
        ) : todayPending > 0 && (
          <button
            type="button"
            onClick={onGoToday}
            className="flex-shrink-0 whitespace-nowrap rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold text-primary transition-colors hover:bg-primary/20"
          >
            {t('agenda.backToToday', { count: todayPending })}
          </button>
        )}
      </div>

      <form className="flex gap-2" onSubmit={submit}>
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={120}
          aria-label={t('agenda.addAria', { date: dateLabel })}
          placeholder={t('agenda.placeholder')}
          className="h-9 bg-card"
        />
        <Button type="submit" size="sm" className="h-9 flex-shrink-0" disabled={!draft.trim()}>
          <Plus />
          <span className="hidden sm:inline">{t('common.add')}</span>
        </Button>
      </form>

      {items.length === 0 ? (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-border/80 px-3 py-2.5 text-[11px] text-muted-foreground">
          <ListChecks className="h-3.5 w-3.5 flex-shrink-0" />
          {t('agenda.footnote')}
        </div>
      ) : (
        <ul className="mt-3 space-y-1.5" aria-live="polite">
          {items.map((item) => {
            const busy = pendingKeys.has(item.key);
            const dueTime = item.source === 'task' && item.task.dueAt ? formatDueTime(item.task.dueAt, locale) : '';
            return (
              <li
                key={item.key}
                className="group flex items-center gap-2 rounded-lg border border-border/60 bg-card px-2.5 py-2"
              >
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onToggle(item)}
                  className={cn(
                    'grid h-5 w-5 flex-shrink-0 place-items-center rounded-full border transition-colors disabled:opacity-40',
                    item.completed
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-muted-foreground/40 text-transparent hover:border-primary',
                  )}
                  aria-label={item.completed ? t('agenda.restore', { title: item.title }) : t('agenda.complete', { title: item.title })}
                >
                  <Check className="h-3 w-3" />
                </button>

                {item.source === 'task' && (
                  <span
                    className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', PRIORITY_DOT[item.task.priority])}
                    aria-hidden
                  />
                )}

                <span className={cn(
                  'min-w-0 flex-1 truncate text-sm',
                  item.completed ? 'text-muted-foreground line-through' : 'text-foreground',
                )}>
                  {item.title}
                </span>

                {dueTime && (
                  <span className="hidden flex-shrink-0 text-[10px] tabular-nums text-muted-foreground sm:inline">{dueTime}</span>
                )}

                {item.source === 'task' ? (
                  <>
                    <span className="flex-shrink-0 rounded-md bg-muted/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {item.task.origin === 'meeting_action' ? t('agenda.chipMeeting') : t('agenda.chipResearch')}
                    </span>
                    <button
                      type="button"
                      onClick={onOpenTask}
                      className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted-foreground opacity-70 transition-colors hover:bg-muted hover:text-foreground sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                      aria-label={t('agenda.openTask', { title: item.title })}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => onDeleteTodo(item.todo.id)}
                    className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted-foreground opacity-70 transition-colors hover:bg-destructive/10 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                    aria-label={t('agenda.deleteTodo', { title: item.title })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
