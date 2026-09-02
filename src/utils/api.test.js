import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createStorage() {
  const values = new Map();
  return {
    getItem: vi.fn((key) => (values.has(key) ? values.get(key) : null)),
    setItem: vi.fn((key, value) => {
      values.set(key, String(value));
    }),
    removeItem: vi.fn((key) => {
      values.delete(key);
    }),
    clear: vi.fn(() => {
      values.clear();
    }),
  };
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('auth API token refresh', () => {
  let storage;
  let listeners;

  beforeEach(() => {
    vi.resetModules();
    storage = createStorage();
    listeners = new Map();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn((event) => {
        const callbacks = listeners.get(event.type) || [];
        callbacks.forEach((callback) => callback(event));
        return true;
      }),
      addEventListener: vi.fn((type, callback) => {
        listeners.set(type, [...(listeners.get(type) || []), callback]);
      }),
      removeEventListener: vi.fn(),
      location: {
        href: 'http://localhost/',
        protocol: 'http:',
        hostname: 'localhost',
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps the provider when restoring a session from trash', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');
    await api.restoreSession('project name', 'saved-session', 'pi');
    expect(fetchMock).toHaveBeenCalledWith('/api/projects/project%20name/sessions/saved-session/restore',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ provider: 'pi' }) }));
  });

  it('passes cancellation through the scoped Pi progress request', async () => {
    const fetchMock = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { api } = await import('./api.js');
    const controller = new AbortController();
    const result = api.piSessionState('project name', 'session-one', { signal: controller.signal }).catch((error) => error);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/pi/projects/project%20name/sessions/session-one/state');
    controller.abort();
    expect((await result).name).toBe('AbortError');
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('does not clear tokens or expire the session when refresh fails due to a network error', async () => {
    storage.setItem('auth-token', 'access-old');
    storage.setItem('auth-refresh-token', 'refresh-old');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const expired = vi.fn();
    window.addEventListener('medhelp-auth-session-expired', expired);

    const { refreshStoredAuthToken } = await import('./api.js');

    await expect(refreshStoredAuthToken()).resolves.toBeNull();

    expect(expired).not.toHaveBeenCalled();
    expect(storage.getItem('auth-token')).toBe('access-old');
    expect(storage.getItem('auth-refresh-token')).toBe('refresh-old');
  });

  it('emits session-expired once when the refresh token is rejected', async () => {
    storage.setItem('auth-token', 'access-old');
    storage.setItem('auth-refresh-token', 'refresh-old');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'expired' }, { status: 401 })));
    const expired = vi.fn();
    window.addEventListener('medhelp-auth-session-expired', expired);

    const { authenticatedFetch } = await import('./api.js');

    await authenticatedFetch('/api/projects');

    expect(expired).toHaveBeenCalledTimes(1);
    expect(storage.getItem('auth-token')).toBeNull();
    expect(storage.getItem('auth-refresh-token')).toBeNull();
  });

  it('coordinates refresh across window module instances without clearing the winner tokens', async () => {
    storage.setItem('auth-token', 'access-old');
    storage.setItem('auth-refresh-token', 'refresh-old');
    let refreshCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (url === '/api/auth/refresh') {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return jsonResponse({
          accessToken: 'access-new',
          refreshToken: 'refresh-new',
          sessionId: 'session-1',
        });
      }
      const authorization = options.headers?.Authorization;
      return authorization === 'Bearer access-new'
        ? jsonResponse({ success: true })
        : new Response(null, { status: 401 });
    }));

    const firstWindowApi = await import('./api.js');
    vi.resetModules();
    const secondWindowApi = await import('./api.js');

    const [firstResponse, secondResponse] = await Promise.all([
      firstWindowApi.authenticatedFetch('/api/projects'),
      secondWindowApi.authenticatedFetch('/api/projects'),
    ]);

    expect(firstResponse.ok).toBe(true);
    expect(secondResponse.ok).toBe(true);
    expect(refreshCalls).toBe(1);
    expect(storage.getItem('auth-token')).toBe('access-new');
    expect(storage.getItem('auth-refresh-token')).toBe('refresh-new');
  });
});

