export const RUNTIME_OBSERVATION_TYPES = Object.freeze({
  SESSION_CREATED: 'session_created',
  ASSISTANT_TEXT: 'assistant_text',
  TOOL_USE: 'tool_use',
  TOOL_RESULT: 'tool_result',
  ARTIFACT_CREATED: 'artifact_created',
  TODO_SNAPSHOT: 'todo_snapshot',
  TASK_UPDATED: 'task_updated',
  CONTEXT_ITEM_ADDED: 'context_item_added',
  PERMISSION_REQUESTED: 'permission_requested',
  PERMISSION_RESOLVED: 'permission_resolved',
  RUN_UPDATED: 'run_updated',
  REASONING_ACTIVITY: 'reasoning_activity',
  USAGE_UPDATED: 'usage_updated',
});

const RUNTIME_OBSERVATION_TYPE_VALUES = new Set(Object.values(RUNTIME_OBSERVATION_TYPES));

export function isRuntimeObservationType(type) {
  return RUNTIME_OBSERVATION_TYPE_VALUES.has(type);
}
