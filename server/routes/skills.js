import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { extractProjectDirectory, ensureProjectSkillLinks } from '../projects.js';
import { FORBIDDEN_PATHS } from './projects.js';
import { resolveUserSkillsDir } from '../utils/storagePaths.js';
import { resolveSystemSkillsDir } from '../utils/kernelAssetPaths.js';
import { requireCapability } from '../utils/entitlements.js';
import { classifySkillCatalogFileRequest } from '../../shared/skillCatalogVisibility.js';
import { resolveRequestUserId } from '../utils/userScope.js';
import {
  getSkillMarketDetail,
  installSkillMarketEntry,
  listSkillMarket,
  parseMarketSkillId,
  SkillMarketError,
  uninstallSkillMarketEntry,
} from '../utils/skillMarket.js';
import {
  customizeUserSkillDocument,
  resolveUserSkillExtractionPath,
} from '../utils/userSkillFiles.js';

const GLOBAL_SKILLS_DIR = resolveSystemSkillsDir();
const WORKFLOW_CATEGORY_CONFIG_FILE = 'skill-workflow-categories.json';
const WORKFLOW_CATEGORY_KEYS = new Set([
  'pipeline',
  'deepResearch',
  'deepLiteratureSearch',
  'literatureDatabases',
  'citationTrace',
  'paperReading',
  'researchMonitoring',
  'databaseAccess',
  'ideation',
  'preAnalysis',
  'statisticalModeling',
  'medicalViz',
  'resultsIntegration',
  'paperWriting',
  'paperPolishing',
  'graphicalAbstract',
  'paperReview',
  'grantWriting',
  'promotion',
  'other',
]);
const DEFAULT_WORKFLOW_CATEGORY = 'other';
const MAX_SKILL_ZIP_FILES = 200;
const MAX_SKILL_ZIP_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_SKILL_FILE_BYTES = 20 * 1024 * 1024;
const SKILL_DELETE_DISABLED_MESSAGE = 'Skill deletion is disabled. Skills are managed by administrators and cannot be deleted by users.';
const SKILL_WRITE_DISABLED_MESSAGE = 'System skill editing is disabled. Skills are read-only for users.';

const router = express.Router();

function getUserId(req) {
  return resolveRequestUserId(req);
}

function getUserSkillsDir(req) {
  const userId = getUserId(req);
  return userId == null ? null : resolveUserSkillsDir(userId);
}

function getSkillRoots(req) {
  const roots = [{ label: 'system', dir: GLOBAL_SKILLS_DIR }];
  const userDir = getUserSkillsDir(req);
  if (userDir) {
    roots.push({ label: 'user', dir: userDir });
  }
  return roots;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFileIfExists(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function readMergedSkillConfig(req, filePath) {
  if (filePath === 'skill-tag-mapping.json') {
    const merged = {
      version: 1,
      stageOverrides: {},
      categoryOverrides: {},
      domainOverrides: {},
      customTags: {},
      platformNativeSkills: [],
      domainCsAiExceptions: [],
    };
    for (const { dir } of getSkillRoots(req)) {
      const config = await readJsonFileIfExists(path.join(dir, filePath), null);
      if (!config) continue;
      merged.stageOverrides = { ...merged.stageOverrides, ...(config.stageOverrides || {}) };
      merged.categoryOverrides = { ...merged.categoryOverrides, ...(config.categoryOverrides || {}) };
      merged.domainOverrides = { ...merged.domainOverrides, ...(config.domainOverrides || {}) };
      merged.customTags = { ...merged.customTags, ...(config.customTags || {}) };
      merged.platformNativeSkills = Array.from(new Set([...merged.platformNativeSkills, ...(config.platformNativeSkills || [])]));
      merged.domainCsAiExceptions = Array.from(new Set([...merged.domainCsAiExceptions, ...(config.domainCsAiExceptions || [])]));
    }
    return JSON.stringify(merged, null, 2);
  }

  if (filePath === 'stage-skill-map.json') {
    const merged = { skillOrigins: {} };
    for (const { dir } of getSkillRoots(req)) {
      const config = await readJsonFileIfExists(path.join(dir, filePath), null);
      if (!config) continue;
      merged.skillOrigins = { ...merged.skillOrigins, ...(config.skillOrigins || {}) };
    }
    return JSON.stringify(merged, null, 2);
  }

  if (filePath === WORKFLOW_CATEGORY_CONFIG_FILE) {
    const merged = { version: 1, skillCategories: {}, hiddenFromShortcuts: [] };
    for (const { dir } of getSkillRoots(req)) {
      const config = await readJsonFileIfExists(path.join(dir, filePath), null);
      if (!config) continue;
      merged.skillCategories = { ...merged.skillCategories, ...(config.skillCategories || {}) };
      merged.hiddenFromShortcuts = Array.from(new Set([...merged.hiddenFromShortcuts, ...(config.hiddenFromShortcuts || [])]));
    }
    return JSON.stringify(merged, null, 2);
  }

  return null;
}

async function resolveReadableSkillFile(req, filePath) {
  const roots = getSkillRoots(req);
  for (const { dir } of roots) {
    const skillsDir = path.resolve(dir);
    const resolved = path.resolve(skillsDir, filePath);
    if ((!resolved.startsWith(skillsDir + path.sep) && resolved !== skillsDir)) {
      continue;
    }
    if (await pathExists(resolved)) {
      return resolved;
    }
  }
  return null;
}

function normalizeWorkflowCategoryKey(value) {
  const normalized = String(value || '').trim();
  if (normalized === 'baselineTable') return 'preAnalysis';
  return WORKFLOW_CATEGORY_KEYS.has(normalized) ? normalized : DEFAULT_WORKFLOW_CATEGORY;
}

async function readWorkflowCategoryConfig(skillsRoot) {
  const configPath = path.join(skillsRoot, WORKFLOW_CATEGORY_CONFIG_FILE);
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, 'utf8'));
    return {
      version: 1,
      skillCategories: parsed.skillCategories && typeof parsed.skillCategories === 'object'
        ? parsed.skillCategories
        : {},
      hiddenFromShortcuts: Array.isArray(parsed.hiddenFromShortcuts) ? parsed.hiddenFromShortcuts : [],
    };
  } catch {
    return { version: 1, skillCategories: {}, hiddenFromShortcuts: [] };
  }
}

