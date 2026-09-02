import type { ChatMessage } from '../types/types';
import { buildAssistantMessages, formatUsageLimitText, unescapeWithMathProtection } from './chatFormatting';

export function appendStreamingContent(messages: ChatMessage[], chunk: string, newline = false, piMessageId?: string): ChatMessage[] {
  if (!chunk) return messages;
  const updated = [...messages];
  // Pi deltas belong to a message, not whichever notice happens to be last.
  let index = updated.length - 1;
  if (piMessageId) {
    while (index >= 0) {
      const message = updated[index];
      if (message.type === 'assistant' && message.isStreaming && !message.isToolUse
        && !message.isThinking && message.piMessageId === piMessageId) break;
      index -= 1;
    }
  }
  const current = updated[index];
  if (current?.type === 'assistant' && !current.isToolUse && current.isStreaming) {
    updated[index] = { ...current, content: `${current.content || ''}${newline && current.content ? '\n' : ''}${chunk}` };
  } else {
    const lastIndex = updated.length - 1;
    const last = updated[lastIndex];
    if (piMessageId && last?.isThinking && last.isStreaming) updated[lastIndex] = { ...last, isStreaming: false };
    updated.push({ type: 'assistant', content: chunk, timestamp: new Date(), isStreaming: true, ...(piMessageId ? { piMessageId } : {}) });
  }
  return updated;
}

export function finalizeStreamingContent(messages: ChatMessage[], piMessageId?: string): ChatMessage[] {
  return messages.flatMap((message, index) => {
    const matches = piMessageId ? message.piMessageId === piMessageId : index === messages.length - 1;
    if (!matches || message.type !== 'assistant' || !message.isStreaming || message.isToolUse) return [message];
    const normalized = unescapeWithMathProtection(formatUsageLimitText(String(message.content || '')));
    return buildAssistantMessages(normalized, message.timestamp || new Date()).map((part) => ({
      ...message, content: part.content, isStreaming: false,
      isThinking: Boolean(part.isThinking || (piMessageId && message.isThinking)),
    }));
  });
}
