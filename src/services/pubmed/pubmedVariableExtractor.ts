import type {
  PubMedVariableCandidate,
  VariableCandidateMatchStatus,
  VariableType,
} from '../../features/variableKnowledge/pubmedDiscovery/types';
import { inferDatabaseFamiliesFromText } from '../../../shared/publicDatabaseCatalog';

export type PubMedArticleLike = {
  pmid: string;
  title: string;
  abstract?: string;
  journal?: string;
  publicationDate?: string;
};

type VariableNameInfo = { canonical: string; zh: string; type: VariableType; aliases?: string[] };

const VARIABLE_NAME_MAP: Record<string, VariableNameInfo> = {
  tyg: { canonical: 'TyG', zh: '甘油三酯葡萄糖指数', type: 'derived_index' },
  'tyg-bmi': { canonical: 'TyG-BMI', zh: 'TyG-BMI 指数', type: 'derived_index' },
  'tyg-whtr': { canonical: 'TyG-WHtR', zh: 'TyG-腰高比指数', type: 'derived_index' },
  nhhr: { canonical: 'NHHR', zh: '非高密度脂蛋白/高密度脂蛋白比值', type: 'derived_index' },
  rar: { canonical: 'RAR', zh: '红细胞分布宽度/白蛋白比值', type: 'derived_index' },
  car: { canonical: 'CAR', zh: 'C 反应蛋白/白蛋白比值', type: 'derived_index' },
  lar: { canonical: 'LAR', zh: '乳酸脱氢酶/白蛋白比值', type: 'derived_index' },
  npr: { canonical: 'NPR', zh: '中性粒细胞/前白蛋白比值', type: 'derived_index' },
  nlr: { canonical: 'NLR', zh: '中性粒细胞/淋巴细胞比值', type: 'derived_index' },
  plr: { canonical: 'PLR', zh: '血小板/淋巴细胞比值', type: 'derived_index' },
  sii: { canonical: 'SII', zh: '系统免疫炎症指数', type: 'derived_index' },
  uhr: { canonical: 'UHR', zh: '尿酸/高密度脂蛋白比值', type: 'derived_index' },
  fli: { canonical: 'FLI', zh: '脂肪肝指数', type: 'risk_score' },
  vai: { canonical: 'VAI', zh: '内脏脂肪指数', type: 'derived_index' },
  cvai: { canonical: 'CVAI', zh: '中国内脏脂肪指数', type: 'derived_index' },
  wwi: { canonical: 'WWI', zh: '体重调整腰围指数', type: 'derived_index' },
  bri: { canonical: 'BRI', zh: '身体圆度指数', type: 'derived_index' },
  absi: { canonical: 'ABSI', zh: '体型指数', type: 'derived_index' },
  'fib-4': { canonical: 'FIB-4', zh: '纤维化 4 指数', type: 'risk_score' },
  bmi: { canonical: 'BMI', zh: '体质指数', type: 'raw_field' },
  'body-mass-index': { canonical: 'BMI', zh: '体质指数', type: 'raw_field' },
  'cha2ds2-vasc': { canonical: 'CHA2DS2-VASc', zh: 'CHA2DS2-VASc 评分', type: 'risk_score' },
  'triglyceride-glucose-index': { canonical: 'TyG', zh: '甘油三酯葡萄糖指数', type: 'derived_index', aliases: ['triglyceride glucose index'] },
  'triglyceride-glucose-bmi-index': { canonical: 'TyG-BMI', zh: 'TyG-BMI 指数', type: 'derived_index', aliases: ['triglyceride glucose BMI index'] },
  'triglyceride-glucose-waist-to-height-ratio-index': { canonical: 'TyG-WHtR', zh: 'TyG-腰高比指数', type: 'derived_index', aliases: ['triglyceride glucose waist-to-height ratio index'] },
  'non-hdl-c/hdl-c-ratio': { canonical: 'NHHR', zh: '非高密度脂蛋白/高密度脂蛋白比值', type: 'derived_index', aliases: ['non-HDL-C/HDL-C ratio'] },
  'non-hdl-cholesterol-to-hdl-cholesterol-ratio': { canonical: 'NHHR', zh: '非高密度脂蛋白/高密度脂蛋白比值', type: 'derived_index' },
  'red-cell-distribution-width-to-albumin-ratio': { canonical: 'RAR', zh: '红细胞分布宽度/白蛋白比值', type: 'derived_index' },
  'c-reactive-protein-to-albumin-ratio': { canonical: 'CAR', zh: 'C 反应蛋白/白蛋白比值', type: 'derived_index' },
  'systemic-immune-inflammation-index': { canonical: 'SII', zh: '系统免疫炎症指数', type: 'derived_index' },
  'neutrophil-to-lymphocyte-ratio': { canonical: 'NLR', zh: '中性粒细胞/淋巴细胞比值', type: 'derived_index' },
  'platelet-to-lymphocyte-ratio': { canonical: 'PLR', zh: '血小板/淋巴细胞比值', type: 'derived_index' },
  'fatty-liver-index': { canonical: 'FLI', zh: '脂肪肝指数', type: 'risk_score' },
  'fibrosis-4-index': { canonical: 'FIB-4', zh: '纤维化 4 指数', type: 'risk_score' },
  'body-roundness-index': { canonical: 'BRI', zh: '身体圆度指数', type: 'derived_index' },
  'weight-adjusted-waist-index': { canonical: 'WWI', zh: '体重调整腰围指数', type: 'derived_index' },
  'dti-alps-index': { canonical: 'DTI-ALPS index', zh: 'DTI-ALPS 指数', type: 'derived_index' },
  'metabolic-vulnerability-index': { canonical: 'metabolic vulnerability index', zh: '代谢脆弱性指数', type: 'derived_index' },
};

