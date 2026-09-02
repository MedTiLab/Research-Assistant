import { describe, expect, it } from 'vitest';

import {
  extractVisibleUserContent,
  findVisibleUserContentRange,
  markVisibleUserContent,
  wrapVisibleUserContent,
} from './visibleUserContent.js';

describe('visible user content boundary', () => {
  it('extracts only user-authored text between arbitrary internal blocks', () => {
    const wrapped = wrapVisibleUserContent('用户输入。');
    const prompt = `future prefix\n${wrapped}\nfuture suffix`;

    expect(extractVisibleUserContent(prompt)).toBe('用户输入。');
    expect(markVisibleUserContent(prompt, '用户输入。')).toBe(prompt);
  });

  it('locates short repeated user text from the boundary instead of punctuation matching', () => {
    const wrapped = wrapVisibleUserContent('.');
    const prompt = `prefix.with.periods\n${wrapped}\n/path/file.csv`;
    const range = findVisibleUserContentRange(prompt);

    expect(range).not.toBeNull();
    expect(prompt.slice(range!.start, range!.end)).toBe('.');
  });
});
