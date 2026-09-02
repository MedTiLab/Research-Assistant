import crypto from 'crypto';
import express from 'express';

import { db } from '../database/db.js';
import { broadcastWorkbenchUpdate } from '../utils/workbench-websocket.js';

const router = express.Router();

const THESIS_STATUSES = new Set(['planning', 'writing', 'review', 'submitted', 'completed']);
const CHAPTER_STATUSES = new Set(['not_started', 'drafting', 'review', 'done']);
const MILESTONE_STATUSES = new Set(['pending', 'in_progress', 'done']);
const MANUSCRIPT_STATUSES = new Set(['drafting', 'internal_review', 'ready', 'submitted', 'revision', 'published']);
const SUBMISSION_STATUSES = new Set([
  'draft', 'journal_selected', 'presubmission_check', 'submitted', 'with_editor', 'under_review',
  'minor_revision', 'major_revision', 'rejected', 'resubmitted', 'accepted', 'proof', 'published',
]);
const DOCUMENT_KINDS = new Set([
  'manuscript', 'cover_letter', 'highlights', 'figures', 'supplementary', 'reviewer_response',
  'revision_checklist', 'submission_emails', 'journal_requirements',
]);
const ACTIVE_SUBMISSION_STATUSES = [
  'journal_selected', 'presubmission_check', 'submitted', 'with_editor', 'under_review',
  'minor_revision', 'major_revision', 'resubmitted', 'proof',
];
const DEFAULT_DOCUMENTS = [
  ['manuscript', '稿件正文'], ['cover_letter', 'Cover Letter'], ['figures', '图表'],
  ['supplementary', '补充材料'], ['submission_emails', '投稿邮件'], ['journal_requirements', '期刊要求'],
].map(([kind, label]) => ({ kind, label, ready: false }));

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function localDate(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function notify(req, scope) {
  if (req.app.locals.wss) broadcastWorkbenchUpdate(req.app.locals.wss, { userId: req.user.id, scope });
}

function fail(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 400;
  return res.status(status).json({ error: error?.message || String(error) });
}

function assertObject(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('A JSON object is required');
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length) throw new Error(`Unknown field(s): ${unknown.join(', ')}`);
}

function text(value, field, { required = false, max = 8000, nullable = true } = {}) {
  if (value === undefined) {
    if (required) throw new Error(`${field} is required`);
    return undefined;
  }
  if (value === null && nullable && !required) return null;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const result = value.trim();
  if (required && !result) throw new Error(`${field} is required`);
  if (result.length > max) throw new Error(`${field} must be at most ${max} characters`);
  return result || (nullable ? null : '');
}

function enumValue(value, field, allowed, fallback) {
  if (value === undefined) return fallback;
  if (!allowed.has(value)) throw new Error(`Invalid ${field}`);
  return value;
}

function integer(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback } = {}) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${field} must be an integer between ${min} and ${max}`);
  return value;
}

function boolean(value, field, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean`);
  return value;
}

function dateOnly(value, field, { required = false } = {}) {
  if (value === undefined) {
    if (required) throw new Error(`${field} is required`);
    return undefined;
  }
  if (value === null && !required) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} must be YYYY-MM-DD`);
  return value;
}

function isoDateTime(value, field) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const parsed = typeof value === 'string' ? new Date(value) : new Date(NaN);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be an ISO date and time`);
  return parsed.toISOString();
}

function projectIdForUser(userId, value) {
  const projectId = text(value, 'projectId', { max: 200 });
  if (!projectId) return projectId;
  const project = db.prepare('SELECT id FROM projects WHERE id = ? AND (user_id = ? OR user_id IS NULL)').get(projectId, userId);
  if (!project) {
    const error = new Error('Project not found');
    error.status = 404;
    throw error;
  }
  return projectId;
}

