import express from 'express';
import fetch from 'node-fetch';
import {
  buildPubMedExtractionPromptBatches,
  PUBMED_VARIABLE_EXTRACTION_PROMPT_VERSION,
} from '../../shared/pubmedVariableDiscoveryPrompt.js';
import { CLAUDE_MODELS } from '../../shared/modelConstants.js';
import { normalizeExtractionConfig, requestStructuredJson } from '../utils/literature-concept-extractor.js';
import { db } from '../database/db.js';

const router = express.Router();
const ALLOWED_STATE_KEYS = new Set([
  'backgroundSnapshot',
  'variableMasterRowEdits',
]);
const PUBMED_EUTILS_BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const PUBMED_TREND_REQUEST_PAUSE_MS = 450;
const PUBMED_TREND_REQUEST_TIMEOUT_MS = 20_000;
const PUBMED_TREND_RETRY_COUNT = 2;
const PUBMED_DISCOVERY_EXTRACT_TIMEOUT_MS = Number(process.env.PUBMED_DISCOVERY_EXTRACT_TIMEOUT_MS || 90_000);

function isAllowedStateKey(value) {
  return ALLOWED_STATE_KEYS.has(String(value || ''));
}

function parseStatePayload(row) {
  if (!row?.payload_json) {
    return null;
  }

  try {
    return JSON.parse(row.payload_json);
  } catch {
    return null;
  }
}

function getStateRow(userId, key) {
  return db.prepare(`
    SELECT state_key, payload_json, updated_at
    FROM pubmed_discovery_state
    WHERE user_id = ? AND state_key = ?
  `).get(userId, key);
}

function saveStatePayload(userId, key, payload) {
  db.prepare(`
    INSERT INTO pubmed_discovery_state (user_id, state_key, payload_json, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, state_key) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = CURRENT_TIMESTAMP
  `).run(userId, key, JSON.stringify(payload ?? null));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(error) {
  return error?.name === 'AbortError' || /\babort(ed)?\b/i.test(String(error?.message || ''));
}

function sanitizePubMedPhrase(value) {
  return String(value || '')
    .replace(/["“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildVariableTrendQuery(variableName) {
  const cleaned = sanitizePubMedPhrase(variableName);
  return cleaned.includes(' ') || cleaned.includes('-') || cleaned.includes('/')
    ? `"${cleaned}"`
    : cleaned;
}

function normalizePubMedFetchErrorMessage(error) {
  const message = String(error?.message || error || '').trim();
  if (/forwarding request\s+\/entrez\/eutils/i.test(message)) {
    return 'PubMed ESearch 转发失败，可能是 NCBI 临时限流或本机网络代理中断。请稍后重试。';
  }
  if (/aborted|timeout/i.test(message)) {
    return 'PubMed ESearch 请求超时，可能是 NCBI 访问慢或网络代理中断。请稍后重试。';
  }
  if (/rate|429|too many/i.test(message)) {
    return 'PubMed ESearch 请求过快，已触发 NCBI 限流。请稍后重试。';
  }
  return message || 'PubMed ESearch 请求失败。';
}

async function readPubMedJsonResponse(response) {
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 160);
    throw new Error(snippet ? `PubMed 返回了非 JSON 响应：${snippet}` : 'PubMed 返回了空响应。');
  }

  if (!response.ok) {
    const detail = data?.error || data?.message || `HTTP ${response.status}`;
    throw new Error(`PubMed ESearch failed with ${detail}`);
  }

  return data;
}

function formatPubMedDate(value) {
  return value.toISOString().slice(0, 10).replace(/-/g, '/');
}

function formatIsoDate(value) {
  return value.toISOString().slice(0, 10);
}

function createTrendMonthWindows(monthCount, referenceDate = new Date()) {
  const months = Math.max(2, Math.min(24, Number(monthCount) || 6));
  const windows = [];
  const base = new Date(Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    1,
  ));

  for (let index = months - 1; index >= 0; index -= 1) {
    const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - index, 1));
    const nextMonthStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const fullMonthEnd = new Date(nextMonthStart.getTime() - 24 * 60 * 60 * 1000);
    const end = index === 0 && referenceDate < fullMonthEnd ? referenceDate : fullMonthEnd;
    windows.push({
      month: start.toISOString().slice(0, 7),
      dateFrom: formatIsoDate(start),
      dateTo: formatIsoDate(end),
      pubmedDateFrom: formatPubMedDate(start),
      pubmedDateTo: formatPubMedDate(end),
    });
  }

  return windows;
}

