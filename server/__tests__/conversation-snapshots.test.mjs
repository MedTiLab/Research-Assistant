import { describe, expect, it } from 'vitest';

import { buildVisibleConversationMessages } from '../utils/conversationSnapshots.js';

describe('conversation snapshot privacy filter', () => {
  it('keeps visible user and assistant text while removing tools and internal prompts', () => {
    const messages = buildVisibleConversationMessages([
      { type: 'user', content: 'Visible question', timestamp: '2026-07-15T00:00:00.000Z' },
      { type: 'tool_use', content: '/Users/customer/private.csv', toolInput: { path: '/private.csv' } },
      { type: 'assistant', content: '# MedHelp Skills (internal)\nNever render this' },
      { type: 'assistant', content: 'Visible answer', reasoning: 'hidden chain' },
      { type: 'thinking', content: 'hidden reasoning' },
    ]);

    expect(messages).toEqual([
      { role: 'user', content: 'Visible question', timestamp: '2026-07-15T00:00:00.000Z' },
      expect.objectContaining({ role: 'assistant', content: 'Visible answer' }),
    ]);
    expect(JSON.stringify(messages)).not.toContain('private.csv');
    expect(JSON.stringify(messages)).not.toContain('hidden chain');
  });

  it('strips injected file-path notes from user messages', () => {
    const messages = buildVisibleConversationMessages([{
      role: 'user',
      content: 'Summarize the attachment\n\n[Files available at the following paths]\n1. /Users/customer/private.pdf\n',
    }]);

    expect(messages[0]?.content).toBe('Summarize the attachment');
  });

  it('omits loaded skill bodies while preserving the surrounding conversation', () => {
    const messages = buildVisibleConversationMessages([
      { role: 'user', content: 'Review this manuscript' },
      {
        role: 'user',
        content: '<command-name>peer-review</command-name>\nBase directory for this skill: /private/skills/peer-review\n# Full private skill body',
      },
      { role: 'assistant', content: 'Here is the review.' },
    ]);

    expect(messages.map((message) => message.content)).toEqual([
      'Review this manuscript',
      'Here is the review.',
    ]);
    expect(JSON.stringify(messages)).not.toContain('Full private skill body');
  });
});
