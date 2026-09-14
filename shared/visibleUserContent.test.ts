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

  it.each([
    wrapVisibleUserContent('上一轮问题').replace(/\n/g, ' '),
    '<medhelp_visible_user_content version="1"> 被截断的上一轮问题',
  ])('ignores quoted visibility tags in execution memory: %s', (previousPrompt) => {
    const prompt = `<execution_memory>\nObjective changed: ${previousPrompt}\n</execution_memory>\n\nUser request:\n${wrapVisibleUserContent('本轮问题')}`;
    expect(extractVisibleUserContent(prompt)).toBe('本轮问题');
    const range = findVisibleUserContentRange(prompt)!;
    expect(prompt.slice(range.start, range.end)).toBe('本轮问题');
  });

  it('does not extend the current boundary into a quoted prompt in appended memory', () => {
    const prompt = `${wrapVisibleUserContent('本轮问题')}\n<medhelp_project_memory>${wrapVisibleUserContent('旧问题')}</medhelp_project_memory>`;
    expect(extractVisibleUserContent(prompt)).toBe('本轮问题');
  });

  it('marks a legacy current request even when memory contains an older boundary', () => {
    const prefix = `<execution_memory>${wrapVisibleUserContent('旧问题')}</execution_memory>`;
    expect(extractVisibleUserContent(prefix)).toBeNull();
    const marked = markVisibleUserContent(`${prefix}\nUser request:\n新的问题`, '新的问题');
    expect(extractVisibleUserContent(marked)).toBe('新的问题');
  });

  it('preserves runtime tags quoted inside the actual user input', () => {
    const input = `解释这段内容：<execution_memory>${wrapVisibleUserContent('示例')}</execution_memory>`;
    expect(extractVisibleUserContent(wrapVisibleUserContent(input))).toBe(input);
  });
});
