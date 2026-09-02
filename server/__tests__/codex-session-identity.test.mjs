import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { normalizeRuntimeObservations } from '../agent-runtime/observations/index.js';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDatabasePath = process.env.DATABASE_PATH;
const originalMedhelpDataDir = process.env.MEDHELP_DATA_DIR;

const mockCodexState = {
  events: [],
  threadId: undefined,
  startedWith: null,
  resumedWith: null,
  codexOptions: null,
  runInputs: [],
  turnOptions: null,
};
const mockSessionStore = new Map();
const mockReconcileCalls = [];
const SKILL_BUDGET_NOTICE = 'Skill descriptions were shortened to fit the 2% skills context budget. Codex can still see every skill, but some descriptions are shorter. Disable unused skills or plugins to leave more room for the rest.';

vi.mock('../projects.js', () => ({
  encodeProjectPath(projectPath) {
    return `encoded:${projectPath}`;
  },
  async ensureProjectSkillLinks() {},
  async reconcileCodexSessionIndex(projectPath, options = {}) {
    mockReconcileCalls.push({ projectPath, options });
    return [];
  },
}));

vi.mock('../database/db.js', () => ({
  sessionDb: {
    migrateSessionId(oldId, newId) {
      if (!oldId || !newId || oldId === newId) {
        return;
      }
      const value = mockSessionStore.get(oldId);
      if (value) {
        mockSessionStore.set(newId, { ...value, id: newId });
        mockSessionStore.delete(oldId);
      }
    },
    deleteSession(sessionId) {
      mockSessionStore.delete(sessionId);
    },
    getSessionById(sessionId) {
      return mockSessionStore.get(sessionId) || null;
    },
    updateSessionMetadata(sessionId, updater) {
      const existing = mockSessionStore.get(sessionId);
      if (!existing) {
        return null;
      }
      const currentMetadata = existing.metadata && typeof existing.metadata === 'object'
        ? existing.metadata
        : {};
      const nextMetadata = typeof updater === 'function'
        ? updater(currentMetadata)
        : { ...currentMetadata, ...(updater || {}) };
      const nextSession = { ...existing, metadata: nextMetadata };
      mockSessionStore.set(sessionId, nextSession);
      return nextSession;
    },
  },
  credentialsDb: {
    getActiveCredential() {
      return null;
    },
  },
  userDb: {
    getProfile() {
      return null;
    },
  },
  userPreferenceMemoryDb: {
    getMemoryEnabled() {
      return false;
    },
    getEnabled() {
      return [];
    },
  },
}));

vi.mock('../utils/sessionIndex.js', () => ({
  applyStageTagsToSession() {
    return [];
  },
  recordIndexedSession({ sessionId, provider, projectPath, sessionMode = 'research', displayName = null }) {
    if (!sessionId) {
      return;
    }
    const existing = mockSessionStore.get(sessionId) || {};
    mockSessionStore.set(sessionId, {
      ...existing,
      id: sessionId,
      provider,
      projectPath,
      sessionMode,
      displayName,
    });
  },
}));

vi.mock('../codex-app-server.js', () => ({
  async getCodexAppServerClient() {
    return {
      async startThread(options) {
        mockCodexState.startedWith = options;
        mockCodexState.codexOptions = { config: options?.config };
        const startedEvent = mockCodexState.events.find((event) => event.type === 'thread.started');
        mockCodexState.threadId = startedEvent?.id || mockCodexState.threadId;
        return { id: mockCodexState.threadId };
      },
      async resumeThread(sessionId, options) {
        mockCodexState.resumedWith = { sessionId, options };
        mockCodexState.codexOptions = { config: options?.config };
        mockCodexState.threadId = sessionId;
        return { id: sessionId };
      },
      async runTurn({ input, turnOptions }) {
        mockCodexState.runInputs.push(input);
        mockCodexState.turnOptions = turnOptions;
        return {
          turnId: 'turn-1',
          events: createMockEventStream(),
        };
      },
    };
  },
  async shutdownCodexAppServers() {},
}));

