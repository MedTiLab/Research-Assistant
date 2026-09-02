import express from 'express';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import mime from 'mime-types';
import {
  conceptsDb,
  monitorDb,
  referencesDb,
  projectDb,
  medLibraryOperatingAssetDb,
} from '../database/db.js';
import { extractProjectDirectory } from '../projects.js';
import { getKnowledgeBasePaths } from '../utils/project-knowledge-base.js';
import {
  decodeReportFileId,
  encodeReportFileId,
  isScannedReportRelativePath,
  scanProjectReportFiles,
} from '../utils/project-report-files.js';
import {
  deleteResearchLesson,
  readResearchLessons,
  upsertManualResearchLesson,
} from '../execution-memory/lessons.js';
import { buildExecutionPromptContext, readExecutionMemorySnapshot } from '../execution-memory/summary.js';
import { normalizeExtractionConfig, requestStructuredJson } from '../utils/literature-concept-extractor.js';
import { createDownloadRateLimiter } from '../middleware/rate-limit.js';
import { requireCapability } from '../utils/entitlements.js';
import {
  readProjectMemoryFile,
  writeProjectMemoryFile,
} from '../project-memory/automatic-project-memory.js';

const router = express.Router();
const limitReportPreviewContentDownload = createDownloadRateLimiter({
  action: 'report-preview-content-download',
});

const DEFAULT_RESEARCH_BRIEF_RELATIVE_PATH = '.pipeline/docs/research_brief.json';
const ACTIVE_PROJECT_WINDOW_DAYS = 90;
const VALID_OPERATING_ASSET_TYPES = new Set(['template', 'sop']);

