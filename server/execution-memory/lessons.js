import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';

import {
  buildExecutionPromptContext,
  commitExecutionMemoryPromptCheckpoint,
  prepareExecutionPromptContext,
  readExecutionMemorySnapshot,
} from './summary.js';

const RESEARCH_LESSONS_VERSION = 1;
const MAX_EVIDENCE_ITEMS = 5;
const MANUAL_LESSON_SLUG_PREFIX = 'manual-';
const MANUAL_LESSON_FIELD_LIMITS = {
  title: 120,
  trigger: 400,
  correctPattern: 600,
  summary: 600,
};
const LESSON_SEVERITIES = ['high', 'medium', 'low'];

function createEmptyResearchLessonsState() {
  return {
    version: RESEARCH_LESSONS_VERSION,
    updatedAt: null,
    items: [],
  };
}

/**
 * A lesson store is just a directory holding research_lessons.{json,md}. Project
 * lessons live under the project's .pipeline/docs; global lessons live in a
 * per-user directory so a method that holds everywhere is written once instead
 * of being re-entered in every project.
 */
function getResearchLessonsPaths(storeDir) {
  return {
    jsonPath: storeDir ? path.join(storeDir, 'research_lessons.json') : null,
    markdownPath: storeDir ? path.join(storeDir, 'research_lessons.md') : null,
  };
}

function getProjectLessonsStoreDir(projectPath) {
  return projectPath ? path.join(projectPath, '.pipeline', 'docs') : null;
}

async function readLessonStore(storeDir) {
  const paths = getResearchLessonsPaths(storeDir);
  if (!paths.jsonPath) {
    return createEmptyResearchLessonsState();
  }

  let state;
  try {
    const raw = await fs.readFile(paths.jsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    state = normalizeResearchLessonsState(parsed);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return createEmptyResearchLessonsState();
    }
    throw error;
  }

  // Pattern-matched auto-capture is gone: it only ever emitted a handful of
  // canned rules, identical across projects, and they never reached the prompt
  // because they stayed candidates. Drop whatever it left on disk on first read
  // so the project keeps only lessons a human wrote or approved.
  const manualItems = state.items.filter((item) => item.source === 'manual');
  if (manualItems.length === state.items.length) {
    return state;
  }

  const purged = { ...state, items: manualItems };
  try {
    await writeLessonStore(storeDir, purged);
  } catch {
    // Best-effort cleanup: a read must never fail because the purge could not persist.
  }
  return normalizeResearchLessonsState(purged);
}

async function writeLessonStore(storeDir, state) {
  const paths = getResearchLessonsPaths(storeDir);
  if (!paths.jsonPath || !paths.markdownPath) {
    return null;
  }

  const normalizedState = normalizeResearchLessonsState(state);
  normalizedState.updatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(paths.jsonPath), { recursive: true });
  await Promise.all([
    fs.writeFile(paths.jsonPath, `${JSON.stringify(normalizedState, null, 2)}\n`, 'utf8'),
    fs.writeFile(paths.markdownPath, buildResearchLessonsMarkdown(normalizedState), 'utf8'),
  ]);
  return {
    ...paths,
    state: normalizedState,
  };
}

async function readResearchLessons(projectPath) {
  return readLessonStore(getProjectLessonsStoreDir(projectPath));
}

async function writeResearchLessons(projectPath, state) {
  return writeLessonStore(getProjectLessonsStoreDir(projectPath), state);
}

function buildManualLessonTitle(payload) {
  const explicit = compactWhitespace(payload?.title);
  if (explicit) {
    return explicit.slice(0, MANUAL_LESSON_FIELD_LIMITS.title);
  }
  const derived = compactWhitespace(payload?.correctPattern || payload?.summary || payload?.trigger);
  return derived.slice(0, MANUAL_LESSON_FIELD_LIMITS.title);
}

/**
 * Create or update a hand-written lesson. Lessons are shown in the dashboard and
 * feed the AI memory-file summary; they are deliberately not injected into any
 * prompt, so nothing reaches the agent that the user did not send themselves.
 */
