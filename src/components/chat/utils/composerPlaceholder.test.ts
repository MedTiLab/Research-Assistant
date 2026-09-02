import { describe, expect, it } from 'vitest';

import chineseChat from '../../../i18n/locales/zh-CN/chat.json';
import { resolveComposerPlaceholderKind } from './composerPlaceholder';

describe('resolveComposerPlaceholderKind', () => {
  it('uses the connected-project prompt instead of research-topic intake', () => {
    expect(resolveComposerPlaceholderKind({
      hasAttachedPromptPlaceholder: false,
      isEmpty: true,
      sessionMode: 'research',
      hasConnectedProjectFolder: true,
      hasResearchStage: true,
    })).toBe('connectedProject');
  });

  it('keeps the research-topic prompt for a blank conversation without a folder', () => {
    expect(resolveComposerPlaceholderKind({
      hasAttachedPromptPlaceholder: false,
      isEmpty: true,
      sessionMode: 'research',
      hasConnectedProjectFolder: false,
      hasResearchStage: true,
    })).toBe('researchStage');
  });

  it('does not describe a connected project as a new research topic', () => {
    expect(chineseChat.input.connectedProjectPlaceholder).not.toMatch(/研究主题/);
    expect(chineseChat.stagePlaceholder.literature).toMatch(/研究主题/);
  });
});
