import type { VariableTrendPoint } from './types';
import { DISCOVERY_TREND_BAR_CLASS, formatTrendLabel } from './utils';

export default function PubMedDiscoveryTrendChart({ points }: { points: VariableTrendPoint[] }) {
  const peak = points.reduce((max, point) => Math.max(max, point.candidate_count), 0);
  const average = points.length
    ? points.reduce((sum, point) => sum + point.candidate_count, 0) / points.length
    : 0;
  const peakPoint = points.find((point) => point.candidate_count === peak);

  return (
    <div className="rounded-xl border border-border/50 bg-background/65 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">7 日发现趋势</p>
          <p className="mt-1 text-xs text-muted-foreground">日均候选：{average.toFixed(1)} · 峰值：{peak}，{peakPoint ? formatTrendLabel(peakPoint.date) : '无'}</p>
        </div>
      </div>

      <div className="mt-4 flex h-36 items-end gap-2">
        {points.map((point) => {
          const height = peak ? Math.max(10, (point.candidate_count / peak) * 100) : 10;
          return (
            <div key={point.date} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <div className="flex h-28 w-full items-end rounded-lg bg-muted/35 px-1.5 py-1.5">
                <div
                  className={`w-full rounded-md shadow-sm ${DISCOVERY_TREND_BAR_CLASS}`}
                  style={{ height: `${height}%` }}
                  title={`${formatTrendLabel(point.date)}: ${point.candidate_count}`}
                />
              </div>
              <span className="text-[10px] tabular-nums text-muted-foreground">{formatTrendLabel(point.date)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
