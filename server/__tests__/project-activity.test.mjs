import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
let tempRoot = null;
let database = null;

async function loadDatabaseModule() {
  vi.resetModules();
  database = await import('../database/db.js');
  await database.initializeDatabase();
  return database;
}

describe('project activity', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-project-activity-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });

  afterEach(async () => {
    if (database?.db?.open) {
      database.db.close();
    }
    database = null;

    vi.resetModules();

    if (originalDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = originalDatabasePath;
    }

    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('aggregates project opens by local day with user isolation, distinct projects, and zero-filled history', async () => {
    const { projectActivityDb, userDb } = await loadDatabaseModule();

    const user = userDb.createUser('project-activity-user', 'hashed-password');
    const otherUser = userDb.createUser('project-activity-other-user', 'hashed-password');

    projectActivityDb.recordProjectOpen(user.id, {
      projectId: 'project-a',
      projectPath: '/workspace/project-a',
      occurredAt: '2026-05-20T10:00:00.000Z',
    });
    projectActivityDb.recordProjectOpen(user.id, {
      projectId: 'project-a',
      projectPath: '/workspace/project-a',
      occurredAt: '2026-05-20T12:00:00.000Z',
    });
    projectActivityDb.recordProjectOpen(user.id, {
      projectId: 'project-b',
      projectPath: '/workspace/project-b',
      occurredAt: '2026-05-20T17:30:00.000Z',
    });
    projectActivityDb.recordProjectOpen(otherUser.id, {
      projectId: 'project-c',
      projectPath: '/workspace/project-c',
      occurredAt: '2026-05-20T17:45:00.000Z',
    });

    const activity = projectActivityDb.getActivity(user.id, {
      days: 365,
      timezoneOffsetMinutes: -480,
      now: new Date('2026-05-21T12:00:00.000Z'),
    });

    expect(activity.days).toHaveLength(365);
    expect(activity.range).toMatchObject({
      start_date: '2025-05-22',
      end_date: '2026-05-21',
      day_count: 365,
    });

    const localMay20 = activity.days.find((day) => day.date === '2026-05-20');
    const localMay21 = activity.days.find((day) => day.date === '2026-05-21');

    expect(localMay20).toMatchObject({
      open_count: 2,
      project_count: 1,
    });
    expect(localMay21).toMatchObject({
      open_count: 1,
      project_count: 1,
    });
    expect(activity.totals).toMatchObject({
      total_opens: 3,
      total_projects: 2,
      active_days: 2,
    });
  });
});
