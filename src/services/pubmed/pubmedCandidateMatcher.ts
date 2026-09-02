import type {
  PubMedVariableCandidate,
  VariableCandidateMatchStatus,
} from '../../features/variableKnowledge/pubmedDiscovery/types';
import { isLikelyAbbreviationToken, normalizeVariableName } from './pubmedVariableExtractor';

export type ExistingVariableIndexItem = {
  id: string;
  canonicalName: string;
  displayNameZh?: string;
  aliases?: string[];
  componentVariables?: string[];
};

export const DEFAULT_EXISTING_VARIABLES: ExistingVariableIndexItem[] = [
  {
    id: 'variable_nhhr',
    canonicalName: 'NHHR',
    displayNameZh: '非高密度脂蛋白/高密度脂蛋白比值',
    aliases: [
      'Non-HDL-C/HDL-C ratio',
      'non-high-density lipoprotein cholesterol to high-density lipoprotein cholesterol ratio',
      'non-HDL cholesterol-to-HDL cholesterol ratio',
      'NHHR',
    ],
  },
  {
    id: 'variable_tyg',
    canonicalName: 'TyG',
    displayNameZh: '甘油三酯葡萄糖指数',
    aliases: ['triglyceride glucose index', 'triglyceride-glucose index', 'TyG', 'TyG index'],
  },
  {
    id: 'variable_tyg_whtr',
    canonicalName: 'TyG-WHtR',
    displayNameZh: 'TyG-腰高比指数',
    aliases: ['TyG-WHtR', 'TyG waist-to-height ratio', 'TyG-WHtR index'],
  },
  {
    id: 'variable_rar',
    canonicalName: 'RAR',
    displayNameZh: '红细胞分布宽度/白蛋白比值',
    aliases: ['RDW-to-albumin ratio', 'red cell distribution width-to-albumin ratio', 'red blood cell distribution width-to-albumin ratio', 'RAR'],
  },
  {
    id: 'variable_car',
    canonicalName: 'CAR',
    displayNameZh: 'C反应蛋白/白蛋白比值',
    aliases: ['CRP-to-albumin ratio', 'C-reactive protein-to-albumin ratio', 'C reactive protein to albumin ratio', 'CAR'],
  },
  {
    id: 'variable_fli',
    canonicalName: 'FLI',
    displayNameZh: '脂肪肝指数',
    aliases: ['fatty liver index', 'fatty-liver index', 'FLI'],
  },
];

/** 下拉「合并到已有变量」选项，与 {@link DEFAULT_EXISTING_VARIABLES} 同源。 */
export function existingVariablesToMergeSelectOptions(
  items: ExistingVariableIndexItem[] = DEFAULT_EXISTING_VARIABLES,
): Array<{ id: string; label: string }> {
  return [...items]
    .slice()
    .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName, 'en'))
    .map((item) => ({
      id: item.id,
      label: item.displayNameZh
        ? `${item.canonicalName} · ${item.displayNameZh}`
        : item.canonicalName,
    }));
}

const AMBIGUOUS = new Set(['CAR', 'RAR', 'BAG', 'AIP', 'NLR', 'PLR', 'SII']);

function candidateHasExpandedName(candidate: PubMedVariableCandidate) {
  const raw = normalizeVariableName(candidate.raw_name || '').toLowerCase();
  if (!raw || !isLikelyAbbreviationToken(candidate.raw_name || '')) return false;

  return [
    candidate.canonical_name_guess,
    candidate.display_name_en_guess,
  ].some((value) => {
    const normalized = normalizeVariableName(String(value || ''))
      .replace(/\s*\([^)]+\)\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    return normalized && normalized !== raw;
  });
}

function normalizedValues(item: ExistingVariableIndexItem) {
  return [
    item.canonicalName,
    item.displayNameZh,
    ...(item.aliases || []),
    ...(item.componentVariables || []),
  ]
    .filter(Boolean)
    .map((value) => normalizeVariableName(String(value)).toLowerCase());
}

export function matchCandidateToExistingVariable(
  candidate: PubMedVariableCandidate,
  existingVariables: ExistingVariableIndexItem[] = DEFAULT_EXISTING_VARIABLES,
): { status: VariableCandidateMatchStatus; matchedVariableId?: string } {
  const canonical = normalizeVariableName(candidate.canonical_name_guess || candidate.raw_name);
  if (AMBIGUOUS.has(canonical)) {
    return { status: candidate.confidence_score < 0.6 ? 'manual_review' : 'ambiguous' };
  }

  const normalizedCandidateValues = [
    canonical,
    ...(candidateHasExpandedName(candidate) ? [] : [candidate.raw_name]),
    candidate.display_name_zh_guess,
    candidate.display_name_en_guess,
  ].filter(Boolean).map((value) => normalizeVariableName(String(value)).toLowerCase());

  const matched = existingVariables.find((item) => {
    const values = normalizedValues(item);
    return normalizedCandidateValues.some((value) => values.includes(value));
  });

  if (matched) {
    return { status: 'matched', matchedVariableId: matched.id };
  }

  return { status: candidate.confidence_score < 0.6 ? 'manual_review' : 'new' };
}

/** 合并下拉的默认选中项：优先链上 matched_variable_id，其次与目录规则匹配结果，再次按缩写对齐 canonicalName。 */
export function resolveMergeTargetIdForCandidate(
  candidate: PubMedVariableCandidate | null,
  existingVariables: ExistingVariableIndexItem[] = DEFAULT_EXISTING_VARIABLES,
): string {
  const options = existingVariablesToMergeSelectOptions(existingVariables);
  if (options.length === 0) return '';
  if (!candidate) return options[0].id;

  if (candidate.matched_variable_id && options.some((o) => o.id === candidate.matched_variable_id)) {
    return candidate.matched_variable_id;
  }

  const matched = matchCandidateToExistingVariable(candidate, existingVariables);
  if (matched.matchedVariableId && options.some((o) => o.id === matched.matchedVariableId)) {
    return matched.matchedVariableId;
  }

  const raw = (candidate.raw_name || candidate.canonical_name_guess || '').trim();
  if (raw) {
    const exact = existingVariables.find(
      (item) => item.canonicalName.toUpperCase() === raw.toUpperCase(),
    );
    if (exact) return exact.id;
  }

  return options[0].id;
}

export function applyExistingVariableMatches(
  candidates: PubMedVariableCandidate[],
  existingVariables: ExistingVariableIndexItem[] = DEFAULT_EXISTING_VARIABLES,
) {
  return candidates.map((candidate) => {
    const match = matchCandidateToExistingVariable(candidate, existingVariables);
    return {
      ...candidate,
      match_status: match.status,
      matched_variable_id: match.matchedVariableId,
    };
  });
}
