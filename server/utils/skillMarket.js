import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

const MARKET_SOURCES = new Set(['clawhub', 'skillhub']);
const MARKET_META_FILENAME = '.medhelp-market.json';
const MAX_FILE_COUNT = 200;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const LIST_CACHE_TTL_MS = 2 * 60 * 1000;
const listCache = new Map();
const clawhubOwnerCache = new Map();

const DEFAULT_PROVIDER_BASES = {
  clawhub: 'https://clawhub.ai',
  skillhub: 'https://api.skillhub.cn',
};

export class SkillMarketError extends Error {
  constructor(message, { status = 500, code = 'SKILL_MARKET_ERROR' } = {}) {
    super(message);
    this.name = 'SkillMarketError';
    this.status = status;
    this.code = code;
  }
}

export function normalizeMarketSource(value) {
  const source = String(value || '').trim().toLowerCase();
  return MARKET_SOURCES.has(source) ? source : null;
}

export function safeMarketSkillDirName(value) {
  const name = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name) || name.includes('..')) return null;
  return name.slice(0, 100);
}

export function isSafeMarketRelativePath(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  if (!normalized || normalized.length > 512 || normalized.includes('\0')) return false;
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return false;
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return false;
  return parts[parts.length - 1] !== MARKET_META_FILENAME;
}

export function parseMarketSkillId(value) {
  const id = String(value || '');
  const separator = id.indexOf(':');
  if (separator <= 0) return null;
  const source = normalizeMarketSource(id.slice(0, separator));
  const slug = id.slice(separator + 1);
  if (!source || !safeMarketSkillDirName(slug)) return null;
  return { source, slug };
}

function marketSkillId(source, slug) {
  return `${source}:${slug}`;
}

function providerBase(source) {
  const envName = source === 'clawhub'
    ? 'MEDHELP_SKILL_MARKET_CLAWHUB_URL'
    : 'MEDHELP_SKILL_MARKET_SKILLHUB_URL';
  return process.env[envName] || DEFAULT_PROVIDER_BASES[source];
}

