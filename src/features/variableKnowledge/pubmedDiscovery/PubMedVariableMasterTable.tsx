import {
  Check,
  Database,
  FileText,
  Layers,
  Pencil,
  RefreshCw,
  Search,
  SendHorizontal,
  Sparkles,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { cn } from '../../../lib/utils';
import type { Project } from '../../../types/app';
import type { ChatPromptDraft } from '../../../utils/chatPromptDraft';
import { api } from '../../../utils/api';
import { PUBLIC_DATABASE_CATALOG, normalizeDatabaseFamilyLabels } from '../../../../shared/publicDatabaseCatalog';
import type { PubMedVariableCandidate, VariableEvidenceArticle, VariablePubMedTrendResult, VariableType } from './types';
import { DISCOVERY_TREND_BAR_CLASS, VARIABLE_TYPE_LABELS } from './utils';
import { selectRowsForTrendBatch, TREND_BATCH_FAILURE_LIMIT } from './trendBatch';

type TrendPoint = { month: string; count: number };

type MasterRow = {
  id: string;
  name: string;
  zhName: string;
  enName: string;
  type: Exclude<VariableType, 'outcome'>;
  databases: string[];
  clinicalDomains: string[];
  evidenceCount: number;
  monthlyTrend: TrendPoint[];
  lastUpdated: string;
  noveltyLabel: string;
  trendLabel: string;
  confidenceScore: number;
  priorityScore: number;
  formulaText?: string;
  pmids: string[];
  titles: string[];
};

type QuickView = 'all' | 'warming' | 'novel' | 'needs_attention';

type RowEdit = {
  enName: string;
  zhName: string;
  articleCount: number;
  priorityScore: number;
  noveltyScore: number;
  /** 为 true 时使用手动填写的新颖性分；否则随文章数按「文献越多分越低」自动计算 */
  noveltyUserLocked?: boolean;
  reproducibilityScore: number;
  monthCounts: Record<string, number>;
  notes: string;
  trendUpdatedAt?: string;
  trendQuery?: string;
  trendSource?: 'pubmed_esearch';
  trendTotalCount?: number;
  trendError?: string;
};

type FacetOption = {
  key: string;
  label: string;
  count: number;
};

const VARIABLE_TYPE_ORDER: Array<Exclude<VariableType, 'outcome'>> = [
  'derived_index',
  'risk_score',
  'raw_field',
  'covariate',
  'stratifier',
];

const QUICK_VIEWS: Array<{ key: QuickView; label: string; icon: typeof Layers }> = [
  { key: 'all', label: '全部变量', icon: Layers },
  { key: 'warming', label: '近期升温', icon: TrendingUp },
  { key: 'novel', label: '高新颖性', icon: Sparkles },
  { key: 'needs_attention', label: '待补充评分', icon: FileText },
];

const ACCOUNT_ROW_EDITS_STATE_KEY = 'variableMasterRowEdits';
const LEGACY_ROW_EDITS_STORAGE_KEY = 'medhelp.pubmedDiscovery.variableMasterRowEdits.v1';
const DEFAULT_TREND_MONTH_COUNT = 6;
const ROW_EDITS_PERSIST_DEBOUNCE_MS = 800;
const FCVRS_CANONICAL_EN = 'Framingham Cardiovascular Risk Score (FCVRS)';
const FCVRS_CANONICAL_ZH = '弗雷明汉心血管风险评分';

function isFcvrsIdentifier(value: string | null | undefined): boolean {
  const text = String(value || '').toLowerCase();
  if (!text) return false;
  return text.includes('fcvrs') || text.includes('framingham cardiovascular risk score');
}

function repairLikelyMojibake(value: string): string {
  const bytes = Uint8Array.from(Array.from(value).map((char) => char.charCodeAt(0) & 0xff));
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
    return decoded || value;
  } catch {
    return value;
  }
}

function normalizeDisplayText(value: string | null | undefined): string {
  const text = String(value || '').replace(/\uFFFD+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const hasCjk = /[\u3400-\u9FFF]/.test(text);
  const looksLikeMojibake = /Ã.|Â.|â.|æ|å|ä|ç|é|ö|ñ/.test(text);
  if (hasCjk || !looksLikeMojibake) return text;
  const repaired = repairLikelyMojibake(text).replace(/\uFFFD+/g, ' ').replace(/\s+/g, ' ').trim();
  return repaired || text;
}

function normalizeFcvrsNames(en: string, zh: string): { en: string; zh: string } {
  if (isFcvrsIdentifier(en) || isFcvrsIdentifier(zh)) {
    return { en: FCVRS_CANONICAL_EN, zh: FCVRS_CANONICAL_ZH };
  }
  return { en, zh };
}

function createRecentTrendPoints(monthCount = DEFAULT_TREND_MONTH_COUNT, referenceDate = new Date()): TrendPoint[] {
  const months = Math.max(2, monthCount);
  const base = new Date(Date.UTC(referenceDate.getFullYear(), referenceDate.getMonth(), 1));
  return Array.from({ length: months }, (_, index) => {
    const month = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - (months - 1 - index), 1));
    return {
      month: month.toISOString().slice(0, 7),
      count: 0,
    };
  });
}

function createRowId(value: string) {
  return `variable_${value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'untitled'}`;
}

function normalizeVariableType(value: VariableType): Exclude<VariableType, 'outcome'> {
  return value === 'outcome' ? 'covariate' : value;
}

function getNoveltyLabel(evidenceCount: number) {
  if (evidenceCount <= 1) return '高新颖性';
  if (evidenceCount <= 3) return '早期升温';
  if (evidenceCount <= 8) return '成长中';
  return '成熟指标';
}

/**
 * 默认新颖性分（0–100）：文献篇数越多，分数越低（单调递减，log10 衰减）。
 * 单篇约 95+，随篇数增加持续下降，约百篇量级可至 30 分段，下限 10。
 */
function noveltyScoreFromEvidenceCount(evidenceCount: number): number {
  const n = Math.max(1, Math.floor(evidenceCount));
  const raw = 100 - 34 * Math.log10(n + 0.35);
  return Math.max(10, Math.min(99, Math.round(raw)));
}

function displayNoveltyScore(row: MasterRow, edit?: RowEdit): number {
  const articles = Math.max(1, edit?.articleCount ?? row.evidenceCount);
  const auto = noveltyScoreFromEvidenceCount(articles);
  if (edit?.noveltyUserLocked) return edit.noveltyScore;
  return auto;
}

function effectiveNoveltyScore(row: MasterRow, edits: Record<string, RowEdit>): number {
  return displayNoveltyScore(row, edits[row.id]);
}

