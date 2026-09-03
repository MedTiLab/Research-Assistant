/**
 * OpenAI Codex App Server Integration
 * ===================================
 *
 * This module keeps a Codex app-server process alive across turns and adapts its
 * JSON-RPC event stream to MedHelp's existing websocket message format.
 *
 * ## Usage
 *
 * - queryCodex(command, options, ws) - Execute a prompt with streaming via WebSocket
 * - abortCodexSession(sessionId) - Cancel an active session
 * - isCodexSessionActive(sessionId) - Check if a session is running
 * - getActiveCodexSessions() - List all active sessions
 */

import { promises as fs } from 'fs';
import path from 'path';
import { encodeProjectPath, ensureProjectSkillLinks, reconcileCodexSessionIndex } from './projects.js';
import { sessionDb } from './database/db.js';
import { getProjectAgentsPath, resolveProjectAgentsPath, writeProjectTemplates } from './templates/index.js';
import {
  CODEX_SKILL_REMINDER_INTERVAL,
  resolveCodexSkillDirs,
  buildCodexSkillReadOnlyConfig,
  buildCodexShellEnvironmentPolicy,
  buildCodexWindowsCompatibilityConfig,
  buildCodexSkillsPromptForTurn,
  resolveCodexSkillTurnNumber,
  assembleCodexTurnPrompt,
} from './utils/codexSkillAccess.js';
import { applyStageTagsToSession, recordIndexedSession } from './utils/sessionIndex.js';
import { classifyError, classifySDKError } from '../shared/errorClassifier.js';
import { buildTempAttachmentFilename } from './utils/imageAttachmentFiles.js';
import { buildSessionDisplayName } from './utils/sessionFormatting.js';
import { buildCodexRealtimeTokenBudget } from './utils/sessionTokenUsage.js';
import { prependUserPreferenceMemoryToPrompt } from './utils/userPreferenceMemory.js';
import { withDatabaseApiAgentEnv } from './utils/databaseApiAgentEnv.js';
import {
  buildMedHelpCodexEnvironment,
  ensureMedHelpCodexSessionAvailable,
} from './utils/codexHome.js';
import { CODEX_MODELS, getCodexModelContextWindow, isCodexModelSelection } from '../shared/modelConstants.js';
import {
  isCodexInternalNoticeContent,
  isCodexInternalPromptContent,
} from '../shared/codexInternalNotices.js';
import {
  AGENT_COMPUTE_MCP_SERVER_NAME,
  prependAgentComputeContext,
  resolveAgentComputeBridge,
} from './agent-compute-bridge.js';
import {
  WORKBENCH_MCP_SERVER_NAME,
  prependWorkbenchContext,
  resolveWorkbenchBridge,
} from './workbench-bridge.js';

// Track active sessions
const activeCodexSessions = new Map();
const MIN_CODEX_AUTO_COMPACT_TOKEN_LIMIT = 60_000;

async function loadCodexAppServer() {
  try {
    return await import('./codex-app-server.js');
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      const unavailableError = new Error('Codex support has been removed from this deployment.');
      unavailableError.code = 'CODEX_RUNTIME_UNAVAILABLE';
      unavailableError.statusCode = 503;
      throw unavailableError;
    }
    throw error;
  }
}

async function getCodexAppServerClient(options) {
  const codexAppServer = await loadCodexAppServer();
  return codexAppServer.getCodexAppServerClient(options);
}

async function shutdownCodexAppServers() {
  try {
    const codexAppServer = await loadCodexAppServer();
    await codexAppServer.shutdownCodexAppServers();
  } catch (error) {
    if (error?.code !== 'CODEX_RUNTIME_UNAVAILABLE') throw error;
  }
}

function resolveCodexAutoCompactTokenLimit(env = process.env, contextWindow = 256_000) {
  const configured = Number.parseInt(String(env?.CODEX_AUTO_COMPACT_TOKEN_LIMIT || ''), 10);
  // Let Codex choose its model-aware threshold unless the operator explicitly
  // overrides it. A fixed 80k threshold made large-context models compact far
  // too early and became stale as users switched models.
  if (!Number.isFinite(configured)) return null;
  const safeMaximum = Math.max(MIN_CODEX_AUTO_COMPACT_TOKEN_LIMIT, Math.floor(contextWindow * 0.9));
  return Math.min(safeMaximum, Math.max(MIN_CODEX_AUTO_COMPACT_TOKEN_LIMIT, configured));
}

export function isCodexPlaceholderSessionId(sessionId) {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!normalizedSessionId) {
    return false;
  }

  return /^codex-\d+$/.test(normalizedSessionId)
    || normalizedSessionId.startsWith('new-session-')
    || normalizedSessionId.startsWith('temp-');
}

function normalizeCodexSessionId(sessionId) {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!normalizedSessionId || isCodexPlaceholderSessionId(normalizedSessionId)) {
    return null;
  }

  return normalizedSessionId;
}

function isArchivedCodexThreadError(error) {
  return /\b(?:session|thread)\b[^\n]*\barchived\b/i.test(String(error?.message || ''));
}

async function resumeCodexThread(appServer, threadId, threadOptions, availability = null) {
  if (availability?.archived) {
    await appServer.unarchiveThread(threadId);
  }

  try {
    return await appServer.resumeThread(threadId, threadOptions);
  } catch (error) {
    if (!availability?.archived && isArchivedCodexThreadError(error)) {
      await appServer.unarchiveThread(threadId);
      return appServer.resumeThread(threadId, threadOptions);
    }
    throw error;
  }
}

