import { promises as fs } from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { appSettingsDb, referencesDb, userDb } from '../database/db.js';
import {
  CLAUDE_MODELS,
  CODEX_MODELS,
  LOCAL_MODELS,
} from '../../shared/modelConstants.js';
import { buildNewsReferenceId, ingestMonitorNewsItem } from '../utils/news-monitor-ingest.js';
import { normalizeExtractionConfig } from '../utils/literature-concept-extractor.js';
import { resolvePythonRuntime } from '../utils/newsRuntime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(SERVER_DIR, 'data');
const SCRIPTS_DIR = path.join(SERVER_DIR, 'scripts');

const MONITOR_SCHEDULER_SETTING_KEY = 'monitor_scheduler_config_v1';

const SOURCE_REGISTRY = {
  pubmed: {
    label: 'PubMed',
    description: '定时抓取已配置主题下的最新医学文献，并把未见过的新论文送入资料库与候选池。',
    script: 'research-news/search_pubmed.py',
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
      },
      top_n: 12,
      max_results: 120,
      date_range_days: 30,
    },
  },
  medrxiv: {
    label: 'medRxiv',
    description: '定时抓取临床预印本，用来提前发现尚未正式发表的新指标、新疾病分层和新评分模型。',
    script: 'research-news/search_medrxiv.py',
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
      },
      top_n: 10,
      max_results: 120,
      date_range_days: 21,
    },
  },
  europepmc: {
    label: 'Europe PMC',
    description: '定时抓取 Europe PMC 文献，补充 PubMed 覆盖外的开放文献与跨库结果。',
    script: 'research-news/search_europepmc.py',
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
      },
      top_n: 10,
      max_results: 120,
      date_range_days: 30,
    },
  },
  arxiv: {
    label: 'arXiv',
    description: '定时抓取医学 AI 与方法学相关预印本，补充前沿模型与算法方向的动态。',
    script: 'research-news/search_arxiv.py',
    resultsFile: 'news-results-arxiv.json',
    defaultConfig: {
      research_domains: {
        'Medical Imaging AI': {
          keywords: ['medical imaging', 'radiology AI', 'diagnostic model', 'external validation', 'MIMIC-CXR', 'NIH ChestXray14', 'RSNA', 'OASIS'],
          arxiv_categories: ['cs.CV', 'eess.IV', 'cs.LG'],
          priority: 5,
        },
        'Clinical NLP': {
          keywords: ['clinical NLP', 'electronic health record', 'clinical note', 'medical language model', 'MIMIC-IV', 'PhysioNet', 'i2b2', 'n2c2'],
          arxiv_categories: ['cs.CL', 'cs.AI'],
          priority: 4,
        },
      },
      top_n: 10,
      max_results: 120,
      date_range_days: 21,
    },
  },
};

const AUTOMATED_SOURCE_KEYS = Object.keys(SOURCE_REGISTRY);
const DEFAULT_SOURCE_SETTINGS = {
  pubmed: {
    enabled: true,
    frequency_hours: 12,
    ingest_limit: 3,
    last_run_at: null,
    last_status: 'idle',
    last_error: null,
    last_result_count: 0,
    last_ingested_count: 0,
  },
  medrxiv: {
    enabled: true,
    frequency_hours: 24,
    ingest_limit: 2,
    last_run_at: null,
    last_status: 'idle',
    last_error: null,
    last_result_count: 0,
    last_ingested_count: 0,
  },
  europepmc: {
    enabled: true,
    frequency_hours: 24,
    ingest_limit: 2,
    last_run_at: null,
    last_status: 'idle',
    last_error: null,
    last_result_count: 0,
    last_ingested_count: 0,
  },
  arxiv: {
    enabled: true,
    frequency_hours: 24,
    ingest_limit: 2,
    last_run_at: null,
    last_status: 'idle',
    last_error: null,
    last_result_count: 0,
    last_ingested_count: 0,
  },
};

const DEFAULT_SCHEDULER_CONFIG = {
  enabled: true,
  poll_interval_minutes: 15,
  sources: DEFAULT_SOURCE_SETTINGS,
  extraction: {
    provider: 'claude',
    model: CLAUDE_MODELS.DEFAULT || 'opus',
  },
};

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, minimum), maximum);
}

function normalizeBoolean(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }
  return fallback;
}

function normalizeSourceSettings(sourceKey, raw = {}) {
  const defaults = DEFAULT_SOURCE_SETTINGS[sourceKey];
  return {
    enabled: normalizeBoolean(raw.enabled, defaults.enabled),
    frequency_hours: clampInteger(raw.frequency_hours, defaults.frequency_hours, 1, 24 * 14),
    ingest_limit: clampInteger(raw.ingest_limit, defaults.ingest_limit, 0, 20),
    last_run_at: typeof raw.last_run_at === 'string' && raw.last_run_at ? raw.last_run_at : null,
    last_status: typeof raw.last_status === 'string' && raw.last_status ? raw.last_status : defaults.last_status,
    last_error: typeof raw.last_error === 'string' && raw.last_error ? raw.last_error : null,
    last_result_count: clampInteger(raw.last_result_count, defaults.last_result_count, 0, 100000),
    last_ingested_count: clampInteger(raw.last_ingested_count, defaults.last_ingested_count, 0, 100000),
  };
}