function owned(table, userId, recordId) {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`).get(recordId, userId) || null;
}

function assertOwned(table, userId, recordId, label) {
  const row = owned(table, userId, recordId);
  if (!row) {
    const error = new Error(`${label} not found`);
    error.status = 404;
    throw error;
  }
  return row;
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function mapChapter(row) {
  return {
    id: row.id, thesisId: row.thesis_id, title: row.title, status: row.status,
    completion: Number(row.completion), orderIndex: Number(row.order_index), notes: row.notes || undefined,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapMilestone(row) {
  return {
    id: row.id, thesisId: row.thesis_id, title: row.title, dueDate: row.due_date || undefined,
    status: row.status, completedAt: row.completed_at || undefined, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapThesisLog(row) {
  return {
    id: row.id, thesisId: row.thesis_id, date: row.date, minutes: Number(row.minutes), words: Number(row.words),
    note: row.note || undefined, createdAt: row.created_at,
  };
}

function mapThesis(row, { detail = false } = {}) {
  const thesis = {
    id: row.id, projectId: row.project_id || undefined, title: row.title, degree: row.degree,
    targetDate: row.target_date || undefined, status: row.status, completion: Number(row.completion),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
  if (!detail) return thesis;
  thesis.chapters = db.prepare('SELECT * FROM research_thesis_chapters WHERE thesis_id = ? ORDER BY order_index, created_at').all(row.id).map(mapChapter);
  thesis.milestones = db.prepare('SELECT * FROM research_thesis_milestones WHERE thesis_id = ? ORDER BY status = \'done\', due_date IS NULL, due_date, created_at').all(row.id).map(mapMilestone);
  thesis.logs = db.prepare('SELECT * FROM research_thesis_logs WHERE thesis_id = ? ORDER BY date DESC, created_at DESC LIMIT 100').all(row.id).map(mapThesisLog);
  return thesis;
}

function documentsValue(value) {
  if (value === undefined) return DEFAULT_DOCUMENTS;
  if (!Array.isArray(value) || value.length > 30) throw new Error('documents must be an array with at most 30 items');
  return value.map((item) => {
    assertObject(item, new Set(['kind', 'label', 'ready', 'artifactRef']));
    const kind = enumValue(item.kind, 'documents.kind', DOCUMENT_KINDS);
    if (!kind) throw new Error('documents.kind is required');
    return {
      kind,
      label: text(item.label, 'documents.label', { required: true, max: 100 }),
      ready: boolean(item.ready, 'documents.ready', false),
      ...(item.artifactRef ? { artifactRef: text(item.artifactRef, 'documents.artifactRef', { max: 500 }) } : {}),
    };
  });
}

function mapManuscript(row) {
  return {
    id: row.id, projectId: row.project_id || undefined, title: row.title, shortTitle: row.short_title || undefined,
    status: row.status, targetJournal: row.target_journal || undefined, completion: Number(row.completion),
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapSubmission(row) {
  return {
    id: row.id, manuscriptId: row.manuscript_id, projectId: row.project_id || undefined, journal: row.journal,
    status: row.status, previousStatus: row.previous_status || undefined, submittedAt: row.submitted_at || undefined,
    statusChangedAt: row.status_changed_at || undefined, deadline: row.deadline || undefined,
    trackingCode: row.tracking_code || undefined, nextAction: row.next_action || undefined,
    documents: parseJson(row.documents_json, []), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapAttendance(row, nowMs) {
  const start = new Date(row.started_at).getTime();
  const end = row.ended_at ? new Date(row.ended_at).getTime() : nowMs;
  return {
    id: row.id,
    date: row.date,
    startedAt: row.started_at,
    endedAt: row.ended_at || undefined,
    minutes: Math.max(0, Math.round((end - start) / 60000)),
    open: !row.ended_at,
  };
}

function mapReview(row) {
  if (!row) return null;
  return {
    id: row.id, date: row.date, accomplishments: row.accomplishments, obstacles: row.obstacles,
    insights: row.insights, tomorrowPriorities: parseJson(row.tomorrow_priorities_json, []),
    mood: row.mood == null ? undefined : Number(row.mood), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

router.get('/theses', (req, res) => {
  try {
    const theses = db.prepare('SELECT * FROM research_theses WHERE user_id = ? ORDER BY updated_at DESC').all(req.user.id).map(mapThesis);
    return res.json({ theses });
  } catch (error) { console.error('[ERROR] List theses:', error); return fail(res, error); }
});

router.get('/theses/:id', (req, res) => {
  try { return res.json({ thesis: mapThesis(assertOwned('research_theses', req.user.id, req.params.id, 'Thesis'), { detail: true }) }); }
  catch (error) { console.error('[ERROR] Get thesis:', error); return fail(res, error); }
});

router.post('/theses', (req, res) => {
  try {
    assertObject(req.body, new Set(['title', 'degree', 'targetDate', 'status', 'completion', 'projectId']));
    const recordId = id('thesis');
    const timestamp = nowIso();
    const values = {
      title: text(req.body.title, 'title', { required: true, max: 300 }),
      degree: text(req.body.degree, 'degree', { max: 50 }) || '博士',
      targetDate: dateOnly(req.body.targetDate, 'targetDate'),
      status: enumValue(req.body.status, 'status', THESIS_STATUSES, 'planning'),
      completion: integer(req.body.completion, 'completion', { min: 0, max: 100, fallback: 0 }),
      projectId: projectIdForUser(req.user.id, req.body.projectId),
    };
    db.prepare(`INSERT INTO research_theses (id, user_id, project_id, title, degree, target_date, status, completion, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(recordId, req.user.id, values.projectId, values.title, values.degree, values.targetDate, values.status, values.completion, timestamp, timestamp);
    notify(req, 'thesis');
    return res.status(201).json({ thesis: mapThesis(owned('research_theses', req.user.id, recordId), { detail: true }) });
  } catch (error) { console.error('[ERROR] Create thesis:', error); return fail(res, error); }
});

