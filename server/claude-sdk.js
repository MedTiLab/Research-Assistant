/**
 * Claude SDK Integration
 *
 * This module provides SDK-based integration with Claude using the @anthropic-ai/claude-agent-sdk.
 * It mirrors the interface of claude-cli.js but uses the SDK internally for better performance
 * and maintainability.
 *
 * Key features:
 * - Direct SDK integration without child processes
 * - Session management with abort capability
 * - Options mapping between CLI and SDK formats
 * - WebSocket message streaming
 */

import { forkSession as forkClaudeSdkSession, query } from '@anthropic-ai/claude-agent-sdk';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { CLAUDE_MODELS, getClaudeModelContextWindow } from '../shared/modelConstants.js';
import { classifyError, classifySDKError } from '../shared/errorClassifier.js';
import { encodeProjectPath, ensureProjectSkillLinks, reconcileClaudeSessionIndex } from './projects.js';
import { ensureClaudeSkillPlugin } from './utils/claudeSkillPlugin.js';
import { PROJECT_CLAUDE_RELATIVE_PATH, TEMPLATE_CLAUDE_PATH, writeProjectTemplates } from './templates/index.js';
import { applyStageTagsToSession, recordIndexedSession } from './utils/sessionIndex.js';
import { buildTempAttachmentFilename } from './utils/imageAttachmentFiles.js';
import { buildSessionDisplayName } from './utils/sessionFormatting.js';
import { prependUserPreferenceMemoryToPrompt } from './utils/userPreferenceMemory.js';
import { resolveClaudeCodeExecutableInfo } from './utils/claudeCodeExecutable.js';
import { withDatabaseApiAgentEnv } from './utils/databaseApiAgentEnv.js';
import {
  nextWithInactivityTimeout,
  resolveInactivityTimeoutMs,
} from './utils/streamInactivity.js';
import {
  AGENT_COMPUTE_MCP_SERVER_NAME,
  prependAgentComputeContext,
  resolveAgentComputeBridge,
} from './agent-compute-bridge.js';
import {
  WORKBENCH_MCP_SERVER_NAME,
  WORKBENCH_MUTATION_TOOL_NAMES,
  WORKBENCH_READ_TOOL_NAMES,
  prependWorkbenchContext,
  resolveWorkbenchBridge,
} from './workbench-bridge.js';

import { createRequestId, waitForToolApproval, resolveToolApproval as resolvePermApproval, matchesToolPermission } from './utils/permissions.js';

const activeSessions = new Map();
const activeSessionAliases = new Map();
const DEFAULT_CLAUDE_FIRST_MESSAGE_TIMEOUT_MS = 90_000;
const DEFAULT_CLAUDE_STREAM_IDLE_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_CLAUDE_INTERACTION_TIMEOUT_MS = 10 * 60_000;
const CLAUDE_EFFORT_LEVELS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const CLAUDE_SKILL_PLUGIN_HINT = [
  'MedHelp research skills are installed as native Claude Code skills via a plugin.',
  'Discover and invoke them through the built-in skill mechanism.',
  'Canonical MedHelp skill names use the `medhelp-` prefix.',
  'Treat matching `inno-` names in old project files, histories, or user settings as deprecated aliases:',
  'always invoke and recommend the corresponding `medhelp-` name instead',
  '(for example, use `medhelp-reference-audit`, never `inno-reference-audit`).',
  'Do not rely on reading `.claude/skills/<name>/SKILL.md` paths inside the project -',
  'those files are intentionally absent from the customer workspace.',
].join(' ');

export async function forkClaudeSession(sessionId, { projectPath, pointId, title } = {}) {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!normalizedSessionId) throw new Error('A valid Claude session id is required.');
  const result = await forkClaudeSdkSession(normalizedSessionId, {
    ...(projectPath ? { dir: projectPath } : {}),
    ...(pointId ? { upToMessageId: pointId } : {}),
    ...(title ? { title } : {}),
  });
  if (!result?.sessionId) throw new Error('Claude did not return the forked session id.');
  return { sessionId: result.sessionId };
}

function createClaudeUserInput(content, priority) {
  return {
    type: 'user',
    message: {
      role: 'user',
      content,
    },
    parent_tool_use_id: null,
    ...(priority ? { priority } : {}),
    timestamp: new Date().toISOString(),
  };
}

class ClaudeLiveInputStream {
  constructor(initialContent) {
    this.messages = [createClaudeUserInput(initialContent)];
    this.waiters = [];
    this.closed = false;
  }

  push(content, priority = 'now') {
    if (this.closed) return false;
    const message = createClaudeUserInput(content, priority);
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: message, done: false });
    else this.messages.push(message);
    return true;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.waiters.splice(0).forEach((resolve) => resolve({ value: undefined, done: true }));
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  next() {
    if (this.messages.length > 0) {
      return Promise.resolve({ value: this.messages.shift(), done: false });
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined, done: true });
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  return() {
    this.close();
    return Promise.resolve({ value: undefined, done: true });
  }
}

function normalizeClaudeEffort(effort) {
  const normalized = typeof effort === 'string' ? effort.trim() : '';
  return CLAUDE_EFFORT_LEVELS.has(normalized) ? normalized : null;
}

function normalizeClaudeThinkingConfig(thinking) {
  if (!thinking || typeof thinking !== 'object') {
    return null;
  }

  if (thinking.type === 'adaptive') {
    return { type: 'adaptive' };
  }

  if (thinking.type === 'disabled') {
    return { type: 'disabled' };
  }

  if (thinking.type === 'enabled') {
    const normalized = { type: 'enabled' };
    if (Number.isFinite(thinking.budgetTokens) && thinking.budgetTokens > 0) {
      normalized.budgetTokens = Math.floor(thinking.budgetTokens);
    }
    if (thinking.display === 'summarized' || thinking.display === 'omitted') {
      normalized.display = thinking.display;
    }
    return normalized;
  }

  return null;
}
const pendingClaudeSessionIndexReconciles = new Map();

const TOOLS_REQUIRING_INTERACTION = new Set(['AskUserQuestion']);

function resolveToolApproval(requestId, decision) {
  resolvePermApproval(requestId, decision);
}

