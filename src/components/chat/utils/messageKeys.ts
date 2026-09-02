import type { ChatMessage } from '../types/types';

const toMessageKeyPart = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
};

export const getIntrinsicMessageKey = (message: ChatMessage): string | null => {
  const candidates = [
    message.id,
    message.messageId,
    message.toolId,
    message.toolCallId,
    message.blobId,
    message.rowid,
    message.sequence,
  ];

  for (const candidate of candidates) {
    const keyPart = toMessageKeyPart(candidate);
    if (keyPart) {
      return `message-${message.type}-${keyPart}`;
    }
  }

  const timestamp = new Date(message.timestamp).getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const contentPreview = typeof message.content === 'string' ? message.content.slice(0, 48) : '';
  const toolName = typeof message.toolName === 'string' ? message.toolName : '';
  return `message-${message.type}-${timestamp}-${toolName}-${contentPreview}`;
};

export const getExplicitMessageKey = (message: ChatMessage): string | null => {
  const candidates = [
    message.id,
    message.messageId,
    message.toolId,
    message.toolCallId,
    message.blobId,
    message.rowid,
    message.sequence,
  ];

  for (const candidate of candidates) {
    const keyPart = toMessageKeyPart(candidate);
    if (keyPart) {
      return `message-${message.type}-${keyPart}`;
    }
  }

  return null;
};

export const createMessageKeyAllocator = () => {
  const objectKeys = new WeakMap<ChatMessage, string>();
  const allocatedFallbackKeys = new Set<string>();
  let generatedCounter = 0;

  return (message: ChatMessage): string => {
    const existingKey = objectKeys.get(message);
    if (existingKey) {
      return existingKey;
    }

    // Provider and persisted ids describe message identity, not object
    // identity. Reuse them when a final transcript snapshot recreates the
    // message objects so React does not remount and visually jump every row.
    const explicitKey = getExplicitMessageKey(message);
    if (explicitKey) {
      objectKeys.set(message, explicitKey);
      return explicitKey;
    }

    const fallbackKey = getIntrinsicMessageKey(message);
    let candidateKey = fallbackKey;
    if (!candidateKey || allocatedFallbackKeys.has(candidateKey)) {
      do {
        generatedCounter += 1;
        candidateKey = fallbackKey
          ? `${fallbackKey}-${generatedCounter}`
          : `message-generated-${generatedCounter}`;
      } while (allocatedFallbackKeys.has(candidateKey));
    }

    allocatedFallbackKeys.add(candidateKey);
    objectKeys.set(message, candidateKey);
    return candidateKey;
  };
};
