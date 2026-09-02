export const AGENT_RUNTIME_EVENT_SCHEMA = 'medhelp.agent-runtime-event.v1';

export const AGENT_ENTITY_TYPES = Object.freeze({
  TOOL_CALL: 'ToolCall',
  TASK: 'Task',
  TODO: 'Todo',
  ARTIFACT: 'Artifact',
  CONTEXT_ITEM: 'ContextItem',
  PERMISSION_REQUEST: 'PermissionRequest',
  AGENT_RUN: 'AgentRun',
});

export const AGENT_RUNTIME_EVENT_TYPES = Object.freeze({
  TOOL_CALL_STARTED: 'tool_call.started',
  TOOL_CALL_UPDATED: 'tool_call.updated',
  TOOL_CALL_COMPLETED: 'tool_call.completed',
  TASK_UPDATED: 'task.updated',
  TODO_UPDATED: 'todo.updated',
  ARTIFACT_CREATED: 'artifact.created',
  CONTEXT_ITEM_ADDED: 'context_item.added',
  PERMISSION_REQUESTED: 'permission.requested',
  PERMISSION_RESOLVED: 'permission.resolved',
  RUN_UPDATED: 'agent_run.updated',
});

const TOOL_ALIASES = Object.freeze({
  read: { id: 'read', displayName: 'Read' },
  grep: { id: 'grep', displayName: 'Grep' },
  find: { id: 'find', displayName: 'Glob' },
  glob: { id: 'find', displayName: 'Glob' },
  ls: { id: 'list_directory', displayName: 'LS' },
  list_directory: { id: 'list_directory', displayName: 'LS' },
  system_info: { id: 'system_info', displayName: 'SystemInfo' },
  write: { id: 'write', displayName: 'Write' },
  write_file: { id: 'write', displayName: 'Write' },
  edit: { id: 'edit', displayName: 'Edit' },
  replace: { id: 'edit', displayName: 'Edit' },
  bash: { id: 'bash', displayName: 'Bash' },
  run_shell_command: { id: 'bash', displayName: 'Bash' },
  ask_user: { id: 'ask_user', displayName: 'AskUserQuestion' },
  askuserquestion: { id: 'ask_user', displayName: 'AskUserQuestion' },
  todo_read: { id: 'todo_read', displayName: 'TodoRead' },
  todoread: { id: 'todo_read', displayName: 'TodoRead' },
  todo_write: { id: 'todo_write', displayName: 'TodoWrite' },
  todowrite: { id: 'todo_write', displayName: 'TodoWrite' },
  task: { id: 'delegate_task', displayName: 'Task' },
  agent: { id: 'delegate_task', displayName: 'Task' },
  delegate_task: { id: 'delegate_task', displayName: 'Task' },
  task_create: { id: 'task_create', displayName: 'TaskCreate' },
  taskcreate: { id: 'task_create', displayName: 'TaskCreate' },
  task_update: { id: 'task_update', displayName: 'TaskUpdate' },
  taskupdate: { id: 'task_update', displayName: 'TaskUpdate' },
  task_list: { id: 'task_list', displayName: 'TaskList' },
  tasklist: { id: 'task_list', displayName: 'TaskList' },
  task_get: { id: 'task_get', displayName: 'TaskGet' },
  taskget: { id: 'task_get', displayName: 'TaskGet' },
  plan_update: { id: 'plan_update', displayName: 'PlanUpdate' },
  plan_read: { id: 'plan_read', displayName: 'PlanRead' },
  exit_plan_mode: { id: 'exit_plan_mode', displayName: 'ExitPlanMode' },
  exitplanmode: { id: 'exit_plan_mode', displayName: 'ExitPlanMode' },
  terminal_open: { id: 'terminal_open', displayName: 'TerminalOpen' },
  terminal_read: { id: 'terminal_read', displayName: 'TerminalRead' },
  terminal_write: { id: 'terminal_write', displayName: 'TerminalWrite' },
  terminal_list: { id: 'terminal_list', displayName: 'TerminalList' },
  terminal_close: { id: 'terminal_close', displayName: 'TerminalClose' },
  memory_retrieve: { id: 'memory_retrieve', displayName: 'MemoryRetrieve' },
  remember: { id: 'remember', displayName: 'Remember' },
  artifact_publish: { id: 'artifact_publish', displayName: 'ArtifactPublish' },
  app_publish: { id: 'app_publish', displayName: 'AppPublish' },
  web_fetch: { id: 'web_fetch', displayName: 'WebFetch' },
  web_search: { id: 'web_search', displayName: 'WebSearch' },
  browser_open: { id: 'browser_open', displayName: 'BrowserOpen' },
  browser_show: { id: 'browser_show', displayName: 'BrowserShow' },
  browser_snapshot: { id: 'browser_snapshot', displayName: 'BrowserSnapshot' },
  browser_action: { id: 'browser_action', displayName: 'BrowserAction' },
  automation_list: { id: 'automation_list', displayName: 'AutomationList' },
  automation_create: { id: 'automation_create', displayName: 'AutomationCreate' },
  automation_update: { id: 'automation_update', displayName: 'AutomationUpdate' },
  integration_list: { id: 'integration_list', displayName: 'IntegrationList' },
  integration_tools: { id: 'integration_tools', displayName: 'IntegrationTools' },
  integration_call: { id: 'integration_call', displayName: 'IntegrationCall' },
  mcp_reconnect: { id: 'mcp_reconnect', displayName: 'McpReconnect' },
  mcp_authorize: { id: 'mcp_authorize', displayName: 'McpAuthorize' },
  media_generate: { id: 'media_generate', displayName: 'MediaGenerate' },
  tool_search: { id: 'tool_search', displayName: 'ToolSearch' },
  tool_describe: { id: 'tool_describe', displayName: 'ToolDescribe' },
  tool_call: { id: 'tool_call', displayName: 'ToolCall' },
});

