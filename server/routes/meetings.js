import crypto from 'crypto';
import express from 'express';
import multer from 'multer';
import { db } from '../database/db.js';
import { createMeetingTranscriptionService } from '../services/meetingTranscription.js';
import { addTaskRecord, rollbackAddedTask } from './taskmaster.js';
import { broadcastTaskMasterTasksUpdate } from '../utils/taskmaster-websocket.js';
import { broadcastWorkbenchUpdate } from '../utils/workbench-websocket.js';

const router = express.Router();
const recordingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 8 },
});
const meetingTranscription = createMeetingTranscriptionService({ database: db });
const TRANSCRIPTION_CONSENT_KEY = 'meetingTranscription.openaiConsent';

const MEETING_TYPES = new Set(['group', 'one_on_one', 'journal_club', 'progress']);
const MEETING_ROLES = new Set(['presenter', 'attendee']);
const MEETING_STATUSES = new Set(['upcoming', 'in_progress', 'done']);
const AGENDA_KINDS = new Set(['my_report', 'carryover_action', 'question_for_advisor', 'literature']);
const NOTE_TYPES = new Set(['feedback', 'decision', 'question', 'idea']);
const ACTION_STATUSES = new Set(['open', 'in_progress', 'done', 'dropped']);
const WORKBENCH_NOTE_KINDS = new Set(['inbox', 'daily_focus', 'daily_goal']);

function notifyWorkbench(req, scope, meetingId = null) {
  if (!req.app.locals.wss) return;
  broadcastWorkbenchUpdate(req.app.locals.wss, {
    userId: req.user.id,
    scope,
    meetingId,
  });
}

function apiId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function hasOnlyFields(value, allowedFields) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every((key) => allowedFields.has(key));
}

function requireObject(req, res, allowedFields) {
  if (!hasOnlyFields(req.body, allowedFields)) {
    const unknown = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
      ? Object.keys(req.body).filter((key) => !allowedFields.has(key))
      : [];
    res.status(400).json({
      error: unknown.length > 0 ? `Unknown field(s): ${unknown.join(', ')}` : 'A JSON object is required',
    });
    return false;
  }
  return true;
}

function textValue(value, field, { required = false, max = 4000 } = {}) {
  if (value === undefined) {
    if (required) throw new Error(`${field} is required`);
    return undefined;
  }
  if (value === null && !required) return null;
  if (typeof value !== 'string') throw new Error(`${field} must be a string`);
  const normalized = value.trim();
  if (required && !normalized) throw new Error(`${field} is required`);
  if (normalized.length > max) throw new Error(`${field} must be at most ${max} characters`);
  return normalized || null;
}

function enumValue(value, field, allowed, { required = false } = {}) {
  if (value === undefined) {
    if (required) throw new Error(`${field} is required`);
    return undefined;
  }
  if (!allowed.has(value)) throw new Error(`Invalid ${field}`);
  return value;
}

function isoValue(value, field, { required = false, dateOnly = false } = {}) {
  if (value === undefined) {
    if (required) throw new Error(`${field} is required`);
    return undefined;
  }
  if (value === null && !required) return null;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be an ISO date${dateOnly ? '' : ' and time'}`);
  if (dateOnly && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} must be an ISO date${dateOnly ? '' : ' and time'}`);
  return dateOnly ? value : parsed.toISOString();
}

function integerValue(value, field, { min = 0 } = {}) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < min) throw new Error(`${field} must be an integer >= ${min}`);
  return value;
}

