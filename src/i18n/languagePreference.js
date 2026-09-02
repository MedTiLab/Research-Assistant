import { isLanguageSupported } from './languages';

export const DEFAULT_LANGUAGE = 'zh-CN';

export function getInitialLanguage(storage = globalThis.localStorage) {
  try {
    const savedLanguage = storage?.getItem('userLanguage');
    return isLanguageSupported(savedLanguage) ? savedLanguage : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}
