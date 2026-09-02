import { monitorDb, referencesDb } from '../database/db.js';
import { buildMonitorCandidatesFromNewsItem } from './monitor-candidate-extractor.js';
import { extractCandidatesForLiteratureRecord, normalizeExtractionConfig } from './literature-concept-extractor.js';

function collapseWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseNewsAuthorsForReference(authorsStr) {
  if (!authorsStr || typeof authorsStr !== 'string') {
    return [];
  }

  const normalized = collapseWhitespace(authorsStr);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\s+and\s+/i)
    .flatMap((chunk) => chunk.split(/;\s*|,\s*/))
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({
      family: part.replace(/^\[[^\]]*]\s*/, ''),
      given: '',
    }));
}

function parsePublishedYear(published) {
  if (!published) {
    return null;
  }

  const match = String(published).match(/(19|20)\d{2}/);
  return match ? Number.parseInt(match[0], 10) : null;
}

export function buildNewsReferenceImportItem(item = {}, sourceKey = 'news') {
  const title = collapseWhitespace(item?.title);
  const idPart = String(item?.id ?? title ?? 'item')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120);
  const stableKey = `news_${sourceKey}_${idPart}`;
  const authors = parseNewsAuthorsForReference(item?.authors);
  const keywords = [
    ...(Array.isArray(item?.categories) ? item.categories : []),
    ...(Array.isArray(item?.matched_keywords) ? item.matched_keywords : []),
    sourceKey,
  ]
    .map((keyword) => String(keyword || '').trim())
    .filter(Boolean);

  return {
    title: title || 'Untitled',
    authors,
    year: parsePublishedYear(item?.published),
    abstract: String(item?.abstract || '').trim(),
    doi: null,
    url: collapseWhitespace(item?.link || item?.pdf_link || ''),
    journal: collapseWhitespace(item?.source || item?.matched_domain) || 'Literature monitor',
    itemType: 'article',
    citationKey: stableKey,
    keywords: [...new Set(keywords)].slice(0, 40),
  };
}

export function buildNewsReferenceId(userId, item = {}, sourceKey = 'news') {
  const importItem = buildNewsReferenceImportItem(item, sourceKey);
  return `news_monitor_${userId}_${importItem.citationKey}`;
}

export async function ingestMonitorNewsItem({
  userId,
  item = {},
  sourceKey = 'news',
  triggerType = 'scheduled_monitor',
  projectId = null,
  skipIfExists = true,
  metadata = null,
  extractionConfig = null,
} = {}) {
  if (!userId) {
    throw new Error('userId is required to ingest monitor news items');
  }

  const importItem = buildNewsReferenceImportItem(item, sourceKey);
  const referenceId = buildNewsReferenceId(userId, item, sourceKey);
  const existingReference = referencesDb.getReference(referenceId, userId);

  if (skipIfExists && existingReference) {
    return {
      skipped: true,
      referenceId,
      reference: existingReference,
      candidateCount: 0,
      candidates: [],
      run: null,
    };
  }

  const importedIds = referencesDb.importReferences(userId, [importItem], 'news_monitor');
  const persistedReferenceId = importedIds?.[0] || referenceId;
  const persistedReference = referencesDb.getReference(persistedReferenceId, userId);

  const run = monitorDb.createRun(userId, {
    source_key: sourceKey,
    trigger_type: triggerType,
    status: 'completed',
    item_title: collapseWhitespace(item?.title) || importItem.title,
    reference_id: persistedReferenceId,
    project_id: projectId,
    metadata: {
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
      sourceKey,
      title: importItem.title,
      link: collapseWhitespace(item?.link || ''),
      scheduled: triggerType === 'scheduled_monitor',
    },
  });

  const extractionResult = await extractCandidatesForLiteratureRecord({
    userId,
    reference: {
      title: importItem.title,
      abstract: importItem.abstract,
    },
    sourceKey,
    extractionConfig: normalizeExtractionConfig(extractionConfig || {}),
  });

  const extractedCandidates = (extractionResult?.candidates?.length
    ? extractionResult.candidates
    : buildMonitorCandidatesFromNewsItem(item, sourceKey)).map((candidate) => ({
    ...candidate,
    reference_id: persistedReferenceId,
    project_id: projectId,
    metadata: {
      ...(candidate.metadata && typeof candidate.metadata === 'object' ? candidate.metadata : {}),
      extraction_strategy: extractionResult?.strategy || 'rule_based_monitor_v1',
      extraction_provider: extractionResult?.extractionConfig?.provider || null,
      extraction_model: extractionResult?.extractionConfig?.model || null,
    },
  }));
  const createdCandidates = monitorDb.createCandidates(userId, run?.id, extractedCandidates);

  return {
    skipped: false,
    referenceId: persistedReferenceId,
    reference: persistedReference,
    candidateCount: createdCandidates.length,
    candidates: createdCandidates,
    run,
  };
}
