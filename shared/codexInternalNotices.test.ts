import { describe, expect, it } from 'vitest';

import {
  isCodexInternalContextContent,
  isCodexInternalNoticeContent,
  isCodexInternalPromptContent,
} from './codexInternalNotices.js';

describe('Codex internal content filters', () => {
  it('recognizes MedHelp prompt scaffolding without classifying normal answers', () => {
    expect(isCodexInternalPromptContent([
      '# MedHelp Skills (available outside the project workspace)',
      '',
      '<path_display_rule>',
      'Keep internal paths private.',
      '</path_display_rule>',
      '',
      'User request:',
      '分析这份数据',
    ].join('\n'))).toBe(true);
    expect(isCodexInternalPromptContent('I used the requested skill and completed the analysis.')).toBe(false);
  });

  it('keeps the existing skill-budget notice matcher intact', () => {
    expect(isCodexInternalNoticeContent(
      'Skill descriptions were shortened to fit the 2% skills context budget. Codex can still see every skill.',
    )).toBe(true);
  });

  it('recognizes raw and escaped Codex goal-continuation context', () => {
    const raw = [
      '<codex_internal_context source="goal">',
      'Continue working toward the active thread goal.',
      '<objective>持续监控任务</objective>',
      '</codex_internal_context>',
    ].join('\n');
    const escaped = raw
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    expect(isCodexInternalContextContent(raw)).toBe(true);
    expect(isCodexInternalContextContent(escaped)).toBe(true);
    expect(isCodexInternalPromptContent(raw)).toBe(true);
    expect(isCodexInternalPromptContent('请解释 codex internal context 的作用')).toBe(false);
  });
});
