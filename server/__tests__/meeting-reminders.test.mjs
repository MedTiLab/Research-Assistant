import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMeetingReminderService } from '../services/meetingReminders.js';

let database;

beforeEach(() => {
  database = new Database(':memory:');
  database.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, title TEXT NOT NULL,
      meeting_date TEXT NOT NULL, status TEXT NOT NULL
    );
    CREATE TABLE meeting_action_items (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, content TEXT NOT NULL,
      due_date TEXT, status TEXT NOT NULL, owner TEXT NOT NULL
    );
    CREATE TABLE meeting_reminder_deliveries (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, source_type TEXT NOT NULL,
      source_id TEXT NOT NULL, reminder_key TEXT NOT NULL, scheduled_for TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', title TEXT NOT NULL, body TEXT NOT NULL,
      delivered_at TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(user_id, source_type, source_id, reminder_key)
    );
  `);
});

afterEach(() => database.close());

describe('meeting reminder service', () => {
  it('delivers due meeting and action reminders once across service restarts', async () => {
    const current = new Date(2026, 8, 1, 10, 0, 0);
    database.prepare('INSERT INTO meetings VALUES (?, ?, ?, ?, ?)').run(
      'meeting_1', 7, '课题组例会', new Date(current.getTime() + 24 * 60 * 60 * 1000).toISOString(), 'upcoming',
    );
    database.prepare('INSERT INTO meeting_action_items VALUES (?, ?, ?, ?, ?, ?)')
      .run('action_1', 7, '完成敏感性分析', '2026-09-01', 'open', 'me');
    const notify = vi.fn().mockResolvedValue(undefined);

    await createMeetingReminderService({ database, notify, now: () => current }).tick();
    await createMeetingReminderService({ database, notify, now: () => current }).tick();

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls.map(([item]) => item.reminderKey).sort())
      .toEqual(['action:due:2026-09-01', 'meeting:1d']);
    expect(database.prepare("SELECT COUNT(*) AS count FROM meeting_reminder_deliveries WHERE status = 'delivered'").get().count)
      .toBe(2);
  });

  it('keeps failed deliveries pending and retries the same persisted reminder', async () => {
    const current = new Date(2026, 8, 2, 11, 0, 0);
    database.prepare('INSERT INTO meeting_action_items VALUES (?, ?, ?, ?, ?, ?)')
      .run('action_1', 9, '补交研究计划', '2026-09-01', 'open', 'me');
    const notify = vi.fn()
      .mockRejectedValueOnce(new Error('client offline'))
      .mockResolvedValueOnce(undefined);
    const service = createMeetingReminderService({
      database,
      notify,
      now: () => current,
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    await service.tick();
    const pending = database.prepare('SELECT id, status, error FROM meeting_reminder_deliveries').get();
    expect(pending).toMatchObject({ status: 'pending', error: 'client offline' });

    await service.tick();
    const delivered = database.prepare('SELECT id, status, error FROM meeting_reminder_deliveries').get();
    expect(delivered).toMatchObject({ id: pending.id, status: 'delivered', error: null });
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