async function pathExists(targetPath) {
  try {
    await fsPromises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function normalizeRelativePath(rel) {
  return String(rel || '').split(path.sep).join('/').replace(/^\/+/, '');
}

function assertPathInsideProject(projectPath, absoluteTargetPath) {
  const projectRoot = path.resolve(projectPath);
  const target = path.resolve(absoluteTargetPath);
  const rel = path.relative(projectRoot, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return false;
  }
  return true;
}

async function resolveStoredProjectPath(row) {
  const rawPath = row?.path ? String(row.path).trim() : '';
  if (rawPath && path.isAbsolute(rawPath)) {
    if (await pathExists(rawPath)) {
      return rawPath;
    }
  }
  const key = row?.id || row?.display_name;
  if (!key) {
    return null;
  }
  try {
    return await extractProjectDirectory(key);
  } catch {
    return null;
  }
}

function collapseWhitespace(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function toTimestamp(value) {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickLatestDate(values = []) {
  let latestValue = null;
  let latestTime = 0;

  for (const value of values) {
    const time = toTimestamp(value);
    if (time > latestTime) {
      latestTime = time;
      latestValue = value;
    }
  }

  return latestValue || null;
}

function uniqueStrings(values = []) {
  return Array.from(new Set(
    values
      .filter((value) => typeof value === 'string')
      .map((value) => collapseWhitespace(value))
      .filter(Boolean),
  ));
}

function normalizeKey(value, fallback = 'general') {
  const normalized = collapseWhitespace(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function scoreLessonSeverity(severity) {
  if (severity === 'high') {
    return 30;
  }
  if (severity === 'medium') {
    return 20;
  }
  return 10;
}

function getLessonReuseCount(item) {
  if (Number.isFinite(item?.reuseCount)) {
    return Number(item.reuseCount);
  }
  if (Number.isFinite(item?.timesSeen)) {
    return Number(item.timesSeen);
  }
  return 0;
}

function sortLessonRows(left, right) {
  const manualScoreLeft = left.source === 'manual' ? 100 : 0;
  const manualScoreRight = right.source === 'manual' ? 100 : 0;
  const statusScoreLeft = (left.status === 'confirmed' ? 50 : 0) + manualScoreLeft;
  const statusScoreRight = (right.status === 'confirmed' ? 50 : 0) + manualScoreRight;
  const severityScoreLeft = scoreLessonSeverity(left.severity);
  const severityScoreRight = scoreLessonSeverity(right.severity);
  const seenLeft = getLessonReuseCount(left);
  const seenRight = getLessonReuseCount(right);
  const updatedLeft = toTimestamp(left.lastVerifiedAt || left.updatedAt || 0);
  const updatedRight = toTimestamp(right.lastVerifiedAt || right.updatedAt || 0);

  return (statusScoreRight + severityScoreRight + seenRight)
    - (statusScoreLeft + severityScoreLeft + seenLeft)
    || updatedRight - updatedLeft;
}

function normalizeLessonRow(item, row) {
  if (!item || typeof item !== 'object' || !item.slug || !item.title) {
    return null;
  }

  const stageHints = Array.isArray(item.stageHints)
    ? item.stageHints.filter((value) => typeof value === 'string' && value.trim())
    : [];
  const reuseCount = Number.isFinite(item.timesSeen) ? Number(item.timesSeen) : 1;
  const firstSeenAt = item.firstSeenAt || item.createdAt || null;
  const lastSeenAt = item.lastSeenAt || item.updatedAt || item.createdAt || null;
  const lastVerifiedAt = lastSeenAt || item.updatedAt || item.createdAt || null;

  return {
    id: `${row.id}:${item.id || item.slug}`,
    projectId: row.id,
    projectName: row.id,
    displayName: row.display_name || row.id,
    slug: String(item.slug),
    title: String(item.title),
    category: typeof item.category === 'string' ? item.category : 'general',
    status: typeof item.status === 'string' ? item.status : 'candidate',
    severity: typeof item.severity === 'string' ? item.severity : 'medium',
    summary: typeof item.summary === 'string' ? item.summary : '',
    trigger: typeof item.trigger === 'string' ? item.trigger : '',
    correctPattern: typeof item.correctPattern === 'string' ? item.correctPattern : '',
    stageHints,
    timesSeen: reuseCount,
    reuseCount,
    source: item.source === 'manual' ? 'manual' : 'auto',
    injectedCount: Number.isFinite(item.injectedCount) ? Number(item.injectedCount) : 0,
    lastInjectedAt: item.lastInjectedAt || null,
    firstSeenAt,
    lastSeenAt,
    lastVerifiedAt,
    updatedAt: item.updatedAt || item.lastSeenAt || item.createdAt || null,
  };
}

function normalizeTemplateAssetItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      id: collapseWhitespace(item?.id) || `template-item-${index + 1}`,
      heading: collapseWhitespace(item?.heading || item?.title || ''),
      verify: collapseWhitespace(item?.verify || ''),
      pattern: collapseWhitespace(item?.pattern || ''),
    }))
    .filter((item) => item.heading || item.verify || item.pattern);
}

function normalizeSopAssetSteps(steps = []) {
  return (Array.isArray(steps) ? steps : [])
    .map((step, index) => ({
      id: collapseWhitespace(step?.id) || `sop-step-${index + 1}`,
      order: Number.isFinite(step?.order) ? Number(step.order) : index + 1,
      title: collapseWhitespace(step?.title || ''),
      instruction: collapseWhitespace(step?.instruction || ''),
    }))
    .filter((step) => step.title || step.instruction)
    .sort((left, right) => left.order - right.order);
}

function mapStoredOperatingAssetToApi(asset) {
  if (!asset?.id || !VALID_OPERATING_ASSET_TYPES.has(asset.assetType)) {
    return null;
  }

  const base = {
    id: asset.id,
    assetType: asset.assetType,
    title: asset.title,
    stageKey: asset.stageKey || null,
    stageLabel: asset.stageLabel || null,
    description: asset.description || null,
    createdAt: asset.createdAt || null,
    updatedAt: asset.updatedAt || null,
  };

  if (asset.assetType === 'template') {
    return {
      ...base,
      items: normalizeTemplateAssetItems(asset?.content?.items),
    };
  }

  return {
    ...base,
    steps: normalizeSopAssetSteps(asset?.content?.steps),
  };
}

function buildFormalOperatingAssets(assets = []) {
  const templates = [];
  const sops = [];

  for (const asset of assets.map(mapStoredOperatingAssetToApi).filter(Boolean)) {
    if (asset.assetType === 'template') {
      templates.push(asset);
      continue;
    }
    if (asset.assetType === 'sop') {
      sops.push(asset);
    }
  }

  return { templates, sops };
}

function normalizeOperatingAssetPayload(payload = {}) {
  const assetType = collapseWhitespace(payload.assetType || '').toLowerCase();
  if (!VALID_OPERATING_ASSET_TYPES.has(assetType)) {
    return null;
  }

  const title = collapseWhitespace(payload.title || '');
  if (!title) {
    return null;
  }

  const stageKey = normalizeKey(payload.stageKey || payload.stageLabel || '');
  const stageLabel = collapseWhitespace(payload.stageLabel || payload.stageKey || '');
  const description = collapseWhitespace(payload.description || '');

  if (assetType === 'template') {
    const items = normalizeTemplateAssetItems(payload.items);
    if (items.length === 0) {
      return null;
    }
    return {
      assetType,
      title,
      stageKey: stageKey || null,
      stageLabel: stageLabel || null,
      description: description || null,
      content: { items },
    };
  }

  const steps = normalizeSopAssetSteps(payload.steps);
  if (steps.length === 0) {
    return null;
  }
  return {
    assetType,
    title,
    stageKey: stageKey || null,
    stageLabel: stageLabel || null,
    description: description || null,
    content: { steps },
  };
}

function buildResearchBriefSummary(briefData, updatedAt) {
  if (!briefData || typeof briefData !== 'object') {
    return null;
  }

  const title = collapseWhitespace(briefData?.meta?.title) || 'Research Brief';
  const coreQuestion = collapseWhitespace(
    briefData?.sections?.literature?.core_research_question
    || briefData?.sections?.survey?.core_research_question,
  );
  const knowledgeScope = collapseWhitespace(
    briefData?.sections?.literature?.knowledge_base_scope
    || briefData?.sections?.survey?.knowledge_base_scope,
  );
  const synthesisSummary = collapseWhitespace(
    briefData?.sections?.literature?.synthesis_summary
    || briefData?.sections?.survey?.synthesis_summary,
  );
  const scientificGap = collapseWhitespace(briefData?.sections?.ideation?.clinical_or_scientific_gap);
  const summary = collapseWhitespace([synthesisSummary, scientificGap].filter(Boolean).join(' '));
  const startStage = collapseWhitespace(
    briefData?.meta?.start_stage
    || briefData?.meta?.stage
    || briefData?.meta?.startStage
    || '',
  );

  if (!title && !coreQuestion && !knowledgeScope && !summary) {
    return null;
  }

  return {
    title: title || 'Research Brief',
    coreQuestion: coreQuestion || null,
    knowledgeScope: knowledgeScope || null,
    summary: summary || null,
    startStage: startStage || null,
    relativePath: DEFAULT_RESEARCH_BRIEF_RELATIVE_PATH,
    updatedAt: updatedAt || null,
  };
}

async function readResearchBriefSummary(projectPath) {
  const briefPath = path.join(projectPath, DEFAULT_RESEARCH_BRIEF_RELATIVE_PATH);
  if (!(await pathExists(briefPath))) {
    return null;
  }

  try {
    const [content, stats] = await Promise.all([
      fsPromises.readFile(briefPath, 'utf8'),
      fsPromises.stat(briefPath),
    ]);
    const parsed = JSON.parse(content);
    return buildResearchBriefSummary(parsed, stats.mtime.toISOString());
  } catch (error) {
    console.warn('[med-library] Failed to read research brief:', error.message);
    return null;
  }
}

async function listUserReportFiles(userId) {
  const items = [];

  for (const row of projectDb.getAllProjects(userId)) {
    const projectPath = await resolveStoredProjectPath(row);
    if (!projectPath || !path.isAbsolute(projectPath)) {
      continue;
    }

    for (const file of await scanProjectReportFiles(projectPath)) {
      items.push({
        id: encodeReportFileId(row.id, file.relativePath),
        projectName: row.id,
        displayName: row.display_name || row.id,
        title: file.title,
        relativePath: file.relativePath,
        kbUploadRelativePath: null,
        createdAt: file.modifiedAt,
      });
    }
  }

  return items.sort((left, right) => toTimestamp(right.createdAt) - toTimestamp(left.createdAt));
}

function streamFileResponse(res, absolutePath) {
  const mimeType = mime.lookup(absolutePath) || 'application/octet-stream';
  res.setHeader('Content-Type', mimeType);
  const fileStream = fs.createReadStream(absolutePath);
  fileStream.pipe(res);
  fileStream.on('error', (streamErr) => {
    console.error('Error streaming report preview file:', streamErr);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error reading file' });
    }
  });
}

router.get('/overview', async (req, res) => {
  try {
    const referenceOverview = referencesDb.getLibraryOverview(req.user.id);
    const conceptOverview = conceptsDb.getOverviewStats(req.user.id);
    const monitorOverview = monitorDb.getOverviewStats(req.user.id);

    res.json({
      overview: {
        ...referenceOverview,
        total_concepts: conceptOverview.total_concepts,
        stable_concepts: conceptOverview.stable_concepts,
        reviewed_concepts: conceptOverview.reviewed_concepts,
        candidate_concepts: conceptOverview.candidate_concepts,
        total_evidence: conceptOverview.total_evidence,
        total_candidates: monitorOverview.total_candidates,
        pending_candidates: monitorOverview.pending_candidates,
        accepted_candidates: monitorOverview.accepted_candidates,
        merged_candidates: monitorOverview.merged_candidates,
        rejected_candidates: monitorOverview.rejected_candidates,
        concepts_ready: true,
        candidates_ready: true,
      },
    });
  } catch (error) {
    console.error('Error fetching medical library overview:', error);
    res.status(500).json({ error: 'Failed to fetch medical library overview' });
  }
});

router.get('/project-memory', requireCapability('memory.project_summary'), async (req, res) => {
  try {
    const rows = projectDb.getAllProjects(req.user.id);
    const storedOperatingAssets = medLibraryOperatingAssetDb.listForUser(req.user.id);
    const reportsByProject = new Map();
    const projects = [];
    const activeProjects = [];
    const historicalProjects = [];
    const recentLessons = [];
    let totalLessons = 0;
    let confirmedLessons = 0;
    let candidateLessons = 0;
    let manualLessons = 0;
    const activeThreshold = Date.now() - (ACTIVE_PROJECT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    for (const item of await listUserReportFiles(req.user.id)) {
      const existing = reportsByProject.get(item.projectName) || [];
      existing.push(item);
      reportsByProject.set(item.projectName, existing);
    }

    for (const row of rows) {
      const projectPath = await resolveStoredProjectPath(row);
      const [state, brief] = await Promise.all([
        projectPath && path.isAbsolute(projectPath) ? readResearchLessons(projectPath) : Promise.resolve(null),
        projectPath && path.isAbsolute(projectPath) ? readResearchBriefSummary(projectPath) : Promise.resolve(null),
      ]);
      const items = Array.isArray(state?.items) ? state.items : [];

      const normalizedLessons = items
        .map((item) => normalizeLessonRow(item, row))
        .filter(Boolean)
        .sort(sortLessonRows);
      const projectReports = reportsByProject.get(row.id) || [];
      const reports = {
        count: projectReports.length,
        latestAddedAt: projectReports[0]?.createdAt || null,
        items: projectReports.slice(0, 3),
      };

      const projectConfirmedCount = normalizedLessons.filter((item) => item.status === 'confirmed').length;
      const projectCandidateCount = normalizedLessons.length - projectConfirmedCount;
      const updatedAtCandidates = [
        row.last_accessed,
        normalizedLessons[0]?.lastVerifiedAt || normalizedLessons[0]?.updatedAt,
        state?.updatedAt,
        brief?.updatedAt,
        reports.latestAddedAt,
      ].filter(Boolean);
      const updatedAt = pickLatestDate(updatedAtCandidates);

      if (normalizedLessons.length === 0 && !brief && reports.count === 0) {
        continue;
      }

      totalLessons += normalizedLessons.length;
      confirmedLessons += projectConfirmedCount;
      candidateLessons += projectCandidateCount;
      manualLessons += normalizedLessons.filter((item) => item.source === 'manual').length;
      recentLessons.push(...normalizedLessons);

      const projectEntry = {
        projectId: row.id,
        projectName: row.id,
        displayName: row.display_name || row.id,
        updatedAt,
        totalLessons: normalizedLessons.length,
        confirmedLessons: projectConfirmedCount,
        candidateLessons: projectCandidateCount,
        brief,
        reports,
        topLessons: normalizedLessons,
      };

      projects.push(projectEntry);
      if (toTimestamp(updatedAt) >= activeThreshold) {
        activeProjects.push(projectEntry);
      } else {
        historicalProjects.push(projectEntry);
      }
    }

    recentLessons.sort(sortLessonRows);
    projects.sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime());
    activeProjects.sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime());
    historicalProjects.sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime());
    const formalAssets = buildFormalOperatingAssets(storedOperatingAssets);

    res.json({
      overview: {
        totalProjects: projects.length,
        activeProjects: activeProjects.length,
        historicalProjects: historicalProjects.length,
        totalLessons,
        confirmedLessons,
        candidateLessons,
        manualLessons,
      },
      projects,
      activeProjects,
      historicalProjects,
      formalAssets,
      recentLessons: recentLessons.slice(0, 24),
    });
  } catch (error) {
    console.error('Error fetching project memory overview:', error);
    res.status(500).json({ error: 'Failed to fetch project memory overview' });
  }
});

