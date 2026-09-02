import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useAuth } from '../contexts/AuthContext';
import { api } from '../utils/api';
import { setActiveLocalKernel } from '../services/localKernelConnection';
import {
  clearLocalSessionToken,
  getLocalKernelStatus,
  getStoredLocalSessionToken,
  LOCAL_NETWORK_ACCESS_DENIED_ERROR,
  LOCAL_NETWORK_ACCESS_REQUIRED_ERROR,
  parseLocalKernelEndpoint,
  probeLocalKernel,
  refreshLocalSessionCloudAuth,
  rememberLocalKernelEndpoint,
  resolvePreferredLocalKernelEndpoints,
  revokeLocalSession,
  shutdownLocalKernel,
  startLocalSession,
  storeLocalSessionToken,
  type LocalKernelEndpoint,
  type LocalKernelHealth,
  type LocalKernelStatus,
} from '../services/localKernelClient';
import { getLocalNetworkAccessPermissionState } from '../utils/localNetworkAccess';
import { resolveLocalKernelRequired } from '../utils/localKernelRequired';
import { getDesktopCloudAppOrigin, getDesktopRuntimeInfo } from '../utils/desktopRuntime';
import {
  shouldAutoRetryDesktopConnection,
  shouldReplaceLocalKernelSessionAfterCloudAuthError,
  shouldRestartLocalKernelProbeAfterCloudAuthChange,
} from './localKernelRecovery';

export type LocalKernelGateState =
  | 'not-required'
  | 'probing'
  | 'offline'
  | 'invalid-endpoint'
  | 'session-pending'
  | 'connected'
  | 'error';

export type LocalKernelCloudConfig = {
  required?: boolean;
  discovery?: string;
  distribution?: 'desktop-only';
  desktopDownloadPath?: string;
  downloads?: {
    installer?: string;
    mac?: string;
    win?: string;
    windows?: string;
  };
  installCommands?: {
    default?: string;
    windows?: string;
  };
  installCommand?: string;
  command?: string;
  cliCommand?: string;
};

type LocalKernelContextValue = {
  isRequired: boolean;
  config: LocalKernelCloudConfig | null;
  state: LocalKernelGateState;
  endpoint: LocalKernelEndpoint | null;
  health: LocalKernelHealth | null;
  status: LocalKernelStatus | null;
  sessionToken: string | null;
  error: string | null;
  invalidEndpointReason: string | null;
  retry: () => Promise<void>;
  setEndpointFromInput: (value: string) => { ok: boolean; error?: string };
  disconnect: () => Promise<void>;
  shutdown: () => Promise<void>;
};

const LocalKernelContext = createContext<LocalKernelContextValue | null>(null);
const DISCOVERY_BATCH_SIZE = 8;
const DISCOVERY_TIMEOUT_MS = 650;
const PERMISSION_PROMPT_TIMEOUT_MS = 15_000;
const CLOUD_AUTH_REFRESH_INTERVAL_MS = 2 * 60 * 1000;
const CLOUD_AUTH_RETRY_DELAY_MS = 15 * 1000;
const BROWSER_DESKTOP_RETRY_INTERVAL_MS = 5 * 1000;

function createBrowserNonce() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function resolveRequiredFromEnv() {
  return resolveLocalKernelRequired();
}

