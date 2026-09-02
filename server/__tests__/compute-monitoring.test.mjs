import { describe, expect, it } from 'vitest';

import {
  buildLocalMemorySnapshot,
  parseLinuxFreeMemoryLine,
  parseMacMemoryPressure,
  parseMacVmStat,
} from '../utils/computeMonitoring.js';

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

  it('parses macOS memory pressure as an availability metric', () => {
    const snapshot = parseMacMemoryPressure([
      'The system has 25769803776 (1572864 pages with a page size of 16384).',
      'System-wide memory free percentage: 72%',
    ].join('\n'), 24576);

    expect(snapshot).toMatchObject({
      memTotalMB: 24576,
      memUsedMB: 6881,
      memAvailableMB: 17695,
      memUtilPercent: 28,
      memLabel: 'Memory Pressure',
      memDisplayMode: 'available',
    });
  });

  it('falls back to vm_stat when memory pressure output is unavailable', () => {
    const snapshot = parseMacVmStat([
      'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
      'Pages free:                               28400.',
      'Pages active:                            536602.',
      'Pages inactive:                          531350.',
      'Pages speculative:                         4347.',
      'Pages wired down:                        205038.',
      'Pages purgeable:                          22041.',
    ].join('\n'), 24576);

    expect(snapshot).toMatchObject({
      memTotalMB: 24576,
      memUsedMB: 15418,
      memAvailableMB: 9158,
      memUtilPercent: 63,
      memLabel: 'Available Memory',
      memDisplayMode: 'available',
    });
  });

  it('uses platform-specific local fallbacks before os.freemem()', () => {
    const snapshot = buildLocalMemorySnapshot({
      platform: 'darwin',
      totalMB: 24576,
      osFreeMB: 509,
      memoryPressureOutput: 'System-wide memory free percentage: 72%',
    });

    expect(snapshot).toMatchObject({
      memUsedMB: 6881,
      memAvailableMB: 17695,
      memDisplayMode: 'available',
    });
  });
});
