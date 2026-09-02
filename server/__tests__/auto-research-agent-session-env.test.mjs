import { EventEmitter } from 'node:events';
import fs from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildManagedAgentBaseEnv,
  buildManagedAgentSessionContext,
} from '../utils/agentSessionEnv.js';
import { createRequestSerializer } from '../utils/requestSerializer.js';

const autoResearchSource = fs.readFileSync(
  new URL('../routes/auto-research.js', import.meta.url),
  'utf8',
);

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

describe('managed agent session environment', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('marks the turn as a managed MedHelp session', () => {
    expect(buildManagedAgentBaseEnv(null).MEDHELP_MANAGED_AGENT_SESSION).toBe('1');
  });

  it('never hands the live process environment to a runtime', async () => {
    const context = await buildManagedAgentSessionContext({ userId: null });
    expect(context.env).not.toBe(process.env);
    expect(context.env.MEDHELP_MANAGED_AGENT_SESSION).toBe('1');
  });

  // The Codex app-server is pooled per owner and replaced whenever the
  // environment fingerprint changes, so repeated builds must be byte-identical.
  it('produces a stable environment across turns', async () => {
    const first = await buildManagedAgentSessionContext({ userId: null });
    const second = await buildManagedAgentSessionContext({ userId: null });
    expect(JSON.stringify(second.env)).toBe(JSON.stringify(first.env));
  });

  it('refreshes account-scoped credentials for a Local Kernel session', async () => {
    let requestCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (String(url).includes('/api/settings/agent-runtime-env')) {
        requestCount += 1;
        return jsonResponse({
          env: { MEDHELP_DATABASE_API_TOKEN: `token-${requestCount}` },
        });
      }
      return jsonResponse({});
    }));

    const localKernelSession = {
      cloudAccessToken: 'cloud-access-token',
      cloudBaseUrl: 'https://app.medtimehelp.com',
    };

    const first = await buildManagedAgentSessionContext({ userId: 1, localKernelSession });
    expect(first.env.MEDHELP_DATABASE_API_TOKEN).toBe('token-1');
    expect(first.env.MEDHELP_MANAGED_AGENT_SESSION).toBe('1');

    const second = await buildManagedAgentSessionContext({ userId: 1, localKernelSession });
    expect(second.env.MEDHELP_DATABASE_API_TOKEN).toBe('token-2');
  });
});

describe('Auto Research runtime wiring', () => {
  it('builds the managed session environment for executor and verifier turns', () => {
    expect(autoResearchSource).toContain("import { buildManagedAgentSessionContext } from '../utils/agentSessionEnv.js'");
    expect(autoResearchSource).toContain('const resolveAgentSessionContext = () => buildManagedAgentSessionContext({');
    expect(autoResearchSource).toContain('const executorSessionContext = await resolveAgentSessionContext()');
    expect(autoResearchSource).toContain('const verifierSessionContext = await resolveAgentSessionContext()');
    expect(autoResearchSource).toContain('env: executorSessionContext.env');
    expect(autoResearchSource).toContain('env: verifierSessionContext.env');
    expect(autoResearchSource).not.toContain('env: process.env');
  });

  it('mounts the per-project start lock on the start route', () => {
    expect(autoResearchSource).toContain("router.post('/:projectName/start', serializeProjectStarts,");
    expect(autoResearchSource).toContain('const serializeProjectStarts = createRequestSerializer(');
  });

  // reconcileActiveRun treats a queued row without a runtime record as an
  // interrupted run, so registration must precede the bootstrap writes.
  it('registers the runtime record before any bootstrap write', () => {
    const registerIndex = autoResearchSource.indexOf('activeRuns.set(runId, {');
    const bootstrapIndex = autoResearchSource.indexOf('await persistRunBootstrapFiles({');
    const checkpointIndex = autoResearchSource.indexOf('await writeAutoResearchCheckpoint(projectPath, runId, buildAutoResearchCheckpoint({');
    expect(registerIndex).toBeGreaterThan(-1);
    expect(bootstrapIndex).toBeGreaterThan(registerIndex);
    expect(checkpointIndex).toBeGreaterThan(registerIndex);
    expect(autoResearchSource).toContain('} catch (bootstrapError) {');
  });

  it('clears a stale-recovery verdict when the run starts running', () => {
    expect(autoResearchSource).toContain("status: 'running',\n      totalTasks: pipelineState.tasks.length,\n      completedTasks: pipelineState.completedTaskCount,");
    expect(autoResearchSource).toContain('      error: null,\n      finishedAt: null,\n    });');
  });

  it('never leaves the background run as an unhandled rejection', () => {
    expect(autoResearchSource).toContain('runAutoResearch(runId, userId, projectName, projectPath, req.app.locals.wss || null)\n      .catch((error) => {');
  });
});

const serializeProjectStarts = createRequestSerializer(
  (req) => `${req.user?.id ?? 'local'}\u0000${req.params.projectName}`,
);

function createStartRequest(userId, projectName) {
  const res = new EventEmitter();
  res.end = () => res.emit('finish');
  return {
    req: { user: { id: userId }, params: { projectName } },
    res,
  };
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

describe('Auto Research per-project start lock', () => {
  it('holds the lock until the first response completes', async () => {
    const first = createStartRequest(7, 'atlas');
    const second = createStartRequest(7, 'atlas');
    const entered = [];

    serializeProjectStarts(first.req, first.res, () => entered.push('first'));
    await settle();
    expect(entered).toEqual(['first']);

    // The second request must not reach the handler while the first is in
    // flight, otherwise both can pass the active-run check and start a run.
    serializeProjectStarts(second.req, second.res, () => entered.push('second'));
    await settle();
    expect(entered).toEqual(['first']);

    first.res.end();
    await settle();
    expect(entered).toEqual(['first', 'second']);

    second.res.end();
  });

  it('releases the lock when a request is aborted before responding', async () => {
    const first = createStartRequest(7, 'aborted-project');
    const second = createStartRequest(7, 'aborted-project');
    const entered = [];

    serializeProjectStarts(first.req, first.res, () => entered.push('first'));
    await settle();
    serializeProjectStarts(second.req, second.res, () => entered.push('second'));
    await settle();
    expect(entered).toEqual(['first']);

    first.res.emit('close');
    await settle();
    expect(entered).toEqual(['first', 'second']);

    second.res.end();
  });

  it('does not serialize unrelated projects or users', async () => {
    const held = createStartRequest(7, 'project-a');
    const otherProject = createStartRequest(7, 'project-b');
    const otherUser = createStartRequest(8, 'project-a');
    const entered = [];

    serializeProjectStarts(held.req, held.res, () => entered.push('held'));
    serializeProjectStarts(otherProject.req, otherProject.res, () => entered.push('other-project'));
    serializeProjectStarts(otherUser.req, otherUser.res, () => entered.push('other-user'));

    await settle();
    expect(entered.sort()).toEqual(['held', 'other-project', 'other-user']);

    held.res.end();
    otherProject.res.end();
    otherUser.res.end();
  });
});
