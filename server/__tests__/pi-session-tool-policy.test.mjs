import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createPiHostSessionStore,
  readPiSessionRecords,
  resolvePiSessionPath,
  summarizePiSessionRecords,
} from '../pi-runtime/session-store.js';
import { syncPiSessionIndex } from '../pi-runtime/session-index.js';
import { createOutputFile, createToolOutputBudget, prunePiOutputFiles } from '../pi-runtime/output-budget.js';
import {
  PI_BASH_MAX_TIMEOUT_MS,
  PI_COORDINATION_TOOLS,
  authorizePiToolCall,
  createPiToolPolicy,
  resolvePiReadOnlyPath,
} from '../pi-runtime/tool-policy.js';

let testRoot;
let projectRoot;
let outsideRoot;

describe('Pi tool output safety', () => {
  it('resets both the live budget and persisted counter after compaction, including queued output', async () => {
    const entries = [];
    const root = await fs.realpath(projectRoot);
    const budget = createToolOutputBudget({ projectRoot: root, sessionId: 'session', recordUsage: (entry) => entries.push(entry), env: { MEDHELP_PI_OUTPUT_MAX_BYTES: '100', MEDHELP_PI_OUTPUT_SESSION_BYTES: '100', MEDHELP_PI_OUTPUT_TIGHT_BYTES: '50' } });
    const result = () => budget.apply({ content: [{ type: 'text', text: 'A'.repeat(500) }] });
    const first = await result();
    expect(first.details.limitBytes).toBe(100);
    expect((await result()).details.limitBytes).toBe(50);
    const queued = budget.consumeFile(first.details.fullOutputPath);
    const reset = budget.resetAfterCompaction();
    expect((await queued).details.limitBytes).toBe(50);
    await reset;
    expect(entries.at(-1)).toMatchObject({ usedBytes: 0, resetReason: 'compaction' });
    expect((await result()).details.limitBytes).toBe(100);
  });

  it.each(['age', 'session', 'project', 'count'])('reclaims only generated old files under the %s retention limit', async (limit) => {
    const now = Date.now();
    const old = await createOutputFile(projectRoot, 'session');
    await old.handle.writeFile('A'.repeat(60)); await old.handle.close();
    await fs.utimes(old.path, new Date(now - 2 * 86400000), new Date(now - 2 * 86400000));
    const recent = await createOutputFile(projectRoot, limit === 'project' ? 'other' : 'session');
    await recent.handle.writeFile('B'.repeat(60)); await recent.handle.close();
    await fs.utimes(recent.path, new Date(now - 120000), new Date(now - 120000));
    const userFile = path.join(path.dirname(recent.path), 'keep-my-notes.txt'); await fs.writeFile(userFile, 'not a cache file');
    const env = { age: { MEDHELP_PI_OUTPUT_RETENTION_DAYS: '1' }, session: { MEDHELP_PI_OUTPUT_CACHE_SESSION_BYTES: '100' }, project: { MEDHELP_PI_OUTPUT_CACHE_PROJECT_BYTES: '100' }, count: { MEDHELP_PI_OUTPUT_CACHE_MAX_FILES: '1' } }[limit];
    expect(await prunePiOutputFiles(projectRoot, { env, now })).toMatchObject({ removedFiles: 1, remainingBytes: 60 });
    await expect(fs.access(old.path)).rejects.toThrow();
    expect(await fs.readFile(recent.path, 'utf8')).toBe('B'.repeat(60));
    expect(await fs.readFile(userFile, 'utf8')).toBe('not a cache file');
  });

  it('protects open captures, newly returned paths and symlink targets during collection', async () => {
    const open = await createOutputFile(projectRoot, 'session');
    await open.handle.writeFile('active');
    const partial = `${open.path}.partial-${process.pid}`;
    const oldTime = new Date(Date.now() - 10 * 86400000);
    await fs.utimes(partial, oldTime, oldTime);
    const recent = await createOutputFile(projectRoot, 'session'); await recent.handle.writeFile('recent'); await recent.handle.close();
    const link = path.join(path.dirname(path.dirname(recent.path)), 'a'.repeat(24));
    await fs.symlink(outsideRoot, link);
    expect((await prunePiOutputFiles(projectRoot, { env: { MEDHELP_PI_OUTPUT_CACHE_PROJECT_BYTES: '1' } })).removedFiles).toBe(0);
    await open.handle.writeFile(' more'); await open.handle.close();
    expect(await fs.readFile(open.path, 'utf8')).toContain('active');
    expect(await fs.readFile(recent.path, 'utf8')).toBe('recent');
    expect(await fs.readFile(path.join(outsideRoot, 'secret.txt'), 'utf8')).toBe('secret\n');
  });

  it('removes one session cache on permanent deletion but preserves other sessions', async () => {
    const own = await createOutputFile(projectRoot, identity.sessionId); await own.handle.writeFile('one'); await own.handle.close();
    const other = await createOutputFile(projectRoot, 'other'); await other.handle.writeFile('two'); await other.handle.close();
    await createPiHostSessionStore({ dataDir: testRoot }).delete(identity, { projectRoot });
    await expect(fs.access(own.path)).rejects.toThrow();
    expect(await fs.readFile(other.path, 'utf8')).toBe('two');
  });
  it('reaps an abandoned partial capture after its writer exits', async () => {
    const deadPid = execFileSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
    const file = await createOutputFile(projectRoot, 'session');
    await file.handle.writeFile('orphan'); await file.handle.close();
    const partial = `${file.path}.partial-${deadPid}`;
    await fs.rename(file.path, partial);
    expect((await prunePiOutputFiles(projectRoot, { now: Date.now() + 120000 })).removedFiles).toBe(1);
    await expect(fs.access(partial)).rejects.toThrow();
  });
  it('rejects a symlinked output directory and keeps the full Unicode result in the project', async () => {
    await fs.symlink(outsideRoot, path.join(projectRoot, '.medhelpsec'));
    await expect(createOutputFile(projectRoot, 'session')).rejects.toThrow('symlink');
    await fs.unlink(path.join(projectRoot, '.medhelpsec'));
    const canonicalRoot = await fs.realpath(projectRoot);
    const budget = createToolOutputBudget({ projectRoot: canonicalRoot, sessionId: 'session', env: { MEDHELP_PI_OUTPUT_MAX_BYTES: '100', MEDHELP_PI_OUTPUT_SESSION_BYTES: '200', MEDHELP_PI_OUTPUT_TIGHT_BYTES: '50' } });
    const text = '中文完整结果'.repeat(100);
    const result = await budget.apply({ content: [{ type: 'text', text }] });
    expect(result.content[0].text).toContain('Output truncated');
    expect(result.content[0].text).not.toContain('\uFFFD');
    expect(await fs.readFile(result.details.fullOutputPath, 'utf8')).toBe(text);
    await expect(budget.consumeFile(path.join(outsideRoot, 'outside.txt'))).rejects.toThrow();
  });
});

