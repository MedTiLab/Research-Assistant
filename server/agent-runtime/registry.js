import { assertAgentRuntime } from './contract.js';

const runtimes = new Map();

export function registerAgentRuntime(name, runtime) {
  assertAgentRuntime(runtime);
  if (name !== runtime.id) {
    const error = new Error(`Agent runtime registration name "${name}" does not match runtime id "${runtime.id}".`);
    error.code = 'AGENT_RUNTIME_ID_MISMATCH';
    throw error;
  }
  if (runtimes.has(name)) {
    const error = new Error(`Agent runtime "${name}" is already registered.`);
    error.code = 'AGENT_RUNTIME_ALREADY_REGISTERED';
    throw error;
  }
  runtimes.set(name, runtime);
}

export function getAgentRuntime(name) {
  return runtimes.get(name) || null;
}

export function getRequiredAgentRuntime(name, { capability } = {}) {
  const runtime = getAgentRuntime(name);
  if (!runtime) {
    const error = new Error(`Agent runtime "${name}" is not registered.`);
    error.code = 'AGENT_RUNTIME_NOT_FOUND';
    error.runtimeId = name || null;
    throw error;
  }
  if (capability && runtime.capabilities?.[capability] !== true) {
    const error = new Error(`Agent runtime "${name}" does not support capability "${capability}".`);
    error.code = 'AGENT_RUNTIME_CAPABILITY_UNSUPPORTED';
    error.runtimeId = name;
    error.capability = capability;
    throw error;
  }
  return runtime;
}

export function hasAgentRuntime(name) {
  return runtimes.has(name);
}

export function listAgentRuntimes() {
  return Array.from(runtimes.keys());
}