function isCodexStartupDiagnosticContent(text) {
  const normalizedText = typeof text === 'string' ? text.trim() : '';
  if (!normalizedText) {
    return false;
  }

  if (isCodexInternalNoticeContent(normalizedText)) {
    return true;
  }

  const lines = normalizedText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return false;
  }

  const diagnosticPatterns = [
    /^⚠\s*Skipped loading .*invalid SKILL\.md files?/i,
    /^⚠\s*\/.*SKILL\.md:\s*invalid YAML:/i,
    /^⚠\s*MCP client for .* failed to start:/i,
    /^⚠\s*The figma MCP server is not logged in\./i,
    /^⚠\s*Heads up, you have less than \d+% of your .* limit left\./i,
    /^•\s*Starting MCP servers/i,
  ];

  const matchedLineCount = lines.reduce((count, line) => (
    diagnosticPatterns.some((pattern) => pattern.test(line)) ? count + 1 : count
  ), 0);

  return matchedLineCount >= 2 || /^•\s*Starting MCP servers/i.test(normalizedText);
}

/**
 * Check if an agent_message item contains system prompt / instruction content
 * that should be collapsed rather than displayed as a normal message.
 * @param {string} text - The message text
 * @returns {boolean}
 */
function isSystemPromptContent(text) {
  if (isCodexInternalNoticeContent(text)) return true;
  if (isCodexInternalPromptContent(text)) return true;
  if (!text || text.length < 200) return false;
  // AGENTS.md / SKILL.md / INSTRUCTIONS headers
  if (/^#\s+(AGENTS|SKILL|INSTRUCTIONS)/m.test(text)) return true;
  // XML instruction tags
  if (text.includes('<INSTRUCTIONS>') || text.includes('</INSTRUCTIONS>')) return true;
  // "instructions for /path" pattern in a heading
  if (/^#+\s+.*instructions\s+for\s+\//im.test(text)) return true;
  // Skill content markers
  if (text.includes('Base directory for this skill:') && text.length > 500) return true;
  // Long text with numbered-list instruction patterns
  if (text.length > 2000 && /^\d+\)\s/m.test(text) && /\bskill\b/i.test(text)) return true;
  // Repeated SKILL.md file paths (skill listing content)
  const skillPathCount = (text.match(/SKILL\.md\)/g) || []).length;
  if (skillPathCount >= 3) return true;
  // "How to use skills" section
  if (text.includes('### How to use skills') || text.includes('## How to use skills')) return true;
  // Skill discovery/trigger rules pattern
  if (text.includes('Trigger rules:') && text.includes('skill') && text.length > 500) return true;
  return false;
}

/**
 * Transform a normalized Codex app-server event to WebSocket message format
 * @param {object} event - Normalized app-server event
 * @returns {object|null} - Transformed event for WebSocket, or null to skip
 */
function transformCodexEvent(event) {
  // Map SDK event types to a consistent format
  switch (event.type) {
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      const item = event.item;
      if (!item) {
        return null;
      }

      // Transform based on item type
      switch (item.type) {
        case 'agent_message': {
          const text = item.text || '';
          if (!text.trim()) return null;
          if (isCodexStartupDiagnosticContent(text)) return null;

          // Prompt scaffolding is still sent to Codex, but an SDK echo of it is
          // backend-only and must never cross the websocket boundary.
          const isSysPrompt = isSystemPromptContent(text);
          if (isSysPrompt) return null;
          return {
            type: 'item',
            itemType: 'agent_message',
            message: {
              role: 'assistant',
              content: text
            },
            isSystemPrompt: false
          };
        }

        case 'reasoning': {
          // Keep private reasoning out of the transcript, but preserve a small
          // activity signal so long reasoning passes do not look stalled.
          return {
            type: 'status',
            status: 'reasoning'
          };
        }

        case 'command_execution': {
          // Codex may wrap commands in JSON: {"cmd":"...", "workdir":"...", "max_output_tokens":...}
          // Extract just the command string for display
          let command = item.command || '';
          try {
            const parsed = JSON.parse(command);
            if (parsed.cmd) command = parsed.cmd;
          } catch {
            // Not JSON, use as-is
          }
          return {
            type: 'item',
            itemType: 'command_execution',
            command,
            output: item.aggregated_output || '',
            exitCode: item.exit_code,
            status: item.status
          };
        }

        case 'file_change':
          return {
            type: 'item',
            itemType: 'file_change',
            changes: item.changes,
            status: item.status
          };

        case 'mcp_tool_call':
          return {
            type: 'item',
            itemType: 'mcp_tool_call',
            server: item.server,
            tool: item.tool,
            arguments: item.arguments,
            result: item.result,
            error: item.error,
            status: item.status
          };

        case 'web_search':
          return {
            type: 'item',
            itemType: 'web_search',
            query: item.query || ''
          };

        case 'todo_list':
          return {
            type: 'item',
            itemType: 'todo_list',
            items: item.items
          };

        case 'error':
          if (isCodexInternalNoticeContent(item.message)) {
            return null;
          }
          return {
            type: 'item',
            itemType: 'error',
            message: {
              role: 'error',
              content: item.message
            }
          };

        default:
          return {
            type: 'item',
            itemType: item.type,
            item: item
          };
      }

    case 'turn.started':
      return {
        type: 'turn_started'
      };

    case 'turn.completed':
      return {
        type: 'turn_complete',
        usage: event.usage
      };

    case 'turn.failed':
      return {
        type: 'turn_failed',
        error: event.error
      };

    case 'thread.started':
      return {
        type: 'thread_started',
        threadId: event.id
      };

    case 'error':
      return {
        type: 'error',
        message: event.message
      };

    default:
      return {
        type: event.type,
        data: event
      };
  }
}

/**
 * Map permission mode to Codex app-server options
 * @param {string} permissionMode - 'default', 'acceptEdits', 'bypassPermissions', 'readOnly', or unsupported 'plan'
 * @returns {object} - { sandboxMode, approvalPolicy }
 */