const AMBIGUOUS_ABBREVIATIONS = new Set(['car', 'rar', 'bag', 'aip', 'nlr', 'plr', 'sii']);

const ABBREVIATION_PATTERN =
  /\b(TyG(?:[-_\s]?(?:BMI|WHtR))?|NHHR|UHR|RAR|CAR|LAR|NPR|NLR|PLR|SII|AIP|FIB[-_\s]?4|PALBI|VAI|CVAI|WWI|BRI|ABSI|CHA2DS2[-_\s]?VASc|FLI)\b/g;

const METRIC_PHRASE_PATTERN =
  /\b([A-Za-z][A-Za-z0-9\-\/]{1,}(?:\s+(?:to|and|of|[A-Za-z][A-Za-z0-9\-\/]{1,})){0,5})\s+(index|score|ratio|biomarker|marker)\b/gi;

const BAD_PHRASE_STARTERS = new Set([
  'a',
  'after',
  'an',
  'analysis',
  'and',
  'as',
  'association',
  'associations',
  'based',
  'between',
  'by',
  'clinical',
  'effect',
  'effects',
  'evaluating',
  'findings',
  'for',
  'from',
  'function',
  'further',
  'higher',
  'identifying',
  'in',
  'largely',
  'linking',
  'lower',
  'novel',
  'nationwide',
  'of',
  'on',
  'our',
  'patients',
  'predicting',
  'relationship',
  'risk',
  'study',
  'the',
  'this',
  'to',
  'using',
  'via',
  'while',
  'we',
  'with',
]);

const LEADING_FILLER_TOKENS = new Set([
  ...BAD_PHRASE_STARTERS,
  'about',
  'across',
  'amid',
  'among',
  'amongst',
  'are',
  'assessing',
  'at',
  'be',
  'been',
  'being',
  'both',
  'but',
  'can',
  'comparing',
  'could',
  'did',
  'do',
  'does',
  'during',
  'emerging',
  'evidence',
  'examining',
  'exploring',
  'had',
  'has',
  'have',
  'how',
  'insights',
  'into',
  'investigating',
  'is',
  'may',
  'might',
  'onto',
  'or',
  'over',
  'should',
  'than',
  'that',
  'these',
  'those',
  'through',
  'under',
  'versus',
  'vs',
  'was',
  'were',
  'what',
  'when',
  'where',
  'whether',
  'which',
  'who',
  'will',
  'within',
  'without',
  'would',
]);

const STATISTICAL_RATIO_PREFIXES = new Set([
  'adjusted',
  'confidence',
  'hazard',
  'incidence',
  'odds',
  'prevalence',
  'rate',
  'relative',
  'risk',
  'standardized',
  'unadjusted',
]);

