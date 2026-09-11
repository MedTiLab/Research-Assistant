import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';

import type { Project } from '../../../../types/app';
import zhChat from '../../../../i18n/locales/zh-CN/chat.json';
import zhCommon from '../../../../i18n/locales/zh-CN/common.json';

vi.mock('../../../FileTree', () => ({
  default: () => <div data-file-tree="true">project files</div>,
}));
vi.mock('../../../GitPanel', () => ({ default: () => null }));
vi.mock('../../../survey/view/SurveyPage', () => ({ default: () => null }));
vi.mock('./ConversationMemoryPanel', () => ({ default: () => null }));
vi.mock('./SimpleBrowser', () => ({ default: () => <div data-simple-browser="true">browser</div> }));
vi.mock('./ComputeNodeSelector', () => ({
  default: ({ variant }: { variant?: string }) => (
    <button type="button" aria-label="计算资源：本机" data-compute-rail={variant === 'rail' ? 'true' : undefined}>
      compute
    </button>
  ),
}));
vi.mock('../../../../hooks/useDeviceSettings', () => ({
  useDeviceSettings: () => ({ isMobile: false }),
}));
vi.mock('../../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ uiFontScale: 100 }),
}));
vi.mock('../../../agent-work/usePiSessionState', () => ({
  usePiSessionState: () => ({ state: null, error: null }),
  agentStatusLabel: () => '',
}));
vi.mock('../../../../utils/api', () => ({
  api: {
    sessionMessages: () => Promise.resolve({ ok: true, json: async () => ({ messages: [] }) }),
    sessionContextReview: () => Promise.resolve({ ok: true, json: async () => ({ reviews: {} }) }),
    updateSessionContextReview: () => Promise.resolve({ ok: true }),
    piSessionState: () => Promise.resolve({ ok: true, json: async () => ({}) }),
  },
}));

import ChatContextSidebar from './ChatContextSidebar';

const i18n = createInstance();
const project = { name: 'project-a', path: '/tmp/project-a', fullPath: '/tmp/project-a' } as Project;

beforeAll(async () => {
  await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { chat: zhChat, common: zhCommon } } });
});

const renderSidebar = () => renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <ChatContextSidebar
      selectedProject={project}
      selectedSession={null}
      currentSessionId={null}
      provider="pi"
      chatMessages={[]}
    />
  </I18nextProvider>,
);

describe('collapsed floating chat tools', () => {
  it('starts with only a storage trigger and reserves no sidebar column', () => {
    const html = renderSidebar();
    expect(html).toContain('data-chat-tools-dock="true"');
    expect(html).toContain('aria-label="展开侧边工具"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('width:0');
    expect(html).not.toContain('data-chat-files-rail');
    expect(html).not.toContain('medical-icon-rail');
    expect(html).not.toContain('data-compute-rail');
    expect(html).not.toContain('aria-label="Git 版本控制"');
  });
});
