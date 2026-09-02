import type { ChatMessage } from '../types/types';

type CodexTodoStatus = 'pending' | 'in_progress' | 'completed';

export interface CodexTodoItem {
  id: string;
  content: string;
  status: CodexTodoStatus;
}

const normalizeCodexTodoStatus = (status: unknown, completed: unknown): CodexTodoStatus => {
  const normalized = String(status || '').trim().toLowerCase().replace(/[-\s]/g, '_');
  if (completed === true || ['completed', 'complete', 'done'].includes(normalized)) {
    return 'completed';
  }
  if (['inprogress', 'in_progress', 'active'].includes(normalized)) {
    return 'in_progress';
  }
  return 'pending';
};

export const normalizeCodexTodoItems = (
  items: unknown,
  itemId = 'codex-plan',
): CodexTodoItem[] => {
  if (!Array.isArray(items)) {
    return [];
  }

  return items.flatMap((item, index) => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const source = item as Record<string, unknown>;
    const content = String(source.text || source.content || source.title || '').trim();
    if (!content) {
      return [];
    }

    return [{
      id: String(source.id || `${itemId}:${index + 1}`),
      content,
      status: normalizeCodexTodoStatus(source.status, source.completed),
    }];
  });
};

export const upsertCodexTodoSnapshot = (
  messages: ChatMessage[],
  data: { itemId?: string; items?: unknown; sessionId?: string | null },
  timestamp: string | number | Date = new Date(),
): ChatMessage[] => {
  const itemId = String(data.itemId || 'codex-plan');
  const todos = normalizeCodexTodoItems(data.items, itemId);
  const messagesWithoutPreviousSnapshot = messages.filter((message) => (
    message.isCodexTodoSnapshot !== true
    && !(message.toolName === 'TodoWrite' && message.codexItemId === itemId)
  ));

  if (todos.length === 0) {
    return messagesWithoutPreviousSnapshot;
  }

  return [
    ...messagesWithoutPreviousSnapshot,
    {
      type: 'assistant',
      content: '',
      timestamp,
      isToolUse: true,
      toolName: 'TodoWrite',
      toolInput: { todos },
      toolResult: null,
      codexItemId: itemId,
      codexSessionId: data.sessionId || null,
      isCodexTodoSnapshot: true,
    },
  ];
};

export const retainCodexTodoSnapshot = (
  liveMessages: ChatMessage[],
  persistedMessages: ChatMessage[],
  sessionId: string | null,
): ChatMessage[] => {
  if (!sessionId) {
    return persistedMessages;
  }

  const snapshot = [...liveMessages].reverse().find((message) => (
    message.isCodexTodoSnapshot === true && message.codexSessionId === sessionId
  ));
  if (!snapshot) {
    return persistedMessages;
  }

  const withoutDuplicate = persistedMessages.filter((message) => (
    message.isCodexTodoSnapshot !== true
    || message.codexSessionId !== sessionId
  ));
  const snapshotTime = new Date(snapshot.timestamp).getTime();
  const insertionIndex = withoutDuplicate.findIndex((message) => {
    const messageTime = new Date(message.timestamp).getTime();
    return Number.isFinite(snapshotTime)
      && Number.isFinite(messageTime)
      && messageTime > snapshotTime;
  });

  if (insertionIndex < 0) {
    return [...withoutDuplicate, snapshot];
  }

  return [
    ...withoutDuplicate.slice(0, insertionIndex),
    snapshot,
    ...withoutDuplicate.slice(insertionIndex),
  ];
};