const GENERIC_MARKER_MODIFIERS = new Set([
  'candidate',
  'diagnostic',
  'novel',
  'potential',
  'predictive',
  'prognostic',
  'promising',
  'reliable',
  'specific',
]);

const GENERIC_SCORE_PREFIXES = new Set([
  'clinical',
  'composite',
  'global',
  'nationwide',
  'overall',
  'prediction',
  'predictive',
  'propensity',
  'risk',
  'standard',
  'total',
]);

const NON_VARIABLE_OUTCOME_PATTERN =
  /\b(all[-\s]cause mortality|cardiovascular mortality|cancer[-\s]specific mortality|mortality|death|overall survival|disease[-\s]free survival|progression[-\s]free survival|event[-\s]free survival|recurrence[-\s]free survival|survival|major adverse cardiovascular events|mace|acute kidney injury|stroke incidence|heart failure hospitalization|hospitalization|follow[-\s]?up time|outcome endpoint|endpoint)\b/i;

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function createId(prefix: string) {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function escapeRegex(value: string) {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function toLookupKey(rawName: string) {
  return String(rawName || '')
    .trim()
    .replace(/[＿_]+/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, '-')
    .toLowerCase();
}

function getVariableNameInfo(rawName: string) {
  return VARIABLE_NAME_MAP[toLookupKey(rawName)];
}

function createFlexibleNameRegex(rawName: string) {
  const normalized = normalizeVariableName(rawName);
  const flexible = normalized
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(escapeRegex)
    .join('[-\\s]+');
  return new RegExp(flexible || escapeRegex(normalized), 'i');
}

function splitSentences(text = '') {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeVariableName(rawName: string) {
  const cleaned = String(rawName || '')
    .trim()
    .replace(/[＿_]+/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, ' ');

  const compact = cleaned.replace(/\s+/g, '-');
  const key = compact.toLowerCase();
  if (key === 'tygwhtr' || key === 'tyg-whtr') return 'TyG-WHtR';
  if (key === 'tygbmi' || key === 'tyg-bmi') return 'TyG-BMI';
  if (key === 'fib4' || key === 'fib-4') return 'FIB-4';
  if (key === 'cha2ds2-vasc' || key === 'cha2ds2vasc') return 'CHA2DS2-VASc';

  const mapped = getVariableNameInfo(compact);
  if (mapped) {
    return mapped.canonical;
  }

  if (/^[A-Z0-9-]{2,}$/.test(compact)) {
    return compact.toUpperCase();
  }

  return cleaned;
}

export function inferVariableType(rawName: string, context = ''): VariableType {
  const normalized = normalizeVariableName(rawName).toLowerCase();
  const mapped = getVariableNameInfo(normalized);
  if (mapped) return mapped.type;

  if (/\b(score|risk score|nomogram|classifier|fli|fib-4)\b/i.test(rawName)) return 'risk_score';
  if (/\b(index|ratio|biomarker|marker)\b/i.test(rawName)) return 'derived_index';
  return 'raw_field';
}

export function inferDatabaseFamilies(text = '') {
  return inferDatabaseFamiliesFromText(text);
}

export function findEvidenceSentence(rawName: string, article: PubMedArticleLike) {
  const nameRegex = createFlexibleNameRegex(rawName);
  const sentences = splitSentences(`${article.title}. ${article.abstract || ''}`);
  return sentences.find((sentence) => nameRegex.test(sentence))
    || sentences.find((sentence) => /\b(index|score|ratio|mortality|outcome|biomarker)\b/i.test(sentence))
    || sentences[0]
    || '';
}

export function scoreCandidateConfidence(rawName: string, article: PubMedArticleLike, matchedExisting = false) {
  const title = article.title || '';
  const abstract = article.abstract || '';
  const context = `${title} ${abstract}`;
  const canonical = normalizeVariableName(rawName);
  const nameRegex = createFlexibleNameRegex(canonical);

  let score = 0.3;
  if (nameRegex.test(title)) score += 0.35;
  if (nameRegex.test(abstract)) score += 0.25;
  if (inferDatabaseFamilies(context).length > 0) score += 0.15;
  if (/\b(outcome|mortality|cohort|prospective|retrospective)\b/i.test(context)) score += 0.1;
  if (matchedExisting) score += 0.15;
  if (AMBIGUOUS_ABBREVIATIONS.has(canonical.toLowerCase())) score -= 0.25;
  if (!findEvidenceSentence(rawName, article)) score -= 0.15;
  return Number(clamp(score).toFixed(2));
}

function inferMatchStatus(rawName: string, confidence: number): VariableCandidateMatchStatus {
  const normalized = normalizeVariableName(rawName).toLowerCase();
  if (AMBIGUOUS_ABBREVIATIONS.has(normalized)) return confidence >= 0.65 ? 'ambiguous' : 'manual_review';
  if (confidence < 0.6) return 'manual_review';
  return 'new';
}

export function isLikelyAbbreviationToken(rawName: string) {
  const trimmed = rawName.trim();
  if (/^TyG(?:[-_\s]?(?:BMI|WHtR))?$/i.test(trimmed)) return true;
  if (/^CHA2DS2[-_\s]?VASc$/i.test(trimmed)) return true;
  return /^[A-Z][A-Z0-9-]{1,}$/.test(trimmed.replace(/[-_\s]+/g, '-'));
}

function isLikelySpecificMarker(prefix: string) {
  if (/[A-Z]{2,}|\d|\/|-/.test(prefix)) return true;
  return /\b(albumin|cholesterol|creatinine|c-reactive|glucose|hemoglobin|lymphocyte|neutrophil|platelet|protein|triglyceride)\b/i.test(prefix);
}

function trimLeadingFillerWords(phrase: string) {
  let words = phrase.trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && LEADING_FILLER_TOKENS.has(words[0].toLowerCase())) {
    words = words.slice(1);
  }
  return words.join(' ');
}

function cleanMetricPrefix(prefix: string) {
  let cleaned = prefix.trim().replace(/\s+/g, ' ');
  const contextTrimPatterns = [
    /\b(?:findings|results?)\s+(?:revealed|showed|suggested|indicated|demonstrated)\s+(?:that\s+)?(?:the\s+)?(.+)$/i,
    /\b(?:largely|partly|mostly)\s+accounted\s+for\s+by\s+(?:the\s+)?(.+)$/i,
    /\badjust(?:ed|ment)?\s+for\s+(?:the\s+)?(.+)$/i,
    /\bwhile\s+(?:the\s+)?(.+)$/i,
    /\b(?:analysis|analyses|model|models|results?|study)\s+(?:identified|identify|showed|found|reported|using)\s+(?:the\s+)?(.+)$/i,
    /\b(?:assessed|evaluated|measured|predicted|estimated|quantified)\s+(?:by|with|using|via)\s+(?:the\s+)?(.+)$/i,
    /\b(?:using|via|through|according to|based on)\s+(?:the\s+)?(.+)$/i,
    /\b(?:identified|including|include|called|named)\s+(?:the\s+)?(.+)$/i,
    /\blink(?:ing|ed)?\s+(?:the\s+)?(.+)$/i,
  ];

  for (const pattern of contextTrimPatterns) {
    const match = cleaned.match(pattern);
    if (match?.[1]) {
      cleaned = match[1].trim();
    }
  }

  return trimLeadingFillerWords(cleaned);
}

function isBlockedMetricCandidate(rawPhrase: string) {
  const normalized = rawPhrase
    .trim()
    .replace(/[/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();

  if (!normalized) return true;
  if (/\bpropensity score\b/.test(normalized)) return true;
  if (/\b(odds|hazard|risk|rate|prevalence|incidence)\s+ratio\b/.test(normalized)) return true;
  if (/^(?:composite|prediction|predictive|clinical|overall|global|total|standard)\s+(?:index|score|marker|biomarker)$/.test(normalized)) {
    return true;
  }
  return false;
}

function isLikelyMetricPhrase(prefix: string, suffix: string) {
  const cleanedPrefix = cleanMetricPrefix(prefix);
  const rawPhrase = `${cleanedPrefix} ${suffix}`.trim();
  const normalized = normalizeVariableName(rawPhrase);
  if (getVariableNameInfo(rawPhrase) || getVariableNameInfo(normalized)) return true;
  if (isBlockedMetricCandidate(rawPhrase)) return false;

  const words = rawPhrase
    .replace(/[/-]/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean);
  if (words.length < 2 || words.length > 7) return false;
  if (BAD_PHRASE_STARTERS.has(words[0])) return false;
  if (words.some((word) => /\b(associated|association|outcome|patient|patients|study|survival)\b/i.test(word))) return false;

  const suffixLower = suffix.toLowerCase();
  if (suffixLower === 'score') {
    const meaningfulWords = words.filter((word) => word !== suffixLower);
    if (meaningfulWords.length <= 1 && GENERIC_SCORE_PREFIXES.has(meaningfulWords[0])) {
      return false;
    }
  }

  if (suffixLower === 'ratio') {
    const firstMeaningfulWord = words.find((word) => word !== 'to' && word !== 'and' && word !== 'of') || '';
    if (STATISTICAL_RATIO_PREFIXES.has(firstMeaningfulWord)) return false;
    if (!/\/|\bto\b/i.test(cleanedPrefix) && !isLikelySpecificMarker(cleanedPrefix)) return false;
  }

  if (suffixLower === 'biomarker' || suffixLower === 'marker') {
    const meaningfulWords = words.filter((word) => word !== suffixLower);
    if (meaningfulWords.length <= 1 && meaningfulWords.every((word) => GENERIC_MARKER_MODIFIERS.has(word))) {
      return false;
    }
    return isLikelySpecificMarker(cleanedPrefix);
  }

  return suffixLower === 'index' || suffixLower === 'score' || suffixLower === 'ratio';
}

function shouldRejectCandidateName(rawName: string) {
  const normalized = rawName
    .trim()
    .replace(/[/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  if (!normalized) return true;
  if (NON_VARIABLE_OUTCOME_PATTERN.test(normalized)) return true;
  if (isBlockedMetricCandidate(normalized)) return true;
  if (/^(?:after|findings|largely|nationwide|while)\b/.test(normalized)) return true;
  if (normalized.split(/\s+/).length > 7) return true;
  return false;
}

function addCandidateName(names: Map<string, string>, rawName: string) {
  const normalized = normalizeVariableName(rawName);
  if (!normalized || normalized.length < 2) return;
  if (shouldRejectCandidateName(normalized)) return;
  const key = normalized.toLowerCase();
  if (!names.has(key)) names.set(key, normalized);
}

export function extractVariableCandidatesFromArticle(article: PubMedArticleLike, jobId: string): PubMedVariableCandidate[] {
  const text = `${article.title || ''}. ${article.abstract || ''}`;
  const names = new Map<string, string>();

  for (const match of text.matchAll(ABBREVIATION_PATTERN)) {
    if (isLikelyAbbreviationToken(match[1])) {
      addCandidateName(names, match[1]);
    }
  }

  for (const match of text.matchAll(METRIC_PHRASE_PATTERN)) {
    const cleanedPrefix = cleanMetricPrefix(match[1]);
    if (isLikelyMetricPhrase(cleanedPrefix, match[2])) {
      addCandidateName(names, `${cleanedPrefix} ${match[2]}`);
    }
  }

  return Array.from(names.values()).map((name) => {
    const mapped = getVariableNameInfo(name);
    const evidenceSentence = findEvidenceSentence(name, article);
    const confidence = scoreCandidateConfidence(name, article);
    const typeGuess = inferVariableType(name, text);
    const now = new Date().toISOString();

    return {
      id: createId('candidate'),
      job_id: jobId,
      pmid: article.pmid,
      title: article.title,
      abstract: article.abstract,
      journal: article.journal,
      publication_date: article.publicationDate,
      publication_year: article.publicationDate ? Number(article.publicationDate.slice(0, 4)) : undefined,
      raw_name: name,
      canonical_name_guess: mapped?.canonical || name,
      display_name_zh_guess: mapped?.zh || name,
      display_name_en_guess: mapped?.canonical || name,
      variable_type_guess: typeGuess,
      database_family_guess: inferDatabaseFamilies(text),
      clinical_domain_guess: [],
      role_guess: typeGuess === 'outcome' ? ['结局变量'] : ['暴露', '候选变量'],
      evidence_sentence: evidenceSentence,
      confidence_score: confidence,
      match_status: inferMatchStatus(name, confidence),
      review_status: 'pending',
      ambiguity_notes: AMBIGUOUS_ABBREVIATIONS.has(name.toLowerCase()) ? '缩写存在多义性，需要人工确认上下文。' : undefined,
      extraction_source: 'rule_based',
      created_at: now,
      updated_at: now,
    };
  });
}
