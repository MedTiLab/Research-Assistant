/**
 * Local GPU Provider — Run open-source models via Ollama
 * =======================================================
 *
 * Connects to a local Ollama server to run models on the user's own GPU.
 * Uses the OpenAI-compatible chat completions API that Ollama exposes.
 * Reuses the same agentic tool loop as the hosted agent providers (file I/O, shell, search).
 */

import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { encodeProjectPath, ensureProjectSkillLinks, reconcileLocalGPUSessionIndex } from './projects.js';
import { resolveProjectAgentsPath, writeProjectTemplates } from './templates/index.js';
import { classifyError } from '../shared/errorClassifier.js';
import { applyStageTagsToSession, recordIndexedSession } from './utils/sessionIndex.js';
import { createRequestId, waitForToolApproval, matchesToolPermission } from './utils/permissions.js';
import { buildSessionDisplayName } from './utils/sessionFormatting.js';
import { prependUserPreferenceMemoryToPrompt } from './utils/userPreferenceMemory.js';
import { getAllowedDataFoldersAgentEnv } from './utils/databaseApiAgentEnv.js';
import {
  ensureProjectProviderSessionFile,
  findProviderSessionFile,
} from './utils/storagePaths.js';

const execAsync = promisify(exec);

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const MAX_AGENT_TURNS = 30;
const BASH_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 100_000;
const SESSIONS_DIR_NAME = 'localgpu-sessions';

const activeLocalGPUSessions = new Map();

// ---------------------------------------------------------------------------
// GPU Detection
// ---------------------------------------------------------------------------

export async function detectGPUs() {
  const result = { gpus: [], system: {} };

  try {
    const { stdout } = await execAsync(
      'nvidia-smi --query-gpu=index,name,memory.total,memory.used,utilization.gpu,temperature.gpu --format=csv,noheader,nounits',
      { timeout: 10000 },
    );
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const [index, name, memTotal, memUsed, util, temp] = line.split(',').map((s) => s.trim());
      result.gpus.push({
        id: `gpu-${index}`,
        index: parseInt(index, 10),
        name,
        memory: `${memUsed} / ${memTotal} MiB`,
        memoryTotal: parseInt(memTotal, 10),
        memoryUsed: parseInt(memUsed, 10),
        utilization: parseInt(util, 10),
        temperature: parseInt(temp, 10),
      });
    }

    try {
      const { stdout: driverOut } = await execAsync('nvidia-smi --query-gpu=driver_version --format=csv,noheader', { timeout: 5000 });
      result.system.driver = driverOut.trim().split('\n')[0];
    } catch {}

    try {
      const { stdout: cudaOut } = await execAsync('nvcc --version 2>/dev/null | grep release', { timeout: 5000 });
      const match = cudaOut.match(/release ([\d.]+)/);
      if (match) result.system.cuda = match[1];
    } catch {}
  } catch {
    try {
      const { stdout } = await execAsync('system_profiler SPDisplaysDataType -json', { timeout: 10000 });
      const data = JSON.parse(stdout);
      const displays = data?.SPDisplaysDataType || [];
      for (const [idx, gpu] of displays.entries()) {
        const name = gpu.sppci_model || gpu._name || 'Unknown GPU';
        const vram = gpu.sppci_vram || gpu.spdisplays_vram || 'N/A';
        result.gpus.push({
          id: `gpu-${idx}`,
          index: idx,
          name,
          memory: typeof vram === 'string' ? vram : `${vram} MB`,
        });
      }
      result.system.platform = 'apple_silicon';
    } catch {}
  }

  return result;
}

// ---------------------------------------------------------------------------
// Ollama helpers
// ---------------------------------------------------------------------------

