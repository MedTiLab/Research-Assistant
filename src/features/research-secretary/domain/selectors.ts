import type { Project } from '../../../types/app';
import type {
  AgentRun,
  ResearchMeeting,
  ResearchSecretarySnapshot,
  ResearchTask,
  Submission,
} from './types';

export function selectOpenTasks(tasks: ResearchTask[]) {
  return tasks
    .filter((task) => task.status !== 'done')
    .sort((left, right) => {
      const priority = { urgent: 0, high: 1, medium: 2, low: 3 };
      const priorityDiff = priority[left.priority] - priority[right.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return (left.dueAt || '').localeCompare(right.dueAt || '');
    });
}

export function selectActiveAgentRuns(agentRuns: AgentRun[]) {
  return agentRuns.filter((run) => run.status === 'running' || run.status === 'queued' || run.status === 'waiting_for_user');
}

export function selectChangedSubmissions(submissions: Submission[], now = new Date()) {
  const recentThreshold = now.getTime() - 24 * 60 * 60 * 1000;
  return submissions.filter((submission) => {
    if (!submission.previousStatus || submission.previousStatus === submission.status) return false;
    if (!submission.statusChangedAt) return true;
    return new Date(submission.statusChangedAt).getTime() >= recentThreshold;
  });
}

export function selectNextMeeting(meetings: ResearchMeeting[], now = new Date()) {
  return meetings
    .filter((meeting) => meeting.status !== 'done' && new Date(meeting.meetingDate).getTime() >= now.getTime())
    .sort((left, right) => left.meetingDate.localeCompare(right.meetingDate))[0] ?? null;
}

export function selectProjectProgress(projects: Project[], snapshot: ResearchSecretarySnapshot) {
  const projectIds = new Set([
    ...projects.map((project) => project.name),
    ...snapshot.tasks.map((task) => task.projectId).filter(Boolean),
    ...snapshot.manuscripts.map((manuscript) => manuscript.projectId),
  ]);

  return Array.from(projectIds).slice(0, 5).map((projectId, index) => {
    const project = projects.find((candidate) => candidate.name === projectId);
    const tasks = snapshot.tasks.filter((task) => task.projectId === projectId);
    const completedTasks = tasks.filter((task) => task.status === 'done').length;
    const taskProgress = tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : null;
    const manuscriptProgress = snapshot.manuscripts.find((item) => item.projectId === projectId)?.completion;
    const taskmasterMetadata = project?.taskmaster?.metadata as {
      taskCount?: number;
      completed?: number;
      completionPercentage?: number;
    } | undefined;
    const realProgress = typeof taskmasterMetadata?.completionPercentage === 'number'
      ? Math.max(0, Math.min(100, Math.round(taskmasterMetadata.completionPercentage)))
      : null;
    const realOpenTasks = typeof taskmasterMetadata?.taskCount === 'number'
      ? Math.max(0, taskmasterMetadata.taskCount - (taskmasterMetadata.completed || 0))
      : null;
    const fallback = [68, 43, 81, 32, 57][index] ?? 50;

    return {
      projectId: projectId || `project-${index + 1}`,
      name: project?.displayName || projectId || `Research project ${index + 1}`,
      progress: realProgress ?? taskProgress ?? manuscriptProgress ?? fallback,
      openTasks: realOpenTasks ?? tasks.filter((task) => task.status !== 'done').length,
    };
  });
}
