export function isRendererOwnedNavigationUrl(value) {
  try {
    const protocol = new URL(String(value || '')).protocol;
    return protocol === 'blob:' || protocol === 'data:';
  } catch {
    return false;
  }
}

export function isHostedHttpUrl(value, cloudAppOrigin) {
  try {
    const url = new URL(String(value || ''), cloudAppOrigin);
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && url.origin === cloudAppOrigin;
  } catch {
    return false;
  }
}

const ONLINE_RESOURCE_PATHS = new Set([
  '/api-docs.html',
  '/clear-cache.html',
]);

const LOCAL_DOCUMENT_PATHS = new Set([
  '/help.html',
]);

function isOnlineResourcePath(pathname) {
  return ONLINE_RESOURCE_PATHS.has(pathname)
    || pathname === '/download'
    || pathname.startsWith('/download/')
    || pathname.startsWith('/downloads/');
}

export function resolveOnlineResourceUrl(value, { cloudAppOrigin, rendererOrigin }) {
  try {
    const url = new URL(String(value || ''), rendererOrigin);
    if (![cloudAppOrigin, rendererOrigin].includes(url.origin)) return null;
    if (!isOnlineResourcePath(url.pathname)) return null;
    return new URL(`${url.pathname}${url.search}${url.hash}`, cloudAppOrigin).href;
  } catch {
    return null;
  }
}

export function resolveLocalDocumentUrl(value, { rendererOrigin }) {
  try {
    const url = new URL(String(value || ''), rendererOrigin);
    if (url.origin !== rendererOrigin) return null;
    if (!LOCAL_DOCUMENT_PATHS.has(url.pathname)) return null;
    return url.href;
  } catch {
    return null;
  }
}