function normalizeSchedulerConfig(raw = {}) {
  const sources = {};
  for (const sourceKey of AUTOMATED_SOURCE_KEYS) {
    sources[sourceKey] = normalizeSourceSettings(sourceKey, raw?.sources?.[sourceKey]);
  }

  return {
    enabled: normalizeBoolean(raw.enabled, DEFAULT_SCHEDULER_CONFIG.enabled),
    poll_interval_minutes: clampInteger(raw.poll_interval_minutes, DEFAULT_SCHEDULER_CONFIG.poll_interval_minutes, 5, 24 * 60),
    sources,
    extraction: normalizeExtractionConfig(raw?.extraction || DEFAULT_SCHEDULER_CONFIG.extraction),
    updated_at: typeof raw.updated_at === 'string' && raw.updated_at ? raw.updated_at : null,
  };
}

function loadStoredSchedulerConfig() {
  const raw = appSettingsDb.get(MONITOR_SCHEDULER_SETTING_KEY);
  if (!raw) {
    return null;
  }

  try {
    return normalizeSchedulerConfig(JSON.parse(raw));
  } catch {
    return normalizeSchedulerConfig({});
  }
}

function persistSchedulerConfig(config) {
  const nextConfig = {
    ...normalizeSchedulerConfig(config),
    updated_at: new Date().toISOString(),
  };
  appSettingsDb.set(MONITOR_SCHEDULER_SETTING_KEY, JSON.stringify(nextConfig));
  return nextConfig;
}

function mergeSchedulerPatch(currentConfig, patch = {}) {
  const merged = {
    ...currentConfig,
    enabled: Object.prototype.hasOwnProperty.call(patch, 'enabled')
      ? normalizeBoolean(patch.enabled, currentConfig.enabled)
      : currentConfig.enabled,
    poll_interval_minutes: Object.prototype.hasOwnProperty.call(patch, 'poll_interval_minutes')
      ? clampInteger(patch.poll_interval_minutes, currentConfig.poll_interval_minutes, 5, 24 * 60)
      : currentConfig.poll_interval_minutes,
    sources: { ...currentConfig.sources },
    extraction: normalizeExtractionConfig(patch.extraction || currentConfig.extraction),
  };

  if (patch.sources && typeof patch.sources === 'object') {
    for (const sourceKey of AUTOMATED_SOURCE_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(patch.sources, sourceKey)) {
        continue;
      }
      merged.sources[sourceKey] = normalizeSourceSettings(sourceKey, {
        ...currentConfig.sources[sourceKey],
        ...patch.sources[sourceKey],
      });
    }
  }

  return normalizeSchedulerConfig(merged);
}

function computeNextRunAt(lastRunAt, frequencyHours) {
  if (!lastRunAt) {
    return null;
  }

  const parsed = new Date(lastRunAt);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return new Date(parsed.getTime() + frequencyHours * 60 * 60 * 1000).toISOString();
}

