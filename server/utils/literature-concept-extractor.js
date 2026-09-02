import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  CODEX_MODELS,
  LOCAL_MODELS,
  isCodexModelSelection,
} from '../../shared/modelConstants.js';
import { queryCodex } from '../openai-codex.js';
import { buildMonitorCandidatesFromNewsItem } from './monitor-candidate-extractor.js';
import {
  collapseWhitespace,
  isLowQualityConceptName,
  normalizeSemanticConceptName,
} from './concept-keyword-normalizer.js';

const SUPPORTED_TYPES = new Set([
  'indicator',
  'drug',
  'disease',
  'subtype',
  'stratifier',
  'risk_score',
  'outcome',
]);

const TYPE_ALIASES = new Map([
  ['biomarker', 'indicator'],
  ['marker', 'indicator'],
  ['lab_marker', 'indicator'],
  ['laboratory_marker', 'indicator'],
  ['medication', 'drug'],
  ['medicine', 'drug'],
  ['therapy', 'drug'],
  ['compound', 'drug'],
  ['disease_type', 'subtype'],
  ['phenotype', 'subtype'],
  ['subgroup', 'stratifier'],
  ['population', 'stratifier'],
  ['cohort', 'stratifier'],
  ['score', 'risk_score'],
  ['model', 'risk_score'],
]);

const EXTRACTION_PROVIDERS = ['codex', 'local'];

function clipText(value = '', maxLength = 240) {
  const normalized = collapseWhitespace(value);
  if (!normalized) {
    return '';
  }
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1).trim()}…`
    : normalized;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Structured extraction was cancelled.');
  error.name = 'AbortError';
  throw error;
}

function inferTypeFromName(name = '') {
  const normalized = normalizeSemanticConceptName(name).toLowerCase();
  if (!normalized) {
    return null;
  }
  if (/\b(score|model|nomogram|classifier|signature)\b/.test(normalized)) {
    return 'risk_score';
  }
  if (/\b(biomarker|marker|ratio|index|panel)\b/.test(normalized)) {
    return 'indicator';
  }
  if (/\b(disease|cancer|syndrome|infection|diabetes|hypertension|obesity|carcinoma|anemia|stroke)\b/.test(normalized)) {
    return 'disease';
  }
  if (/\b(subtype|phenotype|variant)\b/.test(normalized)) {
    return 'subtype';
  }
  if (/\b(adults|women|men|children|patients|cohort|population|older adults)\b/.test(normalized)) {
    return 'stratifier';
  }
  return null;
}

function normalizeCandidateType(rawType, name = '') {
  const normalized = collapseWhitespace(rawType).toLowerCase();
  const aliased = TYPE_ALIASES.get(normalized) || normalized;
  if (SUPPORTED_TYPES.has(aliased)) {
    return aliased;
  }
  return inferTypeFromName(name);
}

function isModelValidForProvider(provider, model) {
  if (!model || typeof model !== 'string') {
    return false;
  }
  if (provider === 'local') {
    return true;
  }
  if (provider === 'codex') {
    return isCodexModelSelection(model);
  }
  return CODEX_MODELS.OPTIONS.some((entry) => entry.value === model);
}

function getDefaultModelForProvider(provider) {
  if (provider === 'codex') {
    return CODEX_MODELS.DEFAULT;
  }
  if (provider === 'local') {
    return LOCAL_MODELS.DEFAULT || 'qwen3:8b';
  }
  return CODEX_MODELS.DEFAULT;
}

function normalizeProvider(rawProvider) {
  const normalized = collapseWhitespace(rawProvider).toLowerCase();
  if (EXTRACTION_PROVIDERS.includes(normalized)) {
    return normalized;
  }
  return 'codex';
}

function shouldSkipLlmExtraction() {
  return process.env.NODE_ENV === 'test'
    || process.env.VITEST === 'true'
    || process.env.MEDHELP_SKIP_LLM_EXTRACTION === '1';
}

export function normalizeExtractionConfig(raw = {}) {
  const provider = normalizeProvider(raw.provider);
  const candidateModel = collapseWhitespace(raw.model);
  const model = isModelValidForProvider(provider, candidateModel)
    ? candidateModel
    : getDefaultModelForProvider(provider);

  return {
    provider,
    model,
  };
}

function buildExtractionMessages(reference = {}, sourceKey = 'literature') {
  const title = clipText(reference?.title || '', 400);
  const abstract = clipText(reference?.abstract || '', 4000);
  const system = `You extract structured concept candidates from biomedical literature.

