import { describe, expect, it, vi } from 'vitest';

import { createRuntimeRestartCoordinator } from './runtimeRestartCoordinator.mjs';

describe('Runtime restart coordinator', () => {
  it('defers a restart while work is active and resumes after it becomes idle', async () => {
    let busy = true;
    let poll;
    const supervisor = {
      getStatus: vi.fn(async () => ({ status: 'running', pid: 44, baseUrl: 'http://127.0.0.1:5055' })),
      deferRestart: vi.fn(() => ({ status: 'degraded', reasonCode: 'restart_deferred' })),
      restart: vi.fn(async () => ({ status: 'running', pid: 45 })),
    };
    const coordinator = createRuntimeRestartCoordinator({
      getSupervisor: () => supervisor,
      isRuntimeBusy: async () => busy,
      setIntervalImpl: (callback) => {
        poll = callback;
        return { unref: vi.fn() };
      },
      clearIntervalImpl: vi.fn(),
    });

    await expect(coordinator.request('settings-change')).resolves.toMatchObject({
      reasonCode: 'restart_deferred',
    });
    expect(supervisor.restart).not.toHaveBeenCalled();
    expect(coordinator.pending).toBe(true);

    busy = false;
    await poll();
    await Promise.resolve();
    expect(supervisor.restart).toHaveBeenCalledWith('settings-change');
    expect(coordinator.pending).toBe(false);
  });

  it('allows an explicit forced restart', async () => {
    const supervisor = {
      getStatus: vi.fn(async () => ({ status: 'running' })),
      deferRestart: vi.fn(),
      restart: vi.fn(async () => ({ status: 'running' })),
    };
    const coordinator = createRuntimeRestartCoordinator({
      getSupervisor: () => supervisor,
      isRuntimeBusy: async () => true,
    });

    await coordinator.request('user-force', { force: true });
    expect(supervisor.restart).toHaveBeenCalledWith('user-force');
    expect(supervisor.deferRestart).not.toHaveBeenCalled();
    coordinator.dispose();
  });
});
