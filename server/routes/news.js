import express from 'express';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { credentialsDb } from '../database/db.js';
import {
  prependExecutableDirectory,
  resolvePythonRuntime,
  resolveXhsExecutable,
} from '../utils/newsRuntime.js';
import { isWebShellOnlyMode } from '../utils/webShellMode.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const translationCache = new Map();

// Data directory for news config & results
const DATA_DIR = path.join(__dirname, '..', 'data');
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');
const PROXY_ENV_KEYS = ['ALL_PROXY', 'all_proxy', 'HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy'];
const NEWS_SEARCH_TIMEOUT_MS = Number(process.env.NEWS_SEARCH_TIMEOUT_MS || 180_000);

// Sensitive per-source settings are stored in credentialsDb, not in
// news-config-*.json files.
const SECRET_FIELDS_BY_SOURCE = {
  wechat: { access_key: 'news_wechat_access_key' },
};

function hasActiveNewsCredential(userId, credentialType) {
  if (!userId || !credentialType) return false;
  try {
    return Boolean(credentialsDb.getActiveCredential(userId, credentialType));
  } catch {
    return false;
  }
}

function upsertSingleNewsCredential(userId, credentialType, name, value) {
  if (!userId || !credentialType) return;
  try {
    const existing = credentialsDb.getCredentials(userId, credentialType) || [];
    for (const cred of existing) {
      try { credentialsDb.deleteCredential(userId, cred.id); } catch { /* keep going */ }
    }
    credentialsDb.createCredential(userId, name, credentialType, value, null);
  } catch (err) {
    console.error(`[news] failed to upsert ${credentialType}: ${err.message}`);
    throw err;
  }
}

function deleteNewsCredentialsByType(userId, credentialType) {
  if (!userId || !credentialType) return;
  try {
    const existing = credentialsDb.getCredentials(userId, credentialType) || [];
    for (const cred of existing) {
      try { credentialsDb.deleteCredential(userId, cred.id); } catch { /* keep going */ }
    }
  } catch (err) {
    console.error(`[news] failed to delete ${credentialType}: ${err.message}`);
  }
}

function readActiveNewsCredential(userId, credentialType) {
  if (!userId || !credentialType) return '';
  try {
    return credentialsDb.getActiveCredential(userId, credentialType) || '';
  } catch {
    return '';
  }
}

async function migrateLegacySecretsInPlace(sourceName, userId, configPath, parsedConfig) {
  const fieldMap = SECRET_FIELDS_BY_SOURCE[sourceName];
  if (!fieldMap || !parsedConfig || typeof parsedConfig !== 'object') return parsedConfig;
  if (!userId) return parsedConfig;

  let mutated = false;
  for (const [field, credentialType] of Object.entries(fieldMap)) {
    const legacyValue = parsedConfig[field];
    if (typeof legacyValue === 'string' && legacyValue.trim()) {
      if (!hasActiveNewsCredential(userId, credentialType)) {
        upsertSingleNewsCredential(
          userId,
          credentialType,
          `${sourceName}_${field}`,
          legacyValue.trim(),
        );
      }
      delete parsedConfig[field];
      mutated = true;
    }
  }

  if (mutated) {
    try {
      await fs.writeFile(configPath, JSON.stringify(parsedConfig, null, 2), 'utf8');
    } catch (err) {
      console.warn(`[news] failed to scrub legacy secret from ${configPath}: ${err.message}`);
    }
  }
  return parsedConfig;
}

function decorateWithSecretFlags(sourceName, userId, config) {
  const fieldMap = SECRET_FIELDS_BY_SOURCE[sourceName];
  if (!fieldMap) return config;

  const safeConfig = { ...(config || {}) };
  for (const [field, credentialType] of Object.entries(fieldMap)) {
    delete safeConfig[field];
    safeConfig[`${field}_set`] = hasActiveNewsCredential(userId, credentialType);
  }
  return safeConfig;
}

