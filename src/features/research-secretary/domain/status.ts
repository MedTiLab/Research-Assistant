import type {
  AgentRunStatus,
  AutomationJob,
  SubmissionStatus,
} from './types';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const SUBMISSION_STATUS_ORDER: SubmissionStatus[] = [
  'draft',
  'journal_selected',
  'presubmission_check',
  'submitted',
  'with_editor',
  'under_review',
  'minor_revision',
  'major_revision',
  'rejected',
  'resubmitted',
  'accepted',
  'proof',
  'published',
];

export const SUBMISSION_STATUS_TONES: Record<SubmissionStatus, StatusTone> = {
  draft: 'neutral',
  journal_selected: 'info',
  presubmission_check: 'info',
  submitted: 'info',
  with_editor: 'info',
  under_review: 'info',
  minor_revision: 'warning',
  major_revision: 'warning',
  rejected: 'danger',
  resubmitted: 'info',
  accepted: 'success',
  proof: 'success',
  published: 'success',
};

export const AGENT_RUN_STATUS_TONES: Record<AgentRunStatus, StatusTone> = {
  queued: 'neutral',
  running: 'info',
  waiting_for_user: 'warning',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
};

export const AUTOMATION_STATUS_TONES: Record<AutomationJob['status'], StatusTone> = {
  enabled: 'success',
  paused: 'neutral',
  running: 'info',
  error: 'danger',
};

export const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  neutral: 'border-border/70 bg-muted/45 text-muted-foreground',
  info: 'border-emerald-200/70 bg-emerald-50 text-emerald-700 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:text-emerald-300',
  success: 'border-green-200/70 bg-green-50 text-green-700 dark:border-green-800/70 dark:bg-green-950/40 dark:text-green-300',
  warning: 'border-amber-200/80 bg-amber-50 text-amber-700 dark:border-amber-800/70 dark:bg-amber-950/40 dark:text-amber-300',
  danger: 'border-red-200/80 bg-red-50 text-red-700 dark:border-red-800/70 dark:bg-red-950/40 dark:text-red-300',
};
