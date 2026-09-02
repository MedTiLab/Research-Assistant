import { promises as fs } from 'fs';
import path from 'path';
import { PiSessionStore } from '../agent-runtime/session-stores/pi-session-store.js';
import { createAgentSessionIdentity } from '../utils/agentSessionIdentity.js';
import {
  getRuntimeSessionDataRoot,
  getRuntimeSessionFilePath,
  resolveAppDataRoot,
} from '../utils/storagePaths.js';
import { mergeRuntimeUsage, normalizePiRuntimeUsage } from '../agent-runtime/usage.js';
import { buildSessionDisplayName, stripInternalContextPrefix } from '../utils/sessionFormatting.js';
import { createPiRuntimeError } from './rpc-client.js';
import { canonicalAgentToolName } from '../../shared/agentRuntimeEvents.js';
import { activePiBranchRecords, piSessionBranches, piBranchAgentState } from './session-branches.js';
import { agentStateTokenUsage, readAgentRuntimeState, resolveAgentRuntimeStatePath } from '../agent-runtime/state-store.js';
import { prunePiOutputFiles } from './output-budget.js';

export function resolvePiSessionPath(identity, options = {}) {
  const normalized = createAgentSessionIdentity(identity);
  if (normalized.runtimeId !== 'pi') {
    throw createPiRuntimeError(
      'RUNTIME_SESSION_STORE_IDENTITY_MISMATCH',
      `Cannot resolve a Pi session path for runtime "${normalized.runtimeId}".`,
    );
  }
  return getRuntimeSessionFilePath(normalized, options);
}

function parsePiSessionContents(contents, { recoverTrailingLine = true } = {}) {
  const hasTerminalNewline = /\r?\n$/.test(contents);
  const lines = contents.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const records = [];
  let validByteLength = 0;
  let recovered = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineBytes = Buffer.byteLength(`${line}\n`);
    if (!line.trim()) {
      validByteLength += lineBytes;
      continue;
    }
    try {
      records.push(JSON.parse(line));
      validByteLength += lineBytes;
    } catch {
      const isRecoverableTail = recoverTrailingLine
        && index === lines.length - 1
        && !hasTerminalNewline;
      if (!isRecoverableTail) {
        throw createPiRuntimeError(
          'PI_SESSION_CORRUPT',
          `Pi session JSONL is invalid at line ${index + 1}.`,
          { line: index + 1 },
        );
      }
      recovered = true;
    }
  }
  return { records, validByteLength, recovered };
}

