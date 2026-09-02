import fs from 'node:fs';

import { describe, expect, it } from 'vitest';

const onlineMain = fs.readFileSync(new URL('../online/main.mjs', import.meta.url), 'utf8');
const legacyMain = fs.readFileSync(new URL('../legacy/main.mjs', import.meta.url), 'utf8');
const serverMain = fs.readFileSync(new URL('../../server/index.js', import.meta.url), 'utf8');
const autoResearchMain = fs.readFileSync(new URL('../../server/routes/auto-research.js', import.meta.url), 'utf8');
const agentRouteMain = fs.readFileSync(new URL('../../server/routes/agent.js', import.meta.url), 'utf8');
const executionMemoryNormalize = fs.readFileSync(new URL('../../server/execution-memory/normalize.js', import.meta.url), 'utf8');
const runtimeLifecycle = fs.readFileSync(new URL('../../server/agent-runtime/lifecycle-coordinator.js', import.meta.url), 'utf8');

describe('desktop reliability wiring', () => {
  it.each([
    ['online/offline', onlineMain],
    ['legacy', legacyMain],
  ])('handles native Renderer failures and system resume in %s Desktop', (_name, source) => {
    expect(source).toContain("webContents.on('render-process-gone'");
    expect(source).toContain("webContents.on('did-fail-load'");
    expect(source).toContain("mainWindow.on('unresponsive'");
    expect(source).toContain('backgroundThrottling: false');
    expect(source).toContain("powerMonitor.on('resume'");
    expect(source).toContain("powerSaveBlocker.start('prevent-app-suspension')");
  });

  it('loads the modern AppShell after a bounded boot deadline without a Kernel endpoint', () => {
    expect(onlineMain).toContain('APP_SHELL_FAIL_OPEN_MS = 20_000');
    expect(onlineMain).toContain("failOpenToDesktopApp('boot-deadline-exceeded')");
    expect(onlineMain).toContain('return await navigateToDesktopApp(null)');
    expect(onlineMain).toContain("url.searchParams.set('desktopRuntimeLimited', limited ? '1' : '0')");
  });

  it('uses the product package version for development Kernel verification', () => {
    expect(onlineMain).toContain("fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')");
    expect(onlineMain).toContain('const DESKTOP_APP_VERSION = resolveDesktopAppVersion()');
    expect(onlineMain).toContain('manifest.version !== DESKTOP_APP_VERSION');
  });

  it('does not block packaged startup on the user login shell', () => {
    expect(onlineMain).toContain("MEDHELP_DISABLE_LOGIN_SHELL_ENV_IMPORT: '1'");
  });

  it('counts Claude, Codex, local GPU, and PTY work as restart blockers', () => {
    expect(serverMain).toContain('hasActiveAgentRuntimeSessions()');
    expect(runtimeLifecycle).toContain('listAgentRuntimes().some((runtimeId) =>');
    expect(serverMain).toContain('getActiveLocalGPUSessions().length > 0');
    expect(serverMain).toContain('ptySessionsMap.size > 0');
  });

  it('settles synchronous and asynchronous runtime aborts through the generic coordinator', () => {
    expect(serverMain).toContain('await abortAllAgentRuntimeSessions()');
    expect(runtimeLifecycle).toContain('abortTasks.push(Promise.resolve(record.runtime.abort(record.runtimeSessionKey)))');
    expect(runtimeLifecycle).toContain('abortTasks.push(Promise.resolve(runtime.abort(sessionId)))');
    expect(runtimeLifecycle).toContain('return Promise.allSettled(abortTasks)');
  });

  it('routes shared session status reads through adapters without moving local GPU into the registry', () => {
    expect(serverMain).toContain('...getActiveAgentRuntimeSessions()');
    expect(serverMain).toContain('local: getActiveLocalGPUSessions()');
    expect(serverMain).toContain('const status = getAgentRuntimeSessionStatus(identity)');
    expect(runtimeLifecycle).toContain('Boolean(runtime.isActive(runtimeSessionId))');
    expect(runtimeLifecycle).toContain('runtime.getStartTime(runtimeSessionId)');
    expect(serverMain).toContain('isActive = isLocalGPUSessionActive(sessionId)');
    expect(serverMain).toContain('startTime = getLocalGPUSessionStartTime(sessionId)');
  });

  it('keeps shared activity ordering and active-session delete protection intact', () => {
    expect(serverMain).toContain('return getAgentRuntimeSessionStatus(identity).isActive');
    expect(serverMain).toContain('createSessionManagementRouter({');
    expect(serverMain).toContain('getSessionStatus: getAgentRuntimeSessionStatus,');
    expect(serverMain.indexOf('createSessionManagementRouter({')).toBeLessThan(
      serverMain.indexOf("app.get('/api/projects/:projectName/sessions'"),
    );
  });

  it('routes shared abort controls through adapters without flattening provider semantics', () => {
    expect(serverMain).toContain('return abortAgentRuntimeSession(identity)');
    expect(serverMain).toContain('return Promise.resolve(abortLocalGPUSession(identity.sessionId))');
    expect(serverMain).toContain('success = await abortInteractiveSession(identity)');
    expect(runtimeLifecycle).toContain('return Boolean(await runtime.abort(runtimeSessionIdForTarget(target)))');
    expect(serverMain).toContain('await abortAgentRuntimeSession(identity)');
    expect(serverMain).toContain('await runtimeSessionStoreRegistry.require(identity.runtimeId).delete(identity, { provider })');
  });

  it('dispatches shared live steering through the selected runtime adapter', () => {
    expect(serverMain).toContain('const result = await steerAgentRuntimeSession(steerIdentity, steerCommand)');
    expect(serverMain).toContain('pending: result.pending === true');
    expect(serverMain).toContain("type: 'agent-turn-steered'");
    expect(serverMain).toContain("type: 'agent-turn-steer-error'");
  });

  it('starts Auto Research tasks through the normalized runtime adapter', () => {
    expect(autoResearchMain).toContain("const runtimeId = 'pi'");
    expect(autoResearchMain).toContain('const agentPromise = executeAgentTurn({');
    expect(autoResearchMain).not.toContain("from '../claude-sdk.js'");
    expect(autoResearchMain).not.toContain("from '../openai-codex.js'");
  });

  it('starts interactive Claude and Codex turns through the generic coordinator', () => {
    expect(serverMain).toContain('executeAgentTurn({');
    expect(serverMain).toContain("...enforceConsultationOptions('claude', data.options)");
    expect(serverMain).toContain("...enforceConsultationOptions('codex', data.options)");
    expect(serverMain).toContain("data.type === 'agent-command' && commandRuntimeId === 'claude'");
    expect(serverMain).toContain("data.type === 'agent-command' && commandRuntimeId === 'codex'");
  });

  it('routes external agent execution through the generic coordinator', () => {
    expect(agentRouteMain).toContain('await executeAgentTurn({');
    expect(agentRouteMain).toContain('runtimeId: provider');
    expect(agentRouteMain).toContain("model: provider === 'codex' ? model || CODEX_MODELS.DEFAULT : model");
    expect(agentRouteMain).not.toContain("from '../claude-sdk.js'");
    expect(agentRouteMain).not.toContain("from '../openai-codex.js'");
  });

  it('keeps external project cleanup provider-aware', () => {
    expect(agentRouteMain).toContain('export async function cleanupProject({');
    expect(agentRouteMain).toContain("if (provider === 'claude' && sessionId)");
    expect(agentRouteMain).toContain("else if (provider === 'codex' && sessionId)");
    expect(agentRouteMain).toContain('provider,\n          sessionId: sessionIdForCleanup,');
    expect(agentRouteMain).not.toContain("path.join(os.homedir(), '.codex', 'sessions'");
  });

  it('routes generic consumers through runtime observations', () => {
    expect(agentRouteMain).toContain('getNormalizedAssistantMessages()');
    expect(agentRouteMain).toContain('normalizedMessages: normalizedAssistantMessages');
    expect(agentRouteMain).toContain('normalizeRuntimeObservations(msg, { provider: this.provider })');
    expect(executionMemoryNormalize).toContain("from '../agent-runtime/observations/index.js'");
    expect(executionMemoryNormalize).not.toContain("payload.type === 'claude-response'");
    expect(executionMemoryNormalize).not.toContain("payload.type === 'codex-response'");
    expect(executionMemoryNormalize).toContain('signal.findings = extractStatFindings(observation.text)');
  });

  it('keeps the shared server behind the runtime access boundary', () => {
    expect(serverMain).toContain("} from './agent-runtime/index.js'");
    expect(serverMain).toContain('getRequiredAgentRuntime,');
    expect(serverMain).toContain('getAgentRuntimeSessionStatus,');
    expect(serverMain).not.toContain("from './claude-sdk.js'");
    expect(serverMain).not.toContain("from './openai-codex.js'");
    expect(serverMain).toContain('claudeRuntime.native.resolveToolApproval(data.requestId, {');
    expect(serverMain).toContain('codexRuntime.native.isPlaceholderSessionId(sessionId)');
    expect(serverMain).toContain('await shutdownAgentRuntimes()');
  });
});
