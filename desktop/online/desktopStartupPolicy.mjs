export function shouldUseKeychainAuthSession(desktopUiMode) {
  return desktopUiMode !== 'offline';
}

export function canReadRememberedLogin({ trustedRenderer, mainWindowVisible }) {
  return Boolean(trustedRenderer && mainWindowVisible);
}

export async function readRememberedLoginWhenVisible({
  isLoginFormConnected,
  isMainWindowVisible,
  readRememberedLogin,
  waitForRetry,
  waitForPaint,
}) {
  while (isLoginFormConnected()) {
    if (await isMainWindowVisible()) {
      await waitForPaint();
      if (!isLoginFormConnected()) return null;
      return readRememberedLogin();
    }
    await waitForRetry();
  }
  return null;
}

export function resolveHostedUiTimeout({ kernelReady, rendererLoaded, allowRuntimeUnavailable = false }) {
  if (!rendererLoaded) return 'renderer-load-failure';
  if (!kernelReady && !allowRuntimeUnavailable) return 'kernel-failure';
  return 'show-loaded-app';
}