function getTrendLabel(points: TrendPoint[]) {
  const sorted = [...points].sort((left, right) => left.month.localeCompare(right.month));
  if (sorted.length === 0 || !sorted.some((point) => point.count > 0)) return '待更新';
  if (sorted.length <= 1) return '新出现';
  const latest = sorted[sorted.length - 1]?.count || 0;
  const previous = sorted.slice(0, -1);
  const previousPeak = Math.max(0, ...previous.map((point) => point.count));
  const previousAverage = previous.reduce((sum, point) => sum + point.count, 0) / Math.max(1, previous.length);

  if (latest > 0 && previousPeak === 0) return '新出现';
  if (latest > previousPeak) return '近期升温';
  if (latest >= previousAverage) return '稳定跟踪';
  return '回落观察';
}

function isWarmingTrend(trendLabel: string) {
  return trendLabel === '近期升温' || trendLabel === '新出现';
}

/**
 * 综合评分（0–100）：趋势分 + 文献档位分 + 文献量分 + 模型置信度分。
 * 变量总览中的优先级主要依据「新颖性评分」（随篇数递减，可手动锁定）。
 */
function getPriorityScore(evidenceCount: number, trendLabel: string, noveltyLabel: string, confidenceScore: number) {
  const trendScore = trendLabel === '近期升温' || trendLabel === '新出现' ? 25 : trendLabel === '稳定跟踪' ? 14 : 6;
  const noveltyTierPoints = noveltyLabel === '高新颖性' ? 24 : noveltyLabel === '早期升温' ? 18 : noveltyLabel === '成长中' ? 10 : 5;
  const evidenceScore = Math.min(24, evidenceCount * 4);
  const confidence = Math.round(confidenceScore * 27);
  return Math.max(0, Math.min(100, evidenceScore + trendScore + noveltyTierPoints + confidence));
}

function buildReviewedRows(candidates: PubMedVariableCandidate[], evidence: VariableEvidenceArticle[]): MasterRow[] {
  const reviewed = candidates.filter((candidate) => (
    candidate.variable_type_guess !== 'outcome'
    && (
      candidate.review_status === 'accepted'
      || candidate.review_status === 'merged'
      || candidate.match_status === 'added_to_candidate_pool'
      || candidate.match_status === 'merged'
    )
  ));
  const rows = new Map<string, MasterRow>();

  reviewed.forEach((candidate) => {
    const keyRaw = normalizeDisplayText(candidate.canonical_name_guess || candidate.raw_name);
    if (isOperationalErrorText(keyRaw) || isOperationalErrorText(candidate.raw_name) || isOperationalErrorText(candidate.display_name_en_guess)) {
      return;
    }
    const normalizedNames = normalizeFcvrsNames(
      normalizeDisplayText(candidate.display_name_en_guess) || keyRaw,
      normalizeDisplayText(candidate.display_name_zh_guess) || keyRaw,
    );
    const key = isFcvrsIdentifier(keyRaw) ? FCVRS_CANONICAL_EN : keyRaw;
    const rowId = candidate.matched_variable_id || createRowId(key);
    const existing = rows.get(rowId);

    if (!existing) {
      const monthlyTrend = createRecentTrendPoints();
      const noveltyLabel = getNoveltyLabel(1);
      const trendLabel = getTrendLabel(monthlyTrend);
      rows.set(rowId, {
        id: rowId,
        name: key,
        zhName: normalizedNames.zh || key,
        enName: normalizedNames.en || key,
        type: normalizeVariableType(candidate.variable_type_guess),
        databases: normalizeDatabaseFamilyLabels(candidate.database_family_guess),
        clinicalDomains: [...new Set(candidate.clinical_domain_guess)],
        evidenceCount: 1,
        monthlyTrend,
        lastUpdated: candidate.updated_at || candidate.created_at,
        noveltyLabel,
        trendLabel,
        confidenceScore: candidate.confidence_score,
        priorityScore: getPriorityScore(1, trendLabel, noveltyLabel, candidate.confidence_score),
        formulaText: normalizeDisplayText(candidate.formula_text),
        pmids: [candidate.pmid].filter(Boolean),
        titles: [normalizeDisplayText(candidate.title)].filter(Boolean),
      });
      return;
    }

    existing.evidenceCount += 1;
    existing.databases = normalizeDatabaseFamilyLabels([...existing.databases, ...candidate.database_family_guess]);
    existing.clinicalDomains = [...new Set([...existing.clinicalDomains, ...candidate.clinical_domain_guess])];
    existing.lastUpdated = [existing.lastUpdated, candidate.updated_at || candidate.created_at].sort().slice(-1)[0] || existing.lastUpdated;
    existing.confidenceScore = Math.max(existing.confidenceScore, candidate.confidence_score);
    existing.formulaText = existing.formulaText || normalizeDisplayText(candidate.formula_text);
    existing.pmids = [...new Set([...existing.pmids, candidate.pmid].filter(Boolean))];
    existing.titles = [...new Set([...existing.titles, normalizeDisplayText(candidate.title)].filter(Boolean))].slice(0, 5);
  });

  evidence.forEach((item) => {
    const key = item.exposure_variable;
    if (!key) return;
    const rowId = item.variable_id || createRowId(key);
    const existing = rows.get(rowId);
    if (!existing) return;

    existing.evidenceCount += 1;
    existing.pmids = [...new Set([...existing.pmids, item.pmid].filter(Boolean))];
    existing.titles = [...new Set([...existing.titles, item.title].filter(Boolean))].slice(0, 5);
  });

  return Array.from(rows.values())
    .map((row) => {
      const monthlyTrend = row.monthlyTrend.sort((left, right) => left.month.localeCompare(right.month)).slice(-6);
      const noveltyLabel = getNoveltyLabel(row.evidenceCount);
      const trendLabel = getTrendLabel(monthlyTrend);
      return {
        ...row,
        monthlyTrend,
        noveltyLabel,
        trendLabel,
        priorityScore: getPriorityScore(row.evidenceCount, trendLabel, noveltyLabel, row.confidenceScore),
      };
    })
    .sort((left, right) => (
      noveltyScoreFromEvidenceCount(right.evidenceCount) - noveltyScoreFromEvidenceCount(left.evidenceCount)
      || right.lastUpdated.localeCompare(left.lastUpdated)
    ));
}

