#!/usr/bin/env node

import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { promises as fs, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createToolOutputBudget, positiveLimit } from './output-budget.js';
import { piSubagentProfile } from './subagent-policy.js';
import { piSessionBranches } from './session-branches.js';
import os from 'node:os';
import path from 'node:path';

const PROTOCOL_VERSION = Number(process.env.PI_HOST_PROTOCOL_VERSION || 1);
const HOST_BUILD_ID = 19;
const READ_ONLY_TOOLS = Object.freeze(['read', 'grep', 'find', 'ls', 'system_info']);
const WRITE_TOOLS = Object.freeze(['write', 'edit', 'bash']);
const COORDINATION_TOOLS = Object.freeze([
  'ask_user',
  'todo_read',
  'todo_write',
  'task_create',
  'task_update',
  'task_list',
  'task_get',
  'task',
]);
const BASH_DEFAULT_TIMEOUT_MS = 60_000;
const BASH_MAX_TIMEOUT_MS = 120_000;
const MCP_CONNECT_TIMEOUT_MS = 5_000;
const MCP_CALL_TIMEOUT_MS = 120_000;
const MCP_MAX_SERVERS = 16;
const MCP_MAX_TOOLS = 128;
const MCP_MAX_INPUT_BYTES = 256 * 1024;
const MCP_MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_INLINE_IMAGE_TOTAL_BYTES = 20 * 1024 * 1024;
const SAFE_CHILD_ENV_KEYS = Object.freeze([
  'PATH', 'Path', 'PATHEXT', 'SYSTEMROOT', 'SystemRoot', 'WINDIR',
  'TMP', 'TEMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM',
]);
const SAFE_AGENT_ENV_KEYS = Object.freeze([
  'MEDHELP_MANAGED_AGENT_SESSION',
  'MEDHELP_DATABASE_API_CONNECTION_STATUS',
  'MEDHELP_DATABASE_API_URL',
  'DATABASE_API_URL',
  'MEDHELP_DATABASE_API_TOKEN',
  'DATABASE_API_TOKEN',
  'MEDHELP_DATABASE_API_CONNECTION_VERIFIED_AT',
  'MEDHELP_DATABASE_API_ACCESSIBLE_SOURCE_COUNT',
]);
const DANGEROUS_BASH_PATTERNS = Object.freeze([
  /(?:^|[;&|]\s*)(?:sudo|doas)\b/i,
  /\brm\s+(?=[^\n]*-[^\n]*[rf])[^\n]*(?:\s|^)(?:\/|~|\$HOME)(?:\/|\s|$)/i,
  /\brm\b[^\n]*--no-preserve-root\b/i,
  /\b(?:mkfs(?:\.[a-z0-9]+)?|fdisk|parted|shutdown|reboot|halt|poweroff)\b/i,
  /\bdiskutil\s+(?:erase|partition|zeroDisk|secureErase)\b/i,
  /\bdd\b[^\n]*\bof\s*=\s*\/dev\//i,
  /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*;\s*\}\s*;\s*:/,
  /\b(?:curl|wget)\b[^\n|]*\|\s*(?:ba|z|k)?sh\b/i,
]);
let sdk = null;
let activeSession = null;
let activeAssistantMessageId = null;
let activeRequestId = null;
let promptAbortController = null;
let lastSessionId = null;
const pendingToolApprovals = new Map();
const pendingServiceTools = new Map();
const gatewayInvocations = new Map();
const startedToolCalls = new Set();

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function respond(id, result) {
  send({ id, ok: true, result });
}

function reject(id, code, message, details) {
  send({ id, ok: false, error: { code, message, ...(details ? { details } : {}) } });
}

function emit(event, sessionId, data = {}) {
  if (event === 'tool_started' && gatewayInvocations.has(data.toolCallId)) {
    const gateway = gatewayInvocations.get(data.toolCallId);
    data = { ...data, nativeToolName: 'tool_call', nativeToolInput: { name: gateway.name, arguments: gateway.input } };
  }
  if (event === 'tool_started') startedToolCalls.add(data.toolCallId);
  send({ event, sessionId, data });
}

function errorCode(error, fallback = 'PI_HOST_PROTOCOL_ERROR') {
  if (error?.name === 'AbortError' || /aborted/i.test(error?.message || '')) return 'PI_TURN_ABORTED';
  const status = Number(
    error?.status
    || error?.statusCode
    || error?.response?.status
    || String(error?.message || '').match(/\b(?:HTTP\s*)?(401|403|404|429|5\d\d)\b/i)?.[1],
  );
  if (status === 401 || status === 403) return 'PI_PROVIDER_AUTH_FAILED';
  if (status === 404) return 'PI_MODEL_NOT_FOUND';
  if (status === 429) return 'PI_PROVIDER_RATE_LIMITED';
  if (status >= 500 && status <= 599) return 'PI_PROVIDER_UPSTREAM_ERROR';
  if (/invalid\s+(?:sse|event stream)|malformed\s+(?:sse|event stream)/i.test(error?.message || '')) {
    return 'PI_PROVIDER_STREAM_INVALID';
  }
  if (/session/i.test(error?.message || '') && /not found|enoent/i.test(error?.message || '')) {
    return 'PI_SESSION_NOT_FOUND';
  }
  return fallback;
}

async function initialize(request) {
  if (request.params?.protocolVersion !== PROTOCOL_VERSION) {
    reject(
      request.id,
      'PI_HOST_VERSION_MISMATCH',
      `Pi Host protocol ${PROTOCOL_VERSION} does not match ${request.params?.protocolVersion}.`,
    );
    return;
  }
  try {
    sdk = await import('@earendil-works/pi-coding-agent');
  } catch (error) {
    reject(
      request.id,
      'PI_HOST_NOT_FOUND',
      `Pi SDK is unavailable in the isolated host: ${error?.message || error}`,
    );
    return;
  }
  respond(request.id, {
    protocolVersion: PROTOCOL_VERSION,
    hostBuildId: HOST_BUILD_ID,
    provider: request.params?.provider || null,
    sdkVersion: request.params?.sdkVersion || null,
    nodeVersion: process.version,
    tools: [...READ_ONLY_TOOLS, ...WRITE_TOOLS, ...COORDINATION_TOOLS],
    interactiveToolApproval: true,
    state: 'ready',
  });
}

