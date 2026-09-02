import { contextBridge, ipcRenderer } from 'electron';

import {
  readRememberedLoginWhenVisible,
  shouldUseKeychainAuthSession,
} from './desktopStartupPolicy.mjs';

// Shared preload for MedHelp Desktop with a bundled frontend and Local Engine.

const desktopUiMode = process.argv
  .find((argument) => argument.startsWith('--medhelp-desktop-ui-mode='))
  ?.slice('--medhelp-desktop-ui-mode='.length) === 'offline' ? 'offline' : 'hosted';

const desktopStyleText = `
  html.medhelp-desktop-root {
    overflow: hidden !important;
    scrollbar-gutter: auto !important;
  }
  body.medhelp-desktop-shell {
    --medhelp-desktop-chrome-surface: #eef2f5;
    --desktop-titlebar-height: 36px !important;
  }
  .dark body.medhelp-desktop-shell {
    --medhelp-desktop-chrome-surface: #050505;
  }
  body.medhelp-desktop-shell #root {
    height: 100vh !important;
    min-height: 100vh !important;
  }
  body.medhelp-desktop-shell .medhelp-desktop-titlebar {
    display: block !important;
    height: 36px !important;
    border-bottom: 1px solid transparent !important;
    background: var(--medhelp-desktop-chrome-surface) !important;
    backdrop-filter: blur(18px) saturate(1.1) !important;
  }
  .dark body.medhelp-desktop-shell .medhelp-desktop-titlebar {
    border-bottom-color: transparent !important;
    background: var(--medhelp-desktop-chrome-surface) !important;
  }
  body.medhelp-desktop-shell .medical-workbench-sidebar-frame,
  body.medhelp-desktop-shell .medical-workbench-sidebar,
  body.medhelp-desktop-shell .medical-workbench-sidebar-frame > .h-full > div {
    background: var(--medhelp-desktop-chrome-surface) !important;
  }
  body.medhelp-desktop-shell .medical-sidebar-header {
    background: transparent !important;
  }
  #medhelp-online-desktop-toolbar {
    position: fixed;
    top: 0;
    right: 138px;
    left: 0;
    z-index: 120;
    display: flex;
    height: 36px;
    align-items: center;
    gap: 3px;
    padding: 0 8px;
    color: #52606d;
    background: transparent;
    -webkit-app-region: drag;
  }
  html.medhelp-online-desktop-platform-darwin #medhelp-online-desktop-toolbar {
    left: 76px;
    right: 0;
  }
  html.medhelp-online-desktop-platform-darwin body.medhelp-desktop-shell aside.medical-icon-rail {
    padding-top: 0 !important;
  }
  body.medhelp-desktop-shell .medical-workbench-sidebar-frame {
    border-right-color: transparent !important;
    box-shadow: none !important;
  }
  body.medhelp-desktop-shell .medical-workbench-sidebar-frame::after {
    display: none !important;
  }
  body.medhelp-desktop-shell .medical-workbench-sidebar-frame [class*="cursor-col-resize"] {
    background: transparent !important;
    box-shadow: none !important;
  }
  body.medhelp-desktop-shell .medical-sidebar-header::after {
    display: none !important;
  }
  body.medhelp-desktop-shell .medical-workbench-header {
    border-bottom-color: transparent !important;
    box-shadow: none !important;
  }
  #medhelp-online-desktop-toolbar button {
    display: inline-grid;
    width: 28px;
    height: 28px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 8px;
    color: inherit;
    background: transparent;
    cursor: default;
    transition: background-color 120ms ease, color 120ms ease, opacity 120ms ease;
    -webkit-app-region: no-drag;
  }
  #medhelp-online-desktop-toolbar button:hover:not(:disabled) {
    color: #172033;
    background: rgba(148, 163, 184, 0.18);
  }
  #medhelp-online-desktop-toolbar button:disabled {
    opacity: 0.32;
  }
  #medhelp-online-desktop-toolbar svg {
    width: 17px;
    height: 17px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
  }
  .dark #medhelp-online-desktop-toolbar {
    color: #aeb8c5;
  }
  .dark #medhelp-online-desktop-toolbar button:hover:not(:disabled) {
    color: #f8fafc;
    background: rgba(148, 163, 184, 0.16);
  }
  button[data-medhelp-online-desktop-sidebar-toggle="true"] {
    display: none !important;
  }
  [data-medhelp-online-desktop-public-downloads="true"],
  [data-medhelp-public-downloads="true"] {
    display: none !important;
  }
  [data-medhelp-online-desktop-auth-pane="true"] {
    height: calc(100vh - var(--desktop-titlebar-height, 36px)) !important;
    min-height: 0 !important;
    overflow-x: hidden !important;
    overflow-y: auto !important;
    overscroll-behavior-y: contain;
    scrollbar-gutter: auto !important;
    scrollbar-width: thin;
    scrollbar-color: rgba(100, 116, 139, 0.42) transparent;
  }
  [data-medhelp-online-desktop-auth-pane="true"][data-medhelp-online-desktop-auth-mode="register"] {
    align-items: flex-start !important;
    padding-bottom: 40px !important;
  }
  [data-medhelp-online-desktop-auth-pane="true"]::-webkit-scrollbar {
    width: 7px;
  }
  [data-medhelp-online-desktop-auth-pane="true"]::-webkit-scrollbar-track {
    background: transparent;
  }
  [data-medhelp-online-desktop-auth-pane="true"]::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(100, 116, 139, 0.38);
  }
  [data-medhelp-online-desktop-kernel-card="true"] {
    display: none !important;
  }
  #medhelp-desktop-remember-login {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #525252;
    font: 400 13px/1.5 "Segoe UI", "Microsoft YaHei", sans-serif;
    cursor: pointer;
    user-select: none;
  }
  #medhelp-desktop-remember-login input {
    width: 15px;
    height: 15px;
    margin: 0;
    accent-color: #0e9f6e;
  }
  #medhelp-desktop-close-confirmation {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: grid;
    place-items: center;
    padding: 24px;
    background: rgba(15, 23, 42, 0.34);
    backdrop-filter: blur(5px);
    -webkit-app-region: no-drag;
  }
  #medhelp-desktop-close-confirmation .medhelp-desktop-close-dialog {
    width: min(400px, calc(100vw - 48px));
    border: 1px solid rgba(148, 163, 184, 0.42);
    border-radius: 16px;
    padding: 22px;
    color: #172033;
    background: #ffffff;
    box-shadow: 0 24px 64px rgba(15, 23, 42, 0.24);
  }
  #medhelp-desktop-close-confirmation h2 {
    margin: 0;
    font: 650 18px/1.4 "Segoe UI", "Microsoft YaHei", sans-serif;
  }
  #medhelp-desktop-close-confirmation p {
    margin: 9px 0 0;
    color: #64748b;
    font: 400 14px/1.65 "Segoe UI", "Microsoft YaHei", sans-serif;
  }
  #medhelp-desktop-close-confirmation .medhelp-desktop-close-actions {
    display: flex;
    justify-content: flex-end;
    gap: 9px;
    margin-top: 20px;
  }
  #medhelp-desktop-close-confirmation button {
    min-width: 84px;
    height: 36px;
    border: 1px solid #cbd5e1;
    border-radius: 9px;
    padding: 0 14px;
    color: #334155;
    background: #ffffff;
    font: 600 13px "Segoe UI", "Microsoft YaHei", sans-serif;
    cursor: pointer;
  }
  #medhelp-desktop-close-confirmation button:hover {
    background: #f8fafc;
  }
  #medhelp-desktop-close-confirmation .medhelp-desktop-close-confirm {
    border-color: #166b5b;
    color: #ffffff;
    background: #166b5b;
  }
  #medhelp-desktop-close-confirmation .medhelp-desktop-close-confirm:hover {
    background: #12594c;
  }
  .dark #medhelp-desktop-close-confirmation .medhelp-desktop-close-dialog {
    border-color: rgba(71, 85, 105, 0.72);
    color: #f8fafc;
    background: #111827;
  }
  .dark #medhelp-desktop-close-confirmation p {
    color: #94a3b8;
  }
  .dark #medhelp-desktop-close-confirmation button {
    border-color: #475569;
    color: #e2e8f0;
    background: #1e293b;
  }
`;

