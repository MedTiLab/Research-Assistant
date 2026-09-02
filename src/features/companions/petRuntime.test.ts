import { describe, expect, it } from 'vitest';
import { petStateFromRealtimeMessage, spriteBackgroundPosition } from './petRuntime';

describe('desktop pet runtime', () => {
  it('maps agent lifecycle events to visible pet states', () => {
    expect(petStateFromRealtimeMessage({ type: 'codex-response' })).toBe('running');
    expect(petStateFromRealtimeMessage({ type: 'session-status', isProcessing: true })).toBe('running');
    expect(petStateFromRealtimeMessage({ type: 'codex-complete' })).toBe('jumping');
    expect(petStateFromRealtimeMessage({ type: 'codex-error' })).toBe('failed');
    expect(petStateFromRealtimeMessage({ type: 'permission-request' })).toBe('waiting');
    expect(petStateFromRealtimeMessage({ type: 'active-sessions', sessions: [{ status: 'waiting_on_user' }] })).toBe('waiting');
  });

  it('uses the Codex v2 8x11 atlas coordinate system', () => {
    expect(spriteBackgroundPosition(0, 0)).toBe('0% 0%');
    expect(spriteBackgroundPosition(10, 7)).toBe('100% 100%');
    expect(spriteBackgroundPosition(7, 3)).toBe(`${(3 * 100) / 7}% 70%`);
  });
});