async function writeWorkflowCategoryConfig(skillsRoot, config) {
  await fs.mkdir(skillsRoot, { recursive: true });
  const configPath = path.join(skillsRoot, WORKFLOW_CATEGORY_CONFIG_FILE);
  const normalizedConfig = {
    version: 1,
    skillCategories: config.skillCategories || {},
    hiddenFromShortcuts: Array.isArray(config.hiddenFromShortcuts) ? config.hiddenFromShortcuts : [],
  };
  await fs.writeFile(configPath, JSON.stringify(normalizedConfig, null, 2), 'utf8');
}

async function updateWorkflowCategoryConfig(skillsRoot, skillName, workflowCategory) {
  if (!skillName) return;
  const config = await readWorkflowCategoryConfig(skillsRoot);
  config.skillCategories = config.skillCategories || {};
  config.skillCategories[skillName] = normalizeWorkflowCategoryKey(workflowCategory);
  await writeWorkflowCategoryConfig(skillsRoot, config);
}

async function updateSkillOrigin(skillsRoot, skillName, origin) {
  const stageSkillMapPath = path.join(skillsRoot, 'stage-skill-map.json');
  const stageSkillMap = await readJsonFileIfExists(stageSkillMapPath, { skillOrigins: {} });
  stageSkillMap.skillOrigins = stageSkillMap.skillOrigins || {};
  stageSkillMap.skillOrigins[skillName] = origin;
  await fs.writeFile(stageSkillMapPath, JSON.stringify(stageSkillMap, null, 2), 'utf8');
}

async function removeUserSkillMetadata(skillsRoot, skillName) {
  const tagMappingPath = path.join(skillsRoot, 'skill-tag-mapping.json');
  const tagMapping = await readJsonFileIfExists(tagMappingPath, null);
  if (tagMapping) {
    for (const key of ['stageOverrides', 'categoryOverrides', 'domainOverrides', 'customTags']) {
      if (tagMapping[key] && typeof tagMapping[key] === 'object') delete tagMapping[key][skillName];
    }
    await fs.writeFile(tagMappingPath, JSON.stringify(tagMapping, null, 2), 'utf8');
  }

  const stageSkillMapPath = path.join(skillsRoot, 'stage-skill-map.json');
  const stageSkillMap = await readJsonFileIfExists(stageSkillMapPath, null);
  if (stageSkillMap?.skillOrigins) {
    delete stageSkillMap.skillOrigins[skillName];
    await fs.writeFile(stageSkillMapPath, JSON.stringify(stageSkillMap, null, 2), 'utf8');
  }

  const workflowConfig = await readWorkflowCategoryConfig(skillsRoot);
  delete workflowConfig.skillCategories?.[skillName];
  await writeWorkflowCategoryConfig(skillsRoot, workflowConfig);
}

function sendSkillMarketError(res, error) {
  if (error instanceof SkillMarketError) {
    return res.status(error.status || 500).json({ error: error.message, code: error.code });
  }
  console.error('[skills-market] Unexpected error:', error);
  return res.status(500).json({ error: error.message || 'Skill market request failed' });
}

function inferWorkflowCategoryFromName(name) {
  const signal = String(name || '').toLowerCase();
  if (!signal) return DEFAULT_WORKFLOW_CATEGORY;
  if (/(easyukb-analysis|gco-database-analysis|database-analysis|baseline|table-one)/.test(signal)) return 'preAnalysis';
  if (/(research-news|monitor|weekly-digest|paper-alert|literature-alert|news)/.test(signal)) return 'researchMonitoring';
  if (/(paper-finder|paper-analyzer|paper-reading|read-paper|paper-triage)/.test(signal)) return 'paperReading';
  if (/(citation|reference|bibliography|bibtex|nature-citation|real-literature|trace)/.test(signal)) return 'citationTrace';
  if (/(pubmed|biorxiv|medrxiv|openalex|semantic-scholar|crossref|literature-database)/.test(signal)) return 'literatureDatabases';
  if (/(deep-research|research-lookup|academic-researcher|literature-search|evidence-search)/.test(signal)) return 'deepLiteratureSearch';
  if (/(literature|evidence|systematic-review|meta-analysis|scoping-review)/.test(signal)) return 'deepResearch';
  if (/(database|cohort|biobank|mimic|eicu|nwicu|nhanes|ukb|cfps|cgss|charls|chfs|chip|chns|clds|clhls|css|share|hrs|elsa|klosa|lasi|mhas|pic|geo-database|gco-database|globocan)/.test(signal)) return 'databaseAccess';
  if (/(idea|brainstorm|hypothesis)/.test(signal)) return 'ideation';
  if (/(preanalysis|pre-analysis|data-transform|exploratory-data-analysis|eda)/.test(signal)) return 'preAnalysis';
  if (/(baseline|table)/.test(signal)) return 'preAnalysis';
  if (/(stat|regression|survival|scikit|pymc|shap|modeling)/.test(signal)) return 'statisticalModeling';
  if (/(visual|plot|figure|matplotlib|seaborn|plotly|graph)/.test(signal)) return 'medicalViz';
  if (/(graphical|schematic|abstract)/.test(signal)) return 'graphicalAbstract';
  if (/(writing|manuscript|paper-writing|nature-data)/.test(signal)) return 'paperWriting';
  if (/(polish|humanizer)/.test(signal)) return 'paperPolishing';
  if (/(review|rebuttal|audit)/.test(signal)) return 'paperReview';
  if (/(grant|proposal)/.test(signal)) return 'grantWriting';
  if (/(presentation|slides|poster|pptx|promotion|paper-2-web)/.test(signal)) return 'promotion';
  if (/(pipeline|planner|pathway)/.test(signal)) return 'pipeline';
  return DEFAULT_WORKFLOW_CATEGORY;
}

