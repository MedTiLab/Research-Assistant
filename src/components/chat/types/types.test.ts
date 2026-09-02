import { describe, expect, it } from 'vitest';

import { VISIBLE_CHAT_SIDEBAR_TABS, normalizeChatSidebarTab } from './types';

describe('chat sidebar tabs', () => {
  it('keeps Browser, files, and Git as sidebar tools', () => {
    expect(VISIBLE_CHAT_SIDEBAR_TABS).toEqual(['browser', 'files', 'git']);
  });

  it('keeps Git as a real sidebar tool', () => {
    expect(normalizeChatSidebarTab('git')).toBe('git');
    expect(normalizeChatSidebarTab('browser')).toBe('browser');
  });

  it.each(['context', 'consultation', 'research', 'survey', null])(
    'falls back from removed tab %s to files',
    (tab) => {
      expect(normalizeChatSidebarTab(tab)).toBe('files');
    },
  );
});