let desktopUiSyncScheduled = false;
let desktopSidebarButton = null;
let desktopBackButton = null;
let desktopForwardButton = null;
let desktopCloseConfirmation = null;

function applyDesktopNavigationState() {
  if (desktopBackButton) {
    desktopBackButton.disabled = false;
  }
  if (desktopForwardButton) {
    desktopForwardButton.disabled = false;
  }
}

async function navigateDesktopHistory(direction) {
  if (direction === 'status') {
    applyDesktopNavigationState();
    return;
  }

  applyDesktopNavigationState();
  try {
    contextBridge.executeInMainWorld({
      func: (targetDirection) => {
        if (targetDirection === 'back') {
          window.history.back();
        } else if (targetDirection === 'forward') {
          window.history.forward();
        }
      },
      args: [direction],
    });
  } catch {
    await ipcRenderer.invoke('desktop:navigate-history', direction);
  }
}

ipcRenderer.on('desktop:navigation-state', () => {
  applyDesktopNavigationState();
});

function respondToDesktopCloseConfirmation(shouldClose) {
  const confirmation = desktopCloseConfirmation;
  desktopCloseConfirmation = null;
  confirmation?.remove();
  void ipcRenderer.invoke('desktop:close-confirmation-response', shouldClose);
}

function dismissDesktopCloseConfirmation() {
  const confirmation = desktopCloseConfirmation;
  desktopCloseConfirmation = null;
  confirmation?.remove();
}