function scheduleClaudeSessionIndexReconcile(projectPath, sessionId, delayMs = 1000) {
  if (!projectPath || !sessionId) {
    return;
  }

  const existingTimer = pendingClaudeSessionIndexReconciles.get(sessionId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timeoutId = setTimeout(async () => {
    pendingClaudeSessionIndexReconciles.delete(sessionId);
    try {
      await reconcileClaudeSessionIndex(encodeProjectPath(projectPath), sessionId);
    } catch (error) {
      console.warn(`[Claude] Failed to reconcile indexed session ${sessionId}:`, error.message);
    }
  }, delayMs);

  pendingClaudeSessionIndexReconciles.set(sessionId, timeoutId);
}

async function flushClaudeSessionIndexReconcile(projectPath, sessionId) {
  if (!projectPath || !sessionId) {
    return;
  }

  const existingTimer = pendingClaudeSessionIndexReconciles.get(sessionId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    pendingClaudeSessionIndexReconciles.delete(sessionId);
  }

  try {
    await reconcileClaudeSessionIndex(encodeProjectPath(projectPath), sessionId);
  } catch (error) {
    console.warn(`[Claude] Failed to flush indexed session ${sessionId}:`, error.message);
  }
}

/**
 * Maps CLI options to SDK-compatible options format
 * @param {Object} options - CLI options
 * @returns {Object} SDK-compatible options
 */
function mapCliOptionsToSDK(options = {}) {
  const { sessionId, cwd, toolsSettings, permissionMode, images, env, thinking, effort } = options;

  const sdkOptions = {};

  // Map working directory
  if (cwd) {
    sdkOptions.cwd = cwd;
  }

  if (env) {
    sdkOptions.env = env;
  }

  // Map permission mode
  if (permissionMode && permissionMode !== 'default') {
    sdkOptions.permissionMode = permissionMode;
  }

  // Skip the interactive trust/bypass-permissions dialogs that the CLI shows on
  // first launch in a new directory.  These Ink prompts require a TTY and will
  // hang when the SDK is used headlessly from a server process.
  //
  // In the web backend we MUST skip these dialogs, otherwise Claude SDK can stall
  // forever waiting for user input that will never arrive.
  sdkOptions.allowDangerouslySkipPermissions = true;

  // Map tool settings
  const settings = toolsSettings || {
    allowedTools: [],
    disallowedTools: [],
    skipPermissions: false
  };

  // Handle tool permissions
  if (settings.skipPermissions && permissionMode !== 'plan') {
    // When skipping permissions, use bypassPermissions mode
    sdkOptions.permissionMode = 'bypassPermissions';
  }

  let allowedTools = [...(settings.allowedTools || [])];

  // Add plan mode default tools
  if (permissionMode === 'plan') {
    const planModeTools = ['Read', 'Task', 'exit_plan_mode', 'TodoRead', 'TodoWrite', 'WebFetch', 'WebSearch'];
    for (const tool of planModeTools) {
      if (!allowedTools.includes(tool)) {
        allowedTools.push(tool);
      }
    }
  }

  sdkOptions.allowedTools = allowedTools;

  // Use the tools preset to make all default built-in tools available (including AskUserQuestion).
  // This was introduced in SDK 0.1.57. Omitting this preserves existing behavior (all tools available),
  // but being explicit ensures forward compatibility and clarity.
  sdkOptions.tools = { type: 'preset', preset: 'claude_code' };

  sdkOptions.disallowedTools = settings.disallowedTools || [];

  // Map model (default to sonnet)
  // Valid models: sonnet, opus, haiku, opusplan, sonnet[1m]
  sdkOptions.model = options.model || CLAUDE_MODELS.DEFAULT;
  console.log(`Using model: ${sdkOptions.model}`);

  const normalizedThinking = normalizeClaudeThinkingConfig(thinking);
  if (normalizedThinking) {
    sdkOptions.thinking = normalizedThinking;
  }

  const normalizedEffort = normalizeClaudeEffort(effort);
  if (normalizedEffort) {
    sdkOptions.effort = normalizedEffort;
  }

  // Map system prompt configuration
  sdkOptions.systemPrompt = {
    type: 'preset',
    preset: 'claude_code'  // Required to use CLAUDE.md
  };

  // Map setting sources for CLAUDE.md loading
  // This loads CLAUDE.md from project, user (~/.config/claude/CLAUDE.md), and local directories
  sdkOptions.settingSources = ['project', 'user', 'local'];

  // Emit partial assistant events so the web UI can show text and reasoning
  // activity during long turns instead of waiting for the assembled message.
  sdkOptions.includePartialMessages = true;

  // Map resume session
  if (sessionId) {
    sdkOptions.resume = sessionId;
  }

  return sdkOptions;
}

export async function buildClaudeProjectInstructionAppend(projectDir) {
  if (!projectDir) {
    return '';
  }

  try {
    await fs.access(path.join(projectDir, PROJECT_CLAUDE_RELATIVE_PATH));
    return '';
  } catch {
    // Fall through to backend template injection when the project file is absent or dangling.
  }

  try {
    const template = await fs.readFile(TEMPLATE_CLAUDE_PATH, 'utf8');
    const trimmed = template.trim();
    return trimmed ? `# Project Instructions (CLAUDE.md)\n${trimmed}` : '';
  } catch {
    return '';
  }
}

/**
 * Adds a session to the active sessions map
 * @param {string} sessionId - Session identifier
 * @param {Object} queryInstance - SDK query instance
 * @param {Array<string>} tempImagePaths - Temp image file paths for cleanup
 * @param {string} tempDir - Temp directory for cleanup
 */
function addSession(sessionId, queryInstance, tempImagePaths = [], tempDir = null, abortController = null, inputStream = null, trackingKey = sessionId) {
  const existing = activeSessions.get(trackingKey);
  const record = {
    instance: queryInstance,
    abortController,
    startTime: existing?.startTime || Date.now(),
    status: 'active',
    tempImagePaths,
    tempDir,
    inputStream,
    aliases: existing?.aliases || new Set(),
  };
  record.aliases.add(sessionId);
  record.aliases.add(trackingKey);
  activeSessions.set(trackingKey, record);
  for (const alias of record.aliases) {
    const targets = activeSessionAliases.get(alias) || new Set();
    targets.add(trackingKey);
    activeSessionAliases.set(alias, targets);
  }
}

/**
 * Removes a session from the active sessions map
 * @param {string} sessionId - Session identifier
 */
function removeSession(sessionId) {
  const resolved = resolveSessionEntry(sessionId);
  if (!resolved) return;
  activeSessions.delete(resolved.trackingKey);
  for (const alias of resolved.session.aliases || []) {
    const targets = activeSessionAliases.get(alias);
    targets?.delete(resolved.trackingKey);
    if (!targets || targets.size === 0) activeSessionAliases.delete(alias);
  }
}

function resolveSessionEntry(sessionId) {
  const direct = activeSessions.get(sessionId);
  if (direct) return { trackingKey: sessionId, session: direct };
  const targets = [...(activeSessionAliases.get(sessionId) || [])]
    .filter((trackingKey) => activeSessions.has(trackingKey));
  if (targets.length !== 1) return null;
  return { trackingKey: targets[0], session: activeSessions.get(targets[0]) };
}

/**
 * Gets a session from the active sessions map
 * @param {string} sessionId - Session identifier
 * @returns {Object|undefined} Session data or undefined
 */
function getSession(sessionId) {
  return resolveSessionEntry(sessionId)?.session;
}

/**
 * Gets all active session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getAllSessions() {
  return Array.from(activeSessions.keys());
}

/**
 * Transforms SDK messages to WebSocket format expected by frontend
 * @param {Object} sdkMessage - SDK message object
 * @returns {Object} Transformed message ready for WebSocket
 */
function transformMessage(sdkMessage) {
  // Partial messages arrive wrapped as `stream_event`. Unwrap the Anthropic
  // event so the browser can render text deltas immediately instead of waiting
  // for the final, fully assembled assistant message.
  if (sdkMessage?.type === 'stream_event' && sdkMessage.event) {
    return {
      ...sdkMessage.event,
      parentToolUseId: sdkMessage.parent_tool_use_id || undefined,
      sdkMessageUuid: sdkMessage.uuid,
    };
  }

  // Extract parent_tool_use_id for subagent tool grouping
  if (sdkMessage.parent_tool_use_id) {
    return {
      ...sdkMessage,
      parentToolUseId: sdkMessage.parent_tool_use_id
    };
  }
  return sdkMessage;
}

/**
 * Extracts token budget from the last assistant message's usage data.
 * This gives us per-API-call input tokens, which represents the actual
 * context window fill level (not cumulative across the agentic turn).
 * @param {Object|null} usage - usage object from assistant message (message.usage)
 * @param {string|null} model - resolved Claude model reported by the SDK
 * @returns {Object|null} Token budget object or null
 */
function extractTokenBudgetFromUsage(usage, model = null) {
  if (!usage) {
    return null;
  }

  // In Claude API: input_tokens is the non-cached portion.
  // Total context = input_tokens + cache_read_input_tokens + cache_creation_input_tokens
  const inputTokens = usage.input_tokens || 0;
  const cacheReadTokens = usage.cache_read_input_tokens || 0;
  const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
  const totalUsed = inputTokens + cacheReadTokens + cacheCreationTokens;

  // The SDK reports the resolved model. Prefer that model-specific limit over
  // the legacy CONTEXT_WINDOW fallback so switching models updates the UI.
  const configuredContextWindow = parseInt(process.env.CONTEXT_WINDOW, 10);
  const contextWindow = model
    ? getClaudeModelContextWindow(model)
    : (Number.isFinite(configuredContextWindow) ? configuredContextWindow : 256000);

  console.log(`Token calculation: input=${inputTokens}, cacheRead=${cacheReadTokens}, cacheCreation=${cacheCreationTokens}, total=${totalUsed}/${contextWindow}`);

  return {
    used: totalUsed,
    total: contextWindow,
    model,
    breakdown: {
      input: inputTokens,
      cacheRead: cacheReadTokens,
      cacheCreation: cacheCreationTokens,
    },
  };
}

/**
 * Handles image processing for SDK queries
 * Saves base64 images to temporary files and returns modified prompt with file paths
 * @param {string} command - Original user prompt
 * @param {Array} images - Array of image objects with base64 data
 * @param {string} cwd - Working directory for temp file creation
 * @returns {Promise<Object>} {modifiedCommand, tempImagePaths, tempDir}
 */
async function handleImages(command, images, cwd) {
  const tempImagePaths = [];
  let tempDir = null;

  if (!images || images.length === 0) {
    return { modifiedCommand: command, tempImagePaths, tempDir };
  }

  try {
    // Create temp directory in the project directory
    const workingDir = cwd || process.cwd();
    tempDir = path.join(workingDir, '.tmp', 'images', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });

    // Save each image to a temp file
    for (const [index, image] of images.entries()) {
      // Extract base64 data and mime type
      const matches = image.data.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        console.error('Invalid image data format');
        continue;
      }

      const [, , base64Data] = matches;
      const filename = buildTempAttachmentFilename(index, image?.name, matches[1]);
      const filepath = path.join(tempDir, filename);

      // Write base64 data to file
      await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
      tempImagePaths.push(filepath);
    }

    // Include the full image paths in the prompt
    let modifiedCommand = command;
    if (tempImagePaths.length > 0 && command && command.trim()) {
      const imageNote = `\n\n[Files provided at the following paths:]\n${tempImagePaths.map((p, i) => `${i + 1}. ${p}`).join('\n')}`;
      modifiedCommand = command + imageNote;
    }

    console.log(`Processed ${tempImagePaths.length} images to temp directory: ${tempDir}`);
    return { modifiedCommand, tempImagePaths, tempDir };
  } catch (error) {
    console.error('Error processing images for SDK:', error);
    return { modifiedCommand: command, tempImagePaths, tempDir };
  }
}

