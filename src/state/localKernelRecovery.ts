import type { LocalKernelGateState } from './localKernelStore';

export function shouldRestartLocalKernelProbeAfterCloudAuthChange({
  isRequired,
  state,
  previousCloudAccessToken,
  currentCloudAccessToken,
}: {
  isRequired: boolean;
  state: LocalKernelGateState;
  previousCloudAccessToken: string | null | undefined;
  currentCloudAccessToken: string | null | undefined;
}) {
  return isRequired
    && Boolean(currentCloudAccessToken)
    && currentCloudAccessToken !== previousCloudAccessToken
    && state !== 'connected';
}

export function shouldShowDesktopKernelTransition(state: LocalKernelGateState) {
  return state === 'probing' || state === 'session-pending';
}

export function shouldAutoRetryDesktopConnection({
  isDesktopShell,
  isRequired,
  hasCloudAccessToken,
  state,
}: {
  isDesktopShell: boolean;
  isRequired: boolean;
  hasCloudAccessToken: boolean;
  state: LocalKernelGateState;
}) {
  return !isDesktopShell
    && isRequired
    && hasCloudAccessToken
    && state === 'offline';
}

// Cloud authorization refreshes travel through the already-paired local
// session. A timeout or a cloud 5xx response does not invalidate that local
// session, so replacing it would only tear down the workspace and WebSocket.
// Re-pair only when the Kernel explicitly says the local session is gone or
// belongs to a different cloud account.
export function shouldReplaceLocalKernelSessionAfterCloudAuthError(error: unknown) {
  const payload = error && typeof error === 'object'
    ? (error as { payload?: unknown }).payload
    : null;
  const code = payload && typeof payload === 'object'
    ? (payload as { code?: unknown }).code
    : null;

  return code === 'LOCAL_SESSION_AUTH_REQUIRED'
    || code === 'CLOUD_USER_MISMATCH';
}