function isSourceDue(sourceConfig) {
  if (!sourceConfig?.enabled) {
    return false;
  }

  if (!sourceConfig.last_run_at) {
    return true;
  }

  const nextRunAt = computeNextRunAt(sourceConfig.last_run_at, sourceConfig.frequency_hours);
  if (!nextRunAt) {
    return true;
  }

  return Date.now() >= new Date(nextRunAt).getTime();
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readSourceConfig(sourceKey) {
  const sourceEntry = SOURCE_REGISTRY[sourceKey];
  if (!sourceEntry) {
    throw new Error(`Unsupported monitor source: ${sourceKey}`);
  }

  const configFile = path.join(DATA_DIR, `news-config-${sourceKey}.json`);
  try {
    const raw = await fs.readFile(configFile, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return sourceEntry.defaultConfig;
    }
    throw error;
  }
}

async function readSourceResults(sourceKey) {
  const sourceEntry = SOURCE_REGISTRY[sourceKey];
  if (!sourceEntry) {
    throw new Error(`Unsupported monitor source: ${sourceKey}`);
  }

  const resultsPath = path.join(DATA_DIR, sourceEntry.resultsFile);
  try {
    const raw = await fs.readFile(resultsPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { top_papers: [], total_found: 0, total_filtered: 0 };
    }
    throw error;
  }
}

async function runSourceSearch(sourceKey) {
  const sourceEntry = SOURCE_REGISTRY[sourceKey];
  if (!sourceEntry) {
    throw new Error(`Unsupported monitor source: ${sourceKey}`);
  }

  await ensureDataDir();

  const config = await readSourceConfig(sourceKey);
  const tmpConfigPath = path.join(DATA_DIR, `monitor_scheduler_${sourceKey}.json`);
  await fs.writeFile(tmpConfigPath, JSON.stringify(config, null, 2), 'utf8');

  const scriptPath = path.join(SCRIPTS_DIR, sourceEntry.script);
  const resultsPath = path.join(DATA_DIR, sourceEntry.resultsFile);
  const args = [
    scriptPath,
    '--config',
    tmpConfigPath,
    '--output',
    resultsPath,
    '--top-n',
    String(clampInteger(config?.top_n, 10, 1, 50)),
  ];

  args.push(
    '--max-results',
    String(clampInteger(config?.max_results, 120, 20, 500)),
    '--date-range-days',
    String(clampInteger(config?.date_range_days, 30, 1, 365)),
  );

  const env = { ...process.env };
  delete env.__PYVENV_LAUNCHER__;

  const logs = [];
  await new Promise((resolve, reject) => {
    const pythonRuntime = resolvePythonRuntime({ env });
    logs.push(`[runtime] Python 3: ${pythonRuntime.command}${pythonRuntime.args.length ? ` ${pythonRuntime.args.join(' ')}` : ''}`);
    const child = spawn(pythonRuntime.command, [...pythonRuntime.args, ...args], {
      cwd: path.join(SCRIPTS_DIR, 'research-news'),
      env,
      windowsHide: true,
    });

    let stderrBuffer = '';
    child.stdout.on('data', () => {});
    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderrBuffer += chunk;
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          logs.push(trimmed);
        }
      }
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (stderrBuffer.trim()) {
        logs.push(stderrBuffer.trim());
      }

      if (code !== 0) {
        return reject(new Error(logs.join('\n') || `Search failed for ${sourceEntry.label}`));
      }

      resolve(null);
    });
  });

  const results = await readSourceResults(sourceKey);
  return {
    ...results,
    logs,
  };
}

function mapPreviewItem(item = {}) {
  return {
    id: typeof item.id === 'string' ? item.id : '',
    title: typeof item.title === 'string' ? item.title : '',
    published: typeof item.published === 'string' ? item.published : '',
    matched_domain: typeof item.matched_domain === 'string' ? item.matched_domain : '',
    final_score: Number.isFinite(item.final_score) ? Number(item.final_score) : null,
    link: typeof item.link === 'string' ? item.link : '',
    source: typeof item.source === 'string' ? item.source : '',
  };
}

class MonitorSchedulerService {
  constructor() {
    this.timer = null;
    this.runningSources = new Set();
    this.started = false;
  }

  async getState() {
    const stored = loadStoredSchedulerConfig();
    const config = stored || normalizeSchedulerConfig({});
    const sources = await Promise.all(
      AUTOMATED_SOURCE_KEYS.map(async (sourceKey) => {
        const sourceEntry = SOURCE_REGISTRY[sourceKey];
        const results = await readSourceResults(sourceKey);
        const sourceConfig = config.sources[sourceKey];
        return {
          source_key: sourceKey,
          label: sourceEntry.label,
          description: sourceEntry.description,
          enabled: sourceConfig.enabled,
          frequency_hours: sourceConfig.frequency_hours,
          ingest_limit: sourceConfig.ingest_limit,
          last_run_at: sourceConfig.last_run_at,
          next_run_at: computeNextRunAt(sourceConfig.last_run_at, sourceConfig.frequency_hours),
          last_status: sourceConfig.last_status,
          last_error: sourceConfig.last_error,
          last_result_count: sourceConfig.last_result_count,
          last_ingested_count: sourceConfig.last_ingested_count,
          latest_search_date: typeof results?.search_date === 'string' ? results.search_date : null,
          preview_items: Array.isArray(results?.top_papers) ? results.top_papers.slice(0, 3).map(mapPreviewItem) : [],
        };
      }),
    );

    return {
      configured: Boolean(stored),
      enabled: config.enabled,
      poll_interval_minutes: config.poll_interval_minutes,
      extraction: config.extraction,
      updated_at: config.updated_at,
      sources,
    };
  }

  async updateConfig(patch = {}) {
    const currentConfig = loadStoredSchedulerConfig() || normalizeSchedulerConfig({});
    const nextConfig = persistSchedulerConfig(mergeSchedulerPatch(currentConfig, patch));
    this.restart();
    return {
      scheduler: await this.getState(),
      persisted: nextConfig,
    };
  }

