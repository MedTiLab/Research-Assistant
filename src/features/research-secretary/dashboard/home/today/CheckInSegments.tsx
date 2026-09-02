import { Timer, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { WorkbenchAttendanceLog } from '../../../domain/types';
import { cn } from '../../../../../lib/utils';
import { formatDuration, workbenchLocale } from '../../../i18n';
import { EmptyHint } from '../HomeUi';

export { formatDuration };

function formatTime(value: string, locale: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}

/**
 * An open segment keeps counting after the fetch, so measure it against the live clock
 * instead of trusting the minutes the server computed when the list was loaded.
 */
export function segmentMinutes(log: WorkbenchAttendanceLog, nowMs: number) {
  if (!log.open) return log.minutes;
  const started = new Date(log.startedAt).getTime();
  if (Number.isNaN(started)) return log.minutes;
  return Math.max(0, Math.floor((nowMs - started) / 60000));
}

export function sortSegments(logs: WorkbenchAttendanceLog[]) {
  return [...logs].sort((left, right) => new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime());
}

export function totalSegmentMinutes(logs: WorkbenchAttendanceLog[], nowMs: number) {
  return logs.reduce((sum, log) => sum + segmentMinutes(log, nowMs), 0);
}

type Props = {
  logs: WorkbenchAttendanceLog[];
  now: Date;
  busy?: boolean;
  onDelete?: (id: string) => void;
};

export default function CheckInSegments({ logs, now, busy = false, onDelete }: Props) {
  const { t, i18n } = useTranslation('workbench');
  const locale = workbenchLocale(i18n.language);
  const nowMs = now.getTime();
  const ordered = sortSegments(logs);

  if (ordered.length === 0) {
    return (
      <EmptyHint
        icon={<Timer className="h-4 w-4" />}
        title={t('checkIn.emptyTitle')}
        description={t('checkIn.emptyDescription')}
        className="py-5"
      />
    );
  }

  return (
    <ul className="space-y-1.5">
      {ordered.map((log, index) => {
        const minutes = segmentMinutes(log, nowMs);
        return (
          <li
            key={log.id}
            className={cn(
              'flex items-center gap-3 rounded-xl border px-3 py-2',
              log.open ? 'border-primary/35 bg-primary/[0.06]' : 'border-border/60 bg-card',
            )}
          >
            <span
              className={cn(
                'grid h-6 w-6 flex-shrink-0 place-items-center rounded-md text-[11px] font-semibold tabular-nums',
                log.open ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}
            >
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium tabular-nums text-foreground">
                {formatTime(log.startedAt, locale)}
                <span className="mx-1 text-muted-foreground">–</span>
                {log.endedAt ? formatTime(log.endedAt, locale) : <span className="text-primary">{t('checkIn.inProgress')}</span>}
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {log.open ? t('checkIn.workedFor', { duration: formatDuration(minutes, t) }) : formatDuration(minutes, t)}
              </span>
            </span>
            {log.open && (
              <span className="flex flex-shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-70" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                </span>
                {t('checkIn.working')}
              </span>
            )}
            {onDelete && (
              <button
                type="button"
                disabled={busy}
                aria-label={t('checkIn.deleteAria', { index: index + 1 })}
                onClick={() => onDelete(log.id)}
                className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
