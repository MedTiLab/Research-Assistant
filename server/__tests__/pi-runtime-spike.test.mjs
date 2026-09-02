import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildPiResourceProjection,
  createPiRuntime,
  normalizePiReasoningLevel,
  pickPiAgentEnvironment,
} from '../agent-runtime/pi-runtime.js';
import { assertAgentRuntime, hasAgentRuntime, piRuntime } from '../agent-runtime/index.js';
import { createAgentSessionKey } from '../utils/agentSessionIdentity.js';
import { mapPiHostEventToObservations } from '../pi-runtime/event-mapper.js';
import { DEFAULT_FAUX_HOST_PATH, createPiHostManager } from '../pi-runtime/host-manager.js';
import { createPiHostSessionStore } from '../pi-runtime/session-store.js';
import { resolvePiToolAuditPath } from '../pi-runtime/tool-audit.js';
import { createPiPermissionBridge } from '../pi-runtime/permission-bridge.js';

let testRoot;
let projectRoot;
let hostManager;

function identity(sessionId = 'new-session-client') {
  return {
    ownerKey: 'owner-a',
    projectKey: 'project-a',
    runtimeId: 'pi',
    sessionId,
  };
}

function createRuntime() {
  hostManager = createPiHostManager({
    hostPath: DEFAULT_FAUX_HOST_PATH,
    configRoot: path.join(testRoot, 'config'),
    startTimeoutMs: 500,
    requestTimeoutMs: 2_000,
    abortTimeoutMs: 100,
    terminateTimeoutMs: 100,
  });
  return createPiRuntime({ hostManager });
}

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-pi-runtime-'));
  projectRoot = path.join(testRoot, 'project');
  await fs.mkdir(projectRoot);
});

