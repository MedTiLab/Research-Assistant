import React, { createContext, useContext, useState, useEffect, useLayoutEffect } from 'react';

const ThemeContext = createContext();

// Selectable accent color themes. `id` maps to the [data-accent] blocks in
// index.css; `swatch` is the light-mode primary shown in the picker.
export const ACCENT_THEMES = [
  { id: 'emerald', label: '翠绿 Emerald', swatch: 'hsl(166 64% 28%)' },
  { id: 'azure', label: '海蓝 Azure', swatch: 'hsl(206 84% 38%)' },
  { id: 'terracotta', label: '朱砂 Terracotta', swatch: 'hsl(14 62% 40%)' },
  { id: 'violet', label: '紫韵 Violet', swatch: 'hsl(262 52% 48%)' },
  { id: 'amber', label: '琥珀 Amber', swatch: 'hsl(35 78% 42%)' },
];

const DEFAULT_ACCENT = 'emerald';
const isValidAccent = (value) => ACCENT_THEMES.some((theme) => theme.id === value);

export const FONT_SCALE_OPTIONS = [80, 90, 100, 110, 125, 150];
const DEFAULT_FONT_SCALE = 100;
const isValidFontScale = (value) => FONT_SCALE_OPTIONS.includes(Number(value));
const readFontScale = (storageKey) => {
  const saved = localStorage.getItem(storageKey);
  return isValidFontScale(saved) ? Number(saved) : DEFAULT_FONT_SCALE;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export const ThemeProvider = ({ children }) => {
  // Check for saved theme preference or default to system preference
  const [isDarkMode, setIsDarkMode] = useState(() => {
    // Check localStorage first
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      return savedTheme === 'dark';
    }
    
    // Check system preference
    if (window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    
    return false;
  });

  // Accent (color) theme, independent of light/dark ground.
  const [accent, setAccentState] = useState(() => {
    const saved = localStorage.getItem('accent');
    return isValidAccent(saved) ? saved : DEFAULT_ACCENT;
  });

  const [uiFontScale, setUiFontScaleState] = useState(() => readFontScale('uiFontScale'));
  const [chatFontScale, setChatFontScaleState] = useState(() => readFontScale('chatFontScale'));

  // Apply accent to <html> via data-accent and persist it.
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-accent', accent);
    localStorage.setItem('accent', accent);
  }, [accent]);

  const setAccent = (value) => {
    if (isValidAccent(value)) {
      setAccentState(value);
    }
  };

  const setUiFontScale = (value) => {
    if (isValidFontScale(value)) {
      setUiFontScaleState(Number(value));
    }
  };

  const setChatFontScale = (value) => {
    if (isValidFontScale(value)) {
      setChatFontScaleState(Number(value));
    }
  };

  // UI scale is the baseline for rem-based interface typography. Chat scale
  // is applied on top of it by the message-area rules in index.css.
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--ui-font-scale', String(uiFontScale / 100));
    localStorage.setItem('uiFontScale', String(uiFontScale));
  }, [uiFontScale]);

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--chat-font-scale', String(chatFontScale / 100));
    localStorage.setItem('chatFontScale', String(chatFontScale));
  }, [chatFontScale]);

  // Update document class and localStorage when theme changes
  useLayoutEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      document.documentElement.style.colorScheme = 'dark';
      localStorage.setItem('theme', 'dark');
      
      // Update iOS status bar style and theme color for dark mode
      const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
      if (statusBarMeta) {
        statusBarMeta.setAttribute('content', 'black-translucent');
      }
      
      const themeColorMeta = document.querySelector('meta[name="theme-color"]');
      if (themeColorMeta) {
        themeColorMeta.setAttribute('content', '#000000');
      }
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.style.colorScheme = 'light';
      localStorage.setItem('theme', 'light');
      
      // Update iOS status bar style and theme color for light mode
      const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
      if (statusBarMeta) {
        statusBarMeta.setAttribute('content', 'default');
      }
      
      const themeColorMeta = document.querySelector('meta[name="theme-color"]');
      if (themeColorMeta) {
        themeColorMeta.setAttribute('content', '#f7f7f7');
      }
    }
  }, [isDarkMode]);

  // Listen for system theme changes
  useEffect(() => {
    if (!window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e) => {
      // Only update if user hasn't manually set a preference
      const savedTheme = localStorage.getItem('theme');
      if (!savedTheme) {
        setIsDarkMode(e.matches);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const toggleDarkMode = () => {
    setIsDarkMode(prev => !prev);
  };

  const value = {
    isDarkMode,
    toggleDarkMode,
    accent,
    setAccent,
    accentThemes: ACCENT_THEMES,
    uiFontScale,
    setUiFontScale,
    chatFontScale,
    setChatFontScale,
    fontScaleOptions: FONT_SCALE_OPTIONS,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};
