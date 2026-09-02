type ResolveChatWebSocketConnectionArgs = {
  isPlatform: boolean;
  pageProtocol: string;
  pageHost: string;
  cloudToken: string | null;
  authLoading: boolean;
  localKernelRequired: boolean;
  localKernelState?: string | null;
  localKernelWsBaseUrl?: string | null;
  localKernelSessionToken?: string | null;
};

export const resolveChatWebSocketConnection = ({
  isPlatform,
  pageProtocol,
  pageHost,
  cloudToken,
  authLoading,
  localKernelRequired,
  localKernelState,
  localKernelWsBaseUrl,
  localKernelSessionToken,
}: ResolveChatWebSocketConnectionArgs) => {
  const localKernelReady = Boolean(
    localKernelRequired
    && localKernelState === 'connected'
    && localKernelWsBaseUrl
    && localKernelSessionToken,
  );
  const disabled = Boolean(
    (authLoading && !localKernelReady)
    || (localKernelRequired && !localKernelReady),
  );

  if (localKernelReady) {
    return {
      disabled,
      localKernelReady,
      identity: `local:${localKernelWsBaseUrl}/ws`,
      url: `${localKernelWsBaseUrl}/ws?token=${encodeURIComponent(localKernelSessionToken!)}`,
    };
  }

  const protocol = pageProtocol === 'https:' ? 'wss:' : 'ws:';
  if (isPlatform) {
    return {
      disabled,
      localKernelReady,
      identity: `platform:${protocol}//${pageHost}/ws`,
      url: `${protocol}//${pageHost}/ws`,
    };
  }

  return {
    disabled,
    localKernelReady,
    // A rotated access token authenticates future reconnects, but it does not
    // change the identity of an already-authenticated live socket. Keeping this
    // identity stable prevents an in-flight agent from being aborted merely
    // because the API refreshed its token.
    identity: `cloud:${protocol}//${pageHost}/ws:${cloudToken ? 'authenticated' : 'anonymous'}`,
    url: cloudToken
      ? `${protocol}//${pageHost}/ws?token=${encodeURIComponent(cloudToken)}`
      : null,
  };
};
