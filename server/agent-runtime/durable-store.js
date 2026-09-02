import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { resolveAppDataRoot } from '../utils/storagePaths.js';

const queues = new Map();
export const scopeHash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32);
export function serviceStatePath(identity, kind, options = {}) {
  if (!/^[a-z-]+$/.test(kind) || !identity?.ownerKey || !identity?.projectKey) throw new Error('Service state requires an owner and project');
  return path.join(resolveAppDataRoot(options), 'agent-services', scopeHash(identity.ownerKey), scopeHash(identity.projectKey), `${kind}.json`);
}
export async function readServiceState(file, fallback = []) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return structuredClone(fallback); throw error; }
}
export function mutateServiceState(file, mutate, fallback = []) {
  const operation = (queues.get(file) || Promise.resolve()).then(async () => {
    const state = await readServiceState(file, fallback);
    const next = await mutate(state) ?? state;
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(next), { mode: 0o600 });
    await fs.rename(temp, file);
    return next;
  });
  const settled = operation.then(() => undefined, () => undefined);
  queues.set(file, settled);
  settled.finally(() => { if (queues.get(file) === settled) queues.delete(file); });
  return operation;
}
