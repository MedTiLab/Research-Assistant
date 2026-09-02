import express from 'express';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
const originalDataDir = process.env.MEDHELP_DATA_DIR;
const originalOpenAiKey = process.env.OPENAI_API_KEY;
let root;
let server;
let base;
let database;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'medhelp-meetings-'));
  process.env.DATABASE_PATH = path.join(root, 'auth.db');
  process.env.MEDHELP_DATA_DIR = root;
  delete process.env.OPENAI_API_KEY;
  vi.resetModules();
  database = await import('../database/db.js');
  await database.initializeDatabase();
  database.userDb.createUser('meeting-user', 'hash');
  const meetingsRouter = (await import('../routes/meetings.js')).default;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 1 }; next(); });
  app.use('/api/research', meetingsRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/research`;
});

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  database?.closeDatabase();
  vi.resetModules();
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
  if (originalDataDir === undefined) delete process.env.MEDHELP_DATA_DIR;
  else process.env.MEDHELP_DATA_DIR = originalDataDir;
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
  await rm(root, { recursive: true, force: true });
});

function request(pathname, method = 'GET', body) {
  return fetch(`${base}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function createMeeting(title = '课题组周例会') {
  const response = await request('/meetings', 'POST', {
    title,
    meetingDate: '2026-09-03T09:00:00+08:00',
    meetingType: 'group',
    myRole: 'presenter',
  });
  expect(response.status).toBe(201);
  return (await response.json()).meeting;
}

describe('meeting loop API', () => {
  it('creates the next meeting and carries open actions into the top of its agenda', async () => {
    const first = await createMeeting('第一次组会');
    const actionResponse = await request(`/meetings/${first.id}/actions`, 'POST', {
      content: '补做年龄分层敏感性分析',
      dueDate: '2026-09-05',
    });
    expect(actionResponse.status).toBe(201);

    const second = await createMeeting('第二次组会');
    expect(second.agenda).toEqual([
      expect.objectContaining({
        kind: 'carryover_action',
        title: '补做年龄分层敏感性分析',
        orderIndex: 0,
        done: false,
      }),
    ]);
  });

  it('promotes a note exactly once and records the whole mutation transactionally', async () => {
    const meeting = await createMeeting();
    const noteResponse = await request(`/meetings/${meeting.id}/notes`, 'POST', {
      speaker: '导师',
      content: '补充敏感性分析并在下周汇报',
      noteType: 'feedback',
    });
    const note = (await noteResponse.json()).note;

    const promoteResponse = await request(`/notes/${note.id}/promote`, 'POST', { dueDate: '2026-09-08' });
    expect(promoteResponse.status).toBe(201);
    const action = (await promoteResponse.json()).action;
    expect(action).toMatchObject({ sourceNoteId: note.id, content: note.content, status: 'open' });

    const storedNote = database.db.prepare('SELECT promoted_action_id FROM meeting_notes WHERE id = ?').get(note.id);
    expect(storedNote.promoted_action_id).toBe(action.id);
    expect(database.db.prepare("SELECT COUNT(*) AS count FROM project_activity_events WHERE event_type = 'meeting_action_created'").get().count).toBe(1);

    const duplicateResponse = await request(`/notes/${note.id}/promote`, 'POST', {});
    expect(duplicateResponse.status).toBe(409);
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM meeting_action_items WHERE source_note_id = ?').get(note.id).count).toBe(1);
  });

  it('returns a bounded dashboard snapshot without transcript or note bodies on meetings', async () => {
    const meeting = await createMeeting('聚合快照测试');
    const noteResponse = await request(`/meetings/${meeting.id}/notes`, 'POST', {
      speaker: '导师', content: '补充亚组分析', noteType: 'feedback',
    });
    const note = (await noteResponse.json()).note;
    await request(`/notes/${note.id}/promote`, 'POST', { dueDate: '2026-09-08' });

    const response = await request('/snapshot');
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.meetings).toEqual([
      expect.objectContaining({ id: meeting.id, agenda: expect.any(Array) }),
    ]);
    expect(payload.meetings[0]).not.toHaveProperty('notes');
    expect(payload.meetings[0]).not.toHaveProperty('transcriptSegments');
    expect(payload.openActions).toEqual([
      expect.objectContaining({ content: '补充亚组分析', status: 'open' }),
    ]);
    expect(payload.advisorNotes).toEqual([
      expect.objectContaining({ id: note.id, actionStatus: 'open', actionDueDate: '2026-09-08' }),
    ]);
    expect(payload.counts).toEqual(expect.objectContaining({
      overdueActions: expect.any(Number), todayActions: expect.any(Number), upcomingMeetings: expect.any(Number),
    }));
  });

  it('persists calendar todos and daily or inbox workbench notes with strict fields', async () => {
    const todoResponse = await request('/calendar-todos', 'POST', {
      id: 'calendar-local-1', title: '准备组会材料', date: '2026-09-03', completed: false,
      createdAt: '2026-09-01T08:00:00.000Z',
    });
    expect(todoResponse.status).toBe(201);
    expect((await todoResponse.json()).todo).toMatchObject({
      id: 'calendar-local-1', title: '准备组会材料', date: '2026-09-03', completed: false,
    });
    expect((await request('/calendar-todos/calendar-local-1', 'PATCH', { completed: true })).status).toBe(200);
    const todos = (await (await request('/calendar-todos?from=2026-09-03&to=2026-09-03')).json()).todos;
    expect(todos).toEqual([expect.objectContaining({ id: 'calendar-local-1', completed: true })]);

    expect((await request('/notes/workbench', 'PUT', {
      kind: 'daily_focus', day: '2026-09-01', content: '先完成主分析',
    })).status).toBe(200);
    expect((await request('/notes/workbench', 'PUT', {
      kind: 'daily_focus', day: '2026-09-01', content: '先回复导师',
    })).status).toBe(200);
    expect((await request('/notes/workbench', 'PUT', {
      id: 'inbox-local-1', kind: 'inbox', content: '记录一个研究想法',
    })).status).toBe(201);
    const notes = (await (await request('/notes/workbench')).json()).notes;
    expect(notes.filter((note) => note.kind === 'daily_focus')).toEqual([
      expect.objectContaining({ content: '先回复导师', day: '2026-09-01' }),
    ]);
    expect(notes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'inbox-local-1', kind: 'inbox' }),
    ]));

    expect((await request('/calendar-todos', 'POST', {
      title: '非法字段', date: '2026-09-03', surprise: true,
    })).status).toBe(400);
    expect((await request('/notes/workbench', 'PUT', {
      kind: 'inbox', content: '非法字段', surprise: true,
    })).status).toBe(400);
  });

  it('rejects unknown fields instead of silently ignoring them', async () => {
    const response = await request('/meetings', 'POST', {
      title: '未知字段测试',
      meetingDate: '2026-09-03T09:00:00+08:00',
      meetingType: 'group',
      myRole: 'presenter',
      surprise: true,
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('surprise');
    expect(database.db.prepare('SELECT COUNT(*) AS count FROM meetings').get().count).toBe(0);
  });

  it('requires privacy consent, persists chunks, and isolates a missing-key transcription failure to that segment', async () => {
    const meeting = await createMeeting();
    expect((await request(`/meetings/${meeting.id}/recording/start`, 'POST', { provider: 'openai', language: 'zh' })).status).toBe(428);
    expect((await request(`/meetings/${meeting.id}/recording/start`, 'POST', { provider: 'openai', language: 'zh', privacyConsent: true })).status).toBe(200);

    const form = new FormData();
    form.append('audio', new Blob([Buffer.from('fake-webm')], { type: 'audio/webm' }), 'segment-0.webm');
    form.append('segmentIndex', '0');
    form.append('startMs', '0');
    form.append('endMs', '30000');
    form.append('language', 'zh');
    const chunkResponse = await fetch(`${base}/meetings/${meeting.id}/recording/chunk`, { method: 'POST', body: form });
    expect(chunkResponse.status).toBe(202);
    const segment = (await chunkResponse.json()).segment;
    await vi.waitFor(() => {
      expect(database.db.prepare('SELECT status, error FROM meeting_transcript_segments WHERE id = ?').get(segment.id))
        .toMatchObject({ status: 'failed', error: 'OpenAI API key is not configured' });
    });

    const stopResponse = await request(`/meetings/${meeting.id}/recording/stop`, 'POST', {});
    expect(stopResponse.status).toBe(200);
    expect((await stopResponse.json()).recording).toMatchObject({ total: 1, failed: 1 });
  });

  it('promotes a project action to TaskMaster and keeps the source link', async () => {
    const projectPath = path.join(root, 'project');
    await mkdir(projectPath, { recursive: true });
    database.projectDb.upsertProject('project-id', 1, '研究项目', projectPath, 0, null, {});
    const meetingResponse = await request('/meetings', 'POST', {
      title: '任务转换测试', meetingDate: '2026-09-03T09:00:00+08:00',
      meetingType: 'group', myRole: 'presenter', projectId: 'project-id',
    });
    const meeting = (await meetingResponse.json()).meeting;
    const actionResponse = await request(`/meetings/${meeting.id}/actions`, 'POST', { content: '完成主分析', dueDate: '2026-09-10' });
    const action = (await actionResponse.json()).action;
    const promoteResponse = await request(`/actions/${action.id}/promote-task`, 'POST', { priority: 'high', stage: 'experiment' });
    expect(promoteResponse.status).toBe(201);
    const promoted = await promoteResponse.json();
    expect(promoted.action.taskId).toBe(String(promoted.task.id));
    expect(promoted.task).toMatchObject({ title: '完成主分析', source: 'meeting', sourceMeetingActionId: action.id });
    const taskFile = JSON.parse(await readFile(path.join(projectPath, '.pipeline', 'tasks', 'tasks.json'), 'utf8'));
    expect(taskFile.master.tasks).toEqual([expect.objectContaining({ title: '完成主分析', sourceMeetingActionId: action.id })]);
    expect((await request(`/actions/${action.id}/promote-task`, 'POST', {})).status).toBe(409);
  });

  it('lists delivered reminders and marks them as read for the current user', async () => {
    const now = new Date().toISOString();
    database.db.prepare(`
      INSERT INTO meeting_reminder_deliveries (
        id, user_id, source_type, source_id, reminder_key, scheduled_for,
        status, title, body, delivered_at, created_at, updated_at
      ) VALUES ('reminder_1', 1, 'meeting', 'meeting_1', 'meeting:1h', ?,
        'delivered', '会议提醒', '1 小时后开始：课题组例会', ?, ?, ?)
    `).run(now, now, now, now);

    const listResponse = await request('/reminders');
    expect(listResponse.status).toBe(200);
    const listed = (await listResponse.json()).reminders;
    expect(listed).toEqual([expect.objectContaining({ id: 'reminder_1', reminderKey: 'meeting:1h' })]);
    expect(listed[0]).not.toHaveProperty('readAt');
    expect((await request('/reminders/read', 'POST', {})).status).toBe(200);
    expect(database.db.prepare('SELECT read_at FROM meeting_reminder_deliveries WHERE id = ?').get('reminder_1').read_at)
      .toBeTruthy();
  });
});
