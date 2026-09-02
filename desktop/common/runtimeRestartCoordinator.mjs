export function createRuntimeRestartCoordinator({
  getSupervisor,
  isRuntimeBusy,
  pollIntervalMs = 5_000,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  log = () => {},
} = {}) {
  if (typeof getSupervisor !== 'function' || typeof isRuntimeBusy !== 'function') {
    throw new TypeError('Runtime restart coordinator requires getSupervisor and isRuntimeBusy');
  }

  let pendingReason = null;
  let timer = null;
  let pollInFlight = false;

  const clearWatcher = () => {
    if (!timer) return;
    clearIntervalImpl(timer);
    timer = null;
  };

  const runDeferredRestart = async () => {
    if (!pendingReason || pollInFlight) return false;
    pollInFlight = true;
    try {
      const supervisor = getSupervisor();
      const status = await supervisor.getStatus();
      if (await isRuntimeBusy(status)) return false;
      const reason = pendingReason;
      pendingReason = null;
      clearWatcher();
      log('Deferred Runtime restart is resuming', { reason });
      await supervisor.restart(reason);
      return true;
    } finally {
      pollInFlight = false;
    }
  };

  const ensureWatcher = () => {
    if (timer) return;
    timer = setIntervalImpl(() => {
      void runDeferredRestart();
    }, pollIntervalMs);
    timer.unref?.();
  };

  return {
    async request(reason = 'renderer-request', { force = false } = {}) {
      const supervisor = getSupervisor();
      const status = await supervisor.getStatus();
      if (force || !await isRuntimeBusy(status)) {
        pendingReason = null;
        clearWatcher();
        return supervisor.restart(reason);
      }

      pendingReason = reason;
      const deferred = supervisor.deferRestart(
        '检测到正在运行的 Agent、PTY 或计算任务；任务结束后将自动重启 Runtime。',
      );
      ensureWatcher();
      log('Runtime restart deferred for active work', { reason, pid: status.pid });
      return deferred;
    },

    runDeferredRestart,

    dispose() {
      pendingReason = null;
      clearWatcher();
    },

    get pending() {
      return Boolean(pendingReason);
    },
  };
}