async function fetchProvider(source, url, options = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        ...options,
        headers: {
          Accept: 'application/json, text/plain, */*',
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });
      if (response.status !== 429 && response.status < 500) return response;
      lastError = new Error(`${source} responded with HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new SkillMarketError(
    `${source} is temporarily unavailable: ${lastError?.message || 'request failed'}`,
    { status: 502, code: 'SKILL_MARKET_UPSTREAM_ERROR' },
  );
}

async function fetchJson(source, url) {
  const response = await fetchProvider(source, url);
  if (!response.ok) {
    throw new SkillMarketError(`${source} responded with HTTP ${response.status}`, {
      status: response.status === 404 ? 404 : 502,
      code: 'SKILL_MARKET_UPSTREAM_ERROR',
    });
  }
  try {
    return await response.json();
  } catch {
    throw new SkillMarketError(`${source} returned invalid JSON`, {
      status: 502,
      code: 'SKILL_MARKET_BAD_RESPONSE',
    });
  }
}

async function clawhubFetch(url, slug) {
  const requestUrl = new URL(url);
  const cachedOwner = clawhubOwnerCache.get(slug);
  if (cachedOwner) requestUrl.searchParams.set('owner', cachedOwner);
  let response = await fetchProvider('clawhub', requestUrl.href);
  if (response.status !== 409) return response;

  const payload = await response.json().catch(() => null);
  const owner = payload?.code === 'AMBIGUOUS_SKILL_SLUG'
    ? payload?.matches?.[0]?.ownerHandle
    : null;
  if (!owner) return response;
  clawhubOwnerCache.set(slug, owner);
  requestUrl.searchParams.set('owner', owner);
  response = await fetchProvider('clawhub', requestUrl.href);
  return response;
}

async function clawhubJson(url, slug) {
  const response = await clawhubFetch(url, slug);
  if (!response.ok) {
    throw new SkillMarketError(`clawhub responded with HTTP ${response.status}`, {
      status: response.status === 404 ? 404 : 502,
      code: 'SKILL_MARKET_UPSTREAM_ERROR',
    });
  }
  return response.json().catch(() => {
    throw new SkillMarketError('clawhub returned invalid JSON', {
      status: 502,
      code: 'SKILL_MARKET_BAD_RESPONSE',
    });
  });
}

function normalizeSecurity(value, verified = false) {
  const status = String(value || '').toLowerCase();
  if (['clean', 'safe', 'benign', 'pass', 'passed'].includes(status)) {
    return verified ? 'verified' : 'benign';
  }
  if (status && !['unknown', 'pending', 'unscanned'].includes(status)) return 'flagged';
  return verified ? 'verified' : 'unknown';
}

function normalizeClawhubItem(item, detail = {}) {
  const slug = item.slug;
  const latestVersion = detail.latestVersion?.version
    || item.latestVersion?.version
    || (typeof detail.latestVersion === 'string' ? detail.latestVersion : null)
    || item.version;
  return {
    id: marketSkillId('clawhub', slug),
    source: 'clawhub',
    slug,
    name: item.displayName || item.name || slug,
    summary: item.summary || '',
    author: detail.owner?.displayName || detail.owner?.handle || item.ownerHandle || '',
    downloads: Number(item.stats?.downloads ?? item.downloads ?? 0),
    stars: Number(item.stats?.stars ?? item.stars ?? 0),
    version: latestVersion || null,
    tags: Array.isArray(item.topics) ? item.topics.filter((tag) => typeof tag === 'string') : [],
    securityStatus: 'unknown',
  };
}

function normalizeSkillhubItem(item, detail = {}) {
  const reports = Object.values(detail.securityReports || {}).filter(Boolean);
  const reportStatus = reports.find((report) => report?.status)?.status;
  return {
    id: marketSkillId('skillhub', item.slug),
    source: 'skillhub',
    slug: item.slug,
    name: item.name || item.displayName || item.slug,
    summary: item.description_zh || item.description || item.summary_zh || item.summary || '',
    author: detail.owner?.displayName || detail.owner?.handle || item.ownerName || '',
    downloads: Number(item.stats?.downloads ?? item.downloads ?? 0),
    stars: Number(item.stats?.stars ?? item.stars ?? 0),
    version: detail.latestVersion?.version || item.version || null,
    tags: (item.subCategories || []).map((tag) => tag?.name).filter(Boolean),
    category: item.category || null,
    securityStatus: normalizeSecurity(reportStatus, Boolean(item.verified)),
  };
}

async function listClawhub({ query, limit }) {
  const base = providerBase('clawhub');
  if (query) {
    const url = new URL('/api/v1/search', base);
    url.searchParams.set('q', query);
    const data = await fetchJson('clawhub', url.href);
    if (!Array.isArray(data.results)) throw new SkillMarketError('clawhub search response is invalid', { status: 502 });
    return data.results.filter((item) => item?.slug).slice(0, limit).map((item) => normalizeClawhubItem(item));
  }
  const url = new URL('/api/v1/skills', base);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('sort', 'downloads');
  const data = await fetchJson('clawhub', url.href);
  if (!Array.isArray(data.items)) throw new SkillMarketError('clawhub list response is invalid', { status: 502 });
  return data.items.filter((item) => item?.slug).map((item) => normalizeClawhubItem(item));
}

async function listSkillhub({ query, limit }) {
  const url = new URL('/api/skills', providerBase('skillhub'));
  url.searchParams.set('page', '1');
  url.searchParams.set('pageSize', String(limit));
  if (query) url.searchParams.set('keyword', query);
  const envelope = await fetchJson('skillhub', url.href);
  if (envelope?.code !== 0 || !Array.isArray(envelope?.data?.skills)) {
    throw new SkillMarketError('skillhub list response is invalid', { status: 502 });
  }
  return envelope.data.skills.filter((item) => item?.slug).map((item) => normalizeSkillhubItem(item));
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function annotateInstallState(skill, userSkillsDir, systemSkillsDir) {
  const dirName = safeMarketSkillDirName(skill.slug);
  if (!dirName) return { ...skill, installState: 'unavailable' };
  if (systemSkillsDir && await pathExists(path.join(systemSkillsDir, dirName))) {
    return { ...skill, installState: 'conflict' };
  }
  const target = path.join(userSkillsDir, dirName);
  if (!await pathExists(target)) return { ...skill, installState: 'installable' };
  try {
    const metadata = JSON.parse(await fs.readFile(path.join(target, MARKET_META_FILENAME), 'utf8'));
    if (metadata.id === skill.id) return { ...skill, installState: 'installed' };
  } catch {
    // A user-created directory with the same name must never be overwritten.
  }
  return { ...skill, installState: 'conflict' };
}

export async function listSkillMarket({
  query = '',
  source = 'all',
  limit = 24,
  userSkillsDir,
  systemSkillsDir,
}) {
  const normalizedSource = source === 'all' ? 'all' : normalizeMarketSource(source);
  if (!normalizedSource) throw new SkillMarketError('Invalid skill market source', { status: 400 });
  const normalizedLimit = Math.min(48, Math.max(1, Number(limit) || 24));
  const cacheKey = `${normalizedSource}:${query}:${normalizedLimit}`;
  const cached = listCache.get(cacheKey);
  let providerResults;
  if (cached && cached.expiresAt > Date.now()) {
    providerResults = cached.value;
  } else {
    const sources = normalizedSource === 'all' ? ['skillhub', 'clawhub'] : [normalizedSource];
    const settled = await Promise.allSettled(sources.map(async (providerSource) => ({
      source: providerSource,
      items: providerSource === 'clawhub'
        ? await listClawhub({ query, limit: normalizedLimit })
        : await listSkillhub({ query, limit: normalizedLimit }),
    })));
    providerResults = settled
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);
    if (providerResults.length === 0) {
      const reasons = settled.map((result) => result.status === 'rejected' ? result.reason?.message : '').filter(Boolean);
      throw new SkillMarketError(reasons.join('; ') || 'Skill market is unavailable', {
        status: 502,
        code: 'SKILL_MARKET_UPSTREAM_ERROR',
      });
    }
    listCache.set(cacheKey, { value: providerResults, expiresAt: Date.now() + LIST_CACHE_TTL_MS });
  }

  const sourceStatus = Object.fromEntries(providerResults.map((result) => [result.source, 'ok']));
  const deduplicated = new Map();
  for (const { items } of providerResults) {
    for (const item of items) {
      if (!deduplicated.has(item.id)) deduplicated.set(item.id, item);
    }
  }
  const sorted = Array.from(deduplicated.values())
    .sort((left, right) => right.downloads - left.downloads)
    .slice(0, normalizedLimit);
  const items = await Promise.all(sorted.map((skill) => (
    annotateInstallState(skill, userSkillsDir, systemSkillsDir)
  )));
  return { items, sources: sourceStatus };
}

async function getClawhubDetail(slug) {
  const base = providerBase('clawhub');
  const data = await clawhubJson(new URL(`/api/v1/skills/${encodeURIComponent(slug)}`, base).href, slug);
  if (!data?.skill?.slug) throw new SkillMarketError('ClawHub skill not found', { status: 404 });
  const skill = normalizeClawhubItem(data.skill, data);
  const version = skill.version;
  let files = [];
  let securityStatus = 'unknown';
  if (version) {
    const versionData = await clawhubJson(
      new URL(`/api/v1/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`, base).href,
      slug,
    );
    files = versionData?.version?.files || [];
    securityStatus = normalizeSecurity(versionData?.version?.security?.status);
  }
  return { ...skill, securityStatus, files };
}

async function getSkillhubDetail(slug) {
  const base = providerBase('skillhub');
  const data = await fetchJson('skillhub', new URL(`/api/v1/skills/${encodeURIComponent(slug)}`, base).href);
  if (!data?.skill?.slug) throw new SkillMarketError('SkillHub skill not found', { status: 404 });
  const filesData = await fetchJson(
    'skillhub',
    new URL(`/api/v1/skills/${encodeURIComponent(slug)}/files`, base).href,
  );
  if (!Array.isArray(filesData?.files)) throw new SkillMarketError('SkillHub file list is invalid', { status: 502 });
  return { ...normalizeSkillhubItem(data.skill, data), files: filesData.files };
}

export async function getSkillMarketDetail(source, slug, { userSkillsDir, systemSkillsDir } = {}) {
  const normalizedSource = normalizeMarketSource(source);
  const dirName = safeMarketSkillDirName(slug);
  if (!normalizedSource || !dirName) throw new SkillMarketError('Invalid skill market id', { status: 400 });
  const detail = normalizedSource === 'clawhub'
    ? await getClawhubDetail(slug)
    : await getSkillhubDetail(slug);
  const totalBytes = detail.files.reduce((total, file) => total + Number(file.size || 0), 0);
  return annotateInstallState({
    ...detail,
    fileCount: detail.files.length,
    totalBytes,
    installable: detail.files.some((file) => file.path === 'SKILL.md')
      && detail.files.length <= MAX_FILE_COUNT
      && totalBytes <= MAX_TOTAL_BYTES
      && detail.files.every((file) => Number(file.size || 0) <= MAX_FILE_BYTES),
  }, userSkillsDir, systemSkillsDir);
}

async function fetchMarketFile(source, slug, filePath) {
  const base = providerBase(source);
  const url = source === 'clawhub'
    ? new URL(`/api/v1/skills/${encodeURIComponent(slug)}/file`, base)
    : new URL(`/api/v1/skills/${encodeURIComponent(slug)}/file`, base);
  url.searchParams.set('path', filePath);
  const response = source === 'clawhub'
    ? await clawhubFetch(url.href, slug)
    : await fetchProvider(source, url.href);
  if (!response.ok) {
    throw new SkillMarketError(`Failed to download ${filePath} (HTTP ${response.status})`, {
      status: 502,
      code: 'SKILL_MARKET_DOWNLOAD_ERROR',
    });
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function installSkillMarketEntry({
  source,
  slug,
  userSkillsDir,
  systemSkillsDir,
  detail: suppliedDetail = null,
  fetchFile = fetchMarketFile,
}) {
  const normalizedSource = normalizeMarketSource(source);
  const dirName = safeMarketSkillDirName(slug);
  if (!normalizedSource || !dirName) throw new SkillMarketError('Invalid skill market id', { status: 400 });
  await fs.mkdir(userSkillsDir, { recursive: true });
  if (systemSkillsDir && await pathExists(path.join(systemSkillsDir, dirName))) {
    throw new SkillMarketError('A system skill already uses this name', { status: 409, code: 'SKILL_NAME_CONFLICT' });
  }
  const target = path.join(userSkillsDir, dirName);
  if (await pathExists(target)) {
    throw new SkillMarketError('A user skill already uses this name', { status: 409, code: 'SKILL_NAME_CONFLICT' });
  }

  const detail = suppliedDetail || await getSkillMarketDetail(normalizedSource, slug, {
    userSkillsDir,
    systemSkillsDir,
  });
  if (!detail.installable) {
    throw new SkillMarketError('This market skill exceeds the safe install limits', {
      status: 422,
      code: 'SKILL_NOT_INSTALLABLE',
    });
  }

  const staging = await fs.mkdtemp(path.join(userSkillsDir, '.market-install-'));
  try {
    let totalBytes = 0;
    for (const file of detail.files) {
      if (!isSafeMarketRelativePath(file.path)) {
        throw new SkillMarketError(`Unsafe file path: ${file.path}`, { status: 422, code: 'SKILL_NOT_INSTALLABLE' });
      }
      const content = await fetchFile(normalizedSource, slug, file.path);
      totalBytes += content.length;
      if (content.length > MAX_FILE_BYTES || totalBytes > MAX_TOTAL_BYTES) {
        throw new SkillMarketError('Downloaded skill exceeds the safe size limit', {
          status: 422,
          code: 'SKILL_NOT_INSTALLABLE',
        });
      }
      if (file.sha256) {
        const digest = crypto.createHash('sha256').update(content).digest('hex');
        if (digest !== String(file.sha256).toLowerCase()) {
          throw new SkillMarketError(`Checksum mismatch for ${file.path}`, {
            status: 502,
            code: 'SKILL_CHECKSUM_MISMATCH',
          });
        }
      }
      const outputPath = path.join(staging, ...file.path.replace(/\\/g, '/').split('/'));
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, content);
    }

    const rawSkill = await fs.readFile(path.join(staging, 'SKILL.md'), 'utf8');
    if (!/^---\s*[\r\n]+[\s\S]*?[\r\n]+---/.test(rawSkill)) {
      throw new SkillMarketError('Downloaded SKILL.md has no valid frontmatter', {
        status: 422,
        code: 'SKILL_NOT_INSTALLABLE',
      });
    }
    await fs.writeFile(path.join(staging, MARKET_META_FILENAME), `${JSON.stringify({
      id: marketSkillId(normalizedSource, slug),
      source: normalizedSource,
      slug,
      version: detail.version || null,
      installedAt: new Date().toISOString(),
      fileCount: detail.files.length,
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(staging, target);
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }

  return {
    installedPath: target,
    skill: { ...detail, installState: 'installed' },
  };
}

export async function uninstallSkillMarketEntry({ source, slug, userSkillsDir }) {
  const normalizedSource = normalizeMarketSource(source);
  const dirName = safeMarketSkillDirName(slug);
  if (!normalizedSource || !dirName) throw new SkillMarketError('Invalid skill market id', { status: 400 });
  const target = path.join(userSkillsDir, dirName);
  let stat;
  try {
    stat = await fs.lstat(target);
  } catch {
    throw new SkillMarketError('Market skill is not installed', { status: 404 });
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new SkillMarketError('Skill directory is not managed by the market', { status: 409 });
  }
  let metadata;
  try {
    metadata = JSON.parse(await fs.readFile(path.join(target, MARKET_META_FILENAME), 'utf8'));
  } catch {
    throw new SkillMarketError('Skill directory is not managed by the market', { status: 409 });
  }
  if (metadata.id !== marketSkillId(normalizedSource, slug)) {
    throw new SkillMarketError('Skill directory is not managed by this market entry', { status: 409 });
  }
  await fs.rm(target, { recursive: true, force: true });
  return { removedPath: target };
}

export function resetSkillMarketCacheForTests() {
  listCache.clear();
  clawhubOwnerCache.clear();
}