function buildFacetOptions(rows: MasterRow[], pick: (row: MasterRow) => string[]): FacetOption[] {
  const counts = new Map<string, FacetOption>();
  rows.forEach((row) => {
    pick(row).forEach((value) => {
      const label = value || '未识别';
      const existing = counts.get(label);
      if (existing) existing.count += 1;
      else counts.set(label, { key: label, label, count: 1 });
    });
  });
  return Array.from(counts.values()).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

function createDefaultEdit(row: MasterRow): RowEdit {
  const articles = Math.max(1, row.evidenceCount);
  const normalizedNames = normalizeFcvrsNames(
    normalizeDisplayText(row.enName || row.name),
    normalizeDisplayText(row.zhName),
  );
  return {
    enName: normalizedNames.en,
    zhName: normalizedNames.zh,
    articleCount: row.evidenceCount,
    priorityScore: row.priorityScore,
    noveltyScore: noveltyScoreFromEvidenceCount(articles),
    noveltyUserLocked: false,
    reproducibilityScore: row.formulaText ? 86 : 70,
    monthCounts: Object.fromEntries(row.monthlyTrend.map((point) => [point.month, point.count])),
    notes: '',
  };
}

function displayEnglishName(row: MasterRow, edit?: RowEdit): string {
  const normalized = normalizeDisplayText(edit?.enName || row.enName || row.name) || row.name;
  return normalizeFcvrsNames(normalized, '').en;
}

function displayChineseName(row: MasterRow, edit?: RowEdit): string {
  const normalized = normalizeDisplayText(edit?.zhName || row.zhName || '');
  return normalizeFcvrsNames('', normalized).zh;
}

function normalizeTrendErrorMessage(value: string | null | undefined): string {
  const message = normalizeDisplayText(value);
  if (!message) return '';
  if (/forwarding request\s+\/entrez\/eutils/i.test(message)) {
    return 'PubMed ESearch 转发失败，可能是 NCBI 临时限流或本机网络代理中断。请稍后重试。';
  }
  if (/aborted|timeout/i.test(message)) {
    return 'PubMed ESearch 请求超时，可能是 NCBI 访问慢或网络代理中断。请稍后重试。';
  }
  if (/rate|429|too many/i.test(message)) {
    return 'PubMed ESearch 请求过快，已触发 NCBI 限流。请稍后重试。';
  }
  return message;
}

function isOperationalErrorText(value: string | null | undefined): boolean {
  return /forwarding request\s+\/entrez\/eutils|\/entrez\/eutils\/esearch\.fcgi|pubmed esearch failed/i.test(String(value || ''));
}

function normalizeDbToken(value: string) {
  return value.trim().toLowerCase();
}

/** 根据资源库里的数据库家族文案，解析建议启用的 *-skill 等技能 id */
function resolveCatalogSkillNames(databaseHints: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const hint of databaseHints) {
    const h = normalizeDbToken(hint);
    if (!h || h === '未识别') continue;
    for (const item of PUBLIC_DATABASE_CATALOG) {
      const label = normalizeDbToken(item.label);
      const id = normalizeDbToken(item.id);
      const aliasHit = item.aliases.some((a) => normalizeDbToken(a) === h || h.includes(normalizeDbToken(a)) || normalizeDbToken(a).includes(h));
      if (label === h || id === h || h.includes(label) || label.includes(h) || aliasHit) {
        if (!seen.has(item.skillName)) {
          seen.add(item.skillName);
          out.push(item.skillName);
        }
        break;
      }
    }
  }
  return out;
}

