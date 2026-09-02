import { normalizeRuntimeUsage } from '../usage.js';
import { mapPiHostEventToObservations } from '../../pi-runtime/event-mapper.js';
import { RUNTIME_OBSERVATION_TYPES } from './types.js';
import {
  AGENT_ENTITY_TYPES,
  AGENT_RUNTIME_EVENT_TYPES,
  canonicalAgentToolId,
  canonicalAgentToolName,
  createAgentRuntimeEvent,
  isAgentRuntimeEvent,
} from '../../../shared/agentRuntimeEvents.js';

const TODO_TOOL_NAMES = new Set(['todowrite', 'write_todos', 'todo_write']);

function parsePayload(payload) {
  if (typeof payload !== 'string') {
    return payload;
  }
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function inferProvider(payload, explicitProvider) {
  if (explicitProvider) {
    return explicitProvider;
  }
  if (payload?.provider) {
    return payload.provider;
  }
  if (payload?.event?.provider) {
    return payload.event.provider;
  }
  if (String(payload?.type || '').startsWith('claude-')) {
    return 'claude';
  }
  if (String(payload?.type || '').startsWith('codex-')) {
    return 'codex';
  }
  if (String(payload?.type || '').startsWith('pi-')) {
    return 'pi';
  }
  return null;
}

function attachObservationMetadata(observations, { provider }) {
  return observations.map((observation) => ({
    ...observation,
    provider,
  }));
}

export function normalizeRuntimeObservations(payload, { provider: explicitProvider = null } = {}) {
  const nativePayload = parsePayload(payload);
  if (!nativePayload || typeof nativePayload !== 'object') {
    return [];
  }

  const provider = inferProvider(nativePayload, explicitProvider);
  let observations = [];

  if (nativePayload.type === 'session-created' && nativePayload.sessionId) {
    observations = [{
      type: RUNTIME_OBSERVATION_TYPES.SESSION_CREATED,
      sessionId: nativePayload.sessionId,
      previousSessionId: nativePayload.previousSessionId || null,
    }];
  } else if (nativePayload.type === 'claude-response') {
    observations = normalizeClaudePayload(nativePayload.data);
  } else if (nativePayload.type === 'codex-response') {
    observations = normalizeCodexPayload(nativePayload.data);
  } else if (nativePayload.type === 'pi-response') {
    observations = mapPiHostEventToObservations(nativePayload.data);
  } else if (nativePayload.type === 'agent-runtime-event' && isAgentRuntimeEvent(nativePayload.event)) {
    observations = normalizeCanonicalAgentEvent(nativePayload.event);
  } else if (nativePayload.type === 'token-budget' && provider === 'codex') {
    const usage = normalizeRuntimeUsage(provider, nativePayload.data);
    if (usage) {
      observations = [{
        type: RUNTIME_OBSERVATION_TYPES.USAGE_UPDATED,
        usage,
      }];
    }
  }

  return attachObservationMetadata(observations, { provider });
}

export function normalizeAgentRuntimeEvents(payload, options = {}) {
  const observations = normalizeRuntimeObservations(payload, options);
  const provider = options.provider || observations[0]?.provider || inferProvider(parsePayload(payload), null);
  const common = {
    provider,
    runtimeId: provider,
    sessionId: options.sessionId || payload?.sessionId || payload?.data?.sessionId || null,
    runId: options.runId || null,
  };
  return observations.flatMap((observation) => {
    switch (observation.type) {
      case RUNTIME_OBSERVATION_TYPES.SESSION_CREATED:
        return [createAgentRuntimeEvent({
          ...common,
          sessionId: observation.sessionId || common.sessionId,
          type: AGENT_RUNTIME_EVENT_TYPES.RUN_UPDATED,
          entityType: AGENT_ENTITY_TYPES.AGENT_RUN,
          entityId: common.runId,
          data: { status: 'running', resumed: Boolean(observation.resumed) },
        })];
      case RUNTIME_OBSERVATION_TYPES.TOOL_USE: {
        const toolName = canonicalAgentToolName(observation.toolName);
        return [createAgentRuntimeEvent({
          ...common,
          type: AGENT_RUNTIME_EVENT_TYPES.TOOL_CALL_STARTED,
          entityType: AGENT_ENTITY_TYPES.TOOL_CALL,
          entityId: observation.toolCallId || null,
          data: {
            toolCallId: observation.toolCallId || null,
            toolName,
            toolId: observation.toolId || canonicalAgentToolId(observation.toolName),
            nativeToolName: observation.nativeToolName || observation.toolName || 'unknown',
            input: observation.toolInput || {},
          },
        })];
      }
      case RUNTIME_OBSERVATION_TYPES.TOOL_RESULT:
        return [createAgentRuntimeEvent({
          ...common,
          type: AGENT_RUNTIME_EVENT_TYPES.TOOL_CALL_COMPLETED,
          entityType: AGENT_ENTITY_TYPES.TOOL_CALL,
          entityId: observation.toolCallId || null,
          data: {
            toolCallId: observation.toolCallId || null,
            output: observation.output ?? '',
            isError: Boolean(observation.isError),
          },
        })];
      case RUNTIME_OBSERVATION_TYPES.TASK_UPDATED:
        return [createAgentRuntimeEvent({
          ...common,
          type: AGENT_RUNTIME_EVENT_TYPES.TASK_UPDATED,
          entityType: AGENT_ENTITY_TYPES.TASK,
          entityId: observation.task?.id || null,
          data: { task: observation.task || {} },
        })];
      case RUNTIME_OBSERVATION_TYPES.TODO_SNAPSHOT:
        return [createAgentRuntimeEvent({
          ...common,
          type: AGENT_RUNTIME_EVENT_TYPES.TODO_UPDATED,
          entityType: AGENT_ENTITY_TYPES.TODO,
          data: { source: observation.source || provider, todos: observation.todos || [] },
        })];
      case RUNTIME_OBSERVATION_TYPES.ARTIFACT_CREATED:
        return [createAgentRuntimeEvent({
          ...common,
          type: AGENT_RUNTIME_EVENT_TYPES.ARTIFACT_CREATED,
          entityType: AGENT_ENTITY_TYPES.ARTIFACT,
          entityId: observation.path || null,
          data: {
            path: observation.path,
            kind: observation.kind || 'file',
            source: observation.source || provider,
          },
        })];
      case RUNTIME_OBSERVATION_TYPES.CONTEXT_ITEM_ADDED:
        return [createAgentRuntimeEvent({
          ...common,
          type: AGENT_RUNTIME_EVENT_TYPES.CONTEXT_ITEM_ADDED,
          entityType: AGENT_ENTITY_TYPES.CONTEXT_ITEM,
          entityId: observation.contextItem?.id || null,
          data: { contextItem: observation.contextItem || {} },
        })];
      case RUNTIME_OBSERVATION_TYPES.PERMISSION_REQUESTED:
      case RUNTIME_OBSERVATION_TYPES.PERMISSION_RESOLVED:
        return [createAgentRuntimeEvent({
          ...common,
          type: observation.type === RUNTIME_OBSERVATION_TYPES.PERMISSION_REQUESTED
            ? AGENT_RUNTIME_EVENT_TYPES.PERMISSION_REQUESTED
            : AGENT_RUNTIME_EVENT_TYPES.PERMISSION_RESOLVED,
          entityType: AGENT_ENTITY_TYPES.PERMISSION_REQUEST,
          entityId: observation.permissionRequest?.id || null,
          data: { permissionRequest: observation.permissionRequest || {} },
        })];
      case RUNTIME_OBSERVATION_TYPES.RUN_UPDATED:
        return [createAgentRuntimeEvent({
          ...common,
          type: AGENT_RUNTIME_EVENT_TYPES.RUN_UPDATED,
          entityType: AGENT_ENTITY_TYPES.AGENT_RUN,
          entityId: observation.run?.id || common.runId,
          data: { run: observation.run || {} },
        })];
      default:
        return [];
    }
  });
}

function normalizeCanonicalAgentEvent(event) {
  const base = event?.data && typeof event.data === 'object' ? event.data : {};
  switch (event.type) {
    case 'tool_call.started':
      return [{
        type: RUNTIME_OBSERVATION_TYPES.TOOL_USE,
        toolCallId: event.entityId || base.toolCallId || null,
        toolName: base.toolName || 'unknown',
        toolId: base.toolId || null,
        nativeToolName: base.nativeToolName || null,
        toolInput: base.input && typeof base.input === 'object' ? base.input : {},
      }];
    case 'tool_call.completed':
      return [{
        type: RUNTIME_OBSERVATION_TYPES.TOOL_RESULT,
        toolCallId: event.entityId || base.toolCallId || null,
        output: normalizeToolResultContent(base.output),
        isError: Boolean(base.isError),
      }];
    case 'task.updated':
      return [{ type: RUNTIME_OBSERVATION_TYPES.TASK_UPDATED, task: base.task || base }];
    case 'todo.updated':
      return [{
        type: RUNTIME_OBSERVATION_TYPES.TODO_SNAPSHOT,
        source: base.source || 'agent_runtime',
        todos: normalizeTodoItems(base.todos),
      }];
    case 'artifact.created':
      return base.path ? [{
        type: RUNTIME_OBSERVATION_TYPES.ARTIFACT_CREATED,
        path: base.path,
        kind: base.kind || 'file',
        source: base.source || null,
      }] : [];
    case 'context_item.added':
      return [{ type: RUNTIME_OBSERVATION_TYPES.CONTEXT_ITEM_ADDED, contextItem: base.contextItem || base }];
    case 'permission.requested':
      return [{ type: RUNTIME_OBSERVATION_TYPES.PERMISSION_REQUESTED, permissionRequest: base.permissionRequest || base }];
    case 'permission.resolved':
      return [{ type: RUNTIME_OBSERVATION_TYPES.PERMISSION_RESOLVED, permissionRequest: base.permissionRequest || base }];
    case 'agent_run.updated':
      return [{ type: RUNTIME_OBSERVATION_TYPES.RUN_UPDATED, run: base.run || base }];
    default:
      return [];
  }
}

function normalizeClaudePayload(data) {
  if (!data || typeof data !== 'object') {
    return [];
  }

  if (data.type === 'structured_turn' || data.type === 'structured_result') {
    return normalizeClaudeMessageEnvelope(data.message);
  }

  if (data.type === 'assistant' || data.role === 'assistant' || data.role === 'user') {
    return normalizeClaudeMessageEnvelope(data.message || data);
  }

  if (
    data.type === 'content_block_delta'
    && (data.delta?.type === 'thinking_delta' || data.delta?.type === 'signature_delta')
  ) {
    return [{
      type: RUNTIME_OBSERVATION_TYPES.REASONING_ACTIVITY,
      status: 'active',
    }];
  }

  return [];
}

function normalizeClaudeMessageEnvelope(message) {
  if (!message || typeof message !== 'object') {
    return [];
  }
  const role = message.role || null;
  const content = Array.isArray(message.content)
    ? message.content
    : typeof message.content === 'string'
      ? [{ type: 'text', text: message.content }]
      : [];
  const observations = [];
  const assistantText = [];

  for (const part of content) {
    if (!part || typeof part !== 'object') {
      continue;
    }
    if (part.type === 'text' && typeof part.text === 'string' && role === 'assistant') {
      assistantText.push(part.text);
      continue;
    }
    if ((part.type === 'thinking' || part.type === 'redacted_thinking') && role === 'assistant') {
      observations.push({
        type: RUNTIME_OBSERVATION_TYPES.REASONING_ACTIVITY,
        status: 'active',
      });
      continue;
    }
    if (part.type === 'tool_use' && role === 'assistant') {
      const toolName = String(part.name || '').trim();
      const normalizedToolName = toolName.toLowerCase();
      if (TODO_TOOL_NAMES.has(normalizedToolName) && Array.isArray(part.input?.todos)) {
        observations.push({
          type: RUNTIME_OBSERVATION_TYPES.TODO_SNAPSHOT,
          source: toolName || 'TodoWrite',
          todos: normalizeTodoItems(part.input.todos),
        });
      } else {
        observations.push({
          type: RUNTIME_OBSERVATION_TYPES.TOOL_USE,
          toolCallId: part.id || null,
          parentToolUseId: part.parentToolUseId || message.parentToolUseId || null,
          toolName: toolName || 'unknown',
          toolInput: part.input && typeof part.input === 'object' ? part.input : {},
        });
      }
      continue;
    }
    if (part.type === 'tool_result' && role !== 'assistant') {
      observations.push({
        type: RUNTIME_OBSERVATION_TYPES.TOOL_RESULT,
        toolCallId: part.tool_use_id || part.toolUseId || null,
        output: normalizeToolResultContent(part.content),
        isError: Boolean(part.is_error),
      });
    }
  }

  const text = compactWhitespace(assistantText.join('\n'));
  if (text) {
    observations.push({
      type: RUNTIME_OBSERVATION_TYPES.ASSISTANT_TEXT,
      text,
      message: { role: 'assistant', content: text },
    });
  }

  if (message.usage) {
    const usage = normalizeRuntimeUsage('claude', message.usage);
    if (usage) {
      observations.push({
        type: RUNTIME_OBSERVATION_TYPES.USAGE_UPDATED,
        usage,
      });
    }
  }

  return observations;
}

function normalizeCodexPayload(data) {
  if (!data || typeof data !== 'object') {
    return [];
  }

  if (data.type === 'status' && data.status === 'reasoning') {
    return [{
      type: RUNTIME_OBSERVATION_TYPES.REASONING_ACTIVITY,
      status: 'active',
    }];
  }
  if (data.type !== 'item') {
    return [];
  }

  if (data.itemType === 'todo_list') {
    return [{
      type: RUNTIME_OBSERVATION_TYPES.TODO_SNAPSHOT,
      source: 'codex_todo_list',
      todos: normalizeTodoItems(data.items),
    }];
  }

  if (data.itemType === 'agent_message') {
    // Codex app-server sends the full accumulated message on every delta.
    if (
      (data.lifecycle && data.lifecycle !== 'completed')
      || (data.message?.role && data.message.role !== 'assistant')
    ) {
      return [];
    }
    const text = compactWhitespace(data.message?.content || '');
    if (!text) {
      return [];
    }
    return [{
      type: RUNTIME_OBSERVATION_TYPES.ASSISTANT_TEXT,
      text,
      message: { role: 'assistant', content: text },
    }];
  }

  if (data.itemType === 'command_execution') {
    const toolCallId = data.itemId || null;
    if (data.lifecycle === 'completed') {
      return [{
        type: RUNTIME_OBSERVATION_TYPES.TOOL_RESULT,
        toolCallId,
        output: compactWhitespace(data.output || ''),
        isError: Number.isFinite(data.exitCode) ? Number(data.exitCode) !== 0 : false,
      }];
    }
    return [{
      type: RUNTIME_OBSERVATION_TYPES.TOOL_USE,
      toolCallId,
      toolName: 'Bash',
      toolInput: { command: data.command || '' },
      source: 'codex_command_execution',
    }];
  }

  if (data.itemType === 'file_change') {
    const paths = Array.isArray(data.changes)
      ? data.changes
        .map((change) => change?.path || change?.file || change?.filePath || null)
        .filter(Boolean)
      : [];
    return paths.map((filePath) => ({
      type: RUNTIME_OBSERVATION_TYPES.ARTIFACT_CREATED,
      path: filePath,
      kind: 'file_change',
      source: 'codex_file_change',
    }));
  }

  if (data.itemType === 'mcp_tool_call') {
    const toolCallId = data.itemId || null;
    const observations = [{
      type: RUNTIME_OBSERVATION_TYPES.TOOL_USE,
      toolCallId,
      toolName: data.tool || 'mcp_tool_call',
      toolInput: data.arguments && typeof data.arguments === 'object' ? data.arguments : {},
      source: 'codex_mcp_tool_call',
    }];
    if (data.status === 'completed' || data.result || data.error) {
      observations.push({
        type: RUNTIME_OBSERVATION_TYPES.TOOL_RESULT,
        toolCallId,
        output: compactWhitespace(
          data.error
            ? String(data.error)
            : typeof data.result === 'string'
              ? data.result
              : JSON.stringify(data.result || {}),
        ),
        isError: Boolean(data.error),
      });
    }
    return observations;
  }

  if (data.itemType === 'web_search') {
    return [{
      type: RUNTIME_OBSERVATION_TYPES.TOOL_USE,
      toolCallId: data.itemId || null,
      toolName: 'WebSearch',
      toolInput: { query: data.query || '' },
      source: 'codex_web_search',
    }];
  }

  return [];
}

export function normalizeTodoItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .map((item, index) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const title = compactWhitespace(
        item.title || item.content || item.description || item.text || '',
      );
      if (!title) {
        return null;
      }
      return {
        id: String(item.id || `todo-${index + 1}`),
        title,
        status: normalizeTodoStatus(
          item.status ?? (item.completed === true ? 'completed' : 'pending'),
        ),
      };
    })
    .filter(Boolean);
}

export function normalizeTodoStatus(status) {
  const raw = String(status || '').trim().toLowerCase();
  if (!raw) {
    return 'pending';
  }
  if (raw === 'completed' || raw === 'done' || raw === 'complete') {
    return 'completed';
  }
  if (raw === 'in_progress' || raw === 'in-progress' || raw === 'active') {
    return 'in_progress';
  }
  return 'pending';
}

function normalizeToolResultContent(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }
        if (typeof entry?.text === 'string') {
          return entry.text;
        }
        return JSON.stringify(entry);
      })
      .join('\n');
  }
  if (content == null) {
    return '';
  }
  return JSON.stringify(content);
}

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