export async function readPiSessionRecords(identity, options = {}) {
  const sessionPath = options.sessionPath || resolvePiSessionPath(identity, options);
  let contents;
  try {
    contents = await fs.readFile(sessionPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { sessionPath, records: [], recovered: false };
    throw error;
  }
  const parsed = parsePiSessionContents(contents, options);
  if (parsed.recovered && options.repair !== false) {
    const repaired = parsed.records.map((record) => JSON.stringify(record)).join('\n');
    await fs.writeFile(sessionPath, repaired ? `${repaired}\n` : '', {
      encoding: 'utf8',
      mode: 0o600,
    });
  }
  return { sessionPath, records: parsed.records, recovered: parsed.recovered };
}

export async function promotePiSessionFile(identity, resolvedSessionId, options = {}) {
  const sourceIdentity = createAgentSessionIdentity(identity);
  const targetIdentity = createAgentSessionIdentity({
    ...sourceIdentity,
    sessionId: resolvedSessionId,
  });
  const sourcePath = options.sessionPath || resolvePiSessionPath(sourceIdentity, options);
  const targetPath = resolvePiSessionPath(targetIdentity, options);
  if (sourcePath === targetPath) return targetPath;
  await fs.mkdir(path.dirname(targetPath), { recursive: true, mode: 0o700 });
  try {
    await fs.access(targetPath);
    throw createPiRuntimeError(
      'PI_SESSION_CONFLICT',
      `Pi session "${resolvedSessionId}" already exists.`,
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  try {
    await fs.rename(sourcePath, targetPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return targetPath;
    if (error?.code === 'EEXIST') {
      throw createPiRuntimeError(
        'PI_SESSION_CONFLICT',
        `Pi session "${resolvedSessionId}" already exists.`,
      );
    }
    throw error;
  }
  return targetPath;
}

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
}

function normalizeTimestamp(record, message = null) {
  return record?.timestamp || (
    Number.isFinite(message?.timestamp) ? new Date(message.timestamp).toISOString() : null
  ) || record?.createdAt || null;
}

function normalizeAssistantContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.flatMap((part) => {
    if (part?.type === 'text' && typeof part.text === 'string') {
      return [{ type: 'text', text: part.text }];
    }
    if (part?.type === 'thinking' && typeof (part.thinking || part.text) === 'string') {
      return [{ type: 'thinking', thinking: part.thinking || part.text }];
    }
    if (part?.type === 'toolCall') {
      const rawInput = part.arguments && typeof part.arguments === 'object'
        ? part.arguments
        : (part.input && typeof part.input === 'object' ? part.input : {});
      const isGateway = (part.name || part.toolName) === 'tool_call' && typeof rawInput.name === 'string' && rawInput.arguments && typeof rawInput.arguments === 'object';
      return [{
        type: 'tool_use',
        id: part.id || part.toolCallId || null,
        name: canonicalAgentToolName(isGateway ? rawInput.name : part.name || part.toolName),
        input: isGateway ? rawInput.arguments : rawInput,
        nativeToolName: part.name || part.toolName,
        nativeToolInput: rawInput,
      }];
    }
    return [];
  });
}

export function normalizePiSessionRecord(record) {
  if (record && ['user', 'assistant'].includes(record.type)) {
    return [{
      role: record.type,
      content: typeof record.content === 'string' ? record.content : '',
      timestamp: record.createdAt || null,
      createdAt: record.createdAt || null,
    }];
  }
  const message = record?.type === 'message' ? record.message : null;
  if (!message) return [];
  const timestamp = normalizeTimestamp(record, message);
  if (message.role === 'toolResult') {
    return [{
      type: 'tool_result',
      role: 'tool',
      toolCallId: message.toolCallId || message.tool_call_id || null,
      toolName: canonicalAgentToolName(message.toolName || 'unknown'),
      output: contentToText(message.content),
      isError: Boolean(message.isError),
      timestamp,
    }];
  }
  if (!['user', 'assistant'].includes(message.role)) return [];
  const content = message.role === 'assistant'
    ? normalizeAssistantContent(message.content)
    : (stripInternalContextPrefix(contentToText(message.content), false) || '');
  return [{ role: message.role, content, timestamp, createdAt: timestamp, ...(record.id ? { piEntryId: record.id, piParentId: record.parentId } : {}) }];
}

export function normalizePiSessionMessage(record) {
  if (record && ['user', 'assistant'].includes(record.type)) {
    return {
      role: record.type,
      content: typeof record.content === 'string' ? record.content : '',
      createdAt: record.createdAt || null,
    };
  }
  const message = record?.type === 'message' ? record.message : null;
  if (!message || !['user', 'assistant'].includes(message.role)) return null;
  return {
    role: message.role,
    content: contentToText(message.content),
    createdAt: record.timestamp || (
      Number.isFinite(message.timestamp) ? new Date(message.timestamp).toISOString() : null
    ),
  };
}

export function summarizePiSessionRecords(records = []) {
  const messages = activePiBranchRecords(Array.isArray(records) ? records : [])
    .map(normalizePiSessionMessage)
    .filter(Boolean);
  const firstUserMessage = messages.find((message) => message.role === 'user');
  const lastActivity = messages.reduce((latest, message) => {
    const timestamp = Date.parse(message.createdAt || '');
    if (!Number.isFinite(timestamp)) return latest;
    return !latest || timestamp > latest.timestamp
      ? { timestamp, value: new Date(timestamp).toISOString() }
      : latest;
  }, null)?.value || null;

  return {
    displayName: buildSessionDisplayName(firstUserMessage?.content || ''),
    messageCount: messages.length,
    lastActivity,
  };
}

export async function summarizePiSession(identity, options = {}) {
  const { sessionPath, records, recovered } = await readPiSessionRecords(identity, options);
  let fileLastActivity = null;
  let exists = records.length > 0;
  try {
    const stat = await fs.stat(sessionPath);
    fileLastActivity = stat.mtime.toISOString();
    exists = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const summary = summarizePiSessionRecords(records);
  return {
    ...summary,
    sessionPath,
    recovered,
    exists,
    lastActivity: fileLastActivity || summary.lastActivity,
  };
}

function recordsToTranscript(records) {
  records = activePiBranchRecords(records);
  let pendingDelivery = null;
  const messages = records.flatMap((record) => {
    if (record?.type === 'custom' && record.customType === 'medhelp.attachment_delivery') pendingDelivery = record.data?.attachments;
    return normalizePiSessionRecord(record).map((message) => {
      if (message.role !== 'user' || !pendingDelivery) return message;
      const attachmentDelivery = pendingDelivery;
      pendingDelivery = null;
      return { ...message, attachmentDelivery };
    });
  });
  const usages = records.flatMap((record) => {
    if (record?.type === 'usage') {
      const usage = normalizePiRuntimeUsage(record.usage);
      return usage ? [usage] : [];
    }
    if (record?.type === 'message' && record.message?.role === 'assistant' && record.message.usage) {
      const usage = normalizePiRuntimeUsage(record.message.usage);
      return usage ? [usage] : [];
    }
    return [];
  });
  return {
    messages,
    tokenUsage: usages.length > 0 ? mergeRuntimeUsage('pi', usages) : null,
  };
}

function paginateTranscript(transcript, options = {}) {
  const limit = Number.isFinite(options.limit) ? Math.max(0, options.limit) : null;
  const offset = Number.isFinite(options.offset) ? Math.max(0, options.offset) : 0;
  if (limit === null) return transcript;
  const total = transcript.messages.length;
  const startIndex = Math.max(0, total - offset - limit);
  const endIndex = Math.max(0, total - offset);
  const results = new Map(transcript.messages.filter((message) => message.type === 'tool_result' && message.toolCallId).map((message) => [message.toolCallId, message]));
  return {
    ...transcript,
    messages: transcript.messages.slice(startIndex, endIndex).map((message) => {
      const calls = Array.isArray(message.content) ? message.content.filter((part) => part.type === 'tool_use' && results.has(part.id)) : [];
      // Keep the result attached even when its independent JSONL record falls
      // on another page. Message offsets/counts remain unchanged.
      return calls.length ? { ...message, toolResults: Object.fromEntries(calls.map((call) => [call.id, results.get(call.id)])) } : message;
    }),
    total,
    hasMore: startIndex > 0,
    offset,
    limit,
  };
}

function mergeAgentStateIntoTranscript(transcript, agentState) {
  const tasksByToolCallId = new Map((agentState?.tasks || [])
    .filter((task) => task?.toolCallId && task.background)
    .map((task) => [String(task.toolCallId), task]));
  const toolNamesById = new Map(transcript.messages.flatMap((message) => Array.isArray(message.content)
    ? message.content.filter((part) => part.type === 'tool_use').map((part) => [part.id, part.name])
    : []));
  return {
    ...transcript,
    messages: transcript.messages.map((message) => {
      if (message?.type !== 'tool_result' || !message.toolCallId) return message;
      message = { ...message, toolName: toolNamesById.get(message.toolCallId) || message.toolName };
      const task = tasksByToolCallId.get(String(message.toolCallId));
      if (!task) return message;
      return {
        ...message,
        output: JSON.stringify({
          task_id: task.id,
          child_session_id: task.childSessionId || null,
          status: task.status,
          result: task.result || null,
          error: task.error || null,
        }, null, 2),
        isError: ['failed', 'interrupted'].includes(task.status),
        subagentTools: task.childTools || [],
      };
    }),
  };
}

async function listPiSessions(projectIdentity, options = {}) {
  const root = getRuntimeSessionDataRoot({
    ...projectIdentity,
    runtimeId: 'pi',
    sessionId: 'list-placeholder',
  }, options);
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
    const sessionPath = path.join(root, entry.name);
    try {
      const contents = await fs.readFile(sessionPath, 'utf8');
      const { records } = parsePiSessionContents(contents);
      const start = records.find((record) => ['session_start', 'session'].includes(record?.type));
      const sessionId = start?.sessionId || start?.id;
      if (!sessionId) continue;
      const latestModel = [...records].reverse().find((record) => record?.type === 'model_change');
      const stat = await fs.stat(sessionPath);
      const summary = summarizePiSessionRecords(records);
      sessions.push({
        sessionId,
        runtimeId: 'pi',
        modelId: latestModel?.modelId || start.modelId || null,
        lastActivity: stat.mtime.toISOString(),
        displayName: summary.displayName,
        messageCount: summary.messageCount,
      });
    } catch (error) {
      if (error?.code !== 'PI_SESSION_CORRUPT') throw error;
    }
  }
  return sessions.sort((left, right) => (
    String(right.lastActivity).localeCompare(String(left.lastActivity))
  ));
}

export function createPiHostSessionStore(options = {}) {
  return new PiSessionStore({
    list: (projectIdentity, listOptions = {}) => listPiSessions(projectIdentity, {
      ...options,
      ...listOptions,
    }),
    read: async (identity, readOptions = {}) => {
      const { records } = await readPiSessionRecords(identity, { ...options, ...readOptions });
      const agentState = piBranchAgentState(records, await readAgentRuntimeState(identity, {
        ...options,
        ...readOptions,
        statePath: resolveAgentRuntimeStatePath(identity, { ...options, ...readOptions }),
      }));
      const transcript = paginateTranscript(
        mergeAgentStateIntoTranscript(recordsToTranscript(records), agentState),
        readOptions,
      );
      // Transcript totals are billing counters; the input circle needs the
      // current context snapshot, including the post-compaction estimate.
      const contextUsage = agentStateTokenUsage(agentState);
      const tokenUsage = contextUsage.total
        ? { ...transcript.tokenUsage, ...contextUsage }
        : transcript.tokenUsage;
      return { ...transcript, tokenUsage, agentState, branchState: piSessionBranches(records, identity.sessionId) };
    },
    forkPoints: options.forkPoints,
    fork: options.fork,
    rename: options.rename,
    trash: options.trash,
    restore: options.restore,
    delete: async (identity, deleteOptions = {}) => {
      const projectRoot = deleteOptions.projectRoot || deleteOptions.projectPath || await options.resolveProjectRoot?.(identity);
      if (projectRoot) await prunePiOutputFiles(projectRoot, { sessionId: identity.sessionId, removeSession: true }).catch((error) => { if (error.code !== 'ENOENT') throw error; });
      await fs.rm(resolvePiSessionPath(identity, { ...options, ...deleteOptions }), { force: true });
      await fs.rm(resolveAgentRuntimeStatePath(identity, { ...options, ...deleteOptions }), { force: true });
      await options.afterDelete?.(identity, deleteOptions);
      return true;
    },
    getUsage: async (identity, usageOptions = {}) => {
      const { records } = await readPiSessionRecords(identity, { ...options, ...usageOptions });
      return recordsToTranscript(records).tokenUsage;
    },
    reconcile: async (identity, reconcileOptions = {}) => {
      const result = await readPiSessionRecords(identity, {
        ...options,
        ...reconcileOptions,
        repair: true,
      });
      return { recovered: result.recovered };
    },
    watchRoots: () => [path.join(resolveAppDataRoot(options), 'runtime-sessions', 'pi')],
  });
}

export { parsePiSessionContents };