async function findReachableKernelEndpoint(
  endpoints: LocalKernelEndpoint[],
  isCurrent: () => boolean,
) {
  let lastError: unknown = null;
  const shouldCheckBrowserPermission = !getDesktopRuntimeInfo().isDesktopShell;

  const initialPermission = shouldCheckBrowserPermission
    ? await getLocalNetworkAccessPermissionState()
    : 'unsupported';
  if (initialPermission === 'denied') {
    return {
      endpoint: null,
      health: null,
      error: new Error(LOCAL_NETWORK_ACCESS_DENIED_ERROR),
    };
  }

  // Probe the standard App endpoint separately. Chromium 142+ may pause this
  // first request while the user answers the Local Network Access prompt, so a
  // sub-second discovery timeout would abort the request before permission can
  // be granted. URL hints from the desktop shell take precedence when present.
  const permissionCandidate = endpoints.find((candidate) => candidate.source === 'url')
    || endpoints.find((candidate) => candidate.httpBaseUrl === 'http://127.0.0.1:5055')
    || endpoints[0];

  if (permissionCandidate) {
    try {
      const health = await probeLocalKernel(permissionCandidate, PERMISSION_PROMPT_TIMEOUT_MS);
      if (!isCurrent()) return null;
      return { endpoint: permissionCandidate, health, error: null };
    } catch (error) {
      lastError = error;
    }

    if (!isCurrent()) return null;
    const permissionAfterProbe = shouldCheckBrowserPermission
      ? await getLocalNetworkAccessPermissionState()
      : 'unsupported';
    if (permissionAfterProbe === 'denied' || permissionAfterProbe === 'prompt') {
      return {
        endpoint: null,
        health: null,
        error: new Error(
          permissionAfterProbe === 'denied'
            ? LOCAL_NETWORK_ACCESS_DENIED_ERROR
            : LOCAL_NETWORK_ACCESS_REQUIRED_ERROR,
        ),
      };
    }
  }

  const remainingEndpoints = endpoints.filter((candidate) => candidate !== permissionCandidate);

  for (let index = 0; index < remainingEndpoints.length; index += DISCOVERY_BATCH_SIZE) {
    const batch = remainingEndpoints.slice(index, index + DISCOVERY_BATCH_SIZE);
    const results = await Promise.all(batch.map(async (candidate) => {
      try {
        const health = await probeLocalKernel(candidate, DISCOVERY_TIMEOUT_MS);
        return { candidate, health, error: null };
      } catch (error) {
        return { candidate, health: null, error };
      }
    }));

    if (!isCurrent()) {
      return null;
    }

    const reachable = results.find((result) => result.health);
    if (reachable?.health) {
      return {
        endpoint: reachable.candidate,
        health: reachable.health,
        error: null,
      };
    }

    lastError = results.find((result) => result.error)?.error || lastError;
  }

  return { endpoint: null, health: null, error: lastError };
}

async function activatePairedKernelDevice(
  endpoint: LocalKernelEndpoint,
  localSessionToken: string,
  kernelStatus: LocalKernelStatus | null,
) {
  const response = await api.auth.activateKernelDevice({
    kernelVersion: kernelStatus?.version || null,
    kernelPlatform: kernelStatus?.platform || null,
  });
  if (response.ok) return;

  const payload = await response.json().catch(() => ({}));
  try {
    await revokeLocalSession(endpoint, localSessionToken);
  } catch {
    // Device-limit failures must still clear the browser's local pairing state.
  }
  clearLocalSessionToken(endpoint);
  const activationError = new Error(payload?.error || 'Unable to activate this Kernel device') as Error & {
    code?: string;
    maxDevices?: number;
  };
  activationError.code = payload?.code;
  activationError.maxDevices = payload?.maxDevices;
  throw activationError;
}