function showDesktopCloseConfirmation() {
  if (desktopCloseConfirmation?.isConnected) {
    desktopCloseConfirmation.querySelector('button')?.focus();
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'medhelp-desktop-close-confirmation';
  overlay.innerHTML = `
    <section class="medhelp-desktop-close-dialog" role="dialog" aria-modal="true" aria-labelledby="medhelp-desktop-close-title" aria-describedby="medhelp-desktop-close-description">
      <h2 id="medhelp-desktop-close-title">退出 MedHelp？</h2>
      <p id="medhelp-desktop-close-description">退出后，本地引擎也会安全关闭，正在运行的任务将停止。</p>
      <div class="medhelp-desktop-close-actions">
        <button type="button" data-close-action="cancel">取消</button>
        <button type="button" class="medhelp-desktop-close-confirm" data-close-action="confirm">确定退出</button>
      </div>
    </section>
  `;

  overlay.querySelector('[data-close-action="cancel"]')?.addEventListener('click', () => {
    respondToDesktopCloseConfirmation(false);
  });
  overlay.querySelector('[data-close-action="confirm"]')?.addEventListener('click', () => {
    respondToDesktopCloseConfirmation(true);
  });
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      respondToDesktopCloseConfirmation(false);
    }
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      respondToDesktopCloseConfirmation(false);
    }
  });

  desktopCloseConfirmation = overlay;
  (document.body || document.documentElement).appendChild(overlay);
  overlay.querySelector('[data-close-action="cancel"]')?.focus();
}

ipcRenderer.on('desktop:confirm-close-requested', showDesktopCloseConfirmation);
ipcRenderer.on('desktop:dismiss-close-confirmation', dismissDesktopCloseConfirmation);

function findPageSidebarToggle() {
  const acceptedLabels = new Set(['隐藏侧边栏', '显示侧边栏', 'Hide sidebar', 'Show sidebar']);
  return [...document.querySelectorAll('button')].find((button) => {
    if (button.closest('.medical-context-sidebar')) return false;
    const label = button.getAttribute('title') || button.getAttribute('aria-label') || '';
    return acceptedLabels.has(label.trim());
  }) || null;
}

function markDesktopHiddenPublicDownloadEntrypoints() {
  document.querySelectorAll('a[href]').forEach((element) => {
    try {
      if (new URL(element.href, window.location.href).pathname === '/download') {
        element.dataset.medhelpOnlineDesktopPublicDownloads = 'true';
      }
    } catch {
      // Ignore malformed third-party links in the hosted page.
    }
  });
}

