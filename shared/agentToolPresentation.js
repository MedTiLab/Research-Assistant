import { canonicalAgentToolName } from './agentRuntimeEvents.js';

export function parseToolValue(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

export function toolResultValue(result) {
  let value = parseToolValue(result?.content ?? result);
  if (Array.isArray(value) && value.some((part) => part?.type === 'text')) {
    value = parseToolValue(value.filter((part) => part?.type === 'text').map((part) => part.text).join('\n'));
  }
  return value;
}

// Presentation aliases only: never use these to authorize or execute a tool.
export function normalizeToolPresentationInput(toolName, input) {
  const value = parseToolValue(input);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const name = canonicalAgentToolName(toolName);
  if (['TaskCreate', 'TaskUpdate', 'TaskGet'].includes(name)) {
    return { ...value, subject: value.subject ?? value.title, taskId: value.taskId ?? value.task_id };
  }
  return value;
}

export function toolEditChanges(input) {
  const value = parseToolValue(input) || {};
  const edits = Array.isArray(value.edits) ? value.edits : [value];
  return edits.map((edit) => ({
    oldContent: edit.old_string ?? edit.oldText ?? '',
    newContent: edit.new_string ?? edit.newText ?? '',
    filePath: value.file_path || value.path || '',
  }));
}

export function toolTodoItems(result) {
  const value = toolResultValue(result);
  return Array.isArray(value) ? value : Array.isArray(value?.todos) ? value.todos : [];
}

export function toolSearchFiles(result) {
  const value = toolResultValue(result);
  const details = result?.toolUseResult || result?.details || value;
  const files = details?.filenames || details?.files || (Array.isArray(value) ? value : null);
  if (Array.isArray(files)) {
    return [...new Set(files.map((entry) => typeof entry === 'string' ? entry : entry?.path).filter(Boolean))];
  }
  if (typeof value !== 'string') return [];
  return [...new Set(value.split('\n').flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || /^(?:no (?:matches|files)|found \d|\[|\.\.\.)/i.test(trimmed)) return [];
    const match = trimmed.match(/^(.+?):\d+(?::|[- ])/);
    if (match) return [match[1]];
    return /[/\\.]|^[\w-]+$/.test(trimmed) && !/\s{2,}/.test(trimmed) ? [trimmed] : [];
  }))];
}

export const TERMINAL_TASK_STATUSES = Object.freeze(['completed', 'failed', 'cancelled', 'interrupted']);

/** @param {any} result @param {string | null} [status] */
export function subagentStatus(result, status = null) {
  if (result?.isError) return 'failed';
  const value = toolResultValue(result);
  const explicit = status || value?.status;
  if (typeof explicit === 'string') return explicit;
  return result ? 'completed' : 'running';
}

/** @param {any} result @param {string | null} [status] */
export function isSubagentComplete(result, status = null) {
  return TERMINAL_TASK_STATUSES.includes(subagentStatus(result, status));
}
