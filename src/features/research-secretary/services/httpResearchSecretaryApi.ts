import { authenticatedFetch } from '../../../utils/api';
import type { Project } from '../../../types/app';
import type {
  AgentRun,
  AutomationJob,
  AutomationRun,
  MeetingActionItem,
  MeetingAgendaItem,
  MeetingNote,
  MeetingTranscriptSegment,
  MeetingSummaryDraft,
  ResearchMeeting,
  ResearchArtifact,
  ResearchSecretarySnapshot,
  ResearchTask,
} from '../domain/types';
import type { ResearchSecretaryApi, StartAgentRunInput } from './researchSecretaryApi';
import { listAutomationRecords, type AutomationRecord } from './automationsApi';

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(path, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function emptySnapshot(): ResearchSecretarySnapshot {
  return {
    tasks: [],
    theses: [],
    manuscripts: [],
    submissions: [],
    advisorActions: [],
    meetings: [],
    presentations: [],
    literatureAlerts: [],
    artifacts: [],
    agentRuns: [],
    automationJobs: [],
    automationRuns: [],
  };
}

function actionAsTask(action: MeetingActionItem): ResearchTask {
  const status = action.status === 'done' ? 'done' : action.status === 'in_progress' ? 'in_progress' : 'todo';
  return {
    id: action.id,
    projectId: action.projectId,
    title: action.content,
    status,
    priority: action.dueDate && new Date(action.dueDate).getTime() < Date.now() ? 'urgent' : 'medium',
    dueAt: action.dueDate,
    source: 'meeting',
    origin: 'meeting_action',
  };
}

type ResearchSnapshotPayload = {
  meetings: ResearchMeeting[];
  openActions: MeetingActionItem[];
  advisorNotes: Array<MeetingNote & {
    projectId?: string;
    actionStatus?: MeetingActionItem['status'];
    actionDueDate?: string;
  }>;
};

type TaskmasterTask = {
  id: string | number;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  dueAt?: string;
  source?: string;
  sourceMeetingActionId?: string;
  nextActionPrompt?: string;
};

type ArtifactRecord = {
  name?: string;
  relativePath?: string;
  category?: string;
  modified?: string;
};

type AgentRunRecord = {
  id?: string;
  projectKey?: string;
  runtimeId?: string;
  commandPreview?: string;
  status?: string;
  errorMessage?: string | null;
  createdAt?: number | string;
  startedAt?: number | string | null;
  finishedAt?: number | string | null;
};

type NewsPaper = {
  id?: string;
  title?: string;
  published?: string;
  relevance_score?: number;
  final_score?: number;
  matched_domain?: string;
  matched_keywords?: string[];
  link?: string;
  pdf_link?: string;
  source?: string;
};

function dateValue(value?: number | string | null) {
  if (value === undefined || value === null || value === '') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function taskStatus(status?: string): ResearchTask['status'] | null {
  if (status === 'pending') return 'todo';
  if (status === 'in-progress' || status === 'review') return 'in_progress';
  if (status === 'deferred') return 'blocked';
  if (status === 'done') return 'done';
  return null;
}

function taskPriority(priority?: string): ResearchTask['priority'] {
  return priority === 'low' || priority === 'medium' || priority === 'high' || priority === 'urgent'
    ? priority
    : 'medium';
}

function taskmasterAsTask(task: TaskmasterTask, project: Project): ResearchTask | null {
  const status = taskStatus(task.status);
  if (!status) return null;
  return {
    id: `${project.name}:${String(task.id)}`,
    projectId: project.name,
    title: task.title || '未命名任务',
    description: task.description,
    status,
    priority: taskPriority(task.priority),
    dueAt: dateValue(task.dueAt),
    source: task.source === 'meeting' || task.sourceMeetingActionId ? 'meeting' : 'manual',
    nextAction: task.nextActionPrompt || undefined,
    origin: 'taskmaster',
  };
}

function automationAsJob(record: AutomationRecord): AutomationJob | null {
  if (record.status === 'cancelled' || record.status === 'completed') return null;
  return {
    id: record.id,
    name: record.title,
    template: 'custom',
    projectId: record.projectKey,
    schedule: { kind: record.intervalMinutes ? 'interval' : 'manual' },
    status: record.lastStatus === 'failed' ? 'error' : record.status === 'paused' ? 'paused' : 'enabled',
    nextRunAt: record.nextRunAt || undefined,
    lastRunAt: record.lastRunAt,
    description: record.lastError || record.prompt,
  };
}

function agentRunStatus(status?: string): AgentRun['status'] | null {
  if (status === 'queued' || status === 'running' || status === 'failed' || status === 'cancelled') return status;
  if (status === 'completed') return 'succeeded';
  if (status === 'waiting_for_user') return 'waiting_for_user';
  return null;
}

function agentRecordAsRun(record: AgentRunRecord): AgentRun | null {
  const status = agentRunStatus(record.status);
  if (!record.id || !status) return null;
  const runtime = record.runtimeId?.toLowerCase();
  return {
    id: record.id,
    projectId: record.projectKey,
    capability: runtime ? `runtime.${runtime}` : 'research.agent',
    displayName: record.commandPreview || '科研 Agent 运行',
    provider: runtime === 'claude' ? 'claude' : runtime === 'codex' ? 'codex' : 'other',
    status,
    startedAt: dateValue(record.startedAt ?? record.createdAt),
    finishedAt: dateValue(record.finishedAt),
    error: record.errorMessage || undefined,
  };
}

function artifactKind(record: ArtifactRecord): ResearchArtifact['kind'] {
  const path = `${record.category || ''}/${record.relativePath || record.name || ''}`.toLowerCase();
  if (/\.(png|jpe?g|gif|svg|webp|tiff?)$/.test(path)) return 'figure';
  if (/\.(pptx?|key)$/.test(path)) return 'presentation';
  if (/\.(csv|tsv|xlsx?|ods)$/.test(path)) return 'table';
  if (/\.(parquet|sav|dta|rds|db|sqlite)$/.test(path)) return 'dataset';
  if (/\.(py|r|js|ts|jsx|tsx|ipynb|sh)$/.test(path)) return 'code';
  if (/(paper|draft|manuscript)/.test(path)) return 'manuscript';
  return 'report';
}

async function listProjectData(projects: Project[]) {
  return Promise.all(projects.map(async (project) => {
    const [tasksResult, artifactsResult] = await Promise.allSettled([
      requestJson<{ tasks?: TaskmasterTask[] }>(`/api/taskmaster/tasks/${encodeURIComponent(project.name)}`),
      requestJson<{ artifacts?: ArtifactRecord[] }>(`/api/taskmaster/artifacts/${encodeURIComponent(project.name)}`),
    ]);
    return {
      project,
      tasks: tasksResult.status === 'fulfilled' ? tasksResult.value.tasks || [] : [],
      artifacts: artifactsResult.status === 'fulfilled' ? artifactsResult.value.artifacts || [] : [],
    };
  }));
}

function mapLiterature(results: Record<string, { top_papers?: NewsPaper[] }> | undefined) {
  return Object.entries(results || {}).flatMap(([source, value]) => (
    Array.isArray(value?.top_papers) ? value.top_papers : []
  ).map((paper, index) => ({
    id: `${source}:${paper.id || index}`,
    title: paper.title || '未命名文献',
    publishedAt: dateValue(paper.published),
    relevanceScore: Number(paper.relevance_score ?? paper.final_score ?? 0),
    reason: paper.matched_domain || paper.matched_keywords?.join('、') || `来自 ${source}`,
    url: paper.link || paper.pdf_link,
    read: false,
  })));
}

export function createHttpResearchSecretaryApi(): ResearchSecretaryApi {
  const listMeetings = async () => {
    const payload = await requestJson<{ meetings: ResearchMeeting[] }>('/api/research/meetings');
    return payload.meetings;
  };

  const getMeeting = async (meetingId: string) => {
    const payload = await requestJson<{ meeting: ResearchMeeting }>(`/api/research/meetings/${encodeURIComponent(meetingId)}`);
    return payload.meeting;
  };

  return {
    async getSnapshot(projects = []) {
      const [research, projectData, automations, runsResult, newsResult, trackingResult, thesisResult] = await Promise.all([
        requestJson<ResearchSnapshotPayload>('/api/research/snapshot'),
        listProjectData(projects),
        listAutomationRecords(projects),
        requestJson<{ runs?: AgentRunRecord[] }>('/api/agent-runs').catch(() => ({ runs: [] })),
        requestJson<{ results?: Record<string, { top_papers?: NewsPaper[] }> }>('/api/news/bootstrap').catch(() => ({ results: {} })),
        requestJson<{ manuscripts?: ResearchSecretarySnapshot['manuscripts']; submissions?: ResearchSecretarySnapshot['submissions'] }>('/api/research/submissions').catch(() => ({ manuscripts: [], submissions: [] })),
        requestJson<{ theses?: ResearchSecretarySnapshot['theses'] }>('/api/research/theses').catch(() => ({ theses: [] })),
      ]);
      const taskmasterTasks = projectData.flatMap(({ project, tasks }) => tasks.map((task) => ({ project, task })));
      const promotedActionIds = new Set(taskmasterTasks.map(({ task }) => task.sourceMeetingActionId).filter(Boolean));
      const snapshot = emptySnapshot();
      snapshot.meetings = research.meetings;
      snapshot.theses = thesisResult.theses || [];
      snapshot.manuscripts = trackingResult.manuscripts || [];
      snapshot.submissions = trackingResult.submissions || [];
      snapshot.tasks = [
        ...research.openActions.filter((action) => !promotedActionIds.has(action.id)).map(actionAsTask),
        ...taskmasterTasks.map(({ task, project }) => taskmasterAsTask(task, project)).filter((task): task is ResearchTask => Boolean(task)),
      ];
      snapshot.advisorActions = research.advisorNotes.map((note) => ({
        id: note.id,
        actionId: note.promotedActionId,
        projectId: note.projectId,
        title: note.content,
        advisorName: note.speaker,
        source: 'meeting_note' as const,
        status: note.actionStatus === 'done' || note.actionStatus === 'dropped'
          ? 'done' as const
          : note.actionStatus === 'in_progress' ? 'in_progress' as const : 'open' as const,
        priority: 'medium' as const,
        dueAt: note.actionDueDate,
        feedback: note.content,
      }));
      snapshot.automationJobs = automations.records.map(automationAsJob).filter((job): job is AutomationJob => Boolean(job));
      snapshot.agentRuns = (runsResult.runs || []).map(agentRecordAsRun).filter((run): run is AgentRun => Boolean(run));
      snapshot.literatureAlerts = mapLiterature(newsResult.results);
      snapshot.artifacts = projectData.flatMap(({ project, artifacts }) => artifacts.map((artifact, index) => ({
        id: `${project.name}:${artifact.relativePath || artifact.name || index}`,
        projectId: project.name,
        title: artifact.name || artifact.relativePath || '未命名产物',
        kind: artifactKind(artifact),
        updatedAt: dateValue(artifact.modified) || new Date(0).toISOString(),
        path: artifact.relativePath,
      })));
      return snapshot;
    },
    async listAgentRuns(): Promise<AgentRun[]> {
      const payload = await requestJson<{ runs?: AgentRunRecord[] }>('/api/agent-runs');
      return (payload.runs || []).map(agentRecordAsRun).filter((run): run is AgentRun => Boolean(run));
    },
    async startAgentRun(_input: StartAgentRunInput): Promise<AgentRun> { throw new Error('科研 Agent 运行接口尚未接入'); },
    async cancelAgentRun(_runId: string): Promise<void> { throw new Error('科研 Agent 运行接口尚未接入'); },
    async listAutomationJobs(): Promise<AutomationJob[]> { return []; },
    async listAutomationRuns(_jobId?: string): Promise<AutomationRun[]> { return []; },
    async updateAutomationJob(_jobId: string, _patch: Partial<AutomationJob>): Promise<AutomationJob> { throw new Error('自动化接口尚未接入'); },
    async runAutomationJob(_jobId: string): Promise<AgentRun> { throw new Error('自动化接口尚未接入'); },
    listMeetings,
    getMeeting,
    async createMeeting(input) {
      const payload = await requestJson<{ meeting: ResearchMeeting }>('/api/research/meetings', { method: 'POST', body: JSON.stringify(input) });
      return payload.meeting;
    },
    async updateMeeting(meetingId, patch) {
      const payload = await requestJson<{ meeting: ResearchMeeting }>(`/api/research/meetings/${encodeURIComponent(meetingId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
      return payload.meeting;
    },
    async deleteMeeting(meetingId) {
      await requestJson<void>(`/api/research/meetings/${encodeURIComponent(meetingId)}`, { method: 'DELETE' });
    },
    async createAgendaItem(meetingId, input) {
      const payload = await requestJson<{ agendaItem: MeetingAgendaItem }>(`/api/research/meetings/${encodeURIComponent(meetingId)}/agenda`, { method: 'POST', body: JSON.stringify(input) });
      return payload.agendaItem;
    },
    async updateAgendaItem(itemId, patch) {
      const payload = await requestJson<{ agendaItem: MeetingAgendaItem }>(`/api/research/agenda/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
      return payload.agendaItem;
    },
    async deleteAgendaItem(itemId) {
      await requestJson<void>(`/api/research/agenda/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
    },
    async createNote(meetingId, input) {
      const payload = await requestJson<{ note: MeetingNote }>(`/api/research/meetings/${encodeURIComponent(meetingId)}/notes`, { method: 'POST', body: JSON.stringify(input) });
      return payload.note;
    },
    async promoteNote(noteId, input = {}) {
      const payload = await requestJson<{ action: MeetingActionItem }>(`/api/research/notes/${encodeURIComponent(noteId)}/promote`, { method: 'POST', body: JSON.stringify(input) });
      return payload.action;
    },
    async createAction(meetingId, input) {
      const payload = await requestJson<{ action: MeetingActionItem }>(`/api/research/meetings/${encodeURIComponent(meetingId)}/actions`, { method: 'POST', body: JSON.stringify(input) });
      return payload.action;
    },
    async updateAction(actionId, patch) {
      const payload = await requestJson<{ action: MeetingActionItem }>(`/api/research/actions/${encodeURIComponent(actionId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
      return payload.action;
    },
    async setTaskDone(task, done) {
      if (task.origin === 'meeting_action') {
        await requestJson<{ action: MeetingActionItem }>(`/api/research/actions/${encodeURIComponent(task.id)}`, {
          method: 'PATCH', body: JSON.stringify({ status: done ? 'done' : 'open' }),
        });
        return;
      }
      // Taskmaster ids are namespaced as `<project>:<taskId>` when the snapshot is built.
      const separator = task.id.indexOf(':');
      const projectName = separator > 0 ? task.id.slice(0, separator) : '';
      const taskId = separator > 0 ? task.id.slice(separator + 1) : '';
      if (!projectName || !taskId) throw new Error('这条任务不支持在首页直接完成');
      await requestJson(`/api/taskmaster/update-task/${encodeURIComponent(projectName)}/${encodeURIComponent(taskId)}`, {
        method: 'PUT', body: JSON.stringify({ status: done ? 'done' : 'pending' }),
      });
    },
    async promoteActionToTask(actionId, input = {}) {
      return requestJson<{ action: MeetingActionItem; task: ResearchTask }>(`/api/research/actions/${encodeURIComponent(actionId)}/promote-task`, { method: 'POST', body: JSON.stringify(input) });
    },
    async listOpenActions() {
      const payload = await requestJson<{ actions: MeetingActionItem[] }>('/api/research/actions/open');
      return payload.actions;
    },
    async updateTranscriptSegment(segmentId, patch) {
      const payload = await requestJson<{ segment: MeetingTranscriptSegment }>(`/api/research/transcript/${encodeURIComponent(segmentId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
      return payload.segment;
    },
    async startRecording(meetingId, input) {
      await requestJson(`/api/research/meetings/${encodeURIComponent(meetingId)}/recording/start`, { method: 'POST', body: JSON.stringify(input) });
    },
    async uploadRecordingChunk(meetingId, input) {
      const form = new FormData();
      form.append('audio', input.audio, `segment-${input.segmentIndex}.webm`);
      form.append('segmentIndex', String(input.segmentIndex));
      form.append('startMs', String(input.startMs));
      form.append('endMs', String(input.endMs));
      form.append('language', input.language);
      const payload = await requestJson<{ segment: MeetingTranscriptSegment }>(`/api/research/meetings/${encodeURIComponent(meetingId)}/recording/chunk`, { method: 'POST', body: form });
      return payload.segment;
    },
    async stopRecording(meetingId) {
      await requestJson(`/api/research/meetings/${encodeURIComponent(meetingId)}/recording/stop`, { method: 'POST', body: JSON.stringify({}) });
    },
    async retryTranscriptSegment(segmentId, language = 'zh') {
      const payload = await requestJson<{ segment: MeetingTranscriptSegment }>(`/api/research/transcript/${encodeURIComponent(segmentId)}/retry`, { method: 'POST', body: JSON.stringify({ language }) });
      return payload.segment;
    },
    async summarizeMeeting(meetingId) {
      const payload = await requestJson<{ draft: MeetingSummaryDraft }>(`/api/research/meetings/${encodeURIComponent(meetingId)}/summarize`, { method: 'POST', body: JSON.stringify({}) });
      return payload.draft;
    },
  };
}