router.patch('/theses/:id', (req, res) => {
  try {
    assertOwned('research_theses', req.user.id, req.params.id, 'Thesis');
    assertObject(req.body, new Set(['title', 'degree', 'targetDate', 'status', 'completion', 'projectId']));
    const fields = [];
    const values = [];
    const add = (field, value) => { if (value !== undefined) { fields.push(`${field} = ?`); values.push(value); } };
    add('title', text(req.body.title, 'title', { required: req.body.title !== undefined, max: 300 }));
    add('degree', text(req.body.degree, 'degree', { required: req.body.degree !== undefined, max: 50 }));
    add('target_date', dateOnly(req.body.targetDate, 'targetDate'));
    add('status', enumValue(req.body.status, 'status', THESIS_STATUSES));
    add('completion', integer(req.body.completion, 'completion', { min: 0, max: 100 }));
    add('project_id', req.body.projectId === undefined ? undefined : projectIdForUser(req.user.id, req.body.projectId));
    if (!fields.length) throw new Error('At least one field is required');
    fields.push('updated_at = ?'); values.push(nowIso(), req.params.id, req.user.id);
    db.prepare(`UPDATE research_theses SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
    notify(req, 'thesis');
    return res.json({ thesis: mapThesis(owned('research_theses', req.user.id, req.params.id), { detail: true }) });
  } catch (error) { console.error('[ERROR] Update thesis:', error); return fail(res, error); }
});

router.post('/theses/:id/chapters', (req, res) => {
  try {
    assertOwned('research_theses', req.user.id, req.params.id, 'Thesis');
    assertObject(req.body, new Set(['title', 'status', 'completion', 'orderIndex', 'notes']));
    const recordId = id('chapter'); const timestamp = nowIso();
    db.prepare(`INSERT INTO research_thesis_chapters (id, thesis_id, user_id, title, status, completion, order_index, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      recordId, req.params.id, req.user.id, text(req.body.title, 'title', { required: true, max: 300 }),
      enumValue(req.body.status, 'status', CHAPTER_STATUSES, 'not_started'), integer(req.body.completion, 'completion', { min: 0, max: 100, fallback: 0 }),
      integer(req.body.orderIndex, 'orderIndex', { min: 0, fallback: 0 }), text(req.body.notes, 'notes', { max: 8000 }), timestamp, timestamp,
    );
    notify(req, 'thesis');
    return res.status(201).json({ chapter: mapChapter(owned('research_thesis_chapters', req.user.id, recordId)) });
  } catch (error) { console.error('[ERROR] Create thesis chapter:', error); return fail(res, error); }
});

router.patch('/thesis-chapters/:id', (req, res) => {
  try {
    assertOwned('research_thesis_chapters', req.user.id, req.params.id, 'Chapter');
    assertObject(req.body, new Set(['title', 'status', 'completion', 'orderIndex', 'notes']));
    const fields = []; const values = [];
    const add = (field, value) => { if (value !== undefined) { fields.push(`${field} = ?`); values.push(value); } };
    add('title', text(req.body.title, 'title', { required: req.body.title !== undefined, max: 300 }));
    add('status', enumValue(req.body.status, 'status', CHAPTER_STATUSES));
    add('completion', integer(req.body.completion, 'completion', { min: 0, max: 100 }));
    add('order_index', integer(req.body.orderIndex, 'orderIndex', { min: 0 }));
    add('notes', text(req.body.notes, 'notes', { max: 8000 }));
    if (!fields.length) throw new Error('At least one field is required');
    fields.push('updated_at = ?'); values.push(nowIso(), req.params.id, req.user.id);
    db.prepare(`UPDATE research_thesis_chapters SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
    notify(req, 'thesis');
    return res.json({ chapter: mapChapter(owned('research_thesis_chapters', req.user.id, req.params.id)) });
  } catch (error) { console.error('[ERROR] Update thesis chapter:', error); return fail(res, error); }
});

router.post('/theses/:id/milestones', (req, res) => {
  try {
    assertOwned('research_theses', req.user.id, req.params.id, 'Thesis');
    assertObject(req.body, new Set(['title', 'dueDate', 'status']));
    const recordId = id('milestone'); const timestamp = nowIso();
    const status = enumValue(req.body.status, 'status', MILESTONE_STATUSES, 'pending');
    db.prepare(`INSERT INTO research_thesis_milestones (id, thesis_id, user_id, title, due_date, status, completed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      recordId, req.params.id, req.user.id, text(req.body.title, 'title', { required: true, max: 300 }),
      dateOnly(req.body.dueDate, 'dueDate'), status, status === 'done' ? timestamp : null, timestamp, timestamp,
    );
    notify(req, 'thesis');
    return res.status(201).json({ milestone: mapMilestone(owned('research_thesis_milestones', req.user.id, recordId)) });
  } catch (error) { console.error('[ERROR] Create thesis milestone:', error); return fail(res, error); }
});

router.patch('/thesis-milestones/:id', (req, res) => {
  try {
    const existing = assertOwned('research_thesis_milestones', req.user.id, req.params.id, 'Milestone');
    assertObject(req.body, new Set(['title', 'dueDate', 'status']));
    const fields = []; const values = [];
    const add = (field, value) => { if (value !== undefined) { fields.push(`${field} = ?`); values.push(value); } };
    add('title', text(req.body.title, 'title', { required: req.body.title !== undefined, max: 300 }));
    add('due_date', dateOnly(req.body.dueDate, 'dueDate'));
    const status = enumValue(req.body.status, 'status', MILESTONE_STATUSES);
    add('status', status);
    if (status !== undefined) add('completed_at', status === 'done' ? (existing.completed_at || nowIso()) : null);
    if (!fields.length) throw new Error('At least one field is required');
    fields.push('updated_at = ?'); values.push(nowIso(), req.params.id, req.user.id);
    db.prepare(`UPDATE research_thesis_milestones SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`).run(...values);
    notify(req, 'thesis');
    return res.json({ milestone: mapMilestone(owned('research_thesis_milestones', req.user.id, req.params.id)) });
  } catch (error) { console.error('[ERROR] Update thesis milestone:', error); return fail(res, error); }
});

router.post('/theses/:id/logs', (req, res) => {
  try {
    assertOwned('research_theses', req.user.id, req.params.id, 'Thesis');
    assertObject(req.body, new Set(['date', 'minutes', 'words', 'note']));
    const recordId = id('thesislog');
    db.prepare(`INSERT INTO research_thesis_logs (id, thesis_id, user_id, date, minutes, words, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      recordId, req.params.id, req.user.id, dateOnly(req.body.date, 'date', { required: true }),
      integer(req.body.minutes, 'minutes', { min: 0, fallback: 0 }), integer(req.body.words, 'words', { min: 0, fallback: 0 }),
      text(req.body.note, 'note', { max: 4000 }), nowIso(),
    );
    notify(req, 'thesis');
    return res.status(201).json({ log: mapThesisLog(owned('research_thesis_logs', req.user.id, recordId)) });
  } catch (error) { console.error('[ERROR] Create thesis log:', error); return fail(res, error); }
});

router.get('/submissions', (req, res) => {
  try {
    const status = req.query.status ? enumValue(req.query.status, 'status', SUBMISSION_STATUSES) : undefined;
    const rows = status
      ? db.prepare('SELECT * FROM research_submissions WHERE user_id = ? AND status = ? ORDER BY updated_at DESC').all(req.user.id, status)
      : db.prepare('SELECT * FROM research_submissions WHERE user_id = ? ORDER BY updated_at DESC').all(req.user.id);
    const manuscriptRows = db.prepare('SELECT * FROM research_manuscripts WHERE user_id = ? ORDER BY updated_at DESC').all(req.user.id);
    return res.json({ submissions: rows.map(mapSubmission), manuscripts: manuscriptRows.map(mapManuscript) });
  } catch (error) { console.error('[ERROR] List submissions:', error); return fail(res, error); }
});

router.get('/submissions/:id', (req, res) => {
  try {
    const submission = assertOwned('research_submissions', req.user.id, req.params.id, 'Submission');
    const manuscript = assertOwned('research_manuscripts', req.user.id, submission.manuscript_id, 'Manuscript');
    return res.json({ submission: mapSubmission(submission), manuscript: mapManuscript(manuscript) });
  } catch (error) { console.error('[ERROR] Get submission:', error); return fail(res, error); }
});

router.post('/submissions', (req, res) => {
  try {
    assertObject(req.body, new Set(['title', 'shortTitle', 'projectId', 'journal', 'status', 'deadline', 'trackingCode', 'nextAction', 'documents', 'completion']));
    const timestamp = nowIso(); const manuscriptId = id('manuscript'); const submissionId = id('submission');
    const projectId = projectIdForUser(req.user.id, req.body.projectId);
    const journal = text(req.body.journal, 'journal', { required: true, max: 300 });
    const status = enumValue(req.body.status, 'status', SUBMISSION_STATUSES, 'journal_selected');
    const manuscriptStatus = ['submitted', 'with_editor', 'under_review', 'resubmitted', 'accepted', 'proof', 'published'].includes(status)
      ? (status === 'published' ? 'published' : 'submitted')
      : ['minor_revision', 'major_revision'].includes(status) ? 'revision' : 'ready';
    const transaction = db.transaction(() => {
      db.prepare(`INSERT INTO research_manuscripts (id, user_id, project_id, title, short_title, status, target_journal, completion, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        manuscriptId, req.user.id, projectId, text(req.body.title, 'title', { required: true, max: 500 }),
        text(req.body.shortTitle, 'shortTitle', { max: 150 }), manuscriptStatus, journal,
        integer(req.body.completion, 'completion', { min: 0, max: 100, fallback: manuscriptStatus === 'ready' ? 100 : 0 }), timestamp, timestamp,
      );
      db.prepare(`INSERT INTO research_submissions (id, user_id, manuscript_id, project_id, journal, status, submitted_at, status_changed_at, deadline, tracking_code, next_action, documents_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        submissionId, req.user.id, manuscriptId, projectId, journal, status,
        ['submitted', 'with_editor', 'under_review', 'resubmitted', 'accepted', 'proof', 'published'].includes(status) ? timestamp : null,
        timestamp, dateOnly(req.body.deadline, 'deadline'), text(req.body.trackingCode, 'trackingCode', { max: 200 }),
        text(req.body.nextAction, 'nextAction', { max: 4000 }), JSON.stringify(documentsValue(req.body.documents)), timestamp, timestamp,
      );
    });
    transaction(); notify(req, 'submission');
    return res.status(201).json({
      submission: mapSubmission(owned('research_submissions', req.user.id, submissionId)),
      manuscript: mapManuscript(owned('research_manuscripts', req.user.id, manuscriptId)),
    });
  } catch (error) { console.error('[ERROR] Create submission:', error); return fail(res, error); }
});

router.patch('/submissions/:id', (req, res) => {
  try {
    const existing = assertOwned('research_submissions', req.user.id, req.params.id, 'Submission');
    assertObject(req.body, new Set(['title', 'shortTitle', 'journal', 'status', 'deadline', 'trackingCode', 'nextAction', 'documents', 'completion']));
    const timestamp = nowIso(); const submissionFields = []; const submissionValues = []; const manuscriptFields = []; const manuscriptValues = [];
    const addSubmission = (field, value) => { if (value !== undefined) { submissionFields.push(`${field} = ?`); submissionValues.push(value); } };
    const addManuscript = (field, value) => { if (value !== undefined) { manuscriptFields.push(`${field} = ?`); manuscriptValues.push(value); } };
    addManuscript('title', text(req.body.title, 'title', { required: req.body.title !== undefined, max: 500 }));
    addManuscript('short_title', text(req.body.shortTitle, 'shortTitle', { max: 150 }));
    addManuscript('completion', integer(req.body.completion, 'completion', { min: 0, max: 100 }));
    const journal = text(req.body.journal, 'journal', { required: req.body.journal !== undefined, max: 300 });
    addSubmission('journal', journal); addManuscript('target_journal', journal);
    addSubmission('deadline', dateOnly(req.body.deadline, 'deadline'));
    addSubmission('tracking_code', text(req.body.trackingCode, 'trackingCode', { max: 200 }));
    addSubmission('next_action', text(req.body.nextAction, 'nextAction', { max: 4000 }));
    addSubmission('documents_json', req.body.documents === undefined ? undefined : JSON.stringify(documentsValue(req.body.documents)));
    const status = enumValue(req.body.status, 'status', SUBMISSION_STATUSES);
    if (status !== undefined) {
      addSubmission('status', status);
      if (status !== existing.status) {
        addSubmission('previous_status', existing.status); addSubmission('status_changed_at', timestamp);
      }
      if (!existing.submitted_at && ['submitted', 'with_editor', 'under_review', 'resubmitted', 'accepted', 'proof', 'published'].includes(status)) addSubmission('submitted_at', timestamp);
      if (status === 'published') addManuscript('status', 'published');
      else if (['minor_revision', 'major_revision'].includes(status)) addManuscript('status', 'revision');
      else if (['submitted', 'with_editor', 'under_review', 'resubmitted', 'accepted', 'proof'].includes(status)) addManuscript('status', 'submitted');
    }
    if (!submissionFields.length && !manuscriptFields.length) throw new Error('At least one field is required');
    const transaction = db.transaction(() => {
      if (submissionFields.length) {
        submissionFields.push('updated_at = ?'); submissionValues.push(timestamp, req.params.id, req.user.id);
        db.prepare(`UPDATE research_submissions SET ${submissionFields.join(', ')} WHERE id = ? AND user_id = ?`).run(...submissionValues);
      }
      if (manuscriptFields.length) {
        manuscriptFields.push('updated_at = ?'); manuscriptValues.push(timestamp, existing.manuscript_id, req.user.id);
        db.prepare(`UPDATE research_manuscripts SET ${manuscriptFields.join(', ')} WHERE id = ? AND user_id = ?`).run(...manuscriptValues);
      }
    });
    transaction(); notify(req, 'submission');
    return res.json({
      submission: mapSubmission(owned('research_submissions', req.user.id, req.params.id)),
      manuscript: mapManuscript(owned('research_manuscripts', req.user.id, existing.manuscript_id)),
    });
  } catch (error) { console.error('[ERROR] Update submission:', error); return fail(res, error); }
});

router.get('/daily-reviews', (req, res) => {
  try {
    const date = dateOnly(req.query.date, 'date');
    if (date) return res.json({ review: mapReview(db.prepare('SELECT * FROM workbench_daily_reviews WHERE user_id = ? AND date = ?').get(req.user.id, date)) });
    const limit = integer(req.query.limit ? Number(req.query.limit) : undefined, 'limit', { min: 1, max: 100, fallback: 30 });
    return res.json({ reviews: db.prepare('SELECT * FROM workbench_daily_reviews WHERE user_id = ? ORDER BY date DESC LIMIT ?').all(req.user.id, limit).map(mapReview) });
  } catch (error) { console.error('[ERROR] List daily reviews:', error); return fail(res, error); }
});

router.put('/daily-reviews/:date', (req, res) => {
  try {
    const date = dateOnly(req.params.date, 'date', { required: true });
    assertObject(req.body, new Set(['accomplishments', 'obstacles', 'insights', 'tomorrowPriorities', 'mood']));
    const priorities = req.body.tomorrowPriorities === undefined ? [] : req.body.tomorrowPriorities;
    if (!Array.isArray(priorities) || priorities.length > 10) throw new Error('tomorrowPriorities must contain at most 10 items');
    const safePriorities = priorities.map((item) => text(item, 'tomorrowPriorities item', { required: true, max: 500 }));
    const timestamp = nowIso();
    db.prepare(`INSERT INTO workbench_daily_reviews (id, user_id, date, accomplishments, obstacles, insights, tomorrow_priorities_json, mood, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, date) DO UPDATE SET accomplishments = excluded.accomplishments, obstacles = excluded.obstacles,
        insights = excluded.insights, tomorrow_priorities_json = excluded.tomorrow_priorities_json, mood = excluded.mood, updated_at = excluded.updated_at`).run(
      id('review'), req.user.id, date, text(req.body.accomplishments, 'accomplishments', { max: 8000, nullable: false }) || '',
      text(req.body.obstacles, 'obstacles', { max: 8000, nullable: false }) || '', text(req.body.insights, 'insights', { max: 8000, nullable: false }) || '',
      JSON.stringify(safePriorities), integer(req.body.mood, 'mood', { min: 1, max: 5 }), timestamp, timestamp,
    );
    notify(req, 'review');
    return res.json({ review: mapReview(db.prepare('SELECT * FROM workbench_daily_reviews WHERE user_id = ? AND date = ?').get(req.user.id, date)) });
  } catch (error) { console.error('[ERROR] Save daily review:', error); return fail(res, error); }
});

router.get('/habits', (req, res) => {
  try {
    const date = dateOnly(req.query.date, 'date') || localDate();
    const rows = db.prepare(`SELECT h.*, e.completed, e.value, e.updated_at AS entry_updated_at
      FROM workbench_habits h LEFT JOIN workbench_habit_entries e ON e.habit_id = h.id AND e.date = ?
      WHERE h.user_id = ? AND h.enabled = 1 ORDER BY h.created_at`).all(date, req.user.id);
    return res.json({ date, habits: rows.map((row) => ({
      id: row.id, title: row.title, enabled: Boolean(row.enabled), completed: Boolean(row.completed),
      value: row.value || undefined, updatedAt: row.entry_updated_at || row.updated_at,
    })) });
  } catch (error) { console.error('[ERROR] List habits:', error); return fail(res, error); }
});

router.post('/habits', (req, res) => {
  try {
    assertObject(req.body, new Set(['title'])); const recordId = id('habit'); const timestamp = nowIso();
    db.prepare('INSERT INTO workbench_habits (id, user_id, title, enabled, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)')
      .run(recordId, req.user.id, text(req.body.title, 'title', { required: true, max: 100 }), timestamp, timestamp);
    notify(req, 'habit');
    return res.status(201).json({ habit: { id: recordId, title: req.body.title.trim(), enabled: true, completed: false } });
  } catch (error) { console.error('[ERROR] Create habit:', error); return fail(res, error); }
});

router.put('/habits/:id/entries/:date', (req, res) => {
  try {
    const habit = assertOwned('workbench_habits', req.user.id, req.params.id, 'Habit');
    const date = dateOnly(req.params.date, 'date', { required: true });
    assertObject(req.body, new Set(['completed', 'value'])); const timestamp = nowIso();
    const completed = boolean(req.body.completed, 'completed', false);
    const value = text(req.body.value, 'value', { max: 500 });
    db.prepare(`INSERT INTO workbench_habit_entries (id, habit_id, user_id, date, completed, value, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(habit_id, date) DO UPDATE SET completed = excluded.completed, value = excluded.value, updated_at = excluded.updated_at`)
      .run(id('habitentry'), habit.id, req.user.id, date, completed ? 1 : 0, value, timestamp);
    notify(req, 'habit');
    return res.json({ entry: { habitId: habit.id, date, completed, value: value || undefined, updatedAt: timestamp } });
  } catch (error) { console.error('[ERROR] Save habit entry:', error); return fail(res, error); }
});

router.post('/attendance/start', (req, res) => {
  try {
    assertObject(req.body, new Set(['startedAt']));
    const open = db.prepare('SELECT * FROM workbench_attendance_logs WHERE user_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get(req.user.id);
    if (open) { const error = new Error('A work session is already open'); error.status = 409; throw error; }
    const startedAt = isoDateTime(req.body.startedAt, 'startedAt') || nowIso(); const recordId = id('attendance');
    db.prepare('INSERT INTO workbench_attendance_logs (id, user_id, date, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(recordId, req.user.id, localDate(new Date(startedAt)), startedAt, nowIso(), nowIso());
    notify(req, 'today');
    return res.status(201).json({ attendance: { id: recordId, date: localDate(new Date(startedAt)), startedAt, open: true } });
  } catch (error) { console.error('[ERROR] Start attendance:', error); return fail(res, error); }
});

router.post('/attendance/end', (req, res) => {
  try {
    assertObject(req.body, new Set(['endedAt']));
    const open = db.prepare('SELECT * FROM workbench_attendance_logs WHERE user_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1').get(req.user.id);
    if (!open) { const error = new Error('No open work session'); error.status = 409; throw error; }
    const endedAt = isoDateTime(req.body.endedAt, 'endedAt') || nowIso();
    if (new Date(endedAt).getTime() < new Date(open.started_at).getTime()) throw new Error('endedAt must not be before startedAt');
    db.prepare('UPDATE workbench_attendance_logs SET ended_at = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(endedAt, nowIso(), open.id, req.user.id);
    notify(req, 'today');
    return res.json({ attendance: { id: open.id, date: open.date, startedAt: open.started_at, endedAt, open: false } });
  } catch (error) { console.error('[ERROR] End attendance:', error); return fail(res, error); }
});

router.get('/attendance', (req, res) => {
  try {
    const date = dateOnly(req.query.date, 'date') || localDate();
    const nowMs = Date.now();
    const rows = db.prepare('SELECT * FROM workbench_attendance_logs WHERE user_id = ? AND date = ? ORDER BY started_at').all(req.user.id, date);
    return res.json({ date, attendance: rows.map((row) => mapAttendance(row, nowMs)) });
  } catch (error) { console.error('[ERROR] List attendance:', error); return fail(res, error); }
});

router.delete('/attendance', (req, res) => {
  try {
    const date = dateOnly(req.query.date, 'date') || localDate();
    const result = db.prepare('DELETE FROM workbench_attendance_logs WHERE user_id = ? AND date = ?').run(req.user.id, date);
    notify(req, 'today');
    return res.json({ date, deleted: result.changes });
  } catch (error) { console.error('[ERROR] Clear attendance:', error); return fail(res, error); }
});

router.delete('/attendance/:id', (req, res) => {
  try {
    assertOwned('workbench_attendance_logs', req.user.id, req.params.id, 'Attendance');
    db.prepare('DELETE FROM workbench_attendance_logs WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    notify(req, 'today');
    return res.json({ deleted: true, id: req.params.id });
  } catch (error) { console.error('[ERROR] Delete attendance:', error); return fail(res, error); }
});

function mapFocusSession(row) {
  return {
    id: row.id,
    date: row.date,
    minutes: Number(row.minutes) || 0,
    taskTitle: row.task_title || undefined,
    createdAt: row.created_at,
    startedAt: row.started_at || undefined,
    endedAt: row.ended_at || undefined,
  };
}

router.get('/focus-sessions', (req, res) => {
  try {
    const date = dateOnly(req.query.date, 'date') || localDate();
    const rows = db.prepare('SELECT * FROM workbench_focus_sessions WHERE user_id = ? AND date = ? ORDER BY created_at').all(req.user.id, date);
    return res.json({ date, focusSessions: rows.map(mapFocusSession) });
  } catch (error) { console.error('[ERROR] List focus sessions:', error); return fail(res, error); }
});

router.post('/focus-sessions', (req, res) => {
  try {
    assertObject(req.body, new Set(['date', 'minutes', 'taskTitle']));
    const recordId = id('focus'); const date = dateOnly(req.body.date, 'date') || localDate();
    const minutes = integer(req.body.minutes, 'minutes', { min: 1, max: 1440 });
    const timestamp = nowIso();
    db.prepare('INSERT INTO workbench_focus_sessions (id, user_id, date, task_title, minutes, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(recordId, req.user.id, date, text(req.body.taskTitle, 'taskTitle', { max: 500 }), minutes, timestamp);
    notify(req, 'today');
    return res.status(201).json({ focusSession: { id: recordId, date, minutes, taskTitle: req.body.taskTitle?.trim() || undefined, createdAt: timestamp } });
  } catch (error) { console.error('[ERROR] Log focus session:', error); return fail(res, error); }
});

router.delete('/focus-sessions', (req, res) => {
  try {
    const date = dateOnly(req.query.date, 'date') || localDate();
    const result = db.prepare('DELETE FROM workbench_focus_sessions WHERE user_id = ? AND date = ?').run(req.user.id, date);
    notify(req, 'today');
    return res.json({ date, deleted: result.changes });
  } catch (error) { console.error('[ERROR] Clear focus sessions:', error); return fail(res, error); }
});

router.delete('/focus-sessions/:id', (req, res) => {
  try {
    assertOwned('workbench_focus_sessions', req.user.id, req.params.id, 'Focus session');
    db.prepare('DELETE FROM workbench_focus_sessions WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    notify(req, 'today');
    return res.json({ deleted: true, id: req.params.id });
  } catch (error) { console.error('[ERROR] Delete focus session:', error); return fail(res, error); }
});

router.get('/today-status', (req, res) => {
  try {
    const date = dateOnly(req.query.date, 'date') || localDate(); const currentTime = Date.now();
    const attendance = db.prepare('SELECT * FROM workbench_attendance_logs WHERE user_id = ? AND date = ? ORDER BY started_at').all(req.user.id, date);
    const workMinutes = attendance.reduce((sum, row) => {
      const start = new Date(row.started_at).getTime(); const end = row.ended_at ? new Date(row.ended_at).getTime() : currentTime;
      return sum + Math.max(0, Math.round((end - start) / 60000));
    }, 0);
    const focusMinutes = Number(db.prepare('SELECT COALESCE(SUM(minutes), 0) AS total FROM workbench_focus_sessions WHERE user_id = ? AND date = ?').get(req.user.id, date).total);
    const habit = db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN e.completed = 1 THEN 1 ELSE 0 END), 0) AS done
      FROM workbench_habits h LEFT JOIN workbench_habit_entries e ON e.habit_id = h.id AND e.date = ?
      WHERE h.user_id = ? AND h.enabled = 1`).get(date, req.user.id);
    const review = db.prepare('SELECT * FROM workbench_daily_reviews WHERE user_id = ? AND date = ?').get(req.user.id, date);
    const currentAction = db.prepare(`SELECT content, due_date, status FROM meeting_action_items
      WHERE user_id = ? AND status IN ('open', 'in_progress') ORDER BY status = 'in_progress' DESC, due_date IS NULL, due_date, created_at LIMIT 1`).get(req.user.id);
    const openAttendance = attendance.find((row) => !row.ended_at);
    const activeSubmissions = Number(db.prepare(`SELECT COUNT(*) AS count FROM research_submissions WHERE user_id = ? AND status IN (${ACTIVE_SUBMISSION_STATUSES.map(() => '?').join(', ')})`).get(req.user.id, ...ACTIVE_SUBMISSION_STATUSES).count);
    const todayTodos = Number(db.prepare('SELECT COUNT(*) AS count FROM workbench_calendar_todos WHERE user_id = ? AND date = ? AND completed = 0').get(req.user.id, date).count);
    return res.json({ status: {
      date, working: Boolean(openAttendance), currentWorkStartedAt: openAttendance?.started_at,
      workMinutes, attendanceCount: attendance.length, focusMinutes,
      currentTask: currentAction ? { title: currentAction.content, dueDate: currentAction.due_date || undefined, status: currentAction.status } : null,
      todayTodoCount: todayTodos, habitCompleted: Number(habit.done), habitTotal: Number(habit.total),
      habitCompletion: Number(habit.total) ? Math.round((Number(habit.done) / Number(habit.total)) * 100) : 0,
      reviewCompleted: Boolean(review), review: mapReview(review), activeSubmissionCount: activeSubmissions,
    } });
  } catch (error) { console.error('[ERROR] Get today status:', error); return fail(res, error); }
});

export default router;
