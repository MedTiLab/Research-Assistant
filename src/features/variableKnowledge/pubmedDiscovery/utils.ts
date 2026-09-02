import type {
  DiscoveryFrequency,
  PubMedVariableCandidate,
  VariableCandidateMatchStatus,
  VariableType,
} from './types';
import { normalizeDatabaseFamilyLabels } from '../../../../shared/publicDatabaseCatalog';

export const MATCH_STATUS_LABELS: Record<VariableCandidateMatchStatus, string> = {
  new: '新候选',
  matched: '已匹配',
  ambiguous: '缩写歧义',
  manual_review: '需人工确认',
  ignored: '已忽略',
  added_to_candidate_pool: '已加入候选池',
  merged: '已合并',
};

export const MATCH_STATUS_STYLES: Record<VariableCandidateMatchStatus, string> = {
  new: 'border-orange-200/80 bg-orange-50/90 text-orange-800 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-200',
  matched: 'border-slate-200/80 bg-slate-50/90 text-slate-800 dark:border-slate-900/50 dark:bg-slate-950/30 dark:text-slate-200',
  ambiguous: 'border-slate-200/80 bg-slate-50/90 text-slate-800 dark:border-slate-900/60 dark:bg-slate-950/35 dark:text-slate-100',
  manual_review: 'border-rose-200/80 bg-rose-50/90 text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200',
  ignored: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300',
  added_to_candidate_pool: 'border-slate-200/80 bg-slate-50/90 text-slate-800 dark:border-slate-900/50 dark:bg-slate-950/30 dark:text-slate-200',
  merged: 'border-slate-200/80 bg-slate-50/90 text-slate-800 dark:border-slate-900/50 dark:bg-slate-950/30 dark:text-slate-200',
};

export const VARIABLE_TYPE_LABELS: Record<VariableType, string> = {
  raw_field: '原始字段',
  derived_index: '派生指标',
  risk_score: '风险评分',
  outcome: '结局变量',
  covariate: '协变量',
  stratifier: '分层变量',
};

export const FREQUENCY_LABELS: Record<DiscoveryFrequency, string> = {
  daily: '每日',
  weekly: '每周',
};

function repairLikelyMojibake(value: string): string {
  const bytes = Uint8Array.from(Array.from(value).map((char) => char.charCodeAt(0) & 0xff));
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
    return decoded || value;
  } catch {
    return value;
  }
}

export function normalizeDisplayText(value: string | null | undefined): string {
  const text = String(value || '').replace(/\uFFFD+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const hasCjk = /[\u3400-\u9FFF]/.test(text);
  const looksLikeMojibake = /Ã.|Â.|â.|æ|å|ä|ç|é|ö|ñ|�/.test(text);
  if (hasCjk || !looksLikeMojibake) return text;
  const repaired = repairLikelyMojibake(text).replace(/\uFFFD+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!repaired) return '';
  const repairedHasCjk = /[\u3400-\u9FFF]/.test(repaired);
  if (!repairedHasCjk && /Ã.|Â.|â.|æ|å|ä|ç|é|ö|ñ|�/.test(repaired)) return '';
  return repaired;
}

export function formatCandidateDateTime(value?: string) {
  if (!value) return '未记录';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  const date = parsed.toISOString().slice(0, 10);
  const time = parsed.toTimeString().slice(0, 5);
  return `${date} ${time}`;
}

export function formatTrendLabel(date: string) {
  const parts = date.split('-');
  return parts.length === 3 ? `${parts[1]}-${parts[2]}` : date;
}

export const DISCOVERY_TREND_BAR_CLASS = 'bg-gradient-to-t from-slate-500/90 to-slate-400/90';

export function confidenceColor(value: number) {
  if (value >= 0.85) return 'bg-slate-600';
  if (value >= 0.7) return 'bg-slate-500';
  if (value >= 0.6) return 'bg-slate-400';
  return 'bg-rose-500';
}

export type CandidateFilters = {
  search: string;
  frequency: DiscoveryFrequency;
  databaseFamily: string;
  variableType: 'all' | VariableType;
  clinicalDomain: string;
  matchStatus: 'all' | VariableCandidateMatchStatus;
};

export function filterCandidates(candidates: PubMedVariableCandidate[], filters: CandidateFilters) {
  const keyword = filters.search.trim().toLowerCase();

  return candidates.filter((candidate) => {
    if (keyword) {
      const haystack = [
        candidate.raw_name,
        candidate.canonical_name_guess,
        candidate.display_name_zh_guess,
        candidate.display_name_en_guess,
        candidate.pmid,
        candidate.title,
        candidate.database_family_guess.join(' '),
        candidate.clinical_domain_guess.join(' '),
      ].join(' ').toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }

    if (filters.databaseFamily !== 'all' && !normalizeDatabaseFamilyLabels(candidate.database_family_guess).includes(filters.databaseFamily)) {
      return false;
    }

    if (filters.variableType !== 'all' && candidate.variable_type_guess !== filters.variableType) {
      return false;
    }

    if (filters.clinicalDomain !== 'all' && !candidate.clinical_domain_guess.includes(filters.clinicalDomain)) {
      return false;
    }

    if (filters.matchStatus !== 'all' && candidate.match_status !== filters.matchStatus) {
      return false;
    }

    return true;
  });
}
