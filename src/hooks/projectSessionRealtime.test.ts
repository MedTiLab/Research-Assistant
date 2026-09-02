import { describe, expect, it } from 'vitest';

import type { Project } from '../types/app';
import {
  projectsSnapshotPreservesSelection,
  shouldRefreshSelectedSession,
} from './projectSessionRealtime';

describe('shouldRefreshSelectedSession', () => {
  it('reconciles Claude history after completion', () => {
    expect(shouldRefreshSelectedSession(
      { type: 'claude-complete', sessionId: 'session-1' },
      { id: 'session-1', __provider: 'claude' },
    )).toBe(true);
  });

  it('reconciles Codex history through its actual session id', () => {
    expect(shouldRefreshSelectedSession(
      { type: 'codex-complete', sessionId: 'temporary', actualSessionId: 'session-1' },
      { id: 'session-1', __provider: 'codex' },
    )).toBe(true);
  });

  it('does not reconcile on periodic idle status checks', () => {
    expect(shouldRefreshSelectedSession(
      { type: 'session-status', sessionId: 'session-1', provider: 'claude', isProcessing: false },
      { id: 'session-1', __provider: 'claude' },
    )).toBe(false);
  });

  it('ignores a different or still-processing session', () => {
    expect(shouldRefreshSelectedSession(
      { type: 'claude-complete', sessionId: 'session-2' },
      { id: 'session-1', __provider: 'claude' },
    )).toBe(false);
    expect(shouldRefreshSelectedSession(
      { type: 'session-status', sessionId: 'session-1', provider: 'claude', isProcessing: true },
      { id: 'session-1', __provider: 'claude' },
    )).toBe(false);
  });
});

describe('projectsSnapshotPreservesSelection', () => {
  const project = (overrides: Partial<Project> = {}): Project => ({
    name: 'conversation-project',
    displayName: 'Conversation project',
    fullPath: '/workspaces/conversation-project',
    sessions: [],
    codexSessions: [],
    ...overrides,
  });

  it('rejects a snapshot that temporarily omits the newly created project', () => {
    expect(projectsSnapshotPreservesSelection(
      [project({ name: 'older-project' })],
      project(),
      null,
    )).toBe(false);
  });

  it('rejects a snapshot that temporarily omits the promoted session', () => {
    expect(projectsSnapshotPreservesSelection(
      [project()],
      project(),
      { id: 'new-session', __provider: 'codex' },
    )).toBe(false);
  });

  it('accepts refreshed metadata once the selected identity is present', () => {
    expect(projectsSnapshotPreservesSelection(
      [project({ codexSessions: [{
        id: 'new-session',
        __provider: 'codex',
        summary: 'Refreshed title',
      }] })],
      project(),
      { id: 'new-session', __provider: 'codex', summary: 'Temporary title' },
    )).toBe(true);
  });
});