async function resolveOwnedProjectPath(userId, projectName) {
  const normalizedName = collapseWhitespace(projectName);
  if (!normalizedName) {
    return { error: 'projectName is required', status: 400 };
  }

  const row = projectDb.getAllProjects(userId).find((item) => item.id === normalizedName);
  if (!row) {
    return { error: 'Project not found', status: 404 };
  }

  const projectPath = await resolveStoredProjectPath(row);
  if (!projectPath || !path.isAbsolute(projectPath)) {
    return { error: 'Project directory could not be resolved', status: 404 };
  }

  return { projectPath, row };
}

router.post('/lessons', requireCapability('memory.project_summary'), async (req, res) => {
  try {
    const { projectPath, row, error, status } = await resolveOwnedProjectPath(req.user.id, req.body?.projectName);
    if (error) {
      return res.status(status).json({ error });
    }

    const result = await upsertManualResearchLesson(projectPath, req.body || {});
    res.json({
      success: true,
      created: result.created,
      lesson: normalizeLessonRow(result.lesson, row),
    });
  } catch (error) {
    console.error('[ERROR] Failed to save manual research lesson:', error.message);
    const clientError = /required|not found|derived/.test(error.message);
    res.status(clientError ? 400 : 500).json({ error: error.message });
  }
});

