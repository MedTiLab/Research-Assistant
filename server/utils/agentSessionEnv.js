import { mergeAgentRuntimeEnv } from './cloudAgentRuntimeEnv.js';
import { withDatabaseApiAgentEnv } from './databaseApiAgentEnv.js';
import { ensureDatabaseApiConnectionForUser } from './databaseApiConnector.js';
import { resolveGeminiDirectApiConfig, withGeminiDirectApiEnv } from './geminiApiKey.js';
import {
  getLocalSessionAgentRuntimeEnv,
  getLocalSessionUserMemoryContext,
  getLocalSessionUserPreferenceContext,
} from '../routes/localKernel.js';

// Every agent entry point (interactive chat, REST agent, Auto Research) must
// build its runtime environment here. The Codex app-server is pooled per owner
// and torn down whenever the environment fingerprint changes, so two entry
// points that assemble the environment differently would keep replacing each
// other's Codex process mid-turn.
export function buildManagedAgentBaseEnv(userId = null) {
  return withGeminiDirectApiEnv({
    ...process.env,
    MEDHELP_MANAGED_AGENT_SESSION: '1',
  }, resolveGeminiDirectApiConfig(userId));
}

export async function buildManagedAgentSessionContext({
  userId = null,
  localKernelSession = null,
} = {}) {
  const baseEnv = buildManagedAgentBaseEnv(userId);

  if (localKernelSession) {
    const [cloudRuntimeEnv, userPreferenceContext, userMemoryContext] = await Promise.all([
      // Pull account-scoped credentials immediately before each agent turn. In
      // particular, do not reuse a cached empty env after the user has saved or
      // replaced a PAT in Settings.
      getLocalSessionAgentRuntimeEnv(localKernelSession, { force: true }),
      getLocalSessionUserPreferenceContext(localKernelSession, { force: true }),
      getLocalSessionUserMemoryContext(localKernelSession, { force: true }),
    ]);
    return {
      env: mergeAgentRuntimeEnv(baseEnv, cloudRuntimeEnv),
      userPreferenceContext,
      userMemoryContext,
    };
  }

  await ensureDatabaseApiConnectionForUser(userId);
  return {
    env: withDatabaseApiAgentEnv(baseEnv, userId),
    userPreferenceContext: null,
    userMemoryContext: null,
  };
}

export function buildManagedAgentSessionContextForRequest(req) {
  return buildManagedAgentSessionContext({
    userId: req?.user?.id ?? null,
    localKernelSession: req?.localKernelSession || null,
  });
}
