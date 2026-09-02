const DEFAULT_RUNTIME_RECOVERY_TIMEOUT_MS = 15_000;
const DEFAULT_RUNTIME_REQUEST_TIMEOUT_MS = 15_000;
const MAX_RUNTIME_GET_ATTEMPTS = 3;

export class DesktopRuntimeRequestError extends Error {
  code: 'RUNTIME_REQUEST_TIMEOUT' | 'RUNTIME_UNAVAILABLE';
  attempts: number;
  cause: unknown;

  constructor(error: unknown, attempts: number) {
    const timeout = error instanceof DOMException && error.name === 'TimeoutError';
    super(timeout ? 'Runtime request timed out.' : 'Runtime is temporarily unavailable.');
    this.name = 'DesktopRuntimeRequestError';
    this.code = timeout ? 'RUNTIME_REQUEST_TIMEOUT' : 'RUNTIME_UNAVAILABLE';
    this.attempts = attempts;
    this.cause = error;
  }
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  return normalized === 'localhost' || normalized === '::1' || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function isRequestInput(input: RequestInfo | URL): input is Request {
  return typeof Request !== 'undefined' && input instanceof Request;
}

function inputUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export function isSafeDesktopRuntimeRetry(input: RequestInfo | URL, init: RequestInit = {}) {
  const method = String(init.method || (isRequestInput(input) ? input.method : 'GET')).toUpperCase();
  if (!['GET', 'HEAD'].includes(method)) return false;

  const value = inputUrl(input);
  if (value.startsWith('/')) return true;
  try {
    return isLoopbackHostname(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isDesktopRuntimeRetryTarget(input: RequestInfo | URL) {
  const value = inputUrl(input);
  if (!value.startsWith('/')) return true;

  // Legacy Desktop serves the React application from the Runtime origin, so a
  // relative API URL belongs to that Runtime. Modern hosted/offline Desktop
  // keeps cloud APIs relative to the application origin and sends Kernel APIs
  // as absolute loopback URLs; never reroute those cloud calls into Kernel.
  const uiMode = typeof window === 'undefined' ? null : window.medhelpDesktop?.uiMode;
  return uiMode !== 'hosted' && uiMode !== 'offline';
}

export function resolveDesktopRuntimeRetryUrl(input: RequestInfo | URL, baseUrl: string) {
  const runtime = new URL(baseUrl);
  if (!['http:', 'https:'].includes(runtime.protocol) || !isLoopbackHostname(runtime.hostname)) {
    throw new Error(`Invalid desktop Runtime endpoint: ${baseUrl}`);
  }

  const value = inputUrl(input);
  if (value.startsWith('/')) {
    return new URL(value, runtime.origin).toString();
  }
  const current = new URL(value);
  return new URL(`${current.pathname}${current.search}${current.hash}`, runtime.origin).toString();
}

async function waitForDesktopRuntimeRunning(timeoutMs = DEFAULT_RUNTIME_RECOVERY_TIMEOUT_MS) {
  const bridge = typeof window === 'undefined' ? null : window.medhelpDesktop;
  if (!bridge?.getRuntimeStatus || !bridge.onRuntimeStatus) return null;

  const current = await bridge.getRuntimeStatus().catch(() => null);
  if (current?.status === 'running' && current.baseUrl) return current;

  return new Promise<MedHelpDesktopRuntimeStatus | null>((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    const finish = (status: MedHelpDesktopRuntimeStatus | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe?.();
      resolve(status);
    };
    const timeout = setTimeout(() => finish(null), timeoutMs);
    unsubscribe = bridge.onRuntimeStatus?.((status) => {
      if (status.status === 'running' && status.baseUrl) {
        finish(status);
      } else if (status.status === 'missing' && !status.recoverable) {
        finish(null);
      }
    });
  });
}

async function fetchRuntimeRequestWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs = DEFAULT_RUNTIME_REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const requestSignal = isRequestInput(input) ? input.signal : null;
  const externalSignals = [init.signal, requestSignal].filter(Boolean) as AbortSignal[];
  const abortFromExternal = (signal: AbortSignal) => controller.abort(signal.reason);
  const cleanups: Array<() => void> = [];

  for (const signal of externalSignals) {
    if (signal.aborted) {
      abortFromExternal(signal);
      break;
    }
    const listener = () => abortFromExternal(signal);
    signal.addEventListener('abort', listener, { once: true });
    cleanups.push(() => signal.removeEventListener('abort', listener));
  }

  const timeout = setTimeout(() => {
    controller.abort(new DOMException('Runtime request timed out.', 'TimeoutError'));
  }, timeoutMs);

  try {
    return await globalThis.fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    cleanups.forEach((cleanup) => cleanup());
  }
}

export async function runtimeAwareFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const safeRuntimeRequest = isSafeDesktopRuntimeRetry(input, init) && isDesktopRuntimeRetryTarget(input);
  if (!safeRuntimeRequest) {
    return globalThis.fetch(input, init);
  }

  const requestSignal = isRequestInput(input) ? input.signal : null;
  let attemptInput = input;
  let firstError: unknown = null;
  for (let attempt = 1; attempt <= MAX_RUNTIME_GET_ATTEMPTS; attempt += 1) {
    try {
      return await fetchRuntimeRequestWithTimeout(attemptInput, init);
    } catch (error) {
      firstError ??= error;
      if (init.signal?.aborted || requestSignal?.aborted) {
        throw error;
      }
      if (attempt >= MAX_RUNTIME_GET_ATTEMPTS) {
        throw new DesktopRuntimeRequestError(error, attempt);
      }

      const runtime = await waitForDesktopRuntimeRunning();
      if (!runtime?.baseUrl || init.signal?.aborted || requestSignal?.aborted) {
        throw new DesktopRuntimeRequestError(firstError, attempt);
      }
      const retryUrl = resolveDesktopRuntimeRetryUrl(input, runtime.baseUrl);
      attemptInput = isRequestInput(input) ? new Request(retryUrl, input) : retryUrl;
    }
  }
  throw new DesktopRuntimeRequestError(firstError, MAX_RUNTIME_GET_ATTEMPTS);
}
