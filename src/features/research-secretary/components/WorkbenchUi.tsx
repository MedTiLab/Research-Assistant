import type { ReactNode } from 'react';
import { ArrowUpRight, Menu } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../../lib/utils';
import { STATUS_TONE_CLASSES, type StatusTone } from '../domain/status';

/**
 * `fill` turns the page into a single-screen shell on wide viewports: the page itself stops
 * scrolling and the content becomes a flex column, so children can claim the leftover height
 * and scroll internally. Narrower viewports keep the ordinary stacked-and-scrolling behaviour.
 */
export function WorkbenchPage({
  children,
  onMenuClick,
  fill = false,
}: {
  children: ReactNode;
  onMenuClick?: () => void;
  fill?: boolean;
}) {
  const { t } = useTranslation('workbench');
  return (
    <div className={cn('h-full min-h-0 overflow-y-auto bg-muted/25', fill && 'xl:overflow-hidden')}>
      <div
        className={cn(
          'mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7',
          fill && 'xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:py-4',
        )}
      >
        {onMenuClick && (
          <button type="button" onClick={onMenuClick} className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm sm:hidden" aria-label={t('common.openNav')}>
            <Menu className="h-4 w-4" />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-primary">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[28px]">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionCard({
  title,
  icon,
  action,
  children,
  className,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('min-w-0 rounded-xl border border-border/70 bg-card shadow-sm', className)}>
      <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-foreground">
          {icon}
          <span className="truncate">{title}</span>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function StatusBadge({ tone = 'neutral', children }: { tone?: StatusTone; children: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium', STATUS_TONE_CLASSES[tone])}>
      {children}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{children}</div>;
}

export function CardLink({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary/80 disabled:pointer-events-none disabled:opacity-50"
      disabled={!onClick}
    >
      {children}
      <ArrowUpRight className="h-3.5 w-3.5" />
    </button>
  );
}

export function formatWorkbenchDate(value?: string, options?: Intl.DateTimeFormatOptions, locale?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, options ?? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

export function getProjectLabel(projectId: string | undefined, projectNames: Map<string, string>, fallback?: string) {
  if (!projectId) return fallback || 'Cross-project';
  return projectNames.get(projectId) || projectId;
}