Return strict JSON only with this shape:
{
  "items": [
    {
      "type": "indicator|drug|disease|subtype|stratifier|risk_score|outcome",
      "name": "short canonical concept name",
      "summary": "one-sentence why it matters",
      "rationale": "short extraction reason tied to title/abstract",
      "confidence": 0.0
    }
  ]
}

Rules:
- Extract only concepts explicitly mentioned in the title or abstract.
- Prefer high-signal items: biomarkers, indicators, drugs, diseases, subtypes, stratifiers, scores, and outcomes.
- Return 3 to 12 items when possible, otherwise fewer.
- Keep names as semantic biomedical keywords, not relation phrases.
- Use normalized concept names such as "SPRR2D biomarker", "frailty score", "hypertensive disorders of pregnancy", "metformin", "older adults".
- Do not return contextual fragments such as "SPRR2D biomarker for hypertensive disorders of pregnancy", "frailty score for mortality", "association of bilirubin with stroke", or "marker from plasma samples".
- Never start or end a name with conjunctions or prepositions like "and", "or", "on", "for", or "from".
- Do not invent evidence, associations, or mechanism details that are not present.
- Do not include duplicate or near-duplicate items.
- Do not add prose outside the JSON object.`;

  const user = JSON.stringify({
    source: sourceKey,
    title,
    abstract,
    task: 'Extract multiple structured concept candidates suitable for a lightweight human review queue.',
  });

  return { system, user };
}

function buildCombinedPrompt(messages) {
  return `${messages.system}\n\nInput payload:\n${messages.user}\n\nReturn JSON only. Do not use tools.`;
}

const RETRY_SYSTEM_PROMPT = `Your previous response was not valid structured JSON, or the items array was empty.
You MUST return ONLY a JSON object with exactly this shape — no prose, no markdown fences, no explanations:
{"items":[{"type":"indicator|drug|disease|subtype|stratifier|risk_score|outcome","name":"short canonical concept name","summary":"one sentence","rationale":"short reason","confidence":0.0}]}
Return at least 3 items. Use normalized biomedical keyword names. Do not wrap in markdown code blocks.`;

function extractJsonText(rawText = '') {
  const trimmed = collapseWhitespace(rawText);
  if (!trimmed) {
    return '';
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

function parseItemsFromJson(rawText = '') {
  const jsonText = extractJsonText(rawText);
  if (!jsonText) {
    return [];
  }

  const parsed = JSON.parse(jsonText);
  return Array.isArray(parsed?.items) ? parsed.items : [];
}

function normalizeLlmItems(rawItems = [], extractionConfig = {}) {
  const seen = new Set();
  const normalizedItems = [];

  for (const item of rawItems) {
    const rawName = collapseWhitespace(item?.name || item?.display_name || '');
    const initialType = normalizeCandidateType(item?.type, rawName);
    const displayName = normalizeSemanticConceptName(rawName, initialType);
    const candidateType = normalizeCandidateType(item?.type, displayName);

    if (!candidateType || !displayName || isLowQualityConceptName(displayName, candidateType)) {
      continue;
    }

    const dedupeKey = `${candidateType}:${displayName.toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    const confidence = Number(item?.confidence);
    normalizedItems.push({
      candidate_type: candidateType,
      normalized_name: displayName,
      display_name: displayName,
      summary: clipText(item?.summary || ''),
      rationale: clipText(item?.rationale || ''),
      confidence: Number.isFinite(confidence)
        ? Math.max(0, Math.min(1, confidence))
        : null,
      metadata: {
        extractor: 'llm_json_monitor_v1',
        extraction_provider: extractionConfig.provider,
        extraction_model: extractionConfig.model,
        raw_type: collapseWhitespace(item?.type) || null,
      },
    });
  }

  return normalizedItems;
}