  async runSourceNow(sourceKey, { reason = 'manual' } = {}) {
    if (!SOURCE_REGISTRY[sourceKey]) {
      throw new Error(`Unsupported monitor source: ${sourceKey}`);
    }

    if (this.runningSources.has(sourceKey)) {
      return {
        source_key: sourceKey,
        skipped: true,
        message: `${SOURCE_REGISTRY[sourceKey].label} monitor is already running`,
        scheduler: await this.getState(),
      };
    }

    const user = userDb.getFirstUser();
    if (!user?.id) {
      throw new Error('No active user is available for scheduler ingestion');
    }

    let currentConfig = loadStoredSchedulerConfig();
    if (!currentConfig) {
      currentConfig = persistSchedulerConfig(normalizeSchedulerConfig({}));
    }

    const sourceConfig = currentConfig.sources[sourceKey];
    this.runningSources.add(sourceKey);

    try {
      currentConfig.sources[sourceKey] = {
        ...sourceConfig,
        last_status: 'running',
        last_error: null,
      };
      persistSchedulerConfig(currentConfig);

      const results = await runSourceSearch(sourceKey);
      const papers = Array.isArray(results?.top_papers) ? results.top_papers : [];

      let ingestedCount = 0;
      let skippedCount = 0;
      const processed = [];

      for (const item of papers) {
        if (ingestedCount >= sourceConfig.ingest_limit) {
          break;
        }

        const predictedReferenceId = buildNewsReferenceId(user.id, item, sourceKey);
        if (referencesDb.getReference(predictedReferenceId, user.id)) {
          skippedCount += 1;
          processed.push({
            title: item?.title || '',
            reference_id: predictedReferenceId,
            skipped: true,
            candidate_count: 0,
          });
          continue;
        }

        const ingestion = ingestMonitorNewsItem({
          userId: user.id,
          item,
          sourceKey,
          triggerType: reason === 'scheduled' ? 'scheduled_monitor' : 'manual_monitor',
          metadata: {
            scheduler_reason: reason,
            matched_domain: item?.matched_domain || '',
          },
          extractionConfig: currentConfig.extraction,
        });

        const resolvedIngestion = await ingestion;
        ingestedCount += resolvedIngestion.skipped ? 0 : 1;
        processed.push({
          title: item?.title || '',
          reference_id: resolvedIngestion.referenceId,
          skipped: Boolean(resolvedIngestion.skipped),
          candidate_count: resolvedIngestion.candidateCount || 0,
        });
      }

      const nextConfig = persistSchedulerConfig({
        ...currentConfig,
        sources: {
          ...currentConfig.sources,
          [sourceKey]: {
            ...sourceConfig,
            last_run_at: new Date().toISOString(),
            last_status: 'ok',
            last_error: null,
            last_result_count: papers.length,
            last_ingested_count: ingestedCount,
          },
        },
      });

      return {
        source_key: sourceKey,
        result_count: papers.length,
        ingested_count: ingestedCount,
        skipped_count: skippedCount,
        processed,
        persisted: nextConfig,
        scheduler: await this.getState(),
      };
    } catch (error) {
      persistSchedulerConfig({
        ...currentConfig,
        sources: {
          ...currentConfig.sources,
          [sourceKey]: {
            ...sourceConfig,
            last_run_at: new Date().toISOString(),
            last_status: 'error',
            last_error: error instanceof Error ? error.message : 'Unknown scheduler error',
            last_ingested_count: 0,
          },
        },
      });
      throw error;
    } finally {
      this.runningSources.delete(sourceKey);
    }
  }

  async runDueSources() {
    const stored = loadStoredSchedulerConfig();
    if (!stored?.enabled) {
      return;
    }

    for (const sourceKey of AUTOMATED_SOURCE_KEYS) {
      if (!isSourceDue(stored.sources[sourceKey])) {
        continue;
      }

      try {
        await this.runSourceNow(sourceKey, { reason: 'scheduled' });
      } catch (error) {
        console.warn(`[monitor-scheduler] ${sourceKey} failed:`, error?.message || error);
      }
    }
  }

  scheduleNextTick() {
    if (!this.started) {
      return;
    }

    const stored = loadStoredSchedulerConfig();
    const waitMinutes = stored?.poll_interval_minutes || DEFAULT_SCHEDULER_CONFIG.poll_interval_minutes;
    this.timer = setTimeout(async () => {
      try {
        await this.runDueSources();
      } finally {
        this.scheduleNextTick();
      }
    }, waitMinutes * 60 * 1000);
  }

  start() {
    if (this.started) {
      return;
    }

    this.started = true;
    void this.runDueSources().catch((error) => {
      console.warn('[monitor-scheduler] initial due-check failed:', error?.message || error);
    });
    this.scheduleNextTick();
  }

  stop() {
    this.started = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  restart() {
    this.stop();
    this.start();
  }
}

const monitorSchedulerService = new MonitorSchedulerService();

export { AUTOMATED_SOURCE_KEYS, monitorSchedulerService };
