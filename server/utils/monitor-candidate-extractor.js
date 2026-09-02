import {
  collapseWhitespace,
  isLowQualityConceptName,
  normalizeSemanticConceptName,
} from './concept-keyword-normalizer.js';

const COMMON_DRUG_NAMES = new Set([
  'aspirin',
  'metformin',
  'warfarin',
  'heparin',
  'insulin',
  'semaglutide',
  'liraglutide',
  'atorvastatin',
  'rosuvastatin',
  'simvastatin',
  'amlodipine',
  'losartan',
  'valsartan',
  'lisinopril',
  'enalapril',
  'omeprazole',
  'pantoprazole',
  'ritonavir',
  'oseltamivir',
  'nivolumab',
  'pembrolizumab',
]);

const DRUG_SUFFIX_REGEX = /\b([A-Za-z][A-Za-z0-9\-]{2,}(?:mab|nib|statin|azole|sartan|gliflozin|gliptin|parib|cillin|mycin|pril|olol|xaban|navir|asvir|tegravir|oxetine|prazole|caine|lukast|setron|afil|tide))\b/gi;

function sentenceCaseSnippet(value = '', maxLength = 220) {
  const normalized = collapseWhitespace(value);
  if (!normalized) {
    return '';
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trim()}…` : normalized;
}

function isNoisyCandidatePhrase(value = '', candidateType = null) {
  const normalized = normalizeSemanticConceptName(value, candidateType);
  if (!normalized) {
    return true;
  }

  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }

  if (isLowQualityConceptName(normalized, candidateType)) {
    return true;
  }

  const conjunctionCount = (normalized.match(/\b(and|or|on)\b/gi) || []).length;
  return conjunctionCount >= 2;
}

function createCandidateAccumulator() {
  const seen = new Set();
  const rows = [];

  return {
    add(candidate) {
      const candidateType = collapseWhitespace(candidate?.candidate_type);
      const displayName = normalizeSemanticConceptName(
        candidate?.display_name || candidate?.normalized_name,
        candidateType,
      );
      if (!candidateType || !displayName || isNoisyCandidatePhrase(displayName, candidateType)) {
        return;
      }

      const dedupeKey = `${candidateType}:${displayName.toLowerCase()}`;
      if (seen.has(dedupeKey)) {
        return;
      }

      seen.add(dedupeKey);
      rows.push({
        candidate_type: candidateType,
        normalized_name: displayName,
        display_name: displayName,
        summary: sentenceCaseSnippet(candidate?.summary),
        rationale: sentenceCaseSnippet(candidate?.rationale),
        confidence: candidate?.confidence == null ? null : Number(candidate.confidence),
        metadata: candidate?.metadata && typeof candidate.metadata === 'object' ? candidate.metadata : null,
      });
    },
    values() {
      return rows;
    },
  };
}

function extractIndicatorCandidates(text, accumulator) {
  const regex = /\b([A-Za-z0-9][A-Za-z0-9\-\/]{1,}(?:\s+[A-Za-z0-9][A-Za-z0-9\-\/]{1,}){0,4})\s+(biomarker|ratio|index|panel|marker|signature|score|nomogram|classifier|model)\b/gi;
  for (const match of text.matchAll(regex)) {
    const category = /score|nomogram|classifier|model|signature/i.test(match[2]) ? 'risk_score' : 'indicator';
    const phrase = normalizeSemanticConceptName(`${match[1]} ${match[2]}`, category);
    if (!phrase || isNoisyCandidatePhrase(phrase, category) || phrase.split(' ').length > 7) {
      continue;
    }

    accumulator.add({
      candidate_type: category,
      display_name: phrase,
      summary: `Detected from monitored literature as a potential ${category === 'risk_score' ? 'prediction score/model' : 'indicator'} phrase.`,
      rationale: `Matched pattern "${match[0]}" in the monitored paper title or abstract.`,
      confidence: category === 'risk_score' ? 0.73 : 0.78,
      metadata: {
        extractor: 'rule_based_monitor_v1',
        matched_text: match[0],
      },
    });
  }
}

function extractDiseaseCandidates(text, accumulator) {
  const patterns = [
    /\b([A-Za-z][A-Za-z0-9\-]*(?:\s+[A-Za-z][A-Za-z0-9\-]*){0,3}\s+(?:disease|cancer|carcinoma|anemia|diabetes|obesity|hypertension|infection|dementia|depression|syndrome|cirrhosis|arthritis|stroke|steatosis|gravis))\b/gi,
    /\b([A-Za-z][A-Za-z0-9\-]*(?:\s+[A-Za-z][A-Za-z0-9\-]*){0,2}\s+disorders?\s+of\s+[A-Za-z][A-Za-z0-9\-]*(?:\s+[A-Za-z][A-Za-z0-9\-]*){0,2})\b/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const phrase = normalizeSemanticConceptName(match[1], 'disease');
      if (!phrase || isNoisyCandidatePhrase(phrase, 'disease') || phrase.split(' ').length > 8) {
        continue;
      }

      accumulator.add({
        candidate_type: 'disease',
        display_name: phrase,
        summary: 'Detected from monitored literature as a disease or disorder phrase.',
        rationale: `Matched disease-pattern phrase "${match[1]}" in the monitored paper title or abstract.`,
        confidence: 0.7,
        metadata: {
          extractor: 'rule_based_monitor_v1',
          matched_text: match[1],
        },
      });
    }
  }
}

function extractStratifierCandidates(text, accumulator) {
  const patterns = [
    /\b(children|adolescents|adults|older adults|older people|women|men|pregnant women|pregnancy|postpartum women|community-dwelling older adults)\b/gi,
    /\b(non-endemic regions|endemic regions|hospitalized patients|community populations|high-risk clone|mid-aged women)\b/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const phrase = normalizeSemanticConceptName(match[1], 'stratifier');
      if (!phrase || isNoisyCandidatePhrase(phrase, 'stratifier')) {
        continue;
      }

      accumulator.add({
        candidate_type: 'stratifier',
        display_name: phrase,
        summary: 'Detected from monitored literature as a potential cohort or subgroup stratifier.',
        rationale: `Matched population/subgroup phrase "${match[1]}" in the monitored paper title or abstract.`,
        confidence: 0.64,
        metadata: {
          extractor: 'rule_based_monitor_v1',
          matched_text: match[1],
        },
      });
    }
  }
}

function extractDrugCandidates(text, accumulator) {
  for (const match of text.matchAll(DRUG_SUFFIX_REGEX)) {
    const phrase = normalizeSemanticConceptName(match[1], 'drug');
    if (!phrase || isNoisyCandidatePhrase(phrase, 'drug')) {
      continue;
    }

    accumulator.add({
      candidate_type: 'drug',
      display_name: phrase,
      summary: 'Detected from monitored literature as a potential drug or therapeutic agent mention.',
      rationale: `Matched drug-name suffix pattern "${match[1]}" in the monitored paper title or abstract.`,
      confidence: 0.67,
      metadata: {
        extractor: 'rule_based_monitor_v2',
        matched_text: match[1],
      },
    });
  }

  const tokenRegex = /\b([A-Za-z][A-Za-z0-9\-]{2,})\b/g;
  for (const match of text.matchAll(tokenRegex)) {
    const token = match[1];
    if (!COMMON_DRUG_NAMES.has(token.toLowerCase())) {
      continue;
    }

    const phrase = normalizeSemanticConceptName(token, 'drug');
    if (!phrase || isNoisyCandidatePhrase(phrase, 'drug')) {
      continue;
    }

    accumulator.add({
      candidate_type: 'drug',
      display_name: phrase,
      summary: 'Detected from monitored literature as a potential drug or therapeutic agent mention.',
      rationale: `Matched common drug token "${token}" in the monitored paper title or abstract.`,
      confidence: 0.71,
      metadata: {
        extractor: 'rule_based_monitor_v2',
        matched_text: token,
      },
    });
  }
}

export function buildMonitorCandidatesFromNewsItem(item = {}, sourceKey = 'news') {
  const title = collapseWhitespace(item?.title);
  const abstract = collapseWhitespace(item?.abstract);
  const text = [title, abstract].filter(Boolean).join('. ');
  if (!text) {
    return [];
  }

  const accumulator = createCandidateAccumulator();
  extractIndicatorCandidates(text, accumulator);
  extractDrugCandidates(text, accumulator);
  extractDiseaseCandidates(text, accumulator);
  extractStratifierCandidates(text, accumulator);

  return accumulator.values().slice(0, 8).map((candidate) => ({
    ...candidate,
    source_key: sourceKey,
    summary: candidate.summary || sentenceCaseSnippet(title || abstract),
    rationale: candidate.rationale || 'Generated from monitored literature during news ingestion.',
    metadata: {
      ...(candidate.metadata || {}),
      source_key: sourceKey,
      title: title || null,
    },
  }));
}
