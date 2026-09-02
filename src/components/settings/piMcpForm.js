export const emptyPiMcpForm = () => ({ id: '', url: '', redirectUri: '', enabled: false, scope: 'user', projectKey: '' });

// Accept common copied MCP JSON, but never silently discard credentials or turn
// a pasted shell command into an executable integration.
export function parsePiMcpJson(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('invalidJson'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalidJson');
  let id = parsed.id || parsed.name || '';
  if (parsed.mcpServers) {
    const entries = Object.entries(parsed.mcpServers);
    if (entries.length !== 1) throw new Error('oneServer');
    [id, parsed] = entries[0];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalidJson');
  if (parsed.command || parsed.type === 'stdio') throw new Error('useBundle');
  if (parsed.type && parsed.type !== 'http' && parsed.type !== 'streamable-http') throw new Error('httpOnly');
  if (parsed.headers || parsed.env || parsed.auth || parsed.apiKey) throw new Error('unsupportedCredentials');
  let url;
  try { url = new URL(parsed.url); } catch { throw new Error('httpsRequired'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('httpsRequired');
  const name = id || url.hostname.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 127);
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,126}$/.test(name)) throw new Error('invalidName');
  if (parsed.enabled !== undefined && typeof parsed.enabled !== 'boolean') throw new Error('invalidJson');
  return { ...emptyPiMcpForm(), id: name, url: url.href, redirectUri: parsed.redirectUri || '', enabled: false };
}
