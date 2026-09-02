function parseUrl(value) {
  try {
    return new URL(String(value || ''));
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname) {
  const normalized = String(hostname || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  return normalized === 'localhost' || normalized === '::1' || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

export function isRuntimeAppUrl(currentUrl, baseUrl) {
  const current = parseUrl(currentUrl);
  const runtime = parseUrl(baseUrl);
  return Boolean(current && runtime && current.origin === runtime.origin);
}

export function resolveRuntimeAppUrl(baseUrl, currentUrl = '', { preserveRoute = false } = {}) {
  const runtime = parseUrl(baseUrl);
  if (!runtime || !['http:', 'https:'].includes(runtime.protocol) || !isLoopbackHost(runtime.hostname)) {
    throw new Error(`Invalid loopback Runtime URL: ${baseUrl}`);
  }

  const current = parseUrl(currentUrl);
  if (
    preserveRoute
    && current
    && ['http:', 'https:'].includes(current.protocol)
    && isLoopbackHost(current.hostname)
  ) {
    return new URL(`${current.pathname}${current.search}${current.hash}`, runtime.origin).toString();
  }
  return new URL('/', runtime.origin).toString();
}