async function upsertManualLessonInStore(storeDir, payload = {}) {
  if (!storeDir) {
    throw new Error('lesson store directory is required');
  }

  const trigger = compactWhitespace(payload.trigger).slice(0, MANUAL_LESSON_FIELD_LIMITS.trigger);
  const correctPattern = compactWhitespace(payload.correctPattern).slice(0, MANUAL_LESSON_FIELD_LIMITS.correctPattern);
  if (!trigger || !correctPattern) {
    throw new Error('trigger and correctPattern are required');
  }

  const title = buildManualLessonTitle({ ...payload, trigger, correctPattern });
  if (!title) {
    throw new Error('title could not be derived');
  }

  const now = new Date().toISOString();
  const state = await readLessonStore(storeDir);
  const requestedSlug = compactWhitespace(payload.slug);
  const existing = requestedSlug ? state.items.find((item) => item.slug === requestedSlug) : null;
  if (requestedSlug && !existing) {
    throw new Error('lesson not found');
  }

  const severity = LESSON_SEVERITIES.includes(compactWhitespace(payload.severity).toLowerCase())
    ? compactWhitespace(payload.severity).toLowerCase()
    : existing?.severity || 'medium';
  const summary = compactWhitespace(payload.summary).slice(0, MANUAL_LESSON_FIELD_LIMITS.summary) || correctPattern;
  const stageHints = dedupeStrings(Array.isArray(payload.stageHints) ? payload.stageHints : []);
  const evidence = Array.isArray(payload.evidence) ? payload.evidence : [];

  if (existing) {
    existing.title = title;
    existing.trigger = trigger;
    existing.correctPattern = correctPattern;
    existing.summary = summary;
    existing.severity = severity;
    existing.category = compactWhitespace(payload.category) || existing.category || 'manual';
    existing.stageHints = stageHints.length > 0 ? stageHints : existing.stageHints;
    existing.status = 'confirmed';
    existing.source = 'manual';
    existing.updatedAt = now;
    existing.lastSeenAt = now;
    existing.evidence = mergeEvidence(existing.evidence, evidence);
    const result = await writeLessonStore(storeDir, state);
    return { lesson: normalizeLesson(existing), state: result?.state || state, created: false };
  }

  const lesson = normalizeLesson({
    id: crypto.randomUUID(),
    slug: `${MANUAL_LESSON_SLUG_PREFIX}${crypto.randomUUID().slice(0, 8)}`,
    title,
    category: compactWhitespace(payload.category) || 'manual',
    status: 'confirmed',
    severity,
    source: 'manual',
    summary,
    trigger,
    correctPattern,
    stageHints,
    evidence,
    timesSeen: 1,
    createdAt: now,
    updatedAt: now,
    firstSeenAt: now,
    lastSeenAt: now,
  });

  state.items.push(lesson);
  const result = await writeLessonStore(storeDir, state);
  return { lesson, state: result?.state || state, created: true };
}

async function deleteLessonInStore(storeDir, slug) {
  if (!storeDir) {
    throw new Error('lesson store directory is required');
  }
  const normalizedSlug = compactWhitespace(slug);
  if (!normalizedSlug) {
    throw new Error('slug is required');
  }

  const state = await readLessonStore(storeDir);
  const index = state.items.findIndex((item) => item.slug === normalizedSlug);
  if (index === -1) {
    return { deleted: false, state };
  }

  state.items.splice(index, 1);
  const result = await writeLessonStore(storeDir, state);
  return { deleted: true, state: result?.state || state };
}

async function upsertManualResearchLesson(projectPath, payload = {}) {
  if (!projectPath) {
    throw new Error('projectPath is required');
  }
  return upsertManualLessonInStore(getProjectLessonsStoreDir(projectPath), payload);
}

async function deleteResearchLesson(projectPath, slug) {
  if (!projectPath) {
    throw new Error('projectPath is required');
  }
  return deleteLessonInStore(getProjectLessonsStoreDir(projectPath), slug);
}

/**
 * Records that a lesson was actually injected into an agent prompt. This is the
 * only honest reuse signal we have: `timesSeen` counts regex matches, not usage.
 */