function findDesktopCliLoginProvider(button) {
  if (button.dataset.medhelpCliLoginProvider) {
    return button.dataset.medhelpCliLoginProvider;
  }
  const label = button.textContent?.replace(/\s+/g, ' ').trim() || '';
  if (!['Login', 'Re-login', '登录', '重新登录'].includes(label)) return null;

  let container = button.parentElement;
  while (container && container !== document.body) {
    const heading = [...container.querySelectorAll('h3')].find((element) => (
      element.textContent?.replace(/\s+/g, ' ').trim() === 'Claude'
    ));
    if (heading) return 'claude';
    container = container.parentElement;
  }
  return null;
}

function markDesktopCliLoginEntrypoints() {
  document.querySelectorAll('button').forEach((button) => {
    const provider = findDesktopCliLoginProvider(button);
    if (provider) button.dataset.medhelpOnlineDesktopCliLoginProvider = provider;
  });
}

async function runDesktopCliLogin(button, provider) {
  if (button.dataset.medhelpOnlineDesktopCliLoginBusy === 'true') return;
  button.dataset.medhelpOnlineDesktopCliLoginBusy = 'true';
  const originalHtml = button.innerHTML;
  button.disabled = true;
  button.textContent = document.documentElement.lang.toLowerCase().startsWith('zh')
    ? '正在打开授权页…'
    : 'Opening authorization…';
  try {
    const result = await ipcRenderer.invoke('desktop:start-cli-login', provider);
    if (!result?.ok) throw new Error(result?.error || 'CLI login failed');
    window.location.reload();
  } catch (error) {
    button.innerHTML = originalHtml;
    button.disabled = false;
    button.dataset.medhelpOnlineDesktopCliLoginBusy = 'false';
    window.alert(error?.message || String(error));
  }
}

function markDesktopAuthPane() {
  const usernameInput = document.querySelector('input#username');
  const authPane = usernameInput?.closest('section');
  if (!authPane) return;

  authPane.dataset.medhelpOnlineDesktopAuthPane = 'true';
  authPane.dataset.medhelpOnlineDesktopAuthMode = document.querySelector('input#confirmPassword')
    ? 'register'
    : 'login';

  if (authPane.dataset.medhelpOnlineDesktopAuthMode === 'login') {
    installDesktopLoginMemory(usernameInput);
  } else {
    document.getElementById('medhelp-desktop-remember-login')?.remove();
  }
}

