type LocalKernelRuntimeEnv = {
  VITE_REQUIRE_LOCAL_KERNEL?: string;
  VITE_MEDHELP_WEB_SHELL_ONLY?: string;
  VITE_MEDHELP_LOCAL_KERNEL_OPTIONAL?: string;
  VITE_MEDHELP_ALLOW_SERVER_PROJECTS?: string;
};

type BrowserLocationLike = Pick<Location, 'hostname' | 'protocol'>;

function isTruthyEnvValue(value: unknown) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

export function isLoopbackBrowserHostname(hostname: string | null | undefined) {
  const normalized = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\[/, '')
    .replace(/\]$/, '');

  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized === '0.0.0.0'
    || normalized === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function parseIpv4Hostname(hostname: string) {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;

  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return NaN;
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : NaN;
  });

  return octets.every(Number.isFinite) ? octets : null;
}

export function isPrivateNetworkBrowserHostname(hostname: string | null | undefined) {
  const normalized = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\[/, '')
    .replace(/\]$/, '');

  if (!normalized) return false;
  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) {
    return true;
  }

  const ipv4 = parseIpv4Hostname(normalized);
  if (ipv4) {
    const [first, second] = ipv4;
    return first === 10
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || (first === 169 && second === 254)
      || (first === 100 && second >= 64 && second <= 127);
  }

  if (normalized.includes(':')) {
    return /^f[cd][0-9a-f]*:/i.test(normalized) || /^fe80:/i.test(normalized);
  }

  return false;
}

export function isLocalBrowserHostname(hostname: string | null | undefined) {
  return isLoopbackBrowserHostname(hostname) || isPrivateNetworkBrowserHostname(hostname);
}

export function resolveLocalKernelRequired(
  env: LocalKernelRuntimeEnv = import.meta.env as LocalKernelRuntimeEnv,
  locationLike: BrowserLocationLike | null | undefined = typeof window !== 'undefined' ? window.location : null,
) {
  if (isTruthyEnvValue(env.VITE_REQUIRE_LOCAL_KERNEL) || isTruthyEnvValue(env.VITE_MEDHELP_WEB_SHELL_ONLY)) {
    return true;
  }

  if (
    isTruthyEnvValue(env.VITE_MEDHELP_LOCAL_KERNEL_OPTIONAL)
    || isTruthyEnvValue(env.VITE_MEDHELP_ALLOW_SERVER_PROJECTS)
  ) {
    return false;
  }

  if (!locationLike || !/^https?:$/i.test(locationLike.protocol || '')) {
    return false;
  }

  return !isLocalBrowserHostname(locationLike.hostname);
}
