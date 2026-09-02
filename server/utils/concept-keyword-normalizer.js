const EDGE_STOP_WORDS = new Set([
  'and',
  'or',
  'on',
  'of',
  'for',
  'to',
  'in',
  'with',
  'without',
  'by',
  'via',
  'from',
  'into',
  'among',
  'between',
]);

const GENERIC_LEADING_WORDS = new Set([
  'novel',
  'new',
  'latest',
  'emerging',
  'potential',
  'possible',
  'promising',
  'candidate',
  'putative',
]);

const RELATION_PREFIX_PATTERNS = [
  /^(?:association|associations|relationship|relationships|correlation|correlations|role|impact|effect|effects|utility|use|evaluation|assessment|analysis|analyses|profiling|overview|evidence)\s+(?:of|for|between)\s+/i,
  /^(?:prediction|predictive value|prognostic value|diagnostic value)\s+of\s+/i,
  /^(?:predicting|profiling|assessing|evaluating|monitoring)\s+/i,
  /^(?:risk|risks)\s+of\s+/i,
];

const TYPE_ANCHORS = {
  indicator: ['biomarker', 'marker', 'ratio', 'index', 'panel', 'signature'],
  risk_score: ['score', 'model', 'nomogram', 'classifier', 'signature', 'scale'],
  outcome: ['mortality', 'survival', 'response', 'recurrence', 'progression', 'readmission', 'hospitalization', 'death', 'remission'],
};

const TYPE_GENERIC_TERMS = {
  indicator: new Set(['biomarker', 'marker', 'ratio', 'index', 'panel', 'signature']),
  drug: new Set(['drug', 'treatment', 'therapy', 'medication', 'compound', 'agent']),
  disease: new Set(['disease', 'disorder', 'syndrome', 'cancer', 'infection']),
  subtype: new Set(['subtype', 'phenotype', 'variant', 'endotype']),
  stratifier: new Set(['patients', 'people', 'subjects', 'cohort', 'population']),
  risk_score: new Set(['score', 'model', 'nomogram', 'classifier', 'signature', 'scale']),
  outcome: new Set(['outcome']),
};

const TYPE_SIGNAL_PATTERNS = {
  disease: /\b(disease|disorder|disorders|cancer|carcinoma|anemia|diabetes|obesity|hypertension|infection|dementia|depression|syndrome|cirrhosis|arthritis|stroke|steatosis|gravis)\b/i,
  risk_score: /\b(score|model|nomogram|classifier|signature|scale)\b/i,
  outcome: /\b(mortality|survival|response|recurrence|progression|readmission|hospitalization|death|remission)\b/i,
  stratifier: /\b(adolescents?|adults?|older adults?|older people|women|men|children|patients?|cohort|population|pregnan\w+|postpartum)\b/i,
};

const TYPE_SIGNAL_TOKENS = {
  disease: new Set(['disease', 'disorder', 'disorders', 'cancer', 'carcinoma', 'anemia', 'diabetes', 'obesity', 'hypertension', 'infection', 'dementia', 'depression', 'syndrome', 'cirrhosis', 'arthritis', 'stroke', 'steatosis', 'gravis']),
};

function collapseWhitespace(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stripOuterNoise(value = '') {
  return collapseWhitespace(
    String(value || '')
      .replace(/^[\s\-–—:;,.()[\]{}]+|[\s\-–—:;,.()[\]{}]+$/g, '')
      .replace(/^(a|an|the)\s+/i, ''),
  );
}

function trimEdgeStopWords(value = '') {
  const tokens = collapseWhitespace(value).split(' ').filter(Boolean);
  while (tokens.length > 0 && EDGE_STOP_WORDS.has(tokens[0].toLowerCase())) {
    tokens.shift();
  }
  while (tokens.length > 0 && EDGE_STOP_WORDS.has(tokens[tokens.length - 1].toLowerCase())) {
    tokens.pop();
  }
  return tokens.join(' ');
}

function stripLeadingGenericWords(value = '') {
  const tokens = collapseWhitespace(value).split(' ').filter(Boolean);
  while (tokens.length > 1 && GENERIC_LEADING_WORDS.has(tokens[0].toLowerCase())) {
    tokens.shift();
  }
  return tokens.join(' ');
}

function stripRelationPrefixes(value = '') {
  let normalized = collapseWhitespace(value);
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of RELATION_PREFIX_PATTERNS) {
      const nextValue = normalized.replace(pattern, '');
      if (nextValue !== normalized) {
        normalized = collapseWhitespace(nextValue);
        changed = true;
      }
    }
  }
  return normalized;
}

