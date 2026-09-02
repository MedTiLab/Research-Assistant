import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { beforeAll, describe, expect, it } from 'vitest';

import type { Project } from '../../../../types/app';
import zhChat from '../../../../i18n/locales/zh-CN/chat.json';
import ChatMessagesPane, { completedResponseOffsets } from './ChatMessagesPane';
import { groupMessagesIntoTurns } from '../../utils/groupAgentTurns';

const i18n = createInstance();
beforeAll(async () => {
  await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { chat: zhChat } } });
});

describe('chat history recovery entry', () => {
  const render = (hasOlderMessages: boolean, isLoadingMoreMessages = false) => renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ChatMessagesPane
        scrollContainerRef={{ current: null }}
        onWheel={() => {}}
        onTouchMove={() => {}}
        isLoadingSessionMessages={false}
        chatMessages={[]}
        selectedSession={null}
        currentSessionId="pi-session"
        provider="pi"
        isLoadingMoreMessages={isLoadingMoreMessages}
        hasOlderMessages={hasOlderMessages}
        onLoadOlderMessages={async () => {}}
        visibleMessages={[]}
        createDiff={() => []}
        onGrantToolPermission={() => ({ success: true })}
        selectedProject={{ name: 'project-a', path: '/tmp/project-a' } as Project}
        isLoading={false}
      />
    </I18nextProvider>,
  );

  it('shows a localized recovery button only when earlier history exists', () => {
    expect(render(true)).toContain('加载更早消息');
    expect(render(false)).not.toContain('加载更早消息');
  });

  it('disables repeated loads while an older page is being fetched', () => {
    expect(render(true, true)).toMatch(/<button[^>]*disabled=""[^>]*>加载更早消息<\/button>/);
  });

  it('asks to learn a connected project instead of starting a new research topic', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <ChatMessagesPane
          scrollContainerRef={{ current: null }}
          onWheel={() => {}}
          onTouchMove={() => {}}
          isLoadingSessionMessages={false}
          chatMessages={[]}
          selectedSession={null}
          currentSessionId={null}
          provider="pi"
          isLoadingMoreMessages={false}
          visibleMessages={[]}
          createDiff={() => []}
          onGrantToolPermission={() => ({ success: true })}
          selectedProject={{
            name: 'cardiovascular-diabetology',
            displayName: 'cardiovascular-diabetology',
            path: '/tmp/cardiovascular-diabetology',
          } as Project}
          isLoading={false}
        />
      </I18nextProvider>,
    );

    expect(html).toContain('先熟悉这个项目');
    expect(html).not.toContain('最近我们要做什么？');
  });

  it('assigns a fork point to every completed response and skips the streaming response', () => {
    const grouped = groupMessagesIntoTurns([
      { type: 'user', content: 'one', timestamp: 1 },
      { type: 'assistant', content: 'answer one', timestamp: 2 },
      { type: 'user', content: 'two', timestamp: 3 },
      { type: 'assistant', content: 'answer two', timestamp: 4 },
      { type: 'user', content: 'three', timestamp: 5 },
      { type: 'assistant', content: 'streaming', timestamp: 6, isStreaming: true },
    ], true);
    const offsets = completedResponseOffsets(grouped);

    expect([...offsets.values()]).toEqual([2, 1]);
    expect(offsets.has(grouped.length - 1)).toBe(false);
  });
});
