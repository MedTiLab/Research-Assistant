export type DesktopRuntimeInfo = {
  isDesktopShell: boolean;
  isDesktopKernel: boolean;
  isOfflineShell: boolean;
  isLimitedShell: boolean;
  platform: string;
};

export function getDesktopCloudAppOrigin(): string {
  if (typeof window === 'undefined') return '';
  if (String(window.medhelpDesktop?.uiMode || '').toLowerCase() === 'offline') {
    return window.location.origin;
  }
  const configured = window.medhelpDesktop?.cloudAppOrigin;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // A malformed preload value must never redirect authentication traffic.
    }
  }
  return window.location.origin;
}

function getHashSearchParams() {
  if (typeof window === 'undefined') {
    return new URLSearchParams();
  }

  const hash = window.location.hash || '';
  const queryStart = hash.indexOf('?');
  if (queryStart === -1) {
    return new URLSearchParams();
  }

  return new URLSearchParams(hash.slice(queryStart + 1));
}

function cleanPlatform(value: string | null | undefined) {
  const platform = String(value || 'unknown').toLowerCase();
  return /^[a-z0-9_-]+$/.test(platform) ? platform : 'unknown';
}

export function getDesktopRuntimeInfo(): DesktopRuntimeInfo {
  if (typeof window === 'undefined') {
    return {
      isDesktopShell: false,
      isDesktopKernel: false,
      isOfflineShell: false,
      isLimitedShell: false,
      platform: 'unknown',
    };
  }

  const searchParams = new URLSearchParams(window.location.search || '');
  const hashParams = getHashSearchParams();
  const bridge = window.medhelpDesktop;
  const bridgeUiMode = String(bridge?.uiMode || '').toLowerCase();
  const bridgeOwnsBundledKernel = bridge?.isDesktop === true
    && (bridgeUiMode === 'hosted' || bridgeUiMode === 'offline');
  const isDesktopKernel =
    searchParams.get('desktopKernel') === '1'
    || hashParams.get('desktopKernel') === '1'
    || bridgeOwnsBundledKernel;
  const isLimitedShell =
    searchParams.get('desktopRuntimeLimited') === '1'
    || hashParams.get('desktopRuntimeLimited') === '1';
  const desktopUiMode = String(
    searchParams.get('desktopUiMode')
    || hashParams.get('desktopUiMode')
    || bridgeUiMode
    || '',
  ).toLowerCase();
  const platform = cleanPlatform(
    bridge?.platform
    || searchParams.get('desktopPlatform')
    || hashParams.get('desktopPlatform')
  );

  return {
    isDesktopShell: Boolean(bridge?.isDesktop) || isDesktopKernel,
    isDesktopKernel,
    isOfflineShell: isDesktopKernel && desktopUiMode === 'offline',
    isLimitedShell: isDesktopKernel && isLimitedShell,
    platform,
  };
}

export function applyDesktopRuntimeClasses() {
  if (typeof document === 'undefined') {
    return getDesktopRuntimeInfo();
  }

  const runtime = getDesktopRuntimeInfo();
  if (!runtime.isDesktopShell) {
    return runtime;
  }

  document.documentElement.classList.add('medhelp-desktop-root');
  document.body.classList.add('medhelp-desktop-shell', `medhelp-desktop-platform-${runtime.platform}`);
  document.body.style.setProperty(
    '--desktop-titlebar-height',
    runtime.platform === 'darwin' ? '38px' : '36px'
  );

  if (runtime.isDesktopKernel) {
    document.body.classList.add('medhelp-desktop-kernel');
  }

  return runtime;
}