function getContextBreakWords(candidateType = null) {
  const base = ['for', 'from', 'via', 'using', 'among', 'between', 'across', 'after', 'before', 'during', 'under', 'within', 'versus', 'vs', 'against'];

  if (candidateType === 'disease' || candidateType === 'subtype') {
    return [...base, 'in'];
  }

  if (candidateType === 'indicator' || candidateType === 'risk_score' || candidateType === 'outcome' || candidateType === 'drug' || candidateType === 'stratifier') {
    return [...base, 'in', 'with', 'without'];
  }

  return [...base, 'in'];
}

function trimAtContextBreak(value = '', candidateType = null) {
  const tokens = collapseWhitespace(value).split(' ').filter(Boolean);
  const breakWords = new Set(getContextBreakWords(candidateType));
  for (let index = 1; index < tokens.length; index += 1) {
    if (breakWords.has(tokens[index].toLowerCase())) {
      return tokens.slice(0, index).join(' ');
    }
  }
  return tokens.join(' ');
}

function trimToAnchor(value = '', candidateType = null) {
  const anchors = TYPE_ANCHORS[candidateType];
  if (!Array.isArray(anchors) || anchors.length === 0) {
    return collapseWhitespace(value);
  }

  const tokens = collapseWhitespace(value).split(' ').filter(Boolean);
  let anchorIndex = -1;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (anchors.includes(token)) {
      anchorIndex = index;
    }
  }

  if (anchorIndex < 0) {
    return tokens.join(' ');
  }

  return tokens.slice(0, anchorIndex + 1).join(' ');
}

function preferAnchoredSuffix(value = '', candidateType = null) {
  const signalTokens = TYPE_SIGNAL_TOKENS[candidateType];
  if (!signalTokens) {
    return collapseWhitespace(value);
  }

  const tokens = collapseWhitespace(value).split(' ').filter(Boolean);
  const anchorIndex = tokens.findIndex((token) => signalTokens.has(token.toLowerCase().replace(/[^a-z0-9]/g, '')));
  if (anchorIndex <= 0) {
    return tokens.join(' ');
  }

  const breakWords = new Set(getContextBreakWords(candidateType));
  let startIndex = 0;
  for (let index = 0; index < anchorIndex; index += 1) {
    if (breakWords.has(tokens[index].toLowerCase())) {
      startIndex = index + 1;
    }
  }

  return tokens.slice(startIndex).join(' ');
}

function stripDrugContext(value = '', candidateType = null) {
  if (candidateType !== 'drug') {
    return collapseWhitespace(value);
  }

  return collapseWhitespace(
    value.replace(/\b(treatment|therapy|regimen|administration|use|combination therapy)\b$/i, ''),
  );
}

function stripTrailingGlue(value = '') {
  return collapseWhitespace(
    String(value || '').replace(/[\s\-–—:;,.()[\]{}]+$/g, ''),
  );
}

function countContextBreakWords(value = '', candidateType = null) {
  const tokens = collapseWhitespace(value).split(' ').filter(Boolean);
  const breakWords = new Set(getContextBreakWords(candidateType));
  return tokens.filter((token) => breakWords.has(token.toLowerCase())).length;
}

export function normalizeSemanticConceptName(value = '', candidateType = null) {
  let normalized = stripOuterNoise(value);
  if (!normalized) {
    return '';
  }

  normalized = stripRelationPrefixes(normalized);
  normalized = stripLeadingGenericWords(normalized);
  normalized = preferAnchoredSuffix(normalized, candidateType);
  normalized = trimToAnchor(normalized, candidateType);
  normalized = trimAtContextBreak(normalized, candidateType);
  normalized = stripDrugContext(normalized, candidateType);
  normalized = trimEdgeStopWords(normalized);
  normalized = stripTrailingGlue(normalized);

  return collapseWhitespace(normalized);
}

export function isLowQualityConceptName(value = '', candidateType = null) {
  const normalized = normalizeSemanticConceptName(value, candidateType);
  if (!normalized) {
    return true;
  }

  const lowered = normalized.toLowerCase();
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 0 || tokens.length > 12) {
    return true;
  }

  if (!/[a-z0-9]/i.test(normalized)) {
    return true;
  }

  if (countContextBreakWords(normalized, candidateType) > 0) {
    return true;
  }

  if (/^(study|analysis|association|associations|effect|effects|impact|role|evaluation|assessment|predicting|profiling|monitoring|using)\b/i.test(lowered)) {
    return true;
  }

  const genericTerms = TYPE_GENERIC_TERMS[candidateType];
  if (genericTerms?.has(lowered)) {
    return true;
  }

  if (candidateType !== 'indicator' && candidateType !== 'drug') {
    const signalPattern = TYPE_SIGNAL_PATTERNS[candidateType];
    if (signalPattern && !signalPattern.test(normalized)) {
      return true;
    }
  }

  if (tokens.length === 1 && lowered.length <= 2) {
    return true;
  }

  return false;
}

export { collapseWhitespace };
