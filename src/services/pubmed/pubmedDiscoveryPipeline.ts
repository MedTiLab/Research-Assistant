import type {
  PubMedCandidateEvidence,
  PubMedCandidateExtractionStage,
  PubMedDiscoveryOptions,
  PubMedExtractionArticle,
  PubMedExtractionSeedCandidate,
  PubMedVariableCandidate,
} from '../../features/variableKnowledge/pubmedDiscovery/types';
import { inferDatabaseFamiliesFromText, normalizeDatabaseFamilyLabels } from '../../../shared/publicDatabaseCatalog';
import { normalizeVariableName } from './pubmedVariableExtractor';

export const MAX_REFINEMENT_ARTICLES = 12;
export const UNSEEDED_REFINEMENT_SLOTS = 4;
export const ABSTRACT_BATCH_SIZE = 3;
export const MAX_ABSTRACT_CHARS = 1_200;
export const MAX_EVIDENCE_SENTENCES = 3;
export const EXTRACTION_CONCURRENCY = 2;

const NAMED_METRIC_TITLE_PATTERN = /\b(index|score|ratio|signature|gap|burden)\b/i;
const KNOWN_OR_STRUCTURED_METRIC_PATTERN = /\b(TyG(?:[-\s]?(?:BMI|WHtR))?|NLR|PLR|SII|FIB[-\s]?4|NHHR|RAR|CAR|VAI|CVAI|WWI|BRI|ABSI|FLI|[A-Za-z][A-Za-z-]+[-\s]to[-\s][A-Za-z][A-Za-z-]+\s+ratio)\b/i;
const DEFINITION_CUE_PATTERN = /\b(calculated|computed|derived|formula|equals?|(?:defined|measured|estimated|assessed|quantified|obtained|expressed|scored)\s+(?:as|by|from|using|with))\b/i;
const ABSTRACT_DERIVATION_PATTERN = /\b(formula|calculated|computed|derived|ratio|defined as)\b/i;
const PURE_ENDPOINT_PATTERN = /\b(mortality|survival|hospitali[sz]ation|death|endpoint|hazard)\b/i;
const STATISTICAL_RESULT_PATTERN = /\b(odds ratio|hazard ratio|relative risk|confidence interval|p[-\s]?value)\b/i;
const STATISTICAL_ABBREVIATION_PATTERN = /\b(?:OR|HR|RR|CI)\b/;

function normalizeComparableText(value = '') {
  return String(value).trim().replace(/\s+/g, ' ').toLowerCase();
}

function containsVariableKeyword(title: string, keyword = '') {
  const normalizedKeyword = normalizeComparableText(keyword);
  if (!normalizedKeyword) return false;
  const titleText = normalizeComparableText(title);
  if (titleText.includes(normalizedKeyword)) return true;
  const meaningfulTokens = normalizedKeyword.split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
  return meaningfulTokens.length > 0 && meaningfulTokens.every((token) => titleText.includes(token));
}

export type PubMedArticleScore = {
  article: PubMedExtractionArticle;
  score: number;
  reasons: string[];
  originalIndex: number;
};

export function scorePubMedArticleForVariableDiscovery(
  article: PubMedExtractionArticle,
  options: Pick<PubMedDiscoveryOptions, 'variableKeyword'> = {},
): Omit<PubMedArticleScore, 'article' | 'originalIndex'> {
  const title = article.title || '';
  const abstract = article.abstract || '';
  const context = `${title} ${abstract}`;
  const reasons: string[] = [];
  let score = 0;

  if (NAMED_METRIC_TITLE_PATTERN.test(title)) {
    score += 3;
    reasons.push('题名含指标/评分/比值结构');
  }
  if (containsVariableKeyword(title, options.variableKeyword)) {
    score += 3;
    reasons.push('题名命中用户变量关键词');
  }
  if (inferDatabaseFamiliesFromText(context).length > 0) {
    score += 2;
    reasons.push('命中公共数据库名称或别名');
  }
  if (KNOWN_OR_STRUCTURED_METRIC_PATTERN.test(title)) {
    score += 2;
    reasons.push('题名含已知或结构化候选指标');
  }
  if (ABSTRACT_DERIVATION_PATTERN.test(abstract)) {
    score += 1;
    reasons.push('摘要含计算/派生描述');
  }
  if (PURE_ENDPOINT_PATTERN.test(title)) {
    score -= 3;
    reasons.push('题名偏纯结局端点');
  }
  if (STATISTICAL_RESULT_PATTERN.test(title) || STATISTICAL_ABBREVIATION_PATTERN.test(title)) {
    score -= 3;
    reasons.push('题名偏统计效应量');
  }

  return { score, reasons };
}

