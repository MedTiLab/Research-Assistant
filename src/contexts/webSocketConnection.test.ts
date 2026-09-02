import { describe, expect, it } from 'vitest';

import { resolveChatWebSocketConnection } from './webSocketConnection';

const hostedShell = {
  isPlatform: false,
  pageProtocol: 'https:',
  pageHost: 'app.medtimehelp.com',
  authLoading: false,
  localKernelRequired: true,
  localKernelState: 'connected',
  localKernelWsBaseUrl: 'ws://127.0.0.1:5055',
  localKernelSessionToken: 'local-session-token',
};

describe('resolveChatWebSocketConnection', () => {
  it('keeps the hosted-shell Kernel socket stable while the cloud token refreshes', () => {
    const beforeRefresh = resolveChatWebSocketConnection({
      ...hostedShell,
      cloudToken: 'cloud-token-before',
    });
    const duringRefresh = resolveChatWebSocketConnection({
      ...hostedShell,
      cloudToken: 'cloud-token-after',
      authLoading: true,
    });

    expect(duringRefresh.url).toBe(beforeRefresh.url);
    expect(duringRefresh.identity).toBe(beforeRefresh.identity);
    expect(duringRefresh.disabled).toBe(false);
    expect(duringRefresh.localKernelReady).toBe(true);
  });

  it('blocks the hosted shell until its required local Kernel is paired', () => {
    const connection = resolveChatWebSocketConnection({
      ...hostedShell,
      cloudToken: 'cloud-token',
      localKernelState: 'probing',
      localKernelSessionToken: null,
    });

    expect(connection.disabled).toBe(true);
    expect(connection.url).toContain('app.medtimehelp.com/ws');
  });

  it('continues to use cloud auth for a legacy non-Kernel socket', () => {
    const connection = resolveChatWebSocketConnection({
      ...hostedShell,
      cloudToken: 'cloud-token',
      localKernelRequired: false,
      localKernelState: null,
      localKernelWsBaseUrl: null,
      localKernelSessionToken: null,
    });

    expect(connection.disabled).toBe(false);
    expect(connection.url).toBe('wss://app.medtimehelp.com/ws?token=cloud-token');
  });

  it('does not replace an authenticated cloud socket when its access token rotates', () => {
    const beforeRefresh = resolveChatWebSocketConnection({
      ...hostedShell,
      localKernelRequired: false,
      localKernelState: null,
      localKernelWsBaseUrl: null,
      localKernelSessionToken: null,
      cloudToken: 'cloud-token-before',
    });
    const afterRefresh = resolveChatWebSocketConnection({
      ...hostedShell,
      localKernelRequired: false,
      localKernelState: null,
      localKernelWsBaseUrl: null,
      localKernelSessionToken: null,
      cloudToken: 'cloud-token-after',
    });

    expect(afterRefresh.url).not.toBe(beforeRefresh.url);
    expect(afterRefresh.identity).toBe(beforeRefresh.identity);
  });

  it('changes cloud connection identity when authentication is removed', () => {
    const authenticated = resolveChatWebSocketConnection({
      ...hostedShell,
      localKernelRequired: false,
      localKernelState: null,
      localKernelWsBaseUrl: null,
      localKernelSessionToken: null,
      cloudToken: 'cloud-token',
    });
    const loggedOut = resolveChatWebSocketConnection({
      ...hostedShell,
      localKernelRequired: false,
      localKernelState: null,
      localKernelWsBaseUrl: null,
      localKernelSessionToken: null,
      cloudToken: null,
    });

    expect(loggedOut.identity).not.toBe(authenticated.identity);
    expect(loggedOut.url).toBeNull();
  });
});
