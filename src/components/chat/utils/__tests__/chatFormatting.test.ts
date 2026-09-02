import { describe, it, expect } from 'vitest';
import {
  buildAssistantMessages,
  formatDurationSeconds,
  getProviderDisplayName,
} from '../chatFormatting';

describe('buildAssistantMessages', () => {
  const timestamp = new Date('2025-01-01T00:00:00Z');

  it('returns single message for plain text', () => {
    const result = buildAssistantMessages('Hello world', timestamp);
    expect(result).toEqual([
      { type: 'assistant', content: 'Hello world', timestamp },
    ]);
  });

  it('does not add isThinking to non-thinking messages', () => {
    const result = buildAssistantMessages('plain text', timestamp);
    expect(result[0]).not.toHaveProperty('isThinking');
  });

});

describe('formatDurationSeconds', () => {
  it('formats sub-minute durations with seconds', () => {
    expect(formatDurationSeconds(7)).toBe('7s');
  });

  it('formats minute durations as m:ss', () => {
    expect(formatDurationSeconds(171)).toBe('2:51');
  });

  it('formats hour durations as h:mm:ss', () => {
    expect(formatDurationSeconds(3723)).toBe('1:02:03');
  });
});

describe('getProviderDisplayName', () => {
  it('keeps the Pi provider name independent from its current permission mode', () => {
    expect(getProviderDisplayName('pi')).toBe('Pi');
  });
});