function mapPermissionModeToCodexOptions(permissionMode) {
  switch (permissionMode) {
    case 'acceptEdits':
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'never'
      };
    case 'bypassPermissions':
      return {
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never'
      };
    case 'readOnly':
      return {
        sandboxMode: 'read-only',
        approvalPolicy: 'never'
      };
    case 'plan':
      // Codex plan mode is not implemented. Fail closed instead of silently
      // falling through to the writable default permission mapping.
      return {
        sandboxMode: 'read-only',
        approvalPolicy: 'never'
      };
    case 'default':
    default:
      return {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'untrusted'
      };
  }
}

function buildCodexInput(command, attachments) {
  const imagePaths = Array.isArray(attachments?.imagePaths)
    ? attachments.imagePaths.filter((value) => typeof value === 'string' && value.trim())
    : [];
  const documentPaths = Array.isArray(attachments?.documentPaths)
    ? attachments.documentPaths.filter((value) => typeof value === 'string' && value.trim())
    : [];

  if (imagePaths.length === 0 && documentPaths.length === 0) {
    return command;
  }

  const textSections = [command];

  if (documentPaths.length > 0) {
    textSections.push(
      `Attached workspace PDF path(s):\n${documentPaths
        .map((filePath) => `- ${filePath}`)
        .join('\n')}`,
    );
  }

  if (imagePaths.length > 0) {
    textSections.push(
      imagePaths.length === 1
        ? 'An image is attached below.'
        : `There are ${imagePaths.length} attached images below.`,
    );
  }

  return [
    { type: 'text', text: textSections.join('\n\n') },
    ...imagePaths.map((filePath) => ({ type: 'localImage', path: filePath })),
  ];
}

async function maybePrependCodexProjectInstructions(command, workingDir) {
  if (!workingDir || !String(command || '').trim()) {
    return String(command || '');
  }

  try {
    await fs.access(getProjectAgentsPath(workingDir));
    return String(command || '');
  } catch {
    // Fall through to backend template fallback injection.
  }

  try {
    const agentsPath = await resolveProjectAgentsPath(workingDir);
    const agentsMd = await fs.readFile(agentsPath, 'utf-8');
    const trimmed = agentsMd.trim();
    if (!trimmed) {
      return String(command || '');
    }
    return `# Project Instructions (AGENTS.md)\n${trimmed}\n\n${String(command || '')}`;
  } catch {
    return String(command || '');
  }
}

async function prepareCodexInput(command, images, cwd) {
  const tempImagePaths = [];
  let tempDir = null;

  if (!Array.isArray(images) || images.length === 0) {
    return { input: command, tempImagePaths, tempDir };
  }

  try {
    const workingDir = cwd || process.cwd();
    tempDir = path.join(workingDir, '.tmp', 'images', Date.now().toString());
    await fs.mkdir(tempDir, { recursive: true });

    const input = [{ type: 'text', text: command }];

    for (const [index, image] of images.entries()) {
      const data = String(image?.data || '');
      const matches = data.match(/^data:([^;]+);base64,(.+)$/);
      if (!matches) {
        continue;
      }

      const [, mimeType, base64Data] = matches;
      const filename = buildTempAttachmentFilename(index, image?.name, mimeType);
      const filepath = path.join(tempDir, filename);

      await fs.writeFile(filepath, Buffer.from(base64Data, 'base64'));
      tempImagePaths.push(filepath);
      input.push({ type: 'localImage', path: filepath });
    }

    return {
      input: input.length > 1 ? input : command,
      tempImagePaths,
      tempDir,
    };
  } catch (error) {
    console.error('[Codex] Failed to prepare image inputs:', error);
    return { input: command, tempImagePaths, tempDir };
  }
}

