import { EventEmitter } from 'events';

export const PI_HOST_PROTOCOL_VERSION = 1;
export const DEFAULT_PI_HOST_LIMITS = Object.freeze({
  requestTimeoutMs: 30_000,
  maxLineBytes: 1024 * 1024,
  maxStderrBytes: 256 * 1024,
});

export function redactPiHostMessage(value) {
  return String(value || '')
    .replace(
      /(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi,
      '$1[REDACTED]',
    )
    .replace(
      /((?:api[-_ ]?key|access[-_ ]?token|bearer)\s*[:=]\s*)[^\s,;]+/gi,
      '$1[REDACTED]',
    )
    .replace(/([?&](?:api_?key|access_?token|token)=)[^&#\s]+/gi, '$1[REDACTED]')
    .slice(0, 2_000);
}

export function createPiRuntimeError(code, message, metadata = {}) {
  const error = new Error(redactPiHostMessage(message));
  error.code = code;
  Object.assign(error, metadata);
  return error;
}

function errorFromResponse(payload) {
  const responseError = payload?.error && typeof payload.error === 'object'
    ? payload.error
    : {};
  return createPiRuntimeError(
    typeof responseError.code === 'string' && responseError.code
      ? responseError.code
      : 'PI_HOST_PROTOCOL_ERROR',
    responseError.message || 'Pi Host rejected the RPC request.',
  );
}

export class PiRpcClient extends EventEmitter {
  constructor(childProcess, options = {}) {
    super();
    if (!childProcess?.stdin || !childProcess?.stdout || !childProcess?.stderr) {
      throw createPiRuntimeError(
        'PI_HOST_PROTOCOL_ERROR',
        'Pi Host process must expose stdin, stdout, and stderr streams.',
      );
    }

    this.child = childProcess;
    this.requestTimeoutMs = options.requestTimeoutMs
      ?? DEFAULT_PI_HOST_LIMITS.requestTimeoutMs;
    this.maxLineBytes = options.maxLineBytes ?? DEFAULT_PI_HOST_LIMITS.maxLineBytes;
    this.maxStderrBytes = options.maxStderrBytes ?? DEFAULT_PI_HOST_LIMITS.maxStderrBytes;
    this.pending = new Map();
    this.stdoutBuffer = Buffer.alloc(0);
    this.stderrBytes = 0;
    this.nextRequestId = 1;
    this.closed = false;
    this.expectedExit = false;
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });

    childProcess.stdout.on('data', (chunk) => this.handleStdout(chunk));
    childProcess.stderr.on('data', (chunk) => this.handleStderr(chunk));
    childProcess.once('error', (error) => this.handleProcessError(error));
    childProcess.once('exit', (code, signal) => this.handleExit(code, signal));
  }

  handleStdout(chunk) {
    if (this.closed) return;
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, incoming]);

    let newlineIndex = this.stdoutBuffer.indexOf(0x0a);
    while (newlineIndex >= 0) {
      if (newlineIndex > this.maxLineBytes) {
        this.fail(createPiRuntimeError(
          'PI_HOST_OUTPUT_LIMIT',
          `Pi Host emitted a line larger than ${this.maxLineBytes} bytes.`,
        ));
        return;
      }
      let line = this.stdoutBuffer.subarray(0, newlineIndex);
      this.stdoutBuffer = this.stdoutBuffer.subarray(newlineIndex + 1);
      if (line.at(-1) === 0x0d) line = line.subarray(0, -1);
      if (line.length > 0) this.handleLine(line.toString('utf8'));
      if (this.closed) return;
      newlineIndex = this.stdoutBuffer.indexOf(0x0a);
    }

    if (this.stdoutBuffer.length > this.maxLineBytes) {
      this.fail(createPiRuntimeError(
        'PI_HOST_OUTPUT_LIMIT',
        `Pi Host emitted a line larger than ${this.maxLineBytes} bytes.`,
      ));
    }
  }

  handleLine(line) {
    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      this.fail(createPiRuntimeError('PI_HOST_PROTOCOL_ERROR', 'Pi Host emitted invalid JSON.'));
      return;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      this.fail(createPiRuntimeError('PI_HOST_PROTOCOL_ERROR', 'Pi Host emitted an invalid envelope.'));
      return;
    }

    if (typeof payload.event === 'string' && payload.event) {
      this.emit('event', payload);
      return;
    }

    if (typeof payload.id !== 'string' || !payload.id) {
      this.fail(createPiRuntimeError(
        'PI_HOST_PROTOCOL_ERROR',
        'Pi Host response is missing a request id.',
      ));
      return;
    }
    const pending = this.pending.get(payload.id);
    if (!pending) {
      this.fail(createPiRuntimeError(
        'PI_HOST_PROTOCOL_ERROR',
        `Pi Host responded to unknown request "${payload.id}".`,
      ));
      return;
    }
    this.pending.delete(payload.id);
    clearTimeout(pending.timeout);
    if (payload.ok === true) pending.resolve(payload.result ?? null);
    else pending.reject(errorFromResponse(payload));
  }

  handleStderr(chunk) {
    if (this.closed) return;
    this.stderrBytes += Buffer.byteLength(chunk);
    if (this.stderrBytes > this.maxStderrBytes) {
      this.fail(createPiRuntimeError(
        'PI_HOST_OUTPUT_LIMIT',
        `Pi Host stderr exceeded ${this.maxStderrBytes} bytes.`,
      ));
    }
  }

  handleProcessError(error) {
    const code = error?.code === 'ENOENT' ? 'PI_HOST_NOT_FOUND' : 'PI_HOST_CRASHED';
    this.fail(createPiRuntimeError(code, error?.message || 'Pi Host failed to start.'));
  }

  handleExit(code, signal) {
    this.resolveExit?.({ code, signal });
    if (this.closed) return;
    if (this.expectedExit) {
      this.close();
      return;
    }
    this.fail(createPiRuntimeError(
      'PI_HOST_CRASHED',
      `Pi Host exited unexpectedly (code ${code ?? 'null'}, signal ${signal || 'none'}).`,
      { exitCode: code ?? null, signal: signal || null },
    ), { terminate: false });
  }

  fail(error, { terminate = true } = {}) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.emit('fatal', error);
    if (terminate && this.child.exitCode == null && !this.child.killed) {
      try {
        this.child.kill('SIGTERM');
      } catch {}
    }
  }

  async request(method, params = {}, options = {}) {
    if (this.closed) {
      throw createPiRuntimeError('PI_HOST_CRASHED', 'Pi Host connection is closed.');
    }
    if (typeof method !== 'string' || !method.trim()) {
      throw createPiRuntimeError('PI_HOST_PROTOCOL_ERROR', 'Pi RPC method is required.');
    }
    const id = `req-${this.nextRequestId++}`;
    const timeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
    const timeoutCode = options.timeoutCode || 'PI_HOST_PROTOCOL_ERROR';
    const response = new Promise((resolve, reject) => {
      const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(createPiRuntimeError(
              timeoutCode,
              `Pi Host did not respond to "${method}" within ${timeoutMs}ms.`,
              { method },
            ));
          }, timeoutMs)
        : null;
      timeout?.unref?.();
      this.pending.set(id, { resolve, reject, timeout });
    });

    const line = `${JSON.stringify({ id, method: method.trim(), params })}\n`;
    try {
      await new Promise((resolve, reject) => {
        this.child.stdin.write(line, 'utf8', (error) => (error ? reject(error) : resolve()));
      });
    } catch (error) {
      const writeError = createPiRuntimeError(
        'PI_HOST_CRASHED',
        error?.message || 'Failed to write to Pi Host.',
      );
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(id);
        pending.reject(writeError);
      }
      return response;
    }
    return response;
  }

  expectProcessExit() {
    this.expectedExit = true;
  }

  waitForExit() {
    return this.exitPromise;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    const error = createPiRuntimeError('PI_HOST_CRASHED', 'Pi Host connection closed.');
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export default PiRpcClient;
