import { describe, expect, it } from 'vitest';

import {
  createAgentSessionIdentity,
  createAgentSessionKey,
  isTemporaryAgentSessionId,
  parseAgentSessionKey,
  promoteAgentSessionIdentity,
} from '../utils/agentSessionIdentity.js';

describe('agent session identity', () => {
  const identity = {
    ownerKey: 'owner:1',
    projectKey: 'project:[research]',
    runtimeId: 'codex',
    sessionId: 'shared:id',
  };

  it('uses a reversible collision-safe composite key', () => {
    const key = createAgentSessionKey(identity);

    expect(key).toBe('["owner:1","project:[research]","codex","shared:id"]');
    expect(parseAgentSessionKey(key)).toEqual(identity);
    expect(createAgentSessionKey({ ...identity, runtimeId: 'claude' })).not.toBe(key);
    expect(createAgentSessionKey({ ...identity, projectKey: 'another-project' })).not.toBe(key);
  });

  it('rejects incomplete identities instead of inventing defaults', () => {
    expect(() => createAgentSessionIdentity({ ...identity, runtimeId: '' })).toThrowError(
      expect.objectContaining({ code: 'AGENT_SESSION_IDENTITY_INVALID', field: 'runtimeId' }),
    );
    expect(parseAgentSessionKey('not-json')).toBeNull();
    expect(parseAgentSessionKey('["too","short"]')).toBeNull();
  });

  it('promotes only the supplied identity and recognizes temporary ids', () => {
    const promoted = promoteAgentSessionIdentity({
      ...identity,
      sessionId: 'new-session-1',
    }, 'real-session');

    expect(promoted).toEqual({ ...identity, sessionId: 'real-session' });
    expect(isTemporaryAgentSessionId('new-session-1')).toBe(true);
    expect(isTemporaryAgentSessionId('temp-1')).toBe(true);
    expect(isTemporaryAgentSessionId('real-session')).toBe(false);
  });
});

