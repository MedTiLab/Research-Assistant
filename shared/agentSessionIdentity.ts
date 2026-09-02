export type RuntimeId = 'claude' | 'codex' | 'pi';

export interface AgentSessionIdentity {
  ownerKey: string;
  projectKey: string;
  runtimeId: RuntimeId;
  sessionId: string;
}

export type AgentSessionKey = string & { readonly __agentSessionKey: unique symbol };

type AgentSessionIdentityInput = {
  ownerKey?: unknown;
  projectKey?: unknown;
  provider?: unknown;
  id?: unknown;
  runtimeId?: unknown;
  sessionId?: unknown;
};

const normalizeRequiredPart = (value: unknown): string | null => (
  typeof value === 'string' && value.trim() ? value.trim() : null
);

const createIdentityError = (field: keyof AgentSessionIdentity): TypeError => {
  const error = new TypeError(`Agent session identity requires a non-empty ${field}.`);
  Object.assign(error, { code: 'AGENT_SESSION_IDENTITY_INVALID', field });
  return error;
};

export const normalizeRuntimeId = (value: unknown): RuntimeId | null => {
  const normalized = normalizeRequiredPart(value)?.toLowerCase();
  return normalized === 'claude' || normalized === 'codex' || normalized === 'pi'
    ? normalized
    : null;
};

export const createAgentSessionIdentity = (
  identity: AgentSessionIdentityInput,
): AgentSessionIdentity => {
  const ownerKey = normalizeRequiredPart(identity.ownerKey);
  const projectKey = normalizeRequiredPart(identity.projectKey);
  const runtimeId = normalizeRuntimeId(identity.runtimeId ?? identity.provider);
  const sessionId = normalizeRequiredPart(identity.sessionId ?? identity.id);

  if (!ownerKey) throw createIdentityError('ownerKey');
  if (!projectKey) throw createIdentityError('projectKey');
  if (!runtimeId) throw createIdentityError('runtimeId');
  if (!sessionId) throw createIdentityError('sessionId');

  return { ownerKey, projectKey, runtimeId, sessionId };
};

export const createAgentSessionKey = (identity: AgentSessionIdentityInput): AgentSessionKey => {
  const normalized = createAgentSessionIdentity(identity);
  return JSON.stringify([
    normalized.ownerKey,
    normalized.projectKey,
    normalized.runtimeId,
    normalized.sessionId,
  ]) as AgentSessionKey;
};

export const parseAgentSessionKey = (sessionKey: unknown): AgentSessionIdentity | null => {
  if (typeof sessionKey !== 'string' || !sessionKey.trim()) return null;

  try {
    const parts: unknown = JSON.parse(sessionKey);
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
};

export const isTemporaryAgentSessionId = (sessionId: unknown): boolean => {
  const normalized = normalizeRequiredPart(sessionId);
  return Boolean(normalized && (
    normalized.startsWith('new-session-')
    || normalized.startsWith('temp-')
  ));
};

export const promoteAgentSessionIdentity = (
  identity: AgentSessionIdentityInput,
  nextSessionId: unknown,
): AgentSessionIdentity => createAgentSessionIdentity({
  ...createAgentSessionIdentity(identity),
  sessionId: nextSessionId,
});
