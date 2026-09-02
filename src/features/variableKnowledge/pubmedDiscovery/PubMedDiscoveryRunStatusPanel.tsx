import { AlertCircle, CheckCircle2, ChevronDown, Clock3, Loader2, Terminal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PubMedDiscoveryProgressEvent, PubMedDiscoveryProgressPhase } from './types';

/** Match xterm theme in Shell.jsx — neutral grays, no blue/green tint. */
const TERMINAL = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  muted: '#858585',
  dim: '#666666',
  surface: '#2d2d2d',
  progressRunning: '#858585',
  progressSuccess: '#a0a0a0',
  progressWarning: '#e5e510',
  progressError: '#f14c4c',
} as const;

const PHASE_DEFAULT_TIMEOUT_MS: Partial<Record<PubMedDiscoveryProgressPhase, number>> = {
  pubmed_search: 75_000,
  local_prescreen: 15_000,
  llm_extract: 360_000,
  llm_title_screen: 90_000,
  llm_abstract_refine: 360_000,
  match_existing: 30_000,
};

/** Pipeline order so we show one row per phase (last update wins - running then success). */
const PHASE_DISPLAY_ORDER: PubMedDiscoveryProgressPhase[] = [
  'prepare',
  'pubmed_search',
  'pubmed_results',
  'local_prescreen',
  'llm_extract',
  'llm_title_screen',
  'llm_abstract_refine',
  'llm_complete',
  'rule_fallback',
  'match_existing',
  'completed',
  'cancelled',
  'failed',
];

function dedupeEventsByPhase(events: PubMedDiscoveryProgressEvent[]): PubMedDiscoveryProgressEvent[] {
  const latestByPhase = new Map<PubMedDiscoveryProgressPhase, PubMedDiscoveryProgressEvent>();
  for (const event of events) {
    latestByPhase.set(event.phase, event);
  }
  return PHASE_DISPLAY_ORDER.map((phase) => latestByPhase.get(phase)).filter(Boolean) as PubMedDiscoveryProgressEvent[];
}

function formatTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toTimeString().slice(0, 8);
}

function formatDuration(ms: number | undefined) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}分${seconds.toString().padStart(2, '0')}秒`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}小时${remainingMinutes.toString().padStart(2, '0')}分`;
}

function clampProgress(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function parseEventTime(value: string | undefined) {
  if (!value) return NaN;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? NaN : parsed;
}

function getStartedAtMs(event: PubMedDiscoveryProgressEvent) {
  const startedAtMs = parseEventTime(event.startedAt);
  if (!Number.isNaN(startedAtMs)) return startedAtMs;
  return parseEventTime(event.createdAt);
}

function getElapsedMs(event: PubMedDiscoveryProgressEvent, nowMs: number) {
  if (typeof event.durationMs === 'number' && Number.isFinite(event.durationMs)) {
    return Math.max(0, event.durationMs);
  }
  const explicitStartedAtMs = parseEventTime(event.startedAt);
  if (!Number.isNaN(explicitStartedAtMs)) {
    if (event.status === 'running') return Math.max(0, nowMs - explicitStartedAtMs);
    const endedAtMs = parseEventTime(event.createdAt);
    return Number.isNaN(endedAtMs) ? undefined : Math.max(0, endedAtMs - explicitStartedAtMs);
  }
  if (event.status !== 'running') return undefined;
  const startedAtMs = getStartedAtMs(event);
  return Number.isNaN(startedAtMs) ? undefined : Math.max(0, nowMs - startedAtMs);
}

function getTimeoutMs(event: PubMedDiscoveryProgressEvent) {
  if (typeof event.timeoutMs === 'number' && Number.isFinite(event.timeoutMs) && event.timeoutMs > 0) {
    return event.timeoutMs;
  }
  return PHASE_DEFAULT_TIMEOUT_MS[event.phase];
}

function getProgressPercent(event: PubMedDiscoveryProgressEvent, nowMs: number) {
  if (typeof event.progress === 'number' && Number.isFinite(event.progress)) {
    const explicitProgress = clampProgress(event.progress);
    if (event.status !== 'running' || explicitProgress > 0) {
      return event.status === 'running' ? Math.min(95, explicitProgress) : explicitProgress;
    }
  }
  if (event.status !== 'running') return 100;
  const timeoutMs = getTimeoutMs(event);
  const elapsedMs = getElapsedMs(event, nowMs);
  if (!timeoutMs || typeof elapsedMs !== 'number') return 8;
  return Math.min(95, Math.max(8, clampProgress((elapsedMs / timeoutMs) * 100)));
}

function getTimingLabel(event: PubMedDiscoveryProgressEvent, nowMs: number) {
  const elapsedMs = getElapsedMs(event, nowMs);
  if (typeof elapsedMs !== 'number') return '';
  if (event.status === 'running') {
    const timeoutMs = getTimeoutMs(event);
    const timeoutLabel = timeoutMs ? ` / 上限 ${formatDuration(timeoutMs)}` : '';
    return `已等待 ${formatDuration(elapsedMs)}${timeoutLabel}`;
  }
  return `用时 ${formatDuration(elapsedMs)}`;
}

function progressBarColor(event: PubMedDiscoveryProgressEvent) {
  if (event.status === 'running') return TERMINAL.progressRunning;
  if (event.status === 'success') return TERMINAL.progressSuccess;
  if (event.status === 'warning' || event.status === 'cancelled') return TERMINAL.progressWarning;
  return TERMINAL.progressError;
}

function statusIcon(event: PubMedDiscoveryProgressEvent) {
  if (event.status === 'running') {
    return <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" style={{ color: TERMINAL.muted }} />;
  }
  if (event.status === 'success') {
    return <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: TERMINAL.progressSuccess }} />;
  }
  if (event.status === 'warning' || event.status === 'cancelled') {
    return <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: TERMINAL.progressWarning }} />;
  }
  return <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: TERMINAL.progressError }} />;
}

