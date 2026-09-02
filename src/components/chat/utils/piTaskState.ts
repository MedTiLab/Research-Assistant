import type { ChatMessage } from '../types/types';
import { TERMINAL_TASK_STATUSES } from '../../../../shared/agentToolPresentation.js';

export function discardPiFailedAttempt(messages: ChatMessage[], messageId?: string): ChatMessage[] {
  if (messageId) return messages.filter((message) => message.isToolUse || message.piMessageId !== messageId);
  // Older hosts have no attempt id. Only discard the trailing streaming text.
  let end = messages.length;
  while (end && messages[end - 1].type === 'assistant' && messages[end - 1].isStreaming && !messages[end - 1].isToolUse) end -= 1;
  return messages.slice(0, end);
}

export function applyPiTaskState(messages: ChatMessage[], tasks: Array<Record<string, any>>): ChatMessage[] {
  const byCall = new Map(tasks.filter((task) => task.toolCallId).map((task) => [task.toolCallId, task]));
  return messages.map((message) => {
    const task = byCall.get(message.toolId || message.toolCallId);
    if (!message.isSubagentContainer || !task) return message;
    if (task.updatedAt && message.subagentState?.updatedAt && task.updatedAt < message.subagentState.updatedAt) return message;
    const terminal = TERMINAL_TASK_STATUSES.includes(task.status);
    const children = task.childTools || message.subagentState?.childTools || [];
    return { ...message,
      toolResult: { content: JSON.stringify({ task_id: task.id, child_session_id: task.childSessionId || null, status: task.status, result: task.result || null, error: task.error || null }),
        isError: ['failed', 'interrupted'].includes(task.status) },
      subagentState: { childTools: children, currentToolIndex: children.length - 1, status: task.status, isComplete: terminal, updatedAt: task.updatedAt },
    };
  });
}
