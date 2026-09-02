export const PUBMED_VARIABLE_EXTRACTION_PROMPT_VERSION = 'pubmed-variable-json-v7';
export const PUBMED_TARGET_INPUT_TOKENS = 8_000;
export const PUBMED_HARD_INPUT_TOKENS = 12_000;

export function estimatePubMedPromptTokens(text = '') {
  return Math.ceil(String(text).length / 3.5);
}

export class PromptBudgetExceededError extends Error {
  constructor(estimatedTokens, hardLimit = PUBMED_HARD_INPUT_TOKENS) {
    super(`PubMed extraction prompt is estimated at ${estimatedTokens} tokens, above the hard limit of ${hardLimit}.`);
    this.name = 'PromptBudgetExceededError';
    this.statusCode = 413;
    this.estimatedTokens = estimatedTokens;
    this.hardLimit = hardLimit;
  }
}

function compactPromptArticle(article = {}) {
  return {
    pmid: String(article.pmid || ''),
    title: String(article.title || ''),
    evidence_text: String(article.evidence_text || article.abstract || ''),
  };
}

function compactPromptSeed(seed = {}) {
  return {
    pmid: String(seed.pmid || ''),
    raw_name: String(seed.raw_name || ''),
    canonical_name: String(seed.canonical_name_guess || seed.canonical_name || ''),
    type: String(seed.variable_type_guess || ''),
  };
}

export function buildPubMedVariableExtractionPrompt({
  articles = [],
  variableKeyword = '',
  extractionStage = 'abstract_refine',
  seedCandidates = [],
}) {
  const payload = {
    extraction_stage: extractionStage,
    variable_keyword: String(variableKeyword || ''),
    seed_candidates: seedCandidates.map(compactPromptSeed),
    articles: articles.map(compactPromptArticle),
  };

  return `Extract reproducible biomedical variables from the supplied PubMed evidence.

Return JSON only.

Include:
- raw variables
- ratios and derived indices
- composite or risk scores
- covariates or stratifiers only when explicitly named

Exclude:
- mortality, survival, hospitalization, and other endpoints
- OR, HR, RR, confidence intervals, and p-values
- generic words such as biomarker, predictor, index, or score without a specific name
- unsupported inferred variables

Rules:
- Seed candidates are hints from a keyword pre-screen. They are often incomplete or wrong.
- Validate each seed, and also report any other qualifying variable the supplied text names, even when no seed mentions it.
- When a seed is not supported by the text, drop that seed and keep the variables that are supported.
- Only report variables named in the supplied title or evidence_text. Never infer one from background knowledge.
- Expand abbreviations only when the supplied text contains the long form; otherwise keep the abbreviation and set ambiguous=true.
- Every candidate must contain one verbatim sentence copied from the supplied title or evidence_text, with no edits.
- Copy formula_text verbatim when the text defines how the variable is computed; otherwise leave it empty.
- Return an empty candidates array only when the supplied text names no qualifying variable at all.

JSON schema:
{
  "candidates": [
    {
      "pmid": "string",
      "raw_name": "string",
      "canonical_name_guess": "string",
      "variable_type_guess": "raw_field | derived_index | risk_score | covariate | stratifier",
      "evidence_sentence": "verbatim sentence",
      "formula_text": "string or empty",
      "confidence_score": 0.0,
      "ambiguous": false,
      "ambiguity_notes": "string or empty"
    }
  ]
}

Input:
${JSON.stringify(payload)}`;
}

export function buildPubMedExtractionPromptBatches({
  articles = [],
  variableKeyword = '',
  extractionStage = 'abstract_refine',
  seedCandidates = [],
  targetTokens = PUBMED_TARGET_INPUT_TOKENS,
  hardTokens = PUBMED_HARD_INPUT_TOKENS,
}) {
  const batches = [];
  let currentArticles = [];

  const buildBatch = (batchArticles) => {
    const pmids = new Set(batchArticles.map((article) => String(article.pmid || '')));
    const batchSeeds = seedCandidates.filter((seed) => pmids.has(String(seed.pmid || '')));
    const prompt = buildPubMedVariableExtractionPrompt({
      articles: batchArticles,
      variableKeyword,
      extractionStage,
      seedCandidates: batchSeeds,
    });
    return {
      articles: batchArticles,
      seedCandidates: batchSeeds,
      prompt,
      estimatedTokens: estimatePubMedPromptTokens(prompt),
    };
  };

  const pushCurrent = () => {
    if (currentArticles.length === 0) return;
    const batch = buildBatch(currentArticles);
    if (batch.estimatedTokens > hardTokens) {
      throw new PromptBudgetExceededError(batch.estimatedTokens, hardTokens);
    }
    batches.push(batch);
    currentArticles = [];
  };

  for (const article of articles) {
    const trial = buildBatch([...currentArticles, article]);
    if (trial.estimatedTokens > targetTokens && currentArticles.length > 0) {
      pushCurrent();
      currentArticles = [article];
    } else {
      currentArticles.push(article);
    }
  }
  pushCurrent();
  return batches;
}
