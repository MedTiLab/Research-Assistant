import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '../types/types';
import { createMessageKeyAllocator } from './messageKeys';

describe('chat message key allocation', () => {
  it('reuses a persisted identity across snapshot object replacement', () => {
    const allocate = createMessageKeyAllocator();
    const first: ChatMessage = {
      type: 'assistant',
      content: 'Final answer',
      timestamp: '2026-08-19T01:00:00.000Z',
      messageId: 'persisted-final-answer',
    };
    const refreshed = { ...first };

    expect(allocate(first)).toBe('message-assistant-persisted-final-answer');
    expect(allocate(refreshed)).toBe(allocate(first));
  });

  it('keeps identical messages without explicit ids unique', () => {
    const allocate = createMessageKeyAllocator();
    const first: ChatMessage = {
      type: 'assistant',
      content: 'Repeated status',
      timestamp: '2026-08-19T01:00:00.000Z',
    };
    const second = { ...first };

    expect(allocate(second)).not.toBe(allocate(first));
  });
});
