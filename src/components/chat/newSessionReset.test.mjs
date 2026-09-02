import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

const projectsStateSource = fs.readFileSync(
  new URL('../../hooks/useProjectsState.ts', import.meta.url),
  'utf8',
);
const chatInterfaceSource = fs.readFileSync(
  new URL('./view/ChatInterface.tsx', import.meta.url),
  'utf8',
);

describe('explicit new conversation reset', () => {
  it('emits a reset even when project, route, and selected session are unchanged', () => {
    expect(projectsStateSource).toContain(
      'setNewSessionResetKey((previous) => previous + 1)',
    );
    expect(projectsStateSource).toContain(
      'safeLocalStorage.removeItem(`draft_input_${projectName}`)',
    );
  });

  it('clears stale failed-session state from the new-conversation view', () => {
    for (const resetStatement of [
      'pendingViewSessionRef.current = null',
      'setChatMessages([])',
      'setSessionMessages([])',
      'setCurrentSessionId(null)',
      'setPendingPermissionRequests([])',
      'handleClearInput()',
      "window.sessionStorage.removeItem('pendingSessionId')",
    ]) {
      expect(chatInterfaceSource).toContain(resetStatement);
    }
  });
});