function cancelPendingToolApprovals(reason = 'cancelled') {
  for (const pending of [...pendingToolApprovals.values()]) {
    pending.settle({ allow: false, reason });
  }
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeAgentState(params, value = {}) {
  const records = (items) => Array.isArray(items)
    ? items.filter((item) => isRecord(item))
    : [];
  return {
    version: 1,
    identity: isRecord(params.identity) ? params.identity : {
      runtimeId: 'pi',
      sessionId: params.sessionId || null,
    },
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : null,
    runs: records(value.runs),
    toolCalls: records(value.toolCalls),
    tasks: records(value.tasks),
    todos: records(value.todos),
    artifacts: records(value.artifacts),
    contextItems: records(value.contextItems),
    permissionRequests: records(value.permissionRequests),
    plan: isRecord(value.plan) ? value.plan : null,
  };
}

function createAgentStateController(params) {
  if (params.managedState === true) {
    let queue = Promise.resolve();
    const call = (operation, args) => {
      const pending = queue.then(() => requestRuntimeService(operation, args, params, null, null, 'agent_state_requested'));
      queue = pending.then(() => undefined, () => undefined);
      return pending;
    };
    return Object.fromEntries([
      ['flush', () => queue],
      ...['read', 'updatePlan', 'updateRun', 'updateToolCall', 'upsertTask', 'replaceTodos', 'addArtifact', 'addContextItem', 'updatePermission']
        .map((operation) => [operation, (...args) => call(operation, args)]),
    ]);
  }
  const statePath = typeof params.agentStatePath === 'string' && params.agentStatePath.trim()
    ? path.resolve(params.agentStatePath)
    : null;
  let memoryState = normalizeAgentState(params);
  let queue = Promise.resolve();

  const read = async () => {
    if (!statePath) return memoryState;
    try {
      return normalizeAgentState(params, JSON.parse(await fs.readFile(statePath, 'utf8')));
    } catch (error) {
      if (error?.code === 'ENOENT') return normalizeAgentState(params);
      throw error;
    }
  };
  const write = async (state) => {
    const next = normalizeAgentState(params, { ...state, updatedAt: nowIso() });
    memoryState = next;
    if (!statePath) return next;
    await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${statePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await fs.rename(temporaryPath, statePath);
    return next;
  };
  const mutate = (mutator) => {
    const operation = queue.then(async () => {
      const state = await read();
      const result = await mutator(state);
      return write(result || state);
    });
    queue = operation.then(() => undefined, () => undefined);
    return operation;
  };
  const upsertById = (collection, id, changes) => {
    const timestamp = nowIso();
    const index = collection.findIndex((entry) => String(entry.id) === String(id));
    if (index === -1) {
      collection.push({ id: String(id), createdAt: timestamp, updatedAt: timestamp, ...changes });
      return collection.at(-1);
    }
    collection[index] = { ...collection[index], ...changes, updatedAt: timestamp };
    return collection[index];
  };

  return {
    read,
    updatePlan: (plan) => mutate((state) => { state.plan = plan; return state; }),
    flush: () => queue,
    updateRun: (runId, changes) => mutate((state) => {
      upsertById(state.runs, runId, changes);
      state.runs = state.runs.slice(-100);
      return state;
    }),
    updateToolCall: (toolCallId, changes) => mutate((state) => {
      upsertById(state.toolCalls, toolCallId, changes);
      state.toolCalls = state.toolCalls.slice(-1_000);
      return state;
    }),
    upsertTask: async (taskId, changes) => {
      let task = null;
      const state = await mutate((current) => {
        task = upsertById(current.tasks, taskId, changes);
        return current;
      });
      return state.tasks.find((entry) => String(entry.id) === String(taskId)) || task;
    },
    replaceTodos: (todos) => mutate((state) => {
      const timestamp = nowIso();
      let hasInProgress = false;
      state.todos = todos.map((todo, index) => {
        let status = ['pending', 'in_progress', 'completed'].includes(todo?.status)
          ? todo.status
          : 'pending';
        if (status === 'in_progress') {
          if (hasInProgress) status = 'pending';
          hasInProgress = true;
        }
        return {
          id: String(todo?.id || `todo-${index + 1}`),
          content: String(todo?.content || todo?.text || '').slice(0, 4_000),
          status,
          activeForm: typeof todo?.activeForm === 'string' ? todo.activeForm.slice(0, 1_000) : null,
          updatedAt: timestamp,
        };
      }).filter((todo) => todo.content);
      return state;
    }),
    addArtifact: async (artifact) => {
      const id = String(artifact.id || `artifact-${crypto.randomUUID()}`);
      const state = await mutate((current) => {
        upsertById(current.artifacts, id, artifact);
        current.artifacts = current.artifacts.slice(-500);
        return current;
      });
      return state.artifacts.find((entry) => entry.id === id);
    },
    addContextItem: async (contextItem) => {
      const id = String(contextItem.id || `context-${crypto.randomUUID()}`);
      const state = await mutate((current) => {
        upsertById(current.contextItems, id, contextItem);
        current.contextItems = current.contextItems.slice(-500);
        return current;
      });
      return state.contextItems.find((entry) => entry.id === id);
    },
    updatePermission: async (approvalId, changes) => {
      const state = await mutate((current) => {
        upsertById(current.permissionRequests, approvalId, changes);
        current.permissionRequests = current.permissionRequests.slice(-200);
        return current;
      });
      return state.permissionRequests.find((entry) => entry.id === approvalId);
    },
  };
}

async function ensureNewSessionFile(sessionPath, sessionId, cwd) {
  await fs.mkdir(path.dirname(sessionPath), { recursive: true, mode: 0o700 });
  const header = {
    type: 'session',
    version: 3,
    id: sessionId,
    timestamp: new Date().toISOString(),
    cwd,
  };
  try {
    const handle = await fs.open(sessionPath, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(header)}\n`, 'utf8');
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
}

function normalizeContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
}

const IMAGE_MIME_BY_EXTENSION = Object.freeze({
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
});

function modelSupportsImages(model) {
  return Array.isArray(model?.input) && model.input.includes('image');
}

async function buildPromptContent(prompt, attachments, projectRoot, model, options, signal) {
  const text = String(prompt || '');
  const images = [];
  const delivery = [];
  const contextCount = positiveLimit(process.env.MEDHELP_PI_IMAGE_CONTEXT_COUNT, 8, 100);
  const totalBudget = Math.min(MAX_INLINE_IMAGE_TOTAL_BYTES, positiveLimit(process.env.MEDHELP_PI_IMAGE_CONTEXT_BYTES, MAX_INLINE_IMAGE_TOTAL_BYTES, 64 * 1024 * 1024));
  let totalBytes = 0;
  for (const [index, attachment] of (Array.isArray(attachments) ? attachments : []).entries()) {
    const entry = { name: attachment?.name || attachment?.path || 'Attachment', path: attachment?.path || '', status: 'not_sent', reason: '' };
    delivery.push(entry);
    if (index >= 20) { entry.reason = 'too_many_attachments'; continue; }
    const declaredMime = typeof attachment?.mimeType === 'string'
      ? attachment.mimeType.trim().toLowerCase()
      : '';
    const requestedPath = typeof attachment?.path === 'string' ? attachment.path.trim() : '';
    if (!declaredMime.startsWith('image/') && attachment?.kind !== 'image') { entry.reason = 'unsupported_type'; continue; }
    if (!modelSupportsImages(model)) { entry.reason = 'model_no_vision'; continue; }
    if (images.length >= contextCount) { entry.reason = 'image_context_limit'; continue; }
    if (!requestedPath) { entry.reason = 'file_unavailable'; continue; }
    const candidate = path.resolve(projectRoot, requestedPath);
    let canonicalPath;
    try {
      canonicalPath = await fs.realpath(candidate);
    } catch {
      entry.reason = 'file_unavailable';
      continue;
    }
    if (!isInsideProject(projectRoot, canonicalPath)) { entry.reason = 'outside_project'; continue; }
    let stat = await fs.stat(canonicalPath).catch(() => null);
    if (!stat?.isFile() || stat.size <= 0) { entry.reason = 'file_unavailable'; continue; }
    if (totalBytes >= totalBudget) { entry.reason = totalBudget < MAX_INLINE_IMAGE_TOTAL_BYTES ? 'image_context_limit' : 'total_image_limit'; continue; }
    let mimeType = declaredMime.startsWith('image/')
      ? declaredMime
      : IMAGE_MIME_BY_EXTENSION[path.extname(canonicalPath).toLowerCase()];
    if (!mimeType) { entry.reason = 'unsupported_type'; continue; }
    try {
      const prepared = await requestRuntimeService('image', { path: canonicalPath, maxBytes: Math.min(MAX_INLINE_IMAGE_BYTES, totalBudget - totalBytes) }, options, null, signal, 'host_resource_requested');
      canonicalPath = await fs.realpath(prepared.path);
      if (!isInsideProject(projectRoot, canonicalPath)) throw new Error('Prepared image escaped project');
      mimeType = prepared.mimeType;
      stat = await fs.stat(canonicalPath);
      entry.resized = prepared.resized;
    } catch (error) {
      if (signal?.aborted) throw error;
      entry.reason = 'image_decode_failed'; continue;
    }
    if (stat.size > MAX_INLINE_IMAGE_BYTES) { entry.reason = 'image_too_large'; continue; }
    if (totalBytes + stat.size > totalBudget) { entry.reason = totalBudget < MAX_INLINE_IMAGE_TOTAL_BYTES ? 'image_context_limit' : 'total_image_limit'; continue; }
    images.push({
      type: 'image',
      data: (await fs.readFile(canonicalPath)).toString('base64'),
      mimeType,
    });
    totalBytes += stat.size;
    entry.status = 'sent';
  }
  return { content: images.length > 0 ? [{ type: 'text', text }, ...images] : text, delivery };
}

function normalizeToolOutput(result) {
  if (typeof result === 'string') return result;
  const content = normalizeContent(result?.content);
  if (content) return content;
  try {
    return JSON.stringify(result ?? '');
  } catch {
    return String(result ?? '');
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isInsideLexically(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function readResourceProjection(configDir) {
  const projectionPath = path.join(configDir, 'resources.json');
  let stat;
  try {
    stat = await fs.lstat(projectionPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return { skillPaths: [], trustedSkillRoots: [], mcpServers: [] };
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) {
    throw Object.assign(new Error('Pi resource projection is invalid.'), {
      code: 'PI_RESOURCE_PROJECTION_INVALID',
    });
  }
  const parsed = JSON.parse(await fs.readFile(projectionPath, 'utf8'));
  if (parsed?.schema !== 'medhelp.pi-resource-projection.v1') {
    throw Object.assign(new Error('Pi resource projection schema is unsupported.'), {
      code: 'PI_RESOURCE_PROJECTION_INVALID',
    });
  }
  const skillPaths = [];
  const trustedSkillRoots = [];
  for (const value of Array.isArray(parsed.skillPaths) ? parsed.skillPaths : []) {
    if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.split(/[\\/]+/).includes('..')) {
      throw Object.assign(new Error('Pi skill projection contains an unsafe path.'), {
        code: 'PI_RESOURCE_PROJECTION_INVALID',
      });
    }
    const candidate = path.resolve(configDir, value);
    if (!isInsideLexically(configDir, candidate)) {
      throw Object.assign(new Error('Pi skill projection escaped its private config directory.'), {
        code: 'PI_RESOURCE_PROJECTION_INVALID',
      });
    }
    await fs.access(path.join(candidate, 'SKILL.md'));
    skillPaths.push(candidate);
    trustedSkillRoots.push(candidate, await fs.realpath(candidate));
  }
  const mcpServers = [];
  for (const entry of (Array.isArray(parsed.mcpServers) ? parsed.mcpServers : []).slice(0, MCP_MAX_SERVERS)) {
    if (
      !isRecord(entry)
      || typeof entry.name !== 'string'
      || !/^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/.test(entry.name)
      || entry.type !== 'stdio'
      || typeof entry.command !== 'string'
      || !path.isAbsolute(entry.command)
      || !Array.isArray(entry.args)
      || entry.args.length > 128
      || !isRecord(entry.env)
      || Object.keys(entry.env).length > 128
    ) {
      throw Object.assign(new Error('Pi MCP projection contains an invalid server.'), {
        code: 'PI_RESOURCE_PROJECTION_INVALID',
      });
    }
    if (
      entry.command.includes('\0')
      || entry.args.some((value) => typeof value !== 'string' || value.includes('\0') || value.length > 16_000)
      || Object.entries(entry.env).some(([key, value]) => (
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
        || typeof value !== 'string'
        || value.includes('\0')
        || value.length > 64_000
      ))
    ) {
      throw Object.assign(new Error('Pi MCP projection contains unsafe process parameters.'), {
        code: 'PI_RESOURCE_PROJECTION_INVALID',
      });
    }
    mcpServers.push({
      name: entry.name,
      version: typeof entry.version === 'string' ? entry.version : null,
      command: entry.command,
      args: entry.args.map(String),
      env: Object.fromEntries(Object.entries(entry.env).map(([key, value]) => [key, String(value)])),
    });
  }
  return { skillPaths, trustedSkillRoots: [...new Set(trustedSkillRoots)], mcpServers };
}

function safeMcpToolPart(value) {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 63);
  return normalized || 'tool';
}

function mcpResultText(result) {
  const texts = [];
  for (const item of Array.isArray(result?.content) ? result.content : []) {
    if (item?.type === 'text' && typeof item.text === 'string') texts.push(item.text);
    else if (item?.type === 'resource_link') texts.push(`Resource: ${item.name || item.uri} (${item.uri})`);
    else if (item?.type === 'resource') texts.push(JSON.stringify(item.resource));
    else if (item?.type === 'audio') texts.push(`[Audio result: ${item.mimeType || 'unknown'}]`);
  }
  if (texts.length === 0 && result?.structuredContent !== undefined) {
    texts.push(JSON.stringify(result.structuredContent));
  }
  const text = texts.join('\n') || 'MCP tool completed without text output.';
  return text;
}

async function closeMcpConnections(connections) {
  await Promise.allSettled(connections.map(async ({ client, transport }) => {
    try {
      await client?.close?.();
    } catch {}
    try {
      await transport?.close?.();
    } catch {}
  }));
}

async function createMcpTools(servers, options) {
  if (!['ask', 'auto'].includes(options.permissionMode) || servers.length === 0) {
    return { tools: [], connections: [], diagnostics: [] };
  }
  const [{ Client }, { StdioClientTransport }, { Type }] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/index.js'),
    import('@modelcontextprotocol/sdk/client/stdio.js'),
    import('typebox'),
  ]);
  const tools = [];
  const connections = [];
  const diagnostics = [];
  const usedNames = new Set();
  for (const server of servers) {
    if (tools.length >= MCP_MAX_TOOLS) break;
    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: server.env,
      cwd: options.projectRoot,
      stderr: 'pipe',
    });
    transport.stderr?.resume?.();
    const client = new Client({ name: 'medhelp-pi-host', version: '1.0.0' }, { capabilities: {} });
    try {
      await client.connect(transport, { timeout: MCP_CONNECT_TIMEOUT_MS });
      const listed = await client.listTools({}, { timeout: MCP_CONNECT_TIMEOUT_MS });
      connections.push({ client, transport });
      for (const declaredTool of listed.tools || []) {
        if (tools.length >= MCP_MAX_TOOLS) break;
        const serverPart = safeMcpToolPart(server.name);
        const declaredToolPart = safeMcpToolPart(declaredTool.name);
        const baseName = `mcp__${serverPart}__${declaredToolPart}`;
        let toolName = baseName;
        if (usedNames.has(toolName)) {
          const suffix = crypto.createHash('sha256')
            .update(`${server.name}:${declaredTool.name}`)
            .digest('hex')
            .slice(0, 6);
          toolName = `mcp__${serverPart}__${declaredToolPart.slice(0, 56)}_${suffix}`;
        }
        if (usedNames.has(toolName)) continue;
        usedNames.add(toolName);
        const inputSchema = declaredTool.inputSchema || { type: 'object', properties: {} };
        if (
          typeof declaredTool.name !== 'string'
          || declaredTool.name.length > 128
          || Buffer.byteLength(JSON.stringify(inputSchema)) > MCP_MAX_INPUT_BYTES
        ) {
          diagnostics.push({ server: server.name, code: 'invalid_tool_schema' });
          continue;
        }
        tools.push({
          name: toolName,
          label: String(declaredTool.title || `${server.name}: ${declaredTool.name}`).slice(0, 200),
          description: `[Trusted MCP server: ${server.name}] ${declaredTool.description || declaredTool.name}`.slice(0, 4_000),
          promptSnippet: `Call ${declaredTool.name} on the trusted ${server.name} MCP server (Ask mode approval required).`,
          parameters: Type.Unsafe(inputSchema),
          executionMode: 'sequential',
          execute: async (toolCallId, params, signal) => {
            const mode = options.mode?.value || options.permissionMode;
            if (!['ask', 'auto'].includes(mode)) throw new Error('MCP calls are blocked until the plan is approved');
            const inputBytes = Buffer.byteLength(JSON.stringify(params || {}));
            if (inputBytes > MCP_MAX_INPUT_BYTES) {
              throw Object.assign(new Error('MCP tool input exceeded the allowed size.'), {
                code: 'PI_TOOL_INPUT_INVALID',
              });
            }
            emit('tool_started', options.sessionId, {
              runId: options.runId,
              toolCallId,
              toolName,
              input: params || {},
            });
            if (mode === 'ask') {
              const decision = await waitForToolApproval({
                sessionId: options.sessionId,
                runId: options.runId,
                toolCallId,
                toolName,
                input: params || {},
                signal,
                timeoutMs: options.approvalTimeoutMs,
                stateController: options.stateController,
              });
              if (!decision.allow) {
                throw Object.assign(new Error(
                  decision.reason === 'timeout' ? 'Tool approval timed out.' : 'Tool use was denied.',
                ), { code: 'PI_TOOL_PERMISSION_DENIED' });
              }
            }
            const result = await client.callTool(
              { name: declaredTool.name, arguments: params || {} },
              undefined,
              { signal, timeout: MCP_CALL_TIMEOUT_MS },
            );
            const text = mcpResultText(result);
            if (result?.isError) throw new Error(text);
            let remainingImageBytes = Math.max(0, MCP_MAX_OUTPUT_BYTES - Buffer.byteLength(text));
            const images = [];
            for (const item of result?.content || []) {
              if (images.length >= 4 || item?.type !== 'image' || typeof item.data !== 'string') continue;
              const imageBytes = Buffer.byteLength(item.data, 'base64');
              if (imageBytes > remainingImageBytes) continue;
              images.push({ type: 'image', data: item.data, mimeType: item.mimeType || 'image/png' });
              remainingImageBytes -= imageBytes;
            }
            return { content: [{ type: 'text', text }, ...images], details: { server: server.name } };
          },
        });
      }
    } catch (error) {
      diagnostics.push({ server: server.name, code: 'connection_failed', message: String(error?.message || error).slice(0, 500) });
      await client.close?.().catch(() => {});
      await transport.close?.().catch(() => {});
    }
  }
  return { tools, connections, diagnostics };
}

function isInsideProject(projectRoot, candidate) {
  return candidate === projectRoot || candidate.startsWith(`${projectRoot}${path.sep}`);
}

async function realpathNearestExisting(candidate) {
  let current = candidate;
  while (true) {
    try {
      return {
        existing: await fs.realpath(current),
        suffix: path.relative(current, candidate),
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

function assertSafeGlob(value, label) {
  if (typeof value !== 'string' || !value.trim()) return;
  const normalized = value.replace(/\\/g, '/');
  if (path.isAbsolute(value) || normalized.split('/').includes('..')) {
    throw Object.assign(new Error(`${label} must stay inside the project.`), {
      code: 'PI_TOOL_PATH_OUTSIDE_PROJECT',
    });
  }
}

function normalizePermissionMode(value) {
  return value === 'auto' || value === 'ask' || value === 'plan' ? value : 'readOnly';
}

function normalizeReasoningLevel(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!normalized || normalized === 'none' || normalized === 'default') return 'off';
  if (normalized === 'max') return 'xhigh';
  return ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(normalized)
    ? normalized
    : 'off';
}

function authorizeBashParams(params) {
  const nextParams = params && typeof params === 'object' ? { ...params } : {};
  const command = typeof nextParams.command === 'string' ? nextParams.command.trim() : '';
  if (!command || command.length > 16_000 || command.includes('\0')) {
    throw Object.assign(new Error('bash requires a valid command no longer than 16,000 characters.'), {
      code: 'PI_TOOL_INPUT_INVALID',
    });
  }
  if (Object.prototype.hasOwnProperty.call(nextParams, 'cwd')) {
    throw Object.assign(new Error('bash always runs from the canonical project root.'), {
      code: 'PI_TOOL_CWD_FIXED',
    });
  }
  if (DANGEROUS_BASH_PATTERNS.some((pattern) => pattern.test(command))) {
    throw Object.assign(new Error('bash command was blocked by the dangerous-command policy.'), {
      code: 'PI_TOOL_COMMAND_BLOCKED',
    });
  }
  const requestedTimeout = Number(nextParams.timeout);
  return {
    command,
    timeout: Number.isFinite(requestedTimeout) && requestedTimeout > 0
      ? Math.min(Math.floor(requestedTimeout), BASH_MAX_TIMEOUT_MS)
      : BASH_DEFAULT_TIMEOUT_MS,
  };
}

async function authorizeToolParams(projectRoot, toolName, params, permissionMode, trustedReadRoots = []) {
  const nextParams = params && typeof params === 'object' ? { ...params } : {};
  if (WRITE_TOOLS.includes(toolName)) {
    if (permissionMode === 'plan') {
      throw Object.assign(new Error(`${toolName} is disabled in Plan mode.`), {
        code: 'PI_TOOL_WRITE_BLOCKED_IN_PLAN',
      });
    }
    if (permissionMode !== 'ask' && permissionMode !== 'auto') {
      throw Object.assign(new Error(`${toolName} requires Ask mode and explicit approval.`), {
        code: 'PI_TOOL_NOT_ALLOWED',
      });
    }
  }
  if (toolName === 'bash') return authorizeBashParams(nextParams);
  if (toolName === 'system_info') return {};
  const requestedPath = typeof nextParams.path === 'string' && nextParams.path.trim()
    ? nextParams.path.trim()
    : '.';
  const resolvedPath = path.resolve(projectRoot, requestedPath);
  const nearest = await realpathNearestExisting(resolvedPath);
  const canonicalPath = path.resolve(nearest.existing, nearest.suffix);
  const allowedRoots = toolName === 'read' || toolName === 'grep' || toolName === 'find' || toolName === 'ls'
    ? [projectRoot, ...trustedReadRoots]
    : [projectRoot];
  if (!allowedRoots.some((root) => isInsideProject(root, canonicalPath))) {
    throw Object.assign(new Error(`${toolName} path must stay inside the project.`), {
      code: 'PI_TOOL_PATH_OUTSIDE_PROJECT',
    });
  }
  if (toolName === 'find') assertSafeGlob(nextParams.pattern, 'find pattern');
  if (toolName === 'grep') assertSafeGlob(nextParams.glob, 'grep glob');
  nextParams.path = canonicalPath;
  return nextParams;
}

function publicToolInput(projectRoot, input) {
  const nextInput = { ...input };
  if (typeof nextInput.path === 'string' && isInsideProject(projectRoot, nextInput.path)) {
    nextInput.path = path.relative(projectRoot, nextInput.path) || '.';
  }
  return nextInput;
}

function waitForToolApproval({
  sessionId,
  runId,
  toolCallId,
  toolName,
  input,
  signal,
  timeoutMs,
  eventName = 'permission_requested',
  stateController,
}) {
  const approvalId = `approval-${crypto.randomUUID()}`;
  return new Promise((resolve) => {
    let abortListener = null;
    const settle = (decision = {}) => {
      const pending = pendingToolApprovals.get(approvalId);
      if (!pending) return false;
      pendingToolApprovals.delete(approvalId);
      clearTimeout(pending.timer);
      if (abortListener) signal?.removeEventListener?.('abort', abortListener);
      const normalized = {
        allow: decision.allow === true,
        reason: typeof decision.reason === 'string' ? decision.reason : null,
        updatedInput: isRecord(decision.updatedInput) ? decision.updatedInput : null,
      };
      const resolvedEventName = eventName === 'interaction_requested'
        ? 'interaction_resolved'
        : 'permission_resolved';
      stateController?.updatePermission(approvalId, {
        status: normalized.allow ? 'approved' : 'denied',
        resolvedAt: nowIso(),
        reason: normalized.reason,
      }).catch(() => {});
      emit(resolvedEventName, sessionId, {
        approvalId,
        runId,
        toolCallId,
        toolName,
        allow: normalized.allow,
        reason: normalized.reason,
        status: normalized.allow ? 'approved' : 'denied',
      });
      resolve(normalized);
      return true;
    };
    const timer = setTimeout(() => settle({ allow: false, reason: 'timeout' }), timeoutMs);
    timer.unref?.();
    abortListener = () => settle({ allow: false, reason: 'aborted' });
    signal?.addEventListener?.('abort', abortListener, { once: true });
    pendingToolApprovals.set(approvalId, { approvalId, toolCallId, timer, settle });
    stateController?.updatePermission(approvalId, {
      runId,
      sessionId,
      toolCallId,
      toolName,
      input,
      status: 'pending',
      interaction: eventName === 'interaction_requested',
      requestedAt: nowIso(),
    }).catch(() => {});
    emit(eventName, sessionId, {
      approvalId,
      runId,
      toolCallId,
      toolName,
      input,
    });
  });
}

function safeBashEnvironment() {
  return Object.fromEntries([...SAFE_CHILD_ENV_KEYS, ...SAFE_AGENT_ENV_KEYS]
    .filter((key) => typeof process.env[key] === 'string')
    .map((key) => [key, process.env[key]]));
}

function terminateChild(child, signal = 'SIGTERM') {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  if (process.platform === 'win32' && child.pid) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      return;
    } catch {}
  }
  if (process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {}
  }
  try {
    child.kill(signal);
  } catch {}
}

function terminateChildWithEscalation(child) {
  terminateChild(child, 'SIGTERM');
  const killTimer = setTimeout(() => terminateChild(child, 'SIGKILL'), 1_000);
  killTimer.unref?.();
}

function createRestrictedBashOperations(projectRoot) {
  return {
    exec: (command, cwd, options = {}) => new Promise((resolve, rejectPromise) => {
      if (path.resolve(cwd) !== projectRoot) {
        rejectPromise(Object.assign(new Error('bash cwd must be the canonical project root.'), {
          code: 'PI_TOOL_CWD_FIXED',
        }));
        return;
      }
      if (options.signal?.aborted) {
        rejectPromise(Object.assign(new Error('bash was aborted.'), { name: 'AbortError' }));
        return;
      }
      const timeoutMs = Number.isFinite(options.timeout) && options.timeout > 0
        ? Math.min(Math.floor(options.timeout), BASH_MAX_TIMEOUT_MS)
        : BASH_DEFAULT_TIMEOUT_MS;
      const child = spawn(command, [], {
        cwd: projectRoot,
        env: safeBashEnvironment(),
        shell: process.platform === 'win32' ? true : (process.env.SHELL || '/bin/sh'),
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let settled = false;
      let writes = Promise.resolve();
      let executionError = null;
      const finish = (error, exitCode = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        options.signal?.removeEventListener?.('abort', abortListener);
        if (error) rejectPromise(error);
        else resolve({ exitCode });
      };
      const onData = (chunk, stream) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        stream.pause();
        writes = writes.then(() => options.onData?.(buffer)).then(() => stream.resume()).catch((error) => { executionError = error; terminateChildWithEscalation(child); });
      };
      const abortListener = () => terminateChildWithEscalation(child);
      const timer = setTimeout(() => {
        executionError = Object.assign(new Error(`bash exceeded the ${timeoutMs}ms timeout.`), { code: 'PI_TOOL_TIMEOUT' });
        terminateChildWithEscalation(child);
      }, timeoutMs);
      timer.unref?.();
      child.stdout?.on('data', (chunk) => onData(chunk, child.stdout));
      child.stderr?.on('data', (chunk) => onData(chunk, child.stderr));
      child.once('error', (error) => finish(error));
      child.once('close', async (code) => {
        await writes;
        if (executionError) finish(executionError);
        else if (options.signal?.aborted) {
          finish(Object.assign(new Error('bash was aborted.'), { name: 'AbortError' }));
        } else {
          finish(null, code);
        }
      });
      options.signal?.addEventListener?.('abort', abortListener, { once: true });
    }),
  };
}

function runSystemProbe(command, args = [], timeoutMs = 5_000) {
  return new Promise((resolve) => {
    let child;
    let timer;
    let settled = false;
    try {
      child = spawn(command, args, {
        env: safeBashEnvironment(),
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      resolve('');
      return;
    }
    let output = '';
    let outputBytes = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(output);
    };
    child.stdout?.on('data', (chunk) => {
      if (outputBytes >= 256 * 1024) return;
      const text = String(chunk);
      outputBytes += Buffer.byteLength(text);
      output += text.slice(0, Math.max(0, 256 * 1024 - output.length));
    });
    child.once('error', () => finish());
    child.once('exit', () => finish());
    timer = setTimeout(() => {
      terminateChildWithEscalation(child);
      finish();
    }, timeoutMs);
    timer.unref?.();
  });
}

async function detectSystemGpus() {
  if (process.platform === 'darwin') {
    const raw = await runSystemProbe('/usr/sbin/system_profiler', ['SPDisplaysDataType', '-json']);
    try {
      const payload = JSON.parse(raw);
      return (payload.SPDisplaysDataType || []).map((entry) => ({
        name: entry.sppci_model || entry._name || 'Apple GPU',
        memory: entry.spdisplays_vram || entry.spdisplays_vram_shared || null,
        vendor: entry.spdisplays_vendor || null,
        metal: entry.spdisplays_metal || null,
      }));
    } catch {
      return [];
    }
  }
  if (process.platform === 'linux') {
    for (const command of ['/usr/bin/nvidia-smi', '/usr/local/bin/nvidia-smi']) {
      const raw = await runSystemProbe(command, [
        '--query-gpu=name,memory.total,driver_version',
        '--format=csv,noheader,nounits',
      ]);
      if (!raw.trim()) continue;
      return raw.trim().split('\n').map((line) => {
        const [name, memoryMiB, driver] = line.split(',').map((value) => value.trim());
        return { name, memoryMiB: Number(memoryMiB) || null, driver: driver || null };
      });
    }
  }
  if (process.platform === 'win32') {
    const raw = await runSystemProbe('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Json -Compress',
    ]);
    try {
      const parsed = JSON.parse(raw);
      return (Array.isArray(parsed) ? parsed : [parsed]).map((entry) => ({
        name: entry.Name || 'GPU',
        memoryBytes: Number(entry.AdapterRAM) || null,
        driver: entry.DriverVersion || null,
      }));
    } catch {
      return [];
    }
  }
  return [];
}

async function collectSystemInfo(projectRoot) {
  const cpus = os.cpus();
  let disk = null;
  try {
    const stats = await fs.statfs(projectRoot);
    disk = {
      path: projectRoot,
      totalBytes: Number(stats.blocks) * Number(stats.bsize),
      freeBytes: Number(stats.bfree) * Number(stats.bsize),
      availableBytes: Number(stats.bavail) * Number(stats.bsize),
    };
  } catch {}
  return {
    platform: process.platform,
    osType: os.type(),
    osRelease: os.release(),
    architecture: os.arch(),
    hostname: os.hostname(),
    uptimeSeconds: Math.floor(os.uptime()),
    cpu: {
      model: cpus[0]?.model || null,
      logicalCores: cpus.length,
      speedMHz: cpus[0]?.speed || null,
      loadAverage: os.loadavg(),
    },
    memory: {
      totalBytes: os.totalmem(),
      freeBytes: os.freemem(),
    },
    gpu: await detectSystemGpus(),
    disk,
    runtime: {
      nodeVersion: process.version,
      processArchitecture: process.arch,
    },
  };
}

function createSystemInfoTool(projectRoot) {
  return {
    name: 'system_info',
    label: 'Computer Resources',
    description: 'Inspect this computer\'s operating system, CPU, GPU, memory, disk capacity, architecture, and runtime without modifying the system.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    executionMode: 'sequential',
    execute: async () => ({
      content: [{ type: 'text', text: JSON.stringify(await collectSystemInfo(projectRoot), null, 2) }],
      details: {},
    }),
  };
}

function textToolResult(value, details = {}) {
  return {
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    details,
  };
}

function requestRuntimeService(toolName, input, options, toolCallId, signal, eventName = 'runtime_service_requested') {
  return new Promise((resolve, rejectPromise) => {
    if (signal?.aborted) return rejectPromise(new Error('Tool aborted'));
    const requestId = crypto.randomUUID();
    const settle = (result, error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      pendingServiceTools.delete(requestId);
      // Service errors are bounded/spilled before IPC; keep their full-file pointer.
      if (error) rejectPromise(new Error(String(error)));
      else resolve(result);
    };
    const abort = () => settle(null, 'Tool aborted');
    const timer = setTimeout(() => settle(null, 'Runtime service timed out; check its state before retrying'), options.timeoutMs || 90_000);
    timer.unref?.();
    pendingServiceTools.set(requestId, settle);
    signal?.addEventListener('abort', abort, { once: true });
    emit(eventName, options.sessionId, { requestId, toolCallId, toolName, input });
  });
}

function createRuntimeServiceTools(definitions, options) {
  return definitions.map((definition) => ({
    name: definition.name, label: definition.name, description: definition.description,
    parameters: definition.parameters, executionMode: 'sequential',
    execute: async (toolCallId, input, signal) => {
      const mode = options.mode.value;
      if (definition.mutation && !['ask', 'auto'].includes(mode)) throw new Error('Submit the plan for approval before using this tool');
      emit('tool_started', options.sessionId, { runId: options.runId, toolCallId, toolName: definition.name, input });
      if (definition.mutation && mode === 'ask') {
        const decision = await waitForToolApproval({ ...options, toolCallId, toolName: definition.name, input, signal, timeoutMs: options.approvalTimeoutMs });
        if (!decision.allow) throw new Error('Tool use denied');
      }
      const result = await requestRuntimeService(definition.name, input, options, toolCallId, signal);
      // Managed hosts persist through the main process's shared state writer.
      try {
        for (const item of [...(result?.artifact ? [result.artifact] : []), ...(Array.isArray(result?.artifacts) ? result.artifacts : [])]) {
          const artifact = await options.stateController.addArtifact({ ...item, runId: options.runId, toolCallId, sessionId: options.sessionId });
          emit('artifact_created', options.sessionId, { runId: options.runId, toolCallId, ...artifact });
        }
        if (['memory_retrieve', 'web_fetch', 'web_search', 'browser_open', 'browser_snapshot'].includes(definition.name)) {
          const contextItem = await options.stateController.addContextItem({ type: definition.name, runId: options.runId, toolCallId, sessionId: options.sessionId, url: result?.url || null, query: input.query || null });
          emit('context_item_added', options.sessionId, { runId: options.runId, toolCallId, contextItem });
        }
      } catch {
        // The action already succeeded. Never encourage re-executing an external side effect.
        emit('runtime_diagnostic', options.sessionId, { component: 'agent_state', code: 'service_trace_persistence_failed' });
      }
      return textToolResult(result);
    },
  }));
}

function createPlanTools(options) {
  const { stateController, sessionId, runId, mode } = options;
  const publish = async (plan) => {
    await stateController.updatePlan(plan);
    const task = await stateController.upsertTask(`plan-${sessionId}`, { title: plan.title, description: plan.plan, kind: 'plan', revision: plan.revision, sessionId, runId, status: plan.status === 'approved' ? 'completed' : plan.status === 'pending_approval' ? 'waiting_on_user' : 'queued' });
    emit('task_updated', sessionId, { runId, task });
    return plan;
  };
  return [
    { name: 'plan_read', label: 'Read plan', executionMode: 'sequential', description: 'Read this conversation’s formal plan, revision and approval status.', parameters: { type: 'object', properties: {} }, execute: async () => textToolResult((await stateController.read()).plan) },
    { name: 'plan_update', label: 'Update plan', executionMode: 'sequential', description: 'Write a formal plan for approval. Include scope, steps, verification and risks. Updating invalidates previous approval.', parameters: { type: 'object', properties: { title: { type: 'string' }, plan: { type: 'string' } }, required: ['title', 'plan'] }, execute: async (_id, input) => {
      if (!input.plan?.trim() || input.plan.length > 32_000) throw new Error('Plan must contain 1–32,000 characters');
      const previous = (await stateController.read()).plan;
      const plan = await publish({ title: String(input.title).slice(0, 200), plan: input.plan, revision: (previous?.revision || 0) + 1, status: 'draft', updatedAt: nowIso() });
      mode.value = 'plan';
      emit('plan_mode_entered', sessionId, { runId });
      return textToolResult(plan);
    } },
    { name: 'exit_plan_mode', label: 'Approve plan', description: 'Submit the current formal plan to the user. Only explicit approval exits Plan mode into Ask mode; no blanket permission to run tools.', parameters: { type: 'object', properties: {} }, executionMode: 'sequential', execute: async (toolCallId, _input, signal) => {
      if (options.disableInteractions) throw new Error('This background run cannot request plan approval');
      const plan = (await stateController.read()).plan;
      if (!plan?.plan) throw new Error('Write a formal plan with plan_update first');
      await publish({ ...plan, status: 'pending_approval' });
      const decision = await waitForToolApproval({ ...options, toolCallId, toolName: 'exit_plan_mode', input: plan, signal, eventName: 'interaction_requested', timeoutMs: options.approvalTimeoutMs });
      await publish({ ...plan, status: decision.allow ? 'approved' : 'rejected', approvedAt: decision.allow ? nowIso() : null });
      if (!decision.allow) return textToolResult({ approved: false, plan: plan.plan, message: 'Remain in Plan mode. Revise the plan or ask the user.' });
      mode.value = 'ask';
      emit('permission_mode_changed', sessionId, { runId, permissionMode: 'ask' });
      activeSession?.setActiveToolsByName([...new Set([...activeSession.getActiveToolNames(), ...WRITE_TOOLS])]);
      return textToolResult({ approved: true, plan: plan.plan, permissionMode: 'ask', message: 'Plan approved. Individual write/terminal/integration actions still require approval.' });
    } },
  ];
}

function createDeferredTools(targets, options) {
  const catalogue = targets.map((tool) => `${tool.name}: ${tool.description.slice(0, 150)}`).join('\n');
  const find = (name) => { const target = targets.find((tool) => tool.name === name); if (!target) throw new Error('Unknown deferred tool. Use tool_search first.'); return target; };
  return [
    { name: 'tool_search', label: 'Find tools', description: `Discover optional runtime, browser, automation, integration and MCP tools. Search then describe/call an exact tool name.\n${catalogue}`, parameters: { type: 'object', properties: { query: { type: 'string' } } }, execute: async (_id, input) => textToolResult(targets.filter((tool) => `${tool.name} ${tool.description}`.toLowerCase().includes(String(input.query || '').toLowerCase())).slice(0, 30).map(({ name, description }) => ({ name, description }))) },
    { name: 'tool_describe', label: 'Load tool', description: 'Load an optional tool schema by exact name. The tool becomes directly callable for this run.', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, execute: async (_id, input) => {
      const target = find(input.name);
      activeSession?.setActiveToolsByName([...new Set([...activeSession.getActiveToolNames(), target.name])]);
      return textToolResult({ name: target.name, description: target.description, parameters: target.parameters });
    } },
    { name: 'tool_call', label: 'Call loaded tool', description: 'Invoke an optional tool by exact name using its documented arguments. All normal permission checks still apply.', parameters: { type: 'object', properties: { name: { type: 'string' }, arguments: { type: 'object', additionalProperties: true } }, required: ['name', 'arguments'] }, execute: async (id, input, signal, onUpdate) => {
      const target = find(input.name);
      const { Value } = await import('typebox/value');
      if (!Value.Check(target.parameters, input.arguments)) throw new Error('Arguments do not match the tool schema. Use tool_describe and correct the input.');
      const nestedId = id;
      gatewayInvocations.set(id, { name: target.name, input: input.arguments });
      await options.stateController.updateToolCall(nestedId, { runId: options.runId, toolName: target.name, input: input.arguments, status: 'running' });
      try {
        const result = await target.execute(nestedId, input.arguments, signal, onUpdate);
        const output = normalizeToolOutput(result);
        await options.stateController.updateToolCall(nestedId, { status: 'completed', output: output.slice(0, 64_000) }).catch(() => {});
        return result;
      } catch (error) {
        if (!startedToolCalls.has(id)) emit('tool_started', options.sessionId, { runId: options.runId, toolCallId: id, toolName: 'tool_call', input });
        await options.stateController.updateToolCall(nestedId, { status: 'failed', output: error.message, isError: true });
        throw error;
      }
    } },
  ];
}

function createCoordinationTools(options) {
  const {
    sessionId,
    runId,
    approvalTimeoutMs,
    stateController,
    disableSubagents = false,
    disableInteractions = false,
  } = options;
  const tools = [
    {
      name: 'ask_user',
      label: 'Ask user',
      description: 'Ask the user one to three concise questions when their input is required to continue. Each question should include two or three choices when possible. If no answer is received, do not repeat the same question immediately or treat silence as confirmation; state what remains unconfirmed and pause any work that requires it.',
      parameters: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: {
              type: 'object',
              properties: {
                header: { type: 'string' },
                question: { type: 'string' },
                multiSelect: { type: 'boolean' },
                options: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string' },
                      description: { type: 'string' },
                    },
                    required: ['label'],
                  },
                },
              },
              required: ['question', 'options'],
            },
          },
        },
        required: ['questions'],
      },
      executionMode: 'sequential',
      execute: async (toolCallId, params, signal) => {
        const decision = await waitForToolApproval({
          sessionId,
          runId,
          toolCallId,
          toolName: 'ask_user',
          input: params,
          signal,
          timeoutMs: approvalTimeoutMs,
          eventName: 'interaction_requested',
          stateController,
        });
        if (signal?.aborted || decision.reason === 'aborted') {
          throw Object.assign(new Error('The interaction was aborted.'), {
            code: 'PI_TURN_ABORTED',
          });
        }
        const answers = decision.allow && isRecord(decision.updatedInput?.answers)
          ? decision.updatedInput.answers
          : {};
        const pairs = Object.entries(answers).filter(([, answer]) => String(answer ?? '').trim()).map(([question, answer]) => (
          `${JSON.stringify(String(question))}=${JSON.stringify(String(answer))}`
        ));
        if (pairs.length === 0) {
          const reason = decision.reason || (decision.allow ? 'skipped' : 'declined');
          return textToolResult(
            `No user answer was received (${reason}). This is not confirmation or authorization. Do not invent missing facts or immediately repeat the same question. Continue only work that does not require the missing answer. Otherwise, explain what remains unconfirmed, optionally offer a clearly tentative proposal for review, and pause the dependent work.`,
            { status: 'unanswered', reason, answers: {} },
          );
        }
        return textToolResult(
          `User has answered your questions: ${pairs.join(', ')}. You can now continue with the user's answers in mind. Any unanswered questions remain unconfirmed.`,
          { status: 'answered', answers },
        );
      },
    },
    {
      name: 'todo_read',
      label: 'Read todos',
      description: 'Read the current persistent todo list for this agent session.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      executionMode: 'sequential',
      execute: async () => textToolResult((await stateController.read()).todos),
    },
    {
      name: 'todo_write',
      label: 'Update todos',
      description: 'Replace the persistent todo list. Use in_progress for at most one current item.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                content: { type: 'string' },
                activeForm: { type: 'string' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
              },
              required: ['content', 'status'],
            },
          },
        },
        required: ['todos'],
      },
      executionMode: 'sequential',
      execute: async (toolCallId, params) => {
        const state = await stateController.replaceTodos(Array.isArray(params?.todos) ? params.todos : []);
        emit('todo_snapshot', sessionId, { runId, toolCallId, todos: state.todos });
        return textToolResult({ todos: state.todos });
      },
    },
    {
      name: 'task_create',
      label: 'Create task',
      description: 'Create a persistent task that can be tracked independently from the current turn.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['queued', 'running', 'waiting_on_user', 'blocked', 'completed', 'failed', 'scheduled'] },
          schedule: { type: 'string' },
        },
        required: ['title'],
      },
      executionMode: 'sequential',
      execute: async (toolCallId, params) => {
        const taskId = `task-${crypto.randomUUID()}`;
        const task = await stateController.upsertTask(taskId, {
          runId,
          sessionId,
          toolCallId,
          runtimeId: 'pi',
          title: String(params?.title || 'Agent task').slice(0, 500),
          description: String(params?.description || '').slice(0, 8_000),
          status: params?.status || (params?.schedule ? 'scheduled' : 'queued'),
          schedule: typeof params?.schedule === 'string' ? params.schedule.slice(0, 1_000) : null,
        });
        emit('task_created', sessionId, { runId, toolCallId, task });
        return textToolResult(task);
      },
    },
    {
      name: 'task_update',
      label: 'Update task',
      description: 'Update the state or details of a persistent task.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['queued', 'running', 'waiting_on_user', 'blocked', 'completed', 'failed', 'scheduled', 'cancelled'] },
          result: { type: 'string' },
        },
        required: ['task_id'],
      },
      executionMode: 'sequential',
      execute: async (toolCallId, params) => {
        const existing = (await stateController.read()).tasks.find((entry) => String(entry.id) === String(params.task_id));
        if (!existing) throw new Error('Task not found');
        if (existing.background && (params.status !== undefined || params.result !== undefined)) {
          throw new Error('Background task status and results are managed by the runtime. Use task_get to inspect it or the task panel to cancel or retry.');
        }
        const task = await stateController.upsertTask(params.task_id, {
          ...(typeof params.title === 'string' ? { title: params.title.slice(0, 500) } : {}),
          ...(typeof params.description === 'string' ? { description: params.description.slice(0, 8_000) } : {}),
          ...(typeof params.status === 'string' ? { status: params.status } : {}),
          ...(typeof params.result === 'string' ? { result: params.result.slice(0, 32_000) } : {}),
          ...(params.status === 'completed' ? { completedAt: nowIso() } : {}),
        });
        emit('task_updated', sessionId, { runId, toolCallId, task });
        return textToolResult(task);
      },
    },
    {
      name: 'task_list',
      label: 'List tasks',
      description: 'List persistent tasks for the current agent session.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      executionMode: 'sequential',
      execute: async () => textToolResult((await stateController.read()).tasks),
    },
    {
      name: 'task_get',
      label: 'Get task',
      description: 'Get one persistent task by id.',
      parameters: {
        type: 'object',
        properties: { task_id: { type: 'string' } },
        required: ['task_id'],
      },
      executionMode: 'sequential',
      execute: async (toolCallId, params) => {
        const task = (await stateController.read()).tasks.find((entry) => String(entry.id) === String(params.task_id));
        return textToolResult(task || { error: 'Task not found', task_id: params.task_id });
      },
    },
  ];

  if (!disableSubagents) {
    tools.push({
      name: 'task',
      label: 'Delegate task',
      description: 'Delegate a read-only task. Omit run_in_background or set true for independent work; false waits up to 180 seconds by default. Set timeout_ms from 1000 to 300000 (1–300 seconds) to override. A timeout returns available partial results marked incomplete. Subagents cannot ask questions, write or delegate again.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          prompt: { type: 'string' },
          subagent_type: { type: 'string', enum: ['general-purpose', 'explore', 'research'] },
          run_in_background: { type: 'boolean' },
          timeout_ms: { type: 'integer', minimum: 1000, maximum: 300000, description: 'Foreground timeout in milliseconds; default 180000, range 1000–300000.' },
        },
        required: ['description', 'prompt'],
      },
      executionMode: 'sequential',
      execute: async (toolCallId, params, signal) => {
        piSubagentProfile(params.subagent_type || 'general-purpose');
        const taskId = `task-${crypto.randomUUID()}`;
        const childSessionId = crypto.randomUUID();
        const task = await stateController.upsertTask(taskId, {
          runId,
          sessionId,
          toolCallId,
          runtimeId: 'pi',
          childSessionId,
          title: String(params.description || 'Background task').slice(0, 500),
          description: String(params.prompt || '').slice(0, 16_000),
          subagentType: String(params.subagent_type || 'general-purpose').slice(0, 200),
          background: params.run_in_background !== false,
          status: 'queued',
        });
        emit('task_created', sessionId, { runId, toolCallId, task });
        const runningTask = await stateController.upsertTask(taskId, {
          status: 'running',
          startedAt: nowIso(),
        });
        emit('task_updated', sessionId, { runId, toolCallId, task: runningTask });
        if (params.run_in_background === false) {
          const timeoutMs = Math.min(300000, Math.max(1000, Number(params.timeout_ms) || 180000));
          const outcome = await requestRuntimeService('task', { task: runningTask, timeoutMs }, { ...options, timeoutMs: timeoutMs + 10000 }, toolCallId, signal, 'foreground_task_requested');
          if (outcome.status !== 'completed') throw new Error(`Subagent ${outcome.status}: ${outcome.error?.message || ''}\nPartial results (incomplete): ${outcome.result || 'No results received before interruption.'}`);
          return textToolResult({ task_id: taskId, child_session_id: childSessionId, status: outcome.status, result: outcome.result });
        }
        emit('background_task_requested', sessionId, {
          runId,
          toolCallId,
          task: runningTask,
          taskId,
          childSessionId,
          prompt: String(params.prompt || ''),
        });
        return textToolResult({
          task_id: taskId,
          child_session_id: childSessionId,
          status: 'running',
          message: 'The background subagent task is running. Use task_get or task_list to inspect it later.',
        });
      },
    });
  }
  return disableInteractions ? tools.filter((tool) => tool.name !== 'ask_user') : tools;
}

