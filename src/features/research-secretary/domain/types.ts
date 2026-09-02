export type ISODateTime = string;

export type ResearchTaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done';
export type ResearchTaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface ResearchTask {
  id: string;
  projectId?: string;
  title: string;
  description?: string;
  status: ResearchTaskStatus;
  priority: ResearchTaskPriority;
  dueAt?: ISODateTime;
  source?: 'manual' | 'submission' | 'advisor' | 'meeting' | 'automation';
  nextAction?: string;
  /** Which backend owns this task, so a completion can be written back to the right endpoint. */
  origin?: 'taskmaster' | 'meeting_action';
}

export type ManuscriptStatus = 'drafting' | 'internal_review' | 'ready' | 'submitted' | 'revision' | 'published';

export interface Manuscript {
  id: string;
  projectId: string;
  title: string;
  shortTitle?: string;
  status: ManuscriptStatus;
  targetJournal?: string;
  completion?: number;
  updatedAt?: ISODateTime;
}

export type ThesisStatus = 'planning' | 'writing' | 'review' | 'submitted' | 'completed';
export type ThesisChapterStatus = 'not_started' | 'drafting' | 'review' | 'done';

export interface ThesisChapter {
  id: string;
  thesisId: string;
  title: string;
  status: ThesisChapterStatus;
  completion: number;
  orderIndex: number;
  notes?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface ThesisMilestone {
  id: string;
  thesisId: string;
  title: string;
  dueDate?: string;
  status: 'pending' | 'in_progress' | 'done';
  completedAt?: ISODateTime;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface ThesisProgressLog {
  id: string;
  thesisId: string;
  date: string;
  minutes: number;
  words: number;
  note?: string;
  createdAt: ISODateTime;
}

export interface ThesisProject {
  id: string;
  projectId?: string;
  title: string;
  degree: string;
  targetDate?: string;
  status: ThesisStatus;
  completion: number;
  chapters?: ThesisChapter[];
  milestones?: ThesisMilestone[];
  logs?: ThesisProgressLog[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export type SubmissionStatus =
  | 'draft'
  | 'journal_selected'
  | 'presubmission_check'
  | 'submitted'
  | 'with_editor'
  | 'under_review'
  | 'minor_revision'
  | 'major_revision'
  | 'rejected'
  | 'resubmitted'
  | 'accepted'
  | 'proof'
  | 'published';

export type SubmissionDocumentKind =
  | 'manuscript'
  | 'cover_letter'
  | 'highlights'
  | 'figures'
  | 'supplementary'
  | 'reviewer_response'
  | 'revision_checklist'
  | 'submission_emails'
  | 'journal_requirements';

export interface SubmissionDocument {
  kind: SubmissionDocumentKind;
  label: string;
  ready: boolean;
  artifactRef?: string;
}

export interface Submission {
  id: string;
  projectId: string;
  manuscriptId: string;
  journal: string;
  status: SubmissionStatus;
  previousStatus?: SubmissionStatus;
  submittedAt?: ISODateTime;
  statusChangedAt?: ISODateTime;
  deadline?: ISODateTime;
  trackingCode?: string;
  nextAction?: string;
  documents: SubmissionDocument[];
}

export type AdvisorActionStatus = 'open' | 'in_progress' | 'done';

export interface AdvisorAction {
  id: string;
  actionId?: string;
  projectId?: string;
  title: string;
  advisorName?: string;
  source: 'email' | 'meeting_note' | 'calendar' | 'manual';
  status: AdvisorActionStatus;
  priority: ResearchTaskPriority;
  dueAt?: ISODateTime;
  feedback?: string;
  nextAction?: string;
}

export type MeetingStatus = 'upcoming' | 'in_progress' | 'done';
export type MeetingType = 'group' | 'one_on_one' | 'journal_club' | 'progress';
export type MeetingRole = 'presenter' | 'attendee';
export type MeetingAgendaKind = 'my_report' | 'carryover_action' | 'question_for_advisor' | 'literature';
export type MeetingNoteType = 'feedback' | 'decision' | 'question' | 'idea';
export type MeetingActionStatus = 'open' | 'in_progress' | 'done' | 'dropped';

export interface MeetingAgendaItem {
  id: string;
  meetingId: string;
  kind: MeetingAgendaKind;
  title: string;
  detail?: string;
  sourceRef?: string;
  orderIndex: number;
  done: boolean;
}

export interface MeetingNote {
  id: string;
  meetingId: string;
  speaker?: string;
  content: string;
  noteType: MeetingNoteType;
  sourceSegmentId?: string;
  promotedActionId?: string;
  createdAt: ISODateTime;
}

export interface MeetingActionItem {
  id: string;
  meetingId: string;
  sourceNoteId?: string;
  content: string;
  dueDate?: string;
  status: MeetingActionStatus;
  owner: string;
  taskId?: string;
  projectId?: string;
  createdAt: ISODateTime;
  completedAt?: ISODateTime;
}

export interface MeetingTranscriptSegment {
  id: string;
  meetingId: string;
  segmentIndex: number;
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
  status: 'pending' | 'transcribing' | 'done' | 'failed';
  error?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface MeetingSummaryDraft {
  summary: string;
  notes: Array<{ content: string; noteType: MeetingNoteType; speaker?: string }>;
  candidateActions: Array<{ content: string; dueDate?: string }>;
}

export interface ResearchMeeting {
  id: string;
  projectId?: string;
  title: string;
  meetingDate: ISODateTime;
  meetingType: MeetingType;
  myRole: MeetingRole;
  location?: string;
  status: MeetingStatus;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  agenda?: MeetingAgendaItem[];
  notes?: MeetingNote[];
  actions?: MeetingActionItem[];
  transcriptSegments?: MeetingTranscriptSegment[];
}

export type PresentationStatus = 'not_started' | 'drafting' | 'review' | 'ready';

export interface Presentation {
  id: string;
  meetingId: string;
  projectId?: string;
  title: string;
  status: PresentationStatus;
  completion: number;
  slideCount?: number;
  artifactRef?: string;
  nextAction?: string;
}

export interface LiteratureAlert {
  id: string;
  projectId?: string;
  title: string;
  journal?: string;
  publishedAt?: ISODateTime;
  relevanceScore: number;
  reason: string;
  url?: string;
  read: boolean;
}

export type ResearchArtifactKind = 'manuscript' | 'figure' | 'table' | 'presentation' | 'report' | 'dataset' | 'code';

export interface ResearchArtifact {
  id: string;
  projectId?: string;
  title: string;
  kind: ResearchArtifactKind;
  updatedAt: ISODateTime;
  path?: string;
  createdBy?: 'user' | 'agent';
}

export type AgentRunStatus = 'queued' | 'running' | 'waiting_for_user' | 'succeeded' | 'failed' | 'cancelled';

export interface AgentRun {
  id: string;
  projectId?: string;
  jobId?: string;
  capability: string;
  displayName: string;
  provider?: 'claude' | 'codex' | 'other';
  status: AgentRunStatus;
  progress?: number;
  startedAt?: ISODateTime;
  finishedAt?: ISODateTime;
  error?: string;
  artifactRefs?: string[];
  nextAction?: string;
}

export type AutomationTemplate =
  | 'submission-watch'
  | 'literature-watch'
  | 'meeting-prep'
  | 'advisor-followup'
  | 'weekly-report'
  | 'custom';

export interface AutomationSchedule {
  kind: 'cron' | 'interval' | 'manual';
  expression?: string;
  timezone?: string;
}

export interface AutomationDelivery {
  mode: 'in_app' | 'desktop' | 'email';
  destination?: string;
}

export interface AutomationJob {
  id: string;
  name: string;
  template: AutomationTemplate;
  projectId?: string;
  schedule: AutomationSchedule;
  status: 'enabled' | 'paused' | 'running' | 'error';
  nextRunAt?: ISODateTime;
  lastRunAt?: ISODateTime;
  runCount?: number;
  errorCount?: number;
  delivery?: AutomationDelivery;
  idempotencyKey?: string;
  description?: string;
}

export interface AutomationRun {
  id: string;
  jobId: string;
  status: AgentRunStatus;
  startedAt: ISODateTime;
  finishedAt?: ISODateTime;
  summary?: string;
  error?: string;
}

export interface ResearchSecretarySnapshot {
  tasks: ResearchTask[];
  theses: ThesisProject[];
  manuscripts: Manuscript[];
  submissions: Submission[];
  advisorActions: AdvisorAction[];
  meetings: ResearchMeeting[];
  presentations: Presentation[];
  literatureAlerts: LiteratureAlert[];
  artifacts: ResearchArtifact[];
  agentRuns: AgentRun[];
  automationJobs: AutomationJob[];
  automationRuns: AutomationRun[];
}

export interface WorkbenchDailyReview {
  id: string;
  date: string;
  accomplishments: string;
  obstacles: string;
  insights: string;
  tomorrowPriorities: string[];
  mood?: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface WorkbenchHabit {
  id: string;
  title: string;
  enabled: boolean;
  completed: boolean;
  value?: string;
  updatedAt?: ISODateTime;
}

export interface WorkbenchAttendanceLog {
  id: string;
  date: string;
  startedAt: ISODateTime;
  endedAt?: ISODateTime;
  /** Minutes elapsed; for an open segment this is measured against the server clock at fetch time. */
  minutes: number;
  open: boolean;
}

export interface WorkbenchFocusSession {
  id: string;
  date: string;
  minutes: number;
  taskTitle?: string;
  createdAt: ISODateTime;
  startedAt?: ISODateTime;
  endedAt?: ISODateTime;
}

export interface WorkbenchTodayStatus {
  date: string;
  working: boolean;
  currentWorkStartedAt?: ISODateTime;
  workMinutes: number;
  attendanceCount: number;
  focusMinutes: number;
  currentTask: { title: string; dueDate?: string; status: string } | null;
  todayTodoCount: number;
  habitCompleted: number;
  habitTotal: number;
  habitCompletion: number;
  reviewCompleted: boolean;
  review: WorkbenchDailyReview | null;
  activeSubmissionCount: number;
}
