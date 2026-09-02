import { Menu, nativeTheme } from 'electron';

// Shared window chrome used by every desktop distribution.

const DESKTOP_TITLEBAR_HEIGHT = process.platform === 'darwin' ? 38 : 36;

function resolveChromeColors() {
  if (nativeTheme.shouldUseDarkColors) {
    return {
      backgroundColor: '#050505',
      titleBarColor: '#050505',
      symbolColor: '#f4f4f5',
    };
  }

  return {
    backgroundColor: '#eef2f5',
    titleBarColor: '#eef2f5',
    symbolColor: '#18181b',
  };
}

export function installDesktopApplicationMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
  }
}

export function getDesktopWindowChromeOptions({
  nativeWindowsTitleBar = false,
} = {}) {
  const colors = resolveChromeColors();

  if (process.platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 12 },
      backgroundColor: colors.backgroundColor,
      vibrancy: 'under-window',
      visualEffectState: 'active',
    };
  }

  if (nativeWindowsTitleBar) {
    return {
      backgroundColor: colors.backgroundColor,
    };
  }

  return {
    titleBarStyle: 'hidden',
    backgroundColor: colors.backgroundColor,
    titleBarOverlay: {
      color: colors.titleBarColor,
      symbolColor: colors.symbolColor,
      height: DESKTOP_TITLEBAR_HEIGHT,
    },
  };
}

export function syncDesktopWindowChrome(window, { nativeWindowsTitleBar = false } = {}) {
  const applyChromeColors = () => {
    if (!window || window.isDestroyed()) {
      return;
    }

    const colors = resolveChromeColors();
    window.setBackgroundColor(colors.backgroundColor);

    if (
      process.platform !== 'darwin'
      && !nativeWindowsTitleBar
      && typeof window.setTitleBarOverlay === 'function'
    ) {
      window.setTitleBarOverlay({
        color: colors.titleBarColor,
        symbolColor: colors.symbolColor,
        height: DESKTOP_TITLEBAR_HEIGHT,
      });
    }
  };

  applyChromeColors();
  nativeTheme.on('updated', applyChromeColors);
  window.on('closed', () => {
    nativeTheme.off('updated', applyChromeColors);
  });
}
