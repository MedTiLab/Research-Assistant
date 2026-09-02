import { GitMerge, Heart, Star } from 'lucide-react';
import { useMemo } from 'react';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import type { PubMedCandidateEvidence, PubMedVariableCandidate } from './types';
import { findRelatedCandidates } from './candidateRelations';
import {
  formatCandidateDateTime,
  MATCH_STATUS_LABELS,
  MATCH_STATUS_STYLES,
  normalizeDisplayText,
  VARIABLE_TYPE_LABELS,
} from './utils';

type Props = {
  candidate: PubMedVariableCandidate | null;
  allCandidates: PubMedVariableCandidate[];
  isFavorite: boolean;
  mergeTargetId: string;
  mergeTargets: Array<{ id: string; label: string }>;
  onMergeTargetChange: (value: string) => void;
  onToggleFavorite: (candidate: PubMedVariableCandidate) => void;
  onMerge: (candidate: PubMedVariableCandidate, variableId: string) => void;
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2 text-[13px] leading-5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium text-foreground">{value}</dd>
    </div>
  );
}

const DEFINITION_CUE_PATTERN = /\b(calculated|computed|derived|formula|equals?|(?:defined|measured|estimated|assessed|quantified|obtained|expressed|scored)\s+(?:as|by|from|using|with))\b/i;

