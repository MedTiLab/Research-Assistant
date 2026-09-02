import { describe, expect, it } from 'vitest';

import { sanitizeProvider } from './useChatProviderState';

describe('sanitizeProvider', () => {
  it('accepts only Pi', () => {
    expect(sanitizeProvider('claude')).toBeNull();
    expect(sanitizeProvider('codex')).toBeNull();
    expect(sanitizeProvider('pi')).toBe('pi');
    expect(sanitizeProvider('unknown-runtime')).toBeNull();
    expect(sanitizeProvider('local')).toBeNull();
  });
});