// ---------------------------------------------------------------------------
// Source Registry
// ---------------------------------------------------------------------------
const SOURCE_REGISTRY = {
  pubmed: {
    label: 'PubMed',
    script: 'research-news/search_pubmed.py',
    configFile: 'news-config-pubmed.json',
    resultsFile: 'news-results-pubmed.json',
    defaultConfig: {
      research_domains: {
        'Clinical Cohorts & Epidemiology': {
          keywords: ['cohort study', 'prospective cohort', 'retrospective cohort', 'risk prediction', 'UK Biobank', 'NHANES', 'All of Us', 'Framingham Heart Study'],
          arxiv_categories: [],
          priority: 5,
        },
        'Clinical Trials & Evidence': {
          keywords: ['clinical trial', 'randomized controlled trial', 'real-world evidence', 'external validation', 'ClinicalTrials.gov', 'WHO ICTRP', 'Cochrane', 'PROSPERO'],
          arxiv_categories: [],
          priority: 4,
        },
        'Hospital Data & Risk Models': {
          keywords: ['electronic health record', 'clinical prediction model', 'mortality prediction', 'hospital outcome', 'MIMIC-IV', 'eICU', 'N3C', 'PhysioNet'],
          arxiv_categories: [],
          priority: 4,
        },
      },
      top_n: 10,
      max_results: 120,
      date_range_days: 30,
    },
    requiresCredentials: false,
  },
  europepmc: {
    label: 'Europe PMC',
    script: 'research-news/search_europepmc.py',
    configFile: 'news-config-europepmc.json',
    resultsFile: 'news-results-europepmc.json',
    defaultConfig: {
      research_domains: {
        'Population Cohorts & Public Repositories': {
          keywords: ['population cohort', 'longitudinal study', 'risk factor', 'UK Biobank', 'NHANES', 'All of Us', 'Framingham Heart Study', 'N3C'],
          arxiv_categories: [],
          priority: 5,
        },
        'Clinical Trials & Outcomes': {
          keywords: ['clinical trial', 'trial protocol', 'treatment outcome', 'comparative effectiveness', 'ClinicalTrials.gov', 'WHO ICTRP', 'Cochrane', 'PROSPERO'],
          arxiv_categories: [],
          priority: 4,
        },
        'Evidence Synthesis & Trials': {
          keywords: ['systematic review', 'meta-analysis', 'guideline', 'real-world evidence', 'Cochrane', 'PubMed Clinical Queries', 'PROSPERO', 'TRIP Database'],
          arxiv_categories: [],
          priority: 4,
        },
      },
      top_n: 10,
      max_results: 120,
      date_range_days: 30,
    },
    requiresCredentials: false,
  },
  medrxiv: {
    label: 'medRxiv',
    script: 'research-news/search_medrxiv.py',
    configFile: 'news-config-medrxiv.json',
    resultsFile: 'news-results-medrxiv.json',
    defaultConfig: {
      research_domains: {
        'Clinical Cohorts & EHR': {
          keywords: ['cohort study', 'risk factor', 'clinical prediction', 'electronic health record', 'UK Biobank', 'NHANES', 'MIMIC-IV', 'eICU'],
          arxiv_categories: [],
          priority: 5,
        },
        'Clinical Trial Methods': {
          keywords: ['clinical trial', 'pragmatic trial', 'target trial emulation', 'causal inference', 'ClinicalTrials.gov', 'WHO ICTRP', 'PROSPERO', 'CONSORT'],
          arxiv_categories: [],
          priority: 4,
        },
        'Trial Methods & Causal Inference': {
          keywords: ['randomized trial', 'causal inference', 'propensity score', 'external validation', 'real-world evidence', 'MIMIC-IV', 'eICU', 'N3C'],
          arxiv_categories: [],
          priority: 4,
        },
      },
      top_n: 10,
      max_results: 150,
      date_range_days: 30,
    },
    requiresCredentials: false,
  },
  arxiv: {
    label: 'arXiv',
    script: 'research-news/search_arxiv.py',
    configFile: 'news-config-arxiv.json',
    resultsFile: 'news-results-arxiv.json',
    defaultConfig: {
      research_domains: {
        'Medical Imaging AI': {
          keywords: ['medical imaging', 'radiology AI', 'diagnostic model', 'external validation', 'MIMIC-CXR', 'NIH ChestXray14', 'RSNA', 'OASIS'],
          arxiv_categories: ['cs.CV', 'eess.IV', 'q-bio.QM'],
          priority: 5,
        },
        'Clinical NLP': {
          keywords: ['clinical NLP', 'electronic health record', 'clinical note', 'medical language model', 'MIMIC-IV', 'PhysioNet', 'i2b2', 'n2c2'],
          arxiv_categories: ['cs.CL', 'cs.AI', 'cs.IR'],
          priority: 4,
        },
        'Clinical Time Series & Monitoring': {
          keywords: ['ICU time series', 'clinical decision support', 'sepsis prediction', 'hospital monitoring', 'MIMIC-IV', 'eICU', 'PhysioNet', 'N3C'],
          arxiv_categories: ['q-bio.GN', 'q-bio.QM', 'cs.LG'],
          priority: 4,
        },
      },
      top_n: 10,
      max_results: 200,
      categories: 'cs.AI,cs.CL,cs.CV,cs.IR,cs.LG,eess.IV,q-bio.GN,q-bio.QM',
    },
    requiresCredentials: false,
  },
  wechat: {
    label: 'WeChat 公众号',
    script: 'research-news/search_wechat.py',
    configFile: 'news-config-wechat.json',
    resultsFile: 'news-results-wechat.json',
    defaultConfig: {
      research_domains: {},
      top_n: 12,
      instance_url: 'https://rsshub.app',
      accounts: '',
      per_account_limit: 20,
    },
    requiresCredentials: false,
  },
  xiaohongshu: {
    label: 'Xiaohongshu',
    script: 'research-news/search_xiaohongshu.py',
    configFile: 'news-config-xiaohongshu.json',
    resultsFile: 'news-results-xiaohongshu.json',
    defaultConfig: {
      research_domains: {
        'Clinical Research Notes': {
          keywords: ['医学论文', '临床研究', '队列研究', '预测模型', '生物统计'],
          arxiv_categories: [],
          priority: 5,
        },
        'Biomedical AI & Bioinformatics': {
          keywords: ['医疗AI', '医学人工智能', '生物信息', '多组学', '机器学习'],
          arxiv_categories: [],
          priority: 4,
        },
      },
      top_n: 10,
      keywords: '医学论文,临床研究,医疗AI,生物信息',
    },
    requiresCredentials: false,
  },
};

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function getSourceEntry(source) {
  return SOURCE_REGISTRY[source] || null;
}

