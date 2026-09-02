import type { Project, ProjectSession } from '../types/app';

type RealtimeLifecycleMessage = {
  type?: string;
  sessionId?: string;
  actualSessionId?: string;
  provider?: ProjectSession['__provider'];
  isProcessing?: boolean;
};

const COMPLETE_MESSAGE_PROVIDERS: Record<string, ProjectSession['__provider']> = {
  'claude-complete': 'claude',
  'codex-complete': 'codex',
  'localgpu-complete': 'local',
};

/**
 * Reconcile from the persisted transcript after lifecycle completion. This is
 * the fallback when a browser misses one or more streaming fragments.
 */
export function shouldRefreshSelectedSession(
  message: RealtimeLifecycleMessage | null | undefined,
  selectedSession: ProjectSession | null | undefined,
) {
  if (!message?.type || !selectedSession?.id) {
    return false;
  }

  const selectedProvider = selectedSession.__provider || 'claude';
  if (message.type === 'session-status') {
    // Status checks are periodic and an idle response is not a completion
    // event. Treating every idle response as completion starts a multi-request
    // transcript reconcile loop indefinitely. The chat realtime handler owns
    // the reconnect fallback and gates it on an actually pending response.
    return false;
  }

  const completedProvider = COMPLETE_MESSAGE_PROVIDERS[message.type];
  if (!completedProvider || completedProvider !== selectedProvider) {
    return false;
  }

  return [message.sessionId, message.actualSessionId]
    .some((sessionId) => sessionId === selectedSession.id);
}

const getProjectSessions = (project: Project): ProjectSession[] => [
  ...(project.runtimeSessions ?? []),
  ...(project.sessions ?? []),
  ...(project.codexSessions ?? []),
  ...(project.piSessions ?? []),
  ...(project.openrouterSessions ?? []),
  ...(project.localSessions ?? []),
];

/**
 * Project snapshots are generated independently from the live session stream.
 * During first-message promotion they can briefly lag behind the UI and omit
 * the newly created project or session. Applying that regressive snapshot
 * unmounts the chat and makes both the transcript and sidebar entry disappear
 * until a manual refresh.
 */
export function projectsSnapshotPreservesSelection(
  projects: Project[],
  selectedProject: Project | null | undefined,
  selectedSession: ProjectSession | null | undefined,
): boolean {
  if (!selectedProject?.name) {
    return true;
  }

  const snapshotProject = projects.find((project) => project.name === selectedProject.name);
  if (!snapshotProject) {
    return false;
  }

  if (!selectedSession?.id) {
    return true;
  }

  return getProjectSessions(snapshotProject).some((session) => (
    session.id === selectedSession.id
    && (!selectedSession.__provider
      || !session.__provider
      || session.__provider === selectedSession.__provider)
  ));
}