function normalizedToolToken(value) {
  return String(value || '').trim().replace(/[\s.-]+/g, '_').toLowerCase();
}

export function normalizeAgentToolName(toolName) {
  const nativeName = String(toolName || '').trim() || 'unknown';
  const token = normalizedToolToken(nativeName);
  if (token.startsWith('mcp__')) {
    return Object.freeze({ id: 'mcp_tool', displayName: nativeName, nativeName });
  }
  const alias = TOOL_ALIASES[token] || null;
  if (alias) return Object.freeze({ ...alias, nativeName });
  return Object.freeze({ id: token || 'unknown', displayName: nativeName, nativeName });
}

export function canonicalAgentToolName(toolName) {
  return normalizeAgentToolName(toolName).displayName;
}

export function canonicalAgentToolId(toolName) {
  return normalizeAgentToolName(toolName).id;
}

export function createAgentRuntimeEvent({
  type,
  entityType,
  provider = null,
  runtimeId = provider,
  sessionId = null,
  runId = null,
  entityId = null,
  timestamp = new Date().toISOString(),
  data = {},
} = {}) {
  if (!Object.values(AGENT_RUNTIME_EVENT_TYPES).includes(type)) {
    throw new TypeError(`Unsupported agent runtime event type "${type || 'unknown'}".`);
  }
  if (!Object.values(AGENT_ENTITY_TYPES).includes(entityType)) {
    throw new TypeError(`Unsupported agent entity type "${entityType || 'unknown'}".`);
  }
  return {
    schema: AGENT_RUNTIME_EVENT_SCHEMA,
    type,
    entityType,
    provider,
    runtimeId,
    sessionId,
    runId,
    entityId,
    timestamp,
    data: data && typeof data === 'object' && !Array.isArray(data) ? data : {},
  };
}

export function isAgentRuntimeEvent(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && value.schema === AGENT_RUNTIME_EVENT_SCHEMA
    && Object.values(AGENT_RUNTIME_EVENT_TYPES).includes(value.type)
    && Object.values(AGENT_ENTITY_TYPES).includes(value.entityType),
  );
}
