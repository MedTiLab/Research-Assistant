import { describe, expect, it } from 'vitest';

import type { AgentSessionKey, Project } from '../../../types/app';
import {
  getAllSessions,
  getSessionFavoriteKey,
  getSidebarVisibleSessionCount,
  SIDEBAR_SESSION_PAGE_SIZE,
  sortProjects,
} from './utils';

const project = (name: string, createdAt: string): Project => ({
  name,
  displayName: name,
  fullPath: `/workspaces/${name}`,
  createdAt,
  sessions: [],
});

describe('getSidebarVisibleSessionCount', () => {
  it('keeps the first page of sessions visible', () => {
    expect(getSidebarVisibleSessionCount({
      sessionCount: 10,
      revealedCount: SIDEBAR_SESSION_PAGE_SIZE,
      selectedIndex: -1,
    })).toBe(5);
  });

  it('reveals additional loaded sessions in page-sized chunks', () => {
    expect(getSidebarVisibleSessionCount({
      sessionCount: 10,
      revealedCount: SIDEBAR_SESSION_PAGE_SIZE * 2,
      selectedIndex: -1,
    })).toBe(10);
  });

  it('keeps the selected session visible even when it is below the first page', () => {
    expect(getSidebarVisibleSessionCount({
      sessionCount: 10,
      revealedCount: SIDEBAR_SESSION_PAGE_SIZE,
      selectedIndex: 6,
    })).toBe(7);
  });
});

describe('getAllSessions', () => {
  it('prefers composite runtime sessions while legacy lists remain in the payload', () => {
    const runtimeProject: Project = {
      ...project('runtime-project', '2026-08-26T00:00:00.000Z'),
      sessions: [{ id: 'stale-legacy-session' }],
      codexSessions: [{ id: 'stale-legacy-codex' }],
      piSessions: [{ id: 'stale-legacy-pi' }],
      runtimeSessions: [
        {
          id: 'claude-session',
          sessionId: 'claude-session',
          sessionKey: 'owner|runtime-project|claude|claude-session' as AgentSessionKey,
          projectKey: 'runtime-project',
          runtimeId: 'claude',
          __provider: 'claude',
          lastActivity: '2026-08-26T02:00:00.000Z',
        },
        {
          id: 'codex-session',
          sessionId: 'codex-session',
          sessionKey: 'owner|runtime-project|codex|codex-session' as AgentSessionKey,
          projectKey: 'runtime-project',
          runtimeId: 'codex',
          __provider: 'codex',
          lastActivity: '2026-08-26T01:00:00.000Z',
        },
        {
          id: 'pi-session',
          sessionId: 'pi-session',
          sessionKey: 'owner|runtime-project|pi|pi-session' as AgentSessionKey,
          projectKey: 'runtime-project',
          runtimeId: 'pi',
          __provider: 'pi',
          lastActivity: '2026-08-26T00:30:00.000Z',
        },
      ],
    };

    expect(getAllSessions(runtimeProject, {}).map((session) => session.id)).toEqual([
      'pi-session',
    ]);
  });

  it('keeps favorite conversations above newer conversations', () => {
    const runtimeProject: Project = {
      ...project('favorite-session-project', '2026-08-26T00:00:00.000Z'),
      runtimeSessions: [
        {
          id: 'newer-session',
          sessionId: 'newer-session',
          sessionKey: 'owner|favorite-session-project|pi|newer-session' as AgentSessionKey,
          projectKey: 'favorite-session-project',
          runtimeId: 'pi',
          __provider: 'pi',
          lastActivity: '2026-08-26T02:00:00.000Z',
        },
        {
          id: 'favorite-session',
          sessionId: 'favorite-session',
          sessionKey: 'owner|favorite-session-project|pi|favorite-session' as AgentSessionKey,
          projectKey: 'favorite-session-project',
          runtimeId: 'pi',
          __provider: 'pi',
          lastActivity: '2026-08-26T01:00:00.000Z',
        },
      ],
    };
    const favorites = new Set([
      getSessionFavoriteKey(runtimeProject.name, 'favorite-session', 'pi'),
    ]);

    expect(getAllSessions(runtimeProject, {}, new Set(), favorites).map((session) => session.id)).toEqual([
      'favorite-session',
      'newer-session',
    ]);
  });
});

describe('sortProjects', () => {
  it('keeps the default conversation folder above manually sorted projects', () => {
    const defaultFolder = {
      ...project('general-local', '2025-01-01T00:00:00.000Z'),
      isDefaultWorkspace: true,
    };
    const sorted = sortProjects(
      [project('recent', '2026-05-26T00:00:00.000Z'), defaultFolder],
      'date',
      new Set(['recent']),
      {},
    );

    expect(sorted.map((item) => item.name)).toEqual(['general-local', 'recent']);
  });

  it('places projects missing from manual order above ordered non-favorites', () => {
    const projects = [
      project('older-a', '2026-01-01T00:00:00.000Z'),
      project('older-b', '2026-01-02T00:00:00.000Z'),
      project('new-project', '2026-05-26T00:00:00.000Z'),
    ];

    const sorted = sortProjects(
      projects,
      'manual',
      new Set(),
      {},
      ['older-a', 'older-b'],
    );

    expect(sorted.map((item) => item.name)).toEqual(['new-project', 'older-a', 'older-b']);
  });

  it('keeps favorites above new non-favorite projects', () => {
    const projects = [
      project('favorite-project', '2026-01-01T00:00:00.000Z'),
      project('older-project', '2026-01-02T00:00:00.000Z'),
      project('new-project', '2026-05-26T00:00:00.000Z'),
    ];

    const sorted = sortProjects(
      projects,
      'manual',
      new Set(['favorite-project']),
      {},
      ['favorite-project', 'older-project'],
    );

    expect(sorted.map((item) => item.name)).toEqual([
      'favorite-project',
      'new-project',
      'older-project',
    ]);
  });
});