function booleanValue(value, field) {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${field} must be a boolean`);
  return value ? 1 : 0;
}

function formIntegerValue(value, field, { min = 0 } = {}) {
  const normalized = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return integerValue(normalized, field, { min });
}

function meetingForUser(userId, meetingId) {
  return db.prepare('SELECT * FROM meetings WHERE id = ? AND user_id = ?').get(meetingId, userId) || null;
}

function projectForUser(userId, projectId) {
  if (!projectId) return null;
  return db.prepare(`
    SELECT id, display_name, path
    FROM projects
    WHERE id = ? AND (user_id = ? OR user_id IS NULL)
  `).get(projectId, userId) || null;
}

function assertProjectAccess(userId, projectId) {
  if (projectId && !projectForUser(userId, projectId)) {
    const error = new Error('Project not found');
    error.status = 404;
    throw error;
  }
}

function mapMeeting(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    meetingDate: row.meeting_date,
    meetingType: row.meeting_type,
    myRole: row.my_role,
    location: row.location || undefined,
    projectId: row.project_id || undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgenda(row) {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    kind: row.kind,
    title: row.title,
    detail: row.detail || undefined,
    sourceRef: row.source_ref || undefined,
    orderIndex: Number(row.order_index),
    done: Boolean(row.done),
  };
}

function mapNote(row) {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    speaker: row.speaker || undefined,
    content: row.content,
    noteType: row.note_type,
    sourceSegmentId: row.source_segment_id || undefined,
    promotedActionId: row.promoted_action_id || undefined,
    createdAt: row.created_at,
  };
}

function mapAction(row) {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    sourceNoteId: row.source_note_id || undefined,
    content: row.content,
    dueDate: row.due_date || undefined,
    status: row.status,
    owner: row.owner,
    taskId: row.task_id || undefined,
    projectId: row.project_id || undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at || undefined,
  };
}

function mapSegment(row) {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    segmentIndex: Number(row.segment_index),
    startMs: Number(row.start_ms),
    endMs: Number(row.end_ms),
    text: row.text,
    speaker: row.speaker || undefined,
    status: row.status,
    error: row.error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapReminder(row) {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    reminderKey: row.reminder_key,
    scheduledFor: row.scheduled_for,
    title: row.title,
    body: row.body,
    deliveredAt: row.delivered_at,
    readAt: row.read_at || undefined,
  };
}

function mapCalendarTodo(row) {
  return {
    id: row.id,
    title: row.title,
    date: row.date,
    completed: Boolean(row.completed),
    projectId: row.project_id || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWorkbenchNote(row) {
  return {
    id: row.id,
    kind: row.kind,
    content: row.content,
    day: row.day || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function meetingDetail(userId, meetingId) {
  const meeting = meetingForUser(userId, meetingId);
  if (!meeting) return null;
  const agenda = db.prepare(`
    SELECT * FROM meeting_agenda_items
    WHERE meeting_id = ? AND user_id = ?
    ORDER BY order_index, id
  `).all(meetingId, userId).map(mapAgenda);
  const notes = db.prepare(`
    SELECT * FROM meeting_notes
    WHERE meeting_id = ? AND user_id = ?
    ORDER BY created_at, id
  `).all(meetingId, userId).map(mapNote);
  const actions = db.prepare(`
    SELECT * FROM meeting_action_items
    WHERE meeting_id = ? AND user_id = ?
    ORDER BY created_at, id
  `).all(meetingId, userId).map(mapAction);
  const transcriptSegments = db.prepare(`
    SELECT * FROM meeting_transcript_segments
    WHERE meeting_id = ? AND user_id = ?
    ORDER BY segment_index
  `).all(meetingId, userId).map(mapSegment);
  return { ...mapMeeting(meeting), agenda, notes, actions, transcriptSegments };
}

function sendRouteError(res, error, context) {
  const status = Number(error?.status) || (error?.code?.startsWith('SQLITE_CONSTRAINT') ? 400 : 500);
  if (status >= 500) console.error(`[ERROR] ${context}:`, error?.message || error);
  return res.status(status).json({ error: status >= 500 ? 'Meeting operation failed' : error.message });
}

router.get('/snapshot', (req, res) => {
  try {
    const userId = req.user.id;
    const timestamp = nowIso();
    const meetingRows = db.prepare(`
      SELECT * FROM meetings
      WHERE user_id = ?
      ORDER BY
        CASE WHEN meeting_date >= ? THEN 0 ELSE 1 END,
        CASE WHEN meeting_date >= ? THEN meeting_date END ASC,
        CASE WHEN meeting_date < ? THEN meeting_date END DESC
      LIMIT 20
    `).all(userId, timestamp, timestamp, timestamp);
    const meetings = meetingRows.map((row) => {
      const agenda = db.prepare(`
        SELECT * FROM meeting_agenda_items
        WHERE meeting_id = ? AND user_id = ?
        ORDER BY order_index, id
      `).all(row.id, userId).map(mapAgenda);
      return { ...mapMeeting(row), agenda };
    });
    const openActions = db.prepare(`
      SELECT * FROM meeting_action_items
      WHERE user_id = ? AND status IN ('open', 'in_progress')
      ORDER BY due_date IS NULL, due_date ASC, created_at ASC
    `).all(userId).map(mapAction);
    const advisorNotes = db.prepare(`
      SELECT
        n.*,
        m.project_id AS meeting_project_id,
        a.status AS action_status,
        a.due_date AS action_due_date,
        a.project_id AS action_project_id
      FROM meeting_notes n
      JOIN meetings m ON m.id = n.meeting_id AND m.user_id = n.user_id
      LEFT JOIN meeting_action_items a
        ON a.id = n.promoted_action_id AND a.user_id = n.user_id
      WHERE n.user_id = ? AND n.note_type = 'feedback'
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT 50
    `).all(userId).map((row) => ({
      ...mapNote(row),
      projectId: row.action_project_id || row.meeting_project_id || undefined,
      actionStatus: row.action_status || undefined,
      actionDueDate: row.action_due_date || undefined,
    }));
    const counts = {
      overdueActions: Number(db.prepare(`
        SELECT COUNT(*) AS count FROM meeting_action_items
        WHERE user_id = ? AND status IN ('open', 'in_progress')
          AND due_date IS NOT NULL AND due_date < date('now', 'localtime')
      `).get(userId).count),
      todayActions: Number(db.prepare(`
        SELECT COUNT(*) AS count FROM meeting_action_items
        WHERE user_id = ? AND status IN ('open', 'in_progress')
          AND due_date = date('now', 'localtime')
      `).get(userId).count),
      upcomingMeetings: Number(db.prepare(`
        SELECT COUNT(*) AS count FROM meetings
        WHERE user_id = ? AND status IN ('upcoming', 'in_progress')
          AND meeting_date >= ?
      `).get(userId, timestamp).count),
    };
    return res.json({ meetings, openActions, advisorNotes, counts });
  } catch (error) {
    return sendRouteError(res, error, 'Get research snapshot');
  }
});

router.get('/calendar-todos', (req, res) => {
  try {
    const clauses = ['user_id = ?'];
    const params = [req.user.id];
    if (req.query.from) {
      clauses.push('date >= ?');
      params.push(isoValue(req.query.from, 'from', { dateOnly: true }));
    }
    if (req.query.to) {
      clauses.push('date <= ?');
      params.push(isoValue(req.query.to, 'to', { dateOnly: true }));
    }
    const todos = db.prepare(`
      SELECT * FROM workbench_calendar_todos
      WHERE ${clauses.join(' AND ')}
      ORDER BY date ASC, created_at ASC, id ASC
    `).all(...params).map(mapCalendarTodo);
    return res.json({ todos });
  } catch (error) {
    error.status = 400;
    return sendRouteError(res, error, 'List calendar todos');
  }
});

router.post('/calendar-todos', (req, res) => {
  const fields = new Set(['id', 'title', 'date', 'completed', 'projectId', 'createdAt']);
  if (!requireObject(req, res, fields)) return;
  try {
    const id = textValue(req.body.id, 'id', { max: 200 }) || apiId('calendar');
    const title = textValue(req.body.title, 'title', { required: true, max: 500 });
    const date = isoValue(req.body.date, 'date', { required: true, dateOnly: true });
    const completed = booleanValue(req.body.completed ?? false, 'completed');
    const projectId = textValue(req.body.projectId, 'projectId', { max: 200 });
    if (projectId) assertProjectAccess(req.user.id, projectId);
    const createdAt = isoValue(req.body.createdAt, 'createdAt') || nowIso();
    db.prepare(`
      INSERT INTO workbench_calendar_todos (
        id, user_id, title, date, completed, project_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user.id, title, date, completed, projectId, createdAt, nowIso());
    notifyWorkbench(req, 'calendar');
    return res.status(201).json({ todo: mapCalendarTodo(db.prepare('SELECT * FROM workbench_calendar_todos WHERE id = ?').get(id)) });
  } catch (error) {
    if (!error.status) error.status = 400;
    return sendRouteError(res, error, 'Create calendar todo');
  }
});

