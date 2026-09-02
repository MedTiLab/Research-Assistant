import { api } from '../../utils/api';
import type {
  CandidateAuditLogEntry,
  DiscoverySummaryStats,
  PubMedCandidateEvidence,
  PubMedDiscoveryJob,
  PubMedDiscoveryOptions,
  PubMedDiscoveryProgressEvent,
  PubMedDiscoveryResult,
  PubMedExtractionArticle,
  PubMedExtractionBatchFailure,
  PubMedExtractionSeedCandidate,
  PubMedVariableCandidate,
  VariableEvidenceArticle,
  VariableTrendPoint,
} from '../../features/variableKnowledge/pubmedDiscovery/types';
import { applyExistingVariableMatches } from './pubmedCandidateMatcher';
import { buildPubMedNewsSearchConfig, buildPubMedVariableDiscoveryQuery } from './pubmedQueryBuilder';
import { extractVariableCandidatesFromArticle, isLikelyAbbreviationToken, normalizeVariableName } from './pubmedVariableExtractor';
import { inferDatabaseFamiliesFromText, normalizeDatabaseFamilyLabels } from '../../../shared/publicDatabaseCatalog';
import {
  ABSTRACT_BATCH_SIZE,
  aggregatePubMedCandidates,
  chunkItems,
  compactArticleForAbstractExtraction,
  EXTRACTION_CONCURRENCY,
  isVerbatimEvidence,
  mapWithConcurrency,
  markCandidatesForFailedPmids,
  MAX_REFINEMENT_ARTICLES,
  UNSEEDED_REFINEMENT_SLOTS,
  rankPubMedArticlesForExtraction,
} from './pubmedDiscoveryPipeline';

type NewsSearchItem = {
  id?: string;
  title?: string;
  abstract?: string;
  source?: string;
  published?: string;
  link?: string;
};

type NewsSearchResults = {
  top_papers?: NewsSearchItem[];
  total_found?: number;
  total_filtered?: number;
};

type NormalizedPubMedArticle = PubMedExtractionArticle;

type LlmExtractedCandidate = Partial<Pick<
  PubMedVariableCandidate,
  | 'pmid'
  | 'raw_name'
  | 'canonical_name_guess'
  | 'display_name_zh_guess'
  | 'display_name_en_guess'
  | 'variable_type_guess'
  | 'database_family_guess'
  | 'clinical_domain_guess'
  | 'role_guess'
  | 'formula_text'
  | 'evidence_sentence'
  | 'confidence_score'
  | 'ambiguity_notes'
>> & { ambiguous?: boolean };

type LlmExtractionResult = {
  candidates?: LlmExtractedCandidate[];
  extractionSource?: string;
  extractionProvider?: string;
  extractionModel?: string;
  extractionInvocation?: string;
  error?: string;
};

type LlmExtractionStage = 'full' | 'title_screen' | 'abstract_refine';

type LlmExtractionRequestOptions = PubMedDiscoveryOptions & {
  extractionStage?: LlmExtractionStage;
  seedCandidates?: Array<Partial<Pick<
    PubMedVariableCandidate,
    | 'pmid'
    | 'raw_name'
    | 'canonical_name_guess'
    | 'display_name_en_guess'
    | 'variable_type_guess'
    | 'evidence_sentence'
  >>>;
};

type PubMedDiscoveryRunCallbacks = {
  onProgress?: (event: PubMedDiscoveryProgressEvent) => void;
  onCandidates?: (update: {
    candidates: PubMedVariableCandidate[];
    failedBatches: PubMedExtractionBatchFailure[];
    completedBatches: number;
    totalBatches: number;
  }) => void;
  signal?: AbortSignal;
};

const VARIABLE_TYPES = new Set(['raw_field', 'derived_index', 'risk_score', 'outcome', 'covariate', 'stratifier']);
const NON_VARIABLE_OUTCOME_PATTERN =
  /\b(all[-\s]cause mortality|cardiovascular mortality|cancer[-\s]specific mortality|mortality|death|overall survival|disease[-\s]free survival|progression[-\s]free survival|event[-\s]free survival|recurrence[-\s]free survival|survival|major adverse cardiovascular events|mace|acute kidney injury|stroke incidence|heart failure hospitalization|hospitalization|follow[-\s]?up time|outcome endpoint|endpoint)\b/i;
const PUBMED_SEARCH_TIMEOUT_MS = 75_000;
const LLM_EXTRACTION_TIMEOUT_MS = 90_000;

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function emitProgress(
  callbacks: PubMedDiscoveryRunCallbacks | undefined,
  event: Omit<PubMedDiscoveryProgressEvent, 'id' | 'createdAt'>,
) {
  callbacks?.onProgress?.({
    ...event,
    id: createId(`progress_${event.phase}`),
    createdAt: new Date().toISOString(),
  });
}

function createAbortError(message = 'PubMed 自动发现已暂停。') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function createTimeoutError(message: string) {
  const error = new Error(message);
  error.name = 'TimeoutError';
  return error;
}

