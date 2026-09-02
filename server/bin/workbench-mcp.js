#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

import { createWorkbenchToolHandlers } from '../workbench-mcp.js';

const meetingFields = {
  title: z.string().min(1).max(200).optional(),
  meetingDate: z.iso.datetime().optional(),
  meetingType: z.enum(['group', 'one_on_one', 'journal_club', 'progress']).optional(),
  myRole: z.enum(['presenter', 'attendee']).optional(),
  location: z.string().max(300).nullable().optional(),
  projectId: z.string().max(200).nullable().optional(),
  status: z.enum(['upcoming', 'in_progress', 'done']).optional(),
};
const agendaFields = {
  kind: z.enum(['my_report', 'carryover_action', 'question_for_advisor', 'literature']).optional(),
  title: z.string().min(1).max(500).optional(),
  detail: z.string().max(4000).nullable().optional(),
  sourceRef: z.string().max(300).nullable().optional(),
  orderIndex: z.number().int().min(0).optional(),
  done: z.boolean().optional(),
};
const actionFields = {
  content: z.string().min(1).max(8000).optional(),
  dueDate: z.iso.date().nullable().optional(),
  status: z.enum(['open', 'in_progress', 'done', 'dropped']).optional(),
  projectId: z.string().max(200).nullable().optional(),
};
const thesisStatus = z.enum(['planning', 'writing', 'review', 'submitted', 'completed']);
const thesisFields = {
  title: z.string().min(1).max(300).optional(), degree: z.string().min(1).max(50).optional(),
  targetDate: z.iso.date().nullable().optional(), status: thesisStatus.optional(),
  completion: z.number().int().min(0).max(100).optional(), projectId: z.string().max(200).nullable().optional(),
};
const chapterFields = {
  title: z.string().min(1).max(300).optional(), status: z.enum(['not_started', 'drafting', 'review', 'done']).optional(),
  completion: z.number().int().min(0).max(100).optional(), orderIndex: z.number().int().min(0).optional(),
  notes: z.string().max(8000).nullable().optional(),
};
const milestoneFields = {
  title: z.string().min(1).max(300).optional(), dueDate: z.iso.date().nullable().optional(),
  status: z.enum(['pending', 'in_progress', 'done']).optional(),
};
const submissionStatus = z.enum([
  'draft', 'journal_selected', 'presubmission_check', 'submitted', 'with_editor', 'under_review',
  'minor_revision', 'major_revision', 'rejected', 'resubmitted', 'accepted', 'proof', 'published',
]);
const documentSchema = z.object({
  kind: z.enum(['manuscript', 'cover_letter', 'highlights', 'figures', 'supplementary', 'reviewer_response', 'revision_checklist', 'submission_emails', 'journal_requirements']),
  label: z.string().min(1).max(100), ready: z.boolean(), artifactRef: z.string().max(500).optional(),
});

export const WORKBENCH_READ_TOOLS = Object.freeze([
  'overview', 'today_status', 'meeting_list', 'meeting_get', 'action_list', 'transcript_get', 'calendar_list', 'notes_list',
  'thesis_list', 'thesis_get', 'submission_list', 'submission_get', 'daily_review_get', 'habit_list',
]);
export const WORKBENCH_MUTATION_TOOLS = Object.freeze([
  'meeting_create', 'meeting_update', 'agenda_add', 'agenda_update', 'note_add',
  'note_promote', 'action_create', 'action_update', 'action_promote_task', 'transcript_update',
  'calendar_create', 'calendar_update',
  'thesis_create', 'thesis_update', 'thesis_chapter_add', 'thesis_chapter_update',
  'thesis_milestone_add', 'thesis_milestone_update', 'thesis_log_add',
  'submission_create', 'submission_update', 'daily_review_save',
  'attendance_start', 'attendance_end', 'focus_log', 'habit_create', 'habit_entry_update',
]);

function register(server, handlers, name, options) {
  server.registerTool(name, options, (input, extra) => handlers[name](input, { signal: extra.signal }));
}

