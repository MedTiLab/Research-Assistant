import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const mockClaudeState = {
  input: null,
  initialPrompt: null,
  waitForSteer: false,
  throwAfterResponse: false,
  steeredPrompt: null,
  steeredPrompts: [],
};

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query(input) {
    mockClaudeState.input = input;
    return {
      async *[Symbol.asyncIterator]() {
        const initialMessage = await input.prompt.next();
        mockClaudeState.initialPrompt = initialMessage.value?.message?.content || null;
        yield {
          type: 'assistant',
          session_id: 'claude-compute-test-session',
          message: { content: [{ type: 'text', text: 'Compute resource ready.' }] },
        };
        if (mockClaudeState.throwAfterResponse) {
          throw new Error('simulated SDK transport failure');
        }
        if (mockClaudeState.waitForSteer) {
          const steeredMessage = await input.prompt.next();
          mockClaudeState.steeredPrompt = steeredMessage.value?.message?.content || null;
          mockClaudeState.steeredPrompts.push(mockClaudeState.steeredPrompt);
          yield {
            type: 'assistant',
            session_id: 'claude-compute-test-session',
            message: { content: [{ type: 'text', text: 'Adjusted to the new requirement.' }] },
          };
        }
        yield { type: 'result', session_id: 'claude-compute-test-session' };
      },
      async interrupt() {},
    };
  },
}));

vi.mock('../utils/claudeCodeExecutable.js', () => ({
  resolveClaudeCodeExecutableInfo() {
    return { executable: process.execPath, source: 'test' };
  },
}));

vi.mock('../utils/claudeSkillPlugin.js', () => ({
  async ensureClaudeSkillPlugin() {
    return null;
  },
}));

let tempRoot;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'medhelp-claude-compute-'));
  process.env.HOME = tempRoot;
  process.env.USERPROFILE = tempRoot;
  mockClaudeState.input = null;
  mockClaudeState.initialPrompt = null;
  mockClaudeState.waitForSteer = false;
  mockClaudeState.throwAfterResponse = false;
  mockClaudeState.steeredPrompt = null;
  mockClaudeState.steeredPrompts = [];
  await mkdir(path.join(tempRoot, '.openclaw'), { recursive: true });
  await writeFile(path.join(tempRoot, '.openclaw', 'compute-node.json'), JSON.stringify({
    selectionMode: 'remote',
    activeNodeId: 'bigcpu-1',
    nodes: [{
      id: 'bigcpu-1',
      name: 'BigCPU',
      host: 'compute.example',
      user: 'researcher',
      workDir: '~/research',
      password: 'must-not-leak',
    }],
  }));
  vi.resetModules();
});

afterEach(async () => {
  vi.resetModules();
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalUserProfile;
  await rm(tempRoot, { recursive: true, force: true });
});

