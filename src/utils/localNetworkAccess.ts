type LoopbackRequestInit = RequestInit & {
  targetAddressSpace?: 'loopback';
};

export type LocalNetworkAccessPermissionState = PermissionState | 'unsupported';

function normalizeHostname(hostname: string) {
  return hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
}

export function isLoopbackRequestUrl(input: RequestInfo | URL): boolean {
  if (typeof input !== 'string' && !(input instanceof URL)) {
    return false;
  }

  try {
    const parsed = input instanceof URL
      ? input
      : new URL(input, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
    const hostname = normalizeHostname(parsed.hostname);
    return parsed.protocol === 'http:'
      && (
        hostname === 'localhost'
        || hostname === '::1'
        || /^127(?:\.\d{1,3}){3}$/.test(hostname)
      );
  } catch {
    return false;
  }
}

export function withLoopbackTargetAddressSpace<T extends RequestInit>(
  input: RequestInfo | URL,
  init: T,
): T & LoopbackRequestInit {
  if (!isLoopbackRequestUrl(input)) {
    return init as T & LoopbackRequestInit;
  }

  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    return {
      ...init,
      targetAddressSpace: 'loopback',
    };
  }

  // Chromium fails loopback fetches from local HTTP development pages when the
  // targetAddressSpace flag is present. Keep those as plain fetches.
  return { ...init } as T & LoopbackRequestInit;
}

export function fetchWithLocalNetworkAccess(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(input, withLoopbackTargetAddressSpace(input, init));
}

export async function getLocalNetworkAccessPermissionState(): Promise<LocalNetworkAccessPermissionState> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
    return 'unsupported';
  }

  try {
    const status = await navigator.permissions.query({
      name: 'local-network-access',
    } as unknown as PermissionDescriptor);
    return status.state;
  } catch {
    // Firefox, Safari, and older Chromium releases do not expose this
    // permission name. Their normal fetch result remains authoritative.
    return 'unsupported';
  }
}
