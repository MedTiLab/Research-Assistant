const DEFAULT_TIMEOUT_MS = 10_000;

function toolResult(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function normalizedBaseUrl(value) {
  const baseUrl = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
  if (!baseUrl) throw new Error('MedHelp workbench base URL is required');
  const parsed = new URL(baseUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('MedHelp workbench base URL must use HTTP or HTTPS');
  }
  return parsed.toString().replace(/\/+$/, '');
}

function normalizedToken(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function addQuery(pathname, params = {}) {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (entries.length === 0) return pathname;
  const query = new URLSearchParams(entries.map(([key, value]) => [key, String(value)]));
  return `${pathname}?${query.toString()}`;
}

function createTimeoutSignal(signal, timeoutMs) {
  if (signal) return signal;
  return AbortSignal.timeout(timeoutMs);
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

export class WorkbenchHttpError extends Error {
  constructor(status, payload) {
    const message = typeof payload?.error === 'string' && payload.error.trim()
      ? payload.error.trim()
      : `Workbench request failed with status ${status}`;
    super(message);
    this.name = 'WorkbenchHttpError';
    this.status = status;
    this.payload = payload;
  }
}

function isOverdue(action, today) {
  return typeof action?.dueDate === 'string'
    && action.dueDate < today
    && action.status !== 'done'
    && action.status !== 'dropped';
}

function localDateOnly(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function transcriptSummary(segments) {
  const safeSegments = Array.isArray(segments) ? segments : [];
  const statuses = {};
  for (const segment of safeSegments) {
    const status = typeof segment?.status === 'string' ? segment.status : 'unknown';
    statuses[status] = (statuses[status] || 0) + 1;
  }
  return {
    segmentCount: safeSegments.length,
    statuses,
    hasTranscript: safeSegments.some((segment) => typeof segment?.text === 'string' && segment.text.trim()),
  };
}

export function createWorkbenchToolHandlers({
  baseUrl = process.env.MEDHELP_WORKBENCH_BASE_URL,
  token = process.env.MEDHELP_WORKBENCH_TOKEN,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => new Date(),
} = {}) {
  const apiBaseUrl = normalizedBaseUrl(baseUrl);
  const accessToken = normalizedToken(token);
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');

  const request = async (pathname, { method = 'GET', body, signal } = {}) => {
    const headers = { Accept: 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetchImpl(`${apiBaseUrl}${pathname}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: createTimeoutSignal(signal, timeoutMs),
    });
    const payload = await parseResponse(response);
    if (!response.ok) throw new WorkbenchHttpError(response.status, payload);
    return payload;
  };

  const mutation = async (pathname, method, body, signal) => {
    const payload = await request(pathname, { method, body, signal });
    return toolResult({ confirmed: true, ...(payload && typeof payload === 'object' ? payload : {}) });
  };

  return {
    async overview(_input = {}, { signal } = {}) {
      const current = now();
      const today = localDateOnly(current);
      const [meetingPayload, actionPayload, calendarPayload, todayPayload, thesisPayload, submissionPayload] = await Promise.all([
        request('/meetings', { signal }),
        request('/actions/open', { signal }),
        request(addQuery('/calendar-todos', { from: today, to: today }), { signal }),
        request(addQuery('/today-status', { date: today }), { signal }),
        request('/theses', { signal }),
        request('/submissions', { signal }),
      ]);
      const meetings = Array.isArray(meetingPayload?.meetings) ? meetingPayload.meetings : [];
      const actions = Array.isArray(actionPayload?.actions) ? actionPayload.actions : [];
      const todayTodos = Array.isArray(calendarPayload?.todos) ? calendarPayload.todos : [];
      const theses = Array.isArray(thesisPayload?.theses) ? thesisPayload.theses : [];
      const submissions = Array.isArray(submissionPayload?.submissions) ? submissionPayload.submissions : [];
      const nowIso = current.toISOString();
      const upcoming = meetings.filter((meeting) => (
        meeting?.status !== 'done' && typeof meeting?.meetingDate === 'string' && meeting.meetingDate >= nowIso
      ));
      const recentMeetings = meetings
        .filter((meeting) => typeof meeting?.meetingDate === 'string' && meeting.meetingDate < nowIso)
        .sort((left, right) => right.meetingDate.localeCompare(left.meetingDate))
        .slice(0, 3);
      const overdueActions = actions.filter((action) => isOverdue(action, today));
      return toolResult({
        generatedAt: nowIso,
        nextMeeting: upcoming[0] || null,
        openActionCount: actions.length,
        overdueActionCount: overdueActions.length,
        todayTodoCount: todayTodos.filter((todo) => !todo?.completed).length,
        todayTodos: todayTodos.slice(0, 30),
        todayStatus: todayPayload?.status || null,
        theses: theses.slice(0, 10),
        submissions: submissions.slice(0, 15),
        recentMeetings,
        meetings: meetings.slice(0, 10),
        actions: actions.slice(0, 30),
        totals: { meetings: meetings.length, actions: actions.length, theses: theses.length, submissions: submissions.length },
        truncated: { meetings: meetings.length > 10, actions: actions.length > 30, theses: theses.length > 10, submissions: submissions.length > 15 },
      });
    },

    async meeting_list({ from, to, status } = {}, { signal } = {}) {
      return toolResult(await request(addQuery('/meetings', { from, to, status }), { signal }));
    },

    async meeting_get({ meetingId } = {}, { signal } = {}) {
      const payload = await request(`/meetings/${encodeURIComponent(meetingId)}`, { signal });
      const meeting = payload?.meeting;
      if (!meeting || typeof meeting !== 'object') return toolResult(payload);
      const { transcriptSegments, ...rest } = meeting;
      return toolResult({ meeting: { ...rest, transcriptSummary: transcriptSummary(transcriptSegments) } });
    },

    async action_list({ status, overdue } = {}, { signal } = {}) {
      const payload = await request('/actions/open', { signal });
      const today = localDateOnly(now());
      const actions = (Array.isArray(payload?.actions) ? payload.actions : []).filter((action) => {
        if (status && action?.status !== status) return false;
        if (overdue !== undefined && isOverdue(action, today) !== overdue) return false;
        return true;
      });
      return toolResult({ actions });
    },

    async transcript_get({ meetingId } = {}, { signal } = {}) {
      return toolResult(await request(`/meetings/${encodeURIComponent(meetingId)}/transcript`, { signal }));
    },

    async calendar_list({ from, to } = {}, { signal } = {}) {
      return toolResult(await request(addQuery('/calendar-todos', { from, to }), { signal }));
    },

    async notes_list({ kind, day } = {}, { signal } = {}) {
      return toolResult(await request(addQuery('/notes/workbench', { kind, day }), { signal }));
    },

    async today_status({ date } = {}, { signal } = {}) {
      return toolResult(await request(addQuery('/today-status', { date }), { signal }));
    },

    async thesis_list(_input = {}, { signal } = {}) {
      return toolResult(await request('/theses', { signal }));
    },

    async thesis_get({ thesisId } = {}, { signal } = {}) {
      return toolResult(await request(`/theses/${encodeURIComponent(thesisId)}`, { signal }));
    },

    async submission_list({ status } = {}, { signal } = {}) {
      return toolResult(await request(addQuery('/submissions', { status }), { signal }));
    },

    async submission_get({ submissionId } = {}, { signal } = {}) {
      return toolResult(await request(`/submissions/${encodeURIComponent(submissionId)}`, { signal }));
    },

    async daily_review_get({ date } = {}, { signal } = {}) {
      return toolResult(await request(addQuery('/daily-reviews', { date }), { signal }));
    },

    async habit_list({ date } = {}, { signal } = {}) {
      return toolResult(await request(addQuery('/habits', { date }), { signal }));
    },

    async meeting_create(input = {}, { signal } = {}) {
      return mutation('/meetings', 'POST', input, signal);
    },

    async meeting_update({ meetingId, ...changes } = {}, { signal } = {}) {
      return mutation(`/meetings/${encodeURIComponent(meetingId)}`, 'PATCH', changes, signal);
    },

    async agenda_add({ meetingId, ...item } = {}, { signal } = {}) {
      return mutation(`/meetings/${encodeURIComponent(meetingId)}/agenda`, 'POST', item, signal);
    },

    async agenda_update({ agendaId, ...changes } = {}, { signal } = {}) {
      return mutation(`/agenda/${encodeURIComponent(agendaId)}`, 'PATCH', changes, signal);
    },

    async note_add({ meetingId, ...note } = {}, { signal } = {}) {
      return mutation(`/meetings/${encodeURIComponent(meetingId)}/notes`, 'POST', note, signal);
    },

    async note_promote({ noteId, ...action } = {}, { signal } = {}) {
      return mutation(`/notes/${encodeURIComponent(noteId)}/promote`, 'POST', action, signal);
    },

    async action_create({ meetingId, ...action } = {}, { signal } = {}) {
      return mutation(`/meetings/${encodeURIComponent(meetingId)}/actions`, 'POST', action, signal);
    },

    async action_update({ actionId, ...changes } = {}, { signal } = {}) {
      return mutation(`/actions/${encodeURIComponent(actionId)}`, 'PATCH', changes, signal);
    },

    async action_promote_task({ actionId, ...options } = {}, { signal } = {}) {
      return mutation(`/actions/${encodeURIComponent(actionId)}/promote-task`, 'POST', options, signal);
    },

    async transcript_update({ segmentId, ...changes } = {}, { signal } = {}) {
      return mutation(`/transcript/${encodeURIComponent(segmentId)}`, 'PATCH', changes, signal);
    },

    async calendar_create(input = {}, { signal } = {}) {
      return mutation('/calendar-todos', 'POST', input, signal);
    },

    async calendar_update({ calendarId, ...changes } = {}, { signal } = {}) {
      return mutation(`/calendar-todos/${encodeURIComponent(calendarId)}`, 'PATCH', changes, signal);
    },

    async thesis_create(input = {}, { signal } = {}) {
      return mutation('/theses', 'POST', input, signal);
    },

    async thesis_update({ thesisId, ...changes } = {}, { signal } = {}) {
      return mutation(`/theses/${encodeURIComponent(thesisId)}`, 'PATCH', changes, signal);
    },

    async thesis_chapter_add({ thesisId, ...chapter } = {}, { signal } = {}) {
      return mutation(`/theses/${encodeURIComponent(thesisId)}/chapters`, 'POST', chapter, signal);
    },

    async thesis_chapter_update({ chapterId, ...changes } = {}, { signal } = {}) {
      return mutation(`/thesis-chapters/${encodeURIComponent(chapterId)}`, 'PATCH', changes, signal);
    },

    async thesis_milestone_add({ thesisId, ...milestone } = {}, { signal } = {}) {
      return mutation(`/theses/${encodeURIComponent(thesisId)}/milestones`, 'POST', milestone, signal);
    },

    async thesis_milestone_update({ milestoneId, ...changes } = {}, { signal } = {}) {
      return mutation(`/thesis-milestones/${encodeURIComponent(milestoneId)}`, 'PATCH', changes, signal);
    },

    async thesis_log_add({ thesisId, ...log } = {}, { signal } = {}) {
      return mutation(`/theses/${encodeURIComponent(thesisId)}/logs`, 'POST', log, signal);
    },

    async submission_create(input = {}, { signal } = {}) {
      return mutation('/submissions', 'POST', input, signal);
    },

    async submission_update({ submissionId, ...changes } = {}, { signal } = {}) {
      return mutation(`/submissions/${encodeURIComponent(submissionId)}`, 'PATCH', changes, signal);
    },

    async daily_review_save({ date, ...review } = {}, { signal } = {}) {
      return mutation(`/daily-reviews/${encodeURIComponent(date)}`, 'PUT', review, signal);
    },

    async attendance_start(input = {}, { signal } = {}) {
      return mutation('/attendance/start', 'POST', input, signal);
    },

    async attendance_end(input = {}, { signal } = {}) {
      return mutation('/attendance/end', 'POST', input, signal);
    },

    async focus_log(input = {}, { signal } = {}) {
      return mutation('/focus-sessions', 'POST', input, signal);
    },

    async habit_create(input = {}, { signal } = {}) {
      return mutation('/habits', 'POST', input, signal);
    },

    async habit_entry_update({ habitId, date, ...entry } = {}, { signal } = {}) {
      return mutation(`/habits/${encodeURIComponent(habitId)}/entries/${encodeURIComponent(date)}`, 'PUT', entry, signal);
    },
  };
}

export { DEFAULT_TIMEOUT_MS, toolResult };