function getOllamaUrl(options) {
  return (options?.serverUrl || process.env.LOCAL_GPU_SERVER_URL || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
}

export async function checkOllamaStatus(serverUrl) {
  const url = (serverUrl || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { running: false, error: `Server returned ${res.status}` };
    const data = await res.json();
    return { running: true, models: (data.models || []).map(formatOllamaModel) };
  } catch (err) {
    return { running: false, error: err.message };
  }
}

function formatOllamaModel(model) {
  const sizeMatch = model.details?.parameter_size?.match(/([\d.]+)([BM])/i);
  let sizeB = null;
  if (sizeMatch) {
    sizeB = sizeMatch[2].toUpperCase() === 'B'
      ? parseFloat(sizeMatch[1])
      : parseFloat(sizeMatch[1]) / 1000;
  }
  return {
    name: model.name,
    displayName: model.name.split(':')[0],
    size: model.details?.parameter_size || null,
    sizeB,
    family: model.details?.family || null,
    quantization: model.details?.quantization_level || null,
    modifiedAt: model.modified_at,
  };
}

export async function pullOllamaModel(serverUrl, modelName) {
  const url = (serverUrl || DEFAULT_OLLAMA_URL).replace(/\/+$/, '');
  const res = await fetch(`${url}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: modelName, stream: false }),
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to pull model: ${body}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'Read',
      description: 'Read the contents of a file at the given path. Returns numbered lines.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or project-relative file path' },
          offset: { type: 'integer', description: 'Start line (1-indexed). Omit to read from the beginning.' },
          limit: { type: 'integer', description: 'Max lines to return. Omit to read the whole file.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Write',
      description: 'Create or overwrite a file with the given contents.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute or project-relative file path' },
          contents: { type: 'string', description: 'Full file contents to write' },
        },
        required: ['path', 'contents'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Edit',
      description: 'Replace an exact string in a file with a new string.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_string: { type: 'string', description: 'The exact text to find (must be unique in the file)' },
          new_string: { type: 'string', description: 'The replacement text' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Bash',
      description: 'Execute a shell command and return stdout + stderr.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run' },
          cwd: { type: 'string', description: 'Working directory (optional)' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Glob',
      description: 'Find files matching a glob pattern. Returns matching file paths.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern, e.g. "**/*.py"' },
          directory: { type: 'string', description: 'Directory to search in (optional)' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Search',
      description: 'Search file contents for a regex pattern using ripgrep.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern' },
          directory: { type: 'string', description: 'Directory to search in (optional)' },
          include: { type: 'string', description: 'Glob to filter files, e.g. "*.ts"' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'LS',
      description: 'List files and directories in a directory.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path to list' },
        },
        required: ['path'],
      },
    },
  },
];

const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Search', 'LS']);

// ---------------------------------------------------------------------------
// WebSocket helper
// ---------------------------------------------------------------------------

function sendMessage(ws, data) {
  try {
    if (ws.isSSEStreamWriter || ws.isWebSocketWriter) {
      ws.send(data);
    } else if (typeof ws.send === 'function') {
      ws.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error('[LocalGPU] Error sending message:', error.message);
  }
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

async function executeTool(name, args, cwd) {
  try {
    if (name === 'Read') {
      const filePath = path.isAbsolute(args.path) ? args.path : path.resolve(cwd, args.path);
      const raw = await fs.readFile(filePath, 'utf-8');
      const lines = raw.split('\n');
      const start = Math.max(0, (args.offset || 1) - 1);
      const end = args.limit ? start + args.limit : lines.length;
      return lines
        .slice(start, end)
        .map((line, index) => `${start + index + 1}|${line}`)
        .join('\n')
        .slice(0, MAX_OUTPUT_CHARS);
    }

    if (name === 'Write') {
      const filePath = path.isAbsolute(args.path) ? args.path : path.resolve(cwd, args.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, args.contents, 'utf-8');
      return `File written: ${filePath}`;
    }

    if (name === 'Edit') {
      const filePath = path.isAbsolute(args.path) ? args.path : path.resolve(cwd, args.path);
      const raw = await fs.readFile(filePath, 'utf-8');
      if (!raw.includes(args.old_string)) return `Error: old_string not found in ${filePath}`;
      const count = raw.split(args.old_string).length - 1;
      if (count > 1) return `Error: old_string found ${count} times in ${filePath} — must be unique`;
      await fs.writeFile(filePath, raw.replace(args.old_string, args.new_string), 'utf-8');
      return `File edited: ${filePath}`;
    }

    if (name === 'Bash') {
      const execCwd = args.cwd ? (path.isAbsolute(args.cwd) ? args.cwd : path.resolve(cwd, args.cwd)) : cwd;
      const { stdout, stderr } = await execAsync(args.command, {
        cwd: execCwd,
        timeout: BASH_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      });
      return (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).slice(0, MAX_OUTPUT_CHARS);
    }

    if (name === 'Glob') {
      const dir = args.directory
        ? (path.isAbsolute(args.directory) ? args.directory : path.resolve(cwd, args.directory))
        : cwd;
      const { stdout } = await execAsync(
        `find ${JSON.stringify(dir)} -path ${JSON.stringify(args.pattern)} -type f 2>/dev/null | head -200`,
        { cwd: dir, timeout: 15000 },
      );
      return stdout.trim() || 'No files matched.';
    }

    if (name === 'Search') {
      const dir = args.directory
        ? (path.isAbsolute(args.directory) ? args.directory : path.resolve(cwd, args.directory))
        : cwd;
      const includeFlag = args.include ? `--glob ${JSON.stringify(args.include)}` : '';
      const { stdout } = await execAsync(
        `rg --max-count 50 --line-number ${includeFlag} ${JSON.stringify(args.pattern)} ${JSON.stringify(dir)} 2>/dev/null | head -200`,
        { cwd: dir, timeout: 15000 },
      );
      return stdout.trim() || 'No results.';
    }

    if (name === 'LS') {
      const dir = path.isAbsolute(args.path) ? args.path : path.resolve(cwd, args.path);
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries
        .map((entry) => `${entry.isDirectory() ? '[DIR] ' : ''}${entry.name}`)
        .join('\n')
        .slice(0, MAX_OUTPUT_CHARS);
    }

    return `Error: Unknown tool "${name}"`;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

// ---------------------------------------------------------------------------
// Permission checking
// ---------------------------------------------------------------------------

async function checkToolPermission(
  toolName, args, permissionMode, allowedTools, disallowedTools, ws, sessionId, skipAll,
) {
  if (skipAll || permissionMode === 'bypassPermissions') return true;
  if (READ_ONLY_TOOLS.has(toolName)) return true;
  if (permissionMode === 'plan') return false;

  for (const pattern of disallowedTools) {
    if (matchesToolPermission(toolName, args, pattern)) return false;
  }
  for (const pattern of allowedTools) {
    if (matchesToolPermission(toolName, args, pattern)) return true;
  }

  if (permissionMode === 'acceptEdits' && (toolName === 'Write' || toolName === 'Edit')) return true;

  const requestId = createRequestId();
  sendMessage(ws, {
    type: 'claude-permission-request',
    requestId,
    sessionId,
    tool: toolName,
    input: args,
  });

  const decision = await waitForToolApproval(requestId, 300_000);
  return decision?.allow === true;
}

// ---------------------------------------------------------------------------
// Session persistence
// ---------------------------------------------------------------------------

async function appendSession(sessionId, entry, projectPath) {
  if (!sessionId || sessionId.startsWith('new-session-') || sessionId.startsWith('temp-')) return;
  const sessionFilePath = await ensureProjectProviderSessionFile({
    projectPath,
    providerDirName: SESSIONS_DIR_NAME,
    sessionId,
  });
  await fs.appendFile(
    sessionFilePath,
    JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n',
    'utf-8',
  );
}

async function loadHistory(sessionId, projectPath) {
  if (!sessionId) return [];
  try {
    const sessionFilePath = await findProviderSessionFile({
      projectPath,
      providerDirName: SESSIONS_DIR_NAME,
      sessionId,
    });
    if (!sessionFilePath) {
      return [];
    }

    const raw = await fs.readFile(sessionFilePath, 'utf-8');
    const messages = [];
    for (const line of raw.trim().split('\n').filter(Boolean)) {
      const entry = JSON.parse(line);
      if (entry.role === 'user') messages.push({ role: 'user', content: entry.content });
      else if (entry.role === 'assistant') {
        const message = { role: 'assistant', content: entry.content || null };
        if (entry.tool_calls) message.tool_calls = entry.tool_calls;
        messages.push(message);
      } else if (entry.role === 'tool') {
        messages.push({ role: 'tool', tool_call_id: entry.tool_call_id, content: entry.content });
      }
    }
    return messages;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Streaming API call
// ---------------------------------------------------------------------------

async function streamApiCall(baseUrl, model, messages, tools, signal) {
  const body = { model, messages, stream: true };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  return fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

async function consumeStream(response, { onText, onAbortCheck }) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolCalls = {};
  let finishReason = null;
  let usage = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (onAbortCheck?.()) {
      reader.cancel();
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const payload = trimmed.slice(6);
      if (payload === '[DONE]') continue;

      try {
        const parsed = JSON.parse(payload);
        if (parsed.usage) usage = parsed.usage;
        const choice = parsed.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;

        const delta = choice.delta;
        if (delta?.content) {
          content += delta.content;
          onText?.(delta.content);
        }
        if (delta?.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const index = toolCall.index;
            if (!toolCalls[index]) toolCalls[index] = { id: '', name: '', arguments: '' };
            if (toolCall.id) toolCalls[index].id = toolCall.id;
            if (toolCall.function?.name) toolCalls[index].name = toolCall.function.name;
            if (toolCall.function?.arguments) toolCalls[index].arguments += toolCall.function.arguments;
          }
        }
      } catch {}
    }
  }

  return {
    content,
    toolCalls: Object.values(toolCalls).filter((toolCall) => toolCall.id && toolCall.name),
    finishReason,
    usage,
  };
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

async function buildSystemPrompt(workingDir) {
  const parts = [
    `You are a powerful agentic AI research assistant running on a local GPU. You operate in the project directory: ${workingDir}`,
    '',
    'You have access to tools for reading/writing files, running shell commands, and searching the codebase.',
    'Use tools proactively to accomplish tasks. Always read files before editing them.',
    'Be concise and focus on the task at hand.',
  ];

  try {
    const agentsPath = await resolveProjectAgentsPath(workingDir);
    const agentsMd = await fs.readFile(agentsPath, 'utf-8');
    if (agentsMd.trim()) {
      parts.push('', '## Project Instructions (AGENTS.md)', agentsMd.trim());
    }
  } catch {}

  const dataFolderEnv = getAllowedDataFoldersAgentEnv();
  if (dataFolderEnv.MEDHELP_ALLOWED_DATA_FOLDERS) {
    parts.push(
      '',
      '## Allowed Data Folders',
      'The user has explicitly registered these workspace-external data folders as readable for local data work. Use them when a task asks for local datasets, Web_database, database/data/sources, or raw database inspection. Do not assume these paths unless they are listed here.',
      `MEDHELP_ALLOWED_DATA_FOLDERS=${dataFolderEnv.MEDHELP_ALLOWED_DATA_FOLDERS}`,
    );
    if (dataFolderEnv.MEDHELP_LOCAL_DATABASE_APP_ROOT) {
      parts.push(`MEDHELP_LOCAL_DATABASE_APP_ROOT=${dataFolderEnv.MEDHELP_LOCAL_DATABASE_APP_ROOT}`);
    }
    if (dataFolderEnv.MEDHELP_LOCAL_DATABASE_RAW_ROOT) {
      parts.push(`MEDHELP_LOCAL_DATABASE_RAW_ROOT=${dataFolderEnv.MEDHELP_LOCAL_DATABASE_RAW_ROOT}`);
    }
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function queryLocalGPU(command, options = {}, ws) {
  const {
    sessionId,
    cwd,
    projectPath,
    model = 'qwen3-32b',
    env,
    sessionMode,
    stageTagKeys,
    stageTagSource = 'task_context',
    systemPrompt: customSystemPrompt,
    permissionMode = 'bypassPermissions',
    toolsSettings,
  } = options;

  const workingDirectory = cwd || projectPath || process.cwd();
  const ollamaUrl = getOllamaUrl(options);

  try {
    const check = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!check.ok) throw new Error(`Ollama returned ${check.status}`);
  } catch (err) {
    sendMessage(ws, {
      type: 'localgpu-error',
      error: `Cannot reach Ollama at ${ollamaUrl}. Make sure Ollama is running (ollama serve). Error: ${err.message}`,
      errorType: 'auth',
      isRetryable: false,
      sessionId,
    });
    return;
  }

  const currentSessionId = sessionId || `localgpu-${crypto.randomUUID()}`;
  const abortController = new AbortController();
  const allowedTools = [...(toolsSettings?.allowedTools || [])];
  const disallowedTools = [...(toolsSettings?.disallowedTools || [])];

  try {
    if (workingDirectory) {
      try {
        await ensureProjectSkillLinks(workingDirectory, { userId: options.userId });
        await writeProjectTemplates(workingDirectory);
      } catch (err) {
        console.warn('[LocalGPU] Project template init warning:', err.message);
      }
    }

    if (sessionId && workingDirectory) {
      applyStageTagsToSession({
        sessionId,
        projectPath: workingDirectory,
        provider: 'local',
        stageTagKeys,
        source: stageTagSource,
      });
    }

    activeLocalGPUSessions.set(currentSessionId, {
      status: 'running',
      abortController,
      startTime: Date.now(),
    });

    const sessionDisplayName = buildSessionDisplayName(command);
    const effectiveCommand = prependUserPreferenceMemoryToPrompt(
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

    if (workingDirectory) {
      recordIndexedSession({
        sessionId: currentSessionId,
        provider: 'local',
        projectPath: workingDirectory,
        sessionMode: sessionMode || 'research',
        displayName: sessionDisplayName,
        stageTagKeys,
        tagSource: stageTagSource,
      });
    }

    sendMessage(ws, {
      type: 'session-created',
      sessionId: currentSessionId,
      provider: 'local',
      mode: sessionMode || 'research',
      startTime: activeLocalGPUSessions.get(currentSessionId).startTime,
      displayName: sessionDisplayName || 'Local GPU Session',
      projectName: workingDirectory ? encodeProjectPath(workingDirectory) : undefined,
    });

    const systemContent = customSystemPrompt || await buildSystemPrompt(workingDirectory);
    const messages = [{ role: 'system', content: systemContent }];

    if (sessionId) {
      const history = await loadHistory(sessionId, workingDirectory);
      if (history.length) {
        console.log(`[LocalGPU] Resumed session ${sessionId} with ${history.length} history messages`);
        messages.push(...history);
      }
    }

    messages.push({ role: 'user', content: effectiveCommand });
    await appendSession(currentSessionId, { role: 'user', content: effectiveCommand }, workingDirectory).catch(() => {});

    const tools = permissionMode === 'plan'
      ? TOOL_SCHEMAS.filter((tool) => READ_ONLY_TOOLS.has(tool.function.name))
      : TOOL_SCHEMAS;

    let turn = 0;
    let noToolFallback = false;
    let cumulativeTokens = 0;
    const contextWindow = 32000;

    while (turn < MAX_AGENT_TURNS) {
      turn++;
      const session = activeLocalGPUSessions.get(currentSessionId);
      if (!session || session.status === 'aborted') break;

      console.log(`[LocalGPU] Turn ${turn}/${MAX_AGENT_TURNS} · model=${model} · msgs=${messages.length} · server=${ollamaUrl}`);

      const response = await streamApiCall(
        ollamaUrl,
        model,
        messages,
        noToolFallback ? [] : tools,
        abortController.signal,
      );

      if (!response.ok) {
        const body = await response.text();
        let message = `Local GPU API error (${response.status})`;
        try {
          const parsed = JSON.parse(body);
          message = parsed.error?.message || parsed.error || message;
        } catch {}

        if (!noToolFallback && response.status === 400 && /tool|function/i.test(message)) {
          console.log('[LocalGPU] Model may not support tools — retrying without tools');
          noToolFallback = true;
          continue;
        }

        console.error(`[LocalGPU] API error: ${message}`);
        sendMessage(ws, {
          type: 'localgpu-error',
          error: message,
          errorType: 'api',
          isRetryable: response.status >= 500,
          sessionId: currentSessionId,
        });
        return;
      }

      const result = await consumeStream(response, {
        onText(delta) {
          sendMessage(ws, {
            type: 'localgpu-response',
            sessionId: currentSessionId,
            data: {
              type: 'assistant_message',
              message: { role: 'assistant', content: delta },
              startTime: activeLocalGPUSessions.get(currentSessionId)?.startTime,
            },
          });
        },
        onAbortCheck() {
          const session = activeLocalGPUSessions.get(currentSessionId);
          return !session || session.status === 'aborted';
        },
      });

      if (result.usage) {
        cumulativeTokens = (result.usage.prompt_tokens || 0) + (result.usage.completion_tokens || 0);
      } else {
        cumulativeTokens += (result.content?.length || 0) / 4;
        for (const toolCall of result.toolCalls) {
          cumulativeTokens += (toolCall.arguments?.length || 0) / 4;
        }
      }
      sendMessage(ws, {
        type: 'token-budget',
        data: { used: Math.round(cumulativeTokens), total: contextWindow },
        sessionId: currentSessionId,
      });

      if (result.toolCalls.length === 0) {
        if (result.content) {
          await appendSession(currentSessionId, { role: 'assistant', content: result.content }, workingDirectory).catch(() => {});
        }
        break;
      }

      console.log(`[LocalGPU] ${result.toolCalls.length} tool call(s) in turn ${turn}`);

      const assistantMessage = {
        role: 'assistant',
        content: result.content || null,
        tool_calls: result.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: 'function',
          function: { name: toolCall.name, arguments: toolCall.arguments },
        })),
      };
      messages.push(assistantMessage);
      await appendSession(currentSessionId, assistantMessage, workingDirectory).catch(() => {});

      const structuredToolUseContent = result.toolCalls.map((toolCall) => {
        let input;
        try {
          input = JSON.parse(toolCall.arguments);
        } catch {
          input = {};
        }
        return { type: 'tool_use', id: toolCall.id, name: toolCall.name, input };
      });
      sendMessage(ws, {
        type: 'localgpu-response',
        sessionId: currentSessionId,
        data: {
          type: 'structured_turn',
          message: { role: 'assistant', content: structuredToolUseContent },
        },
      });

      for (const toolCall of result.toolCalls) {
        let args;
        try {
          args = JSON.parse(toolCall.arguments);
        } catch {
          args = {};
        }

        console.log(`[LocalGPU]   → ${toolCall.name}(${JSON.stringify(args).slice(0, 120)})`);

        const allowed = await checkToolPermission(
          toolCall.name,
          args,
          permissionMode,
          allowedTools,
          disallowedTools,
          ws,
          currentSessionId,
          toolsSettings?.skipPermissions === true,
        );

        const output = allowed
          ? await executeTool(toolCall.name, args, workingDirectory)
          : `Permission denied for tool: ${toolCall.name}`;

        sendMessage(ws, {
          type: 'localgpu-response',
          sessionId: currentSessionId,
          data: {
            type: 'structured_result',
            message: {
              role: 'user',
              content: [{
                type: 'tool_result',
                tool_use_id: toolCall.id,
                content: output.slice(0, 2000),
                is_error: output.startsWith('Error'),
              }],
            },
          },
        });

        const toolMessage = { role: 'tool', tool_call_id: toolCall.id, content: output };
        messages.push(toolMessage);
        await appendSession(currentSessionId, toolMessage, workingDirectory).catch(() => {});
      }
    }

    if (turn >= MAX_AGENT_TURNS) {
      console.warn(`[LocalGPU] Reached max agent turns (${MAX_AGENT_TURNS})`);
    }

    sendMessage(ws, { type: 'localgpu-complete', sessionId: currentSessionId, exitCode: 0 });
  } catch (error) {
    console.error('[LocalGPU] Error:', error.name, error.message);
    if (error.name === 'AbortError') {
      sendMessage(ws, { type: 'localgpu-complete', sessionId: currentSessionId, exitCode: 1, aborted: true });
    } else {
      const { errorType, isRetryable } = classifyError(error.message);
      sendMessage(ws, {
        type: 'localgpu-error',
        error: error.message,
        errorType,
        isRetryable,
        sessionId: currentSessionId,
      });
    }
  } finally {
    const session = activeLocalGPUSessions.get(currentSessionId);
    if (session) session.status = 'completed';

    if (workingDirectory) {
      try {
        await reconcileLocalGPUSessionIndex(workingDirectory, {
          sessionId: currentSessionId,
          projectName: encodeProjectPath(workingDirectory),
        });
      } catch (err) {
        console.warn('[LocalGPU] Failed to reconcile session index:', err.message);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Session management exports
// ---------------------------------------------------------------------------

export function abortLocalGPUSession(sessionId) {
  const session = activeLocalGPUSessions.get(sessionId);
  if (!session) return false;
  session.status = 'aborted';
  session.abortController?.abort();
  activeLocalGPUSessions.delete(sessionId);
  return true;
}

export function isLocalGPUSessionActive(sessionId) {
  return activeLocalGPUSessions.get(sessionId)?.status === 'running';
}

export function getLocalGPUSessionStartTime(sessionId) {
  return activeLocalGPUSessions.get(sessionId)?.startTime || null;
}

export function getActiveLocalGPUSessions() {
  return Array.from(activeLocalGPUSessions.entries())
    .filter(([, session]) => session.status === 'running')
    .map(([id]) => id);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of activeLocalGPUSessions.entries()) {
    if (session.status !== 'running' && now - (session.startTime || 0) > 30 * 60 * 1000) {
      activeLocalGPUSessions.delete(id);
    }
  }
}, 5 * 60 * 1000);