async function cleanupCodexTempFiles(tempImagePaths, tempDir) {
  if (!Array.isArray(tempImagePaths) || tempImagePaths.length === 0) {
    return;
  }

  for (const filePath of tempImagePaths) {
    try {
      await fs.unlink(filePath);
    } catch {}
  }

  if (tempDir) {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Execute a Codex query with streaming
 * @param {string} command - The prompt to send
 * @param {object} options - Options including cwd, sessionId, model, permissionMode, modelReasoningEffort
 * @param {WebSocket|object} ws - WebSocket connection or response writer
 */
export async function queryCodex(command, options = {}, ws) {
  const {
    sessionId,
    clientSessionId,
    cwd,
    projectPath,
    headless = false,
    model,
    env,
    attachments,
    images,
    permissionMode = 'bypassPermissions',
    modelReasoningEffort,
    reuseExistingAppServer = false,
    sessionMode,
    stageTagKeys,
    stageTagSource = 'task_context',
  } = options;

  const workingDirectory = cwd || projectPath || (headless ? null : process.cwd());
  const resolvedProjectName = workingDirectory ? encodeProjectPath(workingDirectory) : null;
  const requestedSessionId = normalizeCodexSessionId(sessionId);
  const { sandboxMode, approvalPolicy } = mapPermissionModeToCodexOptions(permissionMode);
  const requestedModel = typeof model === 'string' ? model.trim() : '';
  const effectiveModel = isCodexModelSelection(requestedModel)
    ? requestedModel
    : CODEX_MODELS.DEFAULT;
  if (requestedModel && requestedModel !== effectiveModel) {
    console.warn(`[Codex] Ignoring unsupported Codex model "${requestedModel}"; using "${effectiveModel}".`);
  }
  const codexContextWindow = getCodexModelContextWindow(effectiveModel);

  let appServer;
  let threadId = requestedSessionId;
  const fallbackSessionId = typeof clientSessionId === 'string' && clientSessionId.trim()
    ? clientSessionId.trim()
    : null;
  const coordinatedSessionKey = typeof options.sessionKey === 'string' && options.sessionKey.trim()
    ? options.sessionKey.trim()
    : null;
  let currentSessionId = requestedSessionId || fallbackSessionId;
  let activeSessionKey = coordinatedSessionKey
    || currentSessionId
    || `codex-pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let sessionCreatedSent = false;
  let indexedSessionId = null;
  const abortController = new AbortController();
  const sessionStartTime = Date.now();
  let tempImagePaths = [];
  let tempDir = null;
  const emittedLifecyclePhases = new Set();
  const emitLifecycle = (phase, metadata = {}) => {
    if (emittedLifecyclePhases.has(phase)) return;
    emittedLifecyclePhases.add(phase);
    try {
      options.onLifecycleEvent?.({
        phase,
        provider: 'codex',
        sessionId: threadId || currentSessionId || fallbackSessionId,
        ...metadata,
      });
    } catch {}
  };

  try {
    // Synchronous (better-sqlite3) — no await needed.
    if (requestedSessionId && workingDirectory) {
      applyStageTagsToSession({
        sessionId: requestedSessionId,
        projectPath: workingDirectory,
        provider: 'codex',
        stageTagKeys,
        source: stageTagSource,
      });
    }

    // Keep Codex project bootstrap aligned with the other supported agents:
    // initialize shared skill links and workspace templates before starting the thread.
    if (workingDirectory) {
      try {
        await ensureProjectSkillLinks(workingDirectory, { userId: options.userId });
        await writeProjectTemplates(workingDirectory);
      } catch (err) {
        console.warn('[openai-codex] Failed to initialize project skills/templates:', err.message);
      }
    }

    let codexSkillDirs = [];
    try {
      codexSkillDirs = await resolveCodexSkillDirs(options.userId);
    } catch (err) {
      console.warn('[openai-codex] Failed to resolve skill dirs:', err.message);
    }

    let computeBridge = null;
    let workbenchBridge = null;
    try {
      computeBridge = await resolveAgentComputeBridge({
        projectPath: workingDirectory || '',
        nodeId: options.computeNodeId || null,
      });
    } catch (err) {
      console.warn('[openai-codex] Failed to resolve active compute resource:', err.message);
    }
    try {
      // Codex's approval policy is turn-wide, so expose only read tools until it
      // can guarantee per-call confirmation for every workbench mutation.
      workbenchBridge = await resolveWorkbenchBridge({
        userId: options.userId,
        authSessionId: options.authSessionId || null,
        readOnly: true,
      });
    } catch (err) {
      console.warn('[openai-codex] Failed to resolve workbench bridge:', err.message);
    }

    // Initialize one long-lived Codex app-server per authenticated MedHelp user.
    // Skill source directories are exposed through read-only sandbox config.
    // Codex applies another environment filter to shell tools, so explicitly
    // allow only safe environment names plus the managed database API token.
    const agentEnv = await buildMedHelpCodexEnvironment(
      withDatabaseApiAgentEnv(env || process.env, options.userId),
    );
    const requestedSessionAvailability = requestedSessionId
      ? await ensureMedHelpCodexSessionAvailable(requestedSessionId, {
        codexHome: agentEnv.CODEX_HOME,
        env: agentEnv,
      })
      : null;
    const codexSkillReadOnlyConfig = buildCodexSkillReadOnlyConfig(codexSkillDirs);
    const codexShellEnvironmentPolicy = buildCodexShellEnvironmentPolicy(agentEnv, {
      platform: process.platform,
    });
    const codexWindowsCompatibilityConfig = buildCodexWindowsCompatibilityConfig(process.platform);
    const autoCompactTokenLimit = resolveCodexAutoCompactTokenLimit(agentEnv, codexContextWindow);
    const codexConfig = {
      ...(codexSkillReadOnlyConfig || {}),
      ...(codexShellEnvironmentPolicy
        ? { shell_environment_policy: codexShellEnvironmentPolicy }
        : {}),
      ...(codexWindowsCompatibilityConfig || {}),
      ...(autoCompactTokenLimit != null
        ? {
          model_auto_compact_token_limit: autoCompactTokenLimit,
          model_auto_compact_token_limit_scope: 'total',
        }
        : {}),
    };
    if (computeBridge?.mcpServer) {
      codexConfig.mcp_servers = {
        ...(codexConfig.mcp_servers || {}),
        [AGENT_COMPUTE_MCP_SERVER_NAME]: computeBridge.mcpServer,
      };
    }
    if (workbenchBridge?.mcpServer) {
      codexConfig.mcp_servers = {
        ...(codexConfig.mcp_servers || {}),
        [WORKBENCH_MCP_SERVER_NAME]: workbenchBridge.mcpServer,
      };
    }
    appServer = await getCodexAppServerClient({
      userId: options.userId,
      env: agentEnv,
      reuseExistingOnEnvMismatch: reuseExistingAppServer,
    });

    const threadOptions = {
      ...(workingDirectory ? { cwd: workingDirectory } : {}),
      sandbox: sandboxMode,
      approvalPolicy,
      model: effectiveModel,
      ...(Object.keys(codexConfig).length > 0 ? { config: codexConfig } : {}),
    };

    // Start or resume thread
    if (requestedSessionId) {
      const resumedThread = await resumeCodexThread(
        appServer,
        requestedSessionId,
        threadOptions,
        requestedSessionAvailability,
      );
      threadId = normalizeCodexSessionId(resumedThread?.id) || requestedSessionId;
    } else {
      const startedThread = await appServer.startThread({
        ...threadOptions,
        serviceName: 'medhelp',
      });
      threadId = normalizeCodexSessionId(startedThread?.id);
      if (!threadId) {
        throw new Error('Codex app-server did not return a resumable thread id');
      }
    }

    const provisionalSessionId = threadId || currentSessionId;

    // Track the session
    activeCodexSessions.set(activeSessionKey, {
      appServer,
      threadId,
      turnId: null,
      status: 'running',
      abortController,
      startTime: sessionStartTime,
      aliases: new Set([activeSessionKey, coordinatedSessionKey, currentSessionId, threadId].filter(Boolean)),
      pendingSteers: [],
      flushingSteers: false,
    });
    const sessionDisplayName = buildSessionDisplayName(command);

    const getActiveSessionRecord = () =>
      activeCodexSessions.get(activeSessionKey)
      || (currentSessionId ? activeCodexSessions.get(currentSessionId) : null);

    const isFirstTurn = !requestedSessionId;
    const sessionLookup = {
      projectName: resolvedProjectName,
      provider: 'codex',
      ...(options.userId === null || options.userId === undefined
        ? {}
        : { ownerKey: String(options.userId) }),
    };
    const existingSession = requestedSessionId
      ? sessionDb.getSessionById(requestedSessionId, sessionLookup)
      : null;
    const codexSkillTurnNumber = resolveCodexSkillTurnNumber({
      isFirstTurn,
      sessionMetadata: existingSession?.metadata || null,
    });
    let codexSkillTurnMetadataPersisted = false;
    const persistCodexSkillTurnMetadata = (sessionIdForMetadata) => {
      const normalizedSessionId = normalizeCodexSessionId(sessionIdForMetadata);
      if (!normalizedSessionId || codexSkillTurnMetadataPersisted) {
        return;
      }

      try {
        sessionDb.updateSessionMetadata(normalizedSessionId, (metadata) => {
          const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
            ? { ...metadata }
            : {};
          return {
            ...base,
            codexSkillTurnCount: codexSkillTurnNumber,
            codexSkillReminderInterval: CODEX_SKILL_REMINDER_INTERVAL,
          };
        }, sessionLookup);
        codexSkillTurnMetadataPersisted = true;
      } catch (err) {
        console.warn('[openai-codex] Failed to persist Codex skill turn metadata:', err.message);
      }
    };

    const syncCodexSessionIdentity = (resolvedSessionId) => {
      const normalizedSessionId = normalizeCodexSessionId(resolvedSessionId);
      if (!normalizedSessionId) {
        return currentSessionId;
      }

      const previousSessionId = currentSessionId;
      const sessionRecord = getActiveSessionRecord();
      sessionRecord?.aliases?.add(previousSessionId);
      sessionRecord?.aliases?.add(normalizedSessionId);
      if (previousSessionId !== normalizedSessionId) {
        if (!coordinatedSessionKey && sessionRecord && activeSessionKey !== normalizedSessionId) {
          activeCodexSessions.delete(activeSessionKey);
          activeCodexSessions.set(normalizedSessionId, sessionRecord);
          activeSessionKey = normalizedSessionId;
        }
        currentSessionId = normalizedSessionId;

        if (sessionCreatedSent && indexedSessionId && indexedSessionId !== normalizedSessionId && resolvedProjectName) {
          sessionDb.migrateSessionId(indexedSessionId, normalizedSessionId, 'codex', resolvedProjectName);
          indexedSessionId = normalizedSessionId;
        }
      } else if (!coordinatedSessionKey && activeSessionKey !== normalizedSessionId) {
        const sessionRecord = getActiveSessionRecord();
        if (sessionRecord) {
          activeCodexSessions.delete(activeSessionKey);
          activeCodexSessions.set(normalizedSessionId, sessionRecord);
        }
        activeSessionKey = normalizedSessionId;
      }

      if (ws.setSessionId && typeof ws.setSessionId === 'function') {
        ws.setSessionId(normalizedSessionId);
      }

      if (!sessionCreatedSent) {
        if (workingDirectory) {
          recordIndexedSession({
            sessionId: normalizedSessionId,
            provider: 'codex',
            projectPath: workingDirectory,
            sessionMode: sessionMode || 'research',
            displayName: sessionDisplayName,
            stageTagKeys,
            tagSource: stageTagSource,
          });
          indexedSessionId = normalizedSessionId;
        }

        sessionCreatedSent = true;
        sendMessage(ws, {
          type: 'session-created',
          sessionId: normalizedSessionId,
          previousSessionId: previousSessionId && previousSessionId !== normalizedSessionId ? previousSessionId : undefined,
          provider: 'codex',
          mode: sessionMode || 'research',
          startTime: sessionStartTime,
          projectName: resolvedProjectName || undefined,
          displayName: sessionDisplayName || 'Codex Session',
        });
      }

      persistCodexSkillTurnMetadata(normalizedSessionId);
      return normalizedSessionId;
    };

    if (provisionalSessionId) {
      syncCodexSessionIdentity(provisionalSessionId);
    }

    const preferenceCommand = prependUserPreferenceMemoryToPrompt(
      command,
      options.userId,
      {
        fallbackCommand: 'Continue with the current task.',
        analysisLanguage: options.analysisLanguage,
        projectPath: workingDirectory || null,
        projectKey: options.projectName || null,
        preferenceContext: options.userPreferenceContext || null,
      },
    );
    const computeAwareCommand = prependWorkbenchContext(
      prependAgentComputeContext(preferenceCommand, computeBridge),
      workbenchBridge,
    );
    const instructedCommand = isFirstTurn
      ? await maybePrependCodexProjectInstructions(computeAwareCommand, workingDirectory)
      : computeAwareCommand;
    const skillsSection = buildCodexSkillsPromptForTurn(codexSkillDirs, {
      isFirstTurn,
      turnNumber: codexSkillTurnNumber,
      interval: CODEX_SKILL_REMINDER_INTERVAL,
    });
    const effectiveCommand = assembleCodexTurnPrompt({
      isFirstTurn,
      skillsSection,
      instructedCommand,
      plainCommand: preferenceCommand,
    });

    const preparedInput = await prepareCodexInput(effectiveCommand, images, workingDirectory);
    tempImagePaths = preparedInput.tempImagePaths;
    tempDir = preparedInput.tempDir;

    // Execute with streaming
    // Prefer pre-uploaded attachments (buildCodexInput) over base64 temp images (prepareCodexInput)
    const codexInput = attachments
      ? buildCodexInput(effectiveCommand, attachments)
      : preparedInput.input;
    const appServerInput = typeof codexInput === 'string'
      ? [{ type: 'text', text: codexInput }]
      : codexInput;
    emitLifecycle('preprocessing_completed', { sessionId: currentSessionId });
    const streamedTurn = await appServer.runTurn({
      threadId,
      input: appServerInput,
      turnOptions: {
        ...(workingDirectory ? { cwd: workingDirectory } : {}),
        model: effectiveModel,
        ...(modelReasoningEffort ? { effort: modelReasoningEffort } : {}),
        approvalPolicy,
      },
      signal: abortController.signal,
    });
    const runningSession = getActiveSessionRecord();
    if (runningSession) {
      runningSession.turnId = streamedTurn.turnId;
      runningSession.flushingSteers = true;
      try {
        while (runningSession.pendingSteers.length > 0) {
          const pendingCommand = runningSession.pendingSteers.shift();
          await runningSession.appServer.steerTurn({
            threadId: runningSession.threadId,
            turnId: runningSession.turnId,
            input: [{ type: 'text', text: pendingCommand }],
          });
        }
      } finally {
        runningSession.flushingSteers = false;
      }
    }

    // Track items we've already sent to avoid duplicates
    const sentItems = new Map(); // itemId -> lifecycle stage

    for await (const event of streamedTurn.events) {
      const discoveredSessionId =
        (event.type === 'thread.started' ? event.id : null)
        || threadId
        || currentSessionId;
      if (discoveredSessionId) {
        syncCodexSessionIdentity(discoveredSessionId);
      }
      if (event.type === 'turn.started') {
        emitLifecycle('turn_started', { sessionId: discoveredSessionId });
      }

      // Check if session was aborted
      const session = getActiveSessionRecord();
      if (!session || session.status === 'aborted') {
        break;
      }

      const itemType = event.item?.type || 'unknown';
      const itemId = event.item?.id || null;

      // Detailed debug logging. Per-delta cumulative text logging can produce
      // tens of thousands of lines during a long turn and compete with the UI
      // renderer, so keep it behind an explicit diagnostic flag.
      if (event.item) {
        const preview = event.item.text ? event.item.text.substring(0, 80) : (event.item.command || '');
        if (event.type !== 'item.updated' || process.env.MEDHELP_DEBUG_CODEX_STREAM === '1') {
          console.log(`[Codex] ${event.type} | ${itemType} | id=${itemId} | preview="${preview}"`);
        }
        // Extra logging for command_execution output
        if (itemType === 'command_execution' && event.type === 'item.completed') {
          const outLen = event.item.aggregated_output?.length || 0;
          const outPreview = event.item.aggregated_output?.substring(0, 120) || '(empty)';
          console.log(`[Codex]   cmd output (${outLen} chars): "${outPreview}"`);
        }
      } else {
        console.log(`[Codex] ${event.type}`);
      }

      // Event filtering:
      // - item.updated: keep agent text, reasoning activity, and plan snapshots;
      //   skip other noisy tool updates
      // - item.started: forward tool-type items immediately so they appear in UI
      // - item.completed: always forward (final state with results)
      if (event.type === 'item.updated' && !['agent_message', 'reasoning', 'todo_list'].includes(itemType)) {
        continue;
      }

      if (event.type === 'item.started') {
        const toolTypes = new Set(['reasoning', 'command_execution', 'file_change', 'mcp_tool_call', 'web_search']);
        if (!toolTypes.has(itemType)) {
          continue;
        }
        if (itemId) sentItems.set(itemId, 'started');
      }

      if (event.type === 'item.completed' && itemId) {
        sentItems.set(itemId, 'completed');
      }

      const transformed = transformCodexEvent(event);

      // Skip null transforms (empty reasoning, etc.)
      if (!transformed) {
        console.log(`[Codex] Skipped null transform for ${event.type} | ${itemType}`);
        continue;
      }

      if (
        transformed.type === 'item'
        && transformed.itemType === 'agent_message'
        && typeof transformed.message?.content === 'string'
        && transformed.message.content.trim()
      ) {
        emitLifecycle('first_text', { sessionId: currentSessionId });
      }

      // Add lifecycle info for frontend dedup
      if (itemId) {
        transformed.itemId = itemId;
        transformed.lifecycle = event.type === 'item.started' ? 'started'
          : event.type === 'item.updated' ? 'updated'
          : event.type === 'item.completed' ? 'completed' : 'other';
      }

      // Add startTime for frontend timer synchronization
      const activeSession = currentSessionId ? activeCodexSessions.get(currentSessionId) : null;
      if (Number.isFinite(activeSession?.startTime)) {
        transformed.startTime = activeSession.startTime;
      }

      // For error/turn.failed events, send codex-error instead of codex-response
      // to trigger the error UI with retry button (avoid sending both).
      if (event.type === 'error' || event.type === 'turn.failed') {
        const errorCode = event.error?.code || event.error?.type || '';
        const errorMsg = event.error?.message || event.message || String(event.error || '');
        if (isCodexInternalNoticeContent(errorMsg || errorCode)) {
          console.log('[Codex] Suppressed internal notice:', errorMsg || errorCode);
          continue;
        }
        const { errorType, isRetryable } = errorCode
          ? classifySDKError(errorCode, 'codex')
          : classifyError(errorMsg);
        sendMessage(ws, {
          type: 'codex-error',
          error: errorMsg || errorCode,
          errorType,
          isRetryable,
          sessionId: currentSessionId,
        });
        if (event.type === 'turn.failed') {
          emitLifecycle('completed', { sessionId: currentSessionId, outcome: 'failed' });
        }
        continue;
      }

      sendMessage(ws, {
        type: 'codex-response',
        data: transformed,
        sessionId: currentSessionId
      });

      // Extract and send token usage if available (normalized to match Claude format)
      if (event.type === 'turn.completed' && event.usage) {
        sendMessage(ws, {
          type: 'token-budget',
          data: buildCodexRealtimeTokenBudget(
            event.usage,
            event.usage?.model_context_window || codexContextWindow,
          ),
          sessionId: currentSessionId
        });
      }
      if (event.type === 'turn.completed') {
        emitLifecycle('completed', {
          sessionId: currentSessionId,
          outcome: event.status || 'completed',
          contextTokens: event.usage?.current_context_usage?.total_tokens,
        });
      }
    }

    const actualSessionId = syncCodexSessionIdentity(threadId || currentSessionId);

    // Send completion event immediately so the UI can settle
    sendMessage(ws, {
      type: 'codex-complete',
      sessionId: actualSessionId || currentSessionId,
      actualSessionId
    });

    // Post-completion housekeeping — runs after the UI receives the completion signal
    if (workingDirectory && actualSessionId && sessionMode !== 'consultation') {
      try {
        await reconcileCodexSessionIndex(workingDirectory, {
          sessionId: actualSessionId,
          previousSessionId: indexedSessionId && indexedSessionId !== actualSessionId ? indexedSessionId : null,
          projectName: resolvedProjectName,
        });
        if (indexedSessionId && indexedSessionId !== actualSessionId) {
          sessionDb.deleteSession(indexedSessionId, sessionLookup);
        }
      } catch (error) {
        console.warn(`[Codex] Failed to reconcile indexed session ${actualSessionId}:`, error.message);
      }
    }

  } catch (error) {
    const session = activeCodexSessions.get(activeSessionKey) || (currentSessionId ? activeCodexSessions.get(currentSessionId) : null);
    const wasAborted =
      session?.status === 'aborted' ||
      error?.name === 'AbortError' ||
      String(error?.message || '').toLowerCase().includes('aborted');
    emitLifecycle('completed', {
      sessionId: currentSessionId,
      outcome: wasAborted ? 'aborted' : 'error',
    });

    if (!wasAborted) {
      if (isCodexInternalNoticeContent(error?.message)) {
        console.log('[Codex] Suppressed internal notice:', error.message);
        sendMessage(ws, {
          type: 'codex-complete',
          sessionId: currentSessionId,
          actualSessionId: currentSessionId,
        });
        return;
      }
      console.error('[Codex] Error:', error);
      const { errorType, isRetryable } = classifyError(error.message);

      sendMessage(ws, {
        type: 'codex-error',
        error: error.message,
        errorType,
        isRetryable,
        sessionId: currentSessionId
      });
    }

  } finally {
    const finalSession = activeCodexSessions.get(activeSessionKey) || (currentSessionId ? activeCodexSessions.get(currentSessionId) : null);
    emitLifecycle('completed', {
      sessionId: currentSessionId,
      outcome: finalSession?.status === 'aborted' ? 'aborted' : 'completed',
    });
    await cleanupCodexTempFiles(tempImagePaths, tempDir);

    // Update session status
    const session = activeCodexSessions.get(activeSessionKey) || (currentSessionId ? activeCodexSessions.get(currentSessionId) : null);
    if (session) {
      session.status = session.status === 'aborted' ? 'aborted' : 'completed';
    }
  }
}

/**
 * Abort an active Codex session
 * @param {string} sessionId - Session ID to abort
 * @returns {boolean} - Whether abort was successful
 */
export function abortCodexSession(sessionId) {
  const session = findActiveCodexSession(sessionId);

  if (!session) {
    return false;
  }

  session.status = 'aborted';
  try {
    session.abortController?.abort();
  } catch (error) {
    console.warn(`[Codex] Failed to abort session ${sessionId}:`, error);
  }

  return true;
}

function findActiveCodexSession(sessionId) {
  const direct = activeCodexSessions.get(sessionId);
  if (direct?.status === 'running') return direct;

  const matches = new Set();
  for (const session of activeCodexSessions.values()) {
    if (
      session?.status === 'running'
      && (session.threadId === sessionId || session.aliases?.has(sessionId))
    ) {
      matches.add(session);
    }
  }
  return matches.size === 1 ? [...matches][0] : null;
}

/**
 * Append a user instruction to an active Codex turn without interrupting it.
 * Messages received while turn/start is still resolving are buffered and
 * flushed in arrival order as soon as the active turn id is available.
 */
export async function steerCodexSession(sessionId, command) {
  const normalizedCommand = typeof command === 'string' ? command.trim() : '';
  const session = findActiveCodexSession(sessionId);
  if (!session || !normalizedCommand) {
    return { success: false, error: session ? 'EMPTY_MESSAGE' : 'SESSION_NOT_ACTIVE' };
  }

  if (!session.turnId || session.flushingSteers) {
    session.pendingSteers.push(normalizedCommand);
    return {
      success: true,
      pending: true,
      sessionId: session.threadId || sessionId,
      turnId: session.turnId || null,
    };
  }

  await session.appServer.steerTurn({
    threadId: session.threadId,
    turnId: session.turnId,
    input: [{ type: 'text', text: normalizedCommand }],
  });
  return {
    success: true,
    pending: false,
    sessionId: session.threadId || sessionId,
    turnId: session.turnId,
  };
}

/**
 * Start native Codex context compaction for an idle persisted thread.
 * This uses the app-server protocol rather than adding a visible chat message.
 */
export async function compactCodexSession(sessionId, { userId, env = process.env } = {}) {
  const normalizedSessionId = normalizeCodexSessionId(sessionId);
  if (!normalizedSessionId) {
    const error = new Error('A valid Codex session id is required.');
    error.statusCode = 400;
    throw error;
  }

  const activeSession = findActiveCodexSession(normalizedSessionId);
  if (activeSession) {
    const error = new Error('Wait for the active turn to finish before compacting context.');
    error.statusCode = 409;
    throw error;
  }

  let sessionRecord = activeCodexSessions.get(normalizedSessionId) || null;
  if (!sessionRecord) {
    for (const candidate of activeCodexSessions.values()) {
      if (candidate?.threadId === normalizedSessionId || candidate?.aliases?.has(normalizedSessionId)) {
        sessionRecord = candidate;
        break;
      }
    }
  }

  const agentEnv = await buildMedHelpCodexEnvironment(withDatabaseApiAgentEnv(env, userId));
  const sessionAvailability = await ensureMedHelpCodexSessionAvailable(normalizedSessionId, {
    codexHome: agentEnv.CODEX_HOME,
    env: agentEnv,
  });
  const client = sessionRecord?.appServer || await getCodexAppServerClient({ userId, env: agentEnv });
  if (!sessionRecord?.threadId) {
    await resumeCodexThread(client, normalizedSessionId, {}, sessionAvailability);
  }
  await client.request('thread/compact/start', { threadId: normalizedSessionId }, { timeoutMs: 120_000 });

  return { success: true, sessionId: normalizedSessionId };
}

async function getPersistedCodexThreadClient(sessionId, { userId, env = process.env } = {}) {
  const normalizedSessionId = normalizeCodexSessionId(sessionId);
  if (!normalizedSessionId) throw new Error('A valid Codex session id is required.');
  if (findActiveCodexSession(normalizedSessionId)) {
    const error = new Error('Wait for the active turn to finish before forking this conversation.');
    error.statusCode = 409;
    throw error;
  }
  const agentEnv = await buildMedHelpCodexEnvironment(withDatabaseApiAgentEnv(env, userId));
  const availability = await ensureMedHelpCodexSessionAvailable(normalizedSessionId, {
    codexHome: agentEnv.CODEX_HOME,
    env: agentEnv,
  });
  const client = await getCodexAppServerClient({ userId, env: agentEnv });
  await resumeCodexThread(client, normalizedSessionId, {}, availability);
  return { client, sessionId: normalizedSessionId };
}

export async function readCodexSessionThread(sessionId, options = {}) {
  const persisted = await getPersistedCodexThreadClient(sessionId, options);
  const thread = await persisted.client.readThread(persisted.sessionId);
  if (!thread) throw new Error('Codex could not read this conversation.');
  return thread;
}

export async function forkCodexSession(sessionId, { pointId, userId, env = process.env } = {}) {
  const persisted = await getPersistedCodexThreadClient(sessionId, { userId, env });
  const thread = await persisted.client.forkThread(persisted.sessionId, {
    ...(pointId ? { lastTurnId: pointId } : {}),
  });
  if (!thread?.id) throw new Error('Codex did not return the forked session id.');
  return { sessionId: thread.id };
}

export async function shutdownCodexRuntime() {
  for (const sessionId of getActiveCodexSessions()) {
    abortCodexSession(sessionId);
  }
  await shutdownCodexAppServers();
}

/**
 * Check if a session is active
 * @param {string} sessionId - Session ID to check
 * @returns {boolean} - Whether session is active
 */
export function isCodexSessionActive(sessionId) {
  const session = findActiveCodexSession(sessionId);
  return session?.status === 'running';
}

/**
 * Get the start time of a Codex session
 * @param {string} sessionId - Session ID
 * @returns {number|null} Start time in ms or null
 */
export function getCodexSessionStartTime(sessionId) {
  const session = findActiveCodexSession(sessionId);
  return session ? session.startTime : null;
}

/**
 * Get all active sessions
 * @returns {Array<string>} - Array of active session IDs
 */
export function getActiveCodexSessions() {
  const sessionIds = [];

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status === 'running') {
      sessionIds.push(id);
    }
  }

  return sessionIds;
}

/**
 * Helper to send message via WebSocket or writer
 * @param {WebSocket|object} ws - WebSocket or response writer
 * @param {object} data - Data to send
 */
function sendMessage(ws, data) {
  try {
    if (ws.isSSEStreamWriter || ws.isWebSocketWriter) {
      // Writer handles stringification (SSEStreamWriter or WebSocketWriter)
      ws.send(data);
    } else if (typeof ws.send === 'function') {
      // Raw WebSocket - stringify here
      ws.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error('[Codex] Error sending message:', error);
  }
}

// Clean up old completed sessions periodically
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 minutes

  for (const [id, session] of activeCodexSessions.entries()) {
    if (session.status !== 'running') {
      const startTime = typeof session.startTime === 'number' ? session.startTime : Number.NaN;
      if (Number.isFinite(startTime) && now - startTime > maxAge) {
        activeCodexSessions.delete(id);
      }
    }
  }
}, 5 * 60 * 1000); // Every 5 minutes
