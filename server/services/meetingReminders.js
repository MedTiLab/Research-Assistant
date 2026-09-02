import crypto from 'crypto';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localReminderTime(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day, 9, 0, 0, 0);
}

function truncateError(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

export function createMeetingReminderService({
  database,
  notify,
  now = () => new Date(),
  intervalMs = 60_000,
  logger = console,
} = {}) {
  if (!database) throw new Error('database is required');
  if (typeof notify !== 'function') throw new Error('notify is required');

  let timer = null;
  let activeTick = null;

  const insertReminder = database.prepare(`
    INSERT OR IGNORE INTO meeting_reminder_deliveries (
      id, user_id, source_type, source_id, reminder_key, scheduled_for,
      status, title, body, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `);
  const pendingReminders = database.prepare(`
    SELECT *
    FROM meeting_reminder_deliveries
    WHERE status = 'pending' AND scheduled_for <= ?
    ORDER BY scheduled_for, created_at, id
  `);
  const markDelivered = database.prepare(`
    UPDATE meeting_reminder_deliveries
    SET status = 'delivered', delivered_at = ?, error = NULL, updated_at = ?
    WHERE id = ? AND status = 'pending'
  `);
  const markFailed = database.prepare(`
    UPDATE meeting_reminder_deliveries
    SET error = ?, updated_at = ?
    WHERE id = ? AND status = 'pending'
  `);

  function queueReminder({ userId, sourceType, sourceId, key, scheduledFor, title, body }, currentIso) {
    insertReminder.run(
      `reminder_${crypto.randomUUID()}`,
      userId,
      sourceType,
      sourceId,
      key,
      scheduledFor.toISOString(),
      title,
      body,
      currentIso,
      currentIso,
    );
  }

  function discoverDueReminders(current) {
    const currentMs = current.getTime();
    const currentIso = current.toISOString();
    const meetings = database.prepare(`
      SELECT id, user_id, title, meeting_date
      FROM meetings
      WHERE status = 'upcoming' AND meeting_date > ?
    `).all(currentIso);

    for (const meeting of meetings) {
      const meetingAt = new Date(meeting.meeting_date);
      if (Number.isNaN(meetingAt.getTime())) continue;
      for (const reminder of [
        { key: 'meeting:1d', offset: DAY_MS, label: '明天' },
        { key: 'meeting:1h', offset: HOUR_MS, label: '1 小时后' },
      ]) {
        const scheduledFor = new Date(meetingAt.getTime() - reminder.offset);
        if (scheduledFor.getTime() > currentMs) continue;
        queueReminder({
          userId: meeting.user_id,
          sourceType: 'meeting',
          sourceId: meeting.id,
          key: reminder.key,
          scheduledFor,
          title: '会议提醒',
          body: `${reminder.label}开始：${meeting.title}`,
        }, currentIso);
      }
    }

    const today = localDateKey(current);
    const todayReminderAt = localReminderTime(today);
    if (todayReminderAt.getTime() > currentMs) return;

    const actions = database.prepare(`
      SELECT id, user_id, content, due_date
      FROM meeting_action_items
      WHERE owner = 'me'
        AND status IN ('open', 'in_progress')
        AND due_date IS NOT NULL
        AND due_date <= ?
    `).all(today);
    for (const action of actions) {
      const isOverdue = action.due_date < today;
      queueReminder({
        userId: action.user_id,
        sourceType: 'action',
        sourceId: action.id,
        key: isOverdue ? `action:overdue:${today}` : `action:due:${today}`,
        scheduledFor: todayReminderAt,
        title: isOverdue ? '行动项已逾期' : '行动项今日到期',
        body: action.content,
      }, currentIso);
    }
  }

  async function runTick() {
    const current = now();
    if (!(current instanceof Date) || Number.isNaN(current.getTime())) {
      throw new Error('now() must return a valid Date');
    }
    discoverDueReminders(current);
    const currentIso = current.toISOString();
    for (const reminder of pendingReminders.all(currentIso)) {
      try {
        await notify({
          id: reminder.id,
          userId: reminder.user_id,
          sourceType: reminder.source_type,
          sourceId: reminder.source_id,
          reminderKey: reminder.reminder_key,
          scheduledFor: reminder.scheduled_for,
          title: reminder.title,
          body: reminder.body,
        });
        markDelivered.run(currentIso, currentIso, reminder.id);
      } catch (error) {
        markFailed.run(truncateError(error), currentIso, reminder.id);
        logger.warn?.('[meeting-reminders] Delivery failed:', truncateError(error));
      }
    }
  }

  function tick() {
    if (activeTick) return activeTick;
    activeTick = runTick().finally(() => {
      activeTick = null;
    });
    return activeTick;
  }

  function start() {
    if (timer) return;
    void tick().catch((error) => logger.error?.('[meeting-reminders] Tick failed:', error));
    timer = setInterval(() => {
      void tick().catch((error) => logger.error?.('[meeting-reminders] Tick failed:', error));
    }, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return { start, stop, tick };
}