const identity = {
  ownerKey: 'owner-a',
  projectKey: 'project-a',
  runtimeId: 'pi',
  sessionId: 'session-a',
};

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-pi-policy-'));
  projectRoot = path.join(testRoot, 'project');
  outsideRoot = path.join(testRoot, 'outside');
  await Promise.all([fs.mkdir(projectRoot), fs.mkdir(outsideRoot)]);
  await fs.writeFile(path.join(projectRoot, 'paper.md'), '# paper\n');
  await fs.writeFile(path.join(outsideRoot, 'secret.txt'), 'secret\n');
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('Pi session recovery', () => {
  it('keeps tool results attached when a call and result fall on different pages', async () => {
    const sessionPath = resolvePiSessionPath(identity, { dataDir: testRoot });
    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    await fs.writeFile(sessionPath, [
      { type: 'session', id: identity.sessionId },
      { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'call', name: 'bash', arguments: { command: 'false' } }] } },
      { type: 'message', message: { role: 'toolResult', toolCallId: 'call', toolName: 'bash', content: [{ type: 'text', text: 'failure output' }], isError: true } },
    ].map((record) => JSON.stringify(record)).join('\n') + '\n');
    const page = await createPiHostSessionStore({ dataDir: testRoot }).read(identity, { limit: 1, offset: 1 });
    expect(page.messages).toHaveLength(1);
    expect(page.total).toBe(2);
    expect(page.messages[0].toolResults.call).toMatchObject({ toolCallId: 'call', output: 'failure output', isError: true });
  });
  it('derives the title from the first visible question and counts every conversation message', () => {
    const records = [
      {
        type: 'message',
        timestamp: '2026-08-26T01:00:00.000Z',
        message: {
          role: 'user',
          content: '<execution_memory>internal state</execution_memory>\n\n[Context: session-mode=research]\n名字也不根据问题变化',
        },
      },
      {
        type: 'message',
        timestamp: '2026-08-26T01:00:01.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: '已处理' }] },
      },
      { type: 'user', createdAt: '2026-08-26T01:01:00.000Z', content: '第二个问题' },
      { type: 'assistant', createdAt: '2026-08-26T01:01:01.000Z', content: '第二个回答' },
    ];

    expect(summarizePiSessionRecords(records)).toEqual({
      displayName: '名字也不根据问题变化',
      messageCount: 4,
      lastActivity: '2026-08-26T01:01:01.000Z',
    });
  });

  it('synchronizes a generated Pi title/count while preserving manual renames', async () => {
    const sessionPath = resolvePiSessionPath(identity, { dataDir: testRoot });
    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    await fs.writeFile(sessionPath, [
      JSON.stringify({ type: 'session', id: 'session-a' }),
      JSON.stringify({ type: 'message', timestamp: '2026-08-26T01:00:00.000Z', message: { role: 'user', content: '左边消息数量没有变化' } }),
      JSON.stringify({ type: 'message', timestamp: '2026-08-26T01:00:01.000Z', message: { role: 'assistant', content: '检查中' } }),
      '',
    ].join('\n'));

    let existing = {
      display_name: 'Pi Session',
      message_count: 0,
      metadata: { displayNameSource: 'placeholder' },
    };
    const writes = [];
    const sessionDb = {
      getSessionByIdentity: () => existing,
      upsertSessionFromSource: (_sessionId, _projectKey, _provider, payload) => {
        writes.push(payload);
        return payload;
      },
    };

    await syncPiSessionIndex(identity, { sessionDb, storageOptions: { dataDir: testRoot } });
    expect(writes.at(-1)).toMatchObject({
      displayName: '左边消息数量没有变化',
      messageCount: 2,
      metadata: { indexState: 'synced', displayNameSource: 'user' },
    });

    existing = {
      ...existing,
      display_name: '我手动改的标题',
      metadata: { displayNameSource: 'manual' },
    };
    await syncPiSessionIndex(identity, { sessionDb, storageOptions: { dataDir: testRoot } });
    expect(writes.at(-1)).toMatchObject({
      displayName: '我手动改的标题',
      messageCount: 2,
      metadata: { indexState: 'synced', displayNameSource: 'manual' },
    });
  });

  it('repairs an incomplete trailing JSONL record without dropping valid history', async () => {
    const sessionPath = resolvePiSessionPath(identity, { dataDir: testRoot });
    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    await fs.writeFile(sessionPath, [
      JSON.stringify({ type: 'session_start', sessionId: 'session-a' }),
      JSON.stringify({ type: 'user', sessionId: 'session-a', content: 'hello' }),
      '{"type":"assistant"',
    ].join('\n'));

    const result = await readPiSessionRecords(identity, { dataDir: testRoot });
    expect(result.recovered).toBe(true);
    expect(result.records).toHaveLength(2);
    expect(await fs.readFile(sessionPath, 'utf8')).toBe(
      `${JSON.stringify(result.records[0])}\n${JSON.stringify(result.records[1])}\n`,
    );
  });

  it('rejects corruption in the middle of a session JSONL file', async () => {
    const sessionPath = resolvePiSessionPath(identity, { dataDir: testRoot });
    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    await fs.writeFile(sessionPath, '{"type":"session_start"}\nnot-json\n{"type":"user"}\n');
    await expect(readPiSessionRecords(identity, { dataDir: testRoot }))
      .rejects.toMatchObject({ code: 'PI_SESSION_CORRUPT', line: 2 });
  });

  it('exposes transcript, usage, delete, and reconcile through PiSessionStore', async () => {
    const sessionPath = resolvePiSessionPath(identity, { dataDir: testRoot });
    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    await fs.writeFile(sessionPath, [
      JSON.stringify({ type: 'session_start', sessionId: 'session-a', modelId: 'pi-faux-v1' }),
      JSON.stringify({ type: 'user', sessionId: 'session-a', content: 'hello' }),
      JSON.stringify({ type: 'assistant', sessionId: 'session-a', content: 'hi' }),
      JSON.stringify({ type: 'usage', sessionId: 'session-a', usage: { input_tokens: 2, output_tokens: 3 } }),
      '',
    ].join('\n'));
    const store = createPiHostSessionStore({ dataDir: testRoot });
    await expect(store.read(identity)).resolves.toMatchObject({
      messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }],
      tokenUsage: { provider: 'pi', totalTokens: 5 },
    });
    await expect(store.getUsage(identity)).resolves.toMatchObject({ totalTokens: 5 });
    await expect(store.reconcile(identity)).resolves.toEqual({ recovered: false });
    await expect(store.delete(identity)).resolves.toBe(true);
    await expect(fs.access(sessionPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('restores native Pi thinking, tool calls, and tool results without flattening the trace', async () => {
    const sessionPath = resolvePiSessionPath(identity, { dataDir: testRoot });
    await fs.mkdir(path.dirname(sessionPath), { recursive: true });
    await fs.writeFile(sessionPath, [
      JSON.stringify({ type: 'session', id: 'session-a' }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-08-27T01:00:00.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Inspecting the file.' },
            { type: 'toolCall', id: 'tool-a', name: 'read', arguments: { path: 'paper.md' } },
          ],
        },
      }),
      JSON.stringify({
        type: 'message',
        timestamp: '2026-08-27T01:00:01.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'tool-a',
          toolName: 'read',
          isError: false,
          content: [{ type: 'text', text: '# paper' }],
        },
      }),
      '',
    ].join('\n'));

    const store = createPiHostSessionStore({ dataDir: testRoot });
    const transcript = await store.read(identity);
    expect(transcript.messages).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Inspecting the file.' },
          { type: 'tool_use', id: 'tool-a', name: 'Read', input: { path: 'paper.md' }, nativeToolName: 'read', nativeToolInput: { path: 'paper.md' } },
        ],
        timestamp: '2026-08-27T01:00:00.000Z',
        createdAt: '2026-08-27T01:00:00.000Z',
      },
      {
        type: 'tool_result',
        role: 'tool',
        toolCallId: 'tool-a',
        toolName: 'Read',
        output: '# paper',
        isError: false,
        timestamp: '2026-08-27T01:00:01.000Z',
      },
    ]);
    expect(transcript.agentState).toMatchObject({
      identity,
      tasks: [],
      toolCalls: [],
      todos: [],
      artifacts: [],
    });
  });
});

