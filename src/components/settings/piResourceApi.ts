import { authenticatedFetch } from '../../utils/api';

export type PiRequest = (path: string, options?: RequestInit) => Promise<Response>;
export const defaultPiRequest: PiRequest = (path, options) => authenticatedFetch(`/api/pi${path}`, options);
export async function readPiResponse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    throw new Error(payload.details || payload.error?.message || payload.error || `Request failed (${response.status})`);
  }
  return payload;
}
export type PiResources = {
  mcpEnabled: boolean;
  bundles: { name: string; version: string; allowed: boolean }[];
  mcpPlugins: { id: string; version: string; kind: 'builtin' | 'bundle'; allowed: boolean }[];
  nativeExtensions: { supported: boolean; packagesLoaded: boolean; globalConfigLoaded: boolean };
  diagnostics: { mcp: { name?: string; code: string }[] };
};
