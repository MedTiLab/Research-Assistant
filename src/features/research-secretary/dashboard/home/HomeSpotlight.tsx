import type { ReactNode } from 'react';
import { CalendarClock, CalendarPlus, ChevronRight, MapPin, ShieldCheck } from 'lucide-react';
import type { ResearchMeeting, MeetingType } from '../../domain/types';
import { cn } from '../../../../lib/utils';
import { EmptyHint, GhostButton, HOME_TONE_SOFT, PrimaryButton, type HomeTone } from './HomeUi';

const MEETING_TYPE_LABEL: Record<MeetingType, string> = {
  group: '组会',
  one_on_one: '单独汇报',
  journal_club: '文献汇报',
  progress: '进展汇报',
};

function formatCountdown(target: Date, now: Date) {
  const diff = target.getTime() - now.getTime();
  if (diff <= 0) return '即将开始';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分钟`;
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
  if (!meeting) {
    return (
      <section className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
        <EmptyHint
          icon={<CalendarPlus className="h-4 w-4" />}
          title="暂无即将到来的组会"
          description="安排一次汇报，助手会提前帮你准备议程和幻灯片。"
          action={<GhostButton onClick={onOpenMeetings}>前往组会日常</GhostButton>}
          className="border-none py-4"
        />
      </section>
    );
  }

  const meetingDate = new Date(meeting.meetingDate);
  const agendaCount = meeting.agenda?.length ?? 0;
  const openActions = (meeting.actions ?? []).filter((action) => action.status === 'open' || action.status === 'in_progress').length;

  return (
    <section className="relative overflow-hidden rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.13] via-card to-card p-5 shadow-sm">
      <div aria-hidden className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-primary/15 blur-2xl" />
      <div className="relative">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.1em] text-primary">
          <CalendarClock className="h-3.5 w-3.5" />下一场{MEETING_TYPE_LABEL[meeting.meetingType]}
        </div>
        <h3 className="mt-2.5 line-clamp-2 text-base font-semibold leading-6 text-foreground">{meeting.title}</h3>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span>{new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).format(meetingDate)}</span>
          <span>·</span>
          <span>{meeting.myRole === 'presenter' ? '我要汇报' : '参加旁听'}</span>
          {meeting.location && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{meeting.location}</span>
            </>
          )}
        </div>

        <div className="mt-4 flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold tabular-nums text-primary">{formatCountdown(meetingDate, now)}</span>
          <span className="text-xs text-muted-foreground">后开始</span>
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground">
          议程 {agendaCount} 项{openActions > 0 ? ` · ${openActions} 项待办未闭环` : ' · 行动项已闭环'}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <PrimaryButton onClick={onPrepare}>准备这次汇报</PrimaryButton>
          <GhostButton onClick={onOpenMeetings}>查看议程</GhostButton>
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
  if (signals.length === 0) {
    return (
      <div className="px-4 pb-4">
        <EmptyHint
          icon={<ShieldCheck className="h-4 w-4" />}
          title="没有需要立刻关注的事项"
          description="投稿、导师反馈与自动化都在正常推进。"
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