async function fetchPubMedCount(term) {
  const params = new URLSearchParams({
    db: 'pubmed',
    term,
    retmode: 'json',
    retmax: '0',
  });
  if (process.env.NCBI_API_KEY) {
    params.set('api_key', process.env.NCBI_API_KEY);
  }

  let lastError = null;
  for (let attempt = 0; attempt <= PUBMED_TREND_RETRY_COUNT; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PUBMED_TREND_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${PUBMED_EUTILS_BASE_URL}/esearch.fcgi`, {
        method: 'POST',
        headers: {
          'User-Agent': 'medhelp/1.1 (pubmed-variable-trend)',
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        body: params.toString(),
        signal: controller.signal,
      });
      const data = await readPubMedJsonResponse(response);
      return Number(data?.esearchresult?.count || 0);
    } catch (error) {
      lastError = error;
      if (attempt < PUBMED_TREND_RETRY_COUNT) {
        await sleep(700 * (attempt + 1));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(normalizePubMedFetchErrorMessage(lastError));
}

function normalizeArticle(item = {}) {
  return {
    pmid: String(item.pmid || item.id || '').replace(/^pubmed[-_:]/i, '').trim(),
    title: String(item.title || '').trim(),
    abstract: String(item.abstract || '').trim().slice(0, 1200),
    journal: String(item.journal || item.source || '').trim(),
    publicationDate: String(item.publicationDate || item.published || '').trim(),
  };
}

function normalizeSeedCandidate(item = {}) {
  return {
    pmid: String(item.pmid || '').replace(/^pubmed[-_:]/i, '').trim(),
    raw_name: String(item.raw_name || item.rawName || '').trim(),
    canonical_name_guess: String(item.canonical_name_guess || item.canonicalName || '').trim(),
    display_name_en_guess: String(item.display_name_en_guess || item.displayNameEn || '').trim(),
    variable_type_guess: String(item.variable_type_guess || '').trim(),
    evidence_sentence: String(item.evidence_sentence || '').trim().slice(0, 500),
  };
}

function parseJsonObject(rawText = '') {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || trimmed;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  const jsonText = firstBrace >= 0 && lastBrace > firstBrace
    ? candidate.slice(firstBrace, lastBrace + 1)
    : candidate;
  return JSON.parse(jsonText);
}

function extractClaudeText(data) {
  const content = Array.isArray(data?.content) ? data.content : [];
  return content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

function getAnthropicEndpoint() {
  const base = (process.env.ANTHROPIC_BASE_URL || process.env.ANTHROPIC_API_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  return base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
}

// The Messages API only accepts fully qualified `claude-*` ids. Aliases such as
// `opus` resolve to one; anything else (a third-party id in ANTHROPIC_MODEL, or
// an alias like `sonnet[1m]`) has no direct equivalent, so the caller must fall
// back to the system LLM path instead of posting an id the API will reject.
export function resolveDirectClaudeModel() {
  const selected = String(
    process.env.PUBMED_DISCOVERY_CLAUDE_MODEL || process.env.ANTHROPIC_MODEL || CLAUDE_MODELS.DEFAULT || '',
  ).trim();
  if (/^claude-[a-z0-9.-]+$/i.test(selected)) return selected;
  return CLAUDE_MODELS.OPTIONS.find((option) => option.value.startsWith(`claude-${selected}-`))?.value || null;
}

async function runClaudeJsonExtraction(prompt, signal) {
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN || '';

  if (!apiKey && !authToken) {
    const error = new Error('Claude credentials are not configured on the server.');
    error.statusCode = 503;
    throw error;
  }

  const headers = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  } else {
    headers.authorization = `Bearer ${authToken}`;
  }

  const model = resolveDirectClaudeModel();
  if (!model) {
    const error = new Error(
      `当前配置的模型 "${process.env.PUBMED_DISCOVERY_CLAUDE_MODEL || process.env.ANTHROPIC_MODEL}" 不是 Anthropic Messages API 的模型 ID，已跳过直连抽取。`,
    );
    error.statusCode = 503;
    throw error;
  }

  const response = await fetch(getAnthropicEndpoint(), {
    method: 'POST',
    headers,
    signal,
    body: JSON.stringify({
      model,
      max_tokens: 6000,
      temperature: 0,
      system: 'You extract biomedical variables into strict JSON for a human review workflow.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `Claude extraction failed with HTTP ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  const rawText = extractClaudeText(data);
  const parsed = parseJsonObject(rawText);
  return {
    rawText,
    model,
    candidates: Array.isArray(parsed?.candidates) ? parsed.candidates : [],
  };
}

function buildSystemLlmMessages(prompt) {
  return {
    system: 'You extract PubMed biomedical variables into strict JSON for a human review workflow. Return JSON only. Do not use tools.',
    user: prompt,
  };
}

function resolveExtractionConfig(options = {}) {
  const extraction = options?.extraction && typeof options.extraction === 'object' ? options.extraction : {};
  return normalizeExtractionConfig({
    provider: extraction.provider || options.extractionProvider || process.env.PUBMED_DISCOVERY_LLM_PROVIDER || 'claude',
    model: extraction.model || options.extractionModel || process.env.PUBMED_DISCOVERY_CLAUDE_MODEL || process.env.ANTHROPIC_MODEL,
  });
}

async function runSystemLlmJsonExtraction({ prompt, options, userId, signal }) {
  const extractionConfig = resolveExtractionConfig(options);
  const rawText = await requestStructuredJson({
    userId,
    reference: null,
    sourceKey: 'pubmed_variable_discovery',
    extractionConfig,
    overrideMessages: buildSystemLlmMessages(prompt),
    signal,
  });

  if (!rawText) {
    const error = new Error('系统 Claude/LLM 没有返回结构化抽取结果。请确认 Claude 已登录或模型凭证已配置。');
    error.statusCode = 503;
    throw error;
  }

  const parsed = parseJsonObject(rawText);
  return {
    rawText,
    extractionConfig,
    invocation: extractionConfig.provider === 'claude' ? 'claude_agent_sdk' : `${extractionConfig.provider}_json_api`,
    candidates: Array.isArray(parsed?.candidates) ? parsed.candidates : [],
  };
}

async function runPubMedLlmJsonExtraction({ prompt, options, userId, signal }) {
  const extractionConfig = resolveExtractionConfig(options);
  const hasDirectClaudeCredentials = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  const shouldTryDirectFirst = extractionConfig.provider === 'claude'
    && hasDirectClaudeCredentials
    && Boolean(resolveDirectClaudeModel());
  let directError = null;

  if (shouldTryDirectFirst) {
    try {
      const direct = await runClaudeJsonExtraction(prompt, signal);
      return {
        ...direct,
        extractionConfig: { ...extractionConfig, model: direct.model || extractionConfig.model },
        invocation: 'anthropic_messages_api',
      };
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw error;
      directError = error;
    }
  }

  try {
    return await runSystemLlmJsonExtraction({ prompt, options, userId, signal });
  } catch (systemError) {
    if (signal?.aborted || isAbortError(systemError)) throw systemError;
    const detail = directError
      ? `Messages API: ${directError.message}; Agent/系统调用: ${systemError.message}`
      : systemError.message;
    const error = new Error(detail || '系统 Claude/LLM JSON 抽取失败。');
    error.statusCode = systemError.statusCode || directError?.statusCode || 503;
    throw error;
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
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

router.get('/state', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT state_key, payload_json, updated_at
      FROM pubmed_discovery_state
      WHERE user_id = ?
    `).all(req.user.id);

    const state = {};
    for (const row of rows) {
      if (!isAllowedStateKey(row.state_key)) {
        continue;
      }
      state[row.state_key] = {
        payload: parseStatePayload(row),
        updatedAt: row.updated_at,
      };
    }

    res.json({ state });
  } catch (error) {
    console.error('PubMed discovery state load failed:', error);
    res.status(500).json({ error: 'Failed to load PubMed discovery state.' });
  }
});

router.get('/state/:key', (req, res) => {
  try {
    const key = String(req.params.key || '');
    if (!isAllowedStateKey(key)) {
      return res.status(400).json({ error: 'Invalid PubMed discovery state key.' });
    }

    const row = getStateRow(req.user.id, key);
    res.json({
      key,
      payload: parseStatePayload(row),
      updatedAt: row?.updated_at || null,
    });
  } catch (error) {
    console.error('PubMed discovery state load failed:', error);
    res.status(500).json({ error: 'Failed to load PubMed discovery state.' });
  }
});

router.put('/state/:key', (req, res) => {
  try {
    const key = String(req.params.key || '');
    if (!isAllowedStateKey(key)) {
      return res.status(400).json({ error: 'Invalid PubMed discovery state key.' });
    }

    saveStatePayload(req.user.id, key, req.body?.payload ?? null);
    res.json({ success: true, key });
  } catch (error) {
    console.error('PubMed discovery state save failed:', error);
    res.status(500).json({ error: 'Failed to save PubMed discovery state.' });
  }
});

router.post('/trend', async (req, res) => {
  try {
    const variableName = sanitizePubMedPhrase(req.body?.variableName);
    if (!variableName) {
      return res.status(400).json({ error: 'Variable name is required for PubMed trend search.' });
    }

    const baseQuery = buildVariableTrendQuery(variableName);
    const windows = createTrendMonthWindows(req.body?.months);
    const points = [];

    for (const [index, window] of windows.entries()) {
      const monthTerm = `(${baseQuery}) AND ("${window.pubmedDateFrom}"[Date - Publication] : "${window.pubmedDateTo}"[Date - Publication])`;
      const count = await fetchPubMedCount(monthTerm);
      points.push({
        month: window.month,
        count,
        dateFrom: window.dateFrom,
        dateTo: window.dateTo,
      });

      if (index < windows.length - 1) {
        await sleep(PUBMED_TREND_REQUEST_PAUSE_MS);
      }
    }

    res.json({
      variableName,
      query: baseQuery,
      source: 'pubmed_esearch',
      searchedAt: new Date().toISOString(),
      totalCount: points.reduce((sum, point) => sum + point.count, 0),
      points,
    });
  } catch (error) {
    console.error('PubMed variable trend search failed:', error);
    res.status(error.statusCode || 500).json({
      error: normalizePubMedFetchErrorMessage(error) || 'PubMed variable trend search failed.',
    });
  }
});

router.post('/extract', async (req, res) => {
  const abortController = new AbortController();
  let timedOut = false;
  let clientClosed = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, PUBMED_DISCOVERY_EXTRACT_TIMEOUT_MS);

  res.on('close', () => {
    if (!res.writableEnded) {
      clientClosed = true;
      abortController.abort();
    }
  });

  try {
    const articles = Array.isArray(req.body?.articles)
      ? req.body.articles.map(normalizeArticle).filter((item) => item.pmid && item.title).slice(0, 40)
      : [];
    if (articles.length === 0) {
      return res.status(400).json({ error: 'No PubMed articles were provided for extraction.' });
    }

    const options = req.body?.options && typeof req.body.options === 'object' ? req.body.options : {};
    const seedCandidates = Array.isArray(options.seedCandidates)
      ? options.seedCandidates.map(normalizeSeedCandidate).filter((item) => item.pmid && item.raw_name).slice(0, 40)
      : [];
    const promptBatches = buildPubMedExtractionPromptBatches({
      articles,
      variableKeyword: String(options.variableKeyword || ''),
      extractionStage: String(options.extractionStage || 'full'),
      seedCandidates,
    });

    const extractions = await mapWithConcurrency(promptBatches, 2, (batch) => runPubMedLlmJsonExtraction({
      prompt: batch.prompt,
      options,
      userId: req.user?.id,
      signal: abortController.signal,
    }));
    if (abortController.signal.aborted) {
      return;
    }
    const extraction = extractions[extractions.length - 1];
    const candidates = extractions.flatMap((item) => item.candidates);
    res.json({
      extractionSource: 'claude_json',
      extractionProvider: extraction.extractionConfig?.provider || 'claude',
      extractionModel: extraction.extractionConfig?.model || null,
      extractionInvocation: extraction.invocation || 'anthropic_messages_api',
      promptVersion: PUBMED_VARIABLE_EXTRACTION_PROMPT_VERSION,
      promptBatchCount: promptBatches.length,
      promptEstimatedTokens: promptBatches.map((batch) => batch.estimatedTokens),
      candidates,
      rawJson: JSON.stringify({ candidates }),
    });
  } catch (error) {
    if (abortController.signal.aborted || isAbortError(error)) {
      if (clientClosed || res.headersSent) {
        return;
      }
      res.status(timedOut ? 504 : 499).json({
        error: timedOut
          ? '系统 Claude/LLM JSON 抽取未在限定时间内完成，已停止等待。'
          : '系统 Claude/LLM JSON 抽取已取消。',
        promptVersion: PUBMED_VARIABLE_EXTRACTION_PROMPT_VERSION,
        extractionSource: 'claude_json',
      });
      return;
    }
    console.error('[ERROR] PubMed variable extraction failed:', error);
    res.status(error.statusCode || 500).json({
      error: error.message || 'Claude JSON extraction failed.',
      promptVersion: PUBMED_VARIABLE_EXTRACTION_PROMPT_VERSION,
      extractionSource: 'claude_json',
    });
  } finally {
    clearTimeout(timeout);
  }
});

export default router;
