import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_FAUX_HOST_PATH,
  createPiHostManager,
  resolvePiHostLaunch,
} from '../pi-runtime/host-manager.js';
import { readPiSessionRecords } from '../pi-runtime/session-store.js';
import { redactPiHostMessage } from '../pi-runtime/rpc-client.js';

let testRoot;
let projectRoot;
const managers = [];

function identity(sessionId = 'session-a') {
  return {
    ownerKey: 'owner-a',
    projectKey: 'project-a',
    runtimeId: 'pi',
    sessionId,
  };
}

function createManager(overrides = {}) {
  const manager = createPiHostManager({
    hostPath: DEFAULT_FAUX_HOST_PATH,
    configRoot: path.join(testRoot, 'config'),
    startTimeoutMs: 500,
    requestTimeoutMs: 2_000,
    abortTimeoutMs: 100,
    terminateTimeoutMs: 100,
    ...overrides,
  });
  managers.push(manager);
  return manager;
}

function turnContext(overrides = {}) {
  const session = overrides.identity || identity();
  return {
    sessionKey: `key:${session.sessionId}`,
    turnId: `turn:${session.sessionId}`,
    identity: session,
    sessionPath: path.join(testRoot, 'sessions', `${session.sessionId}.jsonl`),
    projectRoot,
    prompt: '你好，Pi',
    modelId: 'pi-faux-v1',
    ...overrides,
  };
}

async function waitForActive(manager, sessionKey) {
  await vi.waitFor(() => expect(manager.isActive(sessionKey)).toBe(true));
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-pi-host-'));
  projectRoot = path.join(testRoot, 'project');
  await fs.mkdir(projectRoot);
});

