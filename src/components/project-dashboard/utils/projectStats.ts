import type { Project, ProjectSession } from '../../../types/app';

export type TaskmasterMetadata = {
  taskCount?: number;
  completed?: number;
  completionPercentage?: number;
  lastModified?: string;
};

export type TokenUsageTotals = {
  todayTokens: number;
  weekTokens: number;
};

export type ProjectTokenUsageSummary = {
  generatedAt?: string;
  workspace: TokenUsageTotals;
  projects: Record<string, TokenUsageTotals>;
};

export type ProjectOverviewTotals = {
  projectCount: number;
  trackedProjects: number;
  averageProgress: number | null;
  totalSessions: number;
  mostRecentlyActiveProject: {
    project: Project;
    lastActivity: string;
  } | null;
};

export function getProjectSessions(project: Project): ProjectSession[] {
  return [
    ...(project.sessions ?? []),
    ...(project.codexSessions ?? []),
    ...(project.piSessions ?? []),
  ].filter((session) => session.mode !== 'consultation');
}

export function getLastActivity(project: Project) {
  const sessionDates = getProjectSessions(project)
    .map((session) => session.updated_at || session.lastActivity || session.created_at || session.createdAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());

  if (sessionDates.length > 0) {
    return sessionDates[0].toISOString();
  }

  return project.createdAt ?? null;
}

export function getTaskmasterMetadata(project: Project): TaskmasterMetadata | null {
  const metadata = project.taskmaster?.metadata;

  if (!metadata || typeof metadata !== 'object') {
    return null;
  }

  return metadata as TaskmasterMetadata;
}

export function getProgress(project: Project) {
  const metadata = getTaskmasterMetadata(project);

  if (typeof metadata?.completionPercentage === 'number') {
    return Math.max(0, Math.min(100, metadata.completionPercentage));
  }

  return null;
}

export function formatTokenCount(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`;
  }

  return value.toLocaleString();
}

export function buildProjectOverviewTotals(projects: Project[]): ProjectOverviewTotals {
  const projectCount = projects.length;
  const projectsWithProgress = projects.filter((project) => getProgress(project) !== null);
  const trackedProjects = projectsWithProgress.length;
  const averageProgress = trackedProjects > 0
    ? Math.round(
      projectsWithProgress.reduce((sum, project) => sum + (getProgress(project) ?? 0), 0) / trackedProjects,
    )
    : null;
  const totalSessions = projects.reduce((sum, project) => sum + getProjectSessions(project).length, 0);

  const mostRecentlyActiveProject = [...projects]
    .map((project) => ({
      project,
      lastActivity: getLastActivity(project),
    }))
    .filter((entry): entry is { project: Project; lastActivity: string } => Boolean(entry.lastActivity))
    .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())[0] ?? null;

  return {
    projectCount,
    trackedProjects,
    averageProgress,
    totalSessions,
    mostRecentlyActiveProject,
  };
}

export function buildProjectUsageRefreshKey(projects: Project[]) {
  return projects
    .map((project) => `${project.name}:${project.fullPath}:${getLastActivity(project) ?? ''}:${getProjectSessions(project).length}`)
    .sort()
    .join('|');
}
