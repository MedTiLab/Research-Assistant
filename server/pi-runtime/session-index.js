import { createAgentSessionIdentity } from '../utils/agentSessionIdentity.js';
import { summarizePiSession } from './session-store.js';

export async function syncPiSessionIndex(identity, options = {}) {
  const normalized = createAgentSessionIdentity(identity);
  const sessionDb = options.sessionDb;
  if (!sessionDb?.getSessionByIdentity || !sessionDb?.upsertSessionFromSource) {
    throw new TypeError('syncPiSessionIndex requires a sessionDb adapter.');
  }

  const existing = sessionDb.getSessionByIdentity(normalized);
  const summary = await summarizePiSession(normalized, options.storageOptions || {});
  if (!summary.exists) {
    return existing || null;
  }

  const hasManualDisplayName = existing?.metadata?.displayNameSource === 'manual';
  const displayNameSource = hasManualDisplayName
    ? 'manual'
    : (summary.displayName ? 'user' : (existing?.metadata?.displayNameSource || 'placeholder'));

  return sessionDb.upsertSessionFromSource(
    normalized.sessionId,
    normalized.projectKey,
    'pi',
    {
      ownerKey: normalized.ownerKey,
      runtimeId: 'pi',
      displayName: hasManualDisplayName
        ? existing?.display_name
        : (summary.displayName || undefined),
      lastActivity: summary.lastActivity || new Date().toISOString(),
      messageCount: summary.messageCount,
      modelSelection: options.modelSelection,
      metadata: {
        indexState: 'synced',
        displayNameSource,
      },
    },
  );
}
