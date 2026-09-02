import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type TokenBreakdown = {
  input?: number;
  cacheRead?: number;
  cacheCreation?: number;
  output?: number;
  reasoning?: number;
};

type TokenUsagePieProps = {
  used?: number | null;
  total?: number | null;
  estimated?: boolean;
  unsupportedContext?: boolean;
  message?: string;
  model?: string | null;
  provider?: string;
  breakdown?: TokenBreakdown;
  totalSource?: 'runtime' | 'fallback';
  onCompact?: () => Promise<string | void>;
  canCompact?: boolean;
  showUnavailable?: boolean;
};

const formatTokens = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return value.toLocaleString();
};

export default function TokenUsagePie({
  used,
  total,
  estimated,
  unsupportedContext,
  message,
  model,
  provider,
  breakdown,
  totalSource = 'runtime',
  onCompact,
  canCompact = true,
  showUnavailable = true,
}: TokenUsagePieProps) {
  const { t } = useTranslation('chat');
  const [open, setOpen] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [compactResult, setCompactResult] = useState<'success' | 'error' | null>(null);
  const [compactMessage, setCompactMessage] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [dialogPosition, setDialogPosition] = useState({ left: 12, bottom: 48, width: 340 });
  const hasUsage = !unsupportedContext
    && typeof used === 'number' && Number.isFinite(used) && used >= 0
    && typeof total === 'number' && Number.isFinite(total) && total > 0;

  useEffect(() => {
    if (!hasUsage) setOpen(false);
  }, [hasUsage]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !dialogRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = Math.min(340, window.innerWidth - 24);
      const left = Math.min(
        window.innerWidth - width - 12,
        Math.max(12, rect.left),
      );
      setDialogPosition({
        left,
        bottom: Math.max(12, window.innerHeight - rect.top + 8),
        width,
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  const rows = useMemo(() => ([
    { key: 'input', label: t('tokenUsage.breakdown.input'), value: breakdown?.input, color: '#6366f1' },
    { key: 'cacheRead', label: t('tokenUsage.breakdown.cacheRead'), value: breakdown?.cacheRead, color: '#06b6d4' },
    { key: 'cacheCreation', label: t('tokenUsage.breakdown.cacheCreation'), value: breakdown?.cacheCreation, color: '#8b5cf6' },
    { key: 'output', label: t('tokenUsage.breakdown.output'), value: breakdown?.output, color: '#f59e0b' },
    { key: 'reasoning', label: t('tokenUsage.breakdown.reasoning'), value: breakdown?.reasoning, color: '#f97316' },
  ]).filter((row) => Number(row.value) > 0), [breakdown, t]);

  if (!hasUsage && !showUnavailable) return null;

  const safeUsed = used ?? 0;
  const safeTotal = total && total > 0 ? total : 0;
  const percentage = safeTotal > 0 ? Math.min(100, (safeUsed / safeTotal) * 100) : 0;
  const remaining = Math.max(0, safeTotal - safeUsed);
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  const baseTitle = safeTotal > 0
    ? `${safeUsed.toLocaleString()} / ${safeTotal.toLocaleString()} tokens`
    : t('tokenUsage.unavailableTitle');
  const titleText = estimated && message ? `${baseTitle}\n${message}` : (message || baseTitle);
  const color = percentage < 50 ? '#3b82f6' : percentage < 75 ? '#f59e0b' : '#ef4444';

  const handleCompact = async () => {
    if (!onCompact || compacting || !canCompact) return;
    setCompacting(true);
    setCompactResult(null);
    setCompactMessage('');
    try {
      const result = await onCompact();
      setCompactResult('success');
      setCompactMessage(result || t('tokenUsage.compact.started'));
    } catch (error) {
      setCompactResult('error');
      setCompactMessage(error instanceof Error ? error.message : t('tokenUsage.compact.failed'));
    } finally {
      setCompacting(false);
    }
  };

  return (
    <div ref={rootRef} className="relative flex items-center text-xs text-gray-600 dark:text-gray-400">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className={`flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-white text-slate-700 shadow-sm transition-colors enabled:hover:bg-slate-50 focus:outline-none focus:ring-1 focus:ring-primary/30 ${hasUsage ? 'px-2' : 'w-7'}`}
        disabled={!hasUsage}
        title={hasUsage ? titleText : t('tokenUsage.pendingTitle')}
        aria-expanded={hasUsage && open}
        aria-label={t(hasUsage ? 'tokenUsage.openBreakdown' : 'tokenUsage.pendingTitle')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 -rotate-90" aria-hidden="true">
          <circle cx="12" cy="12" r={radius} fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-300 dark:text-gray-600" />
          {hasUsage && <circle cx="12" cy="12" r={radius} fill="none" stroke={color} strokeWidth="2" strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" />}
        </svg>
        {hasUsage && <span className="text-[11px] tabular-nums">{percentage.toFixed(1)}%</span>}
      </button>

      {hasUsage && open && typeof document !== 'undefined' && createPortal(
        <div
          ref={dialogRef}
          role="dialog"
          aria-label={t('tokenUsage.title')}
          className="fixed z-[1000] rounded-xl border border-border bg-popover p-3 text-foreground shadow-2xl"
          style={dialogPosition}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-xs font-semibold">{t('tokenUsage.title')}</h3>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{model || provider || t('tokenUsage.unknownModel')}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label={t('tokenUsage.close')}>
              <X className="h-4 w-4" />
            </button>
          </div>

          {safeTotal > 0 ? (
            <>
              <div className="mt-3 flex items-baseline justify-between gap-3 font-mono">
                <span className="text-sm font-semibold">
                  {formatTokens(safeUsed)} / {formatTokens(safeTotal)} <span className="text-xs">({percentage.toFixed(1)}%)</span>
                </span>
                <span className="text-[10px] text-muted-foreground">{formatTokens(remaining)} {t('tokenUsage.remaining')}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full transition-[width]" style={{ width: `${percentage}%`, backgroundColor: color }} />
              </div>
            </>
          ) : (
            <p className="mt-4 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">{message || t('tokenUsage.unavailableTitle')}</p>
          )}

          <div className="mt-2 flex flex-wrap gap-1 text-[9px]">
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground">{estimated ? t('tokenUsage.estimated') : t('tokenUsage.measured')}</span>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground">{totalSource === 'runtime' ? t('tokenUsage.runtimeWindow') : t('tokenUsage.fallbackWindow')}</span>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground">{t('tokenUsage.autoCompact')}</span>
          </div>

          {rows.length > 0 && (
            <div className="mt-3 border-t border-border/70 pt-2.5">
              <p className="mb-1.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">{t('tokenUsage.latestTurn')}</p>
              <div className="grid grid-cols-2 gap-x-5 gap-y-1.5">
                {rows.map((row) => (
                  <div key={row.key} className="flex items-center gap-1.5 text-[10px]">
                    <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: row.color }} />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.label}</span>
                    <span className="font-mono text-foreground">{formatTokens(Number(row.value))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="mt-3 border-t border-border/70 pt-2.5 text-[10px] leading-4 text-muted-foreground">{t('tokenUsage.mechanism')}</p>

          {onCompact && (
            <div className="mt-2.5 flex items-center justify-between gap-3">
              <div className={`min-w-0 text-[10px] ${compactResult === 'error' ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}`}>
                {compactResult === 'success' && <CheckCircle2 className="mr-1 inline h-3 w-3" />}
                {compactMessage}
              </div>
              <button
                type="button"
                onClick={handleCompact}
                disabled={compacting || !canCompact}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[10px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                title={!canCompact ? t('tokenUsage.compact.waitForTurn') : t('tokenUsage.compact.button')}
              >
                {compacting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {compacting ? t('tokenUsage.compact.running') : t('tokenUsage.compact.button')}
              </button>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
