import { authenticatedFetch } from '../../../utils/api';

export type WorkbenchCalendarTodo = {
  id: string;
  title: string;
  date: string;
  completed: boolean;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkbenchNoteKind = 'inbox' | 'daily_focus' | 'daily_goal';

export type WorkbenchNote = {
  id: string;
  kind: WorkbenchNoteKind;
  content: string;
  day?: string;
  createdAt: string;
  updatedAt: string;
};

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(path, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const workbenchStateApi = {
  async listCalendarTodos(from?: string, to?: string) {
    const query = new URLSearchParams();
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    const payload = await requestJson<{ todos: WorkbenchCalendarTodo[] }>(
      `/api/research/calendar-todos${query.size ? `?${query}` : ''}`,
    );
    return payload.todos;
  },
  async createCalendarTodo(input: {
    id?: string;
    title: string;
    date: string;
    completed?: boolean;
    projectId?: string;
    createdAt?: string;
  }) {
    const payload = await requestJson<{ todo: WorkbenchCalendarTodo }>('/api/research/calendar-todos', {
      method: 'POST', body: JSON.stringify(input),
    });
    return payload.todo;
  },
  async updateCalendarTodo(id: string, patch: Partial<Pick<WorkbenchCalendarTodo, 'title' | 'date' | 'completed' | 'projectId'>>) {
    const payload = await requestJson<{ todo: WorkbenchCalendarTodo }>(
      `/api/research/calendar-todos/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    );
    return payload.todo;
  },
  async deleteCalendarTodo(id: string) {
    await requestJson<void>(`/api/research/calendar-todos/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async listNotes(kind?: WorkbenchNoteKind, day?: string) {
    const query = new URLSearchParams();
    if (kind) query.set('kind', kind);
    if (day) query.set('day', day);
    const payload = await requestJson<{ notes: WorkbenchNote[] }>(
      `/api/research/notes/workbench${query.size ? `?${query}` : ''}`,
    );
    return payload.notes;
  },
  async saveNote(input: {
    id?: string;
    kind: WorkbenchNoteKind;
    content: string;
    day?: string;
    createdAt?: string;
  }) {
    const payload = await requestJson<{ note: WorkbenchNote }>('/api/research/notes/workbench', {
      method: 'PUT', body: JSON.stringify(input),
    });
    return payload.note;
  },
  async deleteNote(id: string) {
    await requestJson<void>(`/api/research/notes/workbench/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};