describe('platform authenticated API calls', () => {
  let storage;
  let sessionStorage;

  beforeEach(() => {
    vi.resetModules();
    vi.doMock('../constants/config', () => ({ IS_PLATFORM: true }));
    storage = createStorage();
    sessionStorage = createStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', sessionStorage);
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(() => true),
      location: {
        href: 'https://app.medtimehelp.com/',
        protocol: 'https:',
        hostname: 'app.medtimehelp.com',
        search: '',
        hash: '',
      },
    });
  });

  afterEach(() => {
    vi.doUnmock('../constants/config');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends the stored access token on cloud API requests', async () => {
    storage.setItem('auth-token', 'access-platform');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: true })));

    const { authenticatedFetch } = await import('./api.js');

    await authenticatedFetch('/api/user/complete-onboarding', { method: 'POST' });

    expect(fetch).toHaveBeenCalledWith('/api/user/complete-onboarding', expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer access-platform',
      }),
    }));
  });

  it('sends device identity with presence heartbeats', async () => {
    storage.setItem('auth-token', 'access-platform');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: true })));

    const { api } = await import('./api.js');
    await api.auth.presence();

    expect(fetch).toHaveBeenCalledWith('/api/auth/presence', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer access-platform' }),
    }));
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({
      deviceFingerprint: expect.any(String),
      deviceLabel: expect.any(String),
      clientType: 'web',
    });
  });

  it('activates device counting only through the explicit Kernel pairing endpoint', async () => {
    storage.setItem('auth-token', 'access-platform');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      countedAsDevice: true,
    })));

    const { api } = await import('./api.js');
    await api.auth.activateKernelDevice({
      kernelVersion: '1.1.18',
      kernelPlatform: 'darwin',
    });

    expect(fetch).toHaveBeenCalledWith('/api/auth/kernel-device/activate', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer access-platform' }),
      body: JSON.stringify({
        kernelVersion: '1.1.18',
        kernelPlatform: 'darwin',
      }),
    }));
  });

  it('keeps the installed desktop version after SPA navigation removes launch parameters', async () => {
    window.location.search = '?desktopKernel=1&desktopPlatform=win32&desktopKernelVersion=1.1.14';
    window.medhelpDesktop = { isDesktop: true, platform: 'win32', version: null };

    const { getAuthDeviceIdentity } = await import('./api.js');
    window.location.search = '';

    expect(getAuthDeviceIdentity()).toMatchObject({
      clientType: 'desktop-windows',
      clientVersion: '1.1.14',
      clientPlatform: 'win32',
    });
  });

  it('keeps desktop Kernel auth sync after SPA navigation removes launch parameters', async () => {
    window.medhelpDesktop = {
      isDesktop: true,
      platform: 'darwin',
      version: '1.1.19',
      uiMode: 'offline',
      cloudAppOrigin: 'https://app.medtimehelp.com',
    };
    storage.setItem('medhelp.localKernel.lastEndpoint', 'http://127.0.0.1:5099');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: true })));

    const { syncDesktopAuthIfRequested } = await import('./api.js');
    await syncDesktopAuthIfRequested({
      accessToken: 'access-desktop',
      refreshToken: 'refresh-desktop',
      user: { id: 32 },
    });

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:5099/api/local/desktop-auth/sync',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('access-desktop'),
      }),
    );
  });

  it('does not report the hosted web build as an unknown desktop version', async () => {
    window.medhelpDesktop = { isDesktop: true, platform: 'win32', version: null };

    const { getAuthDeviceIdentity } = await import('./api.js');

    expect(getAuthDeviceIdentity()).toMatchObject({
      clientType: 'desktop-windows',
      clientVersion: null,
      clientPlatform: 'win32',
    });
  });

  it('persists and restores the desktop auth session outside port-scoped localStorage', async () => {
    const saveAuthSession = vi.fn().mockResolvedValue(true);
    const restoreAuthSession = vi.fn().mockResolvedValue({
      accessToken: 'access-restored',
      refreshToken: 'refresh-restored',
      sessionId: 'session-restored',
      deviceFingerprint: 'device-restored',
    });
    window.medhelpDesktop = {
      isDesktop: true,
      platform: 'darwin',
      saveAuthSession,
      restoreAuthSession,
    };

    const { restoreDesktopAuthSession, storeAuthTokens } = await import('./api.js');
    storeAuthTokens({
      accessToken: 'access-current',
      refreshToken: 'refresh-current',
      sessionId: 'session-current',
    });
    await vi.waitFor(() => expect(saveAuthSession).toHaveBeenCalled());

    const restored = await restoreDesktopAuthSession();
    expect(restored).toMatchObject({ accessToken: 'access-restored' });
    expect(storage.getItem('medhelp-auth-device-id')).toBe('device-restored');
  });

  it('clears the encrypted desktop session together with browser tokens', async () => {
    const clearAuthSession = vi.fn().mockResolvedValue(true);
    window.medhelpDesktop = { isDesktop: true, platform: 'darwin', clearAuthSession };
    storage.setItem('auth-token', 'access-current');
    storage.setItem('auth-refresh-token', 'refresh-current');

    const { clearStoredAuthTokens } = await import('./api.js');
    clearStoredAuthTokens();
    await vi.waitFor(() => expect(clearAuthSession).toHaveBeenCalledTimes(1));

    expect(storage.getItem('auth-token')).toBeNull();
    expect(storage.getItem('auth-refresh-token')).toBeNull();
  });

  it('reports only the current visible project count to the cloud account', async () => {
    storage.setItem('auth-token', 'access-platform');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: true })));

    const { api } = await import('./api.js');
    await api.auth.reportProjectCount(2);

    expect(fetch).toHaveBeenCalledWith('/api/auth/project-count', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer access-platform' }),
      body: JSON.stringify({ projectCount: 2 }),
    }));
  });

  it('selects the local machine by clearing the active remote compute node', async () => {
    storage.setItem('auth-token', 'access-platform');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: true, activeNodeId: null })));

    const { setActiveLocalKernel } = await import('../services/localKernelConnection');
    const { api } = await import('./api.js');
    setActiveLocalKernel({ httpBaseUrl: 'http://127.0.0.1:5055' }, 'mh_loc_x');
    await api.compute.setActive(null);

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:5055/api/compute/active', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer mh_loc_x' }),
      body: JSON.stringify({ nodeId: null }),
    }));
  });

  it('keeps the skill catalog and market on the connected Local Kernel', async () => {
    storage.setItem('auth-token', 'access-platform');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ items: [] })));

    const { setActiveLocalKernel } = await import('../services/localKernelConnection');
    const { api } = await import('./api.js');
    setActiveLocalKernel({ httpBaseUrl: 'http://127.0.0.1:5055' }, 'mh_loc_x');

    await api.getGlobalSkills();
    await api.getSkillMentionCandidates();
    await api.listSkillMarket({ query: 'review', source: 'skillhub' });

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:5055/api/skills',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer mh_loc_x' }) }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:5055/api/skills/mentions',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer mh_loc_x' }) }),
    );
    expect(fetch.mock.calls[2][0]).toBe(
      'http://127.0.0.1:5055/api/skills/market?q=review&source=skillhub&limit=24',
    );
  });

  it('refreshes expired platform access tokens and retries the request', async () => {
    storage.setItem('auth-token', 'access-old');
    storage.setItem('auth-refresh-token', 'refresh-platform');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'access-new' }))
      .mockResolvedValueOnce(jsonResponse({ success: true })));

    const { authenticatedFetch } = await import('./api.js');

    const response = await authenticatedFetch('/api/user/complete-onboarding', { method: 'POST' });

    expect(response.ok).toBe(true);
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/auth/refresh', expect.objectContaining({
      method: 'POST',
    }));
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({
      refreshToken: 'refresh-platform',
      deviceFingerprint: expect.any(String),
    });
    expect(fetch).toHaveBeenNthCalledWith(3, '/api/user/complete-onboarding', expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer access-new',
      }),
    }));
  });

  it('creates conversation shares from local Kernel messages and stores the snapshot on the cloud', async () => {
    storage.setItem('auth-token', 'access-platform');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        messages: [
          { role: 'user', content: 'question', timestamp: '2026-07-05T00:00:00.000Z' },
          { role: 'assistant', content: 'answer', timestamp: '2026-07-05T00:00:01.000Z' },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({
        url: 'https://app.medtimehelp.com/share/share-token',
      }, { status: 201 })));

    const { setActiveLocalKernel } = await import('../services/localKernelConnection');
    const { api } = await import('./api.js');
    setActiveLocalKernel({ httpBaseUrl: 'http://127.0.0.1:5055' }, 'mh_loc_x');

    const response = await api.shares.createConversation({
      projectName: 'local-project',
      sessionId: 'session-1',
      provider: 'claude',
      visibility: 'public',
      title: 'Share me',
    });

    expect(response.ok).toBe(true);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:5055/api/projects/local-project/sessions/session-1/messages?provider=claude',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer mh_loc_x',
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/shares/snapshots',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer access-platform',
        }),
      }),
    );
    const snapshotPayload = JSON.parse(fetch.mock.calls[1][1].body);
    expect(snapshotPayload.rawMessages).toHaveLength(2);
  });

  it('syncs visible session data from the local Kernel into the account cloud archive', async () => {
    storage.setItem('auth-token', 'access-platform');
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        messages: [
          { role: 'user', content: 'question', timestamp: '2026-07-15T00:00:00.000Z' },
          { role: 'assistant', content: 'answer', timestamp: '2026-07-15T00:00:01.000Z' },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({ conversation: { id: 'cloud-conversation-1' } })));

    const { setActiveLocalKernel } = await import('../services/localKernelConnection');
    const { api } = await import('./api.js');
    setActiveLocalKernel({ httpBaseUrl: 'http://127.0.0.1:5055' }, 'mh_loc_x');

    const response = await api.conversations.syncFromSession({
      projectName: '-Users-customer-private-study',
      projectLabel: 'Study A',
      sessionId: 'session-1',
      provider: 'claude',
      title: 'Saved conversation',
    });

    expect(response.ok).toBe(true);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:5055/api/projects/-Users-customer-private-study/sessions/session-1/messages?provider=claude',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer mh_loc_x' }) }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/conversations/session/session-1',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ Authorization: 'Bearer access-platform' }),
      }),
    );
    const cloudPayload = JSON.parse(fetch.mock.calls[1][1].body);
    expect(cloudPayload.projectLabel).toBe('Study A');
    expect(cloudPayload.projectName).toBeUndefined();
    expect(cloudPayload.messages).toHaveLength(2);
  });

  it('creates single assistant message shares directly on the cloud snapshot endpoint', async () => {
    storage.setItem('auth-token', 'access-platform');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      url: 'https://app.medtimehelp.com/share/message-token',
    }, { status: 201 })));

    const { setActiveLocalKernel } = await import('../services/localKernelConnection');
    const { api } = await import('./api.js');
    setActiveLocalKernel({ httpBaseUrl: 'http://127.0.0.1:5055' }, 'mh_loc_x');

    const response = await api.shares.createMessage({
      projectName: 'local-project',
      sessionId: 'session-1',
      provider: 'claude',
      visibility: 'public',
      content: 'assistant answer',
      timestamp: '2026-07-05T00:00:01.000Z',
      title: 'MedHelp shared answer',
    });

    expect(response.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/shares/snapshots', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer access-platform',
      }),
    }));
    const snapshotPayload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(snapshotPayload.content).toBe('assistant answer');
  });

  it('keeps account memories in the cloud while exporting legacy memories locally', async () => {
    storage.setItem('auth-token', 'access-platform');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ memories: [] })));

    const { setActiveLocalKernel } = await import('../services/localKernelConnection');
    const { api } = await import('./api.js');
    setActiveLocalKernel({ httpBaseUrl: 'http://127.0.0.1:5055' }, 'mh_loc_x');

    await api.settings.memory();
    await api.settings.exportLocalMemories();

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/settings/preferences', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer access-platform' }),
    }));
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:5055/api/local/preferences/export',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer mh_loc_x' }),
      }),
    );
  });
});

describe('local Kernel unauthorized handling', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(() => true),
      location: {
        href: 'http://localhost/',
        protocol: 'http:',
        hostname: 'localhost',
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('dispatches a local Kernel unauthorized event for local-session 401 responses', async () => {
    const { setActiveLocalKernel } = await import('../services/localKernelConnection');
    const { authenticatedFetch } = await import('./api.js');
    setActiveLocalKernel({ httpBaseUrl: 'http://127.0.0.1:5055' }, 'mh_loc_x');

    await authenticatedFetch('/api/projects');

    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(window.dispatchEvent.mock.calls[0][0].type).toBe('medhelp-local-kernel-unauthorized');
  });
});
