import type { ReactElement } from 'react';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { renderToStaticMarkup } from 'react-dom/server';

import enCommon from '../../i18n/locales/en/common.json';
import enWorkbench from '../../i18n/locales/en/workbench.json';
import zhCommon from '../../i18n/locales/zh-CN/common.json';
import zhWorkbench from '../../i18n/locales/zh-CN/workbench.json';

export async function createWorkbenchI18n(lng: 'en' | 'zh-CN' = 'zh-CN') {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng,
    fallbackLng: lng,
    defaultNS: 'common',
    ns: ['common', 'workbench'],
    interpolation: { escapeValue: false },
    resources: {
      en: { workbench: enWorkbench, common: enCommon },
      'zh-CN': { workbench: zhWorkbench, common: zhCommon },
    },
  });
  return i18n;
}

export function renderWorkbench(ui: ReactElement, i18n: Awaited<ReturnType<typeof createWorkbenchI18n>>) {
  return renderToStaticMarkup(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}