function isAbortError(error: unknown) {
  const candidate = error as { name?: string; message?: string } | null;
  return Boolean(
    candidate
    && (
      candidate.name === 'AbortError'
      || /\babort(ed)?\b/i.test(String(candidate.message || ''))
    ),
  );
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

async function withAbortableRequest<T>(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  timeoutMessage: string,
  runner: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort();

  if (parentSignal?.aborted) {
    controller.abort();
  } else {
    parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  }

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const result = await runner(controller.signal);
    throwIfAborted(parentSignal);
    return result;
  } catch (error) {
    if (isAbortError(error)) {
      if (parentSignal?.aborted) {
        throw createAbortError();
      }
      if (timedOut) {
        throw createTimeoutError(timeoutMessage);
      }
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}

function createFallbackResult(
  options: PubMedDiscoveryOptions,
  jobId: string,
  errorMessage: string,
): PubMedDiscoveryResult {
  const now = new Date().toISOString();

  return {
    job: {
      id: jobId,
      job_type: options.frequency,
      query_text: buildPubMedVariableDiscoveryQuery(options),
      date_from: options.dateFrom,
      date_to: options.dateTo,
      total_articles: 0,
      candidate_count: 0,
      matched_existing_count: 0,
      pending_review_count: 0,
      status: 'partial',
      created_at: now,
      finished_at: now,
      error_message: errorMessage,
      extraction_source: 'rule_based',
    },
    candidates: [],
    matchedEvidence: [],
    trendPoints: [],
  };
}

function createCancelledResult(
  options: PubMedDiscoveryOptions,
  jobId: string,
): PubMedDiscoveryResult {
  const now = new Date().toISOString();

  return {
    job: {
      id: jobId,
      job_type: options.frequency,
      query_text: buildPubMedVariableDiscoveryQuery(options),
      date_from: options.dateFrom,
      date_to: options.dateTo,
      total_articles: 0,
      candidate_count: 0,
      matched_existing_count: 0,
      pending_review_count: 0,
      status: 'cancelled',
      created_at: now,
      finished_at: now,
      error_message: '用户已暂停本轮 PubMed 自动发现。',
      extraction_source: 'rule_based',
    },
    candidates: [],
    matchedEvidence: [],
    trendPoints: [],
  };
}

function parsePmid(item: NewsSearchItem) {
  const raw = String(item.id || item.link || '');
  const match = raw.match(/\b\d{6,9}\b/);
  return match?.[0] || raw.replace(/^pubmed[-_:]/i, '').slice(0, 24) || 'unknown';
}

function normalizePublicationDate(value?: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  const yearMatch = value.match(/\b(19|20)\d{2}\b/);
  return yearMatch ? `${yearMatch[0]}-01-01` : undefined;
}

function normalizeArticle(item: NewsSearchItem): NormalizedPubMedArticle {
  return {
    pmid: parsePmid(item),
    title: String(item.title || '').trim() || 'Untitled PubMed record',
    abstract: String(item.abstract || '').trim(),
    journal: String(item.source || '').trim() || 'PubMed',
    publicationDate: normalizePublicationDate(item.published),
  };
}

function buildTrendPoints(candidates: PubMedVariableCandidate[]): VariableTrendPoint[] {
  const byDate = new Map<string, number>();
  candidates.forEach((candidate) => {
    const date = candidate.publication_date || candidate.created_at.slice(0, 10);
    byDate.set(date, (byDate.get(date) || 0) + 1);
  });

  return Array.from(byDate.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-7)
    .map(([date, count]) => ({
      date,
      candidate_count: count,
      evidence_count: Math.max(count, Math.round(count * 1.4)),
    }));
}

export function normalizeCandidateDatabaseFamilies(candidate: PubMedVariableCandidate): PubMedVariableCandidate {
  return {
    ...candidate,
    database_family_guess: normalizeDatabaseFamilyLabels(candidate.database_family_guess),
  };
}

function normalizeCandidatesList(candidates: PubMedVariableCandidate[]): PubMedVariableCandidate[] {
  return candidates.map(normalizeCandidateDatabaseFamilies);
}

function clampConfidence(value: unknown) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return 0.65;
  return Math.max(0.1, Math.min(1, parsed));
}

export function hasExpandedCanonicalName(rawName: string, candidateName: string) {
  const raw = String(rawName || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const candidate = String(candidateName || '')
    .trim()
    .replace(/\s*\([^)]+\)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  if (!raw || !candidate || raw === candidate) return false;
  return candidate.length > raw.length + 2;
}

export function isAbbreviationExpansionSupported(rawName: string, candidateName: string, evidenceText: string) {
  if (!isLikelyAbbreviationToken(rawName) || !hasExpandedCanonicalName(rawName, candidateName)) return true;
  return String(evidenceText || '').replace(/\s+/g, ' ').toLowerCase()
    .includes(String(candidateName || '').replace(/\s+/g, ' ').toLowerCase());
}

function stripTrailingAbbreviation(rawName: string, candidateName: string) {
  const cleaned = String(candidateName || '').trim();
  const raw = normalizeVariableName(rawName).toLowerCase();
  if (!raw || !cleaned) return cleaned;

  return cleaned.replace(/\s*\(([^)]{1,32})\)\s*$/g, (match, inner) => (
    normalizeVariableName(String(inner)).toLowerCase() === raw ? '' : match
  )).trim();
}

function mapClaudeCandidateToCandidate(
  rawCandidate: LlmExtractedCandidate,
  article: NormalizedPubMedArticle,
  jobId: string,
): PubMedVariableCandidate | null {
  const rawName = String(rawCandidate.raw_name || rawCandidate.canonical_name_guess || '').trim();
  if (!rawName) return null;

  const evidenceSentence = String(rawCandidate.evidence_sentence || '').trim();
  const evidenceFromAbstract = isVerbatimEvidence(evidenceSentence, { title: '', abstract: article.abstract });
  const evidenceFromTitle = isVerbatimEvidence(evidenceSentence, { title: article.title, abstract: '' });
  if (!evidenceSentence || (!evidenceFromAbstract && !evidenceFromTitle)) {
    return null;
  }

  const now = new Date().toISOString();
  const variableType = String(rawCandidate.variable_type_guess || 'raw_field');
  const proposedCanonicalName = stripTrailingAbbreviation(rawName, String(rawCandidate.canonical_name_guess || rawName).trim());
  const proposedDisplayNameEn = stripTrailingAbbreviation(
    rawName,
    String(rawCandidate.display_name_en_guess || rawCandidate.canonical_name_guess || rawName).trim(),
  );
  const articleEvidenceText = `${article.title} ${article.abstract}`;
  const expansionSupportedByEvidence = isAbbreviationExpansionSupported(
    rawName,
    proposedCanonicalName,
    articleEvidenceText,
  );
  const canonicalName = expansionSupportedByEvidence ? proposedCanonicalName : rawName;
  const displayNameEn = expansionSupportedByEvidence ? proposedDisplayNameEn : rawName;
  const abbreviationNeedsExpansion = isLikelyAbbreviationToken(rawName)
    && !hasExpandedCanonicalName(rawName, canonicalName)
    && !hasExpandedCanonicalName(rawName, displayNameEn);
  if (variableType === 'outcome' || NON_VARIABLE_OUTCOME_PATTERN.test(`${rawName} ${canonicalName}`)) {
    return null;
  }

  const finalMatchStatus = rawCandidate.ambiguous || abbreviationNeedsExpansion || !expansionSupportedByEvidence
    ? 'manual_review'
    : 'new';
  const ambiguityNotes = String(rawCandidate.ambiguity_notes || '').trim();
  const localCandidate = extractVariableCandidatesFromArticle({
    pmid: article.pmid,
    title: article.title,
    abstract: article.abstract,
    journal: article.journal,
    publicationDate: article.publicationDate,
  }, jobId).find((candidate) => (
    normalizeVariableName(candidate.raw_name).toLowerCase() === normalizeVariableName(rawName).toLowerCase()
    || normalizeVariableName(candidate.canonical_name_guess).toLowerCase() === normalizeVariableName(canonicalName).toLowerCase()
  ));

  return {
    id: createId('candidate'),
    job_id: jobId,
    pmid: article.pmid,
    title: article.title,
    abstract: article.abstract,
    journal: article.journal,
    publication_date: article.publicationDate,
    publication_year: article.publicationDate ? Number(article.publicationDate.slice(0, 4)) : undefined,
    raw_name: rawName,
    canonical_name_guess: canonicalName,
    display_name_zh_guess: String(rawCandidate.display_name_zh_guess || localCandidate?.display_name_zh_guess || rawName).trim(),
    display_name_en_guess: displayNameEn,
    variable_type_guess: VARIABLE_TYPES.has(variableType) ? PubMedVariableType(variableType) : 'raw_field',
    database_family_guess: inferDatabaseFamiliesFromText(`${article.title} ${article.abstract}`),
    clinical_domain_guess: [],
    role_guess: ['候选变量'],
    formula_text: String(rawCandidate.formula_text || '').trim() || undefined,
    evidence_sentence: evidenceSentence,
    confidence_score: clampConfidence(rawCandidate.confidence_score),
    match_status: finalMatchStatus,
    review_status: 'pending',
    ambiguity_notes: abbreviationNeedsExpansion || !expansionSupportedByEvidence
      ? [
        ambiguityNotes,
        expansionSupportedByEvidence
          ? '缩写未展开为完整英文名，需人工确认后再匹配。'
          : '摘要未逐字支持该缩写展开，已保留原缩写并标记待确认。',
      ].filter(Boolean).join(' ')
      : ambiguityNotes || undefined,
    extraction_source: evidenceFromAbstract ? 'abstract' : 'title',
    extraction_stage: evidenceFromAbstract ? 'abstract_verified' : 'title_screen',
    evidence_level: evidenceFromAbstract ? 'abstract_supported' : 'title_only',
    created_at: now,
    updated_at: now,
  };
}

function PubMedVariableType(value: string): PubMedVariableCandidate['variable_type_guess'] {
  return value as PubMedVariableCandidate['variable_type_guess'];
}

function dedupeCandidates(candidates: PubMedVariableCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.pmid}:${normalizeVariableName(candidate.raw_name || candidate.canonical_name_guess).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function requestClaudeJsonExtraction(
  articles: NormalizedPubMedArticle[],
  options: LlmExtractionRequestOptions,
  signal?: AbortSignal,
) {
  const response = await withAbortableRequest(
    signal,
    LLM_EXTRACTION_TIMEOUT_MS,
    '单个摘要批次未在 90 秒内完成，已保留前序结果并标记该批次可重试。',
    (requestSignal) => api.pubmedDiscovery.extract({ articles, options }, { signal: requestSignal }),
  );
  const data = await response.json().catch(() => ({})) as LlmExtractionResult;
  if (!response.ok) {
    throw new Error(data?.error || 'Claude JSON extraction endpoint failed');
  }
  throwIfAborted(signal);
  return data;
}

function normalizeForTextMatch(value = '') {
  return String(value).trim().replace(/\s+/g, ' ').toLowerCase();
}

export function isCandidateNameGroundedInArticle(name: string, article: NormalizedPubMedArticle) {
  const normalized = normalizeForTextMatch(name);
  if (normalized.length < 2) return false;
  return normalizeForTextMatch(`${article.title} ${article.abstract}`).includes(normalized);
}

export function mapLlmExtractionToCandidates(
  data: LlmExtractionResult,
  articles: NormalizedPubMedArticle[],
  jobId: string,
  seedCandidates: PubMedExtractionSeedCandidate[] = [],
) {
  const byPmid = new Map(articles.map((article) => [article.pmid, article]));
  const allowedByPmid = new Map<string, Set<string>>();
  seedCandidates.forEach((seed) => {
    const allowed = allowedByPmid.get(seed.pmid) || new Set<string>();
    [seed.raw_name, seed.canonical_name_guess, seed.display_name_en_guess]
      .map((value) => normalizeVariableName(value || '').toLowerCase())
      .filter(Boolean)
      .forEach((value) => allowed.add(value));
    allowedByPmid.set(seed.pmid, allowed);
  });
  return (Array.isArray(data.candidates) ? data.candidates : [])
    .map((candidate) => {
      const pmid = String(candidate.pmid || '').trim();
      const article = byPmid.get(pmid);
      if (!article) return null;
      const allowed = allowedByPmid.get(pmid);
      const responseNames = [candidate.raw_name, candidate.canonical_name_guess]
        .map((value) => normalizeVariableName(String(value || '')).toLowerCase())
        .filter(Boolean);
      const matchesSeed = Boolean(allowed) && responseNames.some((name) => allowed!.has(name));
      const groundedInArticle = [candidate.raw_name, candidate.canonical_name_guess]
        .some((value) => isCandidateNameGroundedInArticle(String(value || ''), article));
      if (!matchesSeed && !groundedInArticle) return null;
      return mapClaudeCandidateToCandidate(candidate, article, jobId);
    })
    .filter(Boolean) as PubMedVariableCandidate[];
}

function compactSeedCandidate(candidate: PubMedVariableCandidate): PubMedExtractionSeedCandidate {
  return {
    pmid: candidate.pmid,
    raw_name: candidate.raw_name,
    canonical_name_guess: candidate.canonical_name_guess,
    display_name_en_guess: candidate.display_name_en_guess,
    variable_type_guess: candidate.variable_type_guess,
    evidence_sentence: candidate.evidence_sentence,
  };
}

export function selectRefinementArticles(
  rankedArticles: ReturnType<typeof rankPubMedArticlesForExtraction>,
  titleCandidates: PubMedVariableCandidate[],
) {
  const candidatePmids = new Set(titleCandidates.map((candidate) => candidate.pmid));
  const withAbstract = rankedArticles
    .map((item) => item.article)
    .filter((article) => article.abstract.trim());
  const seeded = withAbstract.filter((article) => candidatePmids.has(article.pmid));
  const unseeded = withAbstract.filter((article) => !candidatePmids.has(article.pmid));
  const seededBudget = Math.max(0, MAX_REFINEMENT_ARTICLES - UNSEEDED_REFINEMENT_SLOTS);

  return [
    ...seeded.slice(0, seededBudget),
    ...unseeded,
    ...seeded.slice(seededBudget),
  ].slice(0, MAX_REFINEMENT_ARTICLES);
}

export function finalizePubMedCandidates(candidates: PubMedVariableCandidate[]) {
  return normalizeCandidatesList(applyExistingVariableMatches(aggregatePubMedCandidates(dedupeCandidates(candidates))));
}

export async function retryPubMedExtractionBatch(
  failure: PubMedExtractionBatchFailure,
  options: PubMedDiscoveryOptions,
  jobId: string,
  signal?: AbortSignal,
) {
  const compactArticles = failure.articles.map((article) => compactArticleForAbstractExtraction(
    article,
    failure.seed_candidates.filter((seed) => seed.pmid === article.pmid),
  ));
  const data = await requestClaudeJsonExtraction(
    compactArticles,
    { ...options, extractionStage: 'abstract_refine', seedCandidates: failure.seed_candidates },
    signal,
  );
  const candidates = mapLlmExtractionToCandidates(data, failure.articles, jobId, failure.seed_candidates);
  return {
    candidates,
    extractionProvider: data.extractionProvider,
    extractionModel: data.extractionModel,
    extractionInvocation: data.extractionInvocation,
  };
}

async function extractCandidatesWithClaudeJson(
  articles: NormalizedPubMedArticle[],
  options: PubMedDiscoveryOptions,
  jobId: string,
  signal?: AbortSignal,
  callbacks?: PubMedDiscoveryRunCallbacks,
) {
  const titleStartedAtMs = Date.now();
  const titleStartedAt = new Date(titleStartedAtMs).toISOString();
  emitProgress(callbacks, {
    phase: 'local_prescreen',
    label: '本地题名预筛与规则抽取',
    detail: `本地评分 ${articles.length} 篇文献并从题名高召回抽取指标；此阶段不调用 LLM。`,
    status: 'running',
    startedAt: titleStartedAt,
    timeoutMs: 15_000,
    progress: 0,
  });

  const rankedArticles = rankPubMedArticlesForExtraction(articles, options);
  const titleCandidates = dedupeCandidates(extractCandidatesWithRules(
    articles.map((article) => ({ ...article, abstract: '' })),
    jobId,
  ).map((candidate) => ({
    ...candidate,
    extraction_source: 'rule_based' as const,
    extraction_stage: 'rule_based' as const,
    evidence_level: 'title_only' as const,
  })));

  emitProgress(callbacks, {
    phase: 'local_prescreen',
    label: '本地题名预筛与规则抽取',
    detail: `预筛完成：${articles.length} 篇均完成本地评分，题名抽取候选 ${titleCandidates.length} 个；最高分 ${rankedArticles[0]?.score ?? 0}。`,
    status: 'success',
    startedAt: titleStartedAt,
    durationMs: Date.now() - titleStartedAtMs,
    timeoutMs: 15_000,
    progress: 100,
  });
  callbacks?.onCandidates?.({
    candidates: finalizePubMedCandidates(titleCandidates),
    failedBatches: [],
    completedBatches: 0,
    totalBatches: 0,
  });

  const refinementArticles = selectRefinementArticles(rankedArticles, titleCandidates);
  const refinementBatches = chunkItems(refinementArticles, ABSTRACT_BATCH_SIZE);
  const refinementStartedAtMs = Date.now();
  const refinementStartedAt = new Date(refinementStartedAtMs).toISOString();
  emitProgress(callbacks, {
    phase: 'llm_abstract_refine',
    label: '小批量摘要验证',
    detail: `按本地得分选出 ${refinementArticles.length} 篇；共 ${refinementBatches.length} 批，每批最多 ${ABSTRACT_BATCH_SIZE} 篇，并发 ${EXTRACTION_CONCURRENCY}。`,
    status: 'running',
    startedAt: refinementStartedAt,
    timeoutMs: LLM_EXTRACTION_TIMEOUT_MS * Math.max(1, Math.ceil(refinementBatches.length / EXTRACTION_CONCURRENCY)),
    progress: 0,
  });

  let accumulatedCandidates = titleCandidates;
  const failedBatches: PubMedExtractionBatchFailure[] = [];
  const successfulExtractions: LlmExtractionResult[] = [];
  let completedBatches = 0;

  if (refinementBatches.length > 0) {
    await mapWithConcurrency(refinementBatches, EXTRACTION_CONCURRENCY, async (batch, batchIndex) => {
      throwIfAborted(signal);
      const batchPmids = new Set(batch.map((article) => article.pmid));
      const seeds = titleCandidates
        .filter((candidate) => batchPmids.has(candidate.pmid))
        .map(compactSeedCandidate);
      const compactArticles = batch.map((article) => compactArticleForAbstractExtraction(
        article,
        seeds.filter((seed) => seed.pmid === article.pmid),
      ));

      try {
        const data = await requestClaudeJsonExtraction(
          compactArticles,
          { ...options, extractionStage: 'abstract_refine', seedCandidates: seeds },
          signal,
        );
        const refinedCandidates = mapLlmExtractionToCandidates(data, batch, jobId, seeds);
        accumulatedCandidates = dedupeCandidates([...refinedCandidates, ...accumulatedCandidates]);
        successfulExtractions.push(data);
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) throw error;
        failedBatches.push({
          id: createId('abstract_batch'),
          batch_index: batchIndex + 1,
          pmids: batch.map((article) => article.pmid),
          articles: batch,
          seed_candidates: seeds,
          error_message: error instanceof Error ? error.message : '摘要抽取批次失败',
          created_at: new Date().toISOString(),
          retry_status: 'failed',
        });
      } finally {
        completedBatches += 1;
        callbacks?.onCandidates?.({
          candidates: finalizePubMedCandidates(accumulatedCandidates),
          failedBatches: [...failedBatches],
          completedBatches,
          totalBatches: refinementBatches.length,
        });
        emitProgress(callbacks, {
          phase: 'llm_abstract_refine',
          label: '小批量摘要验证',
          detail: `已完成 ${completedBatches}/${refinementBatches.length} 批；成功 ${successfulExtractions.length} 批，失败 ${failedBatches.length} 批。`,
          status: 'running',
          startedAt: refinementStartedAt,
          timeoutMs: LLM_EXTRACTION_TIMEOUT_MS * Math.max(1, Math.ceil(refinementBatches.length / EXTRACTION_CONCURRENCY)),
          progress: Math.round((completedBatches / refinementBatches.length) * 100),
        });
      }
    });
  } else {
    emitProgress(callbacks, {
      phase: 'llm_abstract_refine',
      label: '小批量摘要验证',
      detail: '没有同时具备规则候选和摘要证据的文章，保留题名规则候选。',
      status: 'success',
      startedAt: refinementStartedAt,
      durationMs: Date.now() - refinementStartedAtMs,
      timeoutMs: LLM_EXTRACTION_TIMEOUT_MS,
      progress: 100,
    });
  }

  if (failedBatches.length > 0) {
    accumulatedCandidates = markCandidatesForFailedPmids(
      accumulatedCandidates,
      new Set(failedBatches.flatMap((batch) => batch.pmids)),
    );
  }

  if (refinementBatches.length > 0) {
    emitProgress(callbacks, {
      phase: 'llm_abstract_refine',
      label: '小批量摘要验证',
      detail: failedBatches.length > 0
        ? `摘要验证部分完成：成功 ${successfulExtractions.length} 批，失败 ${failedBatches.length} 批；已保留前序结果，可单独重试失败批次。`
        : `摘要验证完成：${successfulExtractions.length} 批全部成功。`,
      status: failedBatches.length > 0 ? 'warning' : 'success',
      startedAt: refinementStartedAt,
      durationMs: Date.now() - refinementStartedAtMs,
      timeoutMs: LLM_EXTRACTION_TIMEOUT_MS * Math.max(1, Math.ceil(refinementBatches.length / EXTRACTION_CONCURRENCY)),
      progress: 100,
    });
  }

  callbacks?.onCandidates?.({
    candidates: finalizePubMedCandidates(accumulatedCandidates),
    failedBatches,
    completedBatches,
    totalBatches: refinementBatches.length,
  });

  const lastExtraction = successfulExtractions[successfulExtractions.length - 1];

  return {
    candidates: dedupeCandidates(accumulatedCandidates),
    failedBatches,
    refinementArticleCount: refinementArticles.length,
    successfulBatchCount: successfulExtractions.length,
    failedBatchCount: failedBatches.length,
    extractionProvider: lastExtraction?.extractionProvider,
    extractionModel: lastExtraction?.extractionModel,
    extractionInvocation: lastExtraction?.extractionInvocation
      ? `${lastExtraction.extractionInvocation}:local_title_then_abstract_batches`
      : 'local_rule_title_screen',
  };
}

function extractCandidatesWithRules(articles: NormalizedPubMedArticle[], jobId: string) {
  return dedupeCandidates(articles.flatMap((article) => extractVariableCandidatesFromArticle({
    pmid: article.pmid,
    title: article.title,
    abstract: article.abstract,
    journal: article.journal,
    publicationDate: article.publicationDate,
  }, jobId)));
}

async function runExistingPubMedSearch(
  options: PubMedDiscoveryOptions,
  jobId: string,
  callbacks?: PubMedDiscoveryRunCallbacks,
): Promise<PubMedDiscoveryResult> {
  const startedAt = new Date().toISOString();
  const queryText = buildPubMedVariableDiscoveryQuery(options);
  emitProgress(callbacks, {
    phase: 'prepare',
    label: '生成 PubMed 检索式',
    detail: queryText,
    status: 'success',
    durationMs: 0,
    progress: 100,
  });
  const searchConfig = buildPubMedNewsSearchConfig(options);
  const searchStartedAtMs = Date.now();
  const searchStartedAt = new Date(searchStartedAtMs).toISOString();
  emitProgress(callbacks, {
    phase: 'pubmed_search',
    label: '提交 PubMed 文献检索',
    detail: `${options.dateFrom} 至 ${options.dateTo}；${options.databaseFamilies?.length ? `数据库：${options.databaseFamilies.join(' / ')}` : '数据库：全部公共数据库'}`,
    status: 'running',
    startedAt: searchStartedAt,
    timeoutMs: PUBMED_SEARCH_TIMEOUT_MS,
    progress: 0,
  });
  throwIfAborted(callbacks?.signal);
  const response = await withAbortableRequest(
    callbacks?.signal,
    PUBMED_SEARCH_TIMEOUT_MS,
    'PubMed 文献检索超时，可能网络不通或 NCBI 访问受限。',
    (requestSignal) => api.news.search('pubmed', searchConfig, { signal: requestSignal }),
  );
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData?.error || 'PubMed search endpoint failed');
  }

  const data = await response.json() as NewsSearchResults;
  throwIfAborted(callbacks?.signal);
  const papers = Array.isArray(data.top_papers) ? data.top_papers : [];
  const articles = papers.map(normalizeArticle);
  const hitTotal = Number(data.total_found || data.total_filtered || papers.length);
  emitProgress(callbacks, {
    phase: 'pubmed_search',
    label: '提交 PubMed 文献检索',
    detail: `检索已完成（${options.dateFrom} 至 ${options.dateTo}），本轮返回 ${papers.length} 篇进入本地预筛。`,
    status: 'success',
    startedAt: searchStartedAt,
    durationMs: Date.now() - searchStartedAtMs,
    timeoutMs: PUBMED_SEARCH_TIMEOUT_MS,
    progress: 100,
  });
  emitProgress(callbacks, {
    phase: 'pubmed_results',
    label: 'PubMed 返回文献结果',
    detail: `命中文献 ${hitTotal} 篇，本地预筛 ${articles.length} 篇；按本地得分最多 ${MAX_REFINEMENT_ARTICLES} 篇进入摘要 LLM（其中至少 ${UNSEEDED_REFINEMENT_SLOTS} 个名额留给题名规则未命中的高分文献）。`,
    status: 'success',
    progress: 100,
  });

  let extracted: PubMedVariableCandidate[];
  let extractionSource: PubMedDiscoveryJob['extraction_source'] = 'claude_json';
  let extractionNote: string | undefined;
  let extractionProvider: string | undefined;
  let extractionModel: string | undefined;
  let extractionInvocation: string | undefined;
  let failedBatches: PubMedExtractionBatchFailure[] = [];
  let refinementArticleCount = 0;
  let successfulBatchCount = 0;
  let failedBatchCount = 0;
  const llmStartedAtMs = Date.now();
  const llmStartedAt = new Date(llmStartedAtMs).toISOString();
  try {
    emitProgress(callbacks, {
      phase: 'llm_extract',
      label: '变量抽取与摘要验证',
      detail: '先做本地题名规则抽取，再用小批量摘要 LLM 验证；死亡/生存期等结局端点会被排除。',
      status: 'running',
      startedAt: llmStartedAt,
      timeoutMs: LLM_EXTRACTION_TIMEOUT_MS * 2,
      progress: 0,
    });
    const llmExtraction = await extractCandidatesWithClaudeJson(articles, options, jobId, callbacks?.signal, callbacks);
    extracted = llmExtraction.candidates;
    extractionProvider = llmExtraction.extractionProvider;
    extractionModel = llmExtraction.extractionModel;
    extractionInvocation = llmExtraction.extractionInvocation;
    failedBatches = llmExtraction.failedBatches;
    refinementArticleCount = llmExtraction.refinementArticleCount;
    successfulBatchCount = llmExtraction.successfulBatchCount;
    failedBatchCount = llmExtraction.failedBatchCount;
    extractionSource = successfulBatchCount > 0 ? 'claude_json' : 'rule_based';
    extractionNote = failedBatchCount > 0
      ? `${failedBatchCount} 个摘要批次失败，已保留题名规则候选和其余成功批次；可单独重新抽取。`
      : successfulBatchCount === 0
        ? '本轮未调用摘要 LLM，候选来自本地题名规则抽取。'
        : undefined;
    emitProgress(callbacks, {
      phase: 'llm_extract',
      label: '变量抽取与摘要验证',
      detail: failedBatchCount > 0
        ? `抽取部分完成，候选 ${extracted.length} 个；${failedBatchCount} 个失败批次可重试。`
        : `抽取已完成，候选 ${extracted.length} 个。`,
      status: failedBatchCount > 0 ? 'warning' : 'success',
      startedAt: llmStartedAt,
      durationMs: Date.now() - llmStartedAtMs,
      timeoutMs: LLM_EXTRACTION_TIMEOUT_MS * 2,
      progress: 100,
    });
    emitProgress(callbacks, {
      phase: 'llm_complete',
      label: '摘要验证阶段完成',
      detail: `规则题名预抽取后，摘要验证 ${successfulBatchCount}/${successfulBatchCount + failedBatchCount} 批成功；模型 ${extractionModel || '未调用'}；调用方式 ${extractionInvocation || extractionProvider || 'local'}。`,
      status: failedBatchCount > 0 ? 'warning' : 'success',
      progress: 100,
    });
  } catch (error) {
    if (callbacks?.signal?.aborted || isAbortError(error)) {
      throw error;
    }
    extracted = extractCandidatesWithRules(articles, jobId);
    extractionSource = 'rule_based';
    const message = error instanceof Error ? error.message : 'Claude JSON extraction failed';
    extractionNote = `系统 Claude/LLM JSON 提取未完成，已使用规则预抽取：${message}`;
    emitProgress(callbacks, {
      phase: 'llm_extract',
      label: '变量抽取与摘要验证',
      detail: 'JSON 抽取未成功，已切换到规则预抽取。',
      status: 'warning',
      startedAt: llmStartedAt,
      durationMs: Date.now() - llmStartedAtMs,
      timeoutMs: LLM_EXTRACTION_TIMEOUT_MS * 2,
      progress: 100,
    });
    emitProgress(callbacks, {
      phase: 'rule_fallback',
      label: 'Claude JSON 未完成，切换规则预抽取',
      detail: extractionNote,
      status: 'warning',
      progress: 100,
    });
  }

  const matchStartedAtMs = Date.now();
  const matchStartedAt = new Date(matchStartedAtMs).toISOString();
  emitProgress(callbacks, {
    phase: 'match_existing',
    label: '匹配已有变量库并计算审核状态',
    detail: `候选 ${extracted.length} 个，开始去重、匹配已有变量和生成证据链接。`,
    status: 'running',
    startedAt: matchStartedAt,
    timeoutMs: 30_000,
    progress: 0,
  });
  throwIfAborted(callbacks?.signal);
  const candidates = finalizePubMedCandidates(extracted);

  if (candidates.length === 0) {
    throw new Error('PubMed 搜索成功，但返回文献中未抽取到变量候选');
  }

  const pendingReviewCount = candidates.filter((candidate) => candidate.review_status === 'pending').length;
  emitProgress(callbacks, {
    phase: 'match_existing',
    label: '匹配已有变量库并计算审核状态',
    detail: `已完成：候选 ${candidates.length} 个，待审核 ${pendingReviewCount} 个。`,
    status: 'success',
    startedAt: matchStartedAt,
    durationMs: Date.now() - matchStartedAtMs,
    timeoutMs: 30_000,
    progress: 100,
  });

  const matchedEvidence = candidates
    .filter((candidate) => candidate.match_status === 'matched' && candidate.matched_variable_id)
    .flatMap((candidate) => createEvidenceArticlesFromCandidate(candidate, candidate.matched_variable_id as string));

  const finishedAt = new Date().toISOString();

  return {
    job: {
      id: jobId,
      job_type: options.frequency,
      query_text: queryText,
      date_from: options.dateFrom,
      date_to: options.dateTo,
      total_articles: Number(data.total_found || data.total_filtered || papers.length),
      candidate_count: candidates.length,
      matched_existing_count: candidates.filter((candidate) => candidate.match_status === 'matched').length,
      pending_review_count: pendingReviewCount,
      status: failedBatchCount > 0 ? 'partial' : 'success',
      created_at: startedAt,
      finished_at: finishedAt,
      extraction_source: extractionSource,
      extraction_note: extractionNote,
      extraction_provider: extractionProvider,
      extraction_model: extractionModel,
      extraction_invocation: extractionInvocation,
      searched_article_count: articles.length,
      refinement_article_count: refinementArticleCount,
      successful_batch_count: successfulBatchCount,
      failed_batch_count: failedBatchCount,
    },
    candidates,
    matchedEvidence,
    trendPoints: buildTrendPoints(candidates),
    failedBatches,
  };
}

