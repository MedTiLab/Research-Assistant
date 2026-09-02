import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { beforeAll, describe, expect, it } from 'vitest';

import zhChat from '../../../../i18n/locales/zh-CN/chat.json';
import TokenUsagePie from './TokenUsagePie';
import ChatInputControls from './ChatInputControls';

const i18n = createInstance();
beforeAll(async () => {
  await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { chat: zhChat } } });
});

const render = (props: React.ComponentProps<typeof TokenUsagePie> = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={i18n}><TokenUsagePie {...props} /></I18nextProvider>,
);

describe('context usage placeholder', () => {
  it.each(['claude', 'codex', 'pi'])('hides context usage in an empty %s conversation, even with stale usage', (provider) => {
    const controls = (hasMessages: boolean) => renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <ChatInputControls
          provider={provider} hasMessages={hasMessages}
          tokenBudget={{ used: 32000, total: 128000 }}
          claudeModel="model" codexModel="model" piModel="model"
          permissionMode="auto" permissionModes={['auto']} onPermissionModeChange={() => {}} onModeSwitch={() => {}}
          thinkingMode="none" setThinkingMode={() => {}} codexReasoningEffort="default" setCodexReasoningEffort={() => {}}
          slashCommandsCount={0} onToggleCommandMenu={() => {}} hasInput={false} onClearInput={() => {}}
          isUserScrolledUp={false} onScrollToBottom={() => {}} compact hideCommandMenu
        />
      </I18nextProvider>,
    );
    expect(controls(false)).not.toContain('查看上下文状态');
    expect(controls(false)).not.toContain('等待上下文用量数据');
    expect(controls(true)).toContain('查看上下文状态');
  });

  it('uses the same compact context indicator for Pi, Claude and Codex', () => {
    const pending = ['claude', 'codex', 'pi'].map((provider) => render({ provider }));
    const ready = ['claude', 'codex', 'pi'].map((provider) => render({ provider, used: 32000, total: 128000 }));
    expect(new Set(pending).size).toBe(1);
    expect(new Set(ready).size).toBe(1);
    for (const markup of [pending[0], ready[0]]) {
      expect(markup).toContain('width="14" height="14"');
      expect(markup).not.toContain('width="24"');
    }
    expect(pending[0]).toMatch(/<button[^>]*class="[^"]*h-7[^"]*w-7/);
  });

  it.each([
    {},
    { unsupportedContext: true, message: '上下文不可用' },
    { used: null, total: 128000 },
    { used: 100, total: 0 },
    { used: Number.NaN, total: 128000 },
  ])('shows only a neutral circle until usage is available: %j', (props) => {
    const markup = render(props);
    expect(markup).toContain('<circle');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('等待上下文用量数据');
    expect(markup).not.toContain('上下文不可用');
    expect(markup).not.toContain('stroke-dashoffset');
    expect(markup.replace(/<[^>]*>/g, '')).toBe('');
  });

  it.each([[32000, '25.0%'], [0, '0.0%']])('shows measured usage, including zero, after data arrives', (used, percentage) => {
    const markup = render({ used, total: 128000 });
    expect(markup).toContain(percentage);
    expect(markup).toContain('stroke-dashoffset');
    expect(markup).toContain('查看上下文状态');
    expect(markup).not.toContain('disabled=""');
  });

  it('respects callers that hide unavailable usage', () => {
    expect(render({ showUnavailable: false })).toBe('');
    expect(render({ unsupportedContext: true, showUnavailable: false })).toBe('');
  });
});
