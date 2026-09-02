import { describe, expect, it } from 'vitest';

import { shouldDeferServerRestart } from './watch-server-restart.js';

describe('shouldDeferServerRestart', () => {
  it('defers a development restart while an interactive agent is active', () => {
    expect(shouldDeferServerRestart({ status: 'ok', agentBusy: true })).toBe(true);
  });

  it('allows restart when the agent is idle or an old health payload is returned', () => {
    expect(shouldDeferServerRestart({ status: 'ok', agentBusy: false })).toBe(false);
    expect(shouldDeferServerRestart({ status: 'ok' })).toBe(false);
  });
});