/**
 * Locate SKILL.md inside a zip (root or one level deep).
 * Returns { entry, prefix } where prefix is '' or 'dirname/'.
 */
function findSkillMd(zip) {
  // Check root
  const rootEntry = zip.getEntry('SKILL.md');
  if (rootEntry) return { entry: rootEntry, prefix: '' };

  // Check one level deep
  for (const entry of zip.getEntries()) {
    const entryName = entry.entryName.replace(/\\/g, '/');
    const parts = entryName.split('/').filter(Boolean);
    if (parts.length === 2 && parts[1] === 'SKILL.md' && entry.isDirectory === false) {
      return { entry, prefix: parts[0] + '/' };
    }
  }
  return null;
}

/**
 * Parse YAML frontmatter from SKILL.md content using gray-matter.
 */
async function parseFrontmatter(content) {
  const matter = (await import('gray-matter')).default;
  const { data, content: body } = matter(content);
  return { data, body };
}

/**
 * Sanitize skill name for use as directory name.
 */
function safeDirName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/**
 * Validate that a zip buffer contains a valid skill package.
 */
async function validateZipBuffer(buffer) {
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(buffer);

  const result = findSkillMd(zip);
  if (!result) {
    return { valid: false, error: 'No SKILL.md found at root or one directory deep.' };
  }

  const content = result.entry.getData().toString('utf8');
  const { data: frontmatter, body } = await parseFrontmatter(content);

  if (!frontmatter || !frontmatter.name) {
    return { valid: false, error: 'SKILL.md must contain YAML frontmatter with a "name" field.' };
  }

  const entries = zip.getEntries();
  const prefix = result.prefix;
  const relevantEntries = prefix
    ? entries.filter(e => e.entryName.replace(/\\/g, '/').startsWith(prefix))
    : entries;
  const fileCount = relevantEntries.filter(e => !e.isDirectory).length;
  const expandedBytes = relevantEntries.reduce((total, entry) => (
    entry.isDirectory ? total : total + Number(entry.header?.size || 0)
  ), 0);
  if (fileCount > MAX_SKILL_ZIP_FILES) {
    return { valid: false, error: `Skill package contains too many files (maximum ${MAX_SKILL_ZIP_FILES}).` };
  }
  if (expandedBytes > MAX_SKILL_ZIP_EXPANDED_BYTES) {
    return { valid: false, error: 'Expanded skill package is too large.' };
  }
  if (relevantEntries.some((entry) => !entry.isDirectory && Number(entry.header?.size || 0) > MAX_SKILL_FILE_BYTES)) {
    return { valid: false, error: 'Skill package contains a file that is too large.' };
  }
  if (relevantEntries.some((entry) => {
    const entryName = entry.entryName.replace(/\\/g, '/');
    const relativeName = prefix && entryName.startsWith(prefix) ? entryName.slice(prefix.length) : entryName;
    return relativeName.includes('\0')
      || relativeName.startsWith('/')
      || /^[A-Za-z]:\//.test(relativeName)
      || relativeName.split('/').some((part) => part === '..');
  })) {
    return { valid: false, error: 'Skill package contains an unsafe file path.' };
  }
  const hasPrompts = relevantEntries.some(e => {
    const rel = prefix ? e.entryName.slice(prefix.length) : e.entryName;
    return rel.startsWith('prompts/') || rel.startsWith('prompt/');
  });
  const hasReferences = relevantEntries.some(e => {
    const rel = prefix ? e.entryName.slice(prefix.length) : e.entryName;
    return rel.startsWith('references/') || rel.startsWith('reference/');
  });

  return {
    valid: true,
    skillName: frontmatter.name,
    frontmatter,
    description: body.trim().split('\n')[0] || '',
    fileCount,
    expandedBytes,
    hasPrompts,
    hasReferences,
    prefix,
    zip,
  };
}

const SKILL_MENTION_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '__pycache__',
]);

const LOCAL_SKILL_SCAN_SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '__pycache__',
]);

async function hasMeaningfulDirectoryContent(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries.some((entry) => {
    if (entry.name.startsWith('.')) return false;
    if (entry.isDirectory() && LOCAL_SKILL_SCAN_SKIP_DIRS.has(entry.name)) return false;
    return true;
  });
}

