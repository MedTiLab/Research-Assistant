import { describe, expect, it } from 'vitest';
import enWorkbench from './locales/en/workbench.json';
import zhWorkbench from './locales/zh-CN/workbench.json';

const collectKeys = (value: unknown, prefix = ''): string[] => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value).flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof child === 'string' || Array.isArray(child) ? [path] : collectKeys(child, path);
    });
  }
  return [];
};

describe('workbench locale files', () => {
  it('keeps English and Chinese keys in lockstep', () => {
    expect(collectKeys(enWorkbench).sort()).toEqual(collectKeys(zhWorkbench).sort());
  });
});
