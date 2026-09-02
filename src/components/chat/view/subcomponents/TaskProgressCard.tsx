import React, { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, ChevronDown, ChevronUp, Target } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type TaskProgressCardProps = {
  label: string;
  subtitle: string;
  title: string;
  done: number;
  total: number;
  compact?: boolean;
  className?: string;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  action?: ReactNode;
  children: ReactNode;
};

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** Project task presentation shared by all chat providers. */
export default function TaskProgressCard({
  label, subtitle, title, done, total, compact = false, className = '',
  expanded: controlledExpanded, onExpandedChange, action, children,
}: TaskProgressCardProps) {
  const { t } = useTranslation('chat');
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = controlledExpanded ?? localExpanded;
  const setExpanded = onExpandedChange || setLocalExpanded;
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const [position, setPosition] = useState<{ left: number; bottom: number; width: number; maxHeight: number } | null>(null);
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  useBrowserLayoutEffect(() => {
    if (!expanded) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(compact ? 420 : rect.width, window.innerWidth - 32);
      setPosition({
        left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)),
        bottom: window.innerHeight - rect.top + 8,
        width,
        maxHeight: Math.max(80, Math.min(320, rect.top - 24)),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [expanded, compact]);

  useEffect(() => {
    if (!expanded) return;
    const dismiss = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setExpanded(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setExpanded(false); toggle.current?.focus(); }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [expanded, setExpanded]);

  const details = expanded ? <div ref={panel} id={panelId} role="region" aria-label={label}
    className="z-30 space-y-2 overflow-y-auto overscroll-contain rounded-xl border border-border/70 bg-card/95 px-3 py-2.5 text-foreground shadow-xl backdrop-blur"
    style={position ? { position: 'fixed', ...position } : { position: 'absolute', bottom: '100%', left: 0, width: '100%', marginBottom: 8 }}>
    {total > 0 && <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
    </div>}
    {children}
  </div> : null;

  return <div ref={anchor} role="group" aria-label={label}
    className={`relative min-w-0 ${compact ? 'max-w-[min(430px,calc(100vw-2rem))]' : 'my-2 w-full'} ${className}`}>
    {details && (typeof document === 'undefined' ? details : createPortal(details, document.body))}
    <div className={compact
      ? 'flex h-10 min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-card/95 px-3 py-1.5 shadow-sm backdrop-blur'
      : 'flex min-w-0 items-center gap-2 rounded-xl border border-border/70 bg-card/95 px-3 py-2.5 shadow-sm backdrop-blur'}>
      <div className={`flex shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200 ${compact ? 'h-6 w-6' : 'h-7 w-7'}`}>
        {total > 0 && done === total
          ? <CheckCircle2 className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
          : <Target className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
      </div>
      <div className="min-w-0 flex-1">
        <p title={subtitle} className={`truncate text-muted-foreground ${compact ? 'text-[11px]' : 'text-xs'}`}>{subtitle}</p>
        <p title={title} className={`truncate font-medium text-foreground ${compact ? 'text-xs' : 'text-sm'}`}>{title}</p>
      </div>
      {action}
      <button ref={toggle} type="button" aria-expanded={expanded} aria-controls={panelId}
        aria-label={`${label}：${expanded ? t('tasks.compact.collapse') : t('tasks.compact.expand')}`}
        onClick={() => setExpanded(!expanded)}
        className={`inline-flex shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted/70 ${compact ? 'h-7 w-7' : 'h-8 w-8'}`}
        title={expanded ? t('tasks.compact.collapse') : t('tasks.compact.expand')}>
        {expanded ? <ChevronDown className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} /> : <ChevronUp className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />}
      </button>
    </div>
  </div>;
}