function emptyNewsResults() {
  return { top_papers: [], total_found: 0, total_filtered: 0 };
}

async function readSourceConfig(sourceName, entry, userId) {
  const configPath = path.join(DATA_DIR, entry.configFile);
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(configPath, 'utf8'));
  } catch (err) {
    if (err?.code === 'ENOENT') {
      parsed = { ...entry.defaultConfig };
    } else {
      throw err;
    }
  }

  parsed = await migrateLegacySecretsInPlace(sourceName, userId, configPath, parsed);
  return decorateWithSecretFlags(sourceName, userId, parsed);
}

async function readSourceResults(entry) {
  const resultsPath = path.join(DATA_DIR, entry.resultsFile);
  try {
    return JSON.parse(await fs.readFile(resultsPath, 'utf8'));
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return emptyNewsResults();
    }
    throw err;
  }
}

async function buildSourceInfoList(userId) {
  await ensureDataDir();
  const sources = [];

  for (const [key, entry] of Object.entries(SOURCE_REGISTRY)) {
    let hasResults = false;
    let lastSearchDate = null;
    try {
      const data = await readSourceResults(entry);
      hasResults = (data.top_papers?.length ?? 0) > 0;
      lastSearchDate = data.search_date || null;
    } catch { /* ignore unreadable result metadata */ }

    let credentialStatus = 'not_required';
    if (entry.requiresCredentials) {
      try {
        const cred = credentialsDb.getActiveCredential(userId, entry.credentialType);
        credentialStatus = cred ? 'configured' : 'missing';
      } catch {
        credentialStatus = 'missing';
      }
    }

    sources.push({
      key,
      label: entry.label,
      hasResults,
      lastSearchDate,
      requiresCredentials: entry.requiresCredentials,
      credentialType: entry.credentialType || null,
      credentialStatus,
    });
  }

  return sources;
}

async function buildNewsBootstrap(userId) {
  await ensureDataDir();
  const entries = Object.entries(SOURCE_REGISTRY);
  const [sources, configs, results] = await Promise.all([
    buildSourceInfoList(userId),
    Promise.all(entries.map(async ([key, entry]) => [key, await readSourceConfig(key, entry, userId)])),
    Promise.all(entries.map(async ([key, entry]) => [key, await readSourceResults(entry)])),
  ]);

  return {
    sources,
    configs: Object.fromEntries(configs),
    results: Object.fromEntries(results),
    generatedAt: new Date().toISOString(),
  };
}

function stripUnsupportedSocksProxyEnv(inputEnv = process.env) {
  const env = { ...inputEnv };
  const strippedKeys = [];

  for (const key of PROXY_ENV_KEYS) {
    const value = env[key];
    if (typeof value === 'string' && /socks/i.test(value)) {
      delete env[key];
      strippedKeys.push(key);
    }
  }

  return { env, strippedKeys };
}

function hasSocksProxyImportError(lines = []) {
  return lines.some((line) => /Using SOCKS proxy|socksio/i.test(String(line)));
}

function buildXhsProxyHint(strippedKeys = []) {
  if (strippedKeys.length > 0) {
    return `检测到服务端存在 SOCKS 代理环境变量（${strippedKeys.join(', ')}），MedHelp 已在调用小红书 CLI 时自动忽略它们。若仍失败，请检查这些代理变量是否会被其他启动脚本重新注入，或为 xiaohongshu-cli 运行环境补装 socksio。`;
  }

  return '检测到当前环境正在通过 SOCKS 代理访问网络，但 xiaohongshu-cli 的 httpx 依赖里没有 socksio。请清理服务端的 SOCKS 代理环境变量，或为 xiaohongshu-cli 运行环境安装 socksio。';
}

function hasBrokenXhsRuntimeError(lines = [], extraText = '') {
  const text = [...lines, extraText].map((line) => String(line || '')).join('\n');
  return /bad interpreter|spawn xhs ENOENT|xiaohongshu-cli is not installed|No such file or directory: ['"].*xhs/i.test(text);
}

function buildXhsRuntimeHint() {
  return '小红书 CLI 安装或运行环境不可用。请在运行 MedHelp 本地引擎的电脑上执行：uv tool install xiaohongshu-cli --force，然后重启本地引擎并重试。';
}

function buildLocalKernelRequiredHint() {
  return '小红书登录和搜索必须在运行 MedHelp 本地引擎的电脑上执行。请先连接本地引擎，再从网页重试。';
}

function parseXhsJsonOutput(rawText = '') {
  const text = String(rawText || '').trim();
  if (!text) return null;

  for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
    try {
      return JSON.parse(text.slice(start));
    } catch {
      // xhs may print human status lines before its JSON payload.
    }
  }

  return null;
}

