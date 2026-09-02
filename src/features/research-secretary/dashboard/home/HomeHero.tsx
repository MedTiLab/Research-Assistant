import { Check, Flag, Loader2, MessageCircle, Save, Sparkles, Target } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../../lib/utils';
import { workbenchLocale } from '../../i18n';
import { PrimaryButton } from './HomeUi';

type Props = {
  now: Date;
  focus: string;
  goal: string;
  onFocusChange: (value: string) => void;
  onGoalChange: (value: string) => void;
  onSave: () => void;
  saved: boolean;
  runningAgentCount: number;
  isSyncing: boolean;
  syncError: string | null;
  onOpenChat: () => void;
  className?: string;
};

function greetingKeyFor(hour: number) {
  if (hour < 5) return 'lateNight';
  if (hour < 11) return 'morning';
  if (hour < 14) return 'noon';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

/** Day-progress ring wrapped around a minimal analog face. */
function ClockDial({ now }: { now: Date }) {
  const { t, i18n } = useTranslation('workbench');
  const locale = workbenchLocale(i18n.language);
  const dayNames = t('calendar.weekdaysShort', { returnObjects: true }) as string[];
  const seconds = now.getSeconds();
  const minutes = now.getMinutes();
  const hours = now.getHours();
  const dayProgress = (hours * 3600 + minutes * 60 + seconds) / 86400;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const hourAngle = (hours % 12) * 30 + minutes * 0.5;
  const minuteAngle = minutes * 6 + seconds * 0.1;
  const secondAngle = seconds * 6;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 120 120" className="h-[112px] w-[112px]" aria-label={t('home.currentTime')}>
        <circle cx="60" cy="60" r={radius} fill="none" className="stroke-border/80" strokeWidth="2.5" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          className="stroke-primary transition-[stroke-dasharray] duration-500"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${circumference * dayProgress} ${circumference}`}
          transform="rotate(-90 60 60)"
        />
        <circle cx="60" cy="60" r="45" className="fill-background/70 stroke-border/50" strokeWidth="1" />
        {Array.from({ length: 12 }).map((_, index) => {
          const angle = (index * 30 * Math.PI) / 180;
          const major = index % 3 === 0;
          return (
            <line
              key={index}
              x1={60 + (major ? 33 : 36) * Math.sin(angle)}
              y1={60 - (major ? 33 : 36) * Math.cos(angle)}
              x2={60 + 39 * Math.sin(angle)}
              y2={60 - 39 * Math.cos(angle)}
              className={major ? 'stroke-foreground/55' : 'stroke-foreground/20'}
              strokeWidth={major ? 1.6 : 1}
              strokeLinecap="round"
            />
          );
        })}
        <line x1="60" y1="60" x2="60" y2="38" className="stroke-foreground" strokeWidth="3" strokeLinecap="round" transform={`rotate(${hourAngle} 60 60)`} />
        <line x1="60" y1="60" x2="60" y2="28" className="stroke-foreground/75" strokeWidth="2" strokeLinecap="round" transform={`rotate(${minuteAngle} 60 60)`} />
        <line x1="60" y1="65" x2="60" y2="25" className="stroke-primary" strokeWidth="1" strokeLinecap="round" transform={`rotate(${secondAngle} 60 60)`} />
        <circle cx="60" cy="60" r="3.5" className="fill-primary stroke-background" strokeWidth="1.5" />
      </svg>
      <div className="mt-0.5 text-base font-semibold tabular-nums tracking-wide text-foreground">
        {new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now)}
      </div>
      <div className="text-[11px] text-muted-foreground">
        {t('home.dayProgress', { day: dayNames[now.getDay()], percent: Math.round(dayProgress * 100) })}
      </div>
    </div>
  );
}

export default function HomeHero({
  now,
  focus,
  goal,
  onFocusChange,
  onGoalChange,
  onSave,
  saved,
  runningAgentCount,
  isSyncing,
  syncError,
  onOpenChat,
  className,
}: Props) {
  const { t, i18n } = useTranslation('workbench');
  const locale = workbenchLocale(i18n.language);
  const greeting = t(`home.greeting.${greetingKeyFor(now.getHours())}`);
  const dateLabel = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(now);

  return (
    <section className={cn('relative overflow-hidden rounded-2xl border border-border/70 bg-card px-4 py-4 shadow-sm sm:px-6', className)}>
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -right-16 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-28 left-6 h-64 w-64 rounded-full bg-clinical-evidence/10 blur-3xl" />
        <div
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage: 'radial-gradient(hsl(var(--clinical-border-strong) / 0.3) 0.6px, transparent 0.6px)',
            backgroundSize: '18px 18px',
          }}
        />
      </div>

      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.1em] text-primary">
              <Sparkles className="h-3 w-3" />{t('home.badge')}
            </span>
            <span className="text-base font-medium text-muted-foreground">{dateLabel}</span>
            <span className="text-sm font-medium tabular-nums text-foreground sm:hidden">
              {new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(now)}
            </span>
            {runningAgentCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/[0.07] px-2.5 py-0.5 text-[11px] font-medium text-primary">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-70" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                </span>
                {t('home.agentsRunning', { count: runningAgentCount })}
              </span>
            )}
            {isSyncing && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />{t('home.syncing')}
              </span>
            )}
            {syncError && !isSyncing && (
              <span className="inline-flex items-center rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">{t('home.syncError')}</span>
            )}
          </div>

          <h1
            className="mt-2.5 text-[24px] font-semibold leading-tight tracking-tight text-foreground sm:text-[30px]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {t('home.headline', { greeting })}
          </h1>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border/70 bg-background/70 px-3 py-1.5 transition-colors focus-within:border-primary/45 focus-within:bg-background">
              <span className="flex flex-shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <Target className="h-3.5 w-3.5" />{t('home.focusLabel')}
              </span>
              <input
                value={focus}
                onChange={(event) => onFocusChange(event.target.value)}
                placeholder={t('home.focusPlaceholder')}
                className="min-w-0 flex-1 bg-transparent text-sm font-medium text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/70"
              />
            </label>
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border/70 bg-background/70 px-3 py-1.5 transition-colors focus-within:border-primary/45 focus-within:bg-background">
              <span className="flex flex-shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground">
                <Flag className="h-3.5 w-3.5" />{t('home.goalLabel')}
              </span>
              <input
                value={goal}
                onChange={(event) => onGoalChange(event.target.value)}
                placeholder={t('home.goalPlaceholder')}
                className="min-w-0 flex-1 bg-transparent text-sm font-medium text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/70"
              />
            </label>
            <PrimaryButton className="h-8 flex-shrink-0 px-3 text-xs" onClick={onSave}>
              {saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
              {t('common.save')}
            </PrimaryButton>
          </div>

          <div className={cn('mt-1.5 text-[11px]', saved ? 'text-primary' : 'text-muted-foreground')}>
            {saved ? t('home.savedLocally') : t('home.saveHint')}
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-col items-center gap-2.5">
          {/* The dial is decorative context; on phones the vertical space is better spent on content. */}
          <div className="hidden sm:block">
            <ClockDial now={now} />
          </div>
          <PrimaryButton className="h-8 px-3 text-xs" onClick={onOpenChat}>
            <MessageCircle className="h-3.5 w-3.5" />{t('home.chat')}
          </PrimaryButton>
        </div>
      </div>
    </section>
  );
}