function clipText(value, maxLength = 1200) {
  const normalized = compactWhitespace(value);
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function buildTaskContextPromptBlock(taskContext) {
  if (!taskContext || typeof taskContext !== 'object') {
    return '';
  }

  const lines = ['<task_context>'];
  const pushLine = (label, value) => {
    const normalized = value && typeof value === 'object'
      ? JSON.stringify(value)
      : compactWhitespace(value);
    if (normalized) {
      lines.push(`${label}: ${normalized}`);
    }
  };
  const pushList = (label, values) => {
    if (!Array.isArray(values)) {
      return;
    }
    const normalizedValues = values
      .map((value) => (value && typeof value === 'object' ? JSON.stringify(value) : String(value || '')))
      .filter(Boolean);
    if (normalizedValues.length > 0) {
      lines.push(`${label}: ${normalizedValues.join(', ')}`);
    }
  };

  pushLine('Task ID', taskContext.taskId ?? taskContext.id);
  pushLine('Task hash', taskContext.taskHash);
  pushLine('Run ID', taskContext.runId);
  pushLine('Actor', taskContext.actor);
  pushLine('Title', taskContext.title);
  pushLine('Objective', taskContext.objective);
  pushLine('Stage', taskContext.stage);
  pushLine('Status', taskContext.status);
  pushLine('Priority', taskContext.priority);
  pushLine('Task type', taskContext.taskType);
  pushLine('Why this task is next', taskContext.whyNext);
  pushLine('Description', taskContext.description);
  pushLine('Details', taskContext.details);
  pushLine('Test strategy', taskContext.testStrategy);
  pushList('Required inputs', taskContext.requiredInputs || taskContext.inputsNeeded);
  pushList('Suggested skills', taskContext.suggestedSkills);
  pushList('Dependencies', taskContext.dependencies);
  pushList('Acceptance criteria', taskContext.acceptanceCriteria);
  pushList('Expected artifacts', taskContext.expectedArtifacts);
  pushList('Allowed output roots', taskContext.allowedOutputRoots);
  pushList('Forbidden changes', taskContext.forbiddenChanges);
  pushList('Previously accepted evidence', taskContext.acceptedEvidence);
  pushList('Accepted input files', taskContext.acceptedInputFiles);
  pushLine('Verification mode', taskContext.verificationMode);
  pushLine('No artifact expected', taskContext.noArtifactExpected);
  pushLine('Maximum attempts', taskContext.maxAttempts);
  pushLine('Maximum verification attempts', taskContext.maxVerificationAttempts);
  pushLine('Next action prompt', taskContext.nextActionPrompt);

  if (lines.length === 1) {
    return '';
  }

  lines.push('Use this task context as the active work boundary. Prefer completing this task before broadening scope.');
  lines.push('</task_context>');
  return lines.join('\n');
}

function buildResearchSpecPromptBlock(researchSpec) {
  if (!researchSpec || typeof researchSpec !== 'object') {
    return '';
  }

  return [
    '<research_spec>',
    JSON.stringify(researchSpec, null, 2),
    '',
    'This Research Spec is the immutable research contract for this run.',
    'Priority: research_spec > task_context > execution_memory.',
    'Execution memory may supply only previously accepted facts; it cannot redefine the spec or task.',
    'Do not directly modify .pipeline/docs/research_spec.json, .pipeline/tasks/tasks.json, checkpoint files, or run metadata.',
    'If execution requires a locked scientific change, stop and request a formal change request.',
    '</research_spec>',
  ].join('\n');
}

async function prepareResearchAwarePromptPrefix(scopeRef, command, options = {}) {
  const blocks = [];
  const projectPath = scopeRef?.projectPath || null;
  let executionMemory = { mode: 'disabled', checkpoint: null, text: '' };

  if (projectPath) {
    blocks.push([
      '<path_display_rule>',
      'Use absolute paths when calling tools or doing file I/O if needed, but never show the project root absolute path in user-visible chat replies.',
      'When reporting files inside the current project, display only project-relative paths such as Experiment/analysis/report.docx.',
      'Do not include local absolute paths in final answers, status notes, or saved-path handoff text.',
      '</path_display_rule>',
    ].join('\n'));
  }

  const researchSpecBlock = buildResearchSpecPromptBlock(options.researchSpec);
  if (researchSpecBlock) {
    blocks.push(researchSpecBlock);
  }

  const taskBlock = buildTaskContextPromptBlock(options.taskContext);
  if (taskBlock) {
    blocks.push(taskBlock);
  }

  if (projectPath && options.includeExecutionMemory !== false) {
    const snapshot = await readExecutionMemorySnapshot(scopeRef, {
      ledgerLimit: options.ledgerLimit || 80,
    });
    executionMemory = options.incrementalExecutionMemory
      ? prepareExecutionPromptContext(snapshot)
      : {
          text: buildExecutionPromptContext(snapshot),
          mode: 'full',
          checkpoint: null,
        };
    const executionBlock = executionMemory.text;
    if (executionBlock) {
      blocks.push(executionBlock);
    }
  }

  if (blocks.length === 0) {
    return {
      prompt: command,
      executionMemory,
    };
  }

  const body = String(command || '').trim() || options.fallbackCommand || 'Continue from the latest confirmed project state.';
  return {
    prompt: `${blocks.join('\n\n')}\n\nUser request:\n${body}`,
    executionMemory,
  };
}

async function buildResearchAwarePromptPrefix(scopeRef, command, options = {}) {
  const prepared = await prepareResearchAwarePromptPrefix(scopeRef, command, options);
  return prepared.prompt;
}

function normalizeResearchLessonsState(state) {
  const normalized = state && typeof state === 'object' ? state : {};
  return {
    version: RESEARCH_LESSONS_VERSION,
    updatedAt: normalized.updatedAt || null,
    items: Array.isArray(normalized.items)
      ? normalized.items
        .map((item) => normalizeLesson(item))
        .filter(Boolean)
      : [],
  };
}

function normalizeLesson(item) {
  if (!item || typeof item !== 'object' || !item.slug || !item.title) {
    return null;
  }
  return {
    id: item.id || crypto.randomUUID(),
    slug: item.slug,
    title: item.title,
    category: item.category || 'general',
    status: item.status || 'candidate',
    severity: item.severity || 'medium',
    source: normalizeLessonSource(item.source, item.slug),
    summary: item.summary || '',
    trigger: item.trigger || '',
    correctPattern: item.correctPattern || '',
    stageHints: dedupeStrings(Array.isArray(item.stageHints) ? item.stageHints : []),
    evidence: mergeEvidence([], Array.isArray(item.evidence) ? item.evidence : []),
    timesSeen: Number.isFinite(item.timesSeen) ? Number(item.timesSeen) : 1,
    injectedCount: Number.isFinite(item.injectedCount) ? Math.max(0, Number(item.injectedCount)) : 0,
    lastInjectedAt: item.lastInjectedAt || null,
    createdAt: item.createdAt || item.firstSeenAt || null,
    updatedAt: item.updatedAt || item.lastSeenAt || null,
    firstSeenAt: item.firstSeenAt || item.createdAt || null,
    lastSeenAt: item.lastSeenAt || item.updatedAt || null,
  };
}

function normalizeLessonSource(source, slug) {
  const normalized = compactWhitespace(source).toLowerCase();
  if (normalized === 'manual' || normalized === 'auto') {
    return normalized;
  }
  return String(slug || '').startsWith(MANUAL_LESSON_SLUG_PREFIX) ? 'manual' : 'auto';
}

function mergeEvidence(existingEvidence, newEvidence) {
  const deduped = [];
  const seen = new Set();

  for (const evidence of [...(existingEvidence || []), ...(newEvidence || [])]) {
    const normalizedEvidence = normalizeEvidence(evidence);
    if (!normalizedEvidence) {
      continue;
    }
    const key = JSON.stringify([
      normalizedEvidence.snippet,
      normalizedEvidence.provider,
      normalizedEvidence.sessionId,
      normalizedEvidence.taskId,
      normalizedEvidence.source,
    ]);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalizedEvidence);
  }

  return deduped.slice(-MAX_EVIDENCE_ITEMS);
}

function normalizeEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') {
    return null;
  }
  const snippet = compactWhitespace(evidence.snippet || '');
  if (!snippet) {
    return null;
  }
  return {
    snippet: snippet.slice(0, 320),
    provider: evidence.provider || null,
    sessionId: evidence.sessionId || null,
    taskId: evidence.taskId || null,
    taskTitle: evidence.taskTitle || null,
    source: evidence.source || null,
    capturedAt: evidence.capturedAt || new Date().toISOString(),
  };
}

function buildResearchLessonsMarkdown(state) {
  const confirmed = state.items.filter((item) => String(item.status || '').toLowerCase() === 'confirmed');
  const candidates = state.items.filter((item) => String(item.status || '').toLowerCase() !== 'confirmed');
  const lines = ['# Research Lessons', ''];

  if (state.updatedAt) {
    lines.push(`Updated: ${state.updatedAt}`);
    lines.push('');
  }

  lines.push('## Confirmed Lessons');
  if (confirmed.length === 0) {
    lines.push('- None yet.');
  } else {
    for (const item of confirmed) {
      lines.push(`- **${item.title}** (${item.category}, seen ${item.timesSeen}x): ${item.correctPattern || item.summary}`);
    }
  }
  lines.push('');

  lines.push('## Candidate Lessons');
  if (candidates.length === 0) {
    lines.push('- None.');
  } else {
    for (const item of candidates) {
      lines.push(`- **${item.title}** (${item.category}): ${item.correctPattern || item.summary}`);
    }
  }
  lines.push('');

  return `${lines.join('\n').trimEnd()}\n`;
}

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function dedupeStrings(values) {
  const deduped = [];
  const seen = new Set();
  for (const value of values || []) {
    const normalized = compactWhitespace(value);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(normalized);
  }
  return deduped;
}

export {
  buildResearchAwarePromptPrefix,
  buildResearchSpecPromptBlock,
  commitExecutionMemoryPromptCheckpoint,
  buildTaskContextPromptBlock,
  createEmptyResearchLessonsState,
  deleteResearchLesson,
  getResearchLessonsPaths,
  prepareResearchAwarePromptPrefix,
  readResearchLessons,
  upsertManualResearchLesson,
  writeResearchLessons,
};