function getPubMedUrl(pmid: string) {
  return /^\d+$/.test(pmid) ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : undefined;
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function getCandidateEnglishName(candidate: PubMedVariableCandidate) {
  return normalizeDisplayText(candidate.display_name_en_guess || candidate.canonical_name_guess || candidate.raw_name);
}

function shouldShowRawName(candidate: PubMedVariableCandidate) {
  return Boolean(candidate.raw_name?.trim())
    && normalizeName(candidate.raw_name) !== normalizeName(getCandidateEnglishName(candidate));
}

function extractionStageLabel(stage: PubMedVariableCandidate['extraction_stage']) {
  if (stage === 'abstract_verified') return '摘要已验证';
  if (stage === 'extraction_failed') return '抽取失败/待重试';
  if (stage === 'title_screen') return '题名发现';
  return '题名发现 · 规则预抽取';
}

function candidateEvidenceArticles(candidate: PubMedVariableCandidate): PubMedCandidateEvidence[] {
  if (candidate.evidence_articles?.length) return candidate.evidence_articles;
  return [{
    pmid: candidate.pmid,
    title: candidate.title,
    abstract: candidate.abstract,
    journal: candidate.journal,
    publication_year: candidate.publication_year,
    publication_date: candidate.publication_date,
    evidence_sentence: candidate.evidence_sentence,
    confidence_score: candidate.confidence_score,
    database_family_guess: candidate.database_family_guess,
    extraction_stage: candidate.extraction_stage || 'rule_based',
    evidence_level: candidate.evidence_level || 'title_only',
  }];
}

export default function PubMedCandidateDetailPanel({
  candidate,
  allCandidates,
  isFavorite,
  mergeTargetId,
  mergeTargets,
  onMergeTargetChange,
  onToggleFavorite,
  onMerge,
}: Props) {
  const related = useMemo(
    () => (candidate ? findRelatedCandidates(candidate, allCandidates) : []),
    [candidate, allCandidates],
  );

  if (!candidate) {
    return (
      <aside className="rounded-2xl border border-border/60 bg-card/80 p-5 text-sm text-muted-foreground shadow-sm dark:bg-slate-950/45">
        请选择一条候选变量查看详情。
      </aside>
    );
  }

  const englishName = getCandidateEnglishName(candidate);
  const evidenceArticles = candidateEvidenceArticles(candidate);
  const formulaText = normalizeDisplayText(candidate.formula_text || '');
  const definitionEvidence = evidenceArticles
    .map((evidence) => evidence.evidence_sentence || '')
    .find((sentence) => DEFINITION_CUE_PATTERN.test(sentence)) || '';

  return (
    <aside className="rounded-2xl border border-border/60 bg-card/80 shadow-sm dark:bg-slate-950/45">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold tracking-tight text-foreground">{englishName}</h3>
            <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium', MATCH_STATUS_STYLES[candidate.match_status])}>
              {MATCH_STATUS_LABELS[candidate.match_status]}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{normalizeDisplayText(candidate.display_name_zh_guess)}</p>
        </div>

        <Button type="button" variant={isFavorite ? 'secondary' : 'outline'} size="sm" className="h-8 rounded-lg px-2.5" onClick={() => onToggleFavorite(candidate)}>
          {isFavorite ? <Star className="h-4 w-4 fill-current" /> : <Heart className="h-4 w-4" />}
          收藏
        </Button>
      </div>

      <div className="space-y-4 border-t border-border/50 px-4 py-4 sm:px-5">
        <section className="rounded-xl border border-border/50 bg-background/65 px-3 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/75">基本信息</p>
          <dl className="mt-3 space-y-2">
            <InfoRow label="英文名" value={englishName} />
            {shouldShowRawName(candidate) ? (
              <InfoRow label="原文缩写" value={candidate.raw_name} />
            ) : null}
            <InfoRow label="猜测类型" value={VARIABLE_TYPE_LABELS[candidate.variable_type_guess]} />
            <InfoRow label="数据库家族" value={candidate.database_family_guess.map(normalizeDisplayText).filter(Boolean).join(', ') || '未识别'} />
            <InfoRow label="临床领域" value={candidate.clinical_domain_guess.map(normalizeDisplayText).filter(Boolean).join('、') || '未识别'} />
            <InfoRow label="发现时间" value={formatCandidateDateTime(candidate.created_at)} />
            <InfoRow label="匹配状态" value={MATCH_STATUS_LABELS[candidate.match_status]} />
            <InfoRow label="证据层级" value={`${extractionStageLabel(candidate.extraction_stage)} · ${evidenceArticles.length} 篇文献`} />
          </dl>
        </section>

        <section className="rounded-xl border border-border/50 bg-background/65 px-3 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/75">公式 / 定义</p>
          {formulaText ? (
            <>
              <p className="mt-3 rounded-lg bg-muted/40 px-3 py-2 font-mono text-[13px] leading-6 text-foreground">
                {formulaText}
              </p>
              <p className="mt-2 text-[12px] text-muted-foreground">摘自文献原文，未经改写；入库前请人工核对。</p>
            </>
          ) : definitionEvidence ? (
            <>
              <p className="mt-3 text-[13px] leading-6 text-foreground">
                “{normalizeDisplayText(definitionEvidence)}”
              </p>
              <p className="mt-2 text-[12px] text-muted-foreground">
                文献未给出可直接复用的计算式，这是最接近定义的一句原文。
              </p>
            </>
          ) : (
            <p className="mt-3 text-[13px] leading-6 text-muted-foreground">
              本轮证据未给出该指标的计算式或定义句。可先「加入候选池」，等后续文献补齐公式后再正式入库。
            </p>
          )}
        </section>

        <section className="rounded-xl border border-border/50 bg-background/65 px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/75">文献证据</p>
            <span className="text-[11px] text-muted-foreground">共 {evidenceArticles.length} 篇</span>
          </div>
          <div className="mt-3 space-y-3">
            {evidenceArticles.map((evidence, index) => (
              <article key={`${evidence.pmid}-${index}`} className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    证据 {index + 1} · {extractionStageLabel(evidence.extraction_stage)} · 置信度 {evidence.confidence_score.toFixed(2)}
                  </span>
                  {getPubMedUrl(evidence.pmid) ? (
                    <a
                      href={getPubMedUrl(evidence.pmid)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-800 underline-offset-2 hover:underline dark:bg-slate-950/30 dark:text-slate-200"
                    >
                      PMID: {evidence.pmid}
                    </a>
                  ) : (
                    <span className="font-mono text-[11px] text-muted-foreground">PMID: {evidence.pmid}</span>
                  )}
                </div>
                <blockquote className="mt-2 text-[13px] leading-6 text-foreground">
                  “{normalizeDisplayText(evidence.evidence_sentence || evidence.title)}”
                </blockquote>
              </article>
            ))}
          </div>
          {candidate.evidence_sentence_zh ? (
            <p className="mt-2 text-[13px] leading-6 text-muted-foreground">{normalizeDisplayText(candidate.evidence_sentence_zh)}</p>
          ) : null}
        </section>

        <section className="rounded-xl border border-border/50 bg-background/65 px-3 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/75">系统建议</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {candidate.role_guess.map((item) => (
              <span key={item} className="rounded-full border border-border/70 bg-muted/60 px-2.5 py-1 text-[11px] font-medium text-foreground dark:bg-card/60">
                {normalizeDisplayText(item)}
              </span>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border/50 bg-background/65 px-3 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/75">本轮相关候选</p>
          {related.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {related.map((item) => (
                <li key={item.id} className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
                  <p className="text-[13px] font-medium text-foreground">{item.name}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{item.reasons.join(' · ')}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-[13px] leading-6 text-muted-foreground">
              本轮其他候选与该指标没有共同的名称词、数据库或临床领域。
            </p>
          )}
        </section>

        <section className="rounded-xl border border-border/50 bg-background/65 px-3 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/75">合并到已有变量</p>
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            下拉列表来自「变量总览」中已经存在的变量。入池、歧义、忽略请在左侧列表操作；此处仅把证据合并到所选变量。
          </p>
          <div className="mt-3 flex gap-2">
            <select
              className="min-w-0 flex-1 rounded-xl border border-input bg-background px-2 py-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={mergeTargetId}
              onChange={(event) => onMergeTargetChange(event.target.value)}
              aria-label="选择已有变量"
              disabled={mergeTargets.length === 0}
            >
              {mergeTargets.length > 0 ? (
                mergeTargets.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))
              ) : (
                <option value="">变量总览暂无可合并变量</option>
              )}
            </select>
            <Button
              type="button"
              variant="outline"
              className="h-9 shrink-0 rounded-xl px-2.5"
              disabled={!mergeTargetId}
              onClick={() => onMerge(candidate, mergeTargetId)}
            >
              <GitMerge className="h-4 w-4" />
            </Button>
          </div>
          {mergeTargets.length === 0 ? (
            <p className="mt-2 text-[12px] leading-relaxed text-slate-700 dark:text-slate-200">
              先在左侧把一个候选加入候选池，它会进入变量总览；之后这里才能选择已有变量进行证据合并。
            </p>
          ) : null}
        </section>
      </div>
    </aside>
  );
}
