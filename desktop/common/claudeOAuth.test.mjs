import { describe, expect, it } from 'vitest';

import { findTrustedClaudeAuthUrl } from './claudeOAuth.mjs';

describe('findTrustedClaudeAuthUrl', () => {
  it.each([
    'https://claude.com/oauth/authorize?code=test',
    'https://auth.claude.ai/oauth/authorize?code=test',
    'https://console.anthropic.com/oauth/authorize?code=test',
  ])('accepts first-party Claude authorization URLs', (url) => {
    expect(findTrustedClaudeAuthUrl(`Open ${url}`)).toBe(url);
  });

  it('trims terminal punctuation from an authorization URL', () => {
    expect(findTrustedClaudeAuthUrl('Open (https://claude.com/oauth/authorize).'))
      .toBe('https://claude.com/oauth/authorize');
  });

  it.each([
    'http://claude.com/oauth/authorize',
    'https://claude.com.example.org/oauth/authorize',
    'https://anthropic.com.example.org/oauth/authorize',
    'https://example.org/oauth/authorize',
  ])('rejects untrusted authorization URLs', (url) => {
    expect(findTrustedClaudeAuthUrl(`Open ${url}`)).toBeNull();
  });
});