router.put('/lessons/:slug', requireCapability('memory.project_summary'), async (req, res) => {
  try {
    const { projectPath, row, error, status } = await resolveOwnedProjectPath(req.user.id, req.body?.projectName);
    if (error) {
      return res.status(status).json({ error });
    }

    const result = await upsertManualResearchLesson(projectPath, {
      ...(req.body || {}),
      slug: req.params.slug,
    });
    res.json({ success: true, lesson: normalizeLessonRow(result.lesson, row) });
  } catch (error) {
    console.error('[ERROR] Failed to update manual research lesson:', error.message);
    const notFound = error.message === 'lesson not found';
    const clientError = notFound || /required|derived/.test(error.message);
    res.status(notFound ? 404 : clientError ? 400 : 500).json({ error: error.message });
  }
});

router.delete('/lessons/:slug', requireCapability('memory.project_summary'), async (req, res) => {
  try {
    const projectName = req.query?.projectName || req.body?.projectName;
    const { projectPath, error, status } = await resolveOwnedProjectPath(req.user.id, projectName);
    if (error) {
      return res.status(status).json({ error });
    }

    const result = await deleteResearchLesson(projectPath, req.params.slug);
    if (!result.deleted) {
      return res.status(404).json({ error: 'Lesson not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('[ERROR] Failed to delete research lesson:', error.message);
    res.status(500).json({ error: error.message });
  }
});

const LESSON_DRAFT_SYSTEM_PROMPT = [
  'You help a medical researcher turn a work session into reusable, reviewable lessons.',
  'Return ONLY a JSON array. Each element must have exactly these keys:',
  '"title" (short label, <= 60 chars), "trigger" (the concrete situation in which this applies),',
  '"correctPattern" (the action to take next time, imperative),',
  '"severity" (one of "high", "medium", "low"), "category" (short kebab-case tag),',
  'and "stageHints" (array of zero or more of "literature", "experiment", "publication").',
  '',
  'Rules for good output:',
  '- Ground every lesson in something that actually happened in the provided context.',
  '- Be specific: name the dataset, variable, package, file, or error involved.',
  '- Skip generic textbook advice such as "verify your data" or "check assumptions".',
  '- If the context does not support any concrete lesson, return an empty array [].',
  '- Return at most 5 items. No prose, no markdown fences, JSON array only.',
].join('\n');

function parseLessonDraftJson(rawText) {
  const text = String(rawText || '').trim();
  if (!text) {
    return [];
  }

  const withoutFence = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = withoutFence.indexOf('[');
  const end = withoutFence.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    return [];
  }

  try {
    const parsed = JSON.parse(withoutFence.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeLessonDraft(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const trigger = collapseWhitespace(item.trigger || '').slice(0, 400);
  const correctPattern = collapseWhitespace(item.correctPattern || '').slice(0, 600);
  if (!trigger || !correctPattern) {
    return null;
  }

  const severity = collapseWhitespace(item.severity || '').toLowerCase();
  return {
    title: collapseWhitespace(item.title || correctPattern).slice(0, 120),
    trigger,
    correctPattern,
    severity: ['high', 'medium', 'low'].includes(severity) ? severity : 'medium',
    category: collapseWhitespace(item.category || 'manual').slice(0, 60) || 'manual',
    stageHints: Array.isArray(item.stageHints)
      ? uniqueStrings(item.stageHints.map((value) => collapseWhitespace(value))).slice(0, 3)
      : [],
  };
}

router.post('/lessons/draft', requireCapability('memory.project_summary'), async (req, res) => {
  try {
    const { projectPath, error, status } = await resolveOwnedProjectPath(req.user.id, req.body?.projectName);
    if (error) {
      return res.status(status).json({ error });
    }

    const sessionId = collapseWhitespace(req.body?.sessionId || '');
    const seedText = String(req.body?.text || '').slice(0, 8000).trim();
    const language = req.body?.language === 'en' ? 'en' : 'zh';

    const contextBlocks = [];
    if (sessionId) {
      const snapshot = await readExecutionMemorySnapshot({
        scope: 'session',
        projectPath,
        sessionId,
        provider: collapseWhitespace(req.body?.provider || '') || null,
      }, { ledgerLimit: 80 });
      const executionBlock = buildExecutionPromptContext(snapshot);
      if (executionBlock) {
        contextBlocks.push(executionBlock);
      }
    }

    const existingState = await readResearchLessons(projectPath);
    const existingTitles = existingState.items.map((item) => collapseWhitespace(item.title)).filter(Boolean);
    if (existingTitles.length > 0) {
      contextBlocks.push([
        '<existing_lessons>',
        'These lessons are already recorded. Do not repeat them:',
        ...existingTitles.slice(0, 30).map((title) => `- ${title}`),
        '</existing_lessons>',
      ].join('\n'));
    }

    if (seedText) {
      contextBlocks.push(`<selected_text>\n${seedText}\n</selected_text>`);
    }

    if (contextBlocks.length === 0) {
      return res.status(422).json({
        error: 'No session context available to draft lessons from',
        code: 'EMPTY_CONTEXT',
      });
    }

    const languageInstruction = language === 'en'
      ? 'Write all field values in English.'
      : 'Write all field values in Simplified Chinese (字段值用简体中文书写), except "severity", "category" and "stageHints" which stay in English.';

    const rawText = await requestStructuredJson({
      userId: req.user.id,
      reference: null,
      sourceKey: 'project_memory_lesson_draft',
      extractionConfig: normalizeExtractionConfig(req.body?.extraction || {}),
      overrideMessages: {
        system: `${LESSON_DRAFT_SYSTEM_PROMPT}\n${languageInstruction}`,
        user: `${contextBlocks.join('\n\n')}\n\nDraft the reusable lessons from the context above.`,
      },
    });

    if (!rawText) {
      return res.status(503).json({
        error: 'No model credentials configured for lesson drafting',
        code: 'LLM_UNAVAILABLE',
      });
    }

    const drafts = parseLessonDraftJson(rawText)
      .map(normalizeLessonDraft)
      .filter(Boolean)
      .slice(0, 5);

    res.json({ success: true, drafts });
  } catch (error) {
    console.error('[ERROR] Failed to draft research lessons:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post('/operating-assets', requireCapability('memory.project_summary'), async (req, res) => {
  try {
    const payload = normalizeOperatingAssetPayload(req.body || {});
    if (!payload) {
      return res.status(400).json({ error: 'Invalid operating asset payload' });
    }

    const savedAsset = medLibraryOperatingAssetDb.save({
      userId: req.user.id,
      assetType: payload.assetType,
      title: payload.title,
      stageKey: payload.stageKey,
      stageLabel: payload.stageLabel,
      description: payload.description,
      content: payload.content,
      metadata: {
        source: 'manual_freeze',
      },
    });

    if (!savedAsset) {
      return res.status(500).json({ error: 'Failed to save operating asset' });
    }

    return res.json({
      success: true,
      asset: mapStoredOperatingAssetToApi(savedAsset),
    });
  } catch (error) {
    console.error('Error creating operating asset:', error);
    return res.status(500).json({ error: 'Failed to create operating asset' });
  }
});

router.put('/operating-assets/:id', requireCapability('memory.project_summary'), async (req, res) => {
  try {
    const existing = medLibraryOperatingAssetDb.getById(req.user.id, req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Operating asset not found' });
    }

    const payload = normalizeOperatingAssetPayload(req.body || {});
    if (!payload) {
      return res.status(400).json({ error: 'Invalid operating asset payload' });
    }

    const savedAsset = medLibraryOperatingAssetDb.save({
      id: existing.id,
      userId: req.user.id,
      assetType: payload.assetType,
      title: payload.title,
      stageKey: payload.stageKey,
      stageLabel: payload.stageLabel,
      description: payload.description,
      content: payload.content,
      metadata: {
        ...(existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {}),
        source: 'manual_freeze',
      },
    });

    if (!savedAsset) {
      return res.status(500).json({ error: 'Failed to update operating asset' });
    }

    return res.json({
      success: true,
      asset: mapStoredOperatingAssetToApi(savedAsset),
    });
  } catch (error) {
    console.error('Error updating operating asset:', error);
    return res.status(500).json({ error: 'Failed to update operating asset' });
  }
});

router.delete('/operating-assets/:id', requireCapability('memory.project_summary'), async (req, res) => {
  try {
    const ok = medLibraryOperatingAssetDb.deleteForUser(req.user.id, req.params.id);
    if (!ok) {
      return res.status(404).json({ error: 'Operating asset not found' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting operating asset:', error);
    return res.status(500).json({ error: 'Failed to delete operating asset' });
  }
});

/** Report files discovered by scanning each project's report directories. */
router.get('/report-preview', async (req, res) => {
  try {
    const items = await listUserReportFiles(req.user.id);
    res.json({
      success: true,
      total: items.length,
      items,
    });
  } catch (error) {
    console.error('Error listing project report files:', error);
    res.status(500).json({ error: 'Failed to list report files' });
  }
});

/** Streams a scanned report file straight out of the project directory. */
router.get('/report-preview/:id/content', limitReportPreviewContentDownload, async (req, res) => {
  try {
    const decoded = decodeReportFileId(req.params.id);
    if (!decoded) {
      return res.status(400).json({ error: 'Invalid report file id' });
    }

    const projectRow = projectDb.getAllProjects(req.user.id).find((row) => row.id === decoded.projectName);
    if (!projectRow) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const projectPath = await resolveStoredProjectPath(projectRow);
    if (!projectPath || !path.isAbsolute(projectPath)) {
      return res.status(404).json({ error: 'Could not resolve project directory' });
    }

    const relativePath = normalizeRelativePath(decoded.relativePath);
    if (!isScannedReportRelativePath(relativePath)) {
      return res.status(403).json({ error: 'Path is outside the scanned report directories' });
    }

    const sourceAbs = path.join(projectPath, ...relativePath.split('/'));
    if (!assertPathInsideProject(projectPath, sourceAbs)) {
      return res.status(403).json({ error: 'Path escapes project root' });
    }
    if (!(await pathExists(sourceAbs))) {
      return res.status(404).json({ error: 'Report file no longer exists' });
    }

    return streamFileResponse(res, sourceAbs);
  } catch (error) {
    console.error('Error serving report file content:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to serve report file content' });
    }
  }
});


/**
 * The project memory file is a plain Markdown document shared by supported agents.
 * It lives in the hidden .medhelpsec metadata directory and is shared by supported
 * agents. Automatic turn capture and recall share these helpers so manual and
 * background writes are serialized through the same per-project queue.
 */
const PROJECT_MEMORY_SYSTEM_PROMPT = [
  'You summarise a research project into one shared Markdown memory file for MedHelpSec.',
  'The readers are the researcher who owns the project and the research secretary agent that will pick it up next.',
  '',
  'Return ONLY Markdown. No JSON, no code fences around the whole document.',
  'Use this structure, dropping any section you have no real evidence for:',
  '',
  '# <project name>',
  '## 项目概况 / Project overview',
  '## 人员与职责 / People and roles',
  '## 研究问题 / Research question',
  '## 数据来源 / Data sources',
  '## 变量定义 / Variable definitions',
  '## 指标计算方式 / Indicator calculations',
  '## 里程碑与截止日期 / Milestones and deadlines',
  '## 会议反馈与决定 / Meeting feedback and decisions',
  '## 材料与提交 / Materials and submissions',
  '## 待办与风险 / Actions and risks',
  '',
  'Rules:',
  '- Ground every statement in the provided context. Name datasets, variables, files, packages, and errors.',
  '- Keep confirmed owners and absolute dates with actions and deadlines. Never invent a person, date, approval, or completed action.',
  '- For every variable with evidence, record its source table/field, raw/derived status, data type, coding and labels, reference group, unit, valid range, measurement timing, transformation, and missing-value rule as available.',
  '- For every indicator with evidence, record its exact formula, numerator/denominator, source variables, unit, time window, cutoff, transformation, missing-value rule, and cohort/version as available.',
  '- Keep variables, indicators, and cohort-specific definitions separate. Never infer a missing variable definition or calculation method from general medical knowledge.',
  '- Skip generic advice such as "verify your data" or "check assumptions".',
  '- Prefer short bullets over paragraphs. No filler.',
  '- If the context supports almost nothing, say so plainly in one line instead of inventing content.',
].join('\n');

router.get('/project-memory-file', requireCapability('memory.project_summary'), async (req, res) => {
  try {
    const { projectPath, error, status } = await resolveOwnedProjectPath(req.user.id, req.query?.projectName);
    if (error) {
      return res.status(status).json({ error });
    }
    res.json({ success: true, memory: await readProjectMemoryFile(projectPath) });
  } catch (error) {
    console.error('[ERROR] Failed to read project memory file:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.put('/project-memory-file', requireCapability('memory.project_summary'), async (req, res) => {
  try {
    const { projectPath, error, status } = await resolveOwnedProjectPath(req.user.id, req.body?.projectName);
    if (error) {
      return res.status(status).json({ error });
    }
    if (typeof req.body?.content !== 'string') {
      return res.status(400).json({ error: 'content is required' });
    }
    res.json({ success: true, memory: await writeProjectMemoryFile(projectPath, req.body.content) });
  } catch (error) {
    console.error('[ERROR] Failed to save project memory file:', error.message);
    res.status(500).json({ error: error.message });
  }
});

router.post('/project-memory-file/generate', requireCapability('memory.project_summary'), async (req, res) => {
  try {
    const { projectPath, row, error, status } = await resolveOwnedProjectPath(req.user.id, req.body?.projectName);
    if (error) {
      return res.status(status).json({ error });
    }

    const language = req.body?.language === 'en' ? 'en' : 'zh';
    const contextBlocks = [];

    const brief = await readResearchBriefSummary(projectPath);
    if (brief) {
      contextBlocks.push([
        '<research_brief>',
        `title: ${brief.title || ''}`,
        brief.coreQuestion ? `core question: ${brief.coreQuestion}` : '',
        brief.knowledgeScope ? `scope: ${brief.knowledgeScope}` : '',
        brief.summary ? `summary: ${brief.summary}` : '',
        '</research_brief>',
      ].filter(Boolean).join('\n'));
    }

    const sessionId = collapseWhitespace(req.body?.sessionId || '');
    const snapshot = await readExecutionMemorySnapshot({
      scope: sessionId ? 'session' : 'project',
      projectPath,
      sessionId: sessionId || null,
      provider: collapseWhitespace(req.body?.provider || '') || null,
    }, { ledgerLimit: 200 }).catch(() => null);
    const executionBlock = snapshot ? buildExecutionPromptContext(snapshot) : '';
    if (executionBlock) {
      contextBlocks.push(executionBlock);
    }

    const reportFiles = await scanProjectReportFiles(projectPath);
    if (reportFiles.length > 0) {
      contextBlocks.push([
        '<report_files>',
        'Reports and materials that already exist in this project:',
        ...reportFiles.slice(0, 40).map((file) => `- ${file.relativePath}`),
        '</report_files>',
      ].join('\n'));
    }

    const lessonsState = await readResearchLessons(projectPath);
    if (lessonsState.items.length > 0) {
      contextBlocks.push([
        '<recorded_lessons>',
        ...lessonsState.items.slice(0, 30).map((item) => (
          `- ${item.title}: ${collapseWhitespace(item.correctPattern || item.summary || '')}`
        )),
        '</recorded_lessons>',
      ].join('\n'));
    }

    if (contextBlocks.length === 0) {
      return res.status(422).json({
        error: 'No project context available to summarise yet',
        code: 'EMPTY_CONTEXT',
      });
    }

    const languageInstruction = language === 'en'
      ? 'Write the document in English.'
      : 'Write the document in Simplified Chinese (用简体中文书写), keeping variable, file, and package names as-is.';

    const markdown = await requestStructuredJson({
      userId: req.user.id,
      reference: null,
      sourceKey: 'project_memory_file',
      extractionConfig: normalizeExtractionConfig(req.body?.extraction || {}),
      overrideMessages: {
        system: `${PROJECT_MEMORY_SYSTEM_PROMPT}\n${languageInstruction}`,
        user: [
          `Project: ${row.display_name || row.id}`,
          '',
          contextBlocks.join('\n\n'),
          '',
          'Write the memory file for this project.',
        ].join('\n'),
      },
    });

    const cleaned = String(markdown || '')
      .replace(/^\s*```(?:markdown|md)?\s*\n/i, '')
      .replace(/\n```\s*$/i, '')
      .trim();

    if (!cleaned) {
      return res.status(422).json({ error: 'The model returned an empty summary', code: 'EMPTY_RESULT' });
    }

    // Returned as a draft: the user reviews it in the editor and saves.
    res.json({ success: true, draft: cleaned });
  } catch (error) {
    console.error('[ERROR] Failed to generate project memory file:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
