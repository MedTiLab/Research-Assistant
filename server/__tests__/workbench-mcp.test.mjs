import { describe, expect, it, vi } from 'vitest';

import { WorkbenchHttpError, createWorkbenchToolHandlers } from '../workbench-mcp.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('workbench MCP handlers', () => {
  it('builds a bounded overview and keeps the access token out of tool output', async () => {
    const meetings = Array.from({ length: 14 }, (_, index) => ({
      id: `meeting-${index}`,
      title: `Meeting ${index}`,
      meetingDate: `2026-09-${String(index + 2).padStart(2, '0')}T10:00:00.000Z`,
      status: index < 2 ? 'done' : 'upcoming',
      myRole: 'presenter',
    }));
    const actions = Array.from({ length: 35 }, (_, index) => ({
      id: `action-${index}`,
      content: `Action ${index}`,
      dueDate: index < 3 ? '2026-08-31' : '2026-09-20',
      status: 'open',
    }));
    const fetchImpl = vi.fn(async (url, options) => {
      expect(options.headers.Authorization).toBe('Bearer secret-token');
      if (url.endsWith('/meetings')) return jsonResponse({ meetings });
      if (url.includes('/calendar-todos?')) return jsonResponse({ todos: [
        { id: 'today-1', completed: false }, { id: 'today-2', completed: true },
      ] });
      return jsonResponse({ actions });
    });
    const handlers = createWorkbenchToolHandlers({
      baseUrl: 'http://127.0.0.1:3001/api/research',
      token: 'secret-token',
      fetchImpl,
      now: () => new Date('2026-09-01T00:00:00.000Z'),
    });

    const result = await handlers.overview();

    expect(result.structuredContent).toMatchObject({
      nextMeeting: { id: 'meeting-2' },
      openActionCount: 35,
      overdueActionCount: 3,
      todayTodoCount: 1,
      totals: { meetings: 14, actions: 35 },
      truncated: { meetings: true, actions: true },
    });
    expect(result.structuredContent.meetings).toHaveLength(10);
    expect(result.structuredContent.actions).toHaveLength(30);
    expect(result.content[0].text).not.toContain('secret-token');
  });

  it('reads notes and maps confirmed calendar mutations to strict routes', async () => {
    const fetchImpl = vi.fn(async (url, options) => {
      if (url.includes('/notes/workbench')) return jsonResponse({ notes: [{ id: 'note-1', kind: 'daily_goal' }] });
      return jsonResponse({ todo: { id: 'todo-1', completed: options.method === 'PATCH' } }, options.method === 'POST' ? 201 : 200);
    });
    const handlers = createWorkbenchToolHandlers({ baseUrl: 'http://localhost/api/research', fetchImpl });

    const notes = await handlers.notes_list({ kind: 'daily_goal', day: '2026-09-01' });
    expect(notes.structuredContent.notes).toHaveLength(1);
    await handlers.calendar_create({ title: '准备汇报', date: '2026-09-03' });
    const updated = await handlers.calendar_update({ calendarId: 'todo/1', completed: true });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost/api/research/calendar-todos/todo%2F1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ completed: true }) }),
    );
    expect(updated.structuredContent).toMatchObject({ confirmed: true, todo: { completed: true } });
  });

  it('summarizes transcript state in meeting_get and leaves full text to transcript_get', async () => {
    const fetchImpl = vi.fn(async (url) => {
      if (url.endsWith('/transcript')) {
        return jsonResponse({ segments: [{ id: 'segment-1', text: 'full transcript' }] });
      }
      return jsonResponse({
        meeting: {
          id: 'meeting-1',
          title: 'Weekly meeting',
          transcriptSegments: [
            { id: 'segment-1', status: 'done', text: 'full transcript' },
            { id: 'segment-2', status: 'failed', text: null },
          ],
        },
      });
    });
    const handlers = createWorkbenchToolHandlers({ baseUrl: 'http://localhost/api/research', fetchImpl });

    const meeting = await handlers.meeting_get({ meetingId: 'meeting-1' });
    const transcript = await handlers.transcript_get({ meetingId: 'meeting-1' });

    expect(meeting.structuredContent.meeting).not.toHaveProperty('transcriptSegments');
    expect(meeting.structuredContent.meeting.transcriptSummary).toEqual({
      segmentCount: 2,
      statuses: { done: 1, failed: 1 },
      hasTranscript: true,
    });
    expect(transcript.structuredContent.segments[0].text).toBe('full transcript');
  });

  it('maps mutation identifiers to route parameters and returns confirmed only after success', async () => {
    const fetchImpl = vi.fn(async (_url, options) => jsonResponse({ action: { id: 'action-1' } }, 201));
    const handlers = createWorkbenchToolHandlers({ baseUrl: 'http://localhost/api/research', fetchImpl });

    const result = await handlers.note_promote({
      noteId: 'note/1',
      content: 'Prepare the revision',
      dueDate: '2026-09-05',
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost/api/research/notes/note%2F1/promote',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content: 'Prepare the revision', dueDate: '2026-09-05' }),
      }),
    );
    expect(result.structuredContent).toEqual({ confirmed: true, action: { id: 'action-1' } });
  });

  it('passes the server validation message through without exposing authorization', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'Unknown field(s): invented' }, 400));
    const handlers = createWorkbenchToolHandlers({
      baseUrl: 'http://localhost/api/research', token: 'secret-token', fetchImpl,
    });

    await expect(handlers.meeting_create({ invented: true })).rejects.toMatchObject({
      name: 'WorkbenchHttpError',
      status: 400,
      message: 'Unknown field(s): invented',
    });
    await handlers.meeting_create({ invented: true }).catch((error) => {
      expect(error).toBeInstanceOf(WorkbenchHttpError);
      expect(JSON.stringify(error)).not.toContain('secret-token');
    });
  });

  it('maps thesis, submission, and daily loop operations to the Pi workbench routes', async () => {
    const fetchImpl = vi.fn(async (url, options) => jsonResponse({ url, method: options.method }, options.method === 'POST' ? 201 : 200));
    const handlers = createWorkbenchToolHandlers({ baseUrl: 'http://localhost/api/research', fetchImpl });

    await handlers.thesis_get({ thesisId: 'thesis/1' });
    await handlers.submission_update({ submissionId: 'submission/1', status: 'under_review' });
    await handlers.daily_review_save({
      date: '2026-09-02', accomplishments: '完成分析', obstacles: '', insights: '', tomorrowPriorities: ['整理图表'], mood: 4,
    });
    await handlers.habit_entry_update({ habitId: 'habit/1', date: '2026-09-02', completed: true });

    expect(fetchImpl).toHaveBeenCalledWith('http://localhost/api/research/theses/thesis%2F1', expect.objectContaining({ method: 'GET' }));
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost/api/research/submissions/submission%2F1', expect.objectContaining({ method: 'PATCH' }));
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost/api/research/daily-reviews/2026-09-02', expect.objectContaining({ method: 'PUT' }));
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost/api/research/habits/habit%2F1/entries/2026-09-02', expect.objectContaining({ method: 'PUT' }));
  });
});