function createProjectTools(projectRoot, options) {
  const {
    permissionMode,
    sessionId,
    runId,
    approvalTimeoutMs,
    trustedReadRoots = [],
    stateController,
  } = options;
  const readOnlyTools = [...sdk.createReadOnlyTools(projectRoot), createSystemInfoTool(projectRoot)];
  const tools = [
        ...readOnlyTools,
        sdk.createWriteTool(projectRoot),
        sdk.createEditTool(projectRoot),
        sdk.createBashTool(projectRoot, {
          operations: createRestrictedBashOperations(projectRoot),
          exposeSessionEnvironment: false,
        }),
      ];
  return tools.map((tool) => ({
    ...tool,
    parameters: tool.name === 'bash' ? {
      ...tool.parameters,
      properties: { ...tool.parameters.properties, timeout: { ...tool.parameters.properties.timeout, description: 'Timeout in milliseconds (default 60000, maximum 120000).' } },
    } : tool.parameters,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const effectiveMode = options.mode?.value || permissionMode;
      const authorizedParams = await authorizeToolParams(
        projectRoot,
        tool.name,
        params,
        effectiveMode,
        trustedReadRoots,
      );
      emit('tool_started', sessionId, {
        runId,
        toolCallId,
        toolName: tool.name,
        input: publicToolInput(projectRoot, authorizedParams),
      });
      if (WRITE_TOOLS.includes(tool.name) && effectiveMode === 'ask') {
        const decision = await waitForToolApproval({
          sessionId,
          runId,
          toolCallId,
          toolName: tool.name,
          input: publicToolInput(projectRoot, authorizedParams),
          signal,
          timeoutMs: approvalTimeoutMs,
          stateController,
        });
        if (!decision.allow) {
          throw Object.assign(new Error(
            decision.reason === 'timeout'
              ? 'Tool approval timed out.'
              : 'Tool use was denied.',
          ), { code: 'PI_TOOL_PERMISSION_DENIED' });
        }
      }
      let result;
      if (tool.name === 'bash') {
        const capture = await options.outputBudget.openCapture();
        let error, exitCode;
        let preview = '';
        try {
          ({ exitCode } = await createRestrictedBashOperations(projectRoot).exec(authorizedParams.command, projectRoot, { signal, timeout: authorizedParams.timeout, onData: async (data) => {
            await capture.handle.write(data);
            preview = `${preview}${data.toString('utf8')}`.slice(-12000);
            onUpdate?.(textToolResult(preview));
          } }));
        } catch (cause) { error = cause; }
        finally { await capture.handle.close(); }
        result = await options.outputBudget.consumeFile(capture.path, {}, true);
        if (error || exitCode !== 0) throw new Error(`${normalizeToolOutput(result)}\n${error?.message || `Command exited with code ${exitCode}`}`);
      } else if (tool.name === 'read' && !IMAGE_MIME_BY_EXTENSION[path.extname(authorizedParams.path).toLowerCase()]) {
        let textPath = authorizedParams.path;
        let documentTextPath;
        if (['.pdf', '.docx', '.xlsx', '.pptx'].includes(path.extname(textPath).toLowerCase())) {
          const extracted = await requestRuntimeService('document', { path: textPath }, options, toolCallId, signal, 'host_resource_requested');
          textPath = await fs.realpath(extracted.path);
          if (!isInsideProject(projectRoot, textPath)) throw new Error('Extracted document escaped project');
          documentTextPath = textPath;
        }
        const capture = await options.outputBudget.openCapture();
        const stream = createReadStream(textPath, { signal });
        const lines = createInterface({ input: stream, crlfDelay: Infinity });
        let line = 0;
        const start = Math.max(1, Number(authorizedParams.offset) || 1);
        const end = authorizedParams.limit ? start + Math.max(1, Number(authorizedParams.limit)) : Infinity;
        try {
          for await (const text of lines) {
            line++;
            if (line >= end) break;
            if (line >= start) await capture.handle.write(`${text}\n`);
          }
        } finally {
          lines.close(); stream.destroy();
          await capture.handle.close();
          if (documentTextPath) await fs.unlink(documentTextPath).catch(() => {});
        }
        result = await options.outputBudget.consumeFile(capture.path, {}, true);
      } else result = await tool.execute(toolCallId, authorizedParams, signal, onUpdate);
      if (READ_ONLY_TOOLS.includes(tool.name) && tool.name !== 'system_info') {
        try {
          const contextItem = await stateController.addContextItem({
            runId,
            sessionId,
            type: tool.name,
            toolCallId,
            path: publicToolInput(projectRoot, authorizedParams).path || null,
            query: authorizedParams.pattern || authorizedParams.query || null,
          });
          emit('context_item_added', sessionId, { runId, toolCallId, contextItem });
        } catch (error) {
          emit('runtime_diagnostic', sessionId, {
            component: 'agent_state',
            code: 'context_persistence_failed',
            message: String(error?.message || error).slice(0, 500),
          });
        }
      } else if (['write', 'edit'].includes(tool.name)) {
        try {
          const publicInput = publicToolInput(projectRoot, authorizedParams);
          const artifact = await stateController.addArtifact({
            runId,
            sessionId,
            kind: 'file',
            toolCallId,
            path: publicInput.path || null,
            operation: tool.name,
          });
          emit('artifact_created', sessionId, { runId, toolCallId, ...artifact });
        } catch (error) {
          emit('runtime_diagnostic', sessionId, {
            component: 'agent_state',
            code: 'artifact_persistence_failed',
            message: String(error?.message || error).slice(0, 500),
          });
        }
      }
      return result;
    },
  }));
}

