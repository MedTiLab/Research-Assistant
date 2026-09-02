import { describe, expect, it } from 'vitest';

import { resolveSidebarUpdateChannel } from './updateChannel';

describe('sidebar update routing', () => {
  it('routes a desktop shell only to the desktop installer', () => {
    expect(resolveSidebarUpdateChannel({
      isDesktopShell: true,
      desktopUpdateAvailable: true,
      localKernelUpdateAvailable: true,
    })).toBe('desktop');
  });

  it('keeps automatic Kernel update reminders in the browser', () => {
    expect(resolveSidebarUpdateChannel({
      isDesktopShell: false,
      desktopUpdateAvailable: false,
      localKernelUpdateAvailable: true,
    })).toBe('localKernel');
  });

  it('does not show a desktop installer update in a browser', () => {
    expect(resolveSidebarUpdateChannel({
      isDesktopShell: false,
      desktopUpdateAvailable: true,
      localKernelUpdateAvailable: false,
    })).toBeNull();
  });
});
