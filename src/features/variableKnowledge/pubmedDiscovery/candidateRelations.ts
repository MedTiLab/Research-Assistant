import type { PubMedVariableCandidate } from './types';

export type RelatedCandidate = {
  id: string;
  name: string;
  reasons: string[];
};

const GENERIC_NAME_TOKENS = new Set([
  'index', 'score', 'ratio', 'rate', 'marker', 'biomarker', 'level', 'levels',
  'the', 'and', 'of', 'to', 'for', 'with',
]);

export const MAX_RELATED_CANDIDATES = 6;

function meaningfulTokens(value = '') {
  return new Set(String(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !GENERIC_NAME_TOKENS.has(token)));
}

function candidateTokens(candidate: PubMedVariableCandidate) {
  return meaningfulTokens([
    candidate.raw_name,
    candidate.canonical_name_guess,
    candidate.display_name_en_guess,
  ].filter(Boolean).join(' '));
}

function candidateLabel(candidate: PubMedVariableCandidate) {
  return (candidate.display_name_en_guess || candidate.canonical_name_guess || candidate.raw_name || '').trim();
}

function overlap<T>(left: Iterable<T>, right: Set<T>) {
  return [...left].filter((item) => right.has(item));
}

/**
 * Relatedness is derived from what the run actually found, never from a hard-coded
 * table: two candidates are related when they share a database family, a clinical
 * domain, or a meaningful word in their names. Each hit carries the reason so the
 * reviewer can judge it rather than trust it.
 */
export function findRelatedCandidates(
  candidate: PubMedVariableCandidate,
  allCandidates: PubMedVariableCandidate[],
): RelatedCandidate[] {
  const tokens = candidateTokens(candidate);
  const families = new Set(candidate.database_family_guess || []);
  const domains = new Set(candidate.clinical_domain_guess || []);

  return allCandidates
    .filter((other) => other.id !== candidate.id && candidateLabel(other))
    .map((other) => {
      const reasons: string[] = [];
      const sharedTokens = overlap(candidateTokens(other), tokens);
      const sharedFamilies = overlap(other.database_family_guess || [], families);
      const sharedDomains = overlap(other.clinical_domain_guess || [], domains);

      if (sharedTokens.length > 0) reasons.push(`共享名称词：${sharedTokens.join('、')}`);
      if (sharedFamilies.length > 0) reasons.push(`同数据库：${sharedFamilies.join('、')}`);
      if (sharedDomains.length > 0) reasons.push(`同临床领域：${sharedDomains.join('、')}`);
      if (reasons.length > 0 && other.variable_type_guess === candidate.variable_type_guess) {
        reasons.push('同变量类型');
      }

      return { id: other.id, name: candidateLabel(other), reasons };
    })
    .filter((item) => item.reasons.length > 0)
    .sort((left, right) => right.reasons.length - left.reasons.length || left.name.localeCompare(right.name))
    .slice(0, MAX_RELATED_CANDIDATES);
}
