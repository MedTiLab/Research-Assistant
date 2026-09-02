import { describe, expect, it } from 'vitest';

import { DEFAULT_LANGUAGE, getInitialLanguage } from './languagePreference';

describe('initial interface language', () => {
  it('defaults to Simplified Chinese when no preference was saved', () => {
    expect(getInitialLanguage({ getItem: () => null })).toBe('zh-CN');
    expect(DEFAULT_LANGUAGE).toBe('zh-CN');
  });

  it('preserves an explicitly saved supported language', () => {
    expect(getInitialLanguage({ getItem: () => 'en' })).toBe('en');
  });

  it('falls back to Simplified Chinese for invalid or inaccessible preferences', () => {
    expect(getInitialLanguage({ getItem: () => 'unsupported' })).toBe('zh-CN');
    expect(getInitialLanguage({ getItem: () => { throw new Error('blocked'); } })).toBe('zh-CN');
  });
});