function compactInlineText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function readSkillMentionMetadata(skillMdPath, fallbackName) {
  try {
    const content = await fs.readFile(skillMdPath, 'utf8');
    const { data, body } = await parseFrontmatter(content);
    const rawId = compactInlineText(data?.id);
    const rawName = compactInlineText(data?.name) || fallbackName;
    const rawDescription = compactInlineText(data?.description)
      || compactInlineText(body.split('\n').find((line) => line.trim() && !line.trim().startsWith('#')) || '');

    return {
      id: rawId || safeDirName(rawName || fallbackName),
      name: rawName,
      description: rawDescription,
    };
  } catch {
    return {
      id: safeDirName(fallbackName),
      name: fallbackName,
      description: '',
    };
  }
}

async function collectSkillMentionCandidates(skillRoots) {
  const candidates = [];

  async function walk(dirPath, relativePath = '') {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const skillMdEntry = entries.find((entry) => entry.isFile() && entry.name === 'SKILL.md');

    if (skillMdEntry) {
      const fallbackName = path.basename(dirPath);
      const metadata = await readSkillMentionMetadata(path.join(dirPath, 'SKILL.md'), fallbackName);
      const mention = safeDirName(metadata.id || fallbackName);

      if (mention) {
        candidates.push({
          mention,
          name: metadata.name || fallbackName,
          dirPath: fallbackName,
          sourcePath: relativePath || fallbackName,
          description: metadata.description,
        });
      }
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKILL_MENTION_SKIP_DIRS.has(entry.name)) {
        continue;
      }

      const childRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      await walk(path.join(dirPath, entry.name), childRelativePath);
    }
  }

  for (const { dir } of skillRoots) {
    try {
      await fs.access(dir);
      await walk(dir);
    } catch {
      // Missing user skills directories are fine.
    }
  }

  const seen = new Set();
  return candidates
    .filter((candidate) => {
      if (seen.has(candidate.mention)) {
        return false;
      }
      seen.add(candidate.mention);
      return true;
    })
    .sort((a, b) => a.mention.localeCompare(b.mention));
}

