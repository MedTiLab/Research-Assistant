import type { ChatMessage } from '../types/types';

const MAX_CONTEXT_MESSAGES = 16;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_CONTEXT_CHARS = 24_000;

const normalizeMessageText = (message: ChatMessage) => {
  if (
    message.isToolUse
    || message.isThinking
    || message.isSkillContent
    || typeof message.content !== 'string'
  ) {
    return null;
  }

  const content = message.content.trim();
  if (!content) {
    return null;
  }

  const role = message.type === 'user' ? 'User' : message.type === 'assistant' ? 'Assistant' : null;
  if (!role) {
    return null;
  }

  return `${role}: ${content.slice(0, MAX_MESSAGE_CHARS)}`;
};

export function buildSelectionConsultationContext(messages: ChatMessage[]) {
  const candidates = messages
    .map(normalizeMessageText)
    .filter((message): message is string => Boolean(message))
    .slice(-MAX_CONTEXT_MESSAGES);

  const selected: string[] = [];
  let currentLength = 0;
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (selected.length > 0 && currentLength + candidate.length > MAX_CONTEXT_CHARS) {
      break;
    }
    selected.unshift(candidate);
    currentLength += candidate.length;
  }

  return selected.join('\n\n');
}

export function buildSelectionConsultationPrompt(
  selectedText: string,
  conversationContext: string,
  userQuestion?: string,
) {
  const question = userQuestion?.trim() || '请结合上下文解释所选内容，说明它的含义、作用以及需要注意的地方。';

  return [
    '[Context: session-mode=consultation]',
    '[Consultation rules: This is an explanation-only side conversation. Do not edit or create files, run shell commands, change tasks, modify project state, or start a research workflow. You may only inspect read-only context when necessary. Answer the question directly and clearly.]',
    conversationContext ? `Original conversation snapshot:\n${conversationContext}` : '',
    `Selected text:\n${selectedText}`,
    `User question:\n${question}`,
  ].filter(Boolean).join('\n\n');
}