router.patch('/calendar-todos/:id', (req, res) => {
  const fields = new Set(['title', 'date', 'completed', 'projectId']);
  if (!requireObject(req, res, fields)) return;
  try {
    const existing = db.prepare('SELECT * FROM workbench_calendar_todos WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.user.id);
    if (!existing) return res.status(404).json({ error: 'Calendar todo not found' });
    const values = {
      title: textValue(req.body.title, 'title', { required: req.body.title !== undefined, max: 500 }),
      date: isoValue(req.body.date, 'date', { dateOnly: true }),
      completed: booleanValue(req.body.completed, 'completed'),
      project_id: textValue(req.body.projectId, 'projectId', { max: 200 }),
    };
    if (req.body.projectId !== undefined && values.project_id) assertProjectAccess(req.user.id, values.project_id);
    const updates = Object.entries(values).filter(([, value]) => value !== undefined);
    if (updates.length === 0) return res.status(400).json({ error: 'At least one field is required' });
    updates.push(['updated_at', nowIso()]);
    db.prepare(`UPDATE workbench_calendar_todos SET ${updates.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ? AND user_id = ?`)
      .run(...updates.map(([, value]) => value), req.params.id, req.user.id);
    notifyWorkbench(req, 'calendar');
    return res.json({ todo: mapCalendarTodo(db.prepare('SELECT * FROM workbench_calendar_todos WHERE id = ?').get(req.params.id)) });
  } catch (error) {
    if (!error.status) error.status = 400;
    return sendRouteError(res, error, 'Update calendar todo');
  }
});

router.delete('/calendar-todos/:id', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM workbench_calendar_todos WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.user.id);
    if (!result.changes) return res.status(404).json({ error: 'Calendar todo not found' });
    notifyWorkbench(req, 'calendar');
    return res.status(204).end();
  } catch (error) {
    return sendRouteError(res, error, 'Delete calendar todo');
  }
});

router.get('/notes/workbench', (req, res) => {
  try {
    const clauses = ['user_id = ?'];
    const params = [req.user.id];
    if (req.query.kind) {
      clauses.push('kind = ?');
      params.push(enumValue(req.query.kind, 'kind', WORKBENCH_NOTE_KINDS, { required: true }));
    }
    if (req.query.day) {
      clauses.push('day = ?');
      params.push(isoValue(req.query.day, 'day', { required: true, dateOnly: true }));
    }
    const notes = db.prepare(`
      SELECT * FROM workbench_notes
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at DESC, id DESC
    `).all(...params).map(mapWorkbenchNote);
    return res.json({ notes });
  } catch (error) {
    error.status = 400;
    return sendRouteError(res, error, 'List workbench notes');
  }
});

router.put('/notes/workbench', (req, res) => {
  const fields = new Set(['id', 'kind', 'content', 'day', 'createdAt']);
  if (!requireObject(req, res, fields)) return;
  try {
    const kind = enumValue(req.body.kind, 'kind', WORKBENCH_NOTE_KINDS, { required: true });
    if (typeof req.body.content !== 'string') throw new Error('content must be a string');
    const content = req.body.content.trim();
    if (content.length > 8000) throw new Error('content must be at most 8000 characters');
    if (kind === 'inbox' && !content) throw new Error('content is required');
    const day = kind === 'inbox'
      ? null
      : isoValue(req.body.day, 'day', { required: true, dateOnly: true });
    if (kind === 'inbox' && req.body.day != null) return res.status(400).json({ error: 'Inbox notes cannot have a day' });
    const id = textValue(req.body.id, 'id', { max: 200 }) || apiId('workbench_note');
    const createdAt = isoValue(req.body.createdAt, 'createdAt') || nowIso();
    const timestamp = nowIso();
    if (kind === 'inbox') {
      db.prepare(`
        INSERT INTO workbench_notes (id, user_id, kind, content, day, created_at, updated_at)
        VALUES (?, ?, 'inbox', ?, NULL, ?, ?)
      `).run(id, req.user.id, content, createdAt, timestamp);
    } else {
      db.prepare(`
        INSERT INTO workbench_notes (id, user_id, kind, content, day, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, kind, day) WHERE day IS NOT NULL DO UPDATE SET
          content = excluded.content,
          updated_at = excluded.updated_at
      `).run(id, req.user.id, kind, content, day, createdAt, timestamp);
    }
    const note = kind === 'inbox'
      ? db.prepare('SELECT * FROM workbench_notes WHERE id = ? AND user_id = ?').get(id, req.user.id)
      : db.prepare('SELECT * FROM workbench_notes WHERE user_id = ? AND kind = ? AND day = ?').get(req.user.id, kind, day);
    notifyWorkbench(req, 'note');
    return res.status(kind === 'inbox' ? 201 : 200).json({ note: mapWorkbenchNote(note) });
  } catch (error) {
    if (!error.status) error.status = 400;
    return sendRouteError(res, error, 'Save workbench note');
  }
});

router.delete('/notes/workbench/:id', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM workbench_notes WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (!result.changes) return res.status(404).json({ error: 'Workbench note not found' });
    notifyWorkbench(req, 'note');
    return res.status(204).end();
  } catch (error) {
    return sendRouteError(res, error, 'Delete workbench note');
  }
});

router.get('/meetings', (req, res) => {
  try {
    const clauses = ['user_id = ?'];
    const params = [req.user.id];
    if (req.query.from) {
      clauses.push('meeting_date >= ?');
      params.push(isoValue(req.query.from, 'from'));
    }
    if (req.query.to) {
      clauses.push('meeting_date <= ?');
      params.push(isoValue(req.query.to, 'to'));
    }
    if (req.query.status) {
      clauses.push('status = ?');
      params.push(enumValue(req.query.status, 'status', MEETING_STATUSES, { required: true }));
    }
    const rows = db.prepare(`
      SELECT * FROM meetings
      WHERE ${clauses.join(' AND ')}
      ORDER BY meeting_date ASC, created_at ASC
    `).all(...params);
    res.json({ meetings: rows.map(mapMeeting) });
  } catch (error) {
    error.status = 400;
    sendRouteError(res, error, 'List meetings');
  }
});

