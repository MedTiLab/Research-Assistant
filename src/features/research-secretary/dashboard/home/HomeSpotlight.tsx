import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, CalendarPlus, ChevronRight, MapPin, ShieldCheck } from 'lucide-react';
import type { ResearchMeeting, MeetingType } from '../../domain/types';
import { cn } from '../../../../lib/utils';
import { workbenchLocale } from '../../i18n';
import { EmptyHint, GhostButton, HOME_TONE_SOFT, PrimaryButton, type HomeTone } from './HomeUi';

function formatCountdown(target: Date, now: Date, t: (key: string, options?: Record<string, unknown>) => string) {
  const diff = target.getTime() - now.getTime();
  if (diff <= 0) return t('meetingCard.startingSoon');
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return t('meetingCard.countdownDays', { days, hours });
  if (hours > 0) return t('meetingCard.countdownHours', { hours, minutes });
  return t('meetingCard.countdownMinutes', { minutes });
}

export function NextMeetingCard({
  meeting,
  now,
  onPrepare,
  onOpenMeetings,
}: {
  meeting: ResearchMeeting | null;
  now: Date;
  onPrepare: () => void;
  onOpenMeetings: () => void;
}) {
  const { t, i18n } = useTranslation('workbench');
  const locale = workbenchLocale(i18n.language);

  if (!meeting) {
    return (
      <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
        <EmptyHint
          icon={<CalendarPlus className="h-4 w-4" />}
          title={t('meetingCard.emptyTitle')}
          description={t('meetingCard.emptyDescription')}
          action={<GhostButton onClick={onOpenMeetings}>{t('meetingCard.goMeetings')}</GhostButton>}
          className="border-none py-4"
        />
      </section>
    );
  }

  const meetingDate = new Date(meeting.meetingDate);
  const agendaCount = meeting.agenda?.length ?? 0;
  const openActions = (meeting.actions ?? []).filter((action) => action.status === 'open' || action.status === 'in_progress').length;
  const typeLabel = t(`meetingCard.types.${meeting.meetingType as MeetingType}`);

  return (
    <section className="relative overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.13] via-card to-card p-5 shadow-sm">
      <div aria-hidden className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-primary/15 blur-2xl" />
      <div className="relative">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.1em] text-primary">
          <CalendarClock className="h-3.5 w-3.5" />{t('meetingCard.next', { type: typeLabel })}
        </div>
        <h3 className="mt-2.5 line-clamp-2 text-base font-semibold leading-6 text-foreground">{meeting.title}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span>{new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(meetingDate)}</span>
          <span>·</span>
          <span>{meeting.myRole === 'presenter' ? t('meetingCard.presenter') : t('meetingCard.attendee')}</span>
          {meeting.location && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{meeting.location}</span>
            </>
          )}
        </div>

        <div className="mt-4 flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold tabular-nums text-primary">{formatCountdown(meetingDate, now, t)}</span>
          <span className="text-xs text-muted-foreground">{t('meetingCard.startsIn')}</span>
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          {openActions > 0
            ? t('meetingCard.agendaOpen', { count: agendaCount, open: openActions })
            : t('meetingCard.agendaClosed', { count: agendaCount })}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <PrimaryButton onClick={onPrepare}>{t('meetingCard.prepare')}</PrimaryButton>
          <GhostButton onClick={onOpenMeetings}>{t('meetingCard.viewAgenda')}</GhostButton>
        </div>
      </div>
    </section>
  );
}

export type HomeSignal = {
  id: string;
  icon: ReactNode;
  tone: HomeTone;
  title: string;
  meta: string;
  onClick: () => void;
};

export function SignalList({ signals }: { signals: HomeSignal[] }) {
  const { t } = useTranslation('workbench');
  if (signals.length === 0) {
    return (
      <div className="px-4 pb-4">
        <EmptyHint
          icon={<ShieldCheck className="h-4 w-4" />}
          title={t('signals.emptyTitle')}
          description={t('signals.emptyDescription')}
          className="py-6"
        />
      </div>
    );
  }

  return (
    <div className="px-2 pb-3 sm:px-3">
      {signals.map((signal) => (
        <button
          key={signal.id}
          type="button"
          onClick={signal.onClick}
          className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
        >
          <span className={cn('grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg', HOME_TONE_SOFT[signal.tone])}>{signal.icon}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">{signal.title}</span>
            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{signal.meta}</span>
          </span>
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
        </button>
      ))}
    </div>
  );
}