afterEach(async () => {
  await Promise.allSettled(managers.splice(0).map((manager) => manager.shutdown()));
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('Pi RPC Host manager', () => {
  it('launches the bundled Pi Host with the bundled Node, independent of user data', () => {
    const runtimeRoot = path.join(testRoot, 'Installed App', 'kernel-runtime');
    const env = { MEDHELP_RUNTIME_ROOT: runtimeRoot };
    const launch = resolvePiHostLaunch({ env, dataDir: path.join(testRoot, 'fresh-user') });
    expect(launch).toEqual({
      command: path.join(runtimeRoot, 'bin', process.platform === 'win32' ? 'node.exe' : 'node'),
      args: [path.join(runtimeRoot, 'pi-runtime', 'sdk-host.mjs')],
      hostPath: path.join(runtimeRoot, 'pi-runtime', 'sdk-host.mjs'),
      source: 'bundled',
    });
    expect(resolvePiHostLaunch({ env, hostPath: DEFAULT_FAUX_HOST_PATH })).toMatchObject({
      hostPath: DEFAULT_FAUX_HOST_PATH,
      source: 'explicit',
    });
    expect(resolvePiHostLaunch({ env: { ...env, MEDHELP_PI_HOST_PATH: DEFAULT_FAUX_HOST_PATH } })).toMatchObject({
      hostPath: DEFAULT_FAUX_HOST_PATH,
      source: 'configured',
    });
  });

  it('runs a Unicode prompt and preserves a recoverable session JSONL transcript', async () => {
    const manager = createManager();
    const events = [];
    const context = turnContext({ onEvent: (event) => events.push(event) });
    const result = await manager.runTurn(context);

    expect(result).toMatchObject({ sessionId: 'session-a', status: 'completed' });
    expect(events.map((event) => event.event)).toEqual([
      'session_started',
      'text_delta',
      'usage',
      'turn_completed',
    ]);
    expect(events[1].data.text).toContain('你好，Pi');
    const transcript = await readPiSessionRecords(identity(), {
      sessionPath: context.sessionPath,
    });
    expect(transcript.records.map((record) => record.type)).toEqual([
      'session_start',
      'user',
      'assistant',
      'usage',
    ]);
    expect(manager.getActiveSessions()).toEqual([]);
  });

  it('supports resume, steering, state inspection, abort, and compaction', async () => {
    const manager = createManager();
    const original = turnContext();
    await manager.runTurn(original);

    await manager.runTurn(turnContext({
      method: 'resume',
      prompt: '继续',
      sessionPath: original.sessionPath,
    }));
    const running = turnContext({
      sessionKey: 'key:active',
      sessionPath: original.sessionPath,
      delayMs: 1_000,
    });
    const pending = manager.runTurn(running);
    // Attach the expected rejection before any readiness assertions or cleanup.
    const aborted = expect(pending).rejects.toMatchObject({ code: 'PI_TURN_ABORTED' });
    await waitForActive(manager, running.sessionKey);
    // A process record exists before prompt initialization finishes.
    await vi.waitFor(async () => expect(await manager.getState(running.sessionKey)).toMatchObject({ state: 'running', sessionId: 'session-a' }));
    await expect(manager.steer(running.sessionKey, '换个方向')).resolves.toBe(true);
    await expect(manager.abort(running.sessionKey)).resolves.toBe(true);
    await aborted;

    await expect(manager.runTurn(turnContext({
      method: 'compact',
      sessionKey: 'key:compact',
      sessionPath: original.sessionPath,
      params: { sessionId: 'session-a' },
    }))).resolves.toMatchObject({ type: 'compaction', sessionId: 'session-a' });
  });

  it('accepts CRLF JSONL protocol lines and Unicode payloads', async () => {
    const fixturePath = path.join(testRoot, 'crlf-host.mjs');
    await fs.writeFile(fixturePath, `
      import readline from 'readline';
      const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
      const send = (value) => process.stdout.write(JSON.stringify(value) + '\\r\\n');
      input.on('line', (line) => {
        const request = JSON.parse(line);
        if (request.method === 'initialize') {
          send({ id: request.id, ok: true, result: { protocolVersion: 1 } });
        } else {
          send({ event: 'text_delta', sessionId: 'crlf', data: { text: '多字节✓' } });
          send({ id: request.id, ok: true, result: { sessionId: 'crlf' } });
        }
      });
    `);
    const manager = createManager({ hostPath: fixturePath });
    const events = [];
    await manager.runTurn(turnContext({
      sessionKey: 'key:crlf',
      onEvent: (event) => events.push(event),
    }));
    expect(events[0]).toMatchObject({ data: { text: '多字节✓' } });
  });

  it.each([
    ['invalid-json', 'PI_HOST_PROTOCOL_ERROR', {}],
    ['crash', 'PI_HOST_CRASHED', {}],
    ['stderr-flood', 'PI_HOST_OUTPUT_LIMIT', { maxStderrBytes: 512 }],
    ['stdout-flood', 'PI_HOST_OUTPUT_LIMIT', { maxLineBytes: 512 }],
    ['startup-hang', 'PI_HOST_START_TIMEOUT', { startTimeoutMs: 30 }],
  ])('normalizes %s failures to %s and cleans active state', async (behavior, code, limits) => {
    const manager = createManager({
      ...limits,
      hostEnv: { PI_FAUX_HOST_BEHAVIOR: behavior },
    });
    await expect(manager.runTurn(turnContext())).rejects.toMatchObject({ code });
    expect(manager.getActiveSessions()).toEqual([]);
  });

  it('rejects protocol mismatches and missing hosts with stable codes', async () => {
    const mismatch = createManager({ hostEnv: { PI_FAUX_PROTOCOL_VERSION: '99' } });
    await expect(mismatch.runTurn(turnContext({ sessionKey: 'key:mismatch' })))
      .rejects.toMatchObject({ code: 'PI_HOST_VERSION_MISMATCH' });

    const missing = createManager({ hostPath: path.join(testRoot, 'missing-host') });
    await expect(missing.runTurn(turnContext({ sessionKey: 'key:missing' })))
      .rejects.toMatchObject({ code: 'PI_HOST_NOT_FOUND' });
  });

  it('escalates an unacknowledged abort and removes the orphan process', async () => {
    const fixturePath = path.join(testRoot, 'stuck-host.mjs');
    await fs.writeFile(fixturePath, `
      import readline from 'readline';
      process.on('SIGTERM', () => {});
      setInterval(() => {}, 10_000);
      const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
      input.on('line', (line) => {
        const request = JSON.parse(line);
        if (request.method === 'initialize') {
          process.stdout.write(JSON.stringify({ id: request.id, ok: true, result: { protocolVersion: 1 } }) + '\\n');
        }
      });
    `);
    const manager = createManager({
      hostPath: fixturePath,
      abortTimeoutMs: 25,
      terminateTimeoutMs: 25,
    });
    const context = turnContext({ sessionKey: 'key:stuck' });
    const pending = manager.runTurn(context);
    await waitForActive(manager, context.sessionKey);
    await expect(manager.abort(context.sessionKey))
      .rejects.toMatchObject({ code: 'PI_HOST_ABORT_TIMEOUT' });
    await expect(pending).rejects.toMatchObject({ code: 'PI_HOST_CRASHED' });
    expect(manager.getActiveSessions()).toEqual([]);
  });

  it('cleans temporary config and redacts credentials from diagnostics errors', async () => {
    const manager = createManager();
    await manager.runTurn(turnContext({
      secretEnv: { PI_FAUX_API_KEY: 'super-secret-value' },
    }));
    const configFiles = [];
    async function collectFiles(directory) {
      let entries = [];
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (error?.code === 'ENOENT') return;
        throw error;
      }
      for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) await collectFiles(entryPath);
        else configFiles.push(entryPath);
      }
    }
    await collectFiles(path.join(testRoot, 'config'));
    expect(configFiles).toEqual([]);
    expect(redactPiHostMessage(
      'Authorization: Bearer abc123 api_key=def456 https://x.test/?token=ghi789',
    )).toBe(
      'Authorization: [REDACTED] api_key=[REDACTED] https://x.test/?token=[REDACTED]',
    );
  });
});
