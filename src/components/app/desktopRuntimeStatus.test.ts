import { describe, expect, it } from 'vitest';

import { shouldShowDesktopRuntimeBanner } from './DesktopRuntimeStatusBanner';

function status(value: MedHelpDesktopRuntimeStatus['status']): MedHelpDesktopRuntimeStatus {
  return {
    status: value,
    reasonCode: 'test',
    message: 'test',
    pid: null,
    baseUrl: null,
    startedAt: null,
    lastHealthyAt: null,
    restartCount: 0,
    recoverable: true,
    diagnosticsPath: null,
  };
}

describe('Desktop Runtime status banner', () => {
  it('keeps the AppShell unobstructed while the Runtime is healthy', () => {
    expect(shouldShowDesktopRuntimeBanner(null)).toBe(false);
    expect(shouldShowDesktopRuntimeBanner(status('running'))).toBe(false);
    expect(shouldShowDesktopRuntimeBanner(status('disabled'))).toBe(false);
  });

  it.each(['discovering', 'starting', 'degraded', 'stopping', 'stopped', 'error', 'missing'] as const)(
    'shows an in-shell recovery surface for %s',
    (runtimeStatus) => {
      expect(shouldShowDesktopRuntimeBanner(status(runtimeStatus))).toBe(true);
    },
  );
});