function buildFallbackCandidates(reference = {}, sourceKey = 'literature', extractionConfig = {}, error = null) {
  return buildMonitorCandidatesFromNewsItem(reference, sourceKey).map((candidate) => ({
    ...candidate,
    metadata: {
      ...(candidate.metadata && typeof candidate.metadata === 'object' ? candidate.metadata : {}),
      extractor: 'rule_based_monitor_v1',
      fallback_from_llm: true,
      extraction_provider: extractionConfig.provider,
      extraction_model: extractionConfig.model,
      extraction_error: error ? clipText(error, 600) : null,
    },
  }));
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function hasCodexCredentials() {
  if (process.env.OPENAI_API_KEY) {
    return true;
  }
  return fileExists(path.join(os.homedir(), '.codex', 'auth.json'));
}

class HeadlessTextCollector {
  constructor() {
    this.chunks = [];
    this.longestAssistantMessage = '';
  }

  collectText(value) {
    const text = collapseWhitespace(value);
    if (!text) {
      return;
    }
    this.chunks.push(text);
    if (text.length > this.longestAssistantMessage.length) {
      this.longestAssistantMessage = text;
    }
  }

  collectContentParts(content) {
    if (typeof content === 'string') {
      this.collectText(content);
      return;
    }

    if (!Array.isArray(content)) {
      return;
    }

    const text = content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n');
    this.collectText(text);
  }

  send(payload) {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    if (payload.type === 'codex-response') {
      const assistantContent = payload.data?.message?.content;
      this.collectContentParts(assistantContent);
    }
  }

  end() {}

  getText() {
    const chunkText = collapseWhitespace(this.chunks.join(''));
    if (chunkText) {
      return chunkText;
    }
    return collapseWhitespace(this.longestAssistantMessage);
  }
}

async function callCodexApi(messages, extractionConfig, signal) {
  throwIfAborted(signal);
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: extractionConfig.model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: messages.system },
        { role: 'user', content: messages.user },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`OpenAI extraction failed: ${response.status} ${errorText}`.trim());
  }

  const data = await response.json();
  return collapseWhitespace(data?.choices?.[0]?.message?.content || '');
}

async function callCodexHeadless(messages, extractionConfig) {
  if (!await hasCodexCredentials()) {
    return null;
  }

  const collector = new HeadlessTextCollector();
  await queryCodex(buildCombinedPrompt(messages), {
    model: extractionConfig.model,
    permissionMode: 'bypassPermissions',
    headless: true,
    // Codex app-server is designed to host multiple threads. Reuse the active
    // process even when this delayed background job has a reduced environment,
    // so extraction can never replace and terminate the foreground process.
    reuseExistingAppServer: true,
  }, collector);
  return collector.getText();
}

async function callLocalModel(messages, extractionConfig, signal) {
  throwIfAborted(signal);
  const serverUrl = process.env.OLLAMA_BASE_URL || process.env.LOCAL_GPU_SERVER_URL || 'http://localhost:11434';
  const response = await fetch(`${serverUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: extractionConfig.model,
      stream: false,
      format: 'json',
      options: { temperature: 0.1 },
      messages: [
        { role: 'system', content: messages.system },
        { role: 'user', content: messages.user },
      ],
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Local model extraction failed: ${response.status} ${errorText}`.trim());
  }

  const data = await response.json();
  return collapseWhitespace(data?.message?.content || '');
}

export async function requestStructuredJson({ userId, reference, sourceKey, extractionConfig, overrideMessages, signal }) {
  const messages = overrideMessages || buildExtractionMessages(reference, sourceKey);
  throwIfAborted(signal);

  if (extractionConfig.provider === 'codex') {
    const apiResult = await callCodexApi(messages, extractionConfig, signal);
    if (apiResult) return apiResult;
    throwIfAborted(signal);
    return callCodexHeadless(messages, extractionConfig);
  }

  if (extractionConfig.provider === 'local') {
    return callLocalModel(messages, extractionConfig, signal);
  }

  return null;
}