function updateControlledInput(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function installDesktopLoginMemory(usernameInput) {
  const form = usernameInput?.closest('form');
  const passwordInput = form?.querySelector('input#password');
  if (!form || !passwordInput || form.querySelector('input#confirmPassword')) return;

  let rememberRow = document.getElementById('medhelp-desktop-remember-login');
  if (!rememberRow) {
    rememberRow = document.createElement('label');
    rememberRow.id = 'medhelp-desktop-remember-login';
    rememberRow.innerHTML = '<input type="checkbox" checked><span>记住账号和密码（仅保存在本机）</span>';
    passwordInput.parentElement?.insertAdjacentElement('afterend', rememberRow);
  }

  if (form.dataset.medhelpDesktopLoginMemoryInstalled === 'true') return;
  form.dataset.medhelpDesktopLoginMemoryInstalled = 'true';
  const rememberCheckbox = rememberRow.querySelector('input[type="checkbox"]');

  // The BrowserWindow stays hidden while the local service and UI start. A
  // hidden renderer must never decrypt the remembered password because the
  // macOS Keychain dialog would appear over whichever app is currently active.
  void readRememberedLoginWhenVisible({
    isLoginFormConnected: () => form.isConnected,
    isMainWindowVisible: () => ipcRenderer.invoke('desktop:is-main-window-visible'),
    readRememberedLogin: () => ipcRenderer.invoke('desktop:get-saved-login'),
    waitForRetry: () => new Promise((resolve) => window.setTimeout(resolve, 100)),
    // Give the now-visible login page a complete paint before macOS is allowed
    // to show its Keychain permission dialog.
    waitForPaint: () => new Promise((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
    }),
  }).then((credentials) => {
    if (!form.isConnected || !credentials?.username || !credentials?.password) return;
    if (!usernameInput.value) updateControlledInput(usernameInput, credentials.username);
    if (!passwordInput.value) updateControlledInput(passwordInput, credentials.password);
    if (rememberCheckbox) rememberCheckbox.checked = true;
  }).catch(() => {});

  form.addEventListener('submit', () => {
    if (rememberCheckbox?.checked && usernameInput.value && passwordInput.value) {
      void ipcRenderer.invoke('desktop:save-login', {
        username: usernameInput.value,
        password: passwordInput.value,
      }).catch(() => {});
    } else {
      void ipcRenderer.invoke('desktop:clear-saved-login').catch(() => {});
    }
  });
}

function synchronizeDesktopUi() {
  desktopUiSyncScheduled = false;
  markDesktopHiddenPublicDownloadEntrypoints();
  markDesktopCliLoginEntrypoints();
  markDesktopAuthPane();
  const stopButton = [...document.querySelectorAll('button')].find((button) => {
    const label = button.textContent?.replace(/\s+/g, ' ').trim() || '';
    return ['关闭本地引擎', 'Stop Local Engine', '关闭 Kernel', 'Stop Kernel'].includes(label);
  });
  const card = stopButton?.closest('.rounded-xl');
  if (card && card.dataset.medhelpOnlineDesktopKernelCard !== 'true') {
    card.dataset.medhelpOnlineDesktopKernelCard = 'true';
  }

  const pageSidebarToggle = findPageSidebarToggle();
  if (pageSidebarToggle) {
    pageSidebarToggle.dataset.medhelpOnlineDesktopSidebarToggle = 'true';
  }
  if (desktopSidebarButton) {
    desktopSidebarButton.disabled = !pageSidebarToggle;
  }
}

function scheduleDesktopUiSync() {
  if (desktopUiSyncScheduled) return;
  desktopUiSyncScheduled = true;
  window.requestAnimationFrame(synchronizeDesktopUi);
}

function createToolbarButton({ label, icon, onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = icon;
  button.addEventListener('click', onClick);
  return button;
}

function installDesktopToolbar(root) {
  if (document.getElementById('medhelp-online-desktop-toolbar')) return;
  const toolbar = document.createElement('div');
  toolbar.id = 'medhelp-online-desktop-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', '桌面导航');

  desktopSidebarButton = createToolbarButton({
    label: '显示或隐藏侧边栏',
    icon: '<svg viewBox="0 0 24 24"><rect x="3.5" y="4" width="17" height="16" rx="2.5"/><path d="M9 4v16"/></svg>',
    onClick: () => findPageSidebarToggle()?.click(),
  });
  desktopBackButton = createToolbarButton({
    label: '后退',
    icon: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
    onClick: () => void navigateDesktopHistory('back'),
  });
  desktopForwardButton = createToolbarButton({
    label: '前进',
    icon: '<svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>',
    onClick: () => void navigateDesktopHistory('forward'),
  });

  applyDesktopNavigationState();
  toolbar.append(desktopSidebarButton, desktopBackButton, desktopForwardButton);
  root.appendChild(toolbar);
  void navigateDesktopHistory('status');
}

function installDesktopShellUi() {
  if (window.location.protocol === 'file:') return;
  const root = document.documentElement;
  if (!root || document.getElementById('medhelp-online-desktop-style')) return;

  root.classList.add(`medhelp-online-desktop-platform-${process.platform}`);
  const desktopStyle = document.createElement('style');
  desktopStyle.id = 'medhelp-online-desktop-style';
  desktopStyle.textContent = desktopStyleText;
  root.appendChild(desktopStyle);
  installDesktopToolbar(root);

  new MutationObserver(scheduleDesktopUiSync).observe(root, {
    childList: true,
    subtree: true,
  });
  scheduleDesktopUiSync();
}

installDesktopShellUi();
window.addEventListener('DOMContentLoaded', installDesktopShellUi, { once: true });
document.addEventListener('click', (event) => {
  const button = event.target instanceof Element
    ? event.target.closest('button[data-medhelp-online-desktop-cli-login-provider]')
    : null;
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void runDesktopCliLogin(button, button.dataset.medhelpOnlineDesktopCliLoginProvider);
}, true);

// The hosted application intentionally uses Chromium's public-web-to-loopback
// request hint. Electron 35 uses the newer enum name (`local`) and throws before
// making the request when it receives `loopback`. Translate only inside this
// dedicated desktop shell so regular Chrome/Edge users keep the browser-tested
// behavior served by the public site.
contextBridge.executeInMainWorld({
  func: () => {
    const marker = '__medhelpOnlineDesktopFetchCompat__';
    if (window[marker]) return;

    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (init?.targetAddressSpace === 'loopback') {
        return nativeFetch(input, { ...init, targetAddressSpace: 'local' });
      }
      return nativeFetch(input, init);
    };

    Object.defineProperty(window, marker, {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
  },
});

const desktopAppVersion = process.argv
  .find((argument) => argument.startsWith('--medhelp-app-version='))
  ?.slice('--medhelp-app-version='.length) || process.env.npm_package_version || null;
const cloudAppOrigin = process.argv
  .find((argument) => argument.startsWith('--medhelp-cloud-app-origin='))
  ?.slice('--medhelp-cloud-app-origin='.length) || null;
contextBridge.exposeInMainWorld('medhelpDesktop', {
  isDesktop: true,
  platform: process.platform,
  version: desktopAppVersion,
  uiMode: desktopUiMode,
  cloudAppOrigin,
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
  getUpdateState: () => ipcRenderer.invoke('desktop:get-update-state'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
  downloadAndInstallUpdate: () => ipcRenderer.invoke('desktop:download-and-install-update'),
  onUpdateState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop:update-state', listener);
    return () => ipcRenderer.removeListener('desktop:update-state', listener);
  },
  startCliLogin: (provider) => ipcRenderer.invoke('desktop:start-cli-login', provider),
  // Do not decrypt a Keychain-backed auth-session before the offline login UI
  // has even rendered. Saved username/password access remains enabled below
  // through desktop:get-saved-login and desktop:save-login, so macOS asks for
  // Keychain permission only in the expected login/save flow.
  restoreAuthSession: () => shouldUseKeychainAuthSession(desktopUiMode)
    ? ipcRenderer.invoke('desktop:restore-auth-session')
    : Promise.resolve(null),
  // The offline shell uses stable localStorage plus the local Kernel sync. Do
  // not touch Keychain-backed token-session storage during background refresh.
  saveAuthSession: (payload) => shouldUseKeychainAuthSession(desktopUiMode)
    ? ipcRenderer.invoke('desktop:save-auth-session', payload)
    : Promise.resolve(false),
  clearAuthSession: () => ipcRenderer.invoke('desktop:clear-auth-session'),
  writeClipboardText: (text) => ipcRenderer.invoke('desktop:write-clipboard-text', text),
  playCompletionSound: () => ipcRenderer.invoke('desktop:play-completion-sound'),
  showNotification: (payload) => ipcRenderer.invoke('desktop:show-notification', payload),
  saveFile: (payload) => ipcRenderer.invoke('desktop:save-file', payload),
  syncCompanionWindows: (companions) => ipcRenderer.invoke('desktop:sync-companion-windows', companions),
  choosePetDirectory: () => ipcRenderer.invoke('desktop:choose-pet-directory'),
  loadPetAsset: (directory) => ipcRenderer.invoke('desktop:load-pet-asset', directory),
  focusMainWindow: (tab) => ipcRenderer.invoke('desktop:focus-main-window', tab),
  onOpenAppTab: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, tab) => callback(tab);
    ipcRenderer.on('desktop:open-app-tab', listener);
    return () => ipcRenderer.removeListener('desktop:open-app-tab', listener);
  },
});
