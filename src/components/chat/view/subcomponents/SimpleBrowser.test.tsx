import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import zhChat from '../../../../i18n/locales/zh-CN/chat.json';

vi.mock('../../../../utils/desktopRuntime', () => ({
  getDesktopRuntimeInfo: () => ({ isDesktopShell: false }),
}));

import SimpleBrowser from './SimpleBrowser';

const i18n = createInstance();

beforeAll(async () => {
  await i18n.init({ lng: 'zh-CN', resources: { 'zh-CN': { chat: zhChat } } });
});

describe('simple browser chrome', () => {
  it('keeps only the system-browser action in the address bar', () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <SimpleBrowser />
      </I18nextProvider>,
    );

    expect(html).toContain('aria-label="在系统浏览器中打开"');
    expect(html).not.toContain('aria-label="放大浏览器"');
    expect(html).not.toContain('aria-label="还原浏览器大小"');
  });
});
