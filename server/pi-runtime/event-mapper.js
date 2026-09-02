import { RUNTIME_OBSERVATION_TYPES } from '../agent-runtime/observations/types.js';
import { normalizePiRuntimeUsage } from '../agent-runtime/usage.js';
import {
  AGENT_ENTITY_TYPES,
  AGENT_RUNTIME_EVENT_TYPES,
  canonicalAgentToolId,
  canonicalAgentToolName,
  createAgentRuntimeEvent,
} from '../../shared/agentRuntimeEvents.js';

export { normalizePiRuntimeUsage } from '../agent-runtime/usage.js';

export function mapPiHostEventToObservations(payload) {
  if (!payload || typeof payload !== 'object' || typeof payload.event !== 'string') return [];
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  switch (payload.event) {
    case 'session_started':
      return payload.sessionId ? [
        {
          type: RUNTIME_OBSERVATION_TYPES.SESSION_CREATED,
          provider: 'pi',
          sessionId: payload.sessionId,
          resumed: Boolean(data.resumed),
        },
        {
          type: RUNTIME_OBSERVATION_TYPES.RUN_UPDATED,
          provider: 'pi',
          run: data.run || {
            id: data.runId || null,
            sessionId: payload.sessionId,
            status: 'running',
          },
        },
      ] : [];
    case 'text_delta':
      return typeof data.text === 'string' && data.text ? [{
        type: RUNTIME_OBSERVATION_TYPES.ASSISTANT_TEXT,
        provider: 'pi',
        text: data.text,
        message: { role: 'assistant', content: data.text },
      }] : [];
    case 'thinking_delta':
      return [{
        type: RUNTIME_OBSERVATION_TYPES.REASONING_ACTIVITY,
        provider: 'pi',
        status: data.status || 'active',
      }];
    case 'tool_started':
      return [{
        type: RUNTIME_OBSERVATION_TYPES.TOOL_USE,
        provider: 'pi',
        toolCallId: data.toolCallId || null,
        toolName: canonicalAgentToolName(data.toolName),
        toolId: data.toolId || canonicalAgentToolId(data.toolName),
        nativeToolName: data.nativeToolName || data.toolName || 'unknown',
        toolInput: data.input && typeof data.input === 'object' ? data.input : {},
      }];
    case 'tool_completed':
      return [{
        type: RUNTIME_OBSERVATION_TYPES.TOOL_RESULT,
        provider: 'pi',
        toolCallId: data.toolCallId || null,
        output: typeof data.output === 'string' ? data.output : JSON.stringify(data.output ?? ''),
        isError: Boolean(data.isError),
      }];
    case 'artifact_created':
      return typeof data.path === 'string' ? [{
        type: RUNTIME_OBSERVATION_TYPES.ARTIFACT_CREATED,
        provider: 'pi',
        path: data.path,
        kind: data.kind || 'file',
      }] : [];
    case 'todo_snapshot':
      return [{
        type: RUNTIME_OBSERVATION_TYPES.TODO_SNAPSHOT,
        provider: 'pi',
        source: 'pi',
        todos: Array.isArray(data.todos) ? data.todos : [],
      }];
    case 'task_created':
    case 'task_updated':
      return data.task ? [{
        type: RUNTIME_OBSERVATION_TYPES.TASK_UPDATED,
        provider: 'pi',
        task: data.task,
      }] : [];
    case 'context_item_added':
      return data.contextItem ? [{
        type: RUNTIME_OBSERVATION_TYPES.CONTEXT_ITEM_ADDED,
        provider: 'pi',
        contextItem: data.contextItem,
      }] : [];
    case 'permission_requested':
    case 'interaction_requested':
      return [{
        type: RUNTIME_OBSERVATION_TYPES.PERMISSION_REQUESTED,
        provider: 'pi',
        permissionRequest: {
          id: data.approvalId || null,
          toolCallId: data.toolCallId || null,
          toolName: canonicalAgentToolName(data.toolName),
          input: data.input || {},
          status: 'pending',
          interaction: payload.event === 'interaction_requested',
        },
      }];
    case 'permission_resolved':
    case 'interaction_resolved':
      return [{
        type: RUNTIME_OBSERVATION_TYPES.PERMISSION_RESOLVED,
        provider: 'pi',
        permissionRequest: {
          id: data.approvalId || null,
          toolCallId: data.toolCallId || null,
          toolName: canonicalAgentToolName(data.toolName),
          status: data.status || (data.allow ? 'approved' : 'denied'),
          interaction: payload.event === 'interaction_resolved',
        },
      }];
    case 'turn_completed':
    case 'turn_aborted':
      return [{
        type: RUNTIME_OBSERVATION_TYPES.RUN_UPDATED,
        provider: 'pi',
        run: {
          id: data.runId || null,
          sessionId: payload.sessionId || null,
          status: payload.event === 'turn_aborted' ? 'cancelled' : 'completed',
        },
      }];
    case 'usage': {
      const usage = normalizePiRuntimeUsage(data);
      return usage ? [{
        type: RUNTIME_OBSERVATION_TYPES.USAGE_UPDATED,
        provider: 'pi',
        usage,
      }] : [];
    }
    default:
      return [];
  }
}

export function normalizePiHostEventPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const data = payload.data && typeof payload.data === 'object' ? { ...payload.data } : {};
  if (typeof data.toolName === 'string') {
    data.nativeToolName = data.nativeToolName || data.toolName;
    data.toolId = canonicalAgentToolId(data.toolName);
    data.toolName = canonicalAgentToolName(data.toolName);
  }
  return { ...payload, data };
}