describe('Pi read-only tool policy', () => {
  it('allows read-only tools and canonicalizes paths inside the project', async () => {
    const canonicalProjectRoot = await fs.realpath(projectRoot);
    await expect(authorizePiToolCall('read', { path: 'paper.md' }, { projectRoot }))
      .resolves.toMatchObject({
        allowed: true,
        toolName: 'read',
        input: { path: path.join(canonicalProjectRoot, 'paper.md') },
      });
    await expect(resolvePiReadOnlyPath(projectRoot, 'future/new.md'))
      .resolves.toBe(path.join(canonicalProjectRoot, 'future', 'new.md'));
  });

  it.each(['write', 'edit', 'bash', 'mcp', 'delegate'])('blocks the %s tool', async (toolName) => {
    await expect(authorizePiToolCall(toolName, {}, { projectRoot }))
      .rejects.toMatchObject({ code: 'PI_TOOL_NOT_ALLOWED' });
  });

  it('requires approval for write/edit/bash in Ask mode and hard-blocks them in Plan mode', async () => {
    await expect(authorizePiToolCall('write', {
      path: 'future/new.md',
      content: 'draft',
    }, { projectRoot, permissionMode: 'ask' })).resolves.toMatchObject({
      allowed: true,
      requiresApproval: true,
      permissionMode: 'ask',
      input: { path: path.join(await fs.realpath(projectRoot), 'future', 'new.md') },
    });
    await expect(authorizePiToolCall('edit', {
      path: 'paper.md',
      edits: [],
    }, { projectRoot, permissionMode: 'plan' })).rejects.toMatchObject({
      code: 'PI_TOOL_WRITE_BLOCKED_IN_PLAN',
    });
    expect(createPiToolPolicy(projectRoot, { permissionMode: 'ask' }).allowedTools)
      .toEqual(['read', 'grep', 'find', 'ls', 'system_info', 'write', 'edit', 'bash', ...PI_COORDINATION_TOOLS]);
    expect(createPiToolPolicy(projectRoot, { permissionMode: 'plan' }).allowedTools)
      .toEqual(['read', 'grep', 'find', 'ls', 'system_info', ...PI_COORDINATION_TOOLS]);
  });

  it('exposes computer resources in every mode and runs full tools automatically in Auto mode', async () => {
    await expect(authorizePiToolCall('system_info', { ignored: true }, {
      projectRoot,
      permissionMode: 'readOnly',
    })).resolves.toMatchObject({
      allowed: true,
      requiresApproval: false,
      input: {},
    });
    await expect(authorizePiToolCall('bash', { command: 'sysctl -n hw.ncpu' }, {
      projectRoot,
      permissionMode: 'auto',
    })).resolves.toMatchObject({
      allowed: true,
      requiresApproval: false,
      permissionMode: 'auto',
    });
    expect(createPiToolPolicy(projectRoot, { permissionMode: 'auto' }).allowedTools)
      .toEqual(['read', 'grep', 'find', 'ls', 'system_info', 'write', 'edit', 'bash', ...PI_COORDINATION_TOOLS]);
  });

  it('allows trusted MCP tool names only in Ask mode and always requires approval', async () => {
    const ask = createPiToolPolicy(projectRoot, {
      permissionMode: 'ask',
      trustedMcpServers: ['trusted-tools'],
    });
    await expect(ask.authorize('mcp__trusted-tools__lookup', { query: 'safe' }))
      .resolves.toMatchObject({
        allowed: true,
        requiresApproval: true,
      toolName: 'mcp__trusted-tools__lookup',
    });
    const auto = createPiToolPolicy(projectRoot, {
      permissionMode: 'auto',
      trustedMcpServers: ['trusted-tools'],
    });
    await expect(auto.authorize('mcp__trusted-tools__lookup', { query: 'safe' }))
      .resolves.toMatchObject({
        allowed: true,
        requiresApproval: false,
        toolName: 'mcp__trusted-tools__lookup',
      });
    const readOnly = createPiToolPolicy(projectRoot, { permissionMode: 'readOnly' });
    await expect(readOnly.authorize('mcp__trusted-tools__lookup', { query: 'safe' }))
      .rejects.toMatchObject({ code: 'PI_TOOL_NOT_ALLOWED' });
    await expect(ask.authorize('mcp__bad/name__lookup', {}))
      .rejects.toMatchObject({ code: 'PI_TOOL_NOT_ALLOWED' });
  });

  it('fixes bash to project cwd, caps timeouts, and blocks dangerous commands', async () => {
    await expect(authorizePiToolCall('bash', {
      command: 'npm test',
      timeout: 999_999,
    }, { projectRoot, permissionMode: 'ask' })).resolves.toMatchObject({
      requiresApproval: true,
      input: { command: 'npm test', timeout: PI_BASH_MAX_TIMEOUT_MS },
    });
    await expect(authorizePiToolCall('bash', {
      command: 'pwd',
      cwd: outsideRoot,
    }, { projectRoot, permissionMode: 'ask' })).rejects.toMatchObject({ code: 'PI_TOOL_CWD_FIXED' });
    await expect(authorizePiToolCall('bash', {
      command: 'sudo rm -rf /',
    }, { projectRoot, permissionMode: 'ask' })).rejects.toMatchObject({
      code: 'PI_TOOL_COMMAND_BLOCKED',
    });
  });

  it('blocks parent traversal, absolute paths, and symlinks escaping the project', async () => {
    await expect(resolvePiReadOnlyPath(projectRoot, '../outside/secret.txt'))
      .rejects.toMatchObject({ code: 'PI_TOOL_PATH_OUTSIDE_PROJECT' });
    await expect(resolvePiReadOnlyPath(projectRoot, path.join(outsideRoot, 'secret.txt')))
      .rejects.toMatchObject({ code: 'PI_TOOL_PATH_OUTSIDE_PROJECT' });

    const linkPath = path.join(projectRoot, 'outside-link');
    await fs.symlink(outsideRoot, linkPath);
    await expect(resolvePiReadOnlyPath(projectRoot, 'outside-link/secret.txt'))
      .rejects.toMatchObject({ code: 'PI_TOOL_PATH_OUTSIDE_PROJECT' });
    await expect(authorizePiToolCall('write', {
      path: 'outside-link/new.txt',
      content: 'blocked',
    }, { projectRoot, permissionMode: 'ask' }))
      .rejects.toMatchObject({ code: 'PI_TOOL_PATH_OUTSIDE_PROJECT' });
  });
});
