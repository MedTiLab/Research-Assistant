import { sessionDb, projectDb } from '../database/db.js';
import { createAgentSessionIdentity } from './agentSessionIdentity.js';
import { resolveRequestUserId } from './userScope.js';

export function sessionOperationError(message, status) {
  return Object.assign(new Error(message), { status });
}

// Local project ownership and the paired cloud account are different namespaces.
// Legacy provider files belong to this device; Pi persistence is account-scoped.
export function resolveApiSessionTarget(req, projectKey, sessionId, requestedProvider = null) {
  const userId = resolveRequestUserId(req);
  if (userId == null) throw sessionOperationError('Authentication required', 401);
  const localKernel = Boolean(req.localKernelSession);
  const project = projectDb.getProjectById(projectKey);
  if (!project) throw sessionOperationError('Project not found', 404);
  if (!localKernel && project?.user_id != null && String(project.user_id) !== String(userId)) {
    throw sessionOperationError('You do not have permission to access this project', 403);
  }
  const provider = requestedProvider || null;
  if (provider && !['claude', 'codex', 'pi', 'openrouter', 'local'].includes(provider)) {
    throw sessionOperationError('Unsupported session provider', 400);
  }
  const runtimeId = provider === 'openrouter' || provider === 'local' ? 'claude' : provider;
  const matches = sessionDb.getSessionsByProject(projectKey).filter((row) => (
    row.id === sessionId
    && (!runtimeId || row.runtimeId === runtimeId)
    && (localKernel && row.runtimeId !== 'pi' || row.ownerKey === String(userId))
  ));
  if (matches.length > 1) {
    throw sessionOperationError('Multiple sessions match; specify the session provider', 409);
  }
  const indexedSession = matches[0] || null;
  const resolvedProvider = provider || indexedSession?.provider || 'claude';
  const identity = createAgentSessionIdentity({
    ownerKey: indexedSession?.ownerKey ?? (localKernel && resolvedProvider !== 'pi'
      ? String(project?.user_id ?? 'local') : String(userId)),
    projectKey,
    runtimeId: indexedSession?.runtimeId || runtimeId || 'claude',
    sessionId,
  });
  return {
    identity, indexedSession, project,
    options: { provider: resolvedProvider, projectUserId: localKernel ? null : userId },
  };
}
