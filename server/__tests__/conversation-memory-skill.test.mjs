import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('conversation-memory skill', () => {
  it('is registered in the skill catalog with the intended capabilities', async () => {
    const catalog = JSON.parse(
      await readFile(path.join(repoRoot, 'skills/skills-catalog-v2.json'), 'utf8'),
    );
    const skill = catalog.skills.find((entry) => entry.name === 'conversation-memory');

    expect(skill).toMatchObject({
      name: 'conversation-memory',
      primaryIntent: 'deployment',
      capabilities: ['agent-workflow', 'prompt-structured-output'],
      domains: ['general'],
    });
  });

  it('keeps confirmation in the current conversation and writes only root MEMORY.md', async () => {
    const content = await readFile(
      path.join(repoRoot, 'skills/conversation-memory/SKILL.md'),
      'utf8',
    );

    expect(content).toContain('AskUserQuestion');
    expect(content).toContain('multiSelect: true');
    expect(content).toContain('current project root `MEMORY.md`');
    expect(content).toContain('Do not create a hidden directory');
    expect(content).toContain('Do not write anything until the user answers');
    expect(content).toContain('medhelp:auto-memory:start');
    expect(content).toContain('preserve source fields, coding, reference groups, units, formulas');
  });

  it('tells every supported agent how automatic project memory is injected and verified', async () => {
    const [agentsTemplate, claudeTemplate] = await Promise.all([
      readFile(path.join(repoRoot, 'server/templates/AGENTS.md'), 'utf8'),
      readFile(path.join(repoRoot, 'server/templates/CLAUDE.md'), 'utf8'),
    ]);

    for (const template of [agentsTemplate, claudeTemplate]) {
      expect(template).toContain('durable project memory is stored at `.medhelpsec/MEMORY.md`');
      expect(template).toContain('injects it under `## What you remember`');
      expect(template).toContain('not as a user request');
      expect(template).toContain('Never use memory alone to establish a medical fact');
      expect(template).toContain('medhelp:auto-memory:start');
      expect(template).toContain('correct or forget a named automatic fact');
    }
  });

  it('uses the shared MedHelpSec memory path for the sidebar action', async () => {
    const [zh, en] = await Promise.all([
      readFile(path.join(repoRoot, 'src/i18n/locales/zh-CN/chat.json'), 'utf8'),
      readFile(path.join(repoRoot, 'src/i18n/locales/en/chat.json'), 'utf8'),
    ]);

    expect(JSON.parse(zh).sessionContext.memory.prompts.review).toBe(
      '总结当前对话，并把确认后的长期信息更新到 `.medhelpsec/MEMORY.md`。',
    );
    expect(JSON.parse(en).sessionContext.memory.prompts.review).toBe(
      'Review this conversation and save confirmed long-term context to `.medhelpsec/MEMORY.md`.',
    );
  });
});
