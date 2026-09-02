import { describe, expect, it } from 'vitest';

import { resolveAgentUserId, resolveRequestUserId } from '../utils/userScope.js';

describe('user skill scope', () => {
  it('uses the cloud database id for normal cloud requests', () => {
    expect(resolveRequestUserId({ user: { id: 42, cloudUserId: 'remote-42' } })).toBe(42);
  });

  it('uses the authenticated cloud account id for Local Kernel requests', () => {
    const request = {
      user: { id: null, userId: null, cloudUserId: 'remote-42' },
      localKernelSession: { userId: 'remote-42' },
    };
    expect(resolveRequestUserId(request)).toBe('remote-42');
    expect(resolveAgentUserId(request.user, request.localKernelSession)).toBe('remote-42');
  });

  it('falls back to the Local Kernel session identity', () => {
    expect(resolveRequestUserId({
      user: { id: null },
      localKernelSession: { userId: 'session-user' },
    })).toBe('session-user');
  });
});