afterEach(async () => {
  await hostManager?.shutdown();
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('Pi Runtime read-only adapter', () => {
  it('satisfies the runtime contract and advertises trusted Phase 5 resources', () => {
    expect(assertAgentRuntime(piRuntime)).toBe(piRuntime);
    expect(piRuntime.capabilities).toMatchObject({
      provider: 'pi',
      sessionResume: true,
      steering: true,
      nativeSkills: true,
      mcp: true,
      interactiveToolApproval: true,
      planMode: true,
      persistentAppServer: false,
    });
    expect(piRuntime.native).toMatchObject({ hostProtocolVersion: 1, provider: 'openai-compatible' });
    expect(hasAgentRuntime('pi')).toBe(true);
  });

  it('places the built-in remote-compute MCP bridge in the trusted Pi projection', () => {
    const projection = buildPiResourceProjection({
      skillProjection: { skills: [], diagnostics: [] },
      mcpProjection: {
        servers: [{ name: 'installed', version: '1.0.0', server: {} }],
        diagnostics: [],
        secretValues: [],
      },
      computeBridge: {
        prompt: '<medhelp_compute_context>remote</medhelp_compute_context>',
        mcpServer: { command: process.execPath, args: ['compute.mjs'], env: { NODE_ID: 'gpu-a' } },
      },
    });

    expect(projection.mcpServers[0]).toMatchObject({
      name: 'medhelp_compute',
      version: 'builtin',
      server: { type: 'stdio', command: process.execPath },
    });
    expect(projection.mcpServers[1]).toMatchObject({ name: 'installed' });
    expect(projection.computeContext).toContain('medhelp_compute_context');
  });

  it('passes Pi reasoning effort and compute context into the host turn', async () => {
    class CapturingHostManager {
      isFauxHost() { return true; }
      isActive() { return false; }
      getActiveSessions() { return []; }
      getStartTime() { return null; }
      async diagnostics() { return { available: true }; }
      async shutdown() {}
      async steer() { return false; }
      async abort() { return false; }
      async runTurn(context) {
        this.context = context;
        context.onEvent({ event: 'session_started', sessionId: context.identity.sessionId, data: {} });
        context.onEvent({ event: 'turn_completed', sessionId: context.identity.sessionId, data: {} });
        return { sessionId: context.identity.sessionId, status: 'completed' };
      }
    }

    hostManager = new CapturingHostManager();
    const runtime = createPiRuntime({
      hostManager,
      resourceResolver: async () => ({
        skills: [],
        mcpServers: [{
          name: 'medhelp_compute',
          version: 'builtin',
          server: { type: 'stdio', command: process.execPath, args: ['compute.mjs'], env: {} },
        }],
        computeContext: '<medhelp_compute_context>remote tools</medhelp_compute_context>',
        diagnostics: { skills: [], mcp: [] },
        secretValues: [],
      }),
    });

    const dataRoot = path.join(testRoot, 'data');
    await fs.mkdir(dataRoot);
    await fs.writeFile(path.join(testRoot, 'project-config.json'), JSON.stringify({ _allowedDataFolders: [dataRoot] }));
    await runtime.start('run remotely', {
      identity: identity('session-compute-reasoning'),
      projectPath: projectRoot,
      storageOptions: { dataDir: testRoot },
      turnSnapshot: {
        modelProviderId: 'faux',
        modelId: 'pi-faux-v1',
        permissionMode: 'auto',
        reasoningLevel: 'high',
      },
      attachments: [{
        name: 'figure.png',
        kind: 'image',
        mimeType: 'image/png',
        path: path.join(projectRoot, 'figure.png'),
      }],
      env: {
        MEDHELP_MANAGED_AGENT_SESSION: '1',
        MEDHELP_DATABASE_API_CONNECTION_STATUS: 'connected',
        MEDHELP_DATABASE_API_URL: 'https://api.medtimehelp.com',
        MEDHELP_DATABASE_API_TOKEN: 'database-secret',
        DATABASE_API_TOKEN: 'legacy-database-secret',
        UNRELATED_SECRET: 'must-not-reach-pi',
        MEDHELP_ALLOWED_DATA_FOLDERS: '["/cloud-path-must-not-be-trusted"]',
      },
    });

    expect(hostManager.context.reasoningLevel).toBe('high');
    const canonicalDataRoot = await fs.realpath(dataRoot);
    expect(hostManager.context.params).not.toHaveProperty('readOnlyDataRoots');
    expect(hostManager.context.params.projectContextPrompt).not.toContain(canonicalDataRoot);
    expect(JSON.parse(hostManager.context.secretEnv.MEDHELP_ALLOWED_DATA_FOLDERS)).toEqual([canonicalDataRoot]);
    expect(hostManager.context.prompt).toContain('<medhelp_compute_context>');
    expect(hostManager.context.prompt).toContain('run remotely');
    expect(hostManager.context.params.projectContextPrompt).toContain('Browser tab in the right sidebar');
    expect(hostManager.context.params.projectContextPrompt).toContain('tool_search (query: browser)');
    expect(hostManager.context.params.projectContextPrompt).toContain('no shared login');
    expect(hostManager.context.resourceProjection.mcpServers[0].name).toBe('medhelp_compute');
    expect(hostManager.context.attachments).toEqual([expect.objectContaining({
      name: 'figure.png',
      kind: 'image',
      mimeType: 'image/png',
    })]);
    expect(hostManager.context.secretEnv).toMatchObject({
      MEDHELP_MANAGED_AGENT_SESSION: '1',
      MEDHELP_DATABASE_API_CONNECTION_STATUS: 'connected',
      MEDHELP_DATABASE_API_URL: 'https://api.medtimehelp.com',
      MEDHELP_DATABASE_API_TOKEN: 'database-secret',
      DATABASE_API_TOKEN: 'legacy-database-secret',
    });
    expect(hostManager.context.secretEnv).not.toHaveProperty('UNRELATED_SECRET');
  });

  it('normalizes Pi SDK reasoning aliases and rejects unknown levels safely', () => {
    expect(normalizePiReasoningLevel('minimal')).toBe('minimal');
    expect(normalizePiReasoningLevel('max')).toBe('xhigh');
    expect(normalizePiReasoningLevel('none')).toBe('off');
    expect(normalizePiReasoningLevel('unexpected')).toBe('off');
  });

  it('projects only the managed database connector environment into Pi', () => {
    expect(pickPiAgentEnvironment({
      MEDHELP_MANAGED_AGENT_SESSION: '1',
      MEDHELP_DATABASE_API_CONNECTION_STATUS: 'connected',
      MEDHELP_DATABASE_API_ACCESSIBLE_SOURCE_COUNT: '29',
      MEDHELP_ALLOWED_DATA_FOLDERS: '["/trusted/data"]',
      MEDHELP_DATABASE_API_TOKEN: 'database-secret',
      PATH: '/usr/bin',
      OPENAI_API_KEY: 'must-not-leak',
    })).toEqual({
      MEDHELP_MANAGED_AGENT_SESSION: '1',
      MEDHELP_DATABASE_API_CONNECTION_STATUS: 'connected',
      MEDHELP_DATABASE_API_ACCESSIBLE_SOURCE_COUNT: '29',
      MEDHELP_ALLOWED_DATA_FOLDERS: '["/trusted/data"]',
      MEDHELP_DATABASE_API_TOKEN: 'database-secret',
    });
  });

  it('runs prompt and resume through the host and emits compatible realtime events', async () => {
    const runtime = createRuntime();
    const originalIdentity = identity();
    const sessionKey = createAgentSessionKey(originalIdentity);
    const writer = { send: vi.fn() };
    const lifecycle = [];
    const result = await runtime.start('hello', {
      identity: originalIdentity,
      sessionKey,
      turnId: 'turn-a',
      projectPath: projectRoot,
      storageOptions: { dataDir: testRoot },
      turnSnapshot: { modelProviderId: 'faux', modelId: 'pi-faux-v1' },
      onLifecycleEvent: (event) => lifecycle.push(event),
    }, writer);

    expect(result.sessionId).not.toBe(originalIdentity.sessionId);
    expect(writer.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'session-created',
      provider: 'pi',
      sessionId: result.sessionId,
      projectName: originalIdentity.projectKey,
      projectKey: originalIdentity.projectKey,
    }));
    expect(lifecycle.map((event) => event.phase)).toEqual(['turn_started', 'completed']);

    const resolvedIdentity = identity(result.sessionId);
    const store = createPiHostSessionStore({ dataDir: testRoot });
    await expect(store.read(resolvedIdentity)).resolves.toMatchObject({
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'Faux Pi: hello' },
      ],
    });
    await expect(runtime.resume('again', {
      identity: resolvedIdentity,
      sessionKey: createAgentSessionKey(resolvedIdentity),
      turnId: 'turn-b',
      projectPath: projectRoot,
      storageOptions: { dataDir: testRoot },
    }, writer)).resolves.toMatchObject({ sessionId: result.sessionId });
  });

  it('does not cut off an interactive Pi turn at the RPC control timeout', async () => {
    hostManager = createPiHostManager({
      hostPath: DEFAULT_FAUX_HOST_PATH,
      configRoot: path.join(testRoot, 'config-no-turn-timeout'),
      startTimeoutMs: 500,
      requestTimeoutMs: 30,
      abortTimeoutMs: 100,
      terminateTimeoutMs: 100,
    });
    const runtime = createPiRuntime({ hostManager });
    const session = identity('session-long-turn');

    await expect(runtime.start('finish the whole answer', {
      identity: session,
      sessionKey: createAgentSessionKey(session),
      turnId: 'turn-longer-than-control-timeout',
      projectPath: projectRoot,
      storageOptions: { dataDir: testRoot },
      turnSnapshot: { modelProviderId: 'faux', modelId: 'pi-faux-v1' },
      piHostDelayMs: 100,
    })).resolves.toMatchObject({ status: 'completed' });
  });

  it.each(['interaction_resolved', 'permission_resolved', 'turn_completed'])(
    'does not register a stale approval after %s arrives during authorization/audit I/O', async (terminalEvent) => {
      createRuntime();
      const bridge = createPiPermissionBridge();
      const runtime = createPiRuntime({ hostManager, permissionBridge: bridge });
      const writer = { send: vi.fn() };
      vi.spyOn(hostManager, 'resolveToolApproval').mockResolvedValue(false);
      vi.spyOn(hostManager, 'runTurn').mockImplementation(async (context) => {
        const data = { approvalId: 'expired', toolCallId: 'question', toolName: 'ask_user', input: { questions: [] } };
        context.onEvent({ event: 'interaction_requested', sessionId: context.identity.sessionId, data });
        context.onEvent({ event: terminalEvent, sessionId: context.identity.sessionId, data: { ...data, allow: false, reason: 'timeout' } });
        return { sessionId: context.identity.sessionId, status: 'completed' };
      });
      await runtime.start('ask', {
        identity: identity('session-race'), projectPath: projectRoot, storageOptions: { dataDir: testRoot },
      }, writer);
      expect(bridge.size()).toBe(0);
      expect(writer.send.mock.calls.some(([event]) => event.type === 'agent-permission-request')).toBe(false);
      expect(hostManager.resolveToolApproval).toHaveBeenCalledWith(expect.any(String), 'expired', expect.objectContaining({
        allow: false, reason: terminalEvent === 'turn_completed' ? 'turn_completed' : 'timeout',
      }));
    },
  );

  it('settles the renderer question when the Host expires it while the turn remains active', async () => {
    createRuntime();
    const bridge = createPiPermissionBridge();
    const runtime = createPiRuntime({ hostManager, permissionBridge: bridge });
    const writer = { send: vi.fn() };
    vi.spyOn(hostManager, 'resolveToolApproval').mockResolvedValue(false);
    vi.spyOn(hostManager, 'runTurn').mockImplementation(async (context) => {
      const data = { approvalId: 'expired', toolCallId: 'question', toolName: 'ask_user', input: { questions: [] } };
      context.onEvent({ event: 'interaction_requested', sessionId: context.identity.sessionId, data });
      await vi.waitFor(() => expect(bridge.size()).toBe(1));
      context.onEvent({ event: 'interaction_resolved', sessionId: context.identity.sessionId, data: { ...data, allow: false, reason: 'timeout' } });
      expect(bridge.size()).toBe(0);
      expect(writer.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'agent-permission-cancelled', reason: 'timeout' }));
      return { sessionId: context.identity.sessionId, status: 'completed' };
    });
    await runtime.start('ask', {
      identity: identity('session-active-question'), projectPath: projectRoot, storageOptions: { dataDir: testRoot },
    }, writer);
    expect(writer.send.mock.calls.filter(([event]) => event.type === 'agent-permission-cancelled')).toHaveLength(1);
  });

  it('uses exact composite runtime handles for state, steering, and abort', async () => {
    const runtime = createRuntime();
    const session = identity('session-active');
    const sessionKey = createAgentSessionKey(session);
    const pending = runtime.start('wait', {
      identity: session,
      sessionKey,
      turnId: 'turn-active',
      projectPath: projectRoot,
      storageOptions: { dataDir: testRoot },
      // Keep the faux turn alive even when the full suite temporarily saturates the host.
      piHostDelayMs: 10_000,
    });
    await vi.waitFor(() => expect(runtime.isActive(sessionKey)).toBe(true));
    expect(runtime.getActiveSessions()).toEqual([sessionKey]);
    expect(runtime.getStartTime(sessionKey)).toEqual(expect.any(Number));
    await vi.waitFor(async () => {
      await expect(runtime.native.getState(sessionKey)).resolves.toMatchObject({ state: 'running' });
    });
    await expect(runtime.steer(sessionKey, 'redirect')).resolves.toBe(true);
    await expect(runtime.abort(sessionKey)).resolves.toBe(true);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError', code: 'PI_TURN_ABORTED' });
  });

  it('rejects managed-free selection without a server-resolved catalog snapshot', async () => {
    const runtime = createRuntime();
    const session = identity('session-model');
    await expect(runtime.start('hello', {
      identity: session,
      sessionKey: createAgentSessionKey(session),
      projectPath: projectRoot,
      turnSnapshot: { modelProviderId: 'managed-free', modelId: 'unknown' },
    })).rejects.toMatchObject({ code: 'PI_MANAGED_FREE_CONFIG_REQUIRED' });
    expect(runtime.getActiveSessions()).toEqual([]);
  });

  it('pauses Ask-mode writes on the permission bridge and audits the decision', async () => {
    class ApprovalHostManager {
      constructor() {
        this.active = false;
        this.context = null;
        this.complete = null;
        this.approval = null;
      }

      isFauxHost() { return true; }
      isActive() { return this.active; }
      getActiveSessions() { return this.active ? ['approval-session-key'] : []; }
      getStartTime() { return this.active ? Date.now() : null; }
      async getState() { return { state: this.active ? 'running' : 'idle' }; }
      async diagnostics() { return { available: true }; }
      async shutdown() {}
      async steer() { return false; }

      runTurn(context) {
        this.active = true;
        this.context = context;
        context.onEvent({ event: 'session_started', sessionId: context.identity.sessionId, data: {} });
        context.onEvent({
          event: 'tool_started',
          sessionId: context.identity.sessionId,
          data: {
            toolCallId: 'tool-write-a',
            toolName: 'write',
            input: { path: 'approved.md', content: 'approved' },
          },
        });
        context.onEvent({
          event: 'permission_requested',
          sessionId: context.identity.sessionId,
          data: {
            approvalId: 'host-approval-a',
            toolCallId: 'tool-write-a',
            toolName: 'write',
            input: { path: 'approved.md', content: 'approved' },
          },
        });
        return new Promise((resolve, reject) => {
          this.complete = { resolve, reject };
        });
      }

      async resolveToolApproval(sessionKey, approvalId, decision) {
        this.approval = { sessionKey, approvalId, decision };
        this.context.onEvent({
          event: 'tool_completed',
          sessionId: this.context.identity.sessionId,
          data: {
            toolCallId: 'tool-write-a',
            toolName: 'write',
            output: 'wrote approved.md',
            isError: !decision.allow,
          },
        });
        this.context.onEvent({
          event: 'turn_completed',
          sessionId: this.context.identity.sessionId,
          data: { status: 'completed' },
        });
        this.active = false;
        this.complete.resolve({ sessionId: this.context.identity.sessionId, status: 'completed' });
        return true;
      }

      async abort() {
        this.active = false;
        this.complete?.reject(Object.assign(new Error('aborted'), { code: 'PI_TURN_ABORTED' }));
        return true;
      }
    }

    hostManager = new ApprovalHostManager();
    const runtime = createPiRuntime({ hostManager });
    const session = identity('session-approval');
    const writer = { send: vi.fn() };
    const pending = runtime.start('make the approved change', {
      identity: session,
      sessionKey: 'approval-session-key',
      turnId: 'turn-approval',
      projectPath: projectRoot,
      storageOptions: { dataDir: testRoot },
      turnSnapshot: {
        modelProviderId: 'faux',
        modelId: 'pi-faux-v1',
        permissionMode: 'ask',
      },
    }, writer);

    await vi.waitFor(() => expect(writer.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'agent-permission-request',
      provider: 'pi',
      toolName: 'Write',
    })));
    const request = writer.send.mock.calls
      .map(([payload]) => payload)
      .find((payload) => payload.type === 'agent-permission-request');
    expect(runtime.native.resolveToolApproval(request.requestId, { allow: true }, {
      ownerKey: session.ownerKey,
    })).toBe(true);
    await expect(pending).resolves.toMatchObject({ status: 'completed' });
    expect(hostManager.approval).toMatchObject({
      approvalId: 'host-approval-a',
      decision: { allow: true },
    });

    const auditPath = resolvePiToolAuditPath(session, { dataDir: testRoot });
    const audit = await fs.readFile(auditPath, 'utf8');
    expect(audit).toContain('approval_requested');
    expect(audit).toContain('approved');
    expect(audit).toContain('completed');
  });
});