function displayContextUsage(session) {
  const context = session?.getContextUsage?.();
  if (!context) return null;
  if (Number.isFinite(context.tokens) && context.tokens >= 0) return context;
  // The SDK deliberately returns null just after compaction: pre-compaction
  // assistant usage is no longer valid. Estimate only the retained messages,
  // not cumulative billing tokens, and keep this out of compaction decisions.
  if (!(context.contextWindow > 0) || !Array.isArray(session.messages) || typeof sdk.estimateTokens !== 'function') return context;
  const tokens = session.messages.reduce((total, message) => total + sdk.estimateTokens(message), 0)
    + Math.ceil(String(session.systemPrompt || '').length / 4);
  return { ...context, tokens, percent: tokens / context.contextWindow * 100, estimated: true };
}

function forwardSessionEvent(event, sessionId, runId, stateController) {
  if (event.type === 'message_start' && event.message?.role === 'assistant') {
    activeAssistantMessageId = crypto.randomUUID();
    emit('assistant_message_start', sessionId, { messageId: activeAssistantMessageId });
    return;
  }
  if (event.type === 'tool_execution_update') {
    emit('tool_updated', sessionId, { runId, toolCallId: event.toolCallId,
      toolName: gatewayInvocations.get(event.toolCallId)?.name || event.toolName,
      output: normalizeToolOutput(event.partialResult).slice(-64_000) });
    return;
  }
  if (['auto_retry_start', 'auto_retry_end'].includes(event.type)) {
    emit(event.type, sessionId, { runId, messageId: activeAssistantMessageId, attempt: event.attempt, maxAttempts: event.maxAttempts,
      delayMs: event.delayMs, success: event.success, error: String(event.errorMessage || event.finalError || '').slice(0, 1000) });
    return;
  }
  if (event.type === 'compaction_start' || event.type === 'compaction_end') {
    emit(event.type === 'compaction_start' ? 'auto_compaction_start' : 'auto_compaction_end', sessionId,
      { runId, reason: event.reason, success: !event.aborted && !event.errorMessage, error: event.errorMessage,
        context: displayContextUsage(activeSession) });
    return;
  }
  if (event.type === 'message_update') {
    const update = event.assistantMessageEvent;
    if (update?.type === 'text_delta' && update.delta) {
      emit('text_delta', sessionId, { text: update.delta, messageId: activeAssistantMessageId });
    } else if (update?.type === 'thinking_delta' && update.delta) {
      emit('thinking_delta', sessionId, { text: update.delta, status: 'active', messageId: activeAssistantMessageId });
    }
    return;
  }
  if (event.type === 'tool_execution_start') {
    stateController?.updateToolCall(event.toolCallId, {
      runId,
      sessionId,
      toolName: event.toolName || 'unknown',
      input: isRecord(event.args) ? event.args : (isRecord(event.input) ? event.input : {}),
      status: 'running',
      startedAt: nowIso(),
    }).catch(() => {});
    return;
  }
  if (event.type === 'tool_execution_end') {
    const toolName = gatewayInvocations.get(event.toolCallId)?.name || event.toolName;
    stateController?.updateToolCall(event.toolCallId, {
      runId,
      sessionId,
      toolName: toolName || 'unknown',
      status: event.isError ? 'failed' : 'completed',
      output: normalizeToolOutput(event.result).slice(0, 64_000),
      isError: Boolean(event.isError),
      completedAt: nowIso(),
    }).catch(() => {});
    emit('tool_completed', sessionId, {
      runId,
      toolCallId: event.toolCallId,
      toolName,
      output: normalizeToolOutput(event.result),
      isError: Boolean(event.isError),
    });
    return;
  }
  if (event.type === 'message_end' && event.message?.role === 'assistant' && event.message.usage) {
    const context = displayContextUsage(activeSession);
    emit('usage', sessionId, { ...event.message.usage, context, model: event.message.model });
    if (!['error', 'aborted'].includes(event.message.stopReason)) {
      stateController?.updateRun(runId, { usage: { tokens: event.message.usage, context, model: event.message.model } }).catch(() => {});
    }
  }
}

