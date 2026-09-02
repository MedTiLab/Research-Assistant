import { contextBridge, ipcRenderer } from 'electron';

// Preload for the legacy self-hosted desktop distribution.

const desktopAppVersion = process.argv
  .find((argument) => argument.startsWith('--medhelp-app-version='))
  ?.slice('--medhelp-app-version='.length) || process.env.npm_package_version || null;

contextBridge.exposeInMainWorld('medhelpDesktop', {
  isDesktop: true,
  platform: process.platform,
  version: desktopAppVersion,
  restartApp: () => ipcRenderer.invoke('desktop:restart-app'),
  getRuntimeStatus: () => ipcRenderer.invoke('desktop:runtime-status'),
  restartRuntime: (options = {}) => ipcRenderer.invoke('desktop:runtime-restart', options),
  openRuntimeDiagnostics: () => ipcRenderer.invoke('desktop:runtime-open-diagnostics'),
  onRuntimeStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('desktop:runtime-status-changed', listener);
    return () => ipcRenderer.removeListener('desktop:runtime-status-changed', listener);
  },
  writeClipboardText: (text) => ipcRenderer.invoke('desktop:write-clipboard-text', text),
  playCompletionSound: () => ipcRenderer.invoke('desktop:play-completion-sound'),
  showNotification: (payload) => ipcRenderer.invoke('desktop:show-notification', payload),
  saveFile: (payload) => ipcRenderer.invoke('desktop:save-file', payload),
  syncCompanionWindows: (companions) => ipcRenderer.invoke('desktop:sync-companion-windows', companions),
  focusMainWindow: (tab) => ipcRenderer.invoke('desktop:focus-main-window', tab),
  onOpenAppTab: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, tab) => callback(tab);
    ipcRenderer.on('desktop:open-app-tab', listener);
    return () => ipcRenderer.removeListener('desktop:open-app-tab', listener);
  },
});
