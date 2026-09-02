import { describe, expect, it } from 'vitest';

import { parseAgentSessionKey } from '../../shared/agentSessionIdentity';
import {
  createClientAgentSessionKey,
  hasClientAgentSession,
} from './agentSessionIdentity';

describe('client agent session identity', () => {
  it('does not collide for the same external id across runtime or project', () => {
    const claudeKey = createClientAgentSessionKey('shared', {
      projectKey: 'project-a',
      runtimeId: 'claude',
    });
    const codexKey = createClientAgentSessionKey('shared', {
      projectKey: 'project-a',
      runtimeId: 'codex',
    });
    const otherProjectKey = createClientAgentSessionKey('shared', {
      projectKey: 'project-b',
      runtimeId: 'claude',
    });

    expect(claudeKey).not.toBe(codexKey);
    expect(claudeKey).not.toBe(otherProjectKey);
    expect(parseAgentSessionKey(claudeKey)).toMatchObject({
      ownerKey: 'current-user',
      projectKey: 'project-a',
      runtimeId: 'claude',
      sessionId: 'shared',
    });
    expect(hasClientAgentSession(new Set([claudeKey as string]), 'shared', {
      projectKey: 'project-a',
      runtimeId: 'codex',
    })).toBe(false);
  });
});

