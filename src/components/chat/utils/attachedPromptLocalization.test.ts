import { describe, expect, it } from 'vitest';

import englishChat from '../../../i18n/locales/en/chat.json';
import chineseChat from '../../../i18n/locales/zh-CN/chat.json';
import type { AttachedPrompt } from '../types/types';
import {
  getAttachedPromptInputPlaceholder,
  localizeAttachedPrompt,
} from './attachedPromptLocalization';

function flattenStrings(value: unknown, prefix = '', output: Record<string, string> = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return output;
  }

  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') {
      output[path] = child;
    } else {
      flattenStrings(child, path, output);
    }
  }

  return output;
}

describe('localizeAttachedPrompt', () => {
  it('rebuilds an existing Chinese prompt capsule in English', () => {
    const english = {
      'guidedStarter.scenarios.databaseAccess.title': 'Database Extraction',
      'guidedStarter.prompts.databaseAccess': 'Please help me with "{{scenario}}". Available skills: {{skills}}.\n\nMy task:',
    } as const;
    const t = (key: string, options: Record<string, unknown> = {}) => {
      let value: string = english[key as keyof typeof english] || key;
      for (const [name, replacement] of Object.entries(options)) {
        value = value.split(`{{${name}}}`).join(String(replacement));
      }
      return value;
    };
    const prompt: AttachedPrompt = {
      scenarioId: 'database-access',
      scenarioIcon: '🗄️',
      scenarioTitle: '数据库提取',
      promptText: '请协助我完成“数据库提取”。可用技能：medhelp-database-api-access。\n\n我的任务：',
      localization: {
        promptKey: 'guidedStarter.prompts.databaseAccess',
        titleKey: 'guidedStarter.scenarios.databaseAccess.title',
        skills: ['medhelp-database-api-access'],
      },
    };

    expect(localizeAttachedPrompt(t, prompt)).toMatchObject({
      scenarioTitle: 'Database Extraction',
      promptText: 'Please help me with "Database Extraction". Available skills: medhelp-database-api-access.\n\nMy task:',
    });
  });

  it('preserves prompts without localization metadata', () => {
    const prompt: AttachedPrompt = {
      scenarioId: 'custom',
      scenarioIcon: '✨',
      scenarioTitle: 'Custom',
      promptText: 'My manually edited prompt',
    };

    expect(localizeAttachedPrompt((key) => key, prompt)).toBe(prompt);
  });

  it('routes watch-news through agent-reach before the isolated browser', () => {
    expect(chineseChat.guidedStarter.prompts.watchNews).toMatch(/先使用 agent-reach[\s\S]*再改用隔离的 Agent 浏览器/);
    expect(englishChat.guidedStarter.prompts.watchNews).toMatch(/First use agent-reach[\s\S]*fall back to the isolated agent browser/i);
  });

  it('keeps every Chinese shortcut and capsule prompt available in English', () => {
    const englishPrompts = flattenStrings({
      skillShortcuts: englishChat.skillShortcuts,
      guidedStarter: englishChat.guidedStarter,
    });
    const chinesePrompts = flattenStrings({
      skillShortcuts: chineseChat.skillShortcuts,
      guidedStarter: chineseChat.guidedStarter,
    });

    expect(Object.keys(chinesePrompts).filter((key) => !(key in englishPrompts))).toEqual([]);
    expect(
      Object.entries(englishPrompts).filter(([, value]) => /[\u3400-\u9fff]/u.test(value)),
    ).toEqual([]);
  });
});

describe('getAttachedPromptInputPlaceholder', () => {
  it('uses the selected scenario input label as the placeholder', () => {
    expect(getAttachedPromptInputPlaceholder(
      '请使用文献获取技能。\n\n我要下载的文献：',
    )).toBe('我要下载的文献：');
    expect(getAttachedPromptInputPlaceholder(
      'Use literature-acquisition skills.\n\nLiterature to download:',
    )).toBe('Literature to download:');
  });

  it('ignores arbitrary or overly long final prompt lines', () => {
    expect(getAttachedPromptInputPlaceholder('A manually edited prompt')).toBeNull();
    expect(getAttachedPromptInputPlaceholder(`${'x'.repeat(121)}:`)).toBeNull();
  });
});