export async function extractCandidatesForLiteratureRecord({
  userId,
  reference,
  sourceKey = 'literature',
  extractionConfig: rawExtractionConfig = {},
  allowFallback = true,
} = {}) {
  const extractionConfig = normalizeExtractionConfig(rawExtractionConfig);

  if (shouldSkipLlmExtraction()) {
    if (!allowFallback) {
      return {
        strategy: 'llm_unavailable',
        candidates: [],
        extractionConfig,
        raw_response: null,
        error: 'LLM extraction is unavailable in the current environment',
      };
    }
    return {
      strategy: 'rule_based_fallback',
      candidates: buildFallbackCandidates(reference, sourceKey, extractionConfig, 'LLM extraction disabled for test environment'),
      extractionConfig,
      raw_response: null,
    };
  }

  try {
    const rawText = await requestStructuredJson({
      userId,
      reference,
      sourceKey,
      extractionConfig,
    });

    if (!rawText) {
      if (!allowFallback) {
        return {
          strategy: 'llm_unavailable',
          candidates: [],
          extractionConfig,
          raw_response: null,
          error: 'The selected model returned no structured extraction output',
        };
      }
      return {
        strategy: 'rule_based_fallback',
        candidates: buildFallbackCandidates(reference, sourceKey, extractionConfig, 'No LLM response returned'),
        extractionConfig,
        raw_response: null,
      };
    }

    let parsedItems = [];
    let parseError = false;
    try {
      parsedItems = parseItemsFromJson(rawText);
    } catch {
      parseError = true;
    }

    let llmCandidates = normalizeLlmItems(parsedItems, extractionConfig);

    if (llmCandidates.length === 0) {
      try {
        const retryMessages = buildExtractionMessages(reference, sourceKey);
        retryMessages.system = RETRY_SYSTEM_PROMPT + '\n\n' + retryMessages.system;
        const retryText = await requestStructuredJson({
          userId,
          reference,
          sourceKey,
          extractionConfig,
          overrideMessages: retryMessages,
        });
        if (retryText) {
          const retryItems = parseItemsFromJson(retryText);
          const retryCandidates = normalizeLlmItems(retryItems, extractionConfig);
          if (retryCandidates.length > 0) {
            return {
              strategy: 'llm_json_retry',
              candidates: retryCandidates,
              extractionConfig,
              raw_response: retryText,
            };
          }
        }
      } catch {
        // Retry also failed; continue to fallback below
      }
    }

    if (llmCandidates.length > 0) {
      return {
        strategy: 'llm_json',
        candidates: llmCandidates,
        extractionConfig,
        raw_response: rawText,
      };
    }

    if (!allowFallback) {
      return {
        strategy: 'llm_unusable',
        candidates: [],
        extractionConfig,
        raw_response: rawText,
        error: parseError
          ? 'The selected model returned non-JSON text that could not be parsed'
          : 'The selected model returned JSON, but the concept names were not usable semantic keywords',
      };
    }

    return {
      strategy: 'rule_based_fallback',
      candidates: buildFallbackCandidates(reference, sourceKey, extractionConfig, 'LLM returned no usable items after retry'),
      extractionConfig,
      raw_response: rawText,
    };
  } catch (error) {
    if (!allowFallback) {
      return {
        strategy: 'llm_unavailable',
        candidates: [],
        extractionConfig,
        raw_response: null,
        error: error instanceof Error ? error.message : 'Unknown extraction error',
      };
    }

    return {
      strategy: 'rule_based_fallback',
      candidates: buildFallbackCandidates(
        reference,
        sourceKey,
        extractionConfig,
        error instanceof Error ? error.message : 'Unknown extraction error',
      ),
      extractionConfig,
      raw_response: null,
      error: error instanceof Error ? error.message : 'Unknown extraction error',
    };
  }
}
