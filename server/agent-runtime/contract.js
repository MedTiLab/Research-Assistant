const REQUIRED_RUNTIME_METHODS = Object.freeze([
  'start',
  'abort',
  'isActive',
  'getActiveSessions',
  'getStartTime',
]);

function createContractError(message) {
  const error = new TypeError(message);
  error.code = 'AGENT_RUNTIME_INVALID';
  return error;
}

export function assertAgentRuntime(runtime) {
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) {
    throw createContractError('Agent runtime must be an object.');
  }

  if (typeof runtime.id !== 'string' || !runtime.id.trim()) {
    throw createContractError('Agent runtime id must be a non-empty string.');
  }

  if (!runtime.capabilities || typeof runtime.capabilities !== 'object' || Array.isArray(runtime.capabilities)) {
    throw createContractError(`Agent runtime "${runtime.id}" must define capabilities.`);
  }

  if (runtime.capabilities.provider !== runtime.id) {
    throw createContractError(
      `Agent runtime "${runtime.id}" capabilities.provider must match the runtime id.`,
    );
  }

  if (!runtime.native || typeof runtime.native !== 'object' || Array.isArray(runtime.native)) {
    throw createContractError(`Agent runtime "${runtime.id}" must define a native extension object.`);
  }

  for (const methodName of REQUIRED_RUNTIME_METHODS) {
    if (typeof runtime[methodName] !== 'function') {
      throw createContractError(`Agent runtime "${runtime.id}" must implement ${methodName}().`);
    }
  }

  if (runtime.capabilities.sessionResume === true && typeof runtime.resume !== 'function') {
    throw createContractError(`Agent runtime "${runtime.id}" declares sessionResume but does not implement resume().`);
  }

  if (runtime.capabilities.steering === true && typeof runtime.steer !== 'function') {
    throw createContractError(`Agent runtime "${runtime.id}" declares steering but does not implement steer().`);
  }

  return runtime;
}

export { REQUIRED_RUNTIME_METHODS };
