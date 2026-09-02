import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../../../../../components/ui/button';
import { cn } from '../../../../../lib/utils';
import { workbenchLocale } from '../../../i18n';
import {
  clampDateToMonth,
  formatWeekRange,
  fromLocalDateKey,
  getMonthGrid,
  getWeekDates,
  startOfDay,
  toLocalDateKey,
} from './calendarGrid';

const VIEW_OPTIONS = ['day', 'week', 'month', 'year'] as const;

type CalendarView = (typeof VIEW_OPTIONS)[number];

type Props = {
  now: Date;
  selectedDate: string;
  /** Unfinished agenda items per `yyyy-mm-dd`, used for the density dots. */
  counts: Map<string, number>;
  onSelectDate: (date: string) => void;
};

export default function TodayCalendar({ now, selectedDate, counts, onSelectDate }: Props) {
  const { t, i18n } = useTranslation('workbench');
  const locale = workbenchLocale(i18n.language);
  const dayNames = t('calendar.weekdaysShort', { returnObjects: true }) as string[];
  const monthWeekdays = t('calendar.weekdaysMondayNarrow', { returnObjects: true }) as string[];
  const [view, setView] = useState<CalendarView>('week');
  const [viewAnchor, setViewAnchor] = useState(() => startOfDay(now));
  const todayKey = toLocalDateKey(now);
  const selectedDateValue = fromLocalDateKey(selectedDate);
  const weekDays = useMemo(() => getWeekDates(viewAnchor), [viewAnchor]);
  const monthDays = useMemo(() => getMonthGrid(viewAnchor), [viewAnchor]);

  const selectedDateLabel = new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(selectedDateValue);

  const periodLabel = view === 'day'
    ? selectedDateLabel
    : view === 'week'
      ? formatWeekRange(weekDays, locale)
      : view === 'month'
        ? new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(viewAnchor)
        : new Intl.DateTimeFormat(locale, { year: 'numeric' }).format(viewAnchor);

  const selectDate = (date: Date) => {
    onSelectDate(toLocalDateKey(date));
    setViewAnchor(startOfDay(date));
  };

  const movePeriod = (direction: -1 | 1) => {
    if (view === 'day' || view === 'week') {
      const next = new Date(selectedDateValue);
      next.setDate(next.getDate() + (direction * (view === 'week' ? 7 : 1)));
      selectDate(next);
      return;
    }
    const year = viewAnchor.getFullYear() + (view === 'year' ? direction : 0);
    const month = view === 'month' ? viewAnchor.getMonth() + direction : selectedDateValue.getMonth();
    selectDate(clampDateToMonth(year, month, selectedDateValue.getDate()));
  };

  const openMonth = (month: number) => {
    const year = viewAnchor.getFullYear();
    const preferredDay = selectedDateValue.getFullYear() === year && selectedDateValue.getMonth() === month
      ? selectedDateValue.getDate()
      : 1;
    selectDate(clampDateToMonth(year, month, preferredDay));
    setView('month');
  };

  const renderWeek = () => (
    <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
      {weekDays.map((date) => {
        const key = toLocalDateKey(date);
        const count = counts.get(key) || 0;
        const isToday = key === todayKey;
        const isSelected = key === selectedDate;
        return (
          <button
            key={key}
            type="button"
            onClick={() => selectDate(date)}
            aria-label={t('calendar.dayAria', {
              date: new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(date),
              count,
            })}
            aria-pressed={isSelected}
            className={cn(
              'flex min-w-0 flex-col items-center rounded-xl border px-1 py-2 text-center transition-all',
              isSelected
                ? 'border-primary/45 bg-primary/[0.09] shadow-sm'
                : 'border-transparent hover:border-border hover:bg-muted/55',
            )}
          >
            <span className={cn('text-[10px] sm:text-[11px]', isSelected ? 'font-medium text-primary' : 'text-muted-foreground')}>
              {dayNames[date.getDay()]}
            </span>
            <span className={cn(
              'mt-0.5 grid h-6 w-6 place-items-center rounded-full text-sm font-semibold tabular-nums',
              isToday ? 'bg-primary text-primary-foreground shadow-sm' : 'text-foreground',
            )}>
              {date.getDate()}
            </span>
            {/* The cell is only a few characters wide, so the load is a dot plus a number. */}
            <span className={cn(
              'mt-1 flex min-h-3.5 items-center gap-1 text-[10px] font-medium tabular-nums',
              count > 0 ? 'text-primary' : 'text-muted-foreground/45',
            )}>
              {count > 0 ? (
                <>
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  {count}
                </>
              ) : '—'}
            </span>
          </button>
        );
      })}
    </div>
  );

  const renderMonth = () => (
    <div>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center">
        {monthWeekdays.map((weekday) => (
          <span key={weekday} className="py-1 text-[10px] font-medium text-muted-foreground">{weekday}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {monthDays.map((date) => {
          const key = toLocalDateKey(date);
          const count = counts.get(key) || 0;
          const inMonth = date.getMonth() === viewAnchor.getMonth();
          const isToday = key === todayKey;
          const isSelected = key === selectedDate;
          return (
            <button
              key={key}
              type="button"
              onClick={() => selectDate(date)}
              aria-label={t('calendar.dayAria', {
                date: new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(date),
                count,
              })}
              aria-pressed={isSelected}
              className={cn(
                'min-h-[52px] rounded-lg border p-1.5 text-left transition-colors sm:min-h-[62px]',
                isSelected
                  ? 'border-primary/45 bg-primary/[0.08]'
                  : 'border-border/45 hover:border-primary/25 hover:bg-muted/50',
                !inMonth && 'bg-muted/20 text-muted-foreground/45',
              )}
            >
              <span className={cn(
                'grid h-5 w-5 place-items-center rounded-full text-[11px] font-semibold tabular-nums',
                isToday ? 'bg-primary text-primary-foreground' : isSelected ? 'text-primary' : '',
              )}>
                {date.getDate()}
              </span>
              {count > 0 && (
                <span className="mt-1 flex items-center gap-1 text-[10px] font-medium tabular-nums text-primary">
                  <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" />
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderYear = () => {
    const year = viewAnchor.getFullYear();
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Array.from({ length: 12 }, (_, month) => {
          const days = getMonthGrid(new Date(year, month, 1));
          const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
          const count = Array.from(counts.entries())
            .filter(([key]) => key.startsWith(monthPrefix))
            .reduce((sum, [, value]) => sum + value, 0);
          const isCurrentMonth = now.getFullYear() === year && now.getMonth() === month;
          return (
            <button
              key={month}
              type="button"
              onClick={() => openMonth(month)}
              aria-label={t('calendar.monthAria', {
                label: new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(new Date(year, month, 1)),
                count,
              })}
              className={cn(
                'rounded-xl border p-2.5 text-left transition-all hover:border-primary/30 hover:bg-muted/40',
                isCurrentMonth ? 'border-primary/35 bg-primary/[0.05]' : 'border-border/60 bg-card',
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className={cn('text-xs font-semibold', isCurrentMonth ? 'text-primary' : 'text-foreground')}>
                  {new Intl.DateTimeFormat(locale, { month: 'short' }).format(new Date(year, month, 1))}
                </span>
                <span className="whitespace-nowrap text-[9px] text-muted-foreground">{count > 0 ? t('calendar.itemsCount', { count }) : t('calendar.idle')}</span>
              </span>
              <span className="mt-2 grid grid-cols-7 gap-[3px]" aria-hidden="true">
                {days.map((date) => {
                  const dayCount = counts.get(toLocalDateKey(date)) || 0;
                  const inMonth = date.getMonth() === month;
                  return (
                    <span
                      key={toLocalDateKey(date)}
                      className={cn(
                        'h-1.5 rounded-sm',
                        !inMonth
                          ? 'bg-transparent'
                          : dayCount > 0
                            ? dayCount > 2 ? 'bg-primary' : 'bg-primary/45'
                            : 'bg-border/70',
                      )}
                    />
                  );
                })}
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="flex rounded-lg bg-muted/70 p-0.5" aria-label={t('calendar.viewLabel')}>
          {VIEW_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              aria-pressed={view === option}
              className={cn(
                'min-w-8 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                view === option ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`calendar.${option}`)}
            </button>
          ))}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => selectDate(startOfDay(now))}>{t('common.today')}</Button>
        <div className="flex items-center rounded-lg border border-border bg-background/70 p-0.5">
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => movePeriod(-1)} aria-label={t('calendar.prevPeriod')}>
            <ChevronLeft />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => movePeriod(1)} aria-label={t('calendar.nextPeriod')}>
            <ChevronRight />
          </Button>
        </div>
        <span className="ml-auto text-[11px] font-medium text-muted-foreground">{periodLabel}</span>
      </div>

      {view === 'day' && (
        <div className="flex items-center gap-4 rounded-xl border border-primary/20 bg-primary/[0.05] px-4 py-5">
          <span className="grid h-14 w-14 flex-shrink-0 place-items-center rounded-2xl bg-primary text-2xl font-bold tabular-nums text-primary-foreground shadow-sm">
            {selectedDateValue.getDate()}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">{selectedDateLabel}</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {(counts.get(selectedDate) || 0) > 0
                ? t('calendar.dayOpen', { count: counts.get(selectedDate) })
                : t('calendar.dayClear')}
            </span>
          </span>
        </div>
      )}
      {view === 'week' && renderWeek()}
      {view === 'month' && renderMonth()}
      {view === 'year' && renderYear()}
    </div>
  );
}