// GET / — return a merged read-only file tree of system skills + current user's skills.
router.get('/', requireCapability('skills.catalog'), async (req, res) => {
  try {
    const roots = getSkillRoots(req);
    const seenTopLevel = new Set();

    async function buildTree(dirPath, maxDepth, depth, virtualBasePath = dirPath) {
      const items = [];
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        if (['node_modules', 'dist', 'build', '.git'].includes(entry.name)) continue;
        const itemPath = path.join(dirPath, entry.name);
        let isDir = entry.isDirectory();
        if (!isDir && entry.isSymbolicLink()) {
          try { isDir = (await fs.stat(itemPath)).isDirectory(); } catch { /* ignore */ }
        }
        const item = { name: entry.name, path: path.join(virtualBasePath, entry.name), type: isDir ? 'directory' : 'file' };
        if (isDir && depth < maxDepth) {
          try {
            item.children = await buildTree(itemPath, maxDepth, depth + 1, path.join(virtualBasePath, entry.name));
          } catch (childError) {
            console.warn('[skills] Skipping unreadable directory:', itemPath, childError.message);
            item.children = [];
          }
        }
        items.push(item);
      }
      return items;
    }

    const tree = [];
    for (const { label, dir } of roots) {
      try {
        await fs.access(dir);
      } catch {
        continue;
      }
      const rootItems = await buildTree(dir, 5, 0, GLOBAL_SKILLS_DIR);
      for (const item of rootItems) {
        if (seenTopLevel.has(item.name)) {
          if (label === 'user') {
            console.warn(`[skills] User skill "${item.name}" conflicts with a system skill and is hidden from merged tree.`);
          }
          continue;
        }
        seenTopLevel.add(item.name);
        tree.push(item);
      }
    }

    if (tree.length === 0) {
      return res.status(404).json({ error: 'No skills directory found' });
    }
    res.json(tree);
  } catch (error) {
    console.error('[ERROR] Skills tree error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /mentions — compact list used by chat input `/skill` autocomplete
router.get('/mentions', async (req, res) => {
  try {
    const skills = await collectSkillMentionCandidates(getSkillRoots(req));
    res.json({ skills });
  } catch (error) {
    console.error('[ERROR] Skill mentions error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// The chat composer keeps access to the compact mention list above. Everything
// below exposes the full skill catalog or its management surfaces and is Pro-only.
router.use(requireCapability('skills.catalog'));

// GET /market — browse/search third-party skills from the local Kernel.
router.get('/market', async (req, res) => {
  try {
    const userSkillsDir = getUserSkillsDir(req);
    if (!userSkillsDir) return res.status(401).json({ error: 'User context is required to browse the skill market.' });
    await fs.mkdir(userSkillsDir, { recursive: true });
    const result = await listSkillMarket({
      query: String(req.query.q || '').trim(),
      source: String(req.query.source || 'all'),
      limit: req.query.limit,
      userSkillsDir,
      systemSkillsDir: GLOBAL_SKILLS_DIR,
    });
    return res.json(result);
  } catch (error) {
    return sendSkillMarketError(res, error);
  }
});

// GET /market/:source/:slug — inspect files, limits, and install state.
router.get('/market/:source/:slug', async (req, res) => {
  try {
    const userSkillsDir = getUserSkillsDir(req);
    if (!userSkillsDir) return res.status(401).json({ error: 'User context is required to browse the skill market.' });
    const skill = await getSkillMarketDetail(req.params.source, req.params.slug, {
      userSkillsDir,
      systemSkillsDir: GLOBAL_SKILLS_DIR,
    });
    return res.json({ skill });
  } catch (error) {
    return sendSkillMarketError(res, error);
  }
});

// POST /market/install — install into the authenticated user's private skill root.
router.post('/market/install', async (req, res) => {
  try {
    const parsed = parseMarketSkillId(req.body?.id);
    if (!parsed) return res.status(400).json({ error: 'A valid market skill id is required.' });
    const userSkillsDir = getUserSkillsDir(req);
    if (!userSkillsDir) return res.status(401).json({ error: 'User context is required to install skills.' });
    const result = await installSkillMarketEntry({
      ...parsed,
      userSkillsDir,
      systemSkillsDir: GLOBAL_SKILLS_DIR,
    });
    const dirName = safeDirName(parsed.slug);
    await updateSkillOrigin(userSkillsDir, dirName, `market:${parsed.source}`);
    await updateWorkflowCategoryConfig(userSkillsDir, dirName, inferWorkflowCategoryFromName(dirName));

    const projectName = String(req.body?.projectName || '').trim();
    if (projectName) {
      const projectRoot = await extractProjectDirectory(projectName);
      if (projectRoot) await ensureProjectSkillLinks(projectRoot, { userId: getUserId(req) });
    }
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendSkillMarketError(res, error);
  }
});

// DELETE /market/:source/:slug — only removes entries carrying our market marker.
router.delete('/market/:source/:slug', async (req, res) => {
  try {
    const userSkillsDir = getUserSkillsDir(req);
    if (!userSkillsDir) return res.status(401).json({ error: 'User context is required to remove skills.' });
    const result = await uninstallSkillMarketEntry({
      source: req.params.source,
      slug: req.params.slug,
      userSkillsDir,
    });
    await removeUserSkillMetadata(userSkillsDir, safeDirName(req.params.slug));
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendSkillMarketError(res, error);
  }
});

// GET /file — read a single file from the merged read-only skills view.
router.get('/file', async (req, res) => {
  try {
    const { filePath } = req.query;
    if (!filePath) {
      return res.status(400).json({ error: 'filePath is required' });
    }

    const normalizedFilePath = String(filePath).replace(/\\/g, '/');
    if (normalizedFilePath.startsWith('../') || normalizedFilePath.includes('/../') || path.isAbsolute(normalizedFilePath)) {
      return res.status(403).json({ error: 'Path must be under skills root' });
    }

    const mergedConfig = await readMergedSkillConfig(req, normalizedFilePath);
    if (mergedConfig !== null) {
      return res.json({ content: mergedConfig });
    }

    const visibility = classifySkillCatalogFileRequest(normalizedFilePath);

    if (visibility === 'config') {
      const resolved = await resolveReadableSkillFile(req, normalizedFilePath);
      if (!resolved) {
        return res.status(404).json({ error: 'File not found' });
      }
      const content = await fs.readFile(resolved, 'utf8');
      return res.json({ content });
    }

    if (visibility === 'skill-metadata') {
      const resolved = await resolveReadableSkillFile(req, normalizedFilePath);
      if (!resolved) {
        return res.status(404).json({ error: 'File not found' });
      }
      const raw = await fs.readFile(resolved, 'utf8');
      const { data } = await parseFrontmatter(raw);
      const fallbackName = normalizedFilePath.split('/').slice(-2, -1)[0] || 'skill';
      const name = compactInlineText(data?.name) || fallbackName;
      const description = compactInlineText(data?.description);
      // Re-emit as minimal frontmatter so the dashboard's extractSkillMetadata
      // keeps working, while the skill body never leaves the backend.
      const content = `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n`;
      return res.json({ content, metadataOnly: true, name, description });
    }

    return res.status(403).json({ error: 'Skill file contents are not available.' });
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'File not found' });
    } else {
      console.error('[ERROR] Skill file read error:', error.message);
      res.status(500).json({ error: error.message });
    }
  }
});

// PUT /file — disabled: users cannot edit system or imported skills from the catalog.
router.put('/file', (_req, res) => {
  res.status(403).json({ error: SKILL_WRITE_DISABLED_MESSAGE });
});

// GET /scan-local — scan a local directory for skill subdirectories
router.get('/scan-local', async (req, res) => {
  try {
    const rawPath = req.query.path || '~/.claude/skills';
    const resolvedPath = rawPath.replace(/^~/, os.homedir());
    const absolutePath = path.resolve(resolvedPath);

    // Security: reject forbidden system paths
    const normalizedPath = path.normalize(absolutePath);
    for (const forbidden of FORBIDDEN_PATHS) {
      if (normalizedPath === forbidden || normalizedPath.startsWith(forbidden + path.sep)) {
        return res.status(403).json({ error: `Scanning system directory "${forbidden}" is not allowed.` });
      }
    }

    // Validate the path exists and is a directory
    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      return res.status(404).json({ error: `Path does not exist: ${rawPath}` });
    }
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: `Path is not a directory: ${rawPath}` });
    }

    // Scan for subdirectories (1-level deep)
    const entries = await fs.readdir(absolutePath, { withFileTypes: true });
    const skills = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;

      const skillDir = path.join(absolutePath, entry.name);
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      let hasSkillMd = false;
      try {
        await fs.access(skillMdPath);
        hasSkillMd = true;
      } catch {
        // No SKILL.md
      }

      if (!hasSkillMd) {
        let hasVisibleContent = false;
        try {
          hasVisibleContent = await hasMeaningfulDirectoryContent(skillDir);
        } catch {
          hasVisibleContent = false;
        }
        if (!hasVisibleContent) {
          continue;
        }
      }

      // Check if already imported in either system skills or the current user's skills.
      let alreadyImported = false;
      try {
        const userSkillsDir = getUserSkillsDir(req);
        if (
          await pathExists(path.join(GLOBAL_SKILLS_DIR, entry.name))
          || (userSkillsDir && await pathExists(path.join(userSkillsDir, entry.name)))
        ) {
          alreadyImported = true;
        }
      } catch {
        // Not imported
      }

      skills.push({
        name: entry.name,
        hasSkillMd,
        alreadyImported,
        sourcePath: skillDir,
      });
    }

    res.json({ path: rawPath, resolvedPath: absolutePath, skills });
  } catch (error) {
    console.error('[skills] scan-local error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /import-from-local — copy selected skills from a local directory into the current user's skills dir.
router.post('/import-from-local', async (req, res) => {
  try {
    const { sourcePath: rawPath, skillNames, projectName } = req.body || {};
    const userSkillsDir = getUserSkillsDir(req);
    if (!userSkillsDir) {
      return res.status(401).json({ error: 'User context is required to import skills.' });
    }

    const resolvedPath = (rawPath || '~/.claude/skills').replace(/^~/, os.homedir());
    const absolutePath = path.resolve(resolvedPath);

    // Security: reject forbidden system paths
    const normalizedPath = path.normalize(absolutePath);
    for (const forbidden of FORBIDDEN_PATHS) {
      if (normalizedPath === forbidden || normalizedPath.startsWith(forbidden + path.sep)) {
        return res.status(403).json({ error: `Importing from system directory "${forbidden}" is not allowed.` });
      }
    }

    // Validate the path exists and is a directory
    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      return res.status(404).json({ error: `Path does not exist: ${rawPath || '~/.claude/skills'}` });
    }
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: `Path is not a directory: ${rawPath || '~/.claude/skills'}` });
    }

    // If skillNames is provided, only import those; otherwise scan all subdirectories
    let dirsToImport = [];
    if (Array.isArray(skillNames) && skillNames.length > 0) {
      for (const name of skillNames) {
        const skillDir = path.join(absolutePath, name);
        try {
          const s = await fs.stat(skillDir);
          if (s.isDirectory()) {
            dirsToImport.push({ name, sourcePath: skillDir });
          }
        } catch {
          // Skip missing
        }
      }
    } else {
      const entries = await fs.readdir(absolutePath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        dirsToImport.push({ name: entry.name, sourcePath: path.join(absolutePath, entry.name) });
      }
    }

    await fs.mkdir(userSkillsDir, { recursive: true });

    const imported = [];
    const skipped = [];
    const errors = [];

    for (const { name, sourcePath: srcDir } of dirsToImport) {
      const safeSkillName = safeDirName(name);
      if (!safeSkillName) {
        errors.push(`${name}: invalid skill name`);
        continue;
      }
      const destDir = path.join(userSkillsDir, safeSkillName);
      try {
        if (await pathExists(path.join(GLOBAL_SKILLS_DIR, safeSkillName))) {
          skipped.push(name);
          continue;
        }
        if (await pathExists(destDir)) {
          skipped.push(name);
          continue;
        }

        await fs.cp(srcDir, destDir, { recursive: true });

        // Update stage-skill-map.json with origin 'local-import'
        const stageSkillMapPath = path.join(userSkillsDir, 'stage-skill-map.json');
        let stageSkillMap = { skillOrigins: {} };
        try {
          stageSkillMap = JSON.parse(await fs.readFile(stageSkillMapPath, 'utf8'));
        } catch { /* use defaults */ }
        stageSkillMap.skillOrigins = stageSkillMap.skillOrigins || {};
        stageSkillMap.skillOrigins[safeSkillName] = 'local-import';
        await fs.writeFile(stageSkillMapPath, JSON.stringify(stageSkillMap, null, 2), 'utf8');

        const inferredWorkflowCategory = inferWorkflowCategoryFromName(safeSkillName);
        if (inferredWorkflowCategory !== DEFAULT_WORKFLOW_CATEGORY) {
          await updateWorkflowCategoryConfig(userSkillsDir, safeSkillName, inferredWorkflowCategory);
        }

        imported.push(safeSkillName);
      } catch (err) {
        errors.push(`${name}: ${err.message}`);
      }
    }

    if (projectName && imported.length > 0) {
      const projectRoot = await extractProjectDirectory(projectName);
      if (projectRoot) {
        await ensureProjectSkillLinks(projectRoot, { userId: getUserId(req) });
      }
    }

    res.json({ imported, skipped, errors });
  } catch (error) {
    console.error('[skills] import-from-local error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /:projectName/import-user-skills — import from ~/.claude/skills/ into the current user's skills dir.
router.post('/:projectName/import-user-skills', async (req, res) => {
  try {
    const projectName = req.params.projectName;
    const projectRoot = await extractProjectDirectory(projectName);
    if (!projectRoot) {
      return res.status(404).json({ error: 'Project not found.' });
    }

    // Resolve ~/.claude/skills/
    const sourceUserSkillsDir = path.join(os.homedir(), '.claude', 'skills');
    const targetUserSkillsDir = getUserSkillsDir(req);
    if (!targetUserSkillsDir) {
      return res.status(401).json({ error: 'User context is required to import skills.' });
    }

    let stat;
    try {
      stat = await fs.stat(sourceUserSkillsDir);
    } catch {
      return res.status(404).json({ error: 'User skills directory not found (~/.claude/skills/).' });
    }
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: '~/.claude/skills/ is not a directory.' });
    }

    // Scan for subdirs containing SKILL.md
    const entries = await fs.readdir(sourceUserSkillsDir, { withFileTypes: true });
    await fs.mkdir(targetUserSkillsDir, { recursive: true });

    const imported = [];
    const skipped = [];
    const errors = [];

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

      const safeSkillName = safeDirName(entry.name);
      if (!safeSkillName) {
        errors.push(`${entry.name}: invalid skill name`);
        continue;
      }

      const srcDir = path.join(sourceUserSkillsDir, entry.name);

      // Verify SKILL.md exists
      try {
        await fs.access(path.join(srcDir, 'SKILL.md'));
      } catch {
        continue; // Skip dirs without SKILL.md
      }

      const destDir = path.join(targetUserSkillsDir, safeSkillName);

      try {
        // Do not let imported user skills shadow system skills.
        if (await pathExists(path.join(GLOBAL_SKILLS_DIR, safeSkillName))) {
          skipped.push(entry.name);
          continue;
        }
        if (await pathExists(destDir)) {
          skipped.push(entry.name);
          continue;
        }

        await fs.cp(srcDir, destDir, { recursive: true });

        // Parse frontmatter from SKILL.md for tag extraction
        let frontmatter = {};
        try {
          const skillMdContent = await fs.readFile(path.join(srcDir, 'SKILL.md'), 'utf8');
          const parsed = await parseFrontmatter(skillMdContent);
          frontmatter = parsed.data || {};
        } catch { /* ignore parse errors */ }

        // Update skill-tag-mapping.json with tag overrides from frontmatter
        const tagMappingPath = path.join(targetUserSkillsDir, 'skill-tag-mapping.json');
        let tagMapping = { version: 1, stageOverrides: {}, categoryOverrides: {}, domainOverrides: {}, customTags: {}, platformNativeSkills: [], domainCsAiExceptions: [] };
        try {
          tagMapping = JSON.parse(await fs.readFile(tagMappingPath, 'utf8'));
        } catch { /* use defaults */ }
        if (frontmatter.stage) {
          tagMapping.stageOverrides = tagMapping.stageOverrides || {};
          tagMapping.stageOverrides[safeSkillName] = typeof frontmatter.stage === 'string'
            ? { en: `Stage: ${frontmatter.stage}`, zh: `阶段: ${frontmatter.stage}` }
            : frontmatter.stage;
        }
        if (frontmatter.domain) {
          tagMapping.domainOverrides = tagMapping.domainOverrides || {};
          tagMapping.domainOverrides[safeSkillName] = typeof frontmatter.domain === 'string'
            ? { en: `Domain: ${frontmatter.domain}`, zh: `领域: ${frontmatter.domain}` }
            : frontmatter.domain;
        }
        await fs.writeFile(tagMappingPath, JSON.stringify(tagMapping, null, 2), 'utf8');

        // Update stage-skill-map.json with origin
        const stageSkillMapPath = path.join(targetUserSkillsDir, 'stage-skill-map.json');
        let stageSkillMap = { skillOrigins: {} };
        try {
          stageSkillMap = JSON.parse(await fs.readFile(stageSkillMapPath, 'utf8'));
        } catch { /* use defaults */ }
        stageSkillMap.skillOrigins = stageSkillMap.skillOrigins || {};
        stageSkillMap.skillOrigins[safeSkillName] = 'user-import';
        await fs.writeFile(stageSkillMapPath, JSON.stringify(stageSkillMap, null, 2), 'utf8');

        const inferredWorkflowCategory = inferWorkflowCategoryFromName(safeSkillName);
        if (inferredWorkflowCategory !== DEFAULT_WORKFLOW_CATEGORY) {
          await updateWorkflowCategoryConfig(targetUserSkillsDir, safeSkillName, inferredWorkflowCategory);
        }

        imported.push(safeSkillName);
      } catch (err) {
        errors.push(`${entry.name}: ${err.message}`);
      }
    }

    // Re-sync symlinks for the requesting project
    if (imported.length > 0) {
      try {
        await ensureProjectSkillLinks(projectRoot, { userId: getUserId(req) });
      } catch (err) {
        console.warn('[skills] ensureProjectSkillLinks after import failed (non-fatal):', err.message);
      }
    }

    res.json({ imported, skipped, errors });
  } catch (error) {
    console.error('[skills] import-user-skills error:', error);
    res.status(500).json({ error: error.message });
  }
});

