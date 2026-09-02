import { describe, expect, it } from 'vitest';
import { createAppChatDraft } from './createAppChatDraft';

describe('createAppChatDraft', () => {
  it('creates an empty new-chat draft with the Create App shortcut attached', () => {
    const t = (key: string, options?: Record<string, unknown>) => {
      if (key === 'guidedStarter.scenarios.createProgram.title') return '创建应用';
      if (key === 'guidedStarter.prompts.createProgram') return `创建应用：${String(options?.skills || '')}`;
      return key;
    };

    const draft = createAppChatDraft(t);

    expect(draft.input).toBe('');
    expect(draft.attachedPrompt).toMatchObject({
      scenarioId: 'create-program',
      scenarioIcon: '💻',
      scenarioTitle: '创建应用',
      localization: {
        promptKey: 'guidedStarter.prompts.createProgram',
        titleKey: 'guidedStarter.scenarios.createProgram.title',
        skills: ['publish', 'taste-skill', 'popular-web-designs'],
      },
    });
    expect(draft.attachedPrompt?.promptText).toContain('publish');
  });
});