export async function runPubMedVariableDiscovery(
  options: PubMedDiscoveryOptions,
  callbacks?: PubMedDiscoveryRunCallbacks,
): Promise<PubMedDiscoveryResult> {
  const jobId = `job_pubmed_${options.frequency}_${Date.now()}`;

  try {
    throwIfAborted(callbacks?.signal);
    const result = await runExistingPubMedSearch(options, jobId, callbacks);
    throwIfAborted(callbacks?.signal);
    emitProgress(callbacks, {
      phase: 'completed',
      label: '本轮自动发现完成',
      detail: `检索 ${result.job.total_articles} 篇，发现 ${result.job.candidate_count} 个候选，待审核 ${result.job.pending_review_count} 个。`,
      status: result.job.status === 'partial' ? 'warning' : 'success',
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'PubMed discovery failed';
    if (callbacks?.signal?.aborted || isAbortError(error)) {
      emitProgress(callbacks, {
        phase: 'cancelled',
        label: '已暂停本轮自动发现',
        detail: '已取消前端等待中的 PubMed/LLM 请求；可调整网络或筛选条件后重新运行。',
        status: 'cancelled',
      });
      return createCancelledResult(options, jobId);
    }
    emitProgress(callbacks, {
      phase: 'failed',
      label: '本轮自动发现未产出候选',
      detail: message,
      status: 'error',
    });
    return createFallbackResult(options, jobId, message);
  }
}

export function calculateSummaryStats(job: PubMedDiscoveryJob, candidates: PubMedVariableCandidate[]): DiscoverySummaryStats {
  return {
    totalArticles: job.total_articles,
    candidateCount: job.candidate_count || candidates.length,
    matchedExistingCount: job.matched_existing_count || candidates.filter((candidate) => candidate.match_status === 'matched').length,
    pendingReviewCount: job.pending_review_count || candidates.filter((candidate) => candidate.review_status === 'pending').length,
  };
}

export function createEvidenceFromCandidate(
  candidate: PubMedVariableCandidate,
  variableId: string,
  evidenceOverride?: PubMedCandidateEvidence,
): VariableEvidenceArticle {
  const evidence = evidenceOverride;
  return {
    id: createId('evidence'),
    variable_id: variableId,
    pmid: evidence?.pmid || candidate.pmid,
    title: evidence?.title || candidate.title,
    journal: evidence?.journal || candidate.journal,
    publication_year: evidence?.publication_year || candidate.publication_year,
    publication_date: evidence?.publication_date || candidate.publication_date,
    abstract: evidence?.abstract || candidate.abstract,
    database_used: evidence?.database_family_guess || candidate.database_family_guess,
    exposure_variable: candidate.variable_type_guess === 'outcome' ? undefined : candidate.canonical_name_guess,
    outcome_variable: candidate.variable_type_guess === 'outcome' ? candidate.canonical_name_guess : undefined,
    study_type: 'cohort',
    evidence_role: candidate.variable_type_guess === 'outcome' ? 'definition' : 'application',
    relevance_score: evidence?.confidence_score ?? candidate.confidence_score,
    is_key_reference: (evidence?.confidence_score ?? candidate.confidence_score) >= 0.9,
    import_source: 'pubmed_auto_discovery',
    created_at: new Date().toISOString(),
  };
}

export function createEvidenceArticlesFromCandidate(
  candidate: PubMedVariableCandidate,
  variableId: string,
) {
  const evidenceArticles = candidate.evidence_articles?.length ? candidate.evidence_articles : [undefined];
  return evidenceArticles.map((evidence) => createEvidenceFromCandidate(candidate, variableId, evidence));
}

export function addCandidateToPool(candidate: PubMedVariableCandidate) {
  const updatedAt = new Date().toISOString();
  const updatedCandidate: PubMedVariableCandidate = {
    ...normalizeCandidateDatabaseFamilies(candidate),
    match_status: 'added_to_candidate_pool',
    review_status: 'accepted',
    updated_at: updatedAt,
  };

  const auditLog: CandidateAuditLogEntry = {
    id: createId('audit'),
    candidateId: candidate.id,
    action: 'add_to_pool',
    note: 'Accepted into candidate pool. Stable variable library write is intentionally blocked.',
    createdAt: updatedAt,
  };

  return { candidate: updatedCandidate, auditLog };
}

export function mergeCandidateToExistingVariable(
  candidate: PubMedVariableCandidate,
  variableId = candidate.matched_variable_id || `variable_${candidate.canonical_name_guess.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
) {
  const updatedAt = new Date().toISOString();
  const normalized = normalizeCandidateDatabaseFamilies(candidate);
  const updatedCandidate: PubMedVariableCandidate = {
    ...normalized,
    match_status: 'merged',
    review_status: 'merged',
    matched_variable_id: variableId,
    updated_at: updatedAt,
  };

  const evidences = createEvidenceArticlesFromCandidate(normalized, variableId);
  const evidence = evidences[0];
  const auditLog: CandidateAuditLogEntry = {
    id: createId('audit'),
    candidateId: candidate.id,
    action: 'merge_existing',
    note: `Merged PubMed evidence into ${variableId}.`,
    createdAt: updatedAt,
  };

  return { candidate: updatedCandidate, evidence, evidences, auditLog };
}

export function markCandidateAmbiguous(candidate: PubMedVariableCandidate, note: string) {
  const updatedAt = new Date().toISOString();
  const updatedCandidate: PubMedVariableCandidate = {
    ...candidate,
    match_status: 'ambiguous',
    ambiguity_notes: note || candidate.ambiguity_notes || 'Marked ambiguous during candidate review.',
    updated_at: updatedAt,
  };

  const auditLog: CandidateAuditLogEntry = {
    id: createId('audit'),
    candidateId: candidate.id,
    action: 'mark_ambiguous',
    note: updatedCandidate.ambiguity_notes,
    createdAt: updatedAt,
  };

  return { candidate: updatedCandidate, auditLog };
}

export function ignoreCandidate(candidate: PubMedVariableCandidate) {
  const updatedAt = new Date().toISOString();
  const updatedCandidate: PubMedVariableCandidate = {
    ...candidate,
    match_status: 'ignored',
    review_status: 'ignored',
    updated_at: updatedAt,
  };

  const auditLog: CandidateAuditLogEntry = {
    id: createId('audit'),
    candidateId: candidate.id,
    action: 'ignore',
    note: 'Ignored without deleting the raw discovery record.',
    createdAt: updatedAt,
  };

  return { candidate: updatedCandidate, auditLog };
}
