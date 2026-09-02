import { describe, expect, it, vi } from 'vitest';

import { RuntimeSupervisor } from './runtimeSupervisor.mjs';

function flushTasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await flushTasks();
  }
  throw new Error('Condition was not reached');
}

describe('RuntimeSupervisor', () => {
  it('shares concurrent start calls and only creates one Runtime', async () => {
    let releaseStart;
    const startRuntime = vi.fn(() => new Promise((resolve) => {
      releaseStart = () => resolve({ pid: 41, baseUrl: 'http://127.0.0.1:3001' });
    }));
    const supervisor = new RuntimeSupervisor({
      startRuntime,
      stopRuntime: vi.fn(),
    });

    const first = supervisor.start('cold-start');
    const second = supervisor.start('duplicate-start');
    await flushTasks();

    expect(startRuntime).toHaveBeenCalledTimes(1);
    releaseStart();
    await expect(first).resolves.toMatchObject({ status: 'running', pid: 41 });
    await expect(second).resolves.toMatchObject({ status: 'running', pid: 41 });
  });

  it('broadcasts the canonical startup states without duplicate running events', async () => {
    const supervisor = new RuntimeSupervisor({
      startRuntime: async () => ({ pid: 42, baseUrl: 'http://127.0.0.1:3002' }),
      stopRuntime: vi.fn(),
    });
    const states = [];
    supervisor.onStatus((status) => states.push(status.status));

    await supervisor.start();
    await supervisor.start();

    expect(states).toEqual(['stopped', 'discovering', 'starting', 'running']);
  });

  it('classifies missing and stale Runtime failures', async () => {
    const missingError = new Error('Kernel entry missing');
    missingError.code = 'RUNTIME_MISSING';
    const missing = new RuntimeSupervisor({
      startRuntime: async () => { throw missingError; },
      stopRuntime: vi.fn(),
    });
    await expect(missing.start()).resolves.toMatchObject({
      status: 'missing',
      reasonCode: 'runtime_missing',
      recoverable: false,
    });

    const staleError = new Error('Stale Runtime');
    staleError.code = 'RUNTIME_STALE';
    const stale = new RuntimeSupervisor({
      startRuntime: async () => { throw staleError; },
      stopRuntime: vi.fn(),
    });
    await expect(stale.start()).resolves.toMatchObject({
      status: 'error',
      reasonCode: 'runtime_stale',
      recoverable: true,
    });

    const portError = new Error('address already in use');
    portError.code = 'EADDRINUSE';
    const occupied = new RuntimeSupervisor({
      startRuntime: async () => { throw portError; },
      stopRuntime: vi.fn(),
    });
    await expect(occupied.start()).resolves.toMatchObject({
      status: 'error',
      reasonCode: 'port_in_use',
      recoverable: true,
    });
  });

  it('uses bounded automatic restart backoff and stops a crash loop', async () => {
    const exitListeners = [];
    const delays = [];
    const startRuntime = vi.fn(async ({ onExit }) => {
      exitListeners.push(onExit);
      return {
        pid: 100 + exitListeners.length,
        baseUrl: 'http://127.0.0.1:3001',
      };
    });
    const supervisor = new RuntimeSupervisor({
      startRuntime,
      stopRuntime: vi.fn(),
      restartDelaysMs: [0, 1_000, 5_000],
      delay: async (ms) => { delays.push(ms); },
    });

    await supervisor.start();
    for (let crash = 0; crash < 3; crash += 1) {
      exitListeners[crash]({ code: crash + 1 });
      await waitFor(() => startRuntime.mock.calls.length === crash + 2);
    }
    exitListeners[3]({ signal: 'SIGSEGV' });
    await flushTasks();

    expect(delays).toEqual([0, 1_000, 5_000]);
    expect(startRuntime).toHaveBeenCalledTimes(4);
    await expect(supervisor.getStatus()).resolves.toMatchObject({
      status: 'error',
      reasonCode: 'restart_limit_reached',
      restartCount: 4,
    });
  });

  it('does not restart after an explicit stop', async () => {
    let exitRuntime;
    let releaseDelay;
    const startRuntime = vi.fn(async ({ onExit }) => {
      exitRuntime = onExit;
      return { pid: 77, baseUrl: 'http://127.0.0.1:3001' };
    });
    const stopRuntime = vi.fn();
    const supervisor = new RuntimeSupervisor({
      startRuntime,
      stopRuntime,
      delay: () => new Promise((resolve) => { releaseDelay = resolve; }),
    });

    await supervisor.start();
    exitRuntime({ code: 1 });
    await flushTasks();
    const stopped = supervisor.stop('user-stop');
    releaseDelay();
    await stopped;
    await flushTasks();

    expect(startRuntime).toHaveBeenCalledTimes(1);
    expect(stopRuntime).toHaveBeenCalledWith(null, { reason: 'user-stop' });
    await expect(supervisor.getStatus()).resolves.toMatchObject({ status: 'stopped' });
  });

  it('does not start a replacement when stopping the current Runtime fails', async () => {
    const startRuntime = vi.fn(async () => ({ pid: 88, baseUrl: 'http://127.0.0.1:3001' }));
    const stopRuntime = vi.fn(async () => { throw new Error('Runtime refused to stop'); });
    const supervisor = new RuntimeSupervisor({ startRuntime, stopRuntime });

    await supervisor.start();
    await expect(supervisor.restart('user-restart')).resolves.toMatchObject({
      status: 'error',
      reasonCode: 'stop_failed',
    });

    expect(startRuntime).toHaveBeenCalledTimes(1);
  });

  it('can report a degraded capability without losing the active endpoint', async () => {
    const supervisor = new RuntimeSupervisor({
      startRuntime: async () => ({ pid: 89, baseUrl: 'http://127.0.0.1:3089' }),
      stopRuntime: vi.fn(),
    });
    await supervisor.start();

    expect(supervisor.degrade('renderer_load_failed', 'Renderer failed to load.')).toMatchObject({
      status: 'degraded',
      reasonCode: 'renderer_load_failed',
      baseUrl: 'http://127.0.0.1:3089',
      pid: 89,
    });
  });

  it('degrades and replaces a Runtime that remains alive but fails health checks', async () => {
    const delays = [];
    const startRuntime = vi.fn(async () => ({
      pid: 200 + startRuntime.mock.calls.length,
      baseUrl: 'http://127.0.0.1:3200',
    }));
    const stopRuntime = vi.fn();
    const supervisor = new RuntimeSupervisor({
      startRuntime,
      stopRuntime,
      probeRuntime: vi.fn(async () => ({ healthy: false, message: 'event loop stalled' })),
      healthCheckIntervalMs: 0,
      healthDegradedAfter: 2,
      healthFailureThreshold: 3,
      delay: async (ms) => { delays.push(ms); },
    });

    await supervisor.start();
    await supervisor.checkHealth();
    expect((await supervisor.getStatus()).status).toBe('running');
    await supervisor.checkHealth();
    await expect(supervisor.getStatus()).resolves.toMatchObject({
      status: 'degraded',
      reasonCode: 'health_check_failed',
      pid: 201,
    });
    await supervisor.checkHealth();
    await waitFor(() => startRuntime.mock.calls.length === 2);

    expect(stopRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 201 }),
      { reason: 'health-check-failed' },
    );
    expect(delays).toEqual([0]);
    await expect(supervisor.getStatus()).resolves.toMatchObject({
      status: 'running',
      pid: 202,
      restartCount: 1,
    });
  });

  it('restores a degraded Runtime after a successful health probe', async () => {
    const probeRuntime = vi.fn()
      .mockResolvedValueOnce({ healthy: false, message: 'slow' })
      .mockResolvedValueOnce({ healthy: true });
    const supervisor = new RuntimeSupervisor({
      startRuntime: async () => ({ pid: 91, baseUrl: 'http://127.0.0.1:3091' }),
      stopRuntime: vi.fn(),
      probeRuntime,
      healthCheckIntervalMs: 0,
      healthDegradedAfter: 1,
      healthFailureThreshold: 3,
    });

    await supervisor.start();
    await supervisor.checkHealth();
    expect((await supervisor.getStatus()).status).toBe('degraded');
    await supervisor.checkHealth();
    await expect(supervisor.getStatus()).resolves.toMatchObject({
      status: 'running',
      reasonCode: 'health_restored',
    });
  });

  it('delays health-check recovery when active work was observed recently', async () => {
    let now = 1_000;
    const startRuntime = vi.fn(async () => ({
      pid: 300 + startRuntime.mock.calls.length,
      baseUrl: 'http://127.0.0.1:3300',
    }));
    const stopRuntime = vi.fn();
    const probeRuntime = vi.fn()
      .mockResolvedValueOnce({ healthy: true, agentBusy: true })
      .mockResolvedValue({ healthy: false, message: 'event loop busy' });
    const supervisor = new RuntimeSupervisor({
      startRuntime,
      stopRuntime,
      probeRuntime,
      healthCheckIntervalMs: 0,
      healthDegradedAfter: 2,
      healthFailureThreshold: 3,
      activeWorkFailureThreshold: 5,
      activeWorkHealthGraceMs: 60_000,
      now: () => now,
      delay: async () => {},
    });

    await supervisor.start();
    await supervisor.checkHealth();
    for (let failure = 0; failure < 3; failure += 1) {
      now += 5_000;
      await supervisor.checkHealth();
    }

    expect(stopRuntime).not.toHaveBeenCalled();
    await expect(supervisor.getStatus()).resolves.toMatchObject({
      status: 'degraded',
      reasonCode: 'health_check_failed_during_active_work',
      pid: 301,
    });

    now += 5_000;
    await supervisor.checkHealth();
    now += 5_000;
    await supervisor.checkHealth();
    await waitFor(() => startRuntime.mock.calls.length === 2);

    expect(stopRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ pid: 301 }),
      { reason: 'health-check-failed' },
    );
    await expect(supervisor.getStatus()).resolves.toMatchObject({
      status: 'running',
      pid: 302,
      restartCount: 1,
    });
  });

  it('uses the normal health threshold after the active-work grace period expires', async () => {
    let now = 1_000;
    const startRuntime = vi.fn(async () => ({ pid: 401, baseUrl: 'http://127.0.0.1:3401' }));
    const stopRuntime = vi.fn();
    const probeRuntime = vi.fn()
      .mockResolvedValueOnce({ healthy: true, agentBusy: true })
      .mockResolvedValue({ healthy: false, message: 'unreachable' });
    const supervisor = new RuntimeSupervisor({
      startRuntime,
      stopRuntime,
      probeRuntime,
      healthCheckIntervalMs: 0,
      healthDegradedAfter: 1,
      healthFailureThreshold: 2,
      activeWorkFailureThreshold: 10,
      activeWorkHealthGraceMs: 10_000,
      now: () => now,
      delay: () => new Promise(() => {}),
    });

    await supervisor.start();
    await supervisor.checkHealth();
    now += 11_000;
    await supervisor.checkHealth();
    await supervisor.checkHealth();

    expect(stopRuntime).toHaveBeenCalledTimes(1);
    await expect(supervisor.getStatus()).resolves.toMatchObject({
      status: 'error',
      reasonCode: 'runtime_unhealthy',
    });
  });

  it('keeps a deferred restart visible while health probes remain successful', async () => {
    const supervisor = new RuntimeSupervisor({
      startRuntime: async () => ({ pid: 92, baseUrl: 'http://127.0.0.1:3092' }),
      stopRuntime: vi.fn(),
      probeRuntime: vi.fn(async () => ({ healthy: true })),
      healthCheckIntervalMs: 0,
    });

    await supervisor.start();
    supervisor.deferRestart('Waiting for an Agent turn.');
    await supervisor.checkHealth();

    await expect(supervisor.getStatus()).resolves.toMatchObject({
      status: 'degraded',
      reasonCode: 'restart_deferred',
      message: 'Waiting for an Agent turn.',
    });
  });
});