function getMockPrompt(index = 0) {
  const input = mockCodexState.runInputs[index];
  if (typeof input === 'string') return input;
  return (input || [])
    .filter((item) => item?.type === 'text')
    .map((item) => item.text || '')
    .join('\n');
}

async function* createMockEventStream() {
  for (const event of mockCodexState.events) {
    if (event.type === 'thread.started' && typeof event.id === 'string') {
      mockCodexState.threadId = event.id;
    }
    yield event;
  }
}

function createWriter() {
  return {
    isWebSocketWriter: true,
    messages: [],
    sessionId: null,
    send(payload) {
      this.messages.push(payload);
    },
    setSessionId(sessionId) {
      this.sessionId = sessionId;
    },
  };
}

let tempRoot = null;

async function loadTestModules() {
  vi.resetModules();
  return {
    codex: await import('../openai-codex.js'),
  };
}

describe('Codex session identity', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'medhelp-codex-session-'));
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;
    process.env.MEDHELP_DATA_DIR = path.join(tempRoot, '.medhelp');
    process.env.DATABASE_PATH = path.join(tempRoot, 'db', 'auth.db');

    mockCodexState.events = [];
    mockCodexState.threadId = undefined;
    mockCodexState.startedWith = null;
    mockCodexState.resumedWith = null;
    mockCodexState.codexOptions = null;
    mockCodexState.runInputs = [];
    mockCodexState.turnOptions = null;
    mockSessionStore.clear();
    mockReconcileCalls.length = 0;
  });

  afterEach(async () => {
    vi.resetModules();

    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;

    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;

    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = originalDatabasePath;

    if (originalMedhelpDataDir === undefined) delete process.env.MEDHELP_DATA_DIR;
    else process.env.MEDHELP_DATA_DIR = originalMedhelpDataDir;

    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('emits and indexes the real Codex thread UUID instead of a generated codex-* placeholder', async () => {
    const actualSessionId = '019d4247-833a-7290-a99f-28c3a1f764a6';
    const projectPath = path.join(tempRoot, 'workspace');
    await mkdir(projectPath, { recursive: true });

    mockCodexState.events = [
      { type: 'thread.started', id: actualSessionId },
      {
        type: 'item.completed',
        item: {
          id: 'assistant-1',
          type: 'agent_message',
          text: 'Real Codex output',
          status: 'completed',
        },
      },
      {
        type: 'turn.completed',
        usage: {
          current_context_usage: {
            total_tokens: 42,
          },
        },
      },
    ];

    const { codex } = await loadTestModules();
    const writer = createWriter();

    await codex.queryCodex('hello', { cwd: projectPath, projectPath }, writer);

    const sessionCreated = writer.messages.find((message) => message.type === 'session-created');
    const codexComplete = writer.messages.find((message) => message.type === 'codex-complete');

    expect(sessionCreated?.sessionId).toBe(actualSessionId);
    expect(sessionCreated?.provider).toBe('codex');
    expect(sessionCreated?.projectName).toBeTruthy();
    expect(writer.sessionId).toBe(actualSessionId);
    expect(codexComplete?.actualSessionId).toBe(actualSessionId);
    expect(
      writer.messages.every((message) => !String(message?.sessionId || '').startsWith('codex-')),
    ).toBe(true);
    expect(mockSessionStore.get(actualSessionId)?.provider).toBe('codex');
    expect(Array.from(mockSessionStore.keys()).some((sessionId) => String(sessionId).startsWith('codex-'))).toBe(false);
    expect(mockReconcileCalls.at(-1)?.options?.sessionId).toBe(actualSessionId);
    expect(mockCodexState.startedWith?.model).toBe('gpt-5.6-sol');
    expect(mockCodexState.codexOptions?.config).not.toHaveProperty('model_auto_compact_token_limit');
    expect(mockCodexState.codexOptions?.config).not.toHaveProperty('model_auto_compact_token_limit_scope');
  });

  it('passes the GPT-5.6 max reasoning effort through to the Codex app-server', async () => {
    const actualSessionId = '019d4247-9999-7290-a99f-28c3a1f764a6';
    const projectPath = path.join(tempRoot, 'workspace');
    await mkdir(projectPath, { recursive: true });

    mockCodexState.events = [
      { type: 'thread.started', id: actualSessionId },
      { type: 'turn.completed', usage: { current_context_usage: { total_tokens: 5 } } },
    ];

    const { codex } = await loadTestModules();
    await codex.queryCodex(
      'reason deeply',
      {
        cwd: projectPath,
        projectPath,
        model: 'gpt-5.6-sol',
        modelReasoningEffort: 'max',
      },
      createWriter(),
    );

    expect(mockCodexState.startedWith?.model).toBe('gpt-5.6-sol');
    expect(mockCodexState.turnOptions?.effort).toBe('max');
  });

  it('registers the selected Kernel compute resource with Codex without exposing credentials', async () => {
    const actualSessionId = '019d4247-compute-7290-a99f-28c3a1f764a6';
    const projectPath = path.join(tempRoot, 'workspace');
    await mkdir(projectPath, { recursive: true });
    await mkdir(path.join(tempRoot, '.openclaw'), { recursive: true });
    await writeFile(path.join(tempRoot, '.openclaw', 'compute-node.json'), JSON.stringify({
      selectionMode: 'remote',
      activeNodeId: 'bigcpu-1',
      nodes: [{
        id: 'bigcpu-1',
        name: 'BigCPU',
        host: 'compute.example',
        user: 'researcher',
        port: 2222,
        workDir: '~/research',
        type: 'direct',
        password: 'must-not-leak',
      }],
    }));
    mockCodexState.events = [
      { type: 'thread.started', id: actualSessionId },
      { type: 'turn.completed', usage: { current_context_usage: { total_tokens: 5 } } },
    ];

    const { codex } = await loadTestModules();
    await codex.queryCodex('check the remote CPU', { cwd: projectPath, projectPath }, createWriter());

    const computeServer = mockCodexState.codexOptions?.config?.mcp_servers?.medhelp_compute;
    expect(computeServer?.args?.[0]).toMatch(/agent-compute-mcp\.js$/);
    expect(computeServer?.env).toMatchObject({
      MEDHELP_COMPUTE_NODE_ID: 'bigcpu-1',
      MEDHELP_COMPUTE_PROJECT_PATH: projectPath,
    });
    expect(JSON.stringify(mockCodexState.codexOptions)).not.toContain('must-not-leak');
    expect(getMockPrompt()).toContain('The user selected the remote compute resource "BigCPU"');
    expect(getMockPrompt()).toContain('list, status, run, and sync');
    expect(getMockPrompt()).toContain('routing work across multiple servers');
    expect(getMockPrompt()).toContain('Do not ask for SSH credentials');
  });

  it('passes an explicit GPT-5.5 selection through to the Codex app-server', async () => {
    const actualSessionId = '019d4247-5555-7290-a99f-28c3a1f764a6';
    const projectPath = path.join(tempRoot, 'workspace');
    await mkdir(projectPath, { recursive: true });

    mockCodexState.events = [
      { type: 'thread.started', id: actualSessionId },
      { type: 'turn.completed', usage: { current_context_usage: { total_tokens: 5 } } },
    ];

    const { codex } = await loadTestModules();
    await codex.queryCodex(
      'use the selected model',
      {
        cwd: projectPath,
        projectPath,
        model: 'gpt-5.5',
      },
      createWriter(),
    );

    expect(mockCodexState.startedWith?.model).toBe('gpt-5.5');
  });

  it('treats stale codex-* placeholders as non-resumable and starts a new thread instead', async () => {
    const actualSessionId = '019d4256-0b34-7ec3-a29e-3450722fb154';
    const projectPath = path.join(tempRoot, 'workspace');
    await mkdir(projectPath, { recursive: true });

    mockCodexState.events = [
      { type: 'thread.started', id: actualSessionId },
      {
        type: 'turn.completed',
        usage: {
          current_context_usage: {
            total_tokens: 5,
          },
        },
      },
    ];

    const { codex } = await loadTestModules();
    const writer = createWriter();

    await codex.queryCodex(
      'resume this',
      {
        sessionId: 'codex-1774933475975',
        cwd: projectPath,
        projectPath,
      },
      writer,
    );

    expect(mockCodexState.resumedWith).toBeNull();
    expect(mockCodexState.startedWith?.cwd).toBe(projectPath);
    expect(writer.messages.find((message) => message.type === 'session-created')?.sessionId).toBe(actualSessionId);
  });

  it('uses a client temporary id only until Codex returns the real resumable thread id', async () => {
    const temporarySessionId = 'new-session-1774933475000';
    const actualSessionId = '019d4256-9999-7ec3-a29e-3450722fb154';
    const projectPath = path.join(tempRoot, 'workspace');
    await mkdir(projectPath, { recursive: true });

    mockCodexState.events = [
      {
        type: 'turn.started',
      },
      {
        type: 'thread.started',
        id: actualSessionId,
      },
      {
        type: 'item.completed',
        item: {
          id: 'assistant-1',
          type: 'agent_message',
          text: 'Continued in the same Codex thread',
          status: 'completed',
        },
      },
      {
        type: 'turn.completed',
        usage: {
          current_context_usage: {
            total_tokens: 77,
          },
        },
      },
    ];

    const { codex } = await loadTestModules();
    const writer = createWriter();

    await codex.queryCodex(
      'start with client placeholder',
      {
        clientSessionId: temporarySessionId,
        cwd: projectPath,
        projectPath,
      },
      writer,
    );

    expect(mockCodexState.resumedWith).toBeNull();
    expect(mockCodexState.startedWith?.cwd).toBe(projectPath);

    const sessionCreated = writer.messages.find((message) => message.type === 'session-created');
    const codexResponses = writer.messages.filter((message) => message.type === 'codex-response');
    const codexComplete = writer.messages.find((message) => message.type === 'codex-complete');

    expect(codexResponses[0]?.sessionId).toBe(actualSessionId);
    expect(sessionCreated?.sessionId).toBe(actualSessionId);
    expect(sessionCreated?.previousSessionId).toBe(temporarySessionId);
    expect(codexResponses.at(-1)?.sessionId).toBe(actualSessionId);
    expect(writer.sessionId).toBe(actualSessionId);
    expect(codexComplete?.actualSessionId).toBe(actualSessionId);
  });

  it('suppresses Codex skill-budget notices instead of rendering them as errors', async () => {
    const actualSessionId = '019d4257-1111-7ec3-a29e-3450722fb154';
    const projectPath = path.join(tempRoot, 'workspace');
    await mkdir(projectPath, { recursive: true });

    mockCodexState.events = [
      { type: 'thread.started', id: actualSessionId },
      { type: 'error', message: SKILL_BUDGET_NOTICE },
      { type: 'turn.completed', usage: { current_context_usage: { total_tokens: 9 } } },
    ];

    const { codex } = await loadTestModules();
    const writer = createWriter();

    await codex.queryCodex('hello', { cwd: projectPath, projectPath }, writer);

    expect(writer.messages.some((message) => message.type === 'codex-error')).toBe(false);
    expect(writer.messages.find((message) => message.type === 'codex-complete')?.actualSessionId).toBe(actualSessionId);
  });

  it('injects project instructions and skills on new threads but not resumed turns', async () => {
    const actualSessionId = '019d4257-7777-7ec3-a29e-3450722fb154';
    const projectPath = path.join(tempRoot, 'workspace');
    await mkdir(projectPath, { recursive: true });

    mockCodexState.events = [
      { type: 'thread.started', id: actualSessionId },
      { type: 'turn.completed', usage: { current_context_usage: { total_tokens: 11 } } },
    ];

    const { codex } = await loadTestModules();
    await codex.queryCodex('first task', { cwd: projectPath, projectPath }, createWriter());

    expect(mockSessionStore.get(actualSessionId)?.metadata?.codexSkillTurnCount).toBe(1);
    expect(mockCodexState.codexOptions?.config).toMatchObject({
      sandbox_permissions: ['disk-full-read-access'],
    });
    expect(mockCodexState.startedWith).toMatchObject({ sandbox: 'danger-full-access' });
    expect(mockCodexState.startedWith).not.toHaveProperty('permissions');
    expect(mockCodexState.startedWith?.config).not.toHaveProperty('permissions');
    expect(mockCodexState.turnOptions).not.toHaveProperty('permissions');
    expect(mockCodexState.runInputs).toHaveLength(1);
    expect(getMockPrompt(0)).toContain('# MedHelp Skills');
    expect(getMockPrompt(0)).toContain('# Project Instructions (AGENTS.md)');
    expect(getMockPrompt(0)).toContain('first task');

    mockCodexState.events = [
      { type: 'turn.completed', usage: { current_context_usage: { total_tokens: 7 } } },
    ];

    await codex.queryCodex(
      'follow up',
      {
        sessionId: actualSessionId,
        cwd: projectPath,
        projectPath,
      },
      createWriter(),
    );

    expect(mockCodexState.resumedWith?.sessionId).toBe(actualSessionId);
    expect(mockCodexState.resumedWith?.options).toMatchObject({ sandbox: 'danger-full-access' });
    expect(mockCodexState.resumedWith?.options).not.toHaveProperty('permissions');
    expect(mockCodexState.resumedWith?.options?.config).not.toHaveProperty('permissions');
    expect(mockCodexState.turnOptions).not.toHaveProperty('permissions');
    expect(mockCodexState.runInputs).toHaveLength(2);
    const resumedPrompt = getMockPrompt(1);
    expect(resumedPrompt).not.toContain('# MedHelp data folders');
    expect(resumedPrompt.endsWith('follow up')).toBe(true);
    expect(resumedPrompt).not.toContain('# MedHelp Skills');
    expect(resumedPrompt).not.toContain('# Project Instructions (AGENTS.md)');
  });

  it('injects a compact skills reminder on every fourth Codex turn', async () => {
    const actualSessionId = '019d4258-8888-7ec3-a29e-3450722fb154';
    const projectPath = path.join(tempRoot, 'workspace');
    await mkdir(projectPath, { recursive: true });
    const userSkillDir = path.join(tempRoot, '.medhelp', 'users', '7', 'skills', 'custom-skill');
    await mkdir(userSkillDir, { recursive: true });
    await writeFile(path.join(userSkillDir, 'SKILL.md'), '# Custom Skill\n', 'utf8');
    mockSessionStore.set(actualSessionId, {
      id: actualSessionId,
      provider: 'codex',
      projectPath,
      metadata: { codexSkillTurnCount: 3 },
    });

    mockCodexState.events = [
      { type: 'turn.completed', usage: { current_context_usage: { total_tokens: 7 } } },
    ];

    const { codex } = await loadTestModules();
    await codex.queryCodex(
      'fourth turn',
      {
        sessionId: actualSessionId,
        cwd: projectPath,
        projectPath,
        userId: 7,
      },
      createWriter(),
    );

    expect(mockSessionStore.get(actualSessionId)?.metadata?.codexSkillTurnCount).toBe(4);
    expect(mockCodexState.codexOptions?.config).toMatchObject({
      sandbox_permissions: ['disk-full-read-access'],
    });
    expect(mockCodexState.runInputs).toHaveLength(1);
    expect(getMockPrompt(0)).toContain('# MedHelp Skills Reminder');
    expect(getMockPrompt(0)).toContain("Codex's installation directory");
    expect(getMockPrompt(0)).toContain('fourth turn');
    expect(getMockPrompt(0)).not.toContain('# Project Instructions (AGENTS.md)');
  });

  it('reports turn start, first visible text, and completion lifecycle phases', async () => {
    const actualSessionId = '019d4259-9999-7ec3-a29e-3450722fb154';
    const projectPath = path.join(tempRoot, 'workspace');
    await mkdir(projectPath, { recursive: true });
    mockCodexState.events = [
      { type: 'thread.started', id: actualSessionId },
      { type: 'turn.started' },
      {
        type: 'item.updated',
        item: { id: 'assistant-metric', type: 'agent_message', text: 'First' },
      },
      {
        type: 'item.completed',
        item: { id: 'assistant-metric', type: 'agent_message', text: 'First response' },
      },
      {
        type: 'turn.completed',
        status: 'completed',
        usage: { current_context_usage: { total_tokens: 321 } },
      },
    ];
    const lifecycleEvents = [];

    const { codex } = await loadTestModules();
    await codex.queryCodex('measure this turn', {
      cwd: projectPath,
      projectPath,
      onLifecycleEvent: (event) => lifecycleEvents.push(event),
    }, createWriter());

    expect(lifecycleEvents.map((event) => event.phase)).toEqual([
      'preprocessing_completed',
      'turn_started',
      'first_text',
      'completed',
    ]);
    expect(lifecycleEvents.at(-1)).toMatchObject({
      sessionId: actualSessionId,
      outcome: 'completed',
      contextTokens: 321,
    });
  });

  it('fails an unsupported Codex plan permission request closed as read-only', async () => {
    const actualSessionId = '019d4259-aaaa-7ec3-a29e-3450722fb154';
    const projectPath = path.join(tempRoot, 'workspace');
    await mkdir(projectPath, { recursive: true });
    mockCodexState.events = [
      { type: 'thread.started', id: actualSessionId },
      { type: 'turn.completed', status: 'completed', usage: {} },
    ];

    const { codex } = await loadTestModules();
    await codex.queryCodex('plan without modifying files', {
      cwd: projectPath,
      projectPath,
      permissionMode: 'plan',
    }, createWriter());

    expect(mockCodexState.startedWith).toMatchObject({
      sandbox: 'read-only',
      approvalPolicy: 'never',
    });
  });

  it('forwards Codex plan updates into todo snapshot observations', async () => {
    const actualSessionId = '019d4259-bbbb-7ec3-a29e-3450722fb154';
    const projectPath = path.join(tempRoot, 'workspace');
    await mkdir(projectPath, { recursive: true });
    mockCodexState.events = [
      { type: 'thread.started', id: actualSessionId },
      {
        type: 'item.updated',
        item: {
          id: 'plan:turn-1',
          type: 'todo_list',
          items: [
            { text: 'Inspect the cohort', status: 'completed', completed: true },
            { text: 'Run the model', status: 'in_progress', completed: false },
          ],
        },
      },
      { type: 'turn.completed', status: 'completed', usage: {} },
    ];
    const writer = createWriter();

    const { codex } = await loadTestModules();
    await codex.queryCodex('follow the plan', {
      cwd: projectPath,
      projectPath,
    }, writer);

    const todoPayload = writer.messages.find((message) => message.data?.itemType === 'todo_list');
    expect(todoPayload).toMatchObject({
      type: 'codex-response',
      data: { lifecycle: 'updated' },
    });
    expect(normalizeRuntimeObservations(todoPayload)).toMatchObject([{
      type: 'todo_snapshot',
      provider: 'codex',
      todos: [
        { title: 'Inspect the cohort', status: 'completed' },
        { title: 'Run the model', status: 'in_progress' },
      ],
    }]);
  });
});