async function receiveSkillZip(req, res, handler) {
  try {
    const multer = (await import('multer')).default;
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    });

    upload.single('file')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: 'Failed to process uploaded file: ' + err.message });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided.' });
      }
      try {
        return await handler(req, res);
      } catch (handlerError) {
        console.error('[skills] skill zip handler error:', handlerError);
        return res.status(500).json({ error: handlerError.message || 'Failed to process skill package.' });
      }
    });
  } catch (error) {
    console.error('[skills] multipart setup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function validateUploadedSkillZip(req, res) {
  try {
    const result = await validateZipBuffer(req.file.buffer);
    if (!result.valid) return res.status(400).json({ valid: false, error: result.error });
    return res.json({
      valid: true,
      skillName: result.skillName,
      frontmatter: result.frontmatter,
      description: result.description,
      fileCount: result.fileCount,
      expandedBytes: result.expandedBytes,
      hasPrompts: result.hasPrompts,
      hasReferences: result.hasReferences,
    });
  } catch (error) {
    return res.status(400).json({ valid: false, error: 'Failed to parse zip: ' + error.message });
  }
}

function parseUploadTags(req) {
  try {
    if (!req.body?.tags) return {};
    return typeof req.body.tags === 'string' ? JSON.parse(req.body.tags) : req.body.tags;
  } catch {
    return {};
  }
}

async function uploadUserSkillZip(req, res) {
  let extractedDir = null;
  let stagingDir = null;
  try {
    let projectRoot = null;
    const projectName = String(req.params.projectName || '').trim();
    if (projectName) {
      projectRoot = await extractProjectDirectory(projectName);
      if (!projectRoot) return res.status(404).json({ error: 'Project not found.' });
    }

    const result = await validateZipBuffer(req.file.buffer);
    if (!result.valid) return res.status(400).json({ error: result.error });
    const tags = parseUploadTags(req);
    const requestedName = String(tags.skillName || result.skillName || '').trim();
    const safeSkillName = safeDirName(requestedName);
    if (!safeSkillName) return res.status(400).json({ error: 'Invalid skill name.' });

    const skillsDir = getUserSkillsDir(req);
    if (!skillsDir) return res.status(401).json({ error: 'User context is required to upload skills.' });
    await fs.mkdir(skillsDir, { recursive: true });
    extractedDir = path.join(skillsDir, safeSkillName);

    if (await pathExists(path.join(GLOBAL_SKILLS_DIR, safeSkillName))) {
      return res.status(409).json({ error: `Skill directory "${safeSkillName}" already exists as a system skill.` });
    }
    if (await pathExists(extractedDir)) {
      return res.status(409).json({ error: `Skill directory "${safeSkillName}" already exists.` });
    }

    stagingDir = await fs.mkdtemp(path.join(skillsDir, '.skill-upload-'));
    const { zip, prefix } = result;
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const entryName = entry.entryName.replace(/\\/g, '/');
      let relativePath = entryName;
      if (prefix && entryName.startsWith(prefix)) relativePath = entryName.slice(prefix.length);
      else if (prefix) continue;
      if (!relativePath) continue;

      const resolved = resolveUserSkillExtractionPath(stagingDir, relativePath);
      if (!resolved) {
        throw new Error(`Unsafe file path: ${relativePath}`);
      }
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, entry.getData());
    }

    const skillMdPath = path.join(stagingDir, 'SKILL.md');
    const rawSkill = await fs.readFile(skillMdPath, 'utf8');
    const { data: existingFrontmatter } = await parseFrontmatter(rawSkill);
    const customDescription = String(tags.description || '').trim();
    const nextFrontmatter = {
      ...existingFrontmatter,
      name: safeSkillName,
      ...(customDescription ? { description: customDescription } : {}),
    };
    await fs.writeFile(skillMdPath, customizeUserSkillDocument(rawSkill, {
      name: safeSkillName,
      description: customDescription,
    }), 'utf8');
    await fs.rename(stagingDir, extractedDir);
    stagingDir = null;

    const tagMappingPath = path.join(skillsDir, 'skill-tag-mapping.json');
    const tagMapping = await readJsonFileIfExists(tagMappingPath, {
      version: 1,
      stageOverrides: {},
      categoryOverrides: {},
      domainOverrides: {},
      customTags: {},
      platformNativeSkills: [],
      domainCsAiExceptions: [],
    });
    if (tags.stageOverride) {
      tagMapping.stageOverrides = tagMapping.stageOverrides || {};
      tagMapping.stageOverrides[safeSkillName] = tags.stageOverride;
    }
    if (tags.categoryOverride) {
      tagMapping.categoryOverrides = tagMapping.categoryOverrides || {};
      tagMapping.categoryOverrides[safeSkillName] = tags.categoryOverride;
    }
    if (tags.domainOverride) {
      tagMapping.domainOverrides = tagMapping.domainOverrides || {};
      tagMapping.domainOverrides[safeSkillName] = tags.domainOverride;
    }
    if (Array.isArray(tags.customTags) && tags.customTags.length > 0) {
      tagMapping.customTags = tagMapping.customTags || {};
      tagMapping.customTags[safeSkillName] = tags.customTags
        .map((tag) => compactInlineText(tag))
        .filter(Boolean)
        .slice(0, 12);
    }
    await fs.writeFile(tagMappingPath, JSON.stringify(tagMapping, null, 2), 'utf8');

    await updateWorkflowCategoryConfig(
      skillsDir,
      safeSkillName,
      tags.workflowCategory || inferWorkflowCategoryFromName(safeSkillName),
    );
    await updateSkillOrigin(skillsDir, safeSkillName, tags.origin || 'downloaded');
    if (projectRoot) await ensureProjectSkillLinks(projectRoot, { userId: getUserId(req) });

    return res.json({
      success: true,
      skillName: safeSkillName,
      dirName: safeSkillName,
      path: extractedDir,
      frontmatter: nextFrontmatter,
    });
  } catch (error) {
    if (stagingDir) await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    if (extractedDir) await fs.rm(extractedDir, { recursive: true, force: true }).catch(() => {});
    console.error('[skills] upload-skill error:', error);
    return res.status(500).json({ error: 'Failed to extract skill: ' + error.message });
  }
}

router.post('/validate-skill-zip', (req, res) => receiveSkillZip(req, res, validateUploadedSkillZip));
router.post('/:projectName/validate-skill-zip', (req, res) => receiveSkillZip(req, res, validateUploadedSkillZip));
router.post('/upload-skill', (req, res) => receiveSkillZip(req, res, uploadUserSkillZip));
router.post('/:projectName/upload-skill', (req, res) => receiveSkillZip(req, res, uploadUserSkillZip));

// Skill deletion is intentionally disabled for every user.
router.delete('/global-skill', (_req, res) => {
  res.status(403).json({ error: SKILL_DELETE_DISABLED_MESSAGE });
});

router.delete('/:projectName/:skillDirName', (_req, res) => {
  res.status(403).json({ error: SKILL_DELETE_DISABLED_MESSAGE });
});

export default router;
