import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { credentialsDb } from '../database/db.js';
import { resolvePythonRuntime } from '../utils/newsRuntime.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Data directory for news config & results
const DATA_DIR = path.join(__dirname, '..', 'data');
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');
const NEWS_SEARCH_TIMEOUT_MS = Number(process.env.NEWS_SEARCH_TIMEOUT_MS || 180_000);

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

async function readSourceConfig(entry) {
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

  return parsed;
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
    Promise.all(entries.map(async ([key, entry]) => [key, await readSourceConfig(entry)])),
    Promise.all(entries.map(async ([key, entry]) => [key, await readSourceResults(entry)])),
  ]);

  return {
    sources,
    configs: Object.fromEntries(configs),
    results: Object.fromEntries(results),
    generatedAt: new Date().toISOString(),
  };
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
    res.json(await readSourceConfig(entry));
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
      config: entry.defaultConfig,
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

    await ensureDataDir();

    // Read current config
    const configPath = path.join(DATA_DIR, entry.configFile);
    let config;
    try {
      config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    } catch {
      config = entry.defaultConfig;
    }

    if (req.body?.configOverride && typeof req.body.configOverride === 'object') {
      config = {
        ...config,
        ...req.body.configOverride,
        research_domains: req.body.configOverride.research_domains || config.research_domains,
      };
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

    // Build env — pass credentials if required.
    // Strip __PYVENV_LAUNCHER__ so uv-installed Python CLIs invoked by the
    // search scripts find the correct stdlib (macOS Python framework sets this
    // variable and it confuses child interpreters with a different version).
    const env = { ...process.env };
    delete env.__PYVENV_LAUNCHER__;
    const logs = [];
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
        console.error(`[news][${sourceName}] script failed (exit ${code})`);
        return finish(500, {
          error: `Search failed for ${entry.label}`,
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