function buildTranslationCacheKey(payload) {
  return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
}

function parseStructuredTranslation(rawText = '') {
  const trimmed = rawText.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || trimmed;

  try {
    const parsed = JSON.parse(candidate);
    return {
      translatedTitle: typeof parsed?.translatedTitle === 'string' ? parsed.translatedTitle.trim() : '',
      translatedAbstract: typeof parsed?.translatedAbstract === 'string' ? parsed.translatedAbstract.trim() : '',
    };
  } catch {
    return {
      translatedTitle: '',
      translatedAbstract: '',
    };
  }
}

function buildTranslationMessages({ title, abstract = '', targetLanguage = 'zh-CN' }) {
  return {
    system: `You are a biomedical literature translator. Translate academic paper metadata into ${targetLanguage} Chinese for medical researchers in mainland China.

Rules:
- Be faithful, concise, and easy to read.
- Preserve biomedical entities, abbreviations, cohort names, and statistical terms accurately.
- Keep English abbreviations like UK Biobank, MRI, hazard ratio, OR, CI, GWAS when useful.
- Do not add interpretation or commentary.
- Return strict JSON with keys translatedTitle and translatedAbstract only.`,
    user: JSON.stringify({
      title,
      abstract,
      task: 'Translate the title and abstract into simplified Chinese for fast literature screening. If abstract is empty, return an empty translatedAbstract string.',
    }),
  };
}

async function translateWithOpenAI(payload) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey });
  const { system, user } = buildTranslationMessages(payload);

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });

  return parseStructuredTranslation(completion.choices?.[0]?.message?.content || '');
}

async function translateNewsContent(req, payload) {
  const cacheKey = buildTranslationCacheKey(payload);
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  let result = null;
  let provider = null;
  let lastError = null;

  if (process.env.OPENAI_API_KEY) {
    try {
      result = await translateWithOpenAI(payload);
      provider = 'openai';
    } catch (error) {
      lastError = error;
    }
  }

  if (!result?.translatedTitle && !result?.translatedAbstract) {
    if (lastError) {
      throw lastError;
    }
    throw new Error('No translation provider is configured. Configure OPENAI_API_KEY on the server.');
  }

  const normalized = {
    translatedTitle: result.translatedTitle || '',
    translatedAbstract: result.translatedAbstract || '',
    provider,
  };
  translationCache.set(cacheKey, normalized);
  return normalized;
}