export function createWorkbenchMcpServer(options = {}) {
  const handlers = createWorkbenchToolHandlers(options);
  const server = new McpServer({ name: 'medhelp-workbench', version: '1.0.0' });

  register(server, handlers, 'overview', {
    title: 'Review MedHelp workbench',
    description: 'Read a bounded overview of the current research workbench: today status, next meeting, open actions, thesis progress, and submission tracking. Use this before making a workbench plan.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  });
  register(server, handlers, 'meeting_list', {
    title: 'List workbench meetings',
    description: 'List meeting summaries in the authenticated user workspace, optionally filtered by ISO date-time range and status.',
    inputSchema: {
      from: z.iso.datetime().optional(),
      to: z.iso.datetime().optional(),
      status: z.enum(['upcoming', 'in_progress', 'done']).optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  });
  register(server, handlers, 'meeting_get', {
    title: 'Get workbench meeting',
    description: 'Read one meeting with its agenda, notes, actions, and a bounded transcript status summary. Use transcript_get only when transcript text is actually needed.',
    inputSchema: { meetingId: z.string().min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  });
  register(server, handlers, 'action_list', {
    title: 'List workbench actions',
    description: 'Read the authenticated user\'s open meeting actions, optionally filtering by status or whether the due date has passed.',
    inputSchema: {
      status: z.enum(['open', 'in_progress']).optional(),
      overdue: z.boolean().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  });
  register(server, handlers, 'transcript_get', {
    title: 'Read meeting transcript',
    description: 'Read transcript segments and each segment status for one meeting. Draft notes yourself from this text; do not call a separate summarization service.',
    inputSchema: { meetingId: z.string().min(1) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  });
  register(server, handlers, 'calendar_list', {
    title: 'List workbench calendar todos',
    description: 'Read calendar todos in an optional inclusive date range. Use this when the user asks what is planned today or on a specific date.',
    inputSchema: { from: z.iso.date().optional(), to: z.iso.date().optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  });
  register(server, handlers, 'notes_list', {
    title: 'List workbench notes',
    description: 'Read inbox notes or a daily focus/goal, optionally filtered by local calendar day.',
    inputSchema: {
      kind: z.enum(['inbox', 'daily_focus', 'daily_goal']).optional(),
      day: z.iso.date().optional(),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  });
  register(server, handlers, 'today_status', {
    title: 'Read today workbench status',
    description: 'Read one day of workbench status: work and focus minutes, current action, incomplete todos, habit completion, review status, and active submissions. Use this before drafting a daily review.',
    inputSchema: { date: z.iso.date().optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  });
  register(server, handlers, 'thesis_list', {
    title: 'List graduate theses', description: 'List thesis records with status, target date, and completion.', inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  });
  register(server, handlers, 'thesis_get', {
    title: 'Read thesis progress', description: 'Read one thesis with chapters, milestones, and up to 100 recent progress logs.',
    inputSchema: { thesisId: z.string().min(1) }, annotations: { readOnlyHint: true, openWorldHint: false },
  });
  register(server, handlers, 'submission_list', {
    title: 'List submissions', description: 'List manuscript and submission tracking records, optionally filtered by workflow status.',
    inputSchema: { status: submissionStatus.optional() }, annotations: { readOnlyHint: true, openWorldHint: false },
  });
  register(server, handlers, 'submission_get', {
    title: 'Read submission', description: 'Read one submission and its linked manuscript, deadline, next action, and document checklist.',
    inputSchema: { submissionId: z.string().min(1) }, annotations: { readOnlyHint: true, openWorldHint: false },
  });
  register(server, handlers, 'daily_review_get', {
    title: 'Read daily review', description: 'Read the daily review for a specific local date, or recent reviews when date is omitted.',
    inputSchema: { date: z.iso.date().optional() }, annotations: { readOnlyHint: true, openWorldHint: false },
  });
  register(server, handlers, 'habit_list', {
    title: 'List daily habits', description: 'Read enabled habits and completion for a local date.',
    inputSchema: { date: z.iso.date().optional() }, annotations: { readOnlyHint: true, openWorldHint: false },
  });

  if (process.env.MEDHELP_WORKBENCH_READ_ONLY === '1' || options.readOnly === true) return server;

  register(server, handlers, 'meeting_create', {
    title: 'Create workbench meeting draft',
    description: 'Create a meeting after the user confirms the exact title and time. This writes to the workbench and carries open actions into the new agenda in one server transaction.',
    inputSchema: {
      title: z.string().min(1).max(200), meetingDate: z.iso.datetime(),
      meetingType: z.enum(['group', 'one_on_one', 'journal_club', 'progress']),
      myRole: z.enum(['presenter', 'attendee']), location: meetingFields.location,
      projectId: meetingFields.projectId, status: meetingFields.status,
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'meeting_update', {
    title: 'Update workbench meeting',
    description: 'Update fields on an existing meeting after user confirmation. This writes to the workbench.',
    inputSchema: { meetingId: z.string().min(1), ...meetingFields },
    annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'agenda_add', {
    title: 'Add meeting agenda item',
    description: 'Add one agenda item to a meeting after user confirmation. This writes to the workbench.',
    inputSchema: {
      meetingId: z.string().min(1), kind: agendaFields.kind.unwrap(), title: agendaFields.title.unwrap(),
      detail: agendaFields.detail, sourceRef: agendaFields.sourceRef, orderIndex: agendaFields.orderIndex, done: agendaFields.done,
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'agenda_update', {
    title: 'Update meeting agenda item',
    description: 'Update one agenda item after user confirmation. This writes to the workbench.',
    inputSchema: { agendaId: z.string().min(1), ...agendaFields },
    annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'note_add', {
    title: 'Add meeting note draft',
    description: 'Save one proposed meeting note only after the user confirms it. This writes a draft to the workbench; do not claim it was saved before the tool succeeds.',
    inputSchema: {
      meetingId: z.string().min(1), speaker: z.string().max(100).nullable().optional(),
      content: z.string().min(1).max(8000), noteType: z.enum(['feedback', 'decision', 'question', 'idea']),
      sourceSegmentId: z.string().max(200).nullable().optional(),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'note_promote', {
    title: 'Promote note to action',
    description: 'Convert a meeting note into an action after the user confirms the proposed action text. The server creates the action and marks the note in one transaction.',
    inputSchema: {
      noteId: z.string().min(1), content: z.string().min(1).max(8000),
      dueDate: z.iso.date().nullable().optional(), projectId: z.string().max(200).nullable().optional(),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'action_create', {
    title: 'Create meeting action draft',
    description: 'Create one meeting action only after the user confirms its text and due date. This writes to the workbench.',
    inputSchema: { meetingId: z.string().min(1), content: actionFields.content.unwrap(), dueDate: actionFields.dueDate, status: actionFields.status, projectId: actionFields.projectId },
    annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'action_update', {
    title: 'Update meeting action',
    description: 'Update an existing meeting action after user confirmation, including completing or dropping it. This writes to the workbench.',
    inputSchema: { actionId: z.string().min(1), ...actionFields },
    annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'action_promote_task', {
    title: 'Promote action to project task',
    description: 'Promote a meeting action into its assigned project task list after user confirmation. The server rolls back the task if the linked action update fails.',
    inputSchema: { actionId: z.string().min(1), priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(), stage: z.string().min(1).max(100).optional() },
    annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'transcript_update', {
    title: 'Correct transcript segment',
    description: 'Correct transcript text or speaker after the user confirms the edit. This writes to the workbench.',
    inputSchema: { segmentId: z.string().min(1), text: z.string().min(1).max(16000).optional(), speaker: z.string().max(100).nullable().optional() },
    annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'calendar_create', {
    title: 'Create calendar todo draft',
    description: 'Create one dated workbench todo only after the user confirms the exact title and date. This writes to the workbench.',
    inputSchema: {
      title: z.string().min(1).max(500), date: z.iso.date(), completed: z.boolean().optional(),
      projectId: z.string().max(200).nullable().optional(),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'calendar_update', {
    title: 'Update calendar todo',
    description: 'Update a dated workbench todo only after user confirmation. This writes to the workbench.',
    inputSchema: {
      calendarId: z.string().min(1), title: z.string().min(1).max(500).optional(),
      date: z.iso.date().optional(), completed: z.boolean().optional(),
      projectId: z.string().max(200).nullable().optional(),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'thesis_create', {
    title: 'Create thesis record', description: 'Create a graduate thesis progress record after user confirmation.',
    inputSchema: { title: thesisFields.title.unwrap(), degree: thesisFields.degree, targetDate: thesisFields.targetDate, status: thesisFields.status, completion: thesisFields.completion, projectId: thesisFields.projectId },
    annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'thesis_update', {
    title: 'Update thesis record', description: 'Update thesis status, completion, target date, or metadata after user confirmation.',
    inputSchema: { thesisId: z.string().min(1), ...thesisFields }, annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'thesis_chapter_add', {
    title: 'Add thesis chapter', description: 'Add a chapter to a thesis after user confirmation.',
    inputSchema: { thesisId: z.string().min(1), title: chapterFields.title.unwrap(), status: chapterFields.status, completion: chapterFields.completion, orderIndex: chapterFields.orderIndex, notes: chapterFields.notes },
    annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'thesis_chapter_update', {
    title: 'Update thesis chapter', description: 'Update chapter status or progress after user confirmation.',
    inputSchema: { chapterId: z.string().min(1), ...chapterFields }, annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'thesis_milestone_add', {
    title: 'Add thesis milestone', description: 'Add a thesis milestone and optional due date after user confirmation.',
    inputSchema: { thesisId: z.string().min(1), title: milestoneFields.title.unwrap(), dueDate: milestoneFields.dueDate, status: milestoneFields.status },
    annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'thesis_milestone_update', {
    title: 'Update thesis milestone', description: 'Update or complete a thesis milestone after user confirmation.',
    inputSchema: { milestoneId: z.string().min(1), ...milestoneFields }, annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'thesis_log_add', {
    title: 'Log thesis progress', description: 'Add a dated thesis work log with minutes, words, and a short note after user confirmation.',
    inputSchema: { thesisId: z.string().min(1), date: z.iso.date(), minutes: z.number().int().min(0).optional(), words: z.number().int().min(0).optional(), note: z.string().max(4000).optional() },
    annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'submission_create', {
    title: 'Register manuscript submission', description: 'Create a linked manuscript and submission tracking record after user confirmation.',
    inputSchema: { title: z.string().min(1).max(500), shortTitle: z.string().max(150).optional(), projectId: z.string().max(200).optional(), journal: z.string().min(1).max(300), status: submissionStatus.optional(), deadline: z.iso.date().optional(), trackingCode: z.string().max(200).optional(), nextAction: z.string().max(4000).optional(), documents: z.array(documentSchema).max(30).optional(), completion: z.number().int().min(0).max(100).optional() },
    annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'submission_update', {
    title: 'Update manuscript submission', description: 'Update status, deadline, next action, tracking code, or document checklist after user confirmation.',
    inputSchema: { submissionId: z.string().min(1), title: z.string().min(1).max(500).optional(), shortTitle: z.string().max(150).nullable().optional(), journal: z.string().min(1).max(300).optional(), status: submissionStatus.optional(), deadline: z.iso.date().nullable().optional(), trackingCode: z.string().max(200).nullable().optional(), nextAction: z.string().max(4000).nullable().optional(), documents: z.array(documentSchema).max(30).optional(), completion: z.number().int().min(0).max(100).optional() },
    annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'daily_review_save', {
    title: 'Save daily review draft', description: 'Save accomplishments, obstacles, insights, tomorrow priorities, and mood for one date after the user confirms the complete draft.',
    inputSchema: { date: z.iso.date(), accomplishments: z.string().max(8000), obstacles: z.string().max(8000), insights: z.string().max(8000), tomorrowPriorities: z.array(z.string().min(1).max(500)).max(10), mood: z.number().int().min(1).max(5).optional() },
    annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'attendance_start', {
    title: 'Start work attendance', description: 'Start a work attendance segment after explicit user confirmation.',
    inputSchema: { startedAt: z.iso.datetime().optional() }, annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'attendance_end', {
    title: 'End work attendance', description: 'End the currently open work attendance segment after explicit user confirmation.',
    inputSchema: { endedAt: z.iso.datetime().optional() }, annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'focus_log', {
    title: 'Log focus time', description: 'Record a completed focus session after the user confirms its duration and task.',
    inputSchema: { date: z.iso.date().optional(), minutes: z.number().int().min(1).max(1440), taskTitle: z.string().max(500).optional() },
    annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'habit_create', {
    title: 'Create daily habit', description: 'Create an enabled daily habit after user confirmation.',
    inputSchema: { title: z.string().min(1).max(100) }, annotations: { readOnlyHint: false, openWorldHint: false },
  });
  register(server, handlers, 'habit_entry_update', {
    title: 'Update daily habit completion', description: 'Set one habit completion or value for one date after user confirmation.',
    inputSchema: { habitId: z.string().min(1), date: z.iso.date(), completed: z.boolean(), value: z.string().max(500).optional() },
    annotations: { readOnlyHint: false, openWorldHint: false },
  });

  return server;
}

export async function main() {
  const server = createWorkbenchMcpServer();
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(`[medhelp-workbench] ${error.message}`);
  process.exitCode = 1;
});
