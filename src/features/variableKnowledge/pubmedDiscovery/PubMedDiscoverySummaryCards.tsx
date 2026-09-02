import { useMemo } from 'react';
import type { DiscoveryFrequency, PubMedVariableCandidate } from './types';
import { FREQUENCY_LABELS } from './utils';

function EvidenceRow({ label, value, deltaLabel }: { label: string; value: string; deltaLabel: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{deltaLabel}</p>
      </div>
      <p className="shrink-0 text-base font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function getTopCandidateNames(candidates: PubMedVariableCandidate[] = []) {
  const counts = new Map<string, number>();
  candidates.forEach((candidate) => {
    const key = candidate.canonical_name_guess || candidate.raw_name;
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3);
}

export default function PubMedDiscoverySummaryCards({
  candidates,
  frequency,
  evidenceCount,
}: {
  candidates: PubMedVariableCandidate[];
  frequency: DiscoveryFrequency;
  evidenceCount: number;
}) {
  const safeCandidates = Array.isArray(candidates) ? candidates : [];
  const topCandidates = useMemo(() => getTopCandidateNames(safeCandidates), [safeCandidates]);
  const pendingReviewCount = safeCandidates.filter((candidate) => candidate.review_status === 'pending').length;
  const matchedEvidenceCount = safeCandidates.filter((candidate) => candidate.match_status === 'matched' || candidate.match_status === 'merged').length;
  const periodLabel = frequency === 'daily' ? '今日' : '本周';
  const deltaLabel = frequency === 'daily' ? '来自今日运行结果' : '来自最近 7 日运行结果';
  const trendingLine = (topCandidates.length ? topCandidates : [['暂无', 0] as [string, number]])
    .map(([item]) => item)
    .join(' · ');

  return (
    <section className="border-b border-border/60 pb-4 pt-1">
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-10">
        <div>
          <p className="border-b border-border/60 pb-2 text-sm font-semibold text-foreground">
            {FREQUENCY_LABELS[frequency]}自动汇总报告
          </p>
          <div className="divide-y divide-border/50 text-sm">
            <div className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-muted-foreground">新增候选变量</span>
              <span className="font-semibold tabular-nums text-foreground">{safeCandidates.length} 个</span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-muted-foreground">已有变量新增证据</span>
              <span className="font-semibold tabular-nums text-foreground">{matchedEvidenceCount || evidenceCount || 0} 条</span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-muted-foreground">建议人工审核</span>
              <span className="font-semibold tabular-nums text-foreground">{pendingReviewCount} 个</span>
            </div>
          </div>
          <div className="mt-3 text-sm">
            <span className="text-muted-foreground">升温变量</span>
            <p className="mt-1 leading-relaxed text-foreground">{trendingLine}</p>
          </div>
        </div>

        <div>
          <p className="border-b border-border/60 pb-2 text-sm font-semibold text-foreground">{periodLabel}新增证据</p>
          <div className="divide-y divide-border/50">
            {(topCandidates.length ? topCandidates : [['候选变量', 0] as [string, number]]).map(([label, count]) => (
              <EvidenceRow key={label} label={label} value={`+${count} 篇`} deltaLabel={deltaLabel} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