export function mapPiHostEventToCanonicalEvent(payload) {
  const normalized = normalizePiHostEventPayload(payload);
  const data = normalized?.data || {};
  const common = {
    provider: 'pi',
    runtimeId: 'pi',
    sessionId: normalized?.sessionId || null,
    runId: data.runId || null,
  };
  switch (normalized?.event) {
    case 'tool_started':
      return createAgentRuntimeEvent({
        ...common,
        type: AGENT_RUNTIME_EVENT_TYPES.TOOL_CALL_STARTED,
        entityType: AGENT_ENTITY_TYPES.TOOL_CALL,
        entityId: data.toolCallId || null,
        data,
      });
    case 'tool_completed':
      return createAgentRuntimeEvent({
        ...common,
        type: AGENT_RUNTIME_EVENT_TYPES.TOOL_CALL_COMPLETED,
        entityType: AGENT_ENTITY_TYPES.TOOL_CALL,
        entityId: data.toolCallId || null,
        data,
      });
    case 'tool_updated':
      return createAgentRuntimeEvent({ ...common, type: AGENT_RUNTIME_EVENT_TYPES.TOOL_CALL_UPDATED,
        entityType: AGENT_ENTITY_TYPES.TOOL_CALL, entityId: data.toolCallId || null, data });
    case 'task_created':
    case 'task_updated':
      return createAgentRuntimeEvent({
        ...common,
        type: AGENT_RUNTIME_EVENT_TYPES.TASK_UPDATED,
        entityType: AGENT_ENTITY_TYPES.TASK,
        entityId: data.task?.id || null,
        data,
      });
    case 'todo_snapshot':
      return createAgentRuntimeEvent({
        ...common,
        type: AGENT_RUNTIME_EVENT_TYPES.TODO_UPDATED,
        entityType: AGENT_ENTITY_TYPES.TODO,
        data,
      });
    case 'artifact_created':
      return createAgentRuntimeEvent({
        ...common,
        type: AGENT_RUNTIME_EVENT_TYPES.ARTIFACT_CREATED,
        entityType: AGENT_ENTITY_TYPES.ARTIFACT,
        entityId: data.id || data.path || null,
        data,
      });
    case 'context_item_added':
      return createAgentRuntimeEvent({
        ...common,
        type: AGENT_RUNTIME_EVENT_TYPES.CONTEXT_ITEM_ADDED,
        entityType: AGENT_ENTITY_TYPES.CONTEXT_ITEM,
        entityId: data.contextItem?.id || null,
        data,
      });
    case 'permission_requested':
    case 'interaction_requested':
      return createAgentRuntimeEvent({
        ...common,
        type: AGENT_RUNTIME_EVENT_TYPES.PERMISSION_REQUESTED,
        entityType: AGENT_ENTITY_TYPES.PERMISSION_REQUEST,
        entityId: data.approvalId || null,
        data,
      });
    case 'permission_resolved':
    case 'interaction_resolved':
      return createAgentRuntimeEvent({
        ...common,
        type: AGENT_RUNTIME_EVENT_TYPES.PERMISSION_RESOLVED,
        entityType: AGENT_ENTITY_TYPES.PERMISSION_REQUEST,
        entityId: data.approvalId || null,
        data,
      });
    case 'session_started':
    case 'turn_completed':
    case 'turn_aborted':
      return createAgentRuntimeEvent({
        ...common,
        type: AGENT_RUNTIME_EVENT_TYPES.RUN_UPDATED,
        entityType: AGENT_ENTITY_TYPES.AGENT_RUN,
        entityId: data.runId || null,
        data: {
          ...data,
          status: normalized.event === 'session_started'
            ? 'running'
            : (normalized.event === 'turn_aborted' ? 'cancelled' : 'completed'),
        },
      });
    default:
      return null;
  }
}

export function mapPiHostEventToRealtimePayload(payload) {
  if (payload?.event === 'session_started' && payload.sessionId) {
    return {
      type: 'session-created',
      provider: 'pi',
      runtimeId: 'pi',
      sessionId: payload.sessionId,
      projectName: payload.projectKey || undefined,
      projectKey: payload.projectKey || undefined,
    };
  }
  const normalized = normalizePiHostEventPayload(payload);
  return {
    type: 'pi-response',
    provider: 'pi',
    runtimeId: 'pi',
    sessionId: payload?.sessionId || null,
    data: normalized,
    agentEvent: mapPiHostEventToCanonicalEvent(payload),
  };
}

export function forwardPiHostEvent(payload, { writer, onLifecycleEvent } = {}) {
  if (payload?.event === 'session_started') {
    writer?.setSessionId?.(payload.sessionId);
    onLifecycleEvent?.({
      phase: 'turn_started',
      provider: 'pi',
      runtimeId: 'pi',
      sessionId: payload.sessionId || null,
      resumed: Boolean(payload.data?.resumed),
    });
  } else if (payload?.event === 'turn_completed' || payload?.event === 'turn_aborted') {
    onLifecycleEvent?.({
      phase: 'completed',
      provider: 'pi',
      runtimeId: 'pi',
      sessionId: payload.sessionId || null,
      outcome: payload.event === 'turn_aborted' ? 'aborted' : 'completed',
    });
  }
  if (writer && typeof writer.send === 'function') {
    const realtimePayload = mapPiHostEventToRealtimePayload(payload);
    if (realtimePayload) writer.send(realtimePayload);
  }
  return mapPiHostEventToObservations(payload);
}