function statusLabel(value: PubMedDiscoveryProgressEvent['status']) {
  if (value === 'running') return '运行中';
  if (value === 'success') return '完成';
  if (value === 'warning') return '已降级';
  if (value === 'cancelled') return '已暂停';
  return '失败';
}

export default function PubMedDiscoveryRunStatusPanel({
  events,
  isRunning,
}: {
  events: PubMedDiscoveryProgressEvent[];
  isRunning: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [logsExpanded, setLogsExpanded] = useState(false);

  useEffect(() => {
    if (logsExpanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, logsExpanded]);

  useEffect(() => {
    if (!isRunning) return undefined;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isRunning, events]);

  const displayEvents = useMemo(() => dedupeEventsByPhase(events), [events]);
  const latestDisplayEvent = displayEvents[displayEvents.length - 1];
  const runningDisplayEvent = [...displayEvents].reverse().find((event) => event.status === 'running');
  const activeEvent = isRunning ? runningDisplayEvent ?? latestDisplayEvent : latestDisplayEvent;
  const activeTiming = activeEvent ? getTimingLabel(activeEvent, nowMs) : '';

  if (!isRunning && events.length === 0) {
    return null;
  }

  return (
    <section className="border-b border-border/60 bg-background">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/40 px-1 py-2 sm:py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : <Terminal className="h-4 w-4 text-muted-foreground" />}
            运行状态
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {activeEvent
              ? `${activeEvent.status === 'running' ? '当前卡在：' : ''}${activeEvent.label}${activeTiming ? ` · ${activeTiming}` : ''}`
              : '等待启动 PubMed 自动发现。'}
          </p>
        </div>
        {activeEvent ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] tabular-nums text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" />
            {formatTime(activeEvent.createdAt)}
          </span>
        ) : null}
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border/60 px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          onClick={() => setLogsExpanded((prev) => !prev)}
          aria-expanded={logsExpanded}
          aria-controls="pubmed-discovery-run-log"
        >
          {logsExpanded ? '收起日志' : '展开日志'}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${logsExpanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {logsExpanded ? (
        <div
          id="pubmed-discovery-run-log"
          ref={scrollRef}
          className="max-h-52 overflow-y-auto px-3 py-3 font-mono text-[11px] leading-5 sm:px-4"
          style={{ backgroundColor: TERMINAL.background, color: TERMINAL.foreground }}
        >
          {displayEvents.map((event) => {
            const renderEvent: PubMedDiscoveryProgressEvent = !isRunning && event.status === 'running'
              ? { ...event, status: 'cancelled', durationMs: getElapsedMs(event, nowMs), progress: 100 }
              : event;
            const progress = getProgressPercent(renderEvent, nowMs);
            const timingLabel = getTimingLabel(renderEvent, nowMs);
            return (
              <div key={event.phase} className="flex gap-2 py-1.5">
                {statusIcon(renderEvent)}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span style={{ color: TERMINAL.dim }}>{formatTime(renderEvent.createdAt)}</span>
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px]"
                      style={{ backgroundColor: TERMINAL.surface, color: TERMINAL.foreground }}
                    >
                      {statusLabel(renderEvent.status)}
                    </span>
                    <span style={{ color: TERMINAL.foreground }}>{renderEvent.label}</span>
                    {timingLabel ? (
                      <span className="tabular-nums" style={{ color: TERMINAL.muted }}>{timingLabel}</span>
                    ) : null}
                    <span className="ml-auto tabular-nums" style={{ color: TERMINAL.dim }}>{progress}%</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: TERMINAL.surface }}>
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{ width: `${progress}%`, backgroundColor: progressBarColor(renderEvent) }}
                    />
                  </div>
                  {renderEvent.detail ? (
                    <div className="mt-1 whitespace-pre-wrap break-words pl-0" style={{ color: TERMINAL.muted }}>{renderEvent.detail}</div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div
          id="pubmed-discovery-run-log"
          className="px-1 pb-2 text-xs text-muted-foreground"
        >
          日志已收起（共 {displayEvents.length} 条阶段记录）。
        </div>
      )}
    </section>
  );
}