router.post('/meetings', (req, res) => {
  const fields = new Set(['title', 'meetingDate', 'meetingType', 'myRole', 'location', 'projectId', 'status']);
  if (!requireObject(req, res, fields)) return;
  try {
    const userId = req.user.id;
    const title = textValue(req.body.title, 'title', { required: true, max: 200 });
    const meetingDate = isoValue(req.body.meetingDate, 'meetingDate', { required: true });
    const meetingType = enumValue(req.body.meetingType, 'meetingType', MEETING_TYPES, { required: true });
    const myRole = enumValue(req.body.myRole, 'myRole', MEETING_ROLES, { required: true });
    const location = textValue(req.body.location, 'location', { max: 300 });
    const projectId = textValue(req.body.projectId, 'projectId', { max: 200 });
    const status = enumValue(req.body.status ?? 'upcoming', 'status', MEETING_STATUSES, { required: true });
    assertProjectAccess(userId, projectId);

    const meetingId = apiId('meeting');
    const timestamp = nowIso();
    const createMeeting = db.transaction(() => {
      db.prepare(`
        INSERT INTO meetings (
          id, user_id, title, meeting_date, meeting_type, my_role,
          location, project_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(meetingId, userId, title, meetingDate, meetingType, myRole, location, projectId, status, timestamp, timestamp);

      const carryovers = db.prepare(`
        SELECT id, content
        FROM meeting_action_items
        WHERE user_id = ? AND owner = 'me' AND status IN ('open', 'in_progress')
        ORDER BY due_date IS NULL, due_date ASC, created_at ASC
      `).all(userId);
      const insertAgenda = db.prepare(`
        INSERT INTO meeting_agenda_items (
          id, meeting_id, user_id, kind, title, detail, source_ref, order_index, done
        ) VALUES (?, ?, ?, 'carryover_action', ?, NULL, ?, ?, 0)
      `);
      carryovers.forEach((action, index) => {
        insertAgenda.run(apiId('agenda'), meetingId, userId, action.content, `action:${action.id}`, index);
      });
    });
    createMeeting();
    notifyWorkbench(req, 'meeting', meetingId);
    res.status(201).json({ meeting: meetingDetail(userId, meetingId) });
  } catch (error) {
    if (!error.status) error.status = 400;
    sendRouteError(res, error, 'Create meeting');
  }
});

router.get('/meetings/:id', (req, res) => {
  try {
    const meeting = meetingDetail(req.user.id, req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    return res.json({ meeting });
  } catch (error) {
    return sendRouteError(res, error, 'Get meeting');
  }
});

router.patch('/meetings/:id', (req, res) => {
  const fields = new Set(['title', 'meetingDate', 'meetingType', 'myRole', 'location', 'projectId', 'status']);
  if (!requireObject(req, res, fields)) return;
  try {
    const userId = req.user.id;
    if (!meetingForUser(userId, req.params.id)) return res.status(404).json({ error: 'Meeting not found' });
    const values = {
      title: textValue(req.body.title, 'title', { required: req.body.title !== undefined, max: 200 }),
      meeting_date: isoValue(req.body.meetingDate, 'meetingDate'),
      meeting_type: enumValue(req.body.meetingType, 'meetingType', MEETING_TYPES),
      my_role: enumValue(req.body.myRole, 'myRole', MEETING_ROLES),
      location: textValue(req.body.location, 'location', { max: 300 }),
      project_id: textValue(req.body.projectId, 'projectId', { max: 200 }),
      status: enumValue(req.body.status, 'status', MEETING_STATUSES),
    };
    if (req.body.projectId !== undefined) assertProjectAccess(userId, values.project_id);
    const updates = Object.entries(values).filter(([, value]) => value !== undefined);
    if (updates.length === 0) return res.status(400).json({ error: 'At least one field is required' });
    updates.push(['updated_at', nowIso()]);
    db.prepare(`UPDATE meetings SET ${updates.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ? AND user_id = ?`)
      .run(...updates.map(([, value]) => value), req.params.id, userId);
    notifyWorkbench(req, 'meeting', req.params.id);
    return res.json({ meeting: meetingDetail(userId, req.params.id) });
  } catch (error) {
    if (!error.status) error.status = 400;
    return sendRouteError(res, error, 'Update meeting');
  }
});

router.delete('/meetings/:id', (req, res) => {
  try {
    const result = db.prepare('DELETE FROM meetings WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (!result.changes) return res.status(404).json({ error: 'Meeting not found' });
    notifyWorkbench(req, 'meeting', req.params.id);
    return res.status(204).end();
  } catch (error) {
    return sendRouteError(res, error, 'Delete meeting');
  }
});

router.post('/meetings/:id/agenda', (req, res) => {
  const fields = new Set(['kind', 'title', 'detail', 'sourceRef', 'orderIndex', 'done']);
  if (!requireObject(req, res, fields)) return;
  try {
    const userId = req.user.id;
    if (!meetingForUser(userId, req.params.id)) return res.status(404).json({ error: 'Meeting not found' });
    const id = apiId('agenda');
    const kind = enumValue(req.body.kind, 'kind', AGENDA_KINDS, { required: true });
    const title = textValue(req.body.title, 'title', { required: true, max: 500 });
    const detail = textValue(req.body.detail, 'detail', { max: 4000 });
    const sourceRef = textValue(req.body.sourceRef, 'sourceRef', { max: 300 });
    const orderIndex = integerValue(req.body.orderIndex ?? 0, 'orderIndex');
    const done = booleanValue(req.body.done ?? false, 'done');
    db.prepare(`
      INSERT INTO meeting_agenda_items (
        id, meeting_id, user_id, kind, title, detail, source_ref, order_index, done
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.params.id, userId, kind, title, detail, sourceRef, orderIndex, done);
    const item = db.prepare('SELECT * FROM meeting_agenda_items WHERE id = ?').get(id);
    notifyWorkbench(req, 'agenda', req.params.id);
    return res.status(201).json({ agendaItem: mapAgenda(item) });
  } catch (error) {
    error.status = 400;
    return sendRouteError(res, error, 'Create agenda item');
  }
});

router.patch('/agenda/:id', (req, res) => {
  const fields = new Set(['kind', 'title', 'detail', 'sourceRef', 'orderIndex', 'done']);
  if (!requireObject(req, res, fields)) return;
  try {
    const userId = req.user.id;
    const existing = db.prepare('SELECT * FROM meeting_agenda_items WHERE id = ? AND user_id = ?').get(req.params.id, userId);
    if (!existing) return res.status(404).json({ error: 'Agenda item not found' });
    const values = {
      kind: enumValue(req.body.kind, 'kind', AGENDA_KINDS),
      title: textValue(req.body.title, 'title', { required: req.body.title !== undefined, max: 500 }),
      detail: textValue(req.body.detail, 'detail', { max: 4000 }),
      source_ref: textValue(req.body.sourceRef, 'sourceRef', { max: 300 }),
      order_index: integerValue(req.body.orderIndex, 'orderIndex'),
      done: booleanValue(req.body.done, 'done'),
    };
    const updates = Object.entries(values).filter(([, value]) => value !== undefined);
    if (updates.length === 0) return res.status(400).json({ error: 'At least one field is required' });
    db.prepare(`UPDATE meeting_agenda_items SET ${updates.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ? AND user_id = ?`)
      .run(...updates.map(([, value]) => value), req.params.id, userId);
    const item = db.prepare('SELECT * FROM meeting_agenda_items WHERE id = ? AND user_id = ?').get(req.params.id, userId);
    notifyWorkbench(req, 'agenda', existing.meeting_id);
    return res.json({ agendaItem: mapAgenda(item) });
  } catch (error) {
    error.status = 400;
    return sendRouteError(res, error, 'Update agenda item');
  }
});

router.delete('/agenda/:id', (req, res) => {
  try {
    const existing = db.prepare('SELECT meeting_id FROM meeting_agenda_items WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    const result = db.prepare('DELETE FROM meeting_agenda_items WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (!result.changes) return res.status(404).json({ error: 'Agenda item not found' });
    notifyWorkbench(req, 'agenda', existing?.meeting_id || null);
    return res.status(204).end();
  } catch (error) {
    return sendRouteError(res, error, 'Delete agenda item');
  }
});

router.post('/meetings/:id/notes', (req, res) => {
  const fields = new Set(['speaker', 'content', 'noteType', 'sourceSegmentId']);
  if (!requireObject(req, res, fields)) return;
  try {
    const userId = req.user.id;
    if (!meetingForUser(userId, req.params.id)) return res.status(404).json({ error: 'Meeting not found' });
    const id = apiId('note');
    const speaker = textValue(req.body.speaker, 'speaker', { max: 100 });
    const content = textValue(req.body.content, 'content', { required: true, max: 8000 });
    const noteType = enumValue(req.body.noteType, 'noteType', NOTE_TYPES, { required: true });
    const sourceSegmentId = textValue(req.body.sourceSegmentId, 'sourceSegmentId', { max: 200 });
    if (sourceSegmentId) {
      const segment = db.prepare(`
        SELECT id FROM meeting_transcript_segments
        WHERE id = ? AND meeting_id = ? AND user_id = ?
      `).get(sourceSegmentId, req.params.id, userId);
      if (!segment) return res.status(400).json({ error: 'Transcript segment not found for this meeting' });
    }
    db.prepare(`
      INSERT INTO meeting_notes (
        id, meeting_id, user_id, speaker, content, note_type, source_segment_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.params.id, userId, speaker, content, noteType, sourceSegmentId, nowIso());
    notifyWorkbench(req, 'note', req.params.id);
    return res.status(201).json({ note: mapNote(db.prepare('SELECT * FROM meeting_notes WHERE id = ?').get(id)) });
  } catch (error) {
    error.status = 400;
    return sendRouteError(res, error, 'Create note');
  }
});

router.patch('/notes/:id', (req, res) => {
  const fields = new Set(['speaker', 'content', 'noteType']);
  if (!requireObject(req, res, fields)) return;
  try {
    const userId = req.user.id;
    const existing = db.prepare('SELECT * FROM meeting_notes WHERE id = ? AND user_id = ?').get(req.params.id, userId);
    if (!existing) return res.status(404).json({ error: 'Note not found' });
    const values = {
      speaker: textValue(req.body.speaker, 'speaker', { max: 100 }),
      content: textValue(req.body.content, 'content', { required: req.body.content !== undefined, max: 8000 }),
      note_type: enumValue(req.body.noteType, 'noteType', NOTE_TYPES),
    };
    const updates = Object.entries(values).filter(([, value]) => value !== undefined);
    if (updates.length === 0) return res.status(400).json({ error: 'At least one field is required' });
    db.prepare(`UPDATE meeting_notes SET ${updates.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ? AND user_id = ?`)
      .run(...updates.map(([, value]) => value), req.params.id, userId);
    notifyWorkbench(req, 'note', existing.meeting_id);
    return res.json({ note: mapNote(db.prepare('SELECT * FROM meeting_notes WHERE id = ?').get(req.params.id)) });
  } catch (error) {
    error.status = 400;
    return sendRouteError(res, error, 'Update note');
  }
});

router.post('/notes/:id/promote', (req, res) => {
  const fields = new Set(['content', 'dueDate', 'projectId']);
  if (!requireObject(req, res, fields)) return;
  try {
    const userId = req.user.id;
    const note = db.prepare(`
      SELECT n.*, m.project_id AS meeting_project_id
      FROM meeting_notes n
      JOIN meetings m ON m.id = n.meeting_id AND m.user_id = n.user_id
      WHERE n.id = ? AND n.user_id = ?
    `).get(req.params.id, userId);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    if (note.promoted_action_id) {
      const existingAction = db.prepare('SELECT * FROM meeting_action_items WHERE id = ? AND user_id = ?').get(note.promoted_action_id, userId);
      if (existingAction) return res.status(409).json({ error: 'Note has already been promoted', action: mapAction(existingAction) });
    }
    const content = textValue(req.body.content ?? note.content, 'content', { required: true, max: 8000 });
    const dueDate = isoValue(req.body.dueDate, 'dueDate', { dateOnly: true });
    const projectId = textValue(req.body.projectId ?? note.meeting_project_id, 'projectId', { max: 200 });
    assertProjectAccess(userId, projectId);
    const actionId = apiId('action');
    const activityId = apiId('project_activity');
    db.transaction(() => {
      db.prepare(`
        INSERT INTO meeting_action_items (
          id, meeting_id, user_id, source_note_id, content, due_date, status,
          owner, task_id, project_id, created_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'open', 'me', NULL, ?, ?, NULL)
      `).run(actionId, note.meeting_id, userId, note.id, content, dueDate, projectId, nowIso());
      db.prepare('UPDATE meeting_notes SET promoted_action_id = ? WHERE id = ? AND user_id = ?')
        .run(actionId, note.id, userId);
      db.prepare(`
        INSERT INTO project_activity_events (
          id, user_id, project_id, event_type, occurred_at, metadata_json
        ) VALUES (?, ?, ?, 'meeting_action_created', ?, ?)
      `).run(
        activityId,
        userId,
        projectId || `meeting:${note.meeting_id}`,
        nowIso(),
        JSON.stringify({ meetingId: note.meeting_id, noteId: note.id, actionId }),
      );
    })();
    const action = db.prepare('SELECT * FROM meeting_action_items WHERE id = ?').get(actionId);
    notifyWorkbench(req, 'action', note.meeting_id);
    return res.status(201).json({ action: mapAction(action) });
  } catch (error) {
    if (!error.status) error.status = 400;
    return sendRouteError(res, error, 'Promote note');
  }
});

router.get('/actions/open', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT * FROM meeting_action_items
      WHERE user_id = ? AND owner = 'me' AND status IN ('open', 'in_progress')
      ORDER BY due_date IS NULL, due_date ASC, created_at ASC
    `).all(req.user.id);
    return res.json({ actions: rows.map(mapAction) });
  } catch (error) {
    return sendRouteError(res, error, 'List open actions');
  }
});

router.post('/meetings/:id/actions', (req, res) => {
  const fields = new Set(['content', 'dueDate', 'status', 'projectId']);
  if (!requireObject(req, res, fields)) return;
  try {
    const userId = req.user.id;
    const meeting = meetingForUser(userId, req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const id = apiId('action');
    const content = textValue(req.body.content, 'content', { required: true, max: 8000 });
    const dueDate = isoValue(req.body.dueDate, 'dueDate', { dateOnly: true });
    const status = enumValue(req.body.status ?? 'open', 'status', ACTION_STATUSES, { required: true });
    const projectId = textValue(req.body.projectId ?? meeting.project_id, 'projectId', { max: 200 });
    assertProjectAccess(userId, projectId);
    const timestamp = nowIso();
    db.prepare(`
      INSERT INTO meeting_action_items (
        id, meeting_id, user_id, source_note_id, content, due_date, status,
        owner, task_id, project_id, created_at, completed_at
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, 'me', NULL, ?, ?, ?)
    `).run(id, meeting.id, userId, content, dueDate, status, projectId, timestamp, status === 'done' ? timestamp : null);
    notifyWorkbench(req, 'action', meeting.id);
    return res.status(201).json({ action: mapAction(db.prepare('SELECT * FROM meeting_action_items WHERE id = ?').get(id)) });
  } catch (error) {
    if (!error.status) error.status = 400;
    return sendRouteError(res, error, 'Create action');
  }
});

router.patch('/actions/:id', (req, res) => {
  const fields = new Set(['content', 'dueDate', 'status', 'projectId']);
  if (!requireObject(req, res, fields)) return;
  try {
    const userId = req.user.id;
    const existing = db.prepare('SELECT * FROM meeting_action_items WHERE id = ? AND user_id = ?').get(req.params.id, userId);
    if (!existing) return res.status(404).json({ error: 'Action item not found' });
    const values = {
      content: textValue(req.body.content, 'content', { required: req.body.content !== undefined, max: 8000 }),
      due_date: isoValue(req.body.dueDate, 'dueDate', { dateOnly: true }),
      status: enumValue(req.body.status, 'status', ACTION_STATUSES),
      project_id: textValue(req.body.projectId, 'projectId', { max: 200 }),
    };
    if (req.body.projectId !== undefined) assertProjectAccess(userId, values.project_id);
    const updates = Object.entries(values).filter(([, value]) => value !== undefined);
    if (values.status !== undefined) {
      updates.push(['completed_at', values.status === 'done' ? nowIso() : null]);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'At least one field is required' });
    db.prepare(`UPDATE meeting_action_items SET ${updates.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ? AND user_id = ?`)
      .run(...updates.map(([, value]) => value), req.params.id, userId);
    notifyWorkbench(req, 'action', existing.meeting_id);
    return res.json({ action: mapAction(db.prepare('SELECT * FROM meeting_action_items WHERE id = ?').get(req.params.id)) });
  } catch (error) {
    if (!error.status) error.status = 400;
    return sendRouteError(res, error, 'Update action');
  }
});

router.post('/actions/:id/promote-task', async (req, res) => {
  const fields = new Set(['priority', 'stage']);
  if (!requireObject(req, res, fields)) return;
  let taskResult = null;
  try {
    const userId = req.user.id;
    const action = db.prepare(`
      SELECT a.*, m.title AS meeting_title
      FROM meeting_action_items a
      JOIN meetings m ON m.id = a.meeting_id AND m.user_id = a.user_id
      WHERE a.id = ? AND a.user_id = ?
    `).get(req.params.id, userId);
    if (!action) return res.status(404).json({ error: 'Action item not found' });
    if (action.task_id) return res.status(409).json({ error: 'Action item has already been promoted', taskId: action.task_id });
    if (!action.project_id) return res.status(400).json({ error: 'A project must be assigned before promoting this action to a task' });
    const project = projectForUser(userId, action.project_id);
    if (!project?.path) return res.status(404).json({ error: 'Project not found' });
    const priority = req.body.priority ?? 'high';
    if (!['low', 'medium', 'high', 'urgent'].includes(priority)) return res.status(400).json({ error: 'Invalid priority' });
    const stage = req.body.stage === undefined ? undefined : textValue(req.body.stage, 'stage', { required: true, max: 100 });
    taskResult = await addTaskRecord(project.path, {
      title: action.content,
      description: `来自组会“${action.meeting_title}”的行动项。${action.due_date ? `截止日期：${action.due_date}。` : ''}`,
      priority,
      stage,
      metadata: {
        source: 'meeting',
        sourceMeetingId: action.meeting_id,
        sourceMeetingActionId: action.id,
        dueAt: action.due_date || undefined,
      },
    });
    const taskId = String(taskResult.task.id);
    db.transaction(() => {
      const updated = db.prepare(`
        UPDATE meeting_action_items SET task_id = ?
        WHERE id = ? AND user_id = ? AND task_id IS NULL
      `).run(taskId, action.id, userId);
      if (updated.changes !== 1) throw new Error('Action item changed while it was being promoted');
      db.prepare(`
        INSERT INTO project_activity_events (
          id, user_id, project_id, project_path, event_type, occurred_at, metadata_json
        ) VALUES (?, ?, ?, ?, 'meeting_action_promoted_to_task', ?, ?)
      `).run(
        apiId('project_activity'), userId, action.project_id, project.path, nowIso(),
        JSON.stringify({ meetingId: action.meeting_id, actionId: action.id, taskId }),
      );
    })();
    if (req.app.locals.wss) broadcastTaskMasterTasksUpdate(req.app.locals.wss, action.project_id);
    notifyWorkbench(req, 'action', action.meeting_id);
    return res.status(201).json({
      task: taskResult.task,
      action: mapAction(db.prepare('SELECT * FROM meeting_action_items WHERE id = ?').get(action.id)),
    });
  } catch (error) {
    if (taskResult) {
      try { await rollbackAddedTask(taskResult); }
      catch (rollbackError) { console.error('[ERROR] Failed to roll back promoted TaskMaster task:', rollbackError?.message || rollbackError); }
    }
    if (!error.status && /required|Invalid|must be/.test(error?.message || '')) error.status = 400;
    return sendRouteError(res, error, 'Promote action to task');
  }
});

router.get('/meetings/:id/transcript', (req, res) => {
  try {
    if (!meetingForUser(req.user.id, req.params.id)) return res.status(404).json({ error: 'Meeting not found' });
    const rows = db.prepare(`
      SELECT * FROM meeting_transcript_segments
      WHERE meeting_id = ? AND user_id = ?
      ORDER BY segment_index
    `).all(req.params.id, req.user.id);
    return res.json({ segments: rows.map(mapSegment) });
  } catch (error) {
    return sendRouteError(res, error, 'Get transcript');
  }
});

router.patch('/transcript/:segmentId', (req, res) => {
  const fields = new Set(['text', 'speaker']);
  if (!requireObject(req, res, fields)) return;
  try {
    const userId = req.user.id;
    const existing = db.prepare('SELECT * FROM meeting_transcript_segments WHERE id = ? AND user_id = ?').get(req.params.segmentId, userId);
    if (!existing) return res.status(404).json({ error: 'Transcript segment not found' });
    const values = {
      text: textValue(req.body.text, 'text', { required: req.body.text !== undefined, max: 16000 }),
      speaker: textValue(req.body.speaker, 'speaker', { max: 100 }),
    };
    const updates = Object.entries(values).filter(([, value]) => value !== undefined);
    if (updates.length === 0) return res.status(400).json({ error: 'At least one field is required' });
    updates.push(['updated_at', nowIso()]);
    db.prepare(`UPDATE meeting_transcript_segments SET ${updates.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ? AND user_id = ?`)
      .run(...updates.map(([, value]) => value), req.params.segmentId, userId);
    notifyWorkbench(req, 'transcript', existing.meeting_id);
    return res.json({ segment: mapSegment(db.prepare('SELECT * FROM meeting_transcript_segments WHERE id = ?').get(req.params.segmentId)) });
  } catch (error) {
    error.status = 400;
    return sendRouteError(res, error, 'Update transcript');
  }
});

router.post('/meetings/:id/recording/start', async (req, res) => {
  const fields = new Set(['provider', 'language', 'privacyConsent']);
  if (!requireObject(req, res, fields)) return;
  try {
    const userId = req.user.id;
    const meeting = meetingForUser(userId, req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const provider = req.body.provider ?? 'openai';
    if (provider === 'local') return res.status(501).json({ error: 'Local transcription is reserved but not available in v1' });
    if (provider !== 'openai') return res.status(400).json({ error: 'Invalid transcription provider' });
    const language = typeof req.body.language === 'string' && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(req.body.language)
      ? req.body.language
      : 'zh';
    const existingConsent = db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?')
      .get(userId, TRANSCRIPTION_CONSENT_KEY);
    if (!existingConsent && req.body.privacyConsent !== true) {
      return res.status(428).json({
        error: 'Recording transcription uploads audio to OpenAI and requires explicit privacy consent',
        code: 'TRANSCRIPTION_PRIVACY_CONSENT_REQUIRED',
      });
    }
    if (req.body.privacyConsent === true && !existingConsent) {
      db.prepare(`
        INSERT INTO user_settings (user_id, key, value, updated_at)
        VALUES (?, ?, 'accepted', CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(userId, TRANSCRIPTION_CONSENT_KEY);
    }
    await meetingTranscription.ensureRecordingDir(userId, meeting.id);
    const existingAttachment = db.prepare(`
      SELECT * FROM meeting_attachments
      WHERE meeting_id = ? AND user_id = ? AND kind = 'recording'
      ORDER BY created_at LIMIT 1
    `).get(meeting.id, userId);
    if (!existingAttachment) {
      db.prepare(`
        INSERT INTO meeting_attachments (
          id, meeting_id, user_id, kind, file_path, mime_type, size_bytes, duration_ms, created_at
        ) VALUES (?, ?, ?, 'recording', 'recording/', 'audio/webm;codecs=opus', 0, 0, ?)
      `).run(apiId('attachment'), meeting.id, userId, nowIso());
    }
    notifyWorkbench(req, 'recording', meeting.id);
    return res.json({ recording: { meetingId: meeting.id, provider, language, status: 'recording' } });
  } catch (error) {
    return sendRouteError(res, error, 'Start recording');
  }
});

router.post('/meetings/:id/recording/chunk', recordingUpload.single('audio'), async (req, res) => {
  const fields = new Set(['segmentIndex', 'startMs', 'endMs', 'language']);
  if (!requireObject(req, res, fields)) return;
  try {
    const userId = req.user.id;
    const meeting = meetingForUser(userId, req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (!req.file?.buffer?.length) return res.status(400).json({ error: 'An audio chunk field named audio is required' });
    if (!String(req.file.mimetype || '').startsWith('audio/')) return res.status(400).json({ error: 'The uploaded chunk must be audio' });
    const segmentIndex = formIntegerValue(req.body.segmentIndex, 'segmentIndex');
    const startMs = formIntegerValue(req.body.startMs, 'startMs');
    const endMs = formIntegerValue(req.body.endMs, 'endMs');
    if (endMs <= startMs) return res.status(400).json({ error: 'endMs must be greater than startMs' });
    const language = typeof req.body.language === 'string' && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(req.body.language)
      ? req.body.language
      : 'zh';
    const existing = db.prepare(`
      SELECT id FROM meeting_transcript_segments
      WHERE meeting_id = ? AND segment_index = ?
    `).get(meeting.id, segmentIndex);
    if (existing) return res.status(409).json({ error: 'This recording segment already exists', segmentId: existing.id });
    const saved = await meetingTranscription.saveChunk({
      userId, meetingId: meeting.id, segmentIndex, buffer: req.file.buffer,
    });
    const segmentId = apiId('segment');
    const timestamp = nowIso();
    try {
      db.transaction(() => {
        db.prepare(`
          INSERT INTO meeting_transcript_segments (
            id, meeting_id, user_id, segment_index, start_ms, end_ms, text,
            speaker, status, error, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, '', NULL, 'pending', NULL, ?, ?)
        `).run(segmentId, meeting.id, userId, segmentIndex, startMs, endMs, timestamp, timestamp);
        db.prepare(`
          UPDATE meeting_attachments
          SET size_bytes = COALESCE(size_bytes, 0) + ?,
              duration_ms = MAX(COALESCE(duration_ms, 0), ?)
          WHERE meeting_id = ? AND user_id = ? AND kind = 'recording'
        `).run(saved.sizeBytes, endMs, meeting.id, userId);
      })();
    } catch (error) {
      await import('fs/promises').then(({ unlink }) => unlink(saved.filePath).catch(() => {}));
      throw error;
    }
    void meetingTranscription.enqueue(segmentId, language);
    const segment = db.prepare('SELECT * FROM meeting_transcript_segments WHERE id = ?').get(segmentId);
    notifyWorkbench(req, 'transcript', meeting.id);
    return res.status(202).json({ segment: mapSegment(segment) });
  } catch (error) {
    if (error?.code === 'LIMIT_FILE_SIZE') error.status = 413;
    else if (error?.code === 'EEXIST') error.status = 409;
    else if (!error.status) error.status = 400;
    return sendRouteError(res, error, 'Upload recording chunk');
  }
});

router.post('/meetings/:id/recording/stop', (req, res) => {
  if (!requireObject(req, res, new Set())) return;
  try {
    const userId = req.user.id;
    if (!meetingForUser(userId, req.params.id)) return res.status(404).json({ error: 'Meeting not found' });
    const progress = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status IN ('pending', 'transcribing') THEN 1 ELSE 0 END) AS processing
      FROM meeting_transcript_segments
      WHERE meeting_id = ? AND user_id = ?
    `).get(req.params.id, userId);
    return res.json({ recording: { meetingId: req.params.id, status: 'stopped', ...progress } });
  } catch (error) {
    return sendRouteError(res, error, 'Stop recording');
  }
});

router.post('/transcript/:segmentId/retry', (req, res) => {
  const fields = new Set(['language']);
  if (!requireObject(req, res, fields)) return;
  try {
    const segment = db.prepare(`
      SELECT * FROM meeting_transcript_segments WHERE id = ? AND user_id = ?
    `).get(req.params.segmentId, req.user.id);
    if (!segment) return res.status(404).json({ error: 'Transcript segment not found' });
    if (segment.status !== 'failed') return res.status(409).json({ error: 'Only failed transcript segments can be retried' });
    const language = typeof req.body.language === 'string' && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(req.body.language)
      ? req.body.language
      : 'zh';
    db.prepare(`
      UPDATE meeting_transcript_segments
      SET status = 'pending', error = NULL, updated_at = ? WHERE id = ? AND user_id = ?
    `).run(nowIso(), segment.id, req.user.id);
    void meetingTranscription.enqueue(segment.id, language);
    notifyWorkbench(req, 'transcript', segment.meeting_id);
    return res.status(202).json({ segment: mapSegment(db.prepare('SELECT * FROM meeting_transcript_segments WHERE id = ?').get(segment.id)) });
  } catch (error) {
    return sendRouteError(res, error, 'Retry transcription');
  }
});

router.post('/meetings/:id/summarize', async (req, res) => {
  if (!requireObject(req, res, new Set())) return;
  try {
    const userId = req.user.id;
    const meeting = meetingForUser(userId, req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const transcriptSegments = db.prepare(`
      SELECT * FROM meeting_transcript_segments
      WHERE meeting_id = ? AND user_id = ? ORDER BY segment_index
    `).all(meeting.id, userId);
    const notes = db.prepare(`
      SELECT * FROM meeting_notes
      WHERE meeting_id = ? AND user_id = ? ORDER BY created_at, id
    `).all(meeting.id, userId);
    const draft = await meetingTranscription.summarizeMeeting({
      title: meeting.title, transcriptSegments, notes,
    });
    return res.json({ draft });
  } catch (error) {
    if (error?.code === 'OPENAI_NOT_CONFIGURED') error.status = 503;
    else if (error?.code === 'MEETING_CONTENT_EMPTY') error.status = 400;
    return sendRouteError(res, error, 'Summarize meeting');
  }
});

router.get('/reminders', (req, res) => {
  try {
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 30;
    const reminders = db.prepare(`
      SELECT * FROM meeting_reminder_deliveries
      WHERE user_id = ? AND status = 'delivered'
      ORDER BY delivered_at DESC, created_at DESC
      LIMIT ?
    `).all(req.user.id, limit).map(mapReminder);
    return res.json({ reminders });
  } catch (error) {
    return sendRouteError(res, error, 'List reminders');
  }
});

router.post('/reminders/read', (req, res) => {
  if (!requireObject(req, res, new Set())) return;
  try {
    const readAt = nowIso();
    db.prepare(`
      UPDATE meeting_reminder_deliveries
      SET read_at = ?, updated_at = ?
      WHERE user_id = ? AND status = 'delivered' AND read_at IS NULL
    `).run(readAt, readAt, req.user.id);
    notifyWorkbench(req, 'reminder');
    return res.json({ readAt });
  } catch (error) {
    return sendRouteError(res, error, 'Mark reminders read');
  }
});

export default router;
