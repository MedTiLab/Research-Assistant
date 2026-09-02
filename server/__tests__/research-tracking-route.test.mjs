import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
const originalDataDir = process.env.MEDHELP_DATA_DIR;
let root;
let server;
let base;
let database;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'medhelp-research-tracking-'));
  process.env.DATABASE_PATH = path.join(root, 'auth.db');
  process.env.MEDHELP_DATA_DIR = root;
  vi.resetModules();
  database = await import('../database/db.js');
  await database.initializeDatabase();
  database.userDb.createUser('tracking-user', 'hash');
  const trackingRouter = (await import('../routes/research-tracking.js')).default;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 1 }; next(); });
  app.use('/api/research', trackingRouter);
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
  await rm(root, { recursive: true, force: true });
});

function request(pathname, method = 'GET', body) {
  return fetch(`${base}${pathname}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('research tracking API', () => {
  it('persists a thesis with chapters, milestones, and progress logs', async () => {
    const createdResponse = await request('/theses', 'POST', {
      title: '博士论文：临床风险预测', degree: '博士', targetDate: '2027-06-30', status: 'writing', completion: 35,
    });
    expect(createdResponse.status).toBe(201);
    const thesis = (await createdResponse.json()).thesis;

    expect((await request(`/theses/${thesis.id}/chapters`, 'POST', { title: '方法学', status: 'drafting', completion: 60 })).status).toBe(201);
    expect((await request(`/theses/${thesis.id}/milestones`, 'POST', { title: '预答辩', dueDate: '2027-03-15' })).status).toBe(201);
    expect((await request(`/theses/${thesis.id}/logs`, 'POST', { date: '2026-09-02', minutes: 90, words: 1200, note: '完成方法初稿' })).status).toBe(201);

    const detail = (await (await request(`/theses/${thesis.id}`)).json()).thesis;
    expect(detail).toMatchObject({ title: '博士论文：临床风险预测', completion: 35 });
    expect(detail.chapters).toEqual([expect.objectContaining({ title: '方法学', completion: 60 })]);
    expect(detail.milestones).toEqual([expect.objectContaining({ title: '预答辩' })]);
    expect(detail.logs).toEqual([expect.objectContaining({ minutes: 90, words: 1200 })]);
  });

  it('creates linked manuscript and submission records and tracks status transitions', async () => {
    const createdResponse = await request('/submissions', 'POST', {
      title: 'A prediction model study', shortTitle: 'Prediction model', journal: 'BMJ', deadline: '2026-10-01',
    });
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    expect(created.manuscript.targetJournal).toBe('BMJ');
    expect(created.submission.documents.length).toBeGreaterThan(0);

    const updatedResponse = await request(`/submissions/${created.submission.id}`, 'PATCH', {
      status: 'under_review', trackingCode: 'BMJ-2026-001', nextAction: '等待审稿意见',
    });
    expect(updatedResponse.status).toBe(200);
    expect((await updatedResponse.json()).submission).toMatchObject({
      status: 'under_review', previousStatus: 'journal_selected', trackingCode: 'BMJ-2026-001',
    });
    const listed = await (await request('/submissions?status=under_review')).json();
    expect(listed.submissions).toHaveLength(1);
    expect(listed.manuscripts).toHaveLength(1);
  });

  it('closes the daily loop across attendance, focus, habits, status, and review', async () => {
    const started = await request('/attendance/start', 'POST', { startedAt: '2026-09-02T01:00:00.000Z' });
    expect(started.status).toBe(201);
    expect((await request('/attendance/end', 'POST', { endedAt: '2026-09-02T02:30:00.000Z' })).status).toBe(200);
    expect((await request('/focus-sessions', 'POST', { date: '2026-09-02', minutes: 50, taskTitle: '论文修改' })).status).toBe(201);
    const habit = (await (await request('/habits', 'POST', { title: '阅读文献' })).json()).habit;
    expect((await request(`/habits/${habit.id}/entries/2026-09-02`, 'PUT', { completed: true })).status).toBe(200);
    expect((await request('/daily-reviews/2026-09-02', 'PUT', {
      accomplishments: '完成模型校准', obstacles: '外部验证样本不足', insights: '先做内部验证',
      tomorrowPriorities: ['补充 bootstrap', '整理图表'], mood: 4,
    })).status).toBe(200);

    const status = (await (await request('/today-status?date=2026-09-02')).json()).status;
    expect(status).toMatchObject({ workMinutes: 90, focusMinutes: 50, habitCompletion: 100, reviewCompleted: true });
    expect(status.review.tomorrowPriorities).toEqual(['补充 bootstrap', '整理图表']);

    const { attendance } = await (await request('/attendance?date=2026-09-02')).json();
    expect(attendance).toHaveLength(1);
    expect(attendance[0]).toMatchObject({
      startedAt: '2026-09-02T01:00:00.000Z',
      endedAt: '2026-09-02T02:30:00.000Z',
      minutes: 90,
      open: false,
    });
  });

  it('reports an unfinished check-in segment as still running', async () => {
    expect((await request('/attendance/start', 'POST', {})).status).toBe(201);
    const { attendance } = await (await request('/attendance')).json();
    expect(attendance).toHaveLength(1);
    expect(attendance[0].open).toBe(true);
    expect(attendance[0].endedAt).toBeUndefined();
  });

  it('rejects a malformed date when listing check-in segments', async () => {
    const response = await request('/attendance?date=2026-9-2');
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('YYYY-MM-DD');
  });

  it('lists focus sessions and can clear attendance or focus for a day', async () => {
    expect((await request('/attendance/start', 'POST', { startedAt: '2026-09-02T01:00:00.000Z' })).status).toBe(201);
    expect((await request('/attendance/end', 'POST', { endedAt: '2026-09-02T01:40:00.000Z' })).status).toBe(200);
    expect((await request('/focus-sessions', 'POST', { date: '2026-09-02', minutes: 25, taskTitle: '引言' })).status).toBe(201);
    expect((await request('/focus-sessions', 'POST', { date: '2026-09-02', minutes: 50, taskTitle: '方法' })).status).toBe(201);

    const listed = await (await request('/focus-sessions?date=2026-09-02')).json();
    expect(listed.focusSessions).toHaveLength(2);
    expect(listed.focusSessions[0]).toMatchObject({ minutes: 25, taskTitle: '引言' });
    expect(listed.focusSessions[1]).toMatchObject({ minutes: 50, taskTitle: '方法' });

    expect((await request('/attendance?date=2026-09-02', 'DELETE')).status).toBe(200);
    expect((await (await request('/attendance?date=2026-09-02')).json()).attendance).toHaveLength(0);

    const clearedFocus = await (await request('/focus-sessions?date=2026-09-02', 'DELETE')).json();
    expect(clearedFocus.deleted).toBe(2);
    expect((await (await request('/focus-sessions?date=2026-09-02')).json()).focusSessions).toHaveLength(0);

    const status = (await (await request('/today-status?date=2026-09-02')).json()).status;
    expect(status).toMatchObject({ workMinutes: 0, attendanceCount: 0, focusMinutes: 0 });
  });

  it('deletes a single attendance or focus session by id', async () => {
    expect((await request('/attendance/start', 'POST', { startedAt: '2026-09-02T03:00:00.000Z' })).status).toBe(201);
    expect((await request('/attendance/end', 'POST', { endedAt: '2026-09-02T03:30:00.000Z' })).status).toBe(200);
    const attendanceId = (await (await request('/attendance?date=2026-09-02')).json()).attendance[0].id;
    const focusId = (await (await request('/focus-sessions', 'POST', { date: '2026-09-02', minutes: 15, taskTitle: '短专注' })).json()).focusSession.id;

    expect((await request(`/attendance/${attendanceId}`, 'DELETE')).status).toBe(200);
    expect((await request(`/focus-sessions/${focusId}`, 'DELETE')).status).toBe(200);
    expect((await (await request('/attendance?date=2026-09-02')).json()).attendance).toHaveLength(0);
    expect((await (await request('/focus-sessions?date=2026-09-02')).json()).focusSessions).toHaveLength(0);
  });

  it('rejects unknown mutation fields', async () => {
    const response = await request('/theses', 'POST', { title: '非法字段', surprise: true });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('surprise');
  });
});