export function rankPubMedArticlesForExtraction(
  articles: PubMedExtractionArticle[],
  options: Pick<PubMedDiscoveryOptions, 'variableKeyword'> = {},
) {
  return articles
    .map((article, originalIndex): PubMedArticleScore => ({
      article,
      originalIndex,
      ...scorePubMedArticleForVariableDiscovery(article, options),
    }))
    .sort((left, right) => right.score - left.score || left.originalIndex - right.originalIndex);
}

function splitSentences(text = '') {
  return String(text)
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function candidateTerms(candidates: PubMedExtractionSeedCandidate[]) {
  return [...new Set(candidates.flatMap((candidate) => [
    candidate.raw_name,
    candidate.canonical_name_guess,
    candidate.display_name_en_guess,
  ]).map(normalizeComparableText).filter((value) => value.length >= 2))];
}

function scoreEvidenceSentence(sentence: string, terms: string[]) {
  const normalizedSentence = normalizeComparableText(sentence);
  const mentionsSeed = terms.some((term) => normalizedSentence.includes(term));
  const definesMetric = DEFINITION_CUE_PATTERN.test(sentence);
  if (mentionsSeed && definesMetric) return 3;
  if (mentionsSeed) return 2;
  if (definesMetric) return 1;
  return 0;
}

export function extractAbstractEvidenceWindow(
  article: PubMedExtractionArticle,
  seeds: PubMedExtractionSeedCandidate[],
  maxChars = MAX_ABSTRACT_CHARS,
) {
  const sentences = splitSentences(article.abstract);
  if (sentences.length === 0) return '';
  const terms = candidateTerms(seeds);
  const ranked = sentences
    .map((sentence, index) => ({ index, relevance: scoreEvidenceSentence(sentence, terms) }))
    .sort((left, right) => right.relevance - left.relevance || left.index - right.index);

  const selectedIndexes = new Set<number>(ranked
    .filter((item) => item.relevance > 0)
    .slice(0, MAX_EVIDENCE_SENTENCES)
    .map((item) => item.index));

  if (selectedIndexes.size === 0) {
    sentences.slice(0, MAX_EVIDENCE_SENTENCES).forEach((_, index) => selectedIndexes.add(index));
  }

  const selected = [...selectedIndexes]
    .sort((left, right) => left - right)
    .map((index) => sentences[index]);
  const withinBudget: string[] = [];
  for (const sentence of selected) {
    const next = [...withinBudget, sentence].join(' ');
    if (next.length > maxChars) break;
    withinBudget.push(sentence);
  }
  return (withinBudget.join(' ') || selected[0]?.slice(0, maxChars) || '').trim();
}

export function compactArticleForAbstractExtraction(
  article: PubMedExtractionArticle,
  seeds: PubMedExtractionSeedCandidate[],
): PubMedExtractionArticle {
  return {
    ...article,
    abstract: extractAbstractEvidenceWindow(article, seeds),
  };
}

function candidateStage(candidate: PubMedVariableCandidate): PubMedCandidateExtractionStage {
  if (candidate.extraction_stage) return candidate.extraction_stage;
  if (candidate.extraction_source === 'abstract' || candidate.extraction_source === 'llm') return 'abstract_verified';
  if (candidate.extraction_source === 'title') return 'title_screen';
  return 'rule_based';
}

function evidenceFromCandidate(candidate: PubMedVariableCandidate): PubMedCandidateEvidence {
  return {
    pmid: candidate.pmid,
    title: candidate.title,
    abstract: candidate.abstract,
    journal: candidate.journal,
    publication_year: candidate.publication_year,
    publication_date: candidate.publication_date,
    evidence_sentence: candidate.evidence_sentence,
    confidence_score: candidate.confidence_score,
    database_family_guess: normalizeDatabaseFamilyLabels(candidate.database_family_guess),
    extraction_stage: candidateStage(candidate),
    evidence_level: candidate.evidence_level
      || (candidateStage(candidate) === 'abstract_verified' ? 'abstract_supported' : 'title_only'),
  };
}

function evidenceForCandidate(candidate: PubMedVariableCandidate) {
  return candidate.evidence_articles?.length ? candidate.evidence_articles : [evidenceFromCandidate(candidate)];
}

function candidateAliases(candidate: PubMedVariableCandidate) {
  return new Set([
    candidate.raw_name,
    candidate.canonical_name_guess,
    candidate.display_name_en_guess,
  ].map((value) => normalizeComparableText(normalizeVariableName(value || ''))).filter(Boolean));
}

function stagePriority(candidate: PubMedVariableCandidate) {
  const stage = candidateStage(candidate);
  if (stage === 'abstract_verified') return 4;
  if (stage === 'extraction_failed') return 3;
  if (stage === 'title_screen') return 2;
  return 1;
}

function evidenceKey(evidence: PubMedCandidateEvidence) {
  return evidence.pmid || normalizeComparableText(evidence.title);
}

function mergeEvidence(evidence: PubMedCandidateEvidence[]) {
  const byKey = new Map<string, PubMedCandidateEvidence>();
  for (const item of evidence) {
    const key = evidenceKey(item);
    const current = byKey.get(key);
    const itemPriority = Number(item.evidence_level === 'abstract_supported') * 10 + item.confidence_score;
    const currentPriority = current
      ? Number(current.evidence_level === 'abstract_supported') * 10 + current.confidence_score
      : -1;
    if (!current || itemPriority > currentPriority) byKey.set(key, item);
  }
  return [...byKey.values()].sort((left, right) => (
    Number(right.evidence_level === 'abstract_supported') - Number(left.evidence_level === 'abstract_supported')
    || right.confidence_score - left.confidence_score
  ));
}

function mergeCandidateGroup(group: PubMedVariableCandidate[]) {
  const primary = [...group].sort((left, right) => (
    stagePriority(right) - stagePriority(left)
    || right.confidence_score - left.confidence_score
  ))[0];
  const evidenceArticles = mergeEvidence(group.flatMap(evidenceForCandidate));
  const abstractEvidence = evidenceArticles.find((item) => item.evidence_level === 'abstract_supported');
  const failedEvidence = evidenceArticles.find((item) => item.extraction_stage === 'extraction_failed');
  const finalStage: PubMedCandidateExtractionStage = abstractEvidence
    ? 'abstract_verified'
    : failedEvidence
      ? 'extraction_failed'
      : candidateStage(primary);

  return {
    ...primary,
    pmid: evidenceArticles[0]?.pmid || primary.pmid,
    title: evidenceArticles[0]?.title || primary.title,
    abstract: evidenceArticles[0]?.abstract || primary.abstract,
    journal: evidenceArticles[0]?.journal || primary.journal,
    publication_year: evidenceArticles[0]?.publication_year || primary.publication_year,
    publication_date: evidenceArticles[0]?.publication_date || primary.publication_date,
    evidence_sentence: evidenceArticles[0]?.evidence_sentence || primary.evidence_sentence,
    confidence_score: Math.max(...group.map((candidate) => candidate.confidence_score)),
    database_family_guess: normalizeDatabaseFamilyLabels(group.flatMap((candidate) => candidate.database_family_guess)),
    clinical_domain_guess: [...new Set(group.flatMap((candidate) => candidate.clinical_domain_guess))],
    role_guess: [...new Set(group.flatMap((candidate) => candidate.role_guess))],
    ambiguity_notes: group.map((candidate) => candidate.ambiguity_notes).filter(Boolean).join(' ') || undefined,
    formula_text: group.map((candidate) => candidate.formula_text?.trim()).find(Boolean) || undefined,
    extraction_source: abstractEvidence ? 'abstract' : primary.extraction_source,
    extraction_stage: finalStage,
    evidence_level: abstractEvidence ? 'abstract_supported' : 'title_only',
    evidence_articles: evidenceArticles,
  } satisfies PubMedVariableCandidate;
}

export function aggregatePubMedCandidates(candidates: PubMedVariableCandidate[]) {
  const groups: Array<{ aliases: Set<string>; candidates: PubMedVariableCandidate[] }> = [];

  for (const candidate of candidates) {
    const aliases = candidateAliases(candidate);
    const group = groups.find((item) => [...aliases].some((alias) => item.aliases.has(alias)));
    if (group) {
      aliases.forEach((alias) => group.aliases.add(alias));
      group.candidates.push(candidate);
    } else {
      groups.push({ aliases, candidates: [candidate] });
    }
  }

  return groups.map((group) => mergeCandidateGroup(group.candidates));
}

export function markCandidatesForFailedPmids(candidates: PubMedVariableCandidate[], pmids: Set<string>) {
  return candidates.map((candidate) => {
    if (!pmids.has(candidate.pmid) || candidate.extraction_stage === 'abstract_verified') return candidate;
    return {
      ...candidate,
      extraction_stage: 'extraction_failed' as const,
      evidence_articles: evidenceForCandidate(candidate).map((evidence) => (
        pmids.has(evidence.pmid) && evidence.evidence_level !== 'abstract_supported'
          ? { ...evidence, extraction_stage: 'extraction_failed' as const }
          : evidence
      )),
    };
  });
}

export function isVerbatimEvidence(evidence: string, article: Pick<PubMedExtractionArticle, 'title' | 'abstract'>) {
  const normalizedEvidence = normalizeComparableText(evidence);
  if (!normalizedEvidence) return false;
  return normalizeComparableText(`${article.title} ${article.abstract}`).includes(normalizedEvidence);
}

export function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
