import { describe, expect, it } from 'vitest';

import { parseLinuxFreeMemoryLine } from '../utils/computeMonitoring.js';

describe('compute monitoring helpers', () => {
  it('prefers MemAvailable when parsing Linux memory output', () => {
    const snapshot = parseLinuxFreeMemoryLine('Mem: 32000 12000 4000 100 16000 20000');

    expect(snapshot).toMatchObject({
      memTotalMB: 32000,
      memUsedMB: 12000,
      memAvailableMB: 20000,
      memUtilPercent: 38,
      memLabel: 'System Memory',
      memDisplayMode: 'used',
    });
  });
});
