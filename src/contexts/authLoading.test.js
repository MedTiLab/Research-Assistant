import { describe, expect, it } from 'vitest';

import {
  areEquivalentLocalKernelConfigs,
  shouldBlockAuthStatusCheck,
} from './authLoading';

describe('shouldBlockAuthStatusCheck', () => {
  it('blocks the UI while the initial authentication state is unknown', () => {
    expect(shouldBlockAuthStatusCheck(false)).toBe(true);
  });

  it('keeps the mounted app visible during background token revalidation', () => {
    expect(shouldBlockAuthStatusCheck(true)).toBe(false);
  });
});

describe('areEquivalentLocalKernelConfigs', () => {
  it('treats separately allocated configs with the same values as equivalent', () => {
    expect(areEquivalentLocalKernelConfigs(
      { required: true, downloads: { mac: '/kernel.pkg', windows: '/kernel.exe' } },
      { downloads: { windows: '/kernel.exe', mac: '/kernel.pkg' }, required: true },
    )).toBe(true);
  });

  it('detects a real Kernel configuration change', () => {
    expect(areEquivalentLocalKernelConfigs(
      { required: true, discovery: 'http://127.0.0.1:43110' },
      { required: true, discovery: 'http://127.0.0.1:43111' },
    )).toBe(false);
  });
});