describe('Claude compute resource integration', () => {
  it('adds the Kernel compute MCP server and sanitized node context to Claude', async () => {
    const { queryClaudeSDK } = await import('../claude-sdk.js');
    const writer = {
      messages: [],
      send(message) { this.messages.push(message); },
      setSessionId() {},
    };
    const lifecycleEvents = [];

    await queryClaudeSDK('check the remote CPU', {
      projectPath: tempRoot,
      cwd: tempRoot,
      initializeProject: false,
      indexSession: false,
      permissionMode: 'bypassPermissions',
      onLifecycleEvent: (event) => lifecycleEvents.push(event),
    }, writer);

    const computeServer = mockClaudeState.input?.options?.mcpServers?.medhelp_compute;
    expect(computeServer?.args?.[0]).toMatch(/agent-compute-mcp\.js$/);
    expect(computeServer?.env).toMatchObject({
      MEDHELP_COMPUTE_NODE_ID: 'bigcpu-1',
      MEDHELP_COMPUTE_PROJECT_PATH: tempRoot,
    });
    expect(mockClaudeState.initialPrompt).toContain('The user selected the remote compute resource "BigCPU"');
    expect(mockClaudeState.initialPrompt).toContain('list, status, run, and sync');
    expect(mockClaudeState.initialPrompt).toContain('routing work across multiple servers');
    expect(mockClaudeState.initialPrompt).toContain('Do not ask for SSH credentials');
    expect(JSON.stringify(mockClaudeState.input)).not.toContain('must-not-leak');
    expect(writer.messages.some((message) => message.type === 'claude-complete')).toBe(true);
    expect(lifecycleEvents.map((event) => event.phase)).toEqual([
      'preprocessing_completed',
      'turn_started',
      'first_text',
      'completed',
    ]);
    expect(lifecycleEvents.at(-1)).toMatchObject({
      sessionId: 'claude-compute-test-session',
      outcome: 'completed',
    });
  });

  it('pushes a priority-now message through the open Claude input stream', async () => {
    mockClaudeState.waitForSteer = true;
    const { queryClaudeSDK, steerClaudeSDKSession } = await import('../claude-sdk.js');
    const writer = {
      messages: [],
      send(message) { this.messages.push(message); },
      setSessionId() {},
    };

    const runningQuery = queryClaudeSDK('start the analysis', {
      clientSessionId: 'new-session-steer-test',
      sessionKey: 'owner-a/project-a/claude/new-session-steer-test',
      projectPath: tempRoot,
      cwd: tempRoot,
      initializeProject: false,
      indexSession: false,
      permissionMode: 'bypassPermissions',
    }, writer);

    for (let attempt = 0; attempt < 50 && !writer.messages.some((message) => message.type === 'claude-response'); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const result = await steerClaudeSDKSession(
      'owner-a/project-a/claude/new-session-steer-test',
      'Use the newly uploaded cohort definition immediately.',
    );
    await runningQuery;

    expect(result).toMatchObject({ success: true });
    expect(mockClaudeState.steeredPrompt).toBe('Use the newly uploaded cohort definition immediately.');
  });

  it('isolates matching provider session ids by composite runtime handle', async () => {
    mockClaudeState.waitForSteer = true;
    const { queryClaudeSDK, steerClaudeSDKSession } = await import('../claude-sdk.js');
    const createWriter = () => ({
      messages: [],
      send(message) { this.messages.push(message); },
      setSessionId() {},
    });
    const firstWriter = createWriter();
    const secondWriter = createWriter();
    const firstKey = '["owner-a","project-a","claude","new-session-a"]';
    const secondKey = '["owner-a","project-b","claude","new-session-b"]';

    const firstQuery = queryClaudeSDK('first analysis', {
      clientSessionId: 'new-session-a',
      sessionKey: firstKey,
      projectPath: tempRoot,
      cwd: tempRoot,
      initializeProject: false,
      indexSession: false,
      permissionMode: 'bypassPermissions',
    }, firstWriter);
    const secondQuery = queryClaudeSDK('second analysis', {
      clientSessionId: 'new-session-b',
      sessionKey: secondKey,
      projectPath: tempRoot,
      cwd: tempRoot,
      initializeProject: false,
      indexSession: false,
      permissionMode: 'bypassPermissions',
    }, secondWriter);

    await vi.waitFor(() => {
      expect(firstWriter.messages.some((message) => message.type === 'claude-response')).toBe(true);
      expect(secondWriter.messages.some((message) => message.type === 'claude-response')).toBe(true);
    });
    await expect(steerClaudeSDKSession(
      'claude-compute-test-session',
      'ambiguous raw id',
    )).resolves.toMatchObject({ success: false, error: 'SESSION_NOT_ACTIVE' });
    await expect(steerClaudeSDKSession(firstKey, 'first exact adjustment')).resolves.toMatchObject({ success: true });
    await expect(steerClaudeSDKSession(secondKey, 'second exact adjustment')).resolves.toMatchObject({ success: true });
    await Promise.all([firstQuery, secondQuery]);

    expect(mockClaudeState.steeredPrompts).toEqual(expect.arrayContaining([
      'first exact adjustment',
      'second exact adjustment',
    ]));
  });

  it('removes the composite runtime handle after a completed turn', async () => {
    const {
      getActiveClaudeSDKSessions,
      isClaudeSDKSessionActive,
      queryClaudeSDK,
    } = await import('../claude-sdk.js');
    const sessionKey = '["owner-a","project-a","claude","new-session-cleanup"]';
    const writer = {
      messages: [],
      send(message) { this.messages.push(message); },
      setSessionId() {},
    };

    await queryClaudeSDK('finish normally', {
      clientSessionId: 'new-session-cleanup',
      sessionKey,
      projectPath: tempRoot,
      cwd: tempRoot,
      initializeProject: false,
      indexSession: false,
      permissionMode: 'bypassPermissions',
    }, writer);

    expect(isClaudeSDKSessionActive(sessionKey)).toBeFalsy();
    expect(getActiveClaudeSDKSessions()).not.toContain(sessionKey);
  });

  it('removes the composite runtime handle after an SDK failure', async () => {
    mockClaudeState.throwAfterResponse = true;
    const {
      getActiveClaudeSDKSessions,
      isClaudeSDKSessionActive,
      queryClaudeSDK,
    } = await import('../claude-sdk.js');
    const sessionKey = '["owner-a","project-a","claude","new-session-error-cleanup"]';
    const writer = {
      messages: [],
      send(message) { this.messages.push(message); },
      setSessionId() {},
    };

    await expect(queryClaudeSDK('fail after starting', {
      clientSessionId: 'new-session-error-cleanup',
      sessionKey,
      projectPath: tempRoot,
      cwd: tempRoot,
      initializeProject: false,
      indexSession: false,
      permissionMode: 'bypassPermissions',
    }, writer)).rejects.toThrow('simulated SDK transport failure');

    expect(isClaudeSDKSessionActive(sessionKey)).toBeFalsy();
    expect(getActiveClaudeSDKSessions()).not.toContain(sessionKey);
  });
});
