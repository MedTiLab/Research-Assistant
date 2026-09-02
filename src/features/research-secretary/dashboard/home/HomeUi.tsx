import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../../../lib/utils';

/** Accent vocabulary shared by every home-page surface. */
export type HomeTone = 'primary' | 'evidence' | 'warning' | 'danger' | 'muted';

export const HOME_TONE_TEXT: Record<HomeTone, string> = {
  primary: 'text-primary',
  evidence: 'text-clinical-evidence',
  warning: 'text-clinical-warning',
  danger: 'text-destructive',
  muted: 'text-muted-foreground',
};

export const HOME_TONE_SOFT: Record<HomeTone, string> = {
  primary: 'bg-primary/10 text-primary',
  evidence: 'bg-clinical-evidence/10 text-clinical-evidence',
  warning: 'bg-clinical-warning/12 text-clinical-warning',
  danger: 'bg-destructive/10 text-destructive',
  muted: 'bg-muted text-muted-foreground',
};

export const HOME_TONE_BAR: Record<HomeTone, string> = {
  primary: 'bg-primary',
  evidence: 'bg-clinical-evidence',
  warning: 'bg-clinical-warning',
  danger: 'bg-destructive',
  muted: 'bg-border',
};

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn('min-w-0 rounded-2xl border border-border/70 bg-card shadow-sm', className)}>
      {children}
    </section>
  );
}

export function PanelHead({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 px-5 pb-3 pt-4">
      {icon && <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</span>}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
        {hint && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</div>}
      </div>
      {action}
    </div>
  );
}

export function LinkAction({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex flex-shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
    >
      {children}
      <ChevronRight className="h-3.5 w-3.5" />
    </button>
  );
}

export function MetaChip({
  icon,
  tone = 'muted',
  children,
}: {
  icon?: ReactNode;
  tone?: HomeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
        tone === 'muted' ? 'bg-muted/70 text-muted-foreground' : HOME_TONE_SOFT[tone],
      )}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function EmptyHint({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 px-4 py-7 text-center', className)}>
      {icon && <span className="mb-2.5 grid h-9 w-9 place-items-center rounded-full bg-muted text-muted-foreground">{icon}</span>}
      <div className="text-sm font-medium text-foreground">{title}</div>
      {description && <p className="mt-1 max-w-[280px] text-xs leading-5 text-muted-foreground">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Primary / secondary buttons kept identical across the whole home page. */
export function PrimaryButton({
  children,
  onClick,
  className,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  className,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground transition-colors hover:border-primary/35 hover:bg-muted/70 disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}