/**
 * Cleans up temporary image files
 * @param {Array<string>} tempImagePaths - Array of temp file paths to delete
 * @param {string} tempDir - Temp directory to remove
 */
async function cleanupTempFiles(tempImagePaths, tempDir) {
  if (!tempImagePaths || tempImagePaths.length === 0) {
    return;
  }

  try {
    // Delete individual temp files
    for (const imagePath of tempImagePaths) {
      await fs.unlink(imagePath).catch(err =>
        console.error(`Failed to delete temp image ${imagePath}:`, err)
      );
    }

    // Delete temp directory
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(err =>
        console.error(`Failed to delete temp directory ${tempDir}:`, err)
      );
    }

    console.log(`Cleaned up ${tempImagePaths.length} temp image files`);
  } catch (error) {
    console.error('Error during temp file cleanup:', error);
  }
}

/**
 * Loads MCP server configurations from ~/.claude.json
 * @param {string} cwd - Current working directory for project-specific configs
 * @returns {Object|null} MCP servers object or null if none found
 */
async function loadMcpConfig(cwd) {
  try {
    const claudeConfigPath = path.join(os.homedir(), '.claude.json');

    // Check if config file exists
    try {
      await fs.access(claudeConfigPath);
    } catch (error) {
      // File doesn't exist, return null
      console.log('No ~/.claude.json found, proceeding without MCP servers');
      return null;
    }

    // Read and parse config file
    let claudeConfig;
    try {
      const configContent = await fs.readFile(claudeConfigPath, 'utf8');
      claudeConfig = JSON.parse(configContent);
    } catch (error) {
      console.error('Failed to parse ~/.claude.json:', error.message);
      return null;
    }

    // Extract MCP servers (merge global and project-specific)
    let mcpServers = {};

    // Add global MCP servers
    if (claudeConfig.mcpServers && typeof claudeConfig.mcpServers === 'object') {
      mcpServers = { ...claudeConfig.mcpServers };
      console.log(`Loaded ${Object.keys(mcpServers).length} global MCP servers`);
    }

    // Add/override with project-specific MCP servers
    if (claudeConfig.claudeProjects && cwd) {
      const projectConfig = claudeConfig.claudeProjects[cwd];
      if (projectConfig && projectConfig.mcpServers && typeof projectConfig.mcpServers === 'object') {
        mcpServers = { ...mcpServers, ...projectConfig.mcpServers };
        console.log(`Loaded ${Object.keys(projectConfig.mcpServers).length} project-specific MCP servers`);
      }
    }

    // MedHelp no longer relies on TaskMaster MCP tooling in chat sessions.
    // Filter out any TaskMaster-related MCP entries to prevent legacy "not installed" errors.
    const filteredMcpServers = Object.fromEntries(
      Object.entries(mcpServers).filter(([name, config]) => {
        const normalizedName = String(name || '').toLowerCase();
        const command = String(config?.command || '').toLowerCase();
        const argsJoined = Array.isArray(config?.args)
          ? config.args.map((arg) => String(arg || '').toLowerCase()).join(' ')
          : '';

        const isTaskMasterServer =
          normalizedName.includes('task-master') ||
          normalizedName.includes('taskmaster') ||
          command.includes('task-master') ||
          command.includes('taskmaster') ||
          argsJoined.includes('task-master') ||
          argsJoined.includes('taskmaster');

        return !isTaskMasterServer;
      })
    );

    // Return null if no servers found
    if (Object.keys(filteredMcpServers).length === 0) {
      console.log('No MCP servers configured');
      return null;
    }

    if (Object.keys(filteredMcpServers).length !== Object.keys(mcpServers).length) {
      console.log(
        `Filtered legacy TaskMaster MCP servers: ${Object.keys(mcpServers).length - Object.keys(filteredMcpServers).length}`
      );
    }

    console.log(`Total MCP servers loaded: ${Object.keys(filteredMcpServers).length}`);
    return filteredMcpServers;
  } catch (error) {
    console.error('Error loading MCP config:', error.message);
    return null;
  }
}