function formatVariableKnowledgeChatPrompt(row: MasterRow, edit?: RowEdit): string {
  const e = edit ?? createDefaultEdit(row);
  const en = displayEnglishName(row, edit);
  const zh = e.zhName;
  const articleCount = e.articleCount;
  const noveltyShown = displayNoveltyScore(row, edit);
  const dbLine = row.databases.length ? row.databases.join('、') : '尚未在资源库中识别到具体公共数据库家族';
  const skillNames = resolveCatalogSkillNames(row.databases);
  const skillsPhrase = skillNames.length > 0
    ? `请先在对话中阅读并严格遵循与本指标数据库相匹配的技能文档（建议优先：${skillNames.map((s) => `\`${s}\``).join('、')}），查字段与抽数时遵守各 SKILL 中「仅用本地已挂载数据、勿臆造取值」等约束。`
    : '若工作区已安装与队列名称对应的 `*-skill` 技能，请先打开相应 SKILL.md 再定位变量；未匹配具体数据库时，先用 `medhelp-database-api-access` 路由；若仍无法匹配，请说明需要我补充的队列/数据版本信息。';

  const clinical = row.clinicalDomains.length ? row.clinicalDomains.join('、') : '暂无额外临床域标注';

  let text = ''
    + `我在「资源库」里选中指标「${en}」（中文常用表述：${zh}），类型为「${VARIABLE_TYPE_LABELS[row.type]}」，当前在总览中汇总的支持文献约 ${articleCount} 篇、新颖性分 ${noveltyShown}。`
    + `该指标在资源库中标注的数据库/数据家族为：${dbLine}；主题或临床域线索：${clinical}。`
    + `${skillsPhrase} `
    + '请你在上述技能与工作区规范下，帮我**复现或核实该指标在对应公共数据库/队列中的用法**：说明可能的原始字段、问卷模块或表逻辑，是否需要按文献公式派生，如何与本地索引或代码对照校验，并给出最小可执行的下一步（例如建议检索的字段关键词、需要先确认的波次/权重口径）。若存在歧义，请列出待澄清问题而不是猜测具体取值。';

  const tailBits: string[] = [];
  if (row.formulaText) tailBits.push(`文献或抽取记录中的公式/定义线索：${row.formulaText}`);
  if (row.pmids.length) tailBits.push(`可优先核对的 PMID：${row.pmids.join('、')}`);
  if (row.titles.length) tailBits.push(`代表文献题目摘录：${row.titles.slice(0, 3).join('；')}`);
  if (e.notes?.trim()) tailBits.push(`我的备注：${e.notes.trim()}`);

  if (tailBits.length > 0) {
    text += `\n\n以下为便于你对照核实的补充摘录（非结构化列表）：${tailBits.join(' ')}`;
  }

  return text;
}

function getEditedPoints(row: MasterRow, edit?: RowEdit): TrendPoint[] {
  const byMonth = new Map<string, number>();
  const basePoints = row.monthlyTrend.length > 0 ? row.monthlyTrend : createRecentTrendPoints();
  basePoints.forEach((point) => {
    byMonth.set(point.month, Math.max(0, Number(point.count) || 0));
  });

  if (edit) {
    Object.entries(edit.monthCounts || {}).forEach(([month, count]) => {
      byMonth.set(month, Math.max(0, Number(count) || 0));
    });
  }

  return Array.from(byMonth.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-DEFAULT_TREND_MONTH_COUNT)
    .map(([month, count]) => ({ month, count }));
}

function getEffectiveTrendLabel(row: MasterRow, edit?: RowEdit) {
  return getTrendLabel(getEditedPoints(row, edit));
}

function normalizeRowEditsPayload(value: unknown): Record<string, RowEdit> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, RowEdit>;
  return Object.fromEntries(
    Object.entries(source).map(([key, row]) => {
      const safeRow = row || ({} as RowEdit);
      return [
        key,
        (() => {
          const normalizedNames = normalizeFcvrsNames(
            normalizeDisplayText(safeRow.enName),
            normalizeDisplayText(safeRow.zhName),
          );
          return {
            ...safeRow,
            enName: normalizedNames.en,
            zhName: normalizedNames.zh,
            notes: normalizeDisplayText(safeRow.notes),
            trendError: normalizeTrendErrorMessage(safeRow.trendError),
          };
        })(),
      ];
    }),
  );
}

function readLegacyStoredRowEdits(): Record<string, RowEdit> {
  if (typeof window === 'undefined') return {};
  try {
    return normalizeRowEditsPayload(JSON.parse(window.localStorage.getItem(LEGACY_ROW_EDITS_STORAGE_KEY) || '{}'));
  } catch {
    return {};
  }
}

function clearLegacyStoredRowEdits() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_ROW_EDITS_STORAGE_KEY);
  } catch {
    // Ignore browser storage failures; account-bound storage is authoritative.
  }
}

async function readAccountRowEdits(): Promise<Record<string, RowEdit>> {
  const response = await api.pubmedDiscovery.getState(ACCOUNT_ROW_EDITS_STATE_KEY);
  if (!response.ok) return {};
  const data = await response.json();
  return normalizeRowEditsPayload(data?.payload);
}

function persistAccountRowEdits(rowEdits: Record<string, RowEdit>) {
  void api.pubmedDiscovery.saveState(ACCOUNT_ROW_EDITS_STATE_KEY, rowEdits)
    .then((response) => {
      if (response.ok) clearLegacyStoredRowEdits();
    })
    .catch(() => {
      // In-memory edits remain available for the current session; the next edit retries persistence.
    });
}

function TrendCells({ points }: { points: TrendPoint[] }) {
  const peak = Math.max(1, ...points.map((point) => point.count));
  return (
    <div className="flex min-w-[160px] items-end gap-1.5">
      {points.map((point) => (
        <div key={point.month} className="flex w-7 flex-col items-center gap-1">
          <span className="h-4 text-[10px] font-semibold tabular-nums text-foreground/75">
            {point.count.toLocaleString()}
          </span>
          <span
            className={cn(
              'w-full rounded-md',
              point.count > 0
                ? DISCOVERY_TREND_BAR_CLASS
                : 'bg-muted',
            )}
            style={{ height: `${point.count > 0 ? Math.max(10, (point.count / peak) * 38) : 8}px` }}
            title={`${point.month}: ${point.count}`}
          />
          <span className="text-[9px] tabular-nums text-muted-foreground">{point.month.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

type MasterTableAppearance = 'default' | 'emerald';

const MASTER_TABLE_APPEARANCE: Record<MasterTableAppearance, {
  panel: string;
  table: string;
  empty: string;
  facetActive: string;
  facetIdle: string;
  icon: string;
  searchFocus: string;
  rowFocus: string;
  rowHover: string;
  rank: string;
  typeBadge: string;
  trendBox: string;
  detailPanel: string;
  detailLabel: string;
  pubmedLink: string;
  actionBtn: string;
  divide: string;
  detailBorder: string;
}> = {
  default: {
    panel: 'rounded-2xl border border-border/80 bg-card/95 p-4 shadow-sm',
    table: 'overflow-hidden rounded-2xl border border-border/80 bg-card/95 shadow-sm',
    empty: 'rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm',
    facetActive: 'bg-slate-50 text-slate-800 ring-1 ring-slate-200 dark:bg-slate-950/30 dark:text-slate-100 dark:ring-slate-900/70',
    facetIdle: 'text-muted-foreground hover:bg-muted/65 hover:text-foreground',
    icon: 'text-slate-500',
    searchFocus: 'focus:ring-slate-400/40',
    rowFocus: 'bg-slate-50/70 dark:bg-slate-950/20',
    rowHover: 'hover:bg-slate-50 dark:hover:bg-slate-900/40',
    rank: 'bg-slate-50 text-slate-950 dark:bg-slate-950/55 dark:text-slate-50',
    typeBadge: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-900/80 dark:bg-slate-950/30 dark:text-slate-200',
    trendBox: 'border-border/60 bg-background/70',
    detailPanel: 'overflow-hidden rounded-2xl border border-border/80 bg-card/95 shadow-sm',
    detailLabel: 'text-slate-500 dark:text-slate-300',
    pubmedLink: 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-50 dark:border-slate-900/70 dark:bg-slate-950/30 dark:text-slate-100 dark:hover:bg-slate-950/50',
    actionBtn: 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-50 dark:border-slate-900/60 dark:bg-slate-950/40 dark:text-slate-100 dark:hover:bg-slate-950/60',
    divide: 'divide-border/60',
    detailBorder: 'border-border/60',
  },
  emerald: {
    panel: 'rounded-2xl border border-primary/25 bg-primary/[0.06] p-4 shadow-sm',
    table: 'overflow-hidden rounded-2xl border border-primary/25 bg-primary/[0.05] shadow-sm',
    empty: 'rounded-2xl border border-primary/25 bg-primary/[0.05] p-8 text-center text-sm text-muted-foreground shadow-sm',
    facetActive: 'bg-primary/10 text-primary ring-1 ring-primary/30',
    facetIdle: 'text-muted-foreground hover:bg-primary/[0.08] hover:text-foreground',
    icon: 'text-primary/80',
    searchFocus: 'focus:ring-primary/35',
    rowFocus: 'bg-primary/[0.07]',
    rowHover: 'hover:bg-primary/[0.06]',
    rank: 'bg-primary/10 text-primary',
    typeBadge: 'border-primary/30 bg-primary/[0.08] text-primary',
    trendBox: 'border-primary/25 bg-card/55',
    detailPanel: 'overflow-hidden rounded-2xl border border-primary/25 bg-primary/[0.05] shadow-sm',
    detailLabel: 'text-primary/80',
    pubmedLink: 'border-primary/30 bg-primary/[0.08] text-primary hover:bg-primary/15',
    actionBtn: 'border-primary/30 bg-primary/[0.08] text-primary hover:bg-primary/15',
    divide: 'divide-primary/20',
    detailBorder: 'border-primary/25',
  },
};

function facetButtonClass(active: boolean, styles: typeof MASTER_TABLE_APPEARANCE.default) {
  return cn(
    'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition',
    active ? styles.facetActive : styles.facetIdle,
  );
}

export default function PubMedVariableMasterTable({
  candidates,
  evidence,
  chatTargetProject,
  onSendVariableToChat,
  onRemoveMasterVariable,
  appearance = 'default',
}: {
  candidates: PubMedVariableCandidate[];
  evidence: VariableEvidenceArticle[];
  chatTargetProject?: Project | null;
  onSendVariableToChat?: (project: Project, prompt: string | ChatPromptDraft) => void;
  onRemoveMasterVariable?: (variableId: string, displayName: string) => void;
  appearance?: MasterTableAppearance;
}) {
  const { user } = useAuth() as { user: { id?: string | number } | null };
  const styles = MASTER_TABLE_APPEARANCE[appearance];
  const rows = useMemo(() => buildReviewedRows(candidates, evidence), [candidates, evidence]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeQuickView, setActiveQuickView] = useState<QuickView>('all');
  const [activeType, setActiveType] = useState<'all' | Exclude<VariableType, 'outcome'>>('all');
  const [activeDatabase, setActiveDatabase] = useState('all');
  const [selectedRowId, setSelectedRowId] = useState('');
  const [rowEdits, setRowEdits] = useState<Record<string, RowEdit>>({});
  const [rowEditsHydrated, setRowEditsHydrated] = useState(false);
  const [detailEditing, setDetailEditing] = useState(false);
  const [trendUpdatingRowId, setTrendUpdatingRowId] = useState('');
  const [trendUpdateError, setTrendUpdateError] = useState<string | null>(null);
  const [trendBatch, setTrendBatch] = useState<{ done: number; total: number; failed: number } | null>(null);
  const trendBatchCancelRef = useRef(false);
  const rowEditsRevisionRef = useRef(0);

  useEffect(() => {
    if (!user?.id) {
      rowEditsRevisionRef.current += 1;
      setRowEdits({});
      setRowEditsHydrated(false);
      return undefined;
    }

    let cancelled = false;
    rowEditsRevisionRef.current += 1;
    const revisionAtStart = rowEditsRevisionRef.current;
    setRowEdits({});
    setRowEditsHydrated(false);

    void (async () => {
      let accountEdits: Record<string, RowEdit> = {};
      try {
        accountEdits = await readAccountRowEdits();
      } catch {
        accountEdits = {};
      }

      const legacyEdits = readLegacyStoredRowEdits();
      const accountHasEdits = Object.keys(accountEdits).length > 0;
      const legacyHasEdits = Object.keys(legacyEdits).length > 0;
      const nextEdits = accountHasEdits ? accountEdits : legacyEdits;

      if (cancelled) return;

      if (rowEditsRevisionRef.current === revisionAtStart) {
        setRowEdits(nextEdits);
        setRowEditsHydrated(true);

        if (!accountHasEdits && legacyHasEdits) {
          persistAccountRowEdits(nextEdits);
        } else if (accountHasEdits && legacyHasEdits) {
          clearLegacyStoredRowEdits();
        }
      } else {
        setRowEditsHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Every edit rewrites the whole blob server-side, so coalesce bursts. A running
  // trend batch skips persistence entirely and saves once when it settles — otherwise
  // a 50-variable run would issue 50 full-payload writes that can also land out of order.
  useEffect(() => {
    if (!user?.id || !rowEditsHydrated) return undefined;
    if (trendBatch) return undefined;
    const timer = setTimeout(() => persistAccountRowEdits(rowEdits), ROW_EDITS_PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [rowEdits, rowEditsHydrated, user?.id, trendBatch]);

  useEffect(() => {
    setDetailEditing(false);
    setTrendUpdateError(null);
  }, [selectedRowId]);

  const typeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((row) => counts.set(row.type, (counts.get(row.type) || 0) + 1));
    return VARIABLE_TYPE_ORDER
      .map((type) => ({ key: type, label: VARIABLE_TYPE_LABELS[type], count: counts.get(type) || 0 }))
      .filter((item) => item.count > 0);
  }, [rows]);

  const databaseOptions = useMemo(() => buildFacetOptions(rows, (row) => (row.databases.length ? row.databases : ['未识别'])), [rows]);

  const filteredRows = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (keyword) {
        const edit = rowEdits[row.id];
        const haystack = [
          row.name,
          row.zhName,
          row.enName,
          edit?.enName,
          edit?.zhName,
          row.databases.join(' '),
          row.clinicalDomains.join(' '),
          row.pmids.join(' '),
        ].join(' ').toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      if (activeType !== 'all' && row.type !== activeType) return false;
      if (activeDatabase !== 'all' && !row.databases.includes(activeDatabase) && !(activeDatabase === '未识别' && row.databases.length === 0)) return false;
      if (activeQuickView === 'warming' && !isWarmingTrend(getEffectiveTrendLabel(row, rowEdits[row.id]))) return false;
      if (activeQuickView === 'novel' && !(row.noveltyLabel === '高新颖性' || row.noveltyLabel === '早期升温')) return false;
      if (activeQuickView === 'needs_attention') {
        const edit = rowEdits[row.id];
        if (edit?.notes || row.formulaText || effectiveNoveltyScore(row, rowEdits) >= 70) return false;
      }
      return true;
    });
    filtered.sort((left, right) => (
      effectiveNoveltyScore(right, rowEdits) - effectiveNoveltyScore(left, rowEdits)
      || right.lastUpdated.localeCompare(left.lastUpdated)
    ));
    return filtered;
  }, [activeDatabase, activeQuickView, activeType, rowEdits, rows, searchQuery]);

  useEffect(() => {
    if (filteredRows.length === 0) {
      setSelectedRowId('');
      return;
    }
    if (!filteredRows.some((row) => row.id === selectedRowId)) {
      setSelectedRowId(filteredRows[0].id);
    }
  }, [filteredRows, selectedRowId]);

  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedRowId) || filteredRows[0] || null,
    [filteredRows, rows, selectedRowId],
  );

  /** 仅使用该变量英文名（界面主标题）在 PubMed 中检索，不用自动发现布尔式。 */
  const pubmedSearchByVariableNameUrl = useMemo(() => {
    const term = selectedRow ? displayEnglishName(selectedRow, rowEdits[selectedRow.id]) : '';
    if (!term) return null;
    return `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(term)}`;
  }, [rowEdits, selectedRow]);

  const selectedEdit = selectedRow ? rowEdits[selectedRow.id] : undefined;
  const selectedDisplay = selectedRow && selectedEdit
    ? {
      articleCount: selectedEdit.articleCount,
      priorityScore: selectedEdit.priorityScore,
      enName: displayEnglishName(selectedRow, selectedEdit),
      zhName: displayChineseName(selectedRow, selectedEdit),
    }
    : selectedRow
      ? {
        articleCount: selectedRow.evidenceCount,
        priorityScore: selectedRow.priorityScore,
        enName: displayEnglishName(selectedRow),
        zhName: displayChineseName(selectedRow),
      }
      : null;
  const isTrendUpdateRunning = Boolean(trendUpdatingRowId) || Boolean(trendBatch);
  const isUpdatingSelectedTrend = Boolean(selectedRow && trendUpdatingRowId === selectedRow.id);

  const commitRowEdits = (updater: (prev: Record<string, RowEdit>) => Record<string, RowEdit>) => {
    rowEditsRevisionRef.current += 1;
    setRowEdits(updater);
  };

  const updateSelectedEdit = (patch: Partial<RowEdit>) => {
    if (!selectedRow) return;
    commitRowEdits((prev) => {
      const current = prev[selectedRow.id] || createDefaultEdit(selectedRow);
      const merged: RowEdit = {
        ...current,
        ...patch,
        enName: patch.enName !== undefined ? normalizeDisplayText(patch.enName) : current.enName,
        zhName: patch.zhName !== undefined ? normalizeDisplayText(patch.zhName) : current.zhName,
      };
      const normalizedNames = normalizeFcvrsNames(merged.enName, merged.zhName);
      merged.enName = normalizedNames.en;
      merged.zhName = normalizedNames.zh;
      if (patch.articleCount !== undefined) {
        merged.noveltyUserLocked = false;
        merged.noveltyScore = noveltyScoreFromEvidenceCount(Math.max(1, patch.articleCount));
      }
      if (patch.noveltyScore !== undefined && patch.articleCount === undefined) {
        merged.noveltyUserLocked = true;
      }
      return {
        ...prev,
        [selectedRow.id]: merged,
      };
    });
  };

  /**
   * Refresh one row's PubMed trend. Returns true on success so the batch runner can
   * count failures; per-row errors are recorded on the row itself either way.
   */
  const refreshRowTrend = async (rowForUpdate: MasterRow) => {
    try {
      const variableName = displayEnglishName(rowForUpdate, rowEdits[rowForUpdate.id]);
      const response = await api.pubmedDiscovery.trend({
        variableName,
        months: DEFAULT_TREND_MONTH_COUNT,
      });
      const data = await response.json().catch(() => ({})) as Partial<VariablePubMedTrendResult> & { error?: string };
      if (!response.ok) {
        throw new Error(data?.error || 'PubMed 趋势更新失败');
      }

      const monthCounts = Object.fromEntries(
        (Array.isArray(data.points) ? data.points : []).map((point) => [
          point.month,
          Math.max(0, Number(point.count) || 0),
        ]),
      );
      const trendTotalCount = Number(data.totalCount ?? Object.values(monthCounts).reduce((sum, count) => sum + Number(count || 0), 0));

      commitRowEdits((prev) => {
        const current = prev[rowForUpdate.id] || createDefaultEdit(rowForUpdate);
        return {
          ...prev,
          [rowForUpdate.id]: {
            ...current,
            monthCounts: {
              ...(current.monthCounts || {}),
              ...monthCounts,
            },
            trendUpdatedAt: data.searchedAt || new Date().toISOString(),
            trendQuery: data.query || variableName,
            trendSource: 'pubmed_esearch',
            trendTotalCount,
            trendError: undefined,
          },
        };
      });
      return true;
    } catch (error) {
      const message = normalizeTrendErrorMessage(error instanceof Error ? error.message : 'PubMed 趋势更新失败');
      setTrendUpdateError(message);
      commitRowEdits((prev) => {
        const current = prev[rowForUpdate.id] || createDefaultEdit(rowForUpdate);
        return {
          ...prev,
          [rowForUpdate.id]: {
            ...current,
            trendError: message,
          },
        };
      });
      return false;
    }
  };

  const handleUpdateSelectedTrend = async () => {
    if (!selectedRow || trendUpdatingRowId || trendBatch) return;
    setTrendUpdatingRowId(selectedRow.id);
    setTrendUpdateError(null);
    try {
      await refreshRowTrend(selectedRow);
    } finally {
      setTrendUpdatingRowId('');
    }
  };

  const handleCancelTrendBatch = () => {
    trendBatchCancelRef.current = true;
  };

  const handleUpdateAllTrends = async (force = false) => {
    if (trendBatch || trendUpdatingRowId) return;

    const pending = selectRowsForTrendBatch(
      rows.map((row) => ({
        id: row.id,
        hasTrendData: row.monthlyTrend.some((point) => point.count > 0),
        lastUpdatedAt: rowEdits[row.id]?.trendUpdatedAt,
      })),
      force,
    );
    const queue = pending
      .map((item) => rows.find((row) => row.id === item.id))
      .filter((row): row is MasterRow => Boolean(row));

    if (queue.length === 0) {
      setTrendUpdateError('所有变量的趋势都在 24 小时内更新过；如需强制重算请按住 Shift 点击。');
      return;
    }

    trendBatchCancelRef.current = false;
    setTrendUpdateError(null);
    setTrendBatch({ done: 0, total: queue.length, failed: 0 });

    let failed = 0;
    let consecutiveFailures = 0;

    for (const [index, row] of queue.entries()) {
      if (trendBatchCancelRef.current) break;
      setTrendUpdatingRowId(row.id);
      const ok = await refreshRowTrend(row);
      setTrendUpdatingRowId('');

      if (ok) {
        consecutiveFailures = 0;
      } else {
        failed += 1;
        consecutiveFailures += 1;
      }
      setTrendBatch({ done: index + 1, total: queue.length, failed });

      if (consecutiveFailures >= TREND_BATCH_FAILURE_LIMIT) {
        setTrendUpdateError(`连续 ${TREND_BATCH_FAILURE_LIMIT} 个变量更新失败，已停止批量更新以避免继续请求 PubMed。请稍后重试。`);
        break;
      }
    }

    setTrendBatch(null);
    trendBatchCancelRef.current = false;
  };

  const handleRemoveMasterRow = (row: MasterRow) => {
    if (!onRemoveMasterVariable) return;
    const displayName = displayEnglishName(row, rowEdits[row.id]);
    if (!window.confirm(`确定删除「${displayName}」？相关条目与证据将从变量总览中清除。`)) return;
    onRemoveMasterVariable(row.id, displayName);
    commitRowEdits((prev) => {
      if (!prev[row.id]) return prev;
      const next = { ...prev };
      delete next[row.id];
      return next;
    });
    if (selectedRowId === row.id) setSelectedRowId('');
  };

  const handleSendVariableToChat = () => {
    if (!selectedRow || !chatTargetProject || !onSendVariableToChat) return;
    const prompt = formatVariableKnowledgeChatPrompt(selectedRow, selectedEdit);
    onSendVariableToChat(chatTargetProject, prompt);
  };

  const detailInputClass = () => cn(
    'mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2',
    styles.searchFocus,
    !detailEditing && 'pointer-events-none cursor-default border-transparent bg-muted/40 shadow-none focus:ring-0 dark:bg-muted/30',
  );

  return (
    <section className="space-y-4">
      <div className="grid items-start gap-4 xl:grid-cols-[280px_minmax(0,1fr)_minmax(360px,420px)] 2xl:grid-cols-[280px_minmax(0,1fr)_420px]">
        <aside className="space-y-4 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:self-start xl:overflow-y-auto xl:pr-1">
          <div className={styles.panel}>
            <div className="relative">
              <Search className={cn('pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground', appearance === 'emerald' && 'text-primary/70')} />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索变量、数据库或 PMID..."
                className={cn(
                  'w-full rounded-xl border border-border bg-background py-2.5 pl-9 pr-3 text-sm text-foreground outline-none transition',
                  styles.searchFocus,
                  'focus:ring-2',
                )}
              />
            </div>
          </div>

          <div className={styles.panel}>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <TrendingUp className={cn('h-4 w-4', styles.icon)} />
              PubMed 热度趋势
            </div>
            {trendBatch ? (
              <>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.round((trendBatch.done / Math.max(1, trendBatch.total)) * 100)}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  已更新 {trendBatch.done}/{trendBatch.total}
                  {trendBatch.failed > 0 ? ` · 失败 ${trendBatch.failed}` : ''}
                </p>
                <button
                  type="button"
                  onClick={handleCancelTrendBatch}
                  className="mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted"
                >
                  停止更新
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={(event) => { void handleUpdateAllTrends(event.shiftKey); }}
                  disabled={isTrendUpdateRunning || rows.length === 0}
                  className={cn(
                    'flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted',
                    (isTrendUpdateRunning || rows.length === 0) && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  批量更新全部趋势
                </button>
                <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                  逐个查询 PubMed，跳过 24 小时内更新过的变量；按住 Shift 点击可强制全部重算。
                </p>
              </>
            )}
            {trendUpdateError ? (
              <p className="mt-2 text-[11px] leading-5 text-rose-700 dark:text-rose-300">{trendUpdateError}</p>
            ) : null}
          </div>

          <div className={styles.panel}>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Layers className={cn('h-4 w-4', styles.icon)} />
              分类视图
            </div>
            <div className="space-y-2">
              {QUICK_VIEWS.map((item) => {
                const Icon = item.icon;
                const count = item.key === 'all'
                  ? rows.length
                  : item.key === 'warming'
                    ? rows.filter((row) => isWarmingTrend(getEffectiveTrendLabel(row, rowEdits[row.id]))).length
                    : item.key === 'novel'
                      ? rows.filter((row) => row.noveltyLabel === '高新颖性' || row.noveltyLabel === '早期升温').length
                      : rows.filter((row) => !row.formulaText || effectiveNoveltyScore(row, rowEdits) < 70).length;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActiveQuickView(item.key)}
                    className={facetButtonClass(activeQuickView === item.key, styles)}
                  >
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{count}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.panel}>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Sparkles className={cn('h-4 w-4', styles.icon)} />
              变量类型
            </div>
            <div className="max-h-[280px] space-y-2 overflow-y-auto [scrollbar-gutter:stable] scrollbar-thin">
              <button type="button" onClick={() => setActiveType('all')} className={facetButtonClass(activeType === 'all', styles)}>
                <span>全部类型</span>
                <span className="text-xs text-muted-foreground">{rows.length}</span>
              </button>
              {typeOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setActiveType(option.key)}
                  className={facetButtonClass(activeType === option.key, styles)}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  <span className="text-xs text-muted-foreground">{option.count}</span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.panel}>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Database className={cn('h-4 w-4', styles.icon)} />
              数据库家族
            </div>
            <div className="max-h-[400px] space-y-2 overflow-y-auto [scrollbar-gutter:stable] scrollbar-thin">
              <button type="button" onClick={() => setActiveDatabase('all')} className={facetButtonClass(activeDatabase === 'all', styles)}>
                <span>全部数据库</span>
                <span className="text-xs text-muted-foreground">{rows.length}</span>
              </button>
              {databaseOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setActiveDatabase(option.key)}
                  className={facetButtonClass(activeDatabase === option.key, styles)}
                >
                  <span className="min-w-0 truncate">{option.label}</span>
                  <span className="text-xs text-muted-foreground">{option.count}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="min-w-0 space-y-4">
          {filteredRows.length === 0 ? (
            <div className={styles.empty}>
              暂无变量。自动发现默认保持空白；运行 PubMed 搜索并在候选表中点击“加入候选池”后，这里会开始长期汇总。
            </div>
          ) : (
            <div className={styles.table}>
              <div className={cn('divide-y', styles.divide)}>
                {filteredRows.map((row, rowIndex) => {
                  const isFocused = selectedRow?.id === row.id;
                  const edit = rowEdits[row.id];
                  const enName = displayEnglishName(row, edit);
                  const points = getEditedPoints(row, edit);
                  const trendLabel = getTrendLabel(points);
                  const priorityRank = rowIndex + 1;
                  const noveltyVal = effectiveNoveltyScore(row, rowEdits);
                  return (
                    <button
                      key={row.id}
                      type="button"
                      aria-label={`${enName}，新颖性优先级 ${priorityRank}，评分 ${noveltyVal}`}
                      onClick={() => setSelectedRowId(row.id)}
                      title={`新颖性优先级 ${priorityRank}（评分 ${noveltyVal}）`}
                      className={cn(
                        'grid w-full gap-4 px-4 py-4 text-left transition sm:grid-cols-[minmax(0,1fr)_minmax(180px,220px)]',
                        isFocused ? styles.rowFocus : styles.rowHover,
                      )}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              'inline-flex h-7 min-w-[1.75rem] shrink-0 items-center justify-center rounded-lg px-1.5 text-[11px] font-bold tabular-nums',
                              styles.rank,
                            )}
                            aria-hidden
                          >
                            {priorityRank}
                          </span>
                          <h4 className="break-words text-sm font-semibold text-foreground">{enName}</h4>
                          <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', styles.typeBadge)}>
                            {VARIABLE_TYPE_LABELS[row.type]}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-foreground">{edit?.zhName || row.zhName}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(row.databases.length ? row.databases : ['未识别']).slice(0, 4).map((database) => (
                            <span key={database} className="rounded-md bg-muted/75 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              {database}
                            </span>
                          ))}
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                          <span>文章 {(edit?.articleCount ?? row.evidenceCount).toLocaleString()} 篇</span>
                          <span>新颖性 {noveltyVal.toLocaleString()} · 优先 {priorityRank}</span>
                          <span>{row.noveltyLabel}</span>
                        </div>
                      </div>
                      <div className={cn('rounded-xl border px-3 py-2 sm:self-end', styles.trendBox)}>
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                          <span className="font-medium text-foreground/75">PubMed 近 6 个月趋势</span>
                          <span>{trendLabel}</span>
                        </div>
                        <TrendCells points={points} />
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{edit?.trendUpdatedAt ? `更新于 ${new Date(edit.trendUpdatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}` : '未更新'}</span>
                          {typeof edit?.trendTotalCount === 'number' ? (
                            <span>近 {DEFAULT_TREND_MONTH_COUNT} 月 {edit.trendTotalCount.toLocaleString()} 篇</span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <aside className="min-w-0 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:self-start xl:overflow-y-auto xl:pr-1">
          <div className={styles.detailPanel}>
            {!selectedRow || !selectedDisplay ? (
              <div className="p-6 text-sm text-muted-foreground">
                选择一个变量后，可点击「编辑」修改名称、文章数量、评分和备注；点击「更新趋势」后会按 PubMed 近 6 个自然月重新计算趋势。
              </div>
            ) : (
              <>
                <div className={cn('border-b p-5', styles.detailBorder)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={cn('text-xs font-medium uppercase tracking-[0.24em]', styles.detailLabel)}>
                          变量详情
                        </p>
                        {pubmedSearchByVariableNameUrl ? (
                          <a
                            href={pubmedSearchByVariableNameUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`在 PubMed 中搜索「${selectedDisplay.enName}」`}
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold transition',
                              styles.pubmedLink,
                            )}
                          >
                            <Search className="h-3 w-3 shrink-0" aria-hidden />
                            PubMed 文献检索
                          </a>
                        ) : null}
                      </div>
                      <h3 className="mt-2 break-all text-xl font-semibold text-foreground">{selectedDisplay.enName}</h3>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {VARIABLE_TYPE_LABELS[selectedRow.type]} · {selectedRow.databases.length ? selectedRow.databases.join(' / ') : '未识别数据库'}
                      </p>
                    </div>
                    <div className="grid w-full shrink-0 grid-cols-1 gap-2 sm:w-36">
                      <button
                        type="button"
                        onClick={() => setDetailEditing((previous) => !previous)}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium text-foreground transition hover:bg-muted/80"
                      >
                        {detailEditing ? (
                          <>
                            <Check className="h-3.5 w-3.5" aria-hidden />
                            完成编辑
                          </>
                        ) : (
                          <>
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                            编辑
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={isTrendUpdateRunning}
                        onClick={handleUpdateSelectedTrend}
                        className={cn(
                          'inline-flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition disabled:pointer-events-none disabled:opacity-60',
                          styles.actionBtn,
                        )}
                      >
                        <RefreshCw className={cn('h-3.5 w-3.5', isUpdatingSelectedTrend && 'animate-spin')} aria-hidden />
                        {isUpdatingSelectedTrend ? '更新中' : '更新趋势'}
                      </button>
                      <button
                        type="button"
                        disabled={!chatTargetProject || !onSendVariableToChat}
                        title={!chatTargetProject ? '请先在侧栏选择工作区项目' : `将「${selectedDisplay.enName}」发送到项目「${chatTargetProject.name}」的聊天输入框`}
                        onClick={handleSendVariableToChat}
                        className={cn(
                          'inline-flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition disabled:pointer-events-none disabled:opacity-50',
                          styles.actionBtn,
                        )}
                      >
                        <SendHorizontal className="h-3.5 w-3.5" aria-hidden />
                        发送到聊天
                      </button>
                      {onRemoveMasterVariable ? (
                        <button
                          type="button"
                          aria-label={`删除 ${selectedDisplay.enName}`}
                          title={`从变量总览删除「${selectedDisplay.enName}」`}
                          onClick={() => handleRemoveMasterRow(selectedRow)}
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-300/70 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800 transition hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/35 dark:text-rose-100 dark:hover:bg-rose-950/55"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          删除
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {trendUpdateError || selectedEdit?.trendError ? (
                    <p className="mt-3 text-right text-[11px] leading-5 text-destructive">
                      {normalizeTrendErrorMessage(trendUpdateError || selectedEdit?.trendError)}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-5 p-5">
                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">英文名称</span>
                    <input
                      type="text"
                      readOnly={!detailEditing}
                      value={selectedDisplay.enName}
                      onChange={(event) => updateSelectedEdit({ enName: event.target.value })}
                      className={detailInputClass()}
                    />
                  </label>

                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">中文名称</span>
                    <input
                      type="text"
                      readOnly={!detailEditing}
                      value={selectedDisplay.zhName}
                      onChange={(event) => updateSelectedEdit({ zhName: event.target.value })}
                      className={detailInputClass()}
                    />
                  </label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-medium text-muted-foreground">文章数量</span>
                      <input
                        type="number"
                        readOnly={!detailEditing}
                        min={0}
                        value={selectedDisplay.articleCount}
                        onChange={(event) => updateSelectedEdit({ articleCount: Math.max(0, Number(event.target.value) || 0) })}
                        className={detailInputClass()}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-muted-foreground">新颖性评分</span>
                      <input
                        type="number"
                        readOnly={!detailEditing}
                        min={0}
                        max={100}
                        value={displayNoveltyScore(selectedRow, selectedEdit)}
                        onChange={(event) => updateSelectedEdit({ noveltyScore: Math.max(0, Math.min(100, Number(event.target.value) || 0)) })}
                        className={detailInputClass()}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-muted-foreground">可复现评分</span>
                      <input
                        type="number"
                        readOnly={!detailEditing}
                        min={0}
                        max={100}
                        value={selectedEdit?.reproducibilityScore ?? createDefaultEdit(selectedRow).reproducibilityScore}
                        onChange={(event) => updateSelectedEdit({ reproducibilityScore: Math.max(0, Math.min(100, Number(event.target.value) || 0)) })}
                        className={detailInputClass()}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-muted-foreground">综合评分</span>
                      <input
                        type="number"
                        readOnly={!detailEditing}
                        min={0}
                        max={100}
                        value={selectedDisplay.priorityScore}
                        onChange={(event) => updateSelectedEdit({ priorityScore: Math.max(0, Math.min(100, Number(event.target.value) || 0)) })}
                        className={detailInputClass()}
                      />
                    </label>
                  </div>

                  <div className="grid gap-3">
                    <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                      <p className="text-xs font-medium text-muted-foreground">判断标签</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {[selectedRow.noveltyLabel, `置信度 ${Math.round(selectedRow.confidenceScore * 100)}%`].map((item) => (
                          <span key={item} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:border-slate-900/80 dark:bg-slate-950/30 dark:text-slate-200">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>

                    {selectedRow.formulaText ? (
                      <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                        <p className="text-xs font-medium text-muted-foreground">公式/定义</p>
                        <p className="mt-2 text-sm leading-6 text-foreground">{selectedRow.formulaText}</p>
                      </div>
                    ) : null}

                    {selectedRow.pmids.length ? (
                      <div className="rounded-xl border border-border/70 bg-background/70 p-3">
                        <p className="text-xs font-medium text-muted-foreground">证据 PMID</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {selectedRow.pmids.slice(0, 8).map((pmid) => (
                            <a
                              key={pmid}
                              href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}/`}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-md bg-muted/75 px-2 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-950/30"
                            >
                              {pmid}
                            </a>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <label className="block">
                    <span className="text-xs font-medium text-muted-foreground">人工备注</span>
                    <textarea
                      readOnly={!detailEditing}
                      value={selectedEdit?.notes || ''}
                      onChange={(event) => updateSelectedEdit({ notes: event.target.value })}
                      rows={4}
                      placeholder="记录是否适合纳入变量库、后续检索方向或排除原因。"
                      className={cn(detailInputClass(), 'resize-none')}
                    />
                  </label>
                </div>
              </>
            )}
          </div>

        </aside>
      </div>
    </section>
  );
}
