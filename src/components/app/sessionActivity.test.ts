import { describe, expect, it } from 'vitest';

import {
  collectActiveSessionKeys,
  getActiveSessionEntryId,
  getLifecycleSessionIds,
} from './sessionActivity';
import {
  createAgentSessionKey,
  parseAgentSessionKey,
} from '../../../shared/agentSessionIdentity';

describe('sessionActivity', () => {
  it('normalizes active session entries from string and object payloads', () => {
    expect(getActiveSessionEntryId('session-a')).toBe('session-a');
    expect(getActiveSessionEntryId({ id: 'session-b', startTime: 123 })).toBe('session-b');
    expect(getActiveSessionEntryId({ sessionId: 'session-c', startTime: 456 })).toBe('session-c');
    expect(getActiveSessionEntryId({ id: '' })).toBeNull();
  });

  it('collects composite active keys and preserves temporary processing identities', () => {
    const temporaryKey = createAgentSessionKey({
      ownerKey: 'current-user',
      projectKey: 'project-a',
      runtimeId: 'claude',
      sessionId: 'new-session-1',
    });
    const result = collectActiveSessionKeys(
      {
        claude: [{ id: 'shared-session', projectKey: 'project-a', runtimeId: 'claude' }],
        codex: [{ id: 'shared-session', projectKey: 'project-a', runtimeId: 'codex' }],
      },
      new Set([temporaryKey]),
    );

    expect([...result].map(parseAgentSessionKey)).toEqual(expect.arrayContaining([
      expect.objectContaining({ projectKey: 'project-a', runtimeId: 'claude', sessionId: 'shared-session' }),
      expect.objectContaining({ projectKey: 'project-a', runtimeId: 'codex', sessionId: 'shared-session' }),
      expect.objectContaining({ projectKey: 'project-a', runtimeId: 'claude', sessionId: 'new-session-1' }),
    ]));
    expect(result.size).toBe(3);
  });

  it('extracts all lifecycle ids from Codex migration messages', () => {
    expect(getLifecycleSessionIds({
      sessionId: 'actual-session',
      actualSessionId: 'actual-session',
      previousSessionId: 'new-session-1',
    })).toEqual(['actual-session', 'new-session-1']);
  });
});
