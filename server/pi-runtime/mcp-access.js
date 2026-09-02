import { readServiceState, mutateServiceState, serviceStatePath } from '../agent-runtime/durable-store.js';

export const PI_MCP_ACCESS_PROJECT_KEY = '__medhelp_user_global__';
export const PI_BUILTIN_MCP_PLUGINS = Object.freeze([
  Object.freeze({ id: 'medhelp_workbench', kind: 'builtin', version: 'builtin' }),
  Object.freeze({ id: 'medhelp_compute', kind: 'builtin', version: 'builtin' }),
]);

const SAFE_MCP_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,126}$/;

function accessIdentity(userId) {
  if (userId == null || String(userId).trim() === '') {
    throw new Error('User context is required');
  }
  return {
    ownerKey: String(userId),
    projectKey: PI_MCP_ACCESS_PROJECT_KEY,
  };
}

function normalizeAccessState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return {};
  return Object.fromEntries(Object.entries(state).flatMap(([id, allowed]) => (
    SAFE_MCP_ID.test(id) && typeof allowed === 'boolean' ? [[id, allowed]] : []
  )));
}

export async function readPiMcpAccess({ userId, storageOptions = {} } = {}) {
  const identity = accessIdentity(userId);
  const file = serviceStatePath(identity, 'mcp-access', storageOptions);
  return normalizeAccessState(await readServiceState(file, {}));
}

export async function setPiMcpAccess(id, allowed, { userId, storageOptions = {} } = {}) {
  if (!SAFE_MCP_ID.test(id || '')) throw new Error('Invalid MCP plugin id');
  if (typeof allowed !== 'boolean') throw new Error('allowed must be a boolean');
  const identity = accessIdentity(userId);
  const file = serviceStatePath(identity, 'mcp-access', storageOptions);
  const next = await mutateServiceState(file, (state) => ({
    ...normalizeAccessState(state),
    [id]: allowed,
  }), {});
  return { id, allowed: next[id] === true };
}

export function isPiMcpAllowed(access, id) {
  if (Object.prototype.hasOwnProperty.call(access || {}, id)) return access[id] === true;
  return id === 'medhelp_workbench';
}