/**
 * Executes a Claude query using the SDK
 * @param {string} command - User prompt/command
 * @param {Object} options - Query options
 * @param {Object} ws - WebSocket connection
 * @returns {Promise<void>}
 */
async function queryClaudeSDK(command, options = {}, ws) {
  const { sessionId, clientSessionId, sessionMode, stageTagKeys, stageTagSource = 'task_context' } = options;
  const coordinatedSessionKey = typeof options.sessionKey === 'string' && options.sessionKey.trim()
    ? options.sessionKey.trim()
    : null;
  let capturedSessionId = sessionId;
  let sessionCreatedSent = false;
  let tempImagePaths = [];
  let tempDir = null;
  let externalAbortHandler = null;
  let queryIterator = null;
  let liveInputStream = null;
  const lifecycleAbortController = new AbortController();
  const trackedSessionIds = new Set();
  const trackedSessionAliases = new Set();
  const trackSession = (trackedSessionId, queryInstance, inputStream) => {
    const normalizedSessionId = typeof trackedSessionId === 'string' ? trackedSessionId.trim() : '';
    if (!normalizedSessionId) return;
    const trackingKey = coordinatedSessionKey || normalizedSessionId;
    addSession(
      normalizedSessionId,
      queryInstance,
      tempImagePaths,
      tempDir,
      lifecycleAbortController,
      inputStream,
      trackingKey,
    );
    trackedSessionIds.add(trackingKey);
    trackedSessionAliases.add(normalizedSessionId);
  };
  const untrackSessionsExcept = (retainedSessionId = null) => {
    const retainedTrackingKey = coordinatedSessionKey || retainedSessionId;
    for (const trackedSessionId of trackedSessionIds) {
      if (trackedSessionId === retainedTrackingKey) continue;
      removeSession(trackedSessionId);
      trackedSessionIds.delete(trackedSessionId);
    }
  };
  const untrackAllSessions = () => {
    // A coordinated turn always has `coordinatedSessionKey`, so delegating to
    // `untrackSessionsExcept(null)` accidentally retained that key forever.
    // Completed and failed turns must remove every runtime handle; otherwise
    // status checks report a dead SDK transport as active and the UI keeps
    // reattaching a ghost stream.
    for (const trackedSessionId of [...trackedSessionIds]) {
      removeSession(trackedSessionId);
      trackedSessionIds.delete(trackedSessionId);
    }
  };
  const emittedLifecyclePhases = new Set();
  const emitLifecycle = (phase, metadata = {}) => {
    if (emittedLifecyclePhases.has(phase)) return;
    emittedLifecyclePhases.add(phase);
    try {
      options.onLifecycleEvent?.({
        phase,
        provider: 'claude',
        sessionId: capturedSessionId || sessionId || clientSessionId || null,
        ...metadata,
      });
    } catch {}
  };
  const workingDirectory = options.cwd || options.projectPath || null;
  const shouldIndexSession = options.indexSession !== false && Boolean(workingDirectory);
  const shouldInitializeProject = options.initializeProject !== false && Boolean(workingDirectory);
  const sessionProjectPath = shouldIndexSession ? workingDirectory : null;
  const sessionDisplayName = buildSessionDisplayName(command);
  const cleanupExternalAbortHandler = () => {
    if (externalAbortHandler && options.signal?.removeEventListener) {
      options.signal.removeEventListener('abort', externalAbortHandler);
      externalAbortHandler = null;
    }
  };
  const createAbortError = () => {
    const error = new Error('Claude query was cancelled.');
    error.name = 'AbortError';
    return error;
  };

  try {
    if (options.signal?.aborted) {
      throw createAbortError();
    }

    // Synchronous (better-sqlite3) — no await needed.
    if (sessionId && sessionProjectPath) {
      applyStageTagsToSession({
        sessionId,
        projectPath: sessionProjectPath,
        provider: 'claude',
        stageTagKeys,
        source: stageTagSource,
      });
    }

    // Ensure skills symlinks and CLAUDE.md template exist in the project directory
    const projectDir = shouldInitializeProject ? workingDirectory : null;
    if (projectDir) {
      try {
        await ensureProjectSkillLinks(projectDir, { userId: options.userId });
        await writeProjectTemplates(projectDir);
      } catch (err) {
        console.warn('[claude-sdk] Failed to initialize project skills/templates:', err.message);
      }
    }

    // Map CLI options to SDK format. User-scoped database API credentials saved
    // in Settings are exposed only to this agent process as environment vars.
    const agentOptions = {
      ...options,
      env: withDatabaseApiAgentEnv(options.env || process.env, options.userId),
    };
    const sdkOptions = mapCliOptionsToSDK(agentOptions);
    let computeBridge = null;
    let workbenchBridge = null;
    try {
      computeBridge = await resolveAgentComputeBridge({
        projectPath: workingDirectory || '',
        nodeId: options.computeNodeId || null,
      });
    } catch (err) {
      console.warn('[claude-sdk] Failed to resolve active compute resource:', err.message);
    }
    try {
      workbenchBridge = await resolveWorkbenchBridge({
        userId: options.userId,
        authSessionId: options.authSessionId || null,
      });
    } catch (err) {
      console.warn('[claude-sdk] Failed to resolve workbench bridge:', err.message);
    }
    const projectInstructionAppend = await buildClaudeProjectInstructionAppend(projectDir);
    if (projectInstructionAppend) {
      sdkOptions.systemPrompt = {
        ...(sdkOptions.systemPrompt || {}),
        append: [sdkOptions.systemPrompt?.append, projectInstructionAppend]
          .filter(Boolean)
          .join('\n\n'),
      };
    }

    // Expose MedHelp skills to Claude through a backend-private local plugin so the
    // customer project stays free of .claude/skills symlinks even when hidden-asset
    // mode is the default. Skills surface as native Claude Code skills.
    try {
      const claudeSkillPluginPath = await ensureClaudeSkillPlugin(options.userId);
      if (claudeSkillPluginPath) {
        sdkOptions.plugins = [
          ...(sdkOptions.plugins || []),
          { type: 'local', path: claudeSkillPluginPath },
        ];
        sdkOptions.systemPrompt = {
          ...(sdkOptions.systemPrompt || {}),
          append: [sdkOptions.systemPrompt?.append, CLAUDE_SKILL_PLUGIN_HINT]
            .filter(Boolean)
            .join('\n\n'),
        };
      }
    } catch (err) {
      console.warn('[claude-sdk] Failed to attach MedHelp skill plugin:', err.message);
    }

    const sdkEnv = sdkOptions.env && typeof sdkOptions.env === 'object'
      ? { ...process.env, ...sdkOptions.env }
      : process.env;
    const claudeExecutableInfo = resolveClaudeCodeExecutableInfo({
      env: sdkEnv,
      preferBundledNative: true,
    });
    if (!claudeExecutableInfo.executable) {
      throw new Error('Claude Code executable was not found. Install Claude Code locally or set CLAUDE_CLI_PATH to the Claude Code executable path, then restart MedHelp Local Engine.');
    }
    sdkOptions.pathToClaudeCodeExecutable = claudeExecutableInfo.executable;
    console.log(`[Claude] Using Claude Code executable (${claudeExecutableInfo.source}): ${claudeExecutableInfo.executable}`);

    // IMPORTANT: The Claude Agent SDK reads its own provider credentials and
    // endpoint from process.env. Database API credentials are different: they
    // belong only in sdkOptions.env so concurrent users can never overwrite one
    // another through the shared server process environment.
    const envOverrides = sdkOptions.env && typeof sdkOptions.env === 'object' ? sdkOptions.env : null;
    const envKeysToApply = [
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_API_URL',
    ];
    const prevEnv = {};
    if (envOverrides) {
      for (const key of envKeysToApply) {
        if (Object.prototype.hasOwnProperty.call(envOverrides, key)) {
          prevEnv[key] = process.env[key];
          const nextVal = envOverrides[key];
          if (nextVal === null || nextVal === undefined || String(nextVal).length === 0) {
            delete process.env[key];
          } else {
            process.env[key] = String(nextVal);
          }
        }
      }
    }

    // Load MCP configuration
    const mcpServers = await loadMcpConfig(options.cwd);
    if (mcpServers) {
      sdkOptions.mcpServers = mcpServers;
    }
    if (computeBridge?.mcpServer) {
      sdkOptions.mcpServers = {
        ...(sdkOptions.mcpServers || {}),
        [AGENT_COMPUTE_MCP_SERVER_NAME]: computeBridge.mcpServer,
      };
    }
    if (workbenchBridge?.mcpServer) {
      sdkOptions.mcpServers = {
        ...(sdkOptions.mcpServers || {}),
        [WORKBENCH_MCP_SERVER_NAME]: workbenchBridge.mcpServer,
      };
      for (const tool of WORKBENCH_READ_TOOL_NAMES) {
        const qualifiedName = `mcp__${WORKBENCH_MCP_SERVER_NAME}__${tool}`;
        if (!sdkOptions.allowedTools.includes(qualifiedName)) sdkOptions.allowedTools.push(qualifiedName);
      }
    }

    // Handle images - save to temp files and modify prompt
    const imageResult = await handleImages(command, options.images, options.cwd);
    const preferenceCommand = prependUserPreferenceMemoryToPrompt(
      imageResult.modifiedCommand,
      options.userId,
      {
        fallbackCommand: 'Continue with the current task.',
        analysisLanguage: options.analysisLanguage,
        projectPath: options.cwd || options.projectPath || null,
        projectKey: options.projectName || null,
        preferenceContext: options.userPreferenceContext || null,
      },
    );
    const finalCommand = prependWorkbenchContext(
      prependAgentComputeContext(preferenceCommand, computeBridge),
      workbenchBridge,
    );
    tempImagePaths = imageResult.tempImagePaths;
    tempDir = imageResult.tempDir;

    sdkOptions.canUseTool = async (toolName, input, context) => {
      const requiresInteraction = TOOLS_REQUIRING_INTERACTION.has(toolName);
      const isWorkbenchMutation = WORKBENCH_MUTATION_TOOL_NAMES.some(
        (name) => toolName === `mcp__${WORKBENCH_MCP_SERVER_NAME}__${name}`,
      );

      if (!requiresInteraction) {
        if (sdkOptions.permissionMode === 'bypassPermissions' && !isWorkbenchMutation) {
          return { behavior: 'allow', updatedInput: input };
        }

        const isDisallowed = (sdkOptions.disallowedTools || []).some(entry =>
          matchesToolPermission(entry, toolName, input)
        );
        if (isDisallowed) {
          return { behavior: 'deny', message: 'Tool disallowed by settings' };
        }

        const isAllowed = (sdkOptions.allowedTools || []).some(entry =>
          matchesToolPermission(entry, toolName, input)
        );
        if (isAllowed) {
          return { behavior: 'allow', updatedInput: input };
        }
      }

      const requestId = createRequestId();
      ws.send({
        type: 'claude-permission-request',
        requestId,
        toolName,
        input,
        sessionId: capturedSessionId || sessionId || null
      });

      const decision = await waitForToolApproval(requestId, {
        timeoutMs: requiresInteraction
          ? resolveInactivityTimeoutMs(
            process.env.CLAUDE_INTERACTION_TIMEOUT_MS,
            DEFAULT_CLAUDE_INTERACTION_TIMEOUT_MS,
          )
          : undefined,
        signal: context?.signal,
        onCancel: (reason) => {
          ws.send({
            type: 'claude-permission-cancelled',
            requestId,
            reason,
            sessionId: capturedSessionId || sessionId || clientSessionId || null
          });
        }
      });
      if (!decision) {
        return { behavior: 'deny', message: 'Permission request timed out' };
      }

      if (decision.cancelled) {
        return { behavior: 'deny', message: 'Permission request cancelled' };
      }

      if (decision.allow) {
        if (!isWorkbenchMutation && decision.rememberEntry && typeof decision.rememberEntry === 'string') {
          if (!sdkOptions.allowedTools.includes(decision.rememberEntry)) {
            sdkOptions.allowedTools.push(decision.rememberEntry);
          }
          if (Array.isArray(sdkOptions.disallowedTools)) {
            sdkOptions.disallowedTools = sdkOptions.disallowedTools.filter(entry => entry !== decision.rememberEntry);
          }
        }
        return { behavior: 'allow', updatedInput: decision.updatedInput ?? input };
      }

      return { behavior: 'deny', message: decision.message ?? 'User denied tool use' };
    };

    // Set stream-close timeout for interactive tools (Query constructor reads it synchronously). Claude Agent SDK has a default of 5s and this overrides it
    const prevStreamTimeout = process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '300000';

    emitLifecycle('preprocessing_completed', {
      sessionId: capturedSessionId || sessionId || clientSessionId || null,
    });
    liveInputStream = new ClaudeLiveInputStream(finalCommand);
    const queryInstance = query({
      prompt: liveInputStream,
      options: sdkOptions
    });

    if (options.signal) {
      externalAbortHandler = () => {
        lifecycleAbortController.abort();
        try {
          if (queryInstance?.interrupt) queryInstance.interrupt().catch(() => {});
        } catch {}
      };
      if (options.signal.aborted) {
        externalAbortHandler();
      } else {
        options.signal.addEventListener('abort', externalAbortHandler, { once: true });
      }
    }

    // Restore immediately — Query constructor already captured the value
    if (prevStreamTimeout !== undefined) {
      process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = prevStreamTimeout;
    } else {
      delete process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    }

    // Restore any per-session env overrides as well (Query constructor already read process.env).
    for (const key of Object.keys(prevEnv)) {
      if (prevEnv[key] === undefined) delete process.env[key];
      else process.env[key] = prevEnv[key];
    }

    // Track provisional new-session ids too. This lets disconnect cleanup and
    // the Stop button interrupt Claude before the SDK emits its real session id.
    trackSession(capturedSessionId || clientSessionId, queryInstance, liveInputStream);

    // Process streaming messages
    // Track the latest assistant message's usage to get per-API-call context window usage
    let lastAssistantUsage = null;
    let lastAssistantModel = sdkOptions.model;
    let sawAnyTextOutput = false;
    console.log('Starting async generator loop for session:', capturedSessionId || 'NEW');
    const firstMessageTimeoutMs = resolveInactivityTimeoutMs(
      process.env.CLAUDE_FIRST_TOKEN_TIMEOUT_MS,
      DEFAULT_CLAUDE_FIRST_MESSAGE_TIMEOUT_MS,
    );
    const streamIdleTimeoutMs = resolveInactivityTimeoutMs(
      process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS,
      DEFAULT_CLAUDE_STREAM_IDLE_TIMEOUT_MS,
    );
    queryIterator = queryInstance[Symbol.asyncIterator]();
    let receivedAnyMessage = false;
    while (true) {
      const timeoutMs = receivedAnyMessage ? streamIdleTimeoutMs : firstMessageTimeoutMs;
      const iteratorResult = await nextWithInactivityTimeout(queryIterator, {
        timeoutMs,
        errorCode: receivedAnyMessage ? 'STREAM_IDLE_TIMEOUT' : 'FIRST_MESSAGE_TIMEOUT',
        message: receivedAnyMessage
          ? `Claude stopped producing events for ${timeoutMs}ms; the session was interrupted.`
          : 'Timed out waiting for Claude response (no streaming messages received). Check your third-party Claude API gateway/key settings.',
        onTimeout: () => queryInstance?.interrupt?.(),
        signal: lifecycleAbortController.signal,
      });
      if (iteratorResult.done) break;
      receivedAnyMessage = true;
      const message = iteratorResult.value;
      emitLifecycle('turn_started', {
        sessionId: message?.session_id || capturedSessionId || sessionId || clientSessionId || null,
      });

      // Detect whether this turn produced any visible text for the UI.
      // (If the model only emits thinking/tool_use without text, the UI can look "stuck".)
      if (message?.type === 'content_block_delta' && typeof message?.delta?.text === 'string' && message.delta.text.trim()) {
        sawAnyTextOutput = true;
        emitLifecycle('first_text', {
          sessionId: message?.session_id || capturedSessionId || sessionId || clientSessionId || null,
        });
      }
      if (message?.type === 'assistant' && message?.message?.content && Array.isArray(message.message.content)) {
        if (message.message.content.some((part) => part?.type === 'text' && typeof part?.text === 'string' && part.text.trim())) {
          sawAnyTextOutput = true;
          emitLifecycle('first_text', {
            sessionId: message?.session_id || capturedSessionId || sessionId || clientSessionId || null,
          });
        }
      }
      // Capture session ID from first message
      if (message.session_id && !capturedSessionId) {
        const previousTrackedSessionAliases = [...trackedSessionAliases];
        capturedSessionId = message.session_id;
        untrackSessionsExcept(capturedSessionId);
        trackSession(capturedSessionId, queryInstance, liveInputStream);
        previousTrackedSessionAliases.forEach((alias) => {
          const trackingKey = coordinatedSessionKey || capturedSessionId;
          const targets = activeSessionAliases.get(alias) || new Set();
          targets.add(trackingKey);
          activeSessionAliases.set(alias, targets);
          activeSessions.get(trackingKey)?.aliases?.add(alias);
        });

        // Set session ID on writer
        if (ws.setSessionId && typeof ws.setSessionId === 'function') {
          ws.setSessionId(capturedSessionId);
        }

        // Send session-created event only once for new sessions
        if (!sessionId && !sessionCreatedSent) {
          sessionCreatedSent = true;
          if (options.cwd || options.projectPath) {
            recordIndexedSession({
              sessionId: capturedSessionId,
              provider: 'claude',
              projectPath: options.cwd || options.projectPath,
              sessionMode: sessionMode || 'research',
              displayName: sessionDisplayName,
              stageTagKeys,
              tagSource: stageTagSource,
            });
          }
          ws.send({
            type: 'session-created',
            sessionId: capturedSessionId,
            previousSessionId: clientSessionId || undefined,
            provider: 'claude',
            mode: sessionMode || 'research',
            displayName: sessionDisplayName || 'New Session',
            projectName: sessionProjectPath ? encodeProjectPath(sessionProjectPath) : undefined,
          });
        }
      }

      // Track usage from assistant messages (per-API-call, not cumulative)
      if (message.type === 'assistant' && message.message?.usage) {
        lastAssistantUsage = message.message.usage;
        lastAssistantModel = message.message.model || lastAssistantModel;
      }

      // Detect SDK-level errors on assistant messages (e.g. rate_limit, authentication_failed)
      // These come as structured enum values, not in the catch block.
      if (message.type === 'assistant' && message.error) {
        const { errorType, isRetryable } = classifySDKError(message.error, 'claude');
        ws.send({
          type: 'claude-error',
          error: message.error,
          errorType,
          isRetryable,
        sessionId: capturedSessionId || sessionId || clientSessionId || null,
        });
      }

      // Transform and send message to WebSocket
      const transformedMessage = transformMessage(message);
      const sessionData = capturedSessionId ? getSession(capturedSessionId) : null;
      ws.send({
        type: 'claude-response',
        data: {
          ...transformedMessage,
          startTime: sessionData?.startTime
        },
        sessionId: capturedSessionId || sessionId || clientSessionId || null
      });

      if (
        capturedSessionId &&
        sessionProjectPath &&
        sessionMode !== 'consultation' &&
        (message.type === 'assistant' || message.type === 'result')
      ) {
        scheduleClaudeSessionIndexReconcile(sessionProjectPath, capturedSessionId);
      }

      // Send token budget update when the turn completes
      if (message.type === 'result') {
        liveInputStream.close();
        const tokenBudget = extractTokenBudgetFromUsage(lastAssistantUsage, lastAssistantModel);
        if (tokenBudget) {
          console.log('Token budget from last assistant usage:', tokenBudget);
          ws.send({
            type: 'token-budget',
            data: tokenBudget,
            sessionId: capturedSessionId || sessionId || null
          });
        }
      }
    }
    cleanupExternalAbortHandler();
    if (options.signal?.aborted) {
      throw createAbortError();
    }
    emitLifecycle('completed', {
      sessionId: capturedSessionId || sessionId || clientSessionId || null,
      outcome: 'completed',
      contextTokens: lastAssistantUsage?.input_tokens,
    });

    // Send completion event before removing session to avoid race with abort requests
    console.log('Streaming complete, sending claude-complete event');
    if (!sawAnyTextOutput) {
      ws.send({
        type: 'claude-error',
        error: 'Claude completed without producing any text output (only non-text blocks or empty output). This often indicates a stuck trust dialog, a tool-only turn, or a gateway issue.',
        errorType: 'NO_OUTPUT',
        isRetryable: true,
        sessionId: capturedSessionId || sessionId || clientSessionId || null,
      });
    }
    ws.send({
      type: 'claude-complete',
      sessionId: capturedSessionId || sessionId || clientSessionId || null,
      exitCode: 0,
      isNewSession: !sessionId && !!command
    });
    console.log('claude-complete event sent');

    // Keep post-run housekeeping out of the completion critical path so the UI
    // can settle immediately after the model finishes streaming.
    const completionTasks = [];
    if (trackedSessionIds.size > 0) {
      untrackAllSessions();
    }
    if (capturedSessionId && sessionMode !== 'consultation') {
      completionTasks.push(flushClaudeSessionIndexReconcile(sessionProjectPath, capturedSessionId));
    }
    completionTasks.push(cleanupTempFiles(tempImagePaths, tempDir));
    await Promise.allSettled(completionTasks);

  } catch (error) {
    cleanupExternalAbortHandler();
    liveInputStream?.close();
    const wasAborted = error?.name === 'AbortError';
    if (queryIterator?.return) {
      await Promise.race([
        queryIterator.return().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 1_000)),
      ]);
    }
    emitLifecycle('completed', {
      sessionId: capturedSessionId || sessionId || clientSessionId || null,
      outcome: wasAborted ? 'aborted' : 'error',
    });
    if (wasAborted) {
      console.log('Claude SDK query interrupted:', capturedSessionId || sessionId || clientSessionId || 'unknown');
    } else {
      console.error('SDK query error:', error);
    }

    // Record session before cleanup so it appears in sidebar even on early errors
    if (capturedSessionId && !sessionId && !sessionCreatedSent && (options.cwd || options.projectPath)) {
      sessionCreatedSent = true;
      recordIndexedSession({
        sessionId: capturedSessionId,
        provider: 'claude',
        projectPath: options.cwd || options.projectPath,
        sessionMode: sessionMode || 'research',
        displayName: sessionDisplayName,
      });
      ws.send({
        type: 'session-created',
        sessionId: capturedSessionId,
        provider: 'claude',
        mode: sessionMode || 'research',
        displayName: sessionDisplayName || 'New Session',
        projectName: sessionProjectPath ? encodeProjectPath(sessionProjectPath) : undefined,
      });
    }

    // Clean up session on error
    untrackAllSessions();

    if (!wasAborted) {
      const { errorType, isRetryable } = classifyError(error.message);

      ws.send({
        type: 'claude-error',
        error: error.message,
        errorType,
        isRetryable,
        sessionId: capturedSessionId || sessionId || clientSessionId || null
      });
    }

    const errorTasks = [];
    if (capturedSessionId && sessionMode !== 'consultation') {
      errorTasks.push(flushClaudeSessionIndexReconcile(sessionProjectPath, capturedSessionId));
    }
    errorTasks.push(cleanupTempFiles(tempImagePaths, tempDir));
    await Promise.allSettled(errorTasks);

    if (!wasAborted) throw error;
  }
}