function updateAssistantFailureState(event, state) {
  if (!['message_end', 'turn_end'].includes(event?.type)) return;
  const message = event?.message;
  if (!message || message.role !== 'assistant') return;
  const stopReason = typeof message.stopReason === 'string'
    ? message.stopReason.trim().toLowerCase()
    : '';
  if (stopReason === 'error' || stopReason === 'aborted') {
    state.failure = {
      stopReason,
      message: typeof message.errorMessage === 'string' && message.errorMessage.trim()
        ? message.errorMessage.trim()
        : `Assistant message ended with stop reason ${stopReason}.`,
    };
    return;
  }
  state.failure = null;
}

async function createSession(params, resume) {
  const sessionPath = path.resolve(params.sessionPath);
  const cwd = await fs.realpath(path.resolve(params.projectRoot));
  const sessionId = String(params.sessionId || crypto.randomUUID());
  const runId = String(params.turnId || crypto.randomUUID());
  const stateController = createAgentStateController({ ...params, sessionId });
  const permissionMode = normalizePermissionMode(params.permissionMode);
  const mode = { value: permissionMode };
  const subagentProfile = params.subagentType ? piSubagentProfile(params.subagentType) : null;
  const enabledTools = permissionMode === 'ask' || permissionMode === 'auto'
    ? [...READ_ONLY_TOOLS, ...WRITE_TOOLS]
    : READ_ONLY_TOOLS;
  const approvalTimeoutMs = Number.isFinite(params.approvalTimeoutMs) && params.approvalTimeoutMs > 0
    ? Math.min(Math.floor(params.approvalTimeoutMs), 120_000)
    : 120_000;
  const rawConfigDir = process.env.PI_CONFIG_DIR || params.configDir;
  if (typeof rawConfigDir !== 'string' || !rawConfigDir.trim()) {
    throw new Error('PI_CONFIG_DIR is required.');
  }
  const configDir = path.resolve(rawConfigDir);
  if (!resume) await ensureNewSessionFile(sessionPath, sessionId, cwd);
  else await fs.access(sessionPath);
  const sessionManager = sdk.SessionManager.open(sessionPath, path.dirname(sessionPath), cwd);
  // A persisted compaction also resets accounting after a crash before its reset marker was saved.
  const previousBudget = [...sessionManager.getEntries()].reverse().find((entry) => entry.type === 'compaction' || entry.type === 'custom' && entry.customType === 'medhelp.output_budget');
  const outputBudget = createToolOutputBudget({ projectRoot: cwd, sessionId, usedBytes: Number(previousBudget?.data?.usedBytes) || 0, recordUsage: (data) => sessionManager.appendCustomEntry('medhelp.output_budget', data) });

  const resourceProjection = await readResourceProjection(configDir);
  const mcpResources = await createMcpTools(resourceProjection.mcpServers, {
    permissionMode,
    mode,
    sessionId,
    runId,
    approvalTimeoutMs,
    projectRoot: cwd,
    stateController,
  });
  if (mcpResources.diagnostics.length > 0) {
    emit('runtime_diagnostic', sessionId, {
      component: 'mcp',
      diagnostics: mcpResources.diagnostics.map(({ server, code }) => ({ server, code })),
    });
  }
  const serviceDefinitions = Array.isArray(params.serviceTools) ? params.serviceTools.slice(0, 64) : [];
  const serviceOptions = { mode, sessionId, runId, approvalTimeoutMs, stateController, disableInteractions: params.disableInteractions === true };
  const serviceTools = createRuntimeServiceTools(subagentProfile ? serviceDefinitions.filter((definition) => !definition.mutation && subagentProfile.tools.includes(definition.name)) : serviceDefinitions, serviceOptions);
  const deferredTargets = [...serviceTools, ...mcpResources.tools];
  const gatewayTools = deferredTargets.length ? createDeferredTools(deferredTargets, serviceOptions) : [];
  const planTools = createPlanTools(serviceOptions);
  let customTools = [
    ...createProjectTools(cwd, {
      permissionMode,
      mode,
      sessionId,
      runId,
      approvalTimeoutMs,
      trustedReadRoots: resourceProjection.trustedSkillRoots,
      outputBudget,
      stateController,
    }),
    ...[...createCoordinationTools({
      sessionId,
      runId,
      approvalTimeoutMs,
      stateController,
      disableSubagents: params.disableSubagents === true,
      disableInteractions: params.disableInteractions === true,
    }), ...planTools, ...gatewayTools].map((tool) => ({
      ...tool,
      execute: async (toolCallId, input, signal, onUpdate) => {
        if (tool.name !== 'tool_call') emit('tool_started', sessionId, { runId, toolCallId, toolName: tool.name, input });
        try { return await tool.execute(toolCallId, input, signal, onUpdate); }
        catch (error) {
          if (tool.name === 'tool_call' && !startedToolCalls.has(toolCallId)) emit('tool_started', sessionId, { runId, toolCallId, toolName: tool.name, input });
          throw error;
        }
      },
    })),
    ...deferredTargets,
  ].map((tool) => ({ ...tool, execute: async (...args) => {
    try { return await outputBudget.apply(await tool.execute(...args)); }
    catch (error) {
      const bounded = await outputBudget.apply(textToolResult(error.message));
      throw Object.assign(new Error(normalizeToolOutput(bounded)), { code: error.code });
    }
  } }));
  const coordinationToolNames = params.disableSubagents === true
    ? COORDINATION_TOOLS.filter((toolName) => toolName !== 'task')
    : COORDINATION_TOOLS;
  const enabledCoordinationToolNames = params.disableInteractions === true
    ? coordinationToolNames.filter((toolName) => toolName !== 'ask_user')
    : coordinationToolNames;
  let activeToolNames = [
    ...enabledTools,
    ...enabledCoordinationToolNames,
    ...planTools.map((tool) => tool.name),
    ...gatewayTools.map((tool) => tool.name),
  ];
  if (subagentProfile) {
    const allowed = new Set([...subagentProfile.tools, ...gatewayTools.map((tool) => tool.name)]);
    customTools = customTools.filter((tool) => allowed.has(tool.name));
    activeToolNames = activeToolNames.filter((name) => allowed.has(name));
  }

  try {
    const settingsManager = sdk.SettingsManager.inMemory({
      defaultProvider: params.sdkProviderId,
      defaultModel: params.modelId,
      defaultTools: activeToolNames,
      enableSkillCommands: false,
      compaction: { enabled: true },
    });
    const resourceLoader = new sdk.DefaultResourceLoader({
      cwd,
      agentDir: configDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      additionalSkillPaths: resourceProjection.skillPaths,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      agentsFilesOverride: () => ({ agentsFiles: [] }),
      systemPromptOverride: () => undefined,
      appendSystemPromptOverride: () => (
        typeof params.projectContextPrompt === 'string' && params.projectContextPrompt.trim()
          ? [params.projectContextPrompt]
          : []
      ),
    });
    await resourceLoader.reload();
    const modelRuntime = await sdk.ModelRuntime.create({
      authPath: path.join(configDir, 'auth.json'),
      modelsPath: path.join(configDir, 'models.json'),
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    const model = modelRuntime.getModel(params.sdkProviderId, params.modelId);
    if (!model) {
      throw Object.assign(new Error(`Pi model ${params.sdkProviderId}/${params.modelId} is unavailable.`), {
        code: 'PI_MODEL_NOT_FOUND',
      });
    }
    const result = await sdk.createAgentSession({
      cwd,
      agentDir: configDir,
      modelRuntime,
      model,
      thinkingLevel: normalizeReasoningLevel(params.reasoningLevel),
      // SDK `tools` is a registration allowlist, not merely the active set.
      // Register guarded tools now, then expose only the compact active catalogue.
      tools: customTools.map((tool) => tool.name),
      excludeTools: ['powershell'],
      customTools,
      resourceLoader,
      sessionManager,
      settingsManager,
    });
    result.session.setActiveToolsByName(activeToolNames);
    let pendingBudgetReset = Promise.resolve();
    const unsubscribeBudget = result.session.subscribe((event) => {
      if (event.type !== 'compaction_end' || !event.result || event.aborted || event.errorMessage) return;
      // Applies to RPC compact, SDK automatic compaction/retry, and the post-turn threshold path.
      pendingBudgetReset = outputBudget.resetAfterCompaction();
      pendingBudgetReset.catch(() => {}); // Awaited by callers before finishing/disposal.
    });
    const transformContext = result.session.agent.transformContext;
    result.session.agent.transformContext = async (messages, signal) => {
      const transformed = transformContext ? await transformContext(messages, signal) : messages;
      let bytes = 0, count = 0;
      const maxBytes = positiveLimit(process.env.MEDHELP_PI_IMAGE_CONTEXT_BYTES, 20 * 1024 * 1024, 64 * 1024 * 1024);
      const maxCount = positiveLimit(process.env.MEDHELP_PI_IMAGE_CONTEXT_COUNT, 8, 100);
      // Keep the original append-only session intact. Only its model-facing transcript loses old images.
      return [...transformed].reverse().map((message) => !Array.isArray(message.content) ? message : ({ ...message, content: [...message.content].reverse().map((part) => {
        if (part.type !== 'image') return part;
        const size = Buffer.byteLength(part.data || '', 'base64');
        if (bytes + size > maxBytes || count >= maxCount) return { type: 'text', text: '[Earlier image omitted from model context to respect the image budget; read the original project file again if needed.]' };
        bytes += size; count++; return part;
      }).reverse() })).reverse();
    };
    return {
      session: result.session,
      sessionManager,
      sessionId,
      runId,
      model,
      projectRoot: cwd,
      stateController,
      flushOutputBudget: () => pendingBudgetReset,
      disposeResources: async () => { unsubscribeBudget(); try { await pendingBudgetReset; } finally { await closeMcpConnections(mcpResources.connections); } },
    };
  } catch (error) {
    await closeMcpConnections(mcpResources.connections);
    throw error;
  }
}

async function runPrompt(request, resume) {
  if (activeSession) {
    reject(request.id, 'AGENT_TURN_ALREADY_ACTIVE', 'A Pi turn is already active.');
    return;
  }
  const params = request.params || {};
  let unsubscribe = null;
  let disposeResources = null;
  let stateController = null;
  let runId = String(params.turnId || crypto.randomUUID());
  const assistantState = { failure: null };
  try {
    const created = await createSession(params, resume);
    stateController = created.stateController;
    runId = created.runId;
    await stateController.updateRun(runId, {
      sessionId: created.sessionId,
      runtimeId: 'pi',
      provider: 'pi',
      model: { modelId: params.modelId, modelProviderId: params.modelProviderId, modelApi: params.modelApi },
      ...(typeof params.runTitle === 'string' ? { title: params.runTitle.slice(0, 500) } : {}),
      status: 'running',
      resumed: resume,
      startedAt: nowIso(),
    });
    disposeResources = created.disposeResources;
    activeSession = created.session;
    promptAbortController = new AbortController();
    activeRequestId = request.id;
    lastSessionId = created.sessionId;
    unsubscribe = activeSession.subscribe((event) => {
      updateAssistantFailureState(event, assistantState);
      forwardSessionEvent(event, created.sessionId, runId, stateController);
    });
    emit('session_started', created.sessionId, { resumed: resume, runId });
    const { content: promptContent, delivery } = await buildPromptContent(
      params.prompt,
      params.attachments,
      created.projectRoot,
      created.model,
      { sessionId: created.sessionId },
      promptAbortController.signal,
    );
    if (delivery.length) {
      created.sessionManager.appendCustomEntry('medhelp.attachment_delivery', { runId, attachments: delivery });
      emit('attachment_delivery', created.sessionId, { runId, attachments: delivery });
    }
    if (Array.isArray(promptContent) && typeof activeSession.sendUserMessage === 'function') {
      await activeSession.sendUserMessage(promptContent);
    } else {
      await activeSession.prompt(String(promptContent || ''), { expandPromptTemplates: false });
    }
    const retryableSession = activeSession;
    const waitForPiRetry = async () => {
      if (retryableSession.isRetrying && typeof retryableSession.waitForRetry === 'function') {
        await retryableSession.waitForRetry().catch(() => {});
      }
    };
    await waitForPiRetry();
    if (assistantState.failure) {
      // Pi schedules transient stream retries with setTimeout(..., 0) after
      // agent_end. Let that retry materialize before deciding the turn failed.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await waitForPiRetry();
    }
    if (assistantState.failure) {
      const failure = assistantState.failure;
      throw Object.assign(new Error(failure.message), {
        code: failure.stopReason === 'aborted' ? 'PI_TURN_ABORTED' : 'PI_PROVIDER_UPSTREAM_ERROR',
      });
    }
    const contextUsage = activeSession.getContextUsage?.() || null;
    const contextTokens = Number(contextUsage?.tokens);
    const contextWindow = Number(contextUsage?.contextWindow);
    if (
      typeof activeSession.compact === 'function'
      && !activeSession.isCompacting
      && Number.isFinite(contextTokens)
      && Number.isFinite(contextWindow)
      && contextWindow > 0
      && contextTokens > contextWindow * 0.5
    ) {
      try {
        await activeSession.compact();
      } catch (error) {
        emit('auto_compaction_end', created.sessionId, {
          success: false,
          error: String(error?.message || error).slice(0, 500),
        });
      }
    }
    await created.flushOutputBudget();
    const stats = activeSession.getSessionStats();
    const displayContext = displayContextUsage(activeSession);
    emit('usage', created.sessionId, {
      input: stats.tokens.input,
      output: stats.tokens.output,
      cacheRead: stats.tokens.cacheRead,
      cacheWrite: stats.tokens.cacheWrite,
      totalTokens: stats.tokens.total,
      context: displayContext,
      model: params.modelId,
    });
    await stateController.updateRun(runId, { status: 'completed', completedAt: nowIso(), usage: { tokens: stats.tokens, context: displayContext, model: params.modelId } });
    emit('turn_completed', created.sessionId, { status: 'completed', runId });
    respond(request.id, { sessionId: created.sessionId, status: 'completed', usage: stats.tokens });
  } catch (error) {
    await stateController?.updateRun(runId, {
      status: error?.code === 'PI_TURN_ABORTED' ? 'cancelled' : 'failed',
      completedAt: nowIso(),
      error: { code: error?.code || errorCode(error), message: String(error?.message || error).slice(0, 2_000) },
    }).catch(() => {});
    reject(request.id, error?.code || errorCode(error), error?.message || 'Pi turn failed.');
  } finally {
    cancelPendingToolApprovals('turn_completed');
    for (const settle of [...pendingServiceTools.values()]) settle(null, 'Turn completed');
    unsubscribe?.();
    activeSession?.dispose?.();
    await disposeResources?.();
    await stateController?.flush?.();
    gatewayInvocations.clear();
    startedToolCalls.clear();
    activeSession = null;
    activeRequestId = null;
  }
}

async function handleRequest(request) {
  if (!request || typeof request !== 'object' || typeof request.id !== 'string') return;
  if (request.method === 'initialize') return initialize(request);
  if (!sdk) return reject(request.id, 'PI_HOST_PROTOCOL_ERROR', 'Host is not initialized.');
  if (request.method === 'runtime_tool_result') {
    const settle = pendingServiceTools.get(request.params?.requestId);
    if (!settle) return respond(request.id, { accepted: false });
    settle(request.params.result, request.params.error);
    return respond(request.id, { accepted: true });
  }
  if (request.method === 'session_fork') {
    if (activeSession) return reject(request.id, 'AGENT_TURN_ALREADY_ACTIVE', 'Wait for the current turn before forking this conversation.');
    const params = request.params || {};
    const manager = sdk.SessionManager.open(params.sessionPath, path.dirname(params.sessionPath), params.projectRoot);
    if (manager.getSessionId() !== params.sessionId) throw new Error('Pi session identity does not match the fork request');
    const current = piSessionBranches(manager.getEntries(), params.sessionId);
    const point = current.messages.find((entry) => entry.id === params.entryId && entry.role === 'assistant');
    if (!point) throw new Error('Choose a completed Pi turn as the fork point');
    const sessionPath = manager.createBranchedSession(point.id);
    if (!sessionPath) throw new Error('Pi could not persist the forked conversation');
    return respond(request.id, { sessionId: manager.getSessionId(), sessionPath });
  }
  if (['branch_list', 'branch_create', 'branch_switch'].includes(request.method)) {
    if (activeSession) return reject(request.id, 'AGENT_TURN_ALREADY_ACTIVE', 'Wait for the current turn before changing branches.');
    const params = request.params || {};
    const manager = sdk.SessionManager.open(params.sessionPath, path.dirname(params.sessionPath), params.projectRoot);
    if (manager.getSessionId() !== params.sessionId) throw new Error('Pi session identity does not match the branch request');
    const current = piSessionBranches(manager.getEntries(), params.sessionId);
    if (request.method === 'branch_create') {
      if (!current.messages.some((entry) => entry.id === params.entryId)) throw new Error('Choose a complete user or assistant message in the active branch');
      const branchId = crypto.randomUUID();
      manager.branch(params.entryId);
      manager.appendCustomEntry('medhelp.branch', { action: 'create', branchId, parentBranchId: current.activeBranchId, fromEntryId: params.entryId, label: String(params.label || `分支 ${current.branches.length}`).slice(0, 100) });
    } else if (request.method === 'branch_switch') {
      const branch = current.branches.find((entry) => entry.id === params.branchId);
      if (!branch?.leafId) throw new Error('Unknown Pi branch');
      manager.branch(branch.leafId);
      manager.appendCustomEntry('medhelp.branch', { action: 'switch', branchId: branch.id });
    }
    return respond(request.id, piSessionBranches(manager.getEntries(), params.sessionId));
  }
  if (request.method === 'tool_approval') {
    const approvalId = typeof request.params?.approvalId === 'string'
      ? request.params.approvalId
      : '';
    const pending = pendingToolApprovals.get(approvalId);
    if (!pending) return respond(request.id, { accepted: false });
    pending.settle({
      allow: request.params?.allow === true,
      reason: request.params?.reason || null,
      updatedInput: isRecord(request.params?.updatedInput) ? request.params.updatedInput : null,
    });
    return respond(request.id, { accepted: true });
  }
  if (request.method === 'prompt' || request.method === 'resume') {
    await runPrompt(request, request.method === 'resume');
    return;
  }
  if (request.method === 'steer') {
    if (!activeSession) return respond(request.id, { accepted: false });
    await activeSession.steer(String(request.params?.prompt || ''));
    emit('steering_received', lastSessionId, { accepted: true });
    return respond(request.id, { accepted: true });
  }
  if (request.method === 'abort') {
    if (!activeSession) return respond(request.id, { aborted: false });
    cancelPendingToolApprovals('aborted');
    promptAbortController?.abort();
    await activeSession.abort();
    emit('turn_aborted', lastSessionId, { status: 'aborted' });
    respond(request.id, { aborted: true });
    if (activeRequestId) reject(activeRequestId, 'PI_TURN_ABORTED', 'Pi turn was aborted.');
    return;
  }
  if (request.method === 'get_state') {
    return respond(request.id, {
      state: activeSession ? 'running' : 'idle',
      sessionId: lastSessionId,
      protocolVersion: PROTOCOL_VERSION,
    });
  }
  if (request.method === 'compact') {
    const params = request.params || {};
    const created = await createSession(params, true);
    try {
      const result = await created.session.compact(params.instructions);
      await created.flushOutputBudget();
      return respond(request.id, {
        sessionId: created.sessionId,
        summary: result?.summary || null,
        tokensBefore: result?.tokensBefore || null,
        context: displayContextUsage(created.session),
      });
    } finally {
      created.session.dispose?.();
      await created.disposeResources?.();
    }
  }
  reject(request.id, 'PI_HOST_PROTOCOL_ERROR', `Unknown Pi RPC method "${request.method}".`);
}

let inputBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  inputBuffer += chunk;
  let newlineIndex;
  while ((newlineIndex = inputBuffer.indexOf('\n')) !== -1) {
    const line = inputBuffer.slice(0, newlineIndex).replace(/\r$/, '');
    inputBuffer = inputBuffer.slice(newlineIndex + 1);
    if (!line.trim()) continue;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      reject('invalid', 'PI_HOST_PROTOCOL_ERROR', 'Invalid JSON request.');
      continue;
    }
    Promise.resolve(handleRequest(request)).catch((error) => {
      reject(request.id, error?.code || errorCode(error), error?.message || 'Pi Host failed.');
    });
  }
});

process.stdin.once('end', async () => {
  cancelPendingToolApprovals('host_closed');
  try {
    await activeSession?.abort();
  } catch {}
  process.exit(0);
});
