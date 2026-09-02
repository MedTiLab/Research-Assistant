/**
 * i18n Configuration
 *
 * Configures i18next for internationalization support.
 * Features:
 * - Lazy-loading of translation namespaces
 * - Language detection from localStorage
 * - Fallback to Simplified Chinese for missing translations
 * - Development mode warnings for missing keys
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import translation resources
import enCommon from './locales/en/common.json';
import enSettings from './locales/en/settings.json';
import enAuth from './locales/en/auth.json';
import enSidebar from './locales/en/sidebar.json';
import enChat from './locales/en/chat.json';
import enCodeEditor from './locales/en/codeEditor.json';
import enNews from './locales/en/news.json';
import enReferences from './locales/en/references.json';
import enMedlibrary from './locales/en/medlibrary.json';
import enWorkbench from './locales/en/workbench.json';

import zhCommon from './locales/zh-CN/common.json';
import zhSettings from './locales/zh-CN/settings.json';
import zhAuth from './locales/zh-CN/auth.json';
import zhSidebar from './locales/zh-CN/sidebar.json';
import zhChat from './locales/zh-CN/chat.json';
import zhCodeEditor from './locales/zh-CN/codeEditor.json';
import zhNews from './locales/zh-CN/news.json';
import zhReferences from './locales/zh-CN/references.json';
import zhMedlibrary from './locales/zh-CN/medlibrary.json';
import zhWorkbench from './locales/zh-CN/workbench.json';

// Import supported languages configuration
import { languages } from './languages.js';
import { DEFAULT_LANGUAGE, getInitialLanguage } from './languagePreference.js';

// Initialize i18next
i18n
  .use(LanguageDetector) // Detect user language
  .use(initReactI18next) // Pass i18n instance to react-i18next
  .init({
    // Resources containing all translations
    resources: {
      en: {
        common: enCommon,
        settings: enSettings,
        auth: enAuth,
        sidebar: enSidebar,
        chat: enChat,
        codeEditor: enCodeEditor,
        news: enNews,
        references: enReferences,
        medlibrary: enMedlibrary,
        workbench: enWorkbench,
      },
      'zh-CN': {
        common: zhCommon,
        settings: zhSettings,
        auth: zhAuth,
        sidebar: zhSidebar,
        chat: zhChat,
        codeEditor: zhCodeEditor,
        news: zhNews,
        references: zhReferences,
        medlibrary: zhMedlibrary,
        workbench: zhWorkbench,
      },
    },

    // Default language
    lng: getInitialLanguage(),

    // Fallback language when a translation is missing
    fallbackLng: DEFAULT_LANGUAGE,

    // Enable debug mode in development (logs missing keys to console)
    debug: import.meta.env.DEV,

    // Namespaces - load only what's needed
    ns: ['common', 'settings', 'auth', 'sidebar', 'chat', 'codeEditor', 'news', 'references', 'medlibrary', 'workbench'],
    defaultNS: 'common',

    // Key separator for nested keys (default: '.')
    keySeparator: '.',

    // Namespace separator (default: ':')
    nsSeparator: ':',

    // Save missing translations (disabled - requires manual review)
    saveMissing: false,

    // Interpolation settings
    interpolation: {
      escapeValue: false, // React already escapes values
    },

    // React-specific settings
    react: {
      useSuspense: true, // Use Suspense for lazy-loading
      bindI18n: 'languageChanged', // Re-render on language change
      bindI18nStore: false, // Don't re-render on resource changes
    },

    // Detection options
    detection: {
      // Order of language detection (local storage first)
      order: ['localStorage'],

      // Keys to look for in localStorage
      lookupLocalStorage: 'userLanguage',

      // Cache user language
      caches: ['localStorage'],
    },
  });

function syncDocumentTitle() {
  if (typeof document === 'undefined') {
    return;
  }

  const title = i18n.t('app.documentTitle');
  document.title = title;

  const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (appleTitle) {
    appleTitle.setAttribute('content', 'MedHelp');
  }
}

// Save language preference when it changes
i18n.on('languageChanged', (lng) => {
  try {
    localStorage.setItem('userLanguage', lng);
  } catch (error) {
    console.error('Failed to save language preference:', error);
  }
  syncDocumentTitle();
});

i18n.on('initialized', syncDocumentTitle);

export default i18n;
