import { authenticatedFetch } from '../../../utils/api';
import type {
  Manuscript,
  Submission,
  SubmissionDocument,
  SubmissionStatus,
  ThesisChapter,
  ThesisChapterStatus,
  ThesisMilestone,
  ThesisProgressLog,
  ThesisProject,
  ThesisStatus,
  WorkbenchAttendanceLog,
  WorkbenchDailyReview,
  WorkbenchFocusSession,
  WorkbenchHabit,
  WorkbenchTodayStatus,
} from '../domain/types';

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(path, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function json(method: string, body?: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) };
}

export const researchTrackingApi = {
  async listTheses() {
    return (await requestJson<{ theses: ThesisProject[] }>('/api/research/theses')).theses;
  },
  async getThesis(id: string) {
    return (await requestJson<{ thesis: ThesisProject }>(`/api/research/theses/${encodeURIComponent(id)}`)).thesis;
  },
  async createThesis(input: { title: string; degree?: string; targetDate?: string; projectId?: string; status?: ThesisStatus; completion?: number }) {
    return (await requestJson<{ thesis: ThesisProject }>('/api/research/theses', json('POST', input))).thesis;
  },
  async updateThesis(id: string, input: Partial<Pick<ThesisProject, 'title' | 'degree' | 'targetDate' | 'projectId' | 'status' | 'completion'>>) {
    return (await requestJson<{ thesis: ThesisProject }>(`/api/research/theses/${encodeURIComponent(id)}`, json('PATCH', input))).thesis;
  },
  async addChapter(thesisId: string, input: { title: string; status?: ThesisChapterStatus; completion?: number; orderIndex?: number; notes?: string }) {
    return (await requestJson<{ chapter: ThesisChapter }>(`/api/research/theses/${encodeURIComponent(thesisId)}/chapters`, json('POST', input))).chapter;
  },
  async updateChapter(id: string, input: Partial<Pick<ThesisChapter, 'title' | 'status' | 'completion' | 'orderIndex' | 'notes'>>) {
    return (await requestJson<{ chapter: ThesisChapter }>(`/api/research/thesis-chapters/${encodeURIComponent(id)}`, json('PATCH', input))).chapter;
  },
  async addMilestone(thesisId: string, input: { title: string; dueDate?: string; status?: ThesisMilestone['status'] }) {
    return (await requestJson<{ milestone: ThesisMilestone }>(`/api/research/theses/${encodeURIComponent(thesisId)}/milestones`, json('POST', input))).milestone;
  },
  async updateMilestone(id: string, input: Partial<Pick<ThesisMilestone, 'title' | 'dueDate' | 'status'>>) {
    return (await requestJson<{ milestone: ThesisMilestone }>(`/api/research/thesis-milestones/${encodeURIComponent(id)}`, json('PATCH', input))).milestone;
  },
  async addThesisLog(thesisId: string, input: { date: string; minutes?: number; words?: number; note?: string }) {
    return (await requestJson<{ log: ThesisProgressLog }>(`/api/research/theses/${encodeURIComponent(thesisId)}/logs`, json('POST', input))).log;
  },
  async listSubmissions() {
    return requestJson<{ submissions: Submission[]; manuscripts: Manuscript[] }>('/api/research/submissions');
  },
  async createSubmission(input: { title: string; shortTitle?: string; projectId?: string; journal: string; status?: SubmissionStatus; deadline?: string; trackingCode?: string; nextAction?: string; documents?: SubmissionDocument[]; completion?: number }) {
    return requestJson<{ submission: Submission; manuscript: Manuscript }>('/api/research/submissions', json('POST', input));
  },
  async updateSubmission(id: string, input: { title?: string; shortTitle?: string; journal?: string; status?: SubmissionStatus; deadline?: string | null; trackingCode?: string | null; nextAction?: string | null; documents?: SubmissionDocument[]; completion?: number }) {
    return requestJson<{ submission: Submission; manuscript: Manuscript }>(`/api/research/submissions/${encodeURIComponent(id)}`, json('PATCH', input));
  },
  async getTodayStatus(date?: string) {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    return (await requestJson<{ status: WorkbenchTodayStatus }>(`/api/research/today-status${query}`)).status;
  },
  async listHabits(date?: string) {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    return requestJson<{ date: string; habits: WorkbenchHabit[] }>(`/api/research/habits${query}`);
  },
  async createHabit(title: string) {
    return (await requestJson<{ habit: WorkbenchHabit }>('/api/research/habits', json('POST', { title }))).habit;
  },
  async setHabitEntry(habitId: string, date: string, input: { completed: boolean; value?: string }) {
    return requestJson(`/api/research/habits/${encodeURIComponent(habitId)}/entries/${encodeURIComponent(date)}`, json('PUT', input));
  },
  async getDailyReview(date: string) {
    return (await requestJson<{ review: WorkbenchDailyReview | null }>(`/api/research/daily-reviews?date=${encodeURIComponent(date)}`)).review;
  },
  async listDailyReviews(limit = 30) {
    return (await requestJson<{ reviews: WorkbenchDailyReview[] }>(`/api/research/daily-reviews?limit=${limit}`)).reviews;
  },
  async saveDailyReview(date: string, input: Pick<WorkbenchDailyReview, 'accomplishments' | 'obstacles' | 'insights' | 'tomorrowPriorities'> & { mood?: number }) {
    return (await requestJson<{ review: WorkbenchDailyReview }>(`/api/research/daily-reviews/${encodeURIComponent(date)}`, json('PUT', input))).review;
  },
  async listAttendance(date?: string) {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    return (await requestJson<{ date: string; attendance: WorkbenchAttendanceLog[] }>(`/api/research/attendance${query}`)).attendance;
  },
  async startWork() {
    return requestJson('/api/research/attendance/start', json('POST', {}));
  },
  async endWork() {
    return requestJson('/api/research/attendance/end', json('POST', {}));
  },
  async clearAttendance(date?: string) {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    return requestJson<{ date: string; deleted: number }>(`/api/research/attendance${query}`, { method: 'DELETE' });
  },
  async deleteAttendance(id: string) {
    return requestJson<{ deleted: boolean; id: string }>(`/api/research/attendance/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
  async listFocusSessions(date?: string) {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    return (await requestJson<{ date: string; focusSessions: WorkbenchFocusSession[] }>(`/api/research/focus-sessions${query}`)).focusSessions;
  },
  async logFocus(input: { date?: string; minutes: number; taskTitle?: string }) {
    return requestJson('/api/research/focus-sessions', json('POST', input));
  },
  async clearFocusSessions(date?: string) {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    return requestJson<{ date: string; deleted: number }>(`/api/research/focus-sessions${query}`, { method: 'DELETE' });
  },
  async deleteFocusSession(id: string) {
    return requestJson<{ deleted: boolean; id: string }>(`/api/research/focus-sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};
