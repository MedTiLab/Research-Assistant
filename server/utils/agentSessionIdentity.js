function normalizeRequiredPart(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function createIdentityError(field) {
  const error = new TypeError(`Agent session identity requires a non-empty ${field}.`);
  error.code = 'AGENT_SESSION_IDENTITY_INVALID';
  error.field = field;
  return error;
}

export function normalizeRuntimeId(value) {
  const normalized = normalizeRequiredPart(value);
  return normalized ? normalized.toLowerCase() : null;
}

export function createAgentSessionIdentity(identity = {}) {
  const ownerKey = normalizeRequiredPart(identity.ownerKey);
  const projectKey = normalizeRequiredPart(identity.projectKey);
  const runtimeId = normalizeRuntimeId(identity.runtimeId ?? identity.provider);
  const sessionId = normalizeRequiredPart(identity.sessionId ?? identity.id);

  if (!ownerKey) throw createIdentityError('ownerKey');
  if (!projectKey) throw createIdentityError('projectKey');
  if (!runtimeId) throw createIdentityError('runtimeId');
  if (!sessionId) throw createIdentityError('sessionId');

  return Object.freeze({ ownerKey, projectKey, runtimeId, sessionId });
}

export function createAgentSessionKey(identity) {
  const normalized = createAgentSessionIdentity(identity);
  return JSON.stringify([
    normalized.ownerKey,
    normalized.projectKey,
    normalized.runtimeId,
    normalized.sessionId,
  ]);
}

export function parseAgentSessionKey(sessionKey) {
  if (typeof sessionKey !== 'string' || !sessionKey.trim()) return null;

  try {
    const parts = JSON.parse(sessionKey);
    if (!Array.isArray(parts) || parts.length !== 4) return null;
    return createAgentSessionIdentity({
      ownerKey: parts[0],
      projectKey: parts[1],
      runtimeId: parts[2],
      sessionId: parts[3],
    });
  } catch {
    return null;
  }
}

export function isTemporaryAgentSessionId(sessionId) {
  const normalized = normalizeRequiredPart(sessionId);
  return Boolean(normalized && (
    normalized.startsWith('new-session-')
    || normalized.startsWith('temp-')
  ));
}

export function promoteAgentSessionIdentity(identity, nextSessionId) {
  const current = createAgentSessionIdentity(identity);
  return createAgentSessionIdentity({
    ...current,
    sessionId: nextSessionId,
  });
}

