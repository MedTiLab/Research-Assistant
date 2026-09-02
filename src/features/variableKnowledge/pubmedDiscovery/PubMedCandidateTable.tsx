import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import type { DiscoveryFrequency, PubMedVariableCandidate } from './types';
import {
  confidenceColor,
  FREQUENCY_LABELS,
  MATCH_STATUS_LABELS,
  MATCH_STATUS_STYLES,
  VARIABLE_TYPE_LABELS,
} from './utils';

function getPubMedUrl(pmid: string) {
  return /^\d+$/.test(pmid) ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : undefined;
}

function extractionStageMeta(candidate: PubMedVariableCandidate) {
  if (candidate.extraction_stage === 'abstract_verified' || candidate.evidence_level === 'abstract_supported') {
    return { label: '摘要已验证', className: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200' };
  }
  if (candidate.extraction_stage === 'extraction_failed') {
    return { label: '抽取失败/待重试', className: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200' };
  }
  if (candidate.extraction_stage === 'title_screen' || candidate.extraction_source === 'title') {
    return { label: '题名发现', className: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200' };
  }
  return { label: '题名发现 · 规则预抽取', className: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-200' };
}

function evidencePmids(candidate: PubMedVariableCandidate) {
  return [...new Set((candidate.evidence_articles?.length
    ? candidate.evidence_articles.map((evidence) => evidence.pmid)
    : [candidate.pmid]).filter(Boolean))];
}

type Props = {
  candidates: PubMedVariableCandidate[];
  selectedCandidateId?: string;
  dismissingCandidateIds?: Set<string>;
  dismissedCount?: number;
  frequency: DiscoveryFrequency;
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onSelectCandidate: (candidate: PubMedVariableCandidate) => void;
  onAddToPool: (candidate: PubMedVariableCandidate) => void;
  onMarkAmbiguous: (candidate: PubMedVariableCandidate, note: string) => void;
  onIgnore: (candidate: PubMedVariableCandidate) => void;
};

export default function PubMedCandidateTable({
  candidates,
  selectedCandidateId,
  dismissingCandidateIds,
  dismissedCount = 0,
  frequency,
  page,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  onSelectCandidate,
  onAddToPool,
  onMarkAmbiguous,
  onIgnore,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(candidates.length / pageSize));
  const periodText = frequency === 'daily' ? '过去 24 小时' : '过去 7 天';
  const visibleCandidates = useMemo(
    () => candidates.slice((page - 1) * pageSize, page * pageSize),
    [candidates, page, pageSize],
  );

  return (
    <section className="rounded-2xl border border-white/40 bg-white/60 shadow-[0_18px_45px_rgba(15,23,42,0.10)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/40">
      <div className="px-4 py-4 sm:px-5">
        <h3 className="text-base font-semibold tracking-tight text-foreground">文献候选（{FREQUENCY_LABELS[frequency]}）</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {periodText}来自 PubMed 的新增候选变量与证据更新
          {dismissedCount > 0 ? `；已操作 ${dismissedCount} 条并自动收起` : ''}
        </p>
      </div>

      <div className="overflow-x-auto border-y border-border/50">
        <table className="min-w-[760px] w-full table-auto text-left text-sm">
          <thead className="bg-white/40 text-[11px] uppercase tracking-[0.12em] text-muted-foreground backdrop-blur-md dark:bg-white/5">
            <tr>
              <th className="max-w-[200px] px-2 py-3 font-semibold text-foreground">英文名</th>
              <th className="px-2 py-3 font-semibold">中文名</th>
              <th className="px-2 py-3 font-semibold">发现与证据</th>
              <th className="px-2 py-3 font-semibold">数据库</th>
              <th className="px-2 py-3 font-semibold">类型</th>
              <th className="px-2 py-3 font-semibold">匹配状态</th>
              <th className="px-2 py-3 font-semibold">置信度</th>
              <th className="w-px whitespace-nowrap border-l border-border/50 px-1.5 py-3 text-left font-semibold normal-case tracking-normal text-foreground">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/45">
            {visibleCandidates.map((candidate) => {
              const isSelected = selectedCandidateId === candidate.id;
              const isDismissing = dismissingCandidateIds?.has(candidate.id) ?? false;
              const ambiguityNote = candidate.ambiguity_notes?.trim() || '需要人工确认缩写含义。';
              const stage = extractionStageMeta(candidate);
              const pmids = evidencePmids(candidate);
              return (
                <tr
                  key={candidate.id}
                  className={cn(
                    'cursor-pointer bg-white/30 transition-all duration-200 ease-out hover:bg-white/50 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.32)] dark:bg-slate-950/20 dark:hover:bg-white/10',
                    isSelected && 'bg-slate-50/70 ring-1 ring-inset ring-slate-200/70 dark:bg-slate-950/20 dark:ring-slate-900/40',
                    isDismissing && 'pointer-events-none scale-[0.985] opacity-0 blur-[1px]',
                  )}
                  onClick={() => onSelectCandidate(candidate)}
                >
                  <td className="px-2 py-2.5 align-top text-[13px] font-medium text-foreground">
                    {candidate.display_name_en_guess?.trim()
                      || candidate.canonical_name_guess?.trim()
                      || '—'}
                  </td>
                  <td className="px-2 py-2.5 align-top text-[13px] text-foreground">{candidate.display_name_zh_guess}</td>
                  <td className="px-2 py-2.5 align-top text-[12px]" onClick={(event) => event.stopPropagation()}>
                    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium', stage.className)}>{stage.label}</span>
                    <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                      <span>{pmids.length} 篇文献</span>
                      {pmids[0] ? (
                        <>
                          <span>·</span>
                          {getPubMedUrl(pmids[0]) ? (
                            <a
                              href={getPubMedUrl(pmids[0])}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono font-semibold text-slate-600 underline-offset-2 hover:underline dark:text-slate-300"
                            >
                              {pmids[0]}{pmids.length > 1 ? ` +${pmids.length - 1}` : ''}
                            </a>
                          ) : (
                            <span className="font-mono">{pmids[0]}</span>
                          )}
                        </>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-2 py-2.5 align-top">
                    <div className="flex max-w-[160px] flex-wrap gap-1">
                      {candidate.database_family_guess.map((item) => (
                        <span key={item} className="rounded-md bg-muted/80 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {item}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-2.5 align-top text-[13px] text-muted-foreground">{VARIABLE_TYPE_LABELS[candidate.variable_type_guess]}</td>
                  <td className="px-2 py-2.5 align-top">
                    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium', MATCH_STATUS_STYLES[candidate.match_status])}>
                      {MATCH_STATUS_LABELS[candidate.match_status]}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 align-top">
                    <div className="inline-flex items-center gap-1.5">
                      <span className="w-7 text-[12px] font-semibold tabular-nums text-foreground">{candidate.confidence_score.toFixed(2)}</span>
                      <span className="inline-block h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-muted">
                        <span
                          className={cn('block h-full rounded-full', confidenceColor(candidate.confidence_score))}
                          style={{ width: `${Math.round(candidate.confidence_score * 100)}%` }}
                        />
                      </span>
                    </div>
                  </td>
                  <td className="w-px whitespace-nowrap border-l border-border/50 px-1 py-2 align-middle">
                    <div
                      className="inline-flex flex-nowrap items-center gap-0.5"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 rounded-md border-white/40 bg-white/60 px-1.5 text-[11px] font-medium text-slate-900 shadow-sm backdrop-blur-md hover:bg-white/75 dark:border-white/10 dark:bg-white/10 dark:text-slate-50 dark:hover:bg-white/20 whitespace-nowrap"
                        onClick={() => onAddToPool(candidate)}
                      >
                        加入候选池
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 rounded-md border-white/40 bg-white/40 px-1.5 text-[11px] font-medium shadow-sm backdrop-blur-md hover:bg-white/60 dark:border-white/10 dark:bg-white/10 dark:hover:bg-white/20 whitespace-nowrap"
                        onClick={() => onMarkAmbiguous(candidate, ambiguityNote)}
                      >
                        歧义
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 rounded-md border-rose-200/70 bg-white/40 px-1.5 text-[11px] font-medium text-rose-800 shadow-sm backdrop-blur-md hover:bg-rose-50/80 dark:border-rose-900/50 dark:bg-white/10 dark:text-rose-200 dark:hover:bg-rose-950/40 whitespace-nowrap"
                        onClick={() => onIgnore(candidate)}
                      >
                        忽略
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {visibleCandidates.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">当前筛选条件下暂无候选变量。</div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <span>共 {totalCount} 条</span>
          <select
            className="h-8 rounded-lg border border-input bg-background px-2 text-xs"
            value={pageSize}
            onChange={(event) => {
              onPageSizeChange(Number(event.target.value));
              onPageChange(1);
            }}
          >
            <option value={10}>每页 10 条</option>
            <option value={20}>每页 20 条</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg px-2" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs tabular-nums">{page} / {totalPages}</span>
          <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg px-2" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </section>
  );
}
