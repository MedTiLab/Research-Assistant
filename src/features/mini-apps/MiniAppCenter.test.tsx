import { describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import MiniAppCenter from './MiniAppCenter';
import enCommon from '../../i18n/locales/en/common.json';
import enChat from '../../i18n/locales/en/chat.json';

vi.mock('../../utils/api', () => ({
  api: {
    miniApps: {
      list: () => Promise.resolve({
        ok: true,
        json: async () => ({ apps: [] }),
      }),
    },
  },
}));

describe('MiniAppCenter localization', () => {
  it('renders English chrome when the app language is English', async () => {
    const i18n = createInstance();
    await i18n.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      defaultNS: 'common',
      ns: ['common', 'chat'],
      interpolation: { escapeValue: false },
      resources: { en: { common: enCommon, chat: enChat } },
    });

    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <MiniAppCenter />
      </I18nextProvider>,
    );

    expect(markup).toContain('My Apps');
    expect(markup).toContain('Create with Agent');
    expect(markup).toContain('Import HTML');
    expect(markup).not.toContain('我的应用');
    expect(markup).not.toContain('与 Agent 创建');
    expect(markup).not.toContain('导入 HTML');
  });
});