/**
 * Aborts an active SDK session
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session was aborted, false if not found
 */
async function abortClaudeSDKSession(sessionId) {
  const session = getSession(sessionId);

  if (!session) {
    console.log(`Session ${sessionId} not found`);
    return false;
  }

  session.status = 'aborted';
  removeSession(sessionId);
  session.abortController?.abort();

  try {
    console.log(`Aborting SDK session: ${sessionId}`);

    // Call interrupt() on the query instance, but do not let a stuck SDK keep
    // the in-memory session lock alive forever.
    await Promise.race([
      session.instance?.interrupt?.() || Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (session.instance?.return) {
      await Promise.race([
        session.instance.return().catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 1_000)),
      ]);
    }

    // Clean up temporary image files
    await cleanupTempFiles(session.tempImagePaths, session.tempDir);

    return true;
  } catch (error) {
    console.error(`Error aborting session ${sessionId}:`, error);
    try {
      await cleanupTempFiles(session.tempImagePaths, session.tempDir);
    } catch {}
    return true;
  }
}

/**
 * Push a user message into a currently running Claude Agent SDK query.
 * `priority: now` tells the SDK to make the message available to the active
 * interaction without interrupting or closing the query.
 */
async function steerClaudeSDKSession(sessionId, command) {
  const normalizedCommand = typeof command === 'string' ? command.trim() : '';
  const session = getSession(sessionId);
  if (!session || session.status !== 'active' || !normalizedCommand) {
    return { success: false, error: session ? 'EMPTY_MESSAGE' : 'SESSION_NOT_ACTIVE' };
  }
  if (!session.inputStream) {
    return { success: false, error: 'STEERING_NOT_SUPPORTED' };
  }
  if (!session.inputStream.push(normalizedCommand, 'now')) {
    return { success: false, error: 'SESSION_NOT_ACTIVE' };
  }
  return { success: true, sessionId };
}

/**
 * Checks if an SDK session is currently active
 * @param {string} sessionId - Session identifier
 * @returns {boolean} True if session is active
 */
function isClaudeSDKSessionActive(sessionId) {
  const session = getSession(sessionId);
  return session && session.status === 'active';
}

/**
 * Gets the start time of an SDK session
 * @param {string} sessionId - Session identifier
 * @returns {number|null} Start time in ms or null
 */
function getClaudeSDKSessionStartTime(sessionId) {
  const session = getSession(sessionId);
  return session ? session.startTime : null;
}

/**
 * Gets all active SDK session IDs
 * @returns {Array<string>} Array of active session IDs
 */
function getActiveClaudeSDKSessions() {
  return getAllSessions();
}

// Export public API
export {
  queryClaudeSDK,
  abortClaudeSDKSession,
  steerClaudeSDKSession,
  isClaudeSDKSessionActive,
  getClaudeSDKSessionStartTime,
  getActiveClaudeSDKSessions,
  resolveToolApproval
};