export function LocalKernelProvider({ children }: { children: ReactNode }) {
  const { user, token, localKernelConfig } = useAuth() as {
    user?: { id?: string | number } | null;
    token?: string | null;
    localKernelConfig?: LocalKernelCloudConfig | null;
  };
  const isRequired = Boolean(token && localKernelConfig?.required) || resolveRequiredFromEnv();
  const [state, setState] = useState<LocalKernelGateState>(isRequired ? 'probing' : 'not-required');
  const [endpoint, setEndpoint] = useState<LocalKernelEndpoint | null>(null);
  const [health, setHealth] = useState<LocalKernelHealth | null>(null);
  const [status, setStatus] = useState<LocalKernelStatus | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [invalidEndpointReason, setInvalidEndpointReason] = useState<string | null>(null);
  const probeSeqRef = useRef(0);
  const unauthorizedProbePendingRef = useRef(false);
  const browserNonceRef = useRef(createBrowserNonce());
  const cloudAuthRef = useRef({ token, userId: user?.id ?? null });
  const observedCloudTokenRef = useRef(token);
  const syncedCloudTokenRef = useRef<string | null>(null);
  cloudAuthRef.current = { token, userId: user?.id ?? null };

  useEffect(() => {
    if (state === 'connected') {
      setActiveLocalKernel(endpoint, sessionToken);
    } else {
      setActiveLocalKernel(null, null);
    }
    return () => setActiveLocalKernel(null, null);
  }, [state, endpoint, sessionToken]);

  const probe = useCallback(async () => {
    if (!isRequired) {
      setState('not-required');
      return;
    }

    const seq = probeSeqRef.current + 1;
    probeSeqRef.current = seq;
    setState('probing');
    setError(null);
    setInvalidEndpointReason(null);

    const candidates = resolvePreferredLocalKernelEndpoints(localKernelConfig || {});
    if (!candidates.length) {
      setEndpoint(null);
      setHealth(null);
      setStatus(null);
      setSessionToken(null);
      setInvalidEndpointReason('invalid_endpoint');
      setState('invalid-endpoint');
      return;
    }

    setEndpoint(candidates[0]);

    try {
      const discovered = await findReachableKernelEndpoint(candidates, () => probeSeqRef.current === seq);
      if (!discovered) {
        return;
      }
      if (!discovered.endpoint || !discovered.health) {
        throw discovered.error || new Error('Local Engine is offline');
      }

      const nextHealth = discovered.health;
      const nextEndpoint = discovered.endpoint;
      if (probeSeqRef.current !== seq) {
        return;
      }
      setEndpoint(nextEndpoint);
      setHealth(nextHealth);
      rememberLocalKernelEndpoint(nextEndpoint);

      const storedToken = getStoredLocalSessionToken(nextEndpoint);
      if (storedToken) {
        try {
          const nextStatus = await getLocalKernelStatus(nextEndpoint, storedToken);
          if (probeSeqRef.current !== seq) {
            return;
          }
          setStatus(nextStatus);
          if (nextStatus?.sessionActive) {
            const latestCloudAuth = cloudAuthRef.current;
            if (latestCloudAuth.token) {
              await refreshLocalSessionCloudAuth(nextEndpoint, storedToken, {
                cloudUserId: latestCloudAuth.userId,
                cloudAccessToken: latestCloudAuth.token,
                cloudBaseUrl: getDesktopCloudAppOrigin(),
                origin: window.location.origin,
              });
              syncedCloudTokenRef.current = latestCloudAuth.token;
            }
            await activatePairedKernelDevice(nextEndpoint, storedToken, nextStatus);
            if (probeSeqRef.current !== seq) {
              return;
            }
            setSessionToken(storedToken);
            setState('connected');
            return;
          }
        } catch {
          clearLocalSessionToken(nextEndpoint);
        }
      }

      const latestCloudAuth = cloudAuthRef.current;
      if (latestCloudAuth.token) {
        try {
          const localSession = await startLocalSession(nextEndpoint, {
            cloudUserId: latestCloudAuth.userId,
            cloudAccessToken: latestCloudAuth.token,
            cloudBaseUrl: getDesktopCloudAppOrigin(),
            origin: window.location.origin,
            browserNonce: browserNonceRef.current,
            requestedPermissionMode: 'analysis',
          });
          if (probeSeqRef.current !== seq) {
            return;
          }
          if (!localSession.sessionToken) {
            throw new Error('Local Engine did not return a session token');
          }
          syncedCloudTokenRef.current = latestCloudAuth.token;
          const nextStatus = await getLocalKernelStatus(nextEndpoint, localSession.sessionToken);
          if (probeSeqRef.current !== seq) {
            return;
          }
          await activatePairedKernelDevice(nextEndpoint, localSession.sessionToken, nextStatus);
          if (probeSeqRef.current !== seq) {
            return;
          }
          storeLocalSessionToken(nextEndpoint, localSession.sessionToken);
          setSessionToken(localSession.sessionToken);
          setStatus(nextStatus);
          setState('connected');
          return;
        } catch (sessionError) {
          if (probeSeqRef.current !== seq) {
            return;
          }
          setStatus(null);
          setSessionToken(null);
          setError(sessionError instanceof Error ? sessionError.message : 'Local Engine login sync failed');
          setState('offline');
          return;
        }
      }

      setSessionToken(null);
      setState('session-pending');
    } catch (err) {
      if (probeSeqRef.current !== seq) {
        return;
      }
      setHealth(null);
      setStatus(null);
      setSessionToken(null);
      setError(err instanceof Error ? err.message : 'Local Engine is offline');
      setState('offline');
    }
  }, [isRequired, localKernelConfig]);

  useEffect(() => {
    probe();
  }, [probe]);

  useEffect(() => {
    if (!shouldAutoRetryDesktopConnection({
      isDesktopShell: getDesktopRuntimeInfo().isDesktopShell,
      isRequired,
      hasCloudAccessToken: Boolean(token),
      state,
    })) {
      return undefined;
    }

    const retryTimeoutId = window.setTimeout(() => {
      void probe();
    }, BROWSER_DESKTOP_RETRY_INTERVAL_MS);
    const retryWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        void probe();
      }
    };
    document.addEventListener('visibilitychange', retryWhenVisible);
    return () => {
      window.clearTimeout(retryTimeoutId);
      document.removeEventListener('visibilitychange', retryWhenVisible);
    };
  }, [isRequired, probe, state, token]);

  useEffect(() => {
    const previousCloudAccessToken = observedCloudTokenRef.current;
    observedCloudTokenRef.current = token;
    if (!shouldRestartLocalKernelProbeAfterCloudAuthChange({
      isRequired,
      state,
      previousCloudAccessToken,
      currentCloudAccessToken: token,
    })) {
      return;
    }
    void probe();
  }, [isRequired, probe, state, token]);

  useEffect(() => {
    if (
      state !== 'connected'
      || !endpoint
      || !sessionToken
      || !token
    ) {
      return undefined;
    }

    let cancelled = false;
    let refreshInFlight = false;
    let retryTimeoutId: number | null = null;
    const refreshOnlineAuthorization = async () => {
      if (cancelled || refreshInFlight) return;
      refreshInFlight = true;
      try {
        await refreshLocalSessionCloudAuth(endpoint, sessionToken, {
          cloudUserId: user?.id ?? null,
          cloudAccessToken: token,
          cloudBaseUrl: getDesktopCloudAppOrigin(),
          origin: window.location.origin,
        });
        if (!cancelled) {
          syncedCloudTokenRef.current = token;
          if (retryTimeoutId !== null) {
            window.clearTimeout(retryTimeoutId);
            retryTimeoutId = null;
          }
        }
      } catch (refreshError) {
        if (cancelled) return;
        if (!shouldReplaceLocalKernelSessionAfterCloudAuthError(refreshError)) {
          // Keep the current workspace and loopback WebSocket alive while a
          // transient cloud/network failure retries quietly in the background.
          console.warn('Local Kernel cloud authorization refresh deferred', refreshError);
          if (retryTimeoutId === null) {
            retryTimeoutId = window.setTimeout(() => {
              retryTimeoutId = null;
              void refreshOnlineAuthorization();
            }, CLOUD_AUTH_RETRY_DELAY_MS);
          }
          return;
        }
        clearLocalSessionToken(endpoint);
        syncedCloudTokenRef.current = null;
        setSessionToken(null);
        setStatus(null);
        setState('probing');
        void probe();
      } finally {
        refreshInFlight = false;
      }
    };

    if (syncedCloudTokenRef.current !== token) {
      void refreshOnlineAuthorization();
    }
    const intervalId = window.setInterval(refreshOnlineAuthorization, CLOUD_AUTH_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      if (retryTimeoutId !== null) {
        window.clearTimeout(retryTimeoutId);
      }
    };
  }, [endpoint, probe, sessionToken, state, token, user?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleDesktopEndpointUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ endpoint?: string }>;
      const parsed = parseLocalKernelEndpoint(customEvent.detail?.endpoint || '', 'url');
      if (!parsed.endpoint) {
        return;
      }

      rememberLocalKernelEndpoint(parsed.endpoint);
      setEndpoint(parsed.endpoint);
      setInvalidEndpointReason(null);
      setError(null);
      queueMicrotask(() => {
        void probe();
      });
    };

    window.addEventListener('medhelp-local-kernel-endpoint-updated', handleDesktopEndpointUpdated);
    return () => {
      window.removeEventListener('medhelp-local-kernel-endpoint-updated', handleDesktopEndpointUpdated);
    };
  }, [probe]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const handleUnauthorized = () => {
      if (!isRequired || unauthorizedProbePendingRef.current) {
        return;
      }
      unauthorizedProbePendingRef.current = true;
      if (endpoint) {
        clearLocalSessionToken(endpoint);
      }
      setSessionToken(null);
      setStatus(null);
      void probe().finally(() => {
        unauthorizedProbePendingRef.current = false;
      });
    };

    window.addEventListener('medhelp-local-kernel-unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('medhelp-local-kernel-unauthorized', handleUnauthorized);
    };
  }, [endpoint, isRequired, probe]);

  const setEndpointFromInput = useCallback((value: string) => {
    const parsed = parseLocalKernelEndpoint(value, 'url');
    if (!parsed.endpoint) {
      setInvalidEndpointReason(parsed.error);
      setState('invalid-endpoint');
      return { ok: false, error: parsed.error || 'invalid_endpoint' };
    }

    rememberLocalKernelEndpoint(parsed.endpoint);
    setEndpoint(parsed.endpoint);
    setInvalidEndpointReason(null);
    queueMicrotask(() => {
      probe();
    });
    return { ok: true };
  }, [probe]);

  const disconnect = useCallback(async () => {
    const currentEndpoint = endpoint;
    const currentToken = sessionToken;
    if (currentEndpoint && currentToken) {
      try {
        await revokeLocalSession(currentEndpoint, currentToken);
      } catch {
        // Local Kernel may already be gone; local cleanup still matters.
      }
      clearLocalSessionToken(currentEndpoint);
    }
    setSessionToken(null);
    setStatus(null);
    if (isRequired) {
      setState('session-pending');
    }
  }, [endpoint, isRequired, sessionToken]);

  const shutdown = useCallback(async () => {
    const currentEndpoint = endpoint;
    const currentToken = sessionToken;
    if (!currentEndpoint || !currentToken) {
      throw new Error('Local Engine is not connected');
    }

    await shutdownLocalKernel(currentEndpoint, currentToken);
    probeSeqRef.current += 1;
    clearLocalSessionToken(currentEndpoint);
    syncedCloudTokenRef.current = null;
    setActiveLocalKernel(null, null);
    setSessionToken(null);
    setStatus(null);
    setHealth(null);
    setError(null);
    setState('offline');
  }, [endpoint, sessionToken]);

  const value = useMemo<LocalKernelContextValue>(() => ({
    isRequired,
    config: localKernelConfig || null,
    state,
    endpoint,
    health,
    status,
    sessionToken,
    error,
    invalidEndpointReason,
    retry: probe,
    setEndpointFromInput,
    disconnect,
    shutdown,
  }), [
    disconnect,
    endpoint,
    localKernelConfig,
    error,
    health,
    invalidEndpointReason,
    isRequired,
    probe,
    sessionToken,
    setEndpointFromInput,
    shutdown,
    state,
    status,
  ]);

  return (
    <LocalKernelContext.Provider value={value}>
      {children}
    </LocalKernelContext.Provider>
  );
}

export function useLocalKernel() {
  const value = useContext(LocalKernelContext);
  if (!value) {
    throw new Error('useLocalKernel must be used inside LocalKernelProvider');
  }
  return value;
}

export function useOptionalLocalKernel() {
  return useContext(LocalKernelContext);
}
