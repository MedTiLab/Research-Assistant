import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPiPermissionBridge } from '../pi-runtime/permission-bridge.js';
import {
  createPiToolAuditLog,
  redactPiAuditValue,
  resolvePiToolAuditPath,
} from '../pi-runtime/tool-audit.js';

const identity = {
  ownerKey: 'owner-a',
  projectKey: 'project-a',
  runtimeId: 'pi',
  sessionId: 'session-a',
};

let testRoot;

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-pi-audit-'));
});

afterEach(async () => {
  vi.useRealTimers();
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('Pi permission bridge', () => {
  it('clears the exact Host-expired question without a second delayed timeout or a late approval', async () => {
    vi.useFakeTimers();
    const writer = { send: vi.fn() };
    let requestCount = 0;
    const bridge = createPiPermissionBridge({ createRequestId: () => `question-${++requestCount}` });
    const first = bridge.request({ identity, sessionKey: 'first', approvalId: 'host-question', toolCallId: 'ask-1', toolName: 'AskUserQuestion', writer });
    const other = bridge.request({ identity, sessionKey: 'second', approvalId: 'host-question', writer });
    expect(bridge.resolveHostApproval('first', 'wrong-id', { allow: false, reason: 'timeout' })).toBe(false);
    expect(bridge.resolveHostApproval('wrong-session', 'host-question', { allow: false, reason: 'timeout' })).toBe(false);
    expect(bridge.resolveHostApproval('first', 'host-question', { allow: false, cancelled: true, reason: 'timeout' })).toBe(true);
    await expect(first).resolves.toMatchObject({ allow: false, reason: 'timeout' });
    expect(bridge.size()).toBe(1);
    expect(writer.send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'agent-permission-cancelled', requestId: 'question-1', reason: 'timeout',
      toolCallId: 'ask-1', toolName: 'AskUserQuestion', projectKey: 'project-a',
    }));
    expect(bridge.resolve('question-1', { allow: true }, { ownerKey: identity.ownerKey })).toBe(false);
    bridge.resolve('question-2', { allow: true });
    await other;
    await vi.advanceTimersByTimeAsync(120001);
    expect(writer.send.mock.calls.filter(([event]) => event.type === 'agent-permission-cancelled')).toHaveLength(1);
    expect(bridge.size()).toBe(0);
  });

  it('settles only once when the bridge timer or a user response wins the race', async () => {
    vi.useFakeTimers();
    const writer = { send: vi.fn() };
    const bridge = createPiPermissionBridge({ timeoutMs: 10, createRequestId: () => 'race' });
    const request = () => bridge.request({ identity, sessionKey: 'session', approvalId: 'approval', writer });
    const timedOut = request();
    await vi.advanceTimersByTimeAsync(11);
    await expect(timedOut).resolves.toMatchObject({ allow: false, cancelled: true, reason: 'timeout' });
    expect(bridge.resolveHostApproval('session', 'approval', { allow: false, reason: 'timeout' })).toBe(false);
    const answered = request();
    bridge.resolve('race', { allow: true, updatedInput: { answers: { Choice: 'Yes' } } });
    expect(bridge.resolveHostApproval('session', 'approval', { allow: true })).toBe(false);
    await expect(answered).resolves.toMatchObject({ allow: true, updatedInput: { answers: { Choice: 'Yes' } } });
    await vi.advanceTimersByTimeAsync(11);
    expect(writer.send.mock.calls.filter(([event]) => event.type === 'agent-permission-cancelled')).toHaveLength(1);
  });

  it('binds approval decisions to the request owner', async () => {
    const writer = { send: vi.fn() };
    const bridge = createPiPermissionBridge({ createRequestId: () => 'permission-a' });
    const pending = bridge.request({
      identity,
      sessionKey: 'session-key-a',
      toolCallId: 'tool-a',
      toolName: 'write',
      input: { path: 'paper.md' },
      writer,
    });

    expect(writer.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'agent-permission-request',
      runtimeId: 'pi',
      requestId: 'permission-a',
      toolName: 'write',
    }));
    expect(bridge.resolve('permission-a', { allow: true }, { ownerKey: 'owner-b' })).toBe(false);
    expect(bridge.size()).toBe(1);
    expect(bridge.resolve('permission-a', { allow: true }, { ownerKey: 'owner-a' })).toBe(true);
    await expect(pending).resolves.toMatchObject({ allow: true, cancelled: false });
    expect(bridge.size()).toBe(0);
  });

  it('cancels pending approvals on abort and notifies the renderer', async () => {
    const writer = { send: vi.fn() };
    const bridge = createPiPermissionBridge({ createRequestId: () => 'permission-b' });
    const pending = bridge.request({
      identity,
      sessionKey: 'session-key-b',
      toolName: 'bash',
      input: { command: 'pwd' },
      writer,
    });
    expect(bridge.cancelSession('session-key-b', 'aborted')).toBe(1);
    await expect(pending).resolves.toMatchObject({ allow: false, cancelled: true, reason: 'aborted' });
    expect(writer.send).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'agent-permission-cancelled',
      reason: 'aborted',
    }));
  });

  it('fails closed when no interactive renderer is attached', async () => {
    const bridge = createPiPermissionBridge();
    await expect(bridge.request({
      identity,
      sessionKey: 'session-key-headless',
      toolName: 'write',
      input: { path: 'paper.md' },
    })).resolves.toMatchObject({
      allow: false,
      cancelled: true,
      reason: 'approval_channel_unavailable',
    });
    expect(bridge.size()).toBe(0);
  });
});

describe('Pi tool audit', () => {
  it('writes owner-scoped JSONL while redacting secrets, headers, and tokens', async () => {
    const secret = 'server-secret-value-123456';
    const audit = createPiToolAuditLog(identity, {
      dataDir: testRoot,
      secretEnv: { MEDHELP_PI_API_KEY: secret },
      now: () => '2026-08-26T00:00:00.000Z',
    });
    await audit.append({
      phase: 'approval_requested',
      toolName: 'write',
      input: {
        path: 'paper.md',
        content: `Authorization: Bearer ${secret}\napi_key=${secret}`,
        headers: { Authorization: `Bearer ${secret}` },
      },
    });
    await audit.append({
      phase: 'completed',
      result: `token=${secret} sk-testfixture12`,
    });

    const auditPath = resolvePiToolAuditPath(identity, { dataDir: testRoot });
    const contents = await fs.readFile(auditPath, 'utf8');
    expect(contents).not.toContain(secret);
    expect(contents).not.toContain('sk-testfixture12');
    expect(contents).toContain('[REDACTED]');
    expect(contents.trim().split('\n')).toHaveLength(2);
    if (process.platform !== 'win32') {
      expect((await fs.stat(auditPath)).mode & 0o777).toBe(0o600);
    }
  });

  it('handles cyclic data and sensitive key names without throwing', () => {
    const value = { token: 'secret', safe: 'ok' };
    value.self = value;
    expect(redactPiAuditValue(value)).toEqual({
      token: '[REDACTED]',
      safe: 'ok',
      self: '[CIRCULAR]',
    });
  });
});
