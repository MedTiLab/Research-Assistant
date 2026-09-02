import { Activity, DatabaseZap } from 'lucide-react';
import type { DiscoveryFrequency, DiscoverySummaryStats } from './types';
import { FREQUENCY_LABELS } from './utils';

const STAT_ACCENTS = [
  'bg-slate-50 text-slate-700 dark:bg-slate-950/30 dark:text-slate-200',
  'bg-muted text-foreground dark:bg-card dark:text-foreground',
  'bg-slate-50 text-slate-700 dark:bg-slate-950/50 dark:text-slate-300',
  'bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300',
];

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <article className="rounded-xl border border-border/60 bg-white/88 p-4 shadow-sm dark:bg-slate-950/55">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
          <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-foreground">{value}</div>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl text-xs font-semibold tabular-nums ${accent}`}>
          {value}
        </div>
      </div>
    </article>
  );
}

export default function PubMedDiscoveryHeader({
  stats,
  frequency,
}: {
  stats: DiscoverySummaryStats;
  frequency: DiscoveryFrequency;
}) {
  const periodLabel = frequency === 'daily' ? '今日' : '本周';
  const cards = [
    { label: `${periodLabel}检索文献`, value: stats.totalArticles },
    { label: '发现候选变量', value: stats.candidateCount },
    { label: '匹配已有变量', value: stats.matchedExistingCount },
    { label: '待审核', value: stats.pendingReviewCount },
  ];

  return (
    <header className="relative overflow-hidden rounded-[24px] border border-border/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(245,245,245,0.92))] p-6 shadow-sm dark:bg-[linear-gradient(180deg,rgba(8,8,8,0.98),rgba(0,0,0,0.92))] sm:p-7">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-[linear-gradient(90deg,rgba(15,23,42,0.06),rgba(100,116,139,0.04),transparent)] dark:bg-[linear-gradient(90deg,rgba(248,250,252,0.08),rgba(148,163,184,0.04),transparent)]" />

      <div className="relative grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.85fr)]">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-slate-50/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-800 shadow-sm dark:border-slate-900/60 dark:bg-slate-950/30 dark:text-slate-200">
            <DatabaseZap className="h-3.5 w-3.5" />
            变量与证据中心
          </div>

          <h2 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-[2.2rem]">
            PubMed 文献候选
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-[15px]">
            当前按{FREQUENCY_LABELS[frequency]}范围调用 PubMed：先本地评分与题名规则预抽取，再对最高分文献做小批量 Claude 摘要验证，并路由至人工审核与资源库。
          </p>

          <p className="mt-4 inline-flex items-center gap-2 rounded-xl border border-border/60 bg-white/70 px-4 py-3 text-xs leading-5 text-muted-foreground shadow-sm dark:bg-slate-950/45">
            <Activity className="h-4 w-4 text-slate-500 dark:text-slate-400" />
            文献候选结果只进入 candidate / pending review 流程，不会直接写入 stable 变量库。
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
          {cards.map((card, index) => (
            <StatCard key={card.label} label={card.label} value={card.value} accent={STAT_ACCENTS[index]} />
          ))}
        </div>
      </div>
    </header>
  );
}
