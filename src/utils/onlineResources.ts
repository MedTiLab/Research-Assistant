const normalizeOnlinePath = (path: string): string => (
  path.startsWith('/') ? path : `/${path}`
);

export function getOnlineResourceUrl(path: string): string {
  const normalizedPath = normalizeOnlinePath(path);
  if (typeof window === 'undefined') return normalizedPath;

  const cloudOrigin = window.medhelpDesktop?.cloudAppOrigin;
  if (!cloudOrigin) return normalizedPath;

  try {
    return new URL(normalizedPath, cloudOrigin).href;
  } catch {
    return normalizedPath;
  }
}
