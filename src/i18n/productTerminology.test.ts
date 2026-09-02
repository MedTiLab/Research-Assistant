import { describe, expect, it } from 'vitest';

import enCommon from './locales/en/common.json';
import enNews from './locales/en/news.json';
import enSettings from './locales/en/settings.json';
import enSidebar from './locales/en/sidebar.json';
import zhCommon from './locales/zh-CN/common.json';
import zhNews from './locales/zh-CN/news.json';
import zhSettings from './locales/zh-CN/settings.json';
import zhSidebar from './locales/zh-CN/sidebar.json';

const collectStrings = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectStrings);
  }
  return [];
};

describe('customer-facing Local Engine terminology', () => {
  it('does not expose the internal Kernel name in localized copy', () => {
    const localizedStrings = collectStrings([
      enCommon,
      enNews,
      enSettings,
      enSidebar,
      zhCommon,
      zhNews,
      zhSettings,
      zhSidebar,
    ]);

    expect(localizedStrings.filter((value) => /\bKernel\b|内核/.test(value))).toEqual([]);
  });
});
