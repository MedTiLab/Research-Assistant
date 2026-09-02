import { describe, expect, it } from 'vitest';

import { isBrowserBlockedLocalKernelPort } from '../utils/localKernelRuntime.js';

describe('local Kernel runtime ports', () => {
  it('marks Chromium-blocked loopback ports as unavailable for browser discovery', () => {
    expect(isBrowserBlockedLocalKernelPort(5060)).toBe(true);
    expect(isBrowserBlockedLocalKernelPort('5061')).toBe(true);
    expect(isBrowserBlockedLocalKernelPort(5059)).toBe(false);
    expect(isBrowserBlockedLocalKernelPort(5062)).toBe(false);
  });
});
