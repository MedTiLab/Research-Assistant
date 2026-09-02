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
  ResearchTask,
  ResearchSecretarySnapshot,
} from '../domain/types';
import type { Project } from '../../../types/app';

export interface StartAgentRunInput {
  projectId?: string;
  capability: string;
  prompt?: string;
  idempotencyKey?: string;
}

export interface ResearchSecretaryApi {
  getSnapshot(projects?: Project[]): Promise<ResearchSecretarySnapshot>;
  listAgentRuns(): Promise<AgentRun[]>;
  startAgentRun(input: StartAgentRunInput): Promise<AgentRun>;
  cancelAgentRun(runId: string): Promise<void>;
  listAutomationJobs(): Promise<AutomationJob[]>;
  listAutomationRuns(jobId?: string): Promise<AutomationRun[]>;
  updateAutomationJob(jobId: string, patch: Partial<AutomationJob>): Promise<AutomationJob>;
  runAutomationJob(jobId: string): Promise<AgentRun>;
  listMeetings(): Promise<ResearchMeeting[]>;
  getMeeting(meetingId: string): Promise<ResearchMeeting>;
  createMeeting(input: Pick<ResearchMeeting, 'title' | 'meetingDate' | 'meetingType' | 'myRole'> & Partial<Pick<ResearchMeeting, 'location' | 'projectId' | 'status'>>): Promise<ResearchMeeting>;
  updateMeeting(meetingId: string, patch: Partial<Pick<ResearchMeeting, 'title' | 'meetingDate' | 'meetingType' | 'myRole' | 'location' | 'projectId' | 'status'>>): Promise<ResearchMeeting>;
  deleteMeeting(meetingId: string): Promise<void>;
  createAgendaItem(meetingId: string, input: Pick<MeetingAgendaItem, 'kind' | 'title'> & Partial<Pick<MeetingAgendaItem, 'detail' | 'sourceRef' | 'orderIndex' | 'done'>>): Promise<MeetingAgendaItem>;
  updateAgendaItem(itemId: string, patch: Partial<Omit<MeetingAgendaItem, 'id' | 'meetingId'>>): Promise<MeetingAgendaItem>;
  deleteAgendaItem(itemId: string): Promise<void>;
  createNote(meetingId: string, input: Pick<MeetingNote, 'content' | 'noteType'> & Partial<Pick<MeetingNote, 'speaker' | 'sourceSegmentId'>>): Promise<MeetingNote>;
  promoteNote(noteId: string, input?: { content?: string; dueDate?: string; projectId?: string }): Promise<MeetingActionItem>;
  createAction(meetingId: string, input: Pick<MeetingActionItem, 'content'> & Partial<Pick<MeetingActionItem, 'dueDate' | 'status' | 'projectId'>>): Promise<MeetingActionItem>;
  updateAction(actionId: string, patch: Partial<Pick<MeetingActionItem, 'content' | 'dueDate' | 'status' | 'projectId'>>): Promise<MeetingActionItem>;
  /** Marks a dated research task done (or reopens it) through whichever backend owns it. */
  setTaskDone(task: ResearchTask, done: boolean): Promise<void>;
  promoteActionToTask(actionId: string, input?: { priority?: 'low' | 'medium' | 'high' | 'urgent'; stage?: string }): Promise<{ action: MeetingActionItem; task: ResearchTask }>;
  listOpenActions(): Promise<MeetingActionItem[]>;
  updateTranscriptSegment(segmentId: string, patch: Partial<Pick<MeetingTranscriptSegment, 'text' | 'speaker'>>): Promise<MeetingTranscriptSegment>;
  startRecording(meetingId: string, input: { provider: 'openai' | 'local'; language: string; privacyConsent?: boolean }): Promise<void>;
  uploadRecordingChunk(meetingId: string, input: { audio: Blob; segmentIndex: number; startMs: number; endMs: number; language: string }): Promise<MeetingTranscriptSegment>;
  stopRecording(meetingId: string): Promise<void>;
  retryTranscriptSegment(segmentId: string, language?: string): Promise<MeetingTranscriptSegment>;
  summarizeMeeting(meetingId: string): Promise<MeetingSummaryDraft>;
}