describe('Pi event mapper', () => {
  it('normalizes text, reasoning, tools, artifacts, todos, and provider-neutral usage', () => {
    expect(mapPiHostEventToObservations({
      event: 'text_delta',
      sessionId: 'session-a',
      data: { text: 'hello' },
    })[0]).toMatchObject({ type: 'assistant_text', provider: 'pi', text: 'hello' });
    expect(mapPiHostEventToObservations({ event: 'thinking_delta', data: {} })[0])
      .toMatchObject({ type: 'reasoning_activity', provider: 'pi' });
    expect(mapPiHostEventToObservations({
      event: 'tool_started',
      data: { toolCallId: 'tool-a', toolName: 'read', input: { path: 'paper.md' } },
    })[0]).toMatchObject({ type: 'tool_use', toolName: 'Read', nativeToolName: 'read' });
    expect(mapPiHostEventToObservations({
      event: 'tool_completed',
      data: { toolCallId: 'tool-a', output: 'done' },
    })[0]).toMatchObject({ type: 'tool_result', output: 'done' });
    expect(mapPiHostEventToObservations({
      event: 'artifact_created',
      data: { path: 'paper.md' },
    })[0]).toMatchObject({ type: 'artifact_created', path: 'paper.md' });
    expect(mapPiHostEventToObservations({
      event: 'todo_snapshot',
      data: { todos: [{ id: '1', title: 'read' }] },
    })[0]).toMatchObject({ type: 'todo_snapshot' });
    expect(mapPiHostEventToObservations({
      event: 'usage',
      data: { input_tokens: 2, output_tokens: 3, reasoning_tokens: 1 },
    })[0]).toMatchObject({
      type: 'usage_updated',
      usage: { provider: 'pi', totalTokens: 5, reasoningTokens: 1 },
    });
  });
});