// ---------------------------------------------------------------------------
// GET /api/news/sources — list all sources with status
// ---------------------------------------------------------------------------
router.get('/sources', async (req, res) => {
  try {
    const sources = await buildSourceInfoList(req.user?.id);
    res.json({ sources });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list sources', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/news/bootstrap — one-shot cached dashboard payload
// ---------------------------------------------------------------------------
router.get('/bootstrap', async (req, res) => {
  try {
    res.json(await buildNewsBootstrap(req.user?.id));
  } catch (err) {
    res.status(500).json({ error: 'Failed to load news dashboard cache', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/news/config/:source — per-source config
// ---------------------------------------------------------------------------
router.get('/config/:source', async (req, res) => {
  try {
    const entry = getSourceEntry(req.params.source);
    if (!entry) return res.status(404).json({ error: `Unknown source: ${req.params.source}` });

    await ensureDataDir();
    res.json(await readSourceConfig(req.params.source, entry, req.user?.id));
  } catch (err) {
    res.status(500).json({ error: 'Failed to read config', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/news/config/:source — save per-source config
// ---------------------------------------------------------------------------
router.put('/config/:source', async (req, res) => {
  try {
    const entry = getSourceEntry(req.params.source);
    if (!entry) return res.status(404).json({ error: `Unknown source: ${req.params.source}` });

    await ensureDataDir();
    const incoming = { ...(req.body || {}) };
    const fieldMap = SECRET_FIELDS_BY_SOURCE[req.params.source] || {};

    for (const [field, credentialType] of Object.entries(fieldMap)) {
      if (Object.prototype.hasOwnProperty.call(incoming, field)) {
        const raw = incoming[field];
        if (raw === null) {
          deleteNewsCredentialsByType(req.user?.id, credentialType);
        } else if (typeof raw === 'string' && raw.trim()) {
          upsertSingleNewsCredential(
            req.user?.id,
            credentialType,
            `${req.params.source}_${field}`,
            raw.trim(),
          );
        }
      }
      delete incoming[field];
      delete incoming[`${field}_set`];
    }

    const configPath = path.join(DATA_DIR, entry.configFile);
    await fs.writeFile(configPath, JSON.stringify(incoming, null, 2), 'utf8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save config', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/news/config/:source — reset per-source config to defaults
// ---------------------------------------------------------------------------
router.delete('/config/:source', async (req, res) => {
  try {
    const entry = getSourceEntry(req.params.source);
    if (!entry) return res.status(404).json({ error: `Unknown source: ${req.params.source}` });

    await ensureDataDir();
    const configPath = path.join(DATA_DIR, entry.configFile);
    try {
      await fs.unlink(configPath);
    } catch (err) {
      if (err?.code !== 'ENOENT') {
        throw err;
      }
    }

    res.json({
      success: true,
      config: decorateWithSecretFlags(req.params.source, req.user?.id, entry.defaultConfig),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset config', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// Search handler — streams progress via Server-Sent Events (SSE)
// ---------------------------------------------------------------------------
async function handleSearch(sourceName, req, res) {
  try {
    const entry = getSourceEntry(sourceName);
    if (!entry) return res.status(404).json({ error: `Unknown source: ${sourceName}` });
    if (sourceName === 'xiaohongshu' && isWebShellOnlyMode()) {
      return res.status(409).json({
        error: 'Xiaohongshu requires a connected Local Engine.',
        code: 'LOCAL_KERNEL_REQUIRED',
        contextHint: buildLocalKernelRequiredHint(),
      });
    }

    await ensureDataDir();

    // Read current config
    const configPath = path.join(DATA_DIR, entry.configFile);
    let config;
    try {
      config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    } catch {
      config = entry.defaultConfig;
    }
    config = await migrateLegacySecretsInPlace(sourceName, req.user?.id, configPath, config);
    for (const field of Object.keys(SECRET_FIELDS_BY_SOURCE[sourceName] || {})) {
      delete config[field];
      delete config[`${field}_set`];
    }

    if (req.body?.configOverride && typeof req.body.configOverride === 'object') {
      config = {
        ...config,
        ...req.body.configOverride,
        research_domains: req.body.configOverride.research_domains || config.research_domains,
      };
    }
    for (const field of Object.keys(SECRET_FIELDS_BY_SOURCE[sourceName] || {})) {
      delete config[field];
      delete config[`${field}_set`];
    }

    // Write JSON config for the Python script
    const tmpConfigPath = path.join(DATA_DIR, `research_interests_${sourceName}.json`);
    await fs.writeFile(tmpConfigPath, JSON.stringify(config, null, 2), 'utf8');

    const scriptPath = path.join(SCRIPTS_DIR, entry.script);

    // Check if script exists
    try {
      await fs.access(scriptPath);
    } catch {
      return res.status(404).json({ error: `Search script not found for source: ${sourceName}` });
    }

    const resultsPath = path.join(DATA_DIR, entry.resultsFile);
    const topN = config.top_n || 10;

    // Build args based on source
    const args = [scriptPath, '--config', tmpConfigPath, '--output', resultsPath, '--top-n', String(topN)];

    if (sourceName === 'arxiv') {
      const maxResults = config.max_results || 200;
      const categories = config.categories || 'cs.AI,cs.LG,cs.CL,cs.CV,cs.MM,cs.MA,cs.RO';
      args.push('--max-results', String(maxResults), '--categories', categories);
    }

    if (['pubmed', 'europepmc', 'medrxiv'].includes(sourceName)) {
      const maxResults = config.max_results || 120;
      const dateRangeDays = config.date_range_days || 30;
      args.push('--max-results', String(maxResults), '--date-range-days', String(dateRangeDays));
    }

    if (sourceName === 'xiaohongshu' && config.keywords) {
      args.push('--keywords', String(config.keywords));
    }

    if (sourceName === 'wechat') {
      const instance = (typeof config.instance_url === 'string' && config.instance_url.trim())
        ? config.instance_url.trim()
        : 'https://rsshub.app';
      args.push('--instance', instance);

      let accountsList = [];
      if (Array.isArray(config.accounts)) {
        accountsList = config.accounts.map((account) => String(account).trim()).filter(Boolean);
      } else if (typeof config.accounts === 'string') {
        accountsList = config.accounts
          .split(/[\n,]/)
          .map((account) => account.trim())
          .filter(Boolean);
      }
      if (accountsList.length > 0) {
        args.push('--accounts', accountsList.join(','));
      }

      const accessKey = readActiveNewsCredential(
        req.user?.id,
        SECRET_FIELDS_BY_SOURCE.wechat.access_key,
      );
      if (accessKey) {
        args.push('--access-key', accessKey);
      }
      if (Number.isFinite(config.per_account_limit) && config.per_account_limit > 0) {
        args.push('--per-account-limit', String(config.per_account_limit));
      }
    }

    // Build env — pass credentials if required.
    // Strip __PYVENV_LAUNCHER__ so uv-installed Python CLIs invoked by the
    // search scripts find the correct stdlib (macOS Python framework sets this
    // variable and it confuses child interpreters with a different version).
    let env = { ...process.env };
    delete env.__PYVENV_LAUNCHER__;
    const logs = [];
    let strippedProxyKeys = [];
    if (sourceName === 'xiaohongshu') {
      const adjusted = stripUnsupportedSocksProxyEnv(env);
      env = adjusted.env;
      strippedProxyKeys = adjusted.strippedKeys;
      if (strippedProxyKeys.length > 0) {
        logs.push(`[runtime] Ignored SOCKS proxy env for Xiaohongshu: ${strippedProxyKeys.join(', ')}`);
      }

      const xhsExecutable = resolveXhsExecutable({ env });
      if (!xhsExecutable) {
        return res.status(424).json({
          error: 'xiaohongshu-cli is not installed on the Local Engine computer.',
          code: 'XHS_CLI_NOT_FOUND',
          contextHint: buildXhsRuntimeHint(),
          logs,
        });
      }
      env = prependExecutableDirectory(env, xhsExecutable);
      logs.push(`[runtime] Xiaohongshu CLI: ${xhsExecutable}`);
    }
    if (entry.requiresCredentials) {
      try {
        const credValue = credentialsDb.getActiveCredential(req.user.id, entry.credentialType);
        if (!credValue) {
          return res.status(400).json({
            error: `No active credential found for ${entry.label}. Please add your ${entry.credentialType} in settings.`,
          });
        }
        // Map credential types to environment variables
        const credEnvMap = {
          // Add future credential mappings here
        };
        const envVar = credEnvMap[entry.credentialType];
        if (envVar) {
          env[envVar] = credValue;
        }
      } catch (credErr) {
        return res.status(400).json({ error: 'Failed to retrieve credentials', details: credErr.message });
      }
    }

    // Write search logs to a file so they can be polled by the frontend
    const logPath = path.join(DATA_DIR, `news-log-${sourceName}.json`);
    const pythonRuntime = resolvePythonRuntime({ env });
    logs.push(`[runtime] Python 3: ${pythonRuntime.command}${pythonRuntime.args.length ? ` ${pythonRuntime.args.join(' ')}` : ''}`);
    await fs.writeFile(logPath, JSON.stringify(logs), 'utf8');

    const child = spawn(pythonRuntime.command, [...pythonRuntime.args, ...args], {
      cwd: path.join(SCRIPTS_DIR, 'research-news'),
      env,
      windowsHide: true,
    });

    let stdout = '';
    let stderrBuf = '';
    let settled = false;
    let timedOut = false;
    let clientClosed = false;
    let killSent = false;
    let forceKillTimer = null;
    const searchTimeout = setTimeout(() => {
      timedOut = true;
      stopChild(`timeout after ${NEWS_SEARCH_TIMEOUT_MS}ms`);
    }, NEWS_SEARCH_TIMEOUT_MS);

    const finish = (status, payload) => {
      if (settled || res.headersSent || res.writableEnded) return;
      settled = true;
      clearTimeout(searchTimeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      res.status(status).json(payload);
    };

    function stopChild(reason) {
      logs.push(`[runtime] Search process stopped: ${reason}`);
      void fs.writeFile(logPath, JSON.stringify(logs), 'utf8').catch(() => {});
      if (killSent) return;
      killSent = true;
      child.kill('SIGTERM');
      forceKillTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 3000);
    }

    res.on('close', () => {
      if (settled || res.writableEnded) return;
      clientClosed = true;
      stopChild('client disconnected');
    });

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', async (data) => {
      const chunk = data.toString();
      stderrBuf += chunk;
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) logs.push(trimmed);
      }
      // Update log file for polling
      try { await fs.writeFile(logPath, JSON.stringify(logs), 'utf8'); } catch {}
    });

    child.on('close', async (code) => {
      if (stderrBuf.trim()) logs.push(stderrBuf.trim());
      try { await fs.writeFile(logPath, JSON.stringify(logs), 'utf8'); } catch {}
      clearTimeout(searchTimeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);

      if (clientClosed) {
        settled = true;
        return;
      }

      if (timedOut) {
        return finish(504, {
          error: `Search timed out for ${entry.label}`,
          details: logs.join('\n'),
          logs,
          exitCode: code,
        });
      }

      if (code !== 0) {
        if (sourceName === 'xiaohongshu' && hasSocksProxyImportError(logs)) {
          logs.unshift(`[hint] ${buildXhsProxyHint(strippedProxyKeys)}`);
        } else if (sourceName === 'xiaohongshu' && hasBrokenXhsRuntimeError(logs)) {
          logs.unshift(`[hint] ${buildXhsRuntimeHint()}`);
        }
        console.error(`[news][${sourceName}] script failed (exit ${code})`);
        return finish(500, {
          error: sourceName === 'xiaohongshu' && hasSocksProxyImportError(logs)
            ? `Search failed for ${entry.label}: SOCKS proxy support is not available in the current Xiaohongshu CLI runtime.`
            : sourceName === 'xiaohongshu' && hasBrokenXhsRuntimeError(logs)
              ? `Search failed for ${entry.label}: xiaohongshu-cli is unavailable or broken.`
              : `Search failed for ${entry.label}`,
          details: logs.join('\n'),
          logs,
          exitCode: code,
        });
      }

      try {
        const results = JSON.parse(await fs.readFile(resultsPath, 'utf8'));
        results.logs = logs;
        finish(200, results);
      } catch (readErr) {
        finish(500, { error: 'Failed to read search results', details: readErr.message });
      }
    });

    child.on('error', (err) => {
      console.error(`[news][${sourceName}] Failed to spawn script:`, err);
      finish(500, { error: 'Failed to execute search script', details: err.message });
    });
  } catch (err) {
    res.status(500).json({ error: 'Search failed', details: err.message });
  }
}

// POST /api/news/search/:source — trigger search for one source
router.post('/search/:source', (req, res) => handleSearch(req.params.source, req, res));

// GET /api/news/logs/:source — poll search progress logs
router.get('/logs/:source', async (req, res) => {
  try {
    const logPath = path.join(DATA_DIR, `news-log-${req.params.source}.json`);
    const data = await fs.readFile(logPath, 'utf8');
    res.json({ logs: JSON.parse(data) });
  } catch {
    res.json({ logs: [] });
  }
});

// ---------------------------------------------------------------------------
// POST /api/news/xhs-login — trigger xiaohongshu-cli login
// ---------------------------------------------------------------------------
router.post('/xhs-login', (req, res) => {
  if (isWebShellOnlyMode()) {
    return res.status(409).json({
      success: false,
      error: 'Xiaohongshu requires a connected Local Engine.',
      code: 'LOCAL_KERNEL_REQUIRED',
      contextHint: buildLocalKernelRequiredHint(),
      logs: [],
    });
  }

  const requestedMethod = req.body?.method === 'qrcode' ? 'qrcode' : 'browser';
  const requestedCookieSource = typeof req.body?.cookieSource === 'string'
    ? req.body.cookieSource.trim().toLowerCase()
    : 'auto';
  const allowedCookieSources = new Set([
    'auto', 'arc', 'brave', 'chrome', 'chromium', 'edge', 'firefox', 'librewolf', 'opera', 'opera_gx', 'safari', 'vivaldi',
  ]);
  const cookieSource = allowedCookieSources.has(requestedCookieSource) ? requestedCookieSource : 'auto';
  const commandArgs = ['login'];
  if (requestedMethod === 'qrcode') {
    commandArgs.push('--qrcode');
  } else if (cookieSource !== 'auto') {
    commandArgs.push('--cookie-source', cookieSource);
  }
  commandArgs.push('--json');

  const adjustedProxyEnv = stripUnsupportedSocksProxyEnv(process.env);
  const xhsEnv = adjustedProxyEnv.env;
  delete xhsEnv.__PYVENV_LAUNCHER__;
  const logs = [];
  if (adjustedProxyEnv.strippedKeys.length > 0) {
    logs.push(`[runtime] Ignored SOCKS proxy env for Xiaohongshu login: ${adjustedProxyEnv.strippedKeys.join(', ')}`);
  }
  const xhsExecutable = resolveXhsExecutable({ env: xhsEnv });
  if (!xhsExecutable) {
    return res.status(424).json({
      success: false,
      error: '小红书 CLI 尚未安装。',
      code: 'XHS_CLI_NOT_FOUND',
      contextHint: buildXhsRuntimeHint(),
      logs,
      method: requestedMethod,
      cookieSource,
    });
  }
  logs.push(`[runtime] Xiaohongshu CLI: ${xhsExecutable}`);
  const resolvedXhsEnv = prependExecutableDirectory(xhsEnv, xhsExecutable);
  const child = spawn(xhsExecutable, commandArgs, {
    env: resolvedXhsEnv,
    windowsHide: true,
  });

  let stdoutBuf = '';
  let stderrBuf = '';
  let responded = false;

  const sendOnce = (status, payload) => {
    if (responded || res.headersSent) return;
    responded = true;
    res.status(status).json(payload);
  };

  child.stdout.on('data', (data) => { stdoutBuf += data.toString(); });
  child.stderr.on('data', (data) => {
    stderrBuf += data.toString();
    const lines = stderrBuf.split('\n');
    stderrBuf = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) logs.push(trimmed);
    }
  });

  child.on('close', (code) => {
    if (stderrBuf.trim()) logs.push(stderrBuf.trim());

    let authenticated = false;
    let nickname = '';
    let error = '';
    let contextHint = '';
    const socksProxyIssue = hasSocksProxyImportError(logs);
    const brokenRuntimeIssue = hasBrokenXhsRuntimeError(logs, stdoutBuf);
    const result = parseXhsJsonOutput(stdoutBuf);
    if (result) {
      authenticated = !!(result?.ok && result?.data?.authenticated);
      nickname = result?.data?.user?.nickname || '';
      if (!authenticated) {
        error = result?.error?.message || result?.message || '';
      }
    } else {
      authenticated = code === 0;
      if (!authenticated) {
        error = stdoutBuf.trim();
      }
    }

    if (!authenticated && socksProxyIssue) {
      error = '小红书 CLI 在当前运行环境里检测到了 SOCKS 代理，但缺少 socksio 依赖。';
      contextHint = buildXhsProxyHint(adjustedProxyEnv.strippedKeys);
    } else if (!authenticated && brokenRuntimeIssue) {
      error = '小红书 CLI 当前不可用或安装已损坏。';
      contextHint = buildXhsRuntimeHint();
    } else if (!authenticated && !error) {
      error = requestedMethod === 'qrcode'
        ? 'QR login failed or timed out.'
        : 'Browser cookie extraction failed.';
    }

    if (!authenticated && !contextHint) {
      contextHint = requestedMethod === 'qrcode'
        ? 'QR login is recommended for remote deployments and Linux browser-cookie issues.'
        : 'Browser cookie extraction runs on the machine hosting the MedHelp service, not on the device where this page is open.';
    }

    sendOnce(200, {
      success: authenticated,
      nickname,
      logs,
      exitCode: code,
      method: requestedMethod,
      cookieSource,
      error,
      contextHint: contextHint || undefined,
    });
  });

  child.on('error', (err) => {
    const brokenRuntimeIssue = hasBrokenXhsRuntimeError(logs, err.message);
    const contextHint = brokenRuntimeIssue
      ? buildXhsRuntimeHint()
      : requestedMethod === 'qrcode'
      ? 'QR login is recommended for remote deployments and Linux browser-cookie issues.'
      : 'Browser cookie extraction runs on the machine hosting the MedHelp service, not on the device where this page is open.';

    sendOnce(500, {
      success: false,
      error: brokenRuntimeIssue
        ? '小红书 CLI 当前不可用或安装已损坏。'
        : `Failed to run xhs login: ${err.message}`,
      logs,
      method: requestedMethod,
      cookieSource,
      contextHint,
    });
  });
});

// ---------------------------------------------------------------------------
// GET /api/news/results/:source — cached results for one source
// ---------------------------------------------------------------------------
router.get('/results/:source', async (req, res) => {
  try {
    const entry = getSourceEntry(req.params.source);
    if (!entry) return res.status(404).json({ error: `Unknown source: ${req.params.source}` });

    res.json(await readSourceResults(entry));
  } catch (err) {
    res.status(500).json({ error: 'Failed to read results', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/news/translate — translate a paper title/abstract on demand
// ---------------------------------------------------------------------------
router.post('/translate', async (req, res) => {
  try {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const abstract = typeof req.body?.abstract === 'string' ? req.body.abstract.trim() : '';
    const targetLanguage = typeof req.body?.targetLanguage === 'string' && req.body.targetLanguage.trim()
      ? req.body.targetLanguage.trim()
      : 'zh-CN';

    if (!title && !abstract) {
      return res.status(400).json({ error: 'title or abstract is required' });
    }

    const translation = await translateNewsContent(req, {
      title,
      abstract,
      targetLanguage,
    });

    res.json(translation);
  } catch (err) {
    res.status(500).json({ error: 'Failed to translate news item', details: err.message });
  }
});

// ---------------------------------------------------------------------------
// Backward-compatible aliases (old routes → arxiv source)
// ---------------------------------------------------------------------------
router.get('/config', async (req, res) => {
  try {
    await ensureDataDir();
    const entry = SOURCE_REGISTRY.arxiv;
    const configPath = path.join(DATA_DIR, entry.configFile);
    const data = await fs.readFile(configPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    if (err.code === 'ENOENT') {
      res.json(SOURCE_REGISTRY.arxiv.defaultConfig);
    } else {
      res.status(500).json({ error: 'Failed to read config', details: err.message });
    }
  }
});

router.put('/config', async (req, res) => {
  try {
    const entry = SOURCE_REGISTRY.arxiv;
    await ensureDataDir();
    const configPath = path.join(DATA_DIR, entry.configFile);
    await fs.writeFile(configPath, JSON.stringify(req.body, null, 2), 'utf8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save config', details: err.message });
  }
});

router.post('/search', (req, res) => handleSearch('arxiv', req, res));

router.get('/results', async (req, res) => {
  try {
    const entry = SOURCE_REGISTRY.arxiv;
    const resultsPath = path.join(DATA_DIR, entry.resultsFile);
    const data = await fs.readFile(resultsPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Also try the legacy path for backward compat
      try {
        const legacyPath = path.join(DATA_DIR, 'news-results.json');
        const data = await fs.readFile(legacyPath, 'utf8');
        res.json(JSON.parse(data));
      } catch {
        res.json({ top_papers: [], total_found: 0, total_filtered: 0 });
      }
    } else {
      res.status(500).json({ error: 'Failed to read results', details: err.message });
    }
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function buildYamlConfig(config) {
  let yaml = '# Auto-generated from MedHelp® News Dashboard config\n\n';
  yaml += 'research_domains:\n';

  const domains = config.research_domains || {};
  for (const [name, domain] of Object.entries(domains)) {
    yaml += `  "${name}":\n`;
    yaml += `    keywords:\n`;
    for (const kw of domain.keywords || []) {
      yaml += `      - "${kw}"\n`;
    }
    if (domain.arxiv_categories?.length) {
      yaml += `    arxiv_categories:\n`;
      for (const cat of domain.arxiv_categories) {
        yaml += `      - "${cat}"\n`;
      }
    }
    if (domain.priority) {
      yaml += `    priority: ${domain.priority}\n`;
    }
  }

  return yaml;
}

export default router;
