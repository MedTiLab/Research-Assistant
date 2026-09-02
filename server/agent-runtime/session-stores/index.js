import {
  deleteCodexSession,
  deleteSession,
  extractProjectDirectory,
  getCodexSessionMessages,
  getCodexSessions,
  reconcileCodexSessionIndex,
  renameSession,
  restoreSession,
  trashSession,
} from '../../projects.js';
import { getMedHelpCodexSessionRoots } from '../../utils/codexHome.js';
import { createRuntimeSessionStoreRegistry } from '../session-store-registry.js';
import { CodexSessionStore } from './codex-session-store.js';
import { PiSessionStore } from './pi-session-store.js';
import { createPiHostSessionStore } from '../../pi-runtime/session-store.js';
import { sessionDb } from '../../database/db.js';
import { codexForkPoints } from '../../utils/sessionForking.js';

function ownerKeyToUserId(ownerKey) {
  const normalized = typeof ownerKey === 'string' ? ownerKey.trim() : '';
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizeTranscriptResult(result) {
  if (Array.isArray(result)) return { messages: result, tokenUsage: null };
  return result && typeof result === 'object'
    ? result
    : { messages: [], tokenUsage: null };
}

const codexSessionStore = new CodexSessionStore({
  list: async (projectIdentity, options = {}) => {
    const projectPath = options.projectPath || await extractProjectDirectory(projectIdentity.projectKey);
    if (!projectPath) return [];
    return getCodexSessions(projectPath, {
      limit: options.limit ?? 0,
      projectName: projectIdentity.projectKey,
    });
  },
  read: async (identity, options = {}) => normalizeTranscriptResult(await getCodexSessionMessages(
    identity.sessionId,
    options.limit ?? null,
    options.offset ?? 0,
  )),
  forkPoints: async (identity, options = {}) => {
    const { readCodexSessionThread } = await import('../../openai-codex.js');
    return codexForkPoints(await readCodexSessionThread(
      identity.sessionId,
      { userId: options.userId },
    ));
  },
  fork: async (identity, input, options = {}) => {
    const { forkCodexSession } = await import('../../openai-codex.js');
    return forkCodexSession(identity.sessionId, {
      pointId: input.pointId,
      userId: options.userId,
    });
  },
  rename: async (identity, title) => renameSession(
    identity.projectKey,
    identity.sessionId,
    title,
    'codex',
    ownerKeyToUserId(identity.ownerKey),
  ),
  trash: async (identity, options = {}) => trashSession(
    identity.projectKey,
    identity.sessionId,
    'codex',
    ownerKeyToUserId(identity.ownerKey),
    { ...options, ownerKey: identity.ownerKey },
  ),
  restore: async (identity, options = {}) => restoreSession(
    identity.projectKey,
    identity.sessionId,
    ownerKeyToUserId(identity.ownerKey),
    'codex',
    { ...options, ownerKey: identity.ownerKey },
  ),
  delete: async (identity) => deleteCodexSession(identity.sessionId, {
    projectName: identity.projectKey,
    ownerKey: identity.ownerKey,
  }),
  getUsage: async (identity) => {
    const transcript = normalizeTranscriptResult(await getCodexSessionMessages(identity.sessionId, null, 0));
    return transcript.tokenUsage || null;
  },
  reconcile: async (identity, options = {}) => {
    const projectPath = options.projectPath || await extractProjectDirectory(identity.projectKey);
    if (!projectPath) return null;
    return reconcileCodexSessionIndex(projectPath, {
      sessionId: identity.sessionId,
      projectName: identity.projectKey,
    });
  },
  watchRoots: () => getMedHelpCodexSessionRoots(),
});

const piSessionStore = createPiHostSessionStore({
  resolveProjectRoot: (identity) => extractProjectDirectory(identity.projectKey),
  forkPoints: async (identity, options = {}) => {
    const { piRuntime } = await import('../pi-runtime.js');
    return piRuntime.native.forkPoints(identity, options);
  },
  fork: async (identity, input, options = {}) => {
    const { piRuntime } = await import('../pi-runtime.js');
    return piRuntime.native.forkSession(identity, input, options);
  },
  rename: (identity, title) => sessionDb.updateSessionName(identity.sessionId, title, {
    projectName: identity.projectKey,
    runtimeId: 'pi',
    ownerKey: identity.ownerKey,
  }),
  trash: (identity, options = {}) => trashSession(
    identity.projectKey,
    identity.sessionId,
    'pi',
    ownerKeyToUserId(identity.ownerKey),
    { ...options, ownerKey: identity.ownerKey },
  ),
  restore: (identity, options = {}) => restoreSession(
    identity.projectKey,
    identity.sessionId,
    ownerKeyToUserId(identity.ownerKey),
    'pi',
    { ...options, ownerKey: identity.ownerKey },
  ),
  afterDelete: (identity) => sessionDb.deleteSession(identity.sessionId, {
    projectName: identity.projectKey,
    runtimeId: 'pi',
    ownerKey: identity.ownerKey,
  }),
});

export const runtimeSessionStoreRegistry = createRuntimeSessionStoreRegistry([
  piSessionStore,
]);

export {
  CodexSessionStore,
  PiSessionStore,
  codexSessionStore,
  piSessionStore,
};
