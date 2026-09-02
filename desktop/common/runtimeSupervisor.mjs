export const RUNTIME_STATUS = Object.freeze({
  DISABLED: 'disabled',
  DISCOVERING: 'discovering',
  STARTING: 'starting',
  RUNNING: 'running',
  DEGRADED: 'degraded',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  ERROR: 'error',
  MISSING: 'missing',
});

const DEFAULT_RESTART_DELAYS_MS = Object.freeze([0, 1_000, 5_000]);
const STATUS_FIELDS = Object.freeze([
  'status',
  'reasonCode',
  'message',
  'pid',
  'baseUrl',
  'startedAt',
  'lastHealthyAt',
  'restartCount',
  'recoverable',
  'diagnosticsPath',
]);

function isoTimestamp(now) {
  return new Date(now()).toISOString();
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function classifyStartFailure(error) {
  if (['ENOENT', 'RUNTIME_MISSING'].includes(error?.code)) {
    return {
      status: RUNTIME_STATUS.MISSING,
      reasonCode: 'runtime_missing',
      recoverable: false,
    };
  }

  if (error?.code === 'EADDRINUSE') {
    return {
      status: RUNTIME_STATUS.ERROR,
      reasonCode: 'port_in_use',
      recoverable: true,
    };
  }

  return {
    status: RUNTIME_STATUS.ERROR,
    reasonCode: error?.code === 'RUNTIME_STALE' ? 'runtime_stale' : 'start_failed',
    recoverable: true,
  };
}

function sameStatus(left, right) {
  return STATUS_FIELDS.every((field) => left[field] === right[field]);
}

function cloneStatus(status) {
  return { ...status };
}

function defaultDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RuntimeSupervisor {
  constructor({
    enabled = true,
    startRuntime,
    stopRuntime,
    probeRuntime = null,
    onHealth = null,
    diagnosticsPath = null,
    restartDelaysMs = DEFAULT_RESTART_DELAYS_MS,
    stableWindowMs = 60_000,
    healthCheckIntervalMs = 5_000,
    healthDegradedAfter = 2,
    healthFailureThreshold = 3,
    activeWorkHealthGraceMs = 60_000,
    activeWorkFailureThreshold = 12,
    now = Date.now,
    delay = defaultDelay,
  } = {}) {
    if (typeof startRuntime !== 'function' || typeof stopRuntime !== 'function') {
      throw new TypeError('RuntimeSupervisor requires startRuntime and stopRuntime functions');
    }

    this.enabled = enabled;
    this.startRuntime = startRuntime;
    this.stopRuntime = stopRuntime;
    this.probeRuntime = typeof probeRuntime === 'function' ? probeRuntime : null;
    this.onHealth = typeof onHealth === 'function' ? onHealth : null;
    this.diagnosticsPath = diagnosticsPath;
    this.restartDelaysMs = [...restartDelaysMs];
    this.stableWindowMs = stableWindowMs;
    this.healthCheckIntervalMs = healthCheckIntervalMs;
    this.healthDegradedAfter = Math.max(1, Number(healthDegradedAfter) || 1);
    this.healthFailureThreshold = Math.max(
      this.healthDegradedAfter,
      Number(healthFailureThreshold) || this.healthDegradedAfter,
    );
    this.activeWorkHealthGraceMs = Math.max(0, Number(activeWorkHealthGraceMs) || 0);
    this.activeWorkFailureThreshold = Math.max(
      this.healthFailureThreshold,
      Number(activeWorkFailureThreshold) || this.healthFailureThreshold,
    );
    this.now = now;
    this.delay = delay;

    this.listeners = new Set();
    this.runtime = null;
    this.operationTail = Promise.resolve();
    this.startPromise = null;
    this.generation = 0;
    this.autoRestartToken = null;
    this.stableTimer = null;
    this.healthTimer = null;
    this.healthCheckInFlight = false;
    this.healthFailures = 0;
    this.lastActiveWorkAt = null;
    this.status = {
      status: enabled ? RUNTIME_STATUS.STOPPED : RUNTIME_STATUS.DISABLED,
      reasonCode: enabled ? 'not_started' : 'runtime_disabled',
      message: enabled ? 'Runtime has not been started.' : 'Runtime is disabled.',
      pid: null,
      baseUrl: null,
      startedAt: null,
      lastHealthyAt: null,
      restartCount: 0,
      recoverable: enabled,
      diagnosticsPath,
    };
  }

  async getStatus() {
    return cloneStatus(this.status);
  }

  onStatus(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('Runtime status listener must be a function');
    }

    this.listeners.add(listener);
    listener(cloneStatus(this.status));
    return () => this.listeners.delete(listener);
  }

  start(reason = 'manual-start') {
    if (!this.enabled) {
      return Promise.resolve(cloneStatus(this.status));
    }
    if (this.startPromise) {
      return this.startPromise;
    }

    const operation = this.#enqueue(() => this.#startUnlocked(reason, this.status.restartCount));
    const trackedOperation = operation.finally(() => {
      if (this.startPromise === trackedOperation) {
        this.startPromise = null;
      }
    });
    this.startPromise = trackedOperation;
    return trackedOperation;
  }

  stop(reason = 'manual-stop') {
    this.autoRestartToken = null;
    this.#clearStableTimer();
    this.#clearHealthMonitor();
    return this.#enqueue(() => this.#stopUnlocked(reason));
  }

  restart(reason = 'manual-restart') {
    this.autoRestartToken = null;
    this.#clearStableTimer();
    this.#clearHealthMonitor();
    return this.#enqueue(async () => {
      const stopped = await this.#stopUnlocked(reason);
      if (stopped.status !== RUNTIME_STATUS.STOPPED) {
        return stopped;
      }
      return this.#startUnlocked(reason, 0);
    });
  }

  degrade(reasonCode = 'runtime_degraded', message = 'Runtime is partially unavailable.') {
    if (this.status.status !== RUNTIME_STATUS.RUNNING) {
      return cloneStatus(this.status);
    }
    return this.#setStatus({
      status: RUNTIME_STATUS.DEGRADED,
      reasonCode,
      message,
      recoverable: true,
    });
  }

  deferRestart(message = 'Runtime restart is waiting for active work to finish.') {
    if (![RUNTIME_STATUS.RUNNING, RUNTIME_STATUS.DEGRADED].includes(this.status.status)) {
      return cloneStatus(this.status);
    }
    return this.#setStatus({
      status: RUNTIME_STATUS.DEGRADED,
      reasonCode: 'restart_deferred',
      message,
      recoverable: true,
    });
  }

  async checkHealth(reason = 'manual-health-check') {
    if (!this.probeRuntime || !this.runtime) {
      return cloneStatus(this.status);
    }
    await this.#runHealthCheck(this.generation, reason);
    return cloneStatus(this.status);
  }

  #enqueue(operation) {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.catch(() => {});
    return result;
  }

  #setStatus(patch) {
    const nextStatus = {
      ...this.status,
      ...patch,
      diagnosticsPath: this.diagnosticsPath,
    };
    if (sameStatus(this.status, nextStatus)) {
      return cloneStatus(this.status);
    }

    this.status = nextStatus;
    for (const listener of this.listeners) {
      try {
        listener(cloneStatus(nextStatus));
      } catch {
        // A renderer listener must not break Runtime lifecycle management.
      }
    }
    return cloneStatus(nextStatus);
  }

  async #startUnlocked(reason, restartCount) {
    if ([RUNTIME_STATUS.RUNNING, RUNTIME_STATUS.DEGRADED].includes(this.status.status) && this.runtime) {
      return cloneStatus(this.status);
    }

    this.autoRestartToken = null;
    this.#setStatus({
      status: RUNTIME_STATUS.DISCOVERING,
      reasonCode: reason,
      message: 'Discovering Runtime resources and existing processes.',
      pid: null,
      baseUrl: null,
      startedAt: null,
      lastHealthyAt: null,
      restartCount,
      recoverable: true,
    });
    this.#setStatus({
      status: RUNTIME_STATUS.STARTING,
      reasonCode: reason,
      message: 'Runtime process started; waiting for readiness.',
    });

    const generation = ++this.generation;
    try {
      const runtime = await this.startRuntime({
        reason,
        onExit: (details) => this.#handleUnexpectedExit(generation, details),
      });
      if (!runtime?.baseUrl) {
        const error = new Error('Runtime did not provide a base URL');
        error.code = 'INVALID_RUNTIME_ENDPOINT';
        throw error;
      }

      this.runtime = runtime;
      const healthyAt = isoTimestamp(this.now);
      const runtimePid = Number(runtime.pid);
      const degradedReason = typeof runtime.degradedReason === 'string' && runtime.degradedReason
        ? runtime.degradedReason
        : null;
      const status = this.#setStatus({
        status: degradedReason ? RUNTIME_STATUS.DEGRADED : RUNTIME_STATUS.RUNNING,
        reasonCode: degradedReason || (runtime.reused ? 'existing_runtime_reused' : 'health_check_passed'),
        message: degradedReason
          ? (runtime.degradedMessage || 'Runtime recovered with a warning that needs attention.')
          : (runtime.reused ? 'Reused an existing healthy Runtime.' : 'Runtime is healthy.'),
        pid: Number.isInteger(runtimePid) && runtimePid > 0 ? runtimePid : null,
        baseUrl: runtime.baseUrl,
        startedAt: runtime.startedAt || healthyAt,
        lastHealthyAt: runtime.lastHealthyAt || healthyAt,
        restartCount,
        recoverable: true,
      });
      this.healthFailures = 0;
      this.#armStableWindow(generation);
      this.#armHealthMonitor(generation);
      return status;
    } catch (error) {
      if (generation === this.generation) {
        this.runtime = null;
      }
      const failure = classifyStartFailure(error);
      return this.#setStatus({
        ...failure,
        message: errorMessage(error),
        pid: null,
        baseUrl: null,
        startedAt: null,
        lastHealthyAt: null,
        restartCount,
      });
    }
  }

  async #stopUnlocked(reason) {
    this.autoRestartToken = null;
    this.#clearStableTimer();
    this.#clearHealthMonitor();

    const runtime = this.runtime;
    if (!runtime && [RUNTIME_STATUS.STOPPED, RUNTIME_STATUS.DISABLED].includes(this.status.status)) {
      return cloneStatus(this.status);
    }

    ++this.generation;
    this.#setStatus({
      status: RUNTIME_STATUS.STOPPING,
      reasonCode: reason,
      message: 'Stopping Runtime.',
      recoverable: false,
    });

    try {
      await this.stopRuntime(runtime, { reason });
      this.runtime = null;
      return this.#setStatus({
        status: RUNTIME_STATUS.STOPPED,
        reasonCode: reason,
        message: 'Runtime stopped.',
        pid: null,
        baseUrl: null,
        startedAt: null,
        lastHealthyAt: null,
        restartCount: 0,
        recoverable: true,
      });
    } catch (error) {
      return this.#setStatus({
        status: RUNTIME_STATUS.ERROR,
        reasonCode: 'stop_failed',
        message: errorMessage(error),
        recoverable: true,
      });
    }
  }

  #handleUnexpectedExit(generation, details = {}) {
    if (generation !== this.generation || this.status.status === RUNTIME_STATUS.STOPPING) {
      return;
    }

    this.#clearStableTimer();
    this.#clearHealthMonitor();
    this.runtime = null;
    this.#scheduleAutomaticRestart({
      description: details.signal ?? details.code ?? 'unknown',
      reasonCode: 'runtime_exited',
    });
  }

  #scheduleAutomaticRestart({ description, reasonCode }) {
    const restartCount = this.status.restartCount + 1;
    const restartDelay = this.restartDelaysMs[restartCount - 1];
    if (restartDelay == null) {
      this.#setStatus({
        status: RUNTIME_STATUS.ERROR,
        reasonCode: 'restart_limit_reached',
        message: `Runtime became unavailable (${description}); automatic restart limit reached.`,
        pid: null,
        baseUrl: null,
        lastHealthyAt: null,
        restartCount,
        recoverable: true,
      });
      return;
    }

    const token = Symbol('auto-restart');
    this.autoRestartToken = token;
    this.#setStatus({
      status: RUNTIME_STATUS.ERROR,
      reasonCode,
      message: `Runtime became unavailable (${description}); restart ${restartCount} is scheduled.`,
      pid: null,
      baseUrl: null,
      lastHealthyAt: null,
      restartCount,
      recoverable: true,
    });

    void this.delay(restartDelay).then(() => {
      if (this.autoRestartToken !== token) {
        return;
      }
      return this.#enqueue(() => {
        if (this.autoRestartToken !== token) {
          return cloneStatus(this.status);
        }
        return this.#startUnlocked('automatic-restart', restartCount);
      });
    }).catch(() => {});
  }

  #armHealthMonitor(generation) {
    this.#clearHealthMonitor();
    if (
      !this.probeRuntime
      || !Number.isFinite(this.healthCheckIntervalMs)
      || this.healthCheckIntervalMs <= 0
    ) {
      return;
    }

    this.healthTimer = setInterval(() => {
      void this.#runHealthCheck(generation, 'periodic-health-check');
    }, this.healthCheckIntervalMs);
    this.healthTimer.unref?.();
  }

  async #runHealthCheck(generation, reason) {
    if (
      generation !== this.generation
      || this.healthCheckInFlight
      || !this.runtime
      || ![RUNTIME_STATUS.RUNNING, RUNTIME_STATUS.DEGRADED].includes(this.status.status)
    ) {
      return;
    }

    this.healthCheckInFlight = true;
    let result = null;
    let failureMessage = 'health check failed';
    try {
      result = await this.probeRuntime(this.runtime, { reason });
      this.onHealth?.(result);
      const healthy = result === true || result?.healthy === true;
      if (healthy) {
        this.healthFailures = 0;
        this.lastActiveWorkAt = result?.agentBusy === true ? this.now() : null;
        const degradedReason = typeof result?.degradedReason === 'string' && result.degradedReason
          ? result.degradedReason
          : null;
        if (degradedReason) {
          const degradedMessage = result.degradedMessage || 'Runtime is healthy but requires attention.';
          if (
            this.status.status !== RUNTIME_STATUS.DEGRADED
            || this.status.reasonCode !== degradedReason
            || this.status.message !== degradedMessage
          ) {
            this.#setStatus({
              status: RUNTIME_STATUS.DEGRADED,
              reasonCode: degradedReason,
              message: degradedMessage,
              lastHealthyAt: isoTimestamp(this.now),
              recoverable: true,
            });
          }
        } else if (
          this.status.status === RUNTIME_STATUS.DEGRADED
          && this.status.reasonCode !== 'restart_deferred'
        ) {
          this.#setStatus({
            status: RUNTIME_STATUS.RUNNING,
            reasonCode: 'health_restored',
            message: 'Runtime health has recovered.',
            lastHealthyAt: isoTimestamp(this.now),
            recoverable: true,
          });
        }
        return;
      }
      failureMessage = typeof result?.message === 'string' && result.message
        ? result.message
        : failureMessage;
    } catch (error) {
      failureMessage = errorMessage(error);
      try {
        this.onHealth?.({ healthy: false, error });
      } catch {
        // Health observers are diagnostic only.
      }
    } finally {
      this.healthCheckInFlight = false;
    }

    if (generation !== this.generation || !this.runtime) {
      return;
    }

    this.healthFailures += 1;
    const lastActiveWorkAgeMs = this.lastActiveWorkAt == null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, this.now() - this.lastActiveWorkAt);
    const activeWorkGraceApplies = (
      this.activeWorkHealthGraceMs > 0
      && lastActiveWorkAgeMs <= this.activeWorkHealthGraceMs
    );
    const effectiveFailureThreshold = activeWorkGraceApplies
      ? this.activeWorkFailureThreshold
      : this.healthFailureThreshold;
    if (this.healthFailures >= effectiveFailureThreshold) {
      await this.#enqueue(() => this.#recoverUnhealthyRuntime(generation, failureMessage));
      return;
    }
    if (
      this.healthFailures >= this.healthDegradedAfter
      && this.status.reasonCode !== 'restart_deferred'
    ) {
      this.#setStatus({
        status: RUNTIME_STATUS.DEGRADED,
        reasonCode: activeWorkGraceApplies
          ? 'health_check_failed_during_active_work'
          : 'health_check_failed',
        message: activeWorkGraceApplies
          ? `Runtime health check failed during recently active work (${this.healthFailures}/${effectiveFailureThreshold}); recovery is being delayed: ${failureMessage}`
          : `Runtime health check failed (${this.healthFailures}/${effectiveFailureThreshold}): ${failureMessage}`,
        recoverable: true,
      });
    }
  }

  async #recoverUnhealthyRuntime(generation, failureMessage) {
    if (generation !== this.generation || !this.runtime) {
      return cloneStatus(this.status);
    }

    const runtime = this.runtime;
    this.runtime = null;
    ++this.generation;
    this.#clearStableTimer();
    this.#clearHealthMonitor();
    this.healthFailures = 0;
    try {
      await this.stopRuntime(runtime, { reason: 'health-check-failed' });
    } catch (error) {
      return this.#setStatus({
        status: RUNTIME_STATUS.ERROR,
        reasonCode: 'unhealthy_runtime_stop_failed',
        message: `Runtime is unhealthy and could not be stopped safely: ${errorMessage(error)}`,
        recoverable: true,
      });
    }

    this.#scheduleAutomaticRestart({
      description: failureMessage,
      reasonCode: 'runtime_unhealthy',
    });
    return cloneStatus(this.status);
  }

  #armStableWindow(generation) {
    this.#clearStableTimer();
    if (!Number.isFinite(this.stableWindowMs) || this.stableWindowMs <= 0 || this.status.restartCount === 0) {
      return;
    }

    this.stableTimer = setTimeout(() => {
      this.stableTimer = null;
      if (generation === this.generation && this.status.status === RUNTIME_STATUS.RUNNING) {
        this.#setStatus({ restartCount: 0 });
      }
    }, this.stableWindowMs);
    this.stableTimer.unref?.();
  }

  #clearStableTimer() {
    if (this.stableTimer) {
      clearTimeout(this.stableTimer);
      this.stableTimer = null;
    }
  }

  #clearHealthMonitor() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    this.healthCheckInFlight = false;
    this.healthFailures = 0;
    this.lastActiveWorkAt = null;
  }
}
