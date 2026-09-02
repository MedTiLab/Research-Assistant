import crypto from 'node:crypto';
import { readServiceState, mutateServiceState, serviceStatePath } from './durable-store.js';
import { PI_PERMISSION_PRESETS } from '../../shared/piPermissionPresets.js';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
// Remember exact tool + input only, never a model-supplied wildcard. No plaintext secrets on disk.
function fingerprint(tool, input) {
  return crypto.createHash('sha256').update(JSON.stringify([tool, stable(input)])).digest('hex');
}
const neverRemember = new Set(['ask_user', 'exit_plan_mode', 'automation_create', 'automation_update', 'mcp_authorize']);
const presetsById = new Map(PI_PERMISSION_PRESETS.map((preset) => [preset.id, preset]));

function matchesPreset(rule, tool, input) {
  const preset = presetsById.get(rule.presetId);
  // Runtime policy still validates the call before checking remembered permissions.
  // A timeout changes how long we wait, not the command being authorized.
  return preset && rule.tool === 'bash' && tool === 'bash'
    && input && typeof input === 'object' && !Array.isArray(input)
    && Object.keys(input).every((key) => key === 'command' || key === 'timeout')
    && (input.timeout === undefined || (Number.isFinite(input.timeout) && input.timeout > 0))
    && input.command === preset.command;
}

export async function hasPermissionRule(identity, tool, input, options) {
  if (neverRemember.has(tool)) return false;
  const rules = await readServiceState(serviceStatePath(identity, 'permissions', options));
  const digest = fingerprint(tool, input);
  return rules.some((rule) => rule.fingerprint === digest || matchesPreset(rule, tool, input));
}

export async function addPermissionPresets(identity, presetIds, options) {
  if (!Array.isArray(presetIds) || !presetIds.length || presetIds.length > PI_PERMISSION_PRESETS.length
    || presetIds.some((id) => typeof id !== 'string' || !presetsById.has(id))) {
    throw new Error('Select valid Pi command presets.');
  }
  let addedCount = 0;
  await mutateServiceState(serviceStatePath(identity, 'permissions', options), (rules) => {
    const existing = new Set(rules.filter((rule) => rule.tool === 'bash').map((rule) => rule.presetId));
    const additions = [...new Set(presetIds)].filter((id) => !existing.has(id)).map((presetId) => ({
      id: crypto.randomUUID(), tool: 'bash', presetId, createdAt: new Date().toISOString(),
    }));
    if (rules.length + additions.length > 200) throw new Error('Permission limit reached. Revoke unused rules first.');
    addedCount = additions.length;
    return [...rules, ...additions];
  });
  return { addedCount };
}
export async function rememberPermissionRule(identity, tool, input, options) {
  if (neverRemember.has(tool)) return;
  const digest = fingerprint(tool, input);
  await mutateServiceState(serviceStatePath(identity, 'permissions', options), (rules) => [
    ...rules.filter((rule) => rule.fingerprint !== digest),
    { id: crypto.randomUUID(), tool, fingerprint: digest, createdAt: new Date().toISOString() },
  ].slice(-200));
}
