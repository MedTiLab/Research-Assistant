import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
let tempRoot = null;
let database = null;

afterEach(async () => {
  vi.unstubAllGlobals();
  if (database?.db?.open) database.db.close();
  database = null;
  vi.resetModules();
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
  if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

async function setupEntitlements() {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-codex-plan-'));
  process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  vi.resetModules();
  database = await import('../database/db.js');
  await database.initializeDatabase();
  return import('../utils/entitlements.js');
}

describe('Agent plan entitlements', () => {
  it('allows only Pi Agent on Free and all agents on Pro', async () => {
    const { authorize } = await setupEntitlements();
    const freeUser = database.userDb.createUser('free-codex-user', 'unused');
    const proUser = database.userDb.createUser('pro-codex-user', 'unused');
    database.userDb.updateMembershipPlan(proUser.id, 'pro');

    expect(authorize(freeUser.id, 'agent.codex')).toMatchObject({
      allowed: false,
      code: 'CAPABILITY_DENIED',
      plan: 'free',
    });
    expect(authorize(proUser.id, 'agent.codex')).toMatchObject({
      allowed: true,
      plan: 'pro',
    });
    expect(authorize(freeUser.id, 'agent.claude')).toMatchObject({
      allowed: false,
      code: 'CAPABILITY_DENIED',
      plan: 'free',
    });
    expect(authorize(proUser.id, 'agent.claude')).toMatchObject({
      allowed: true,
      plan: 'pro',
    });
    expect(authorize(freeUser.id, 'agent.pi')).toMatchObject({
      allowed: true,
      plan: 'free',
    });
    expect(authorize(proUser.id, 'agent.pi')).toMatchObject({
      allowed: true,
      plan: 'pro',
    });
  });

  it('keeps every premium workspace capability behind Pro', async () => {
    const { authorize, PLAN_CAPABILITIES } = await setupEntitlements();
    const freeUser = database.userDb.createUser('free-workspace-user', 'unused');
    const proUser = database.userDb.createUser('pro-workspace-user', 'unused');
    database.userDb.updateMembershipPlan(proUser.id, 'pro');

    const premiumCapabilities = [
      'workspace.file.reveal',
      'workspace.file.expand',
      'compute.resources',
      'skills.catalog',
      'research.tasks',
      'research.pipeline',
      'literature.monitor',
      'variables.catalog',
      'variables.discovery',
      'memory.persistent',
      'memory.project_summary',
      'conversations.archive',
    ];

    expect(Object.keys(PLAN_CAPABILITIES)).toEqual(['free', 'pro']);
    expect(PLAN_CAPABILITIES.free).toEqual(['agent.pi']);
    for (const capability of premiumCapabilities) {
      expect(authorize(freeUser.id, capability)).toMatchObject({
        allowed: false,
        code: 'CAPABILITY_DENIED',
        plan: 'free',
      });
      expect(authorize(proUser.id, capability)).toMatchObject({
        allowed: true,
        plan: 'pro',
      });
    }
  });

  it('keeps an active Free trial on Free capabilities', async () => {
    const { authorize, getEffectivePlan } = await setupEntitlements();
    const trialUser = database.userDb.createUser('trial-workspace-user', 'unused');
    const updatedTrialUser = database.userDb.updateTrial(trialUser.id, {
      trialStartedAt: new Date().toISOString(),
      trialExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    expect(getEffectivePlan(updatedTrialUser)).toBe('free');
    expect(authorize(trialUser.id, 'research.pipeline')).toMatchObject({
      allowed: false,
      code: 'CAPABILITY_DENIED',
      plan: 'free',
    });
  });

  it('automatically returns an expired Pro membership to Free capabilities', async () => {
    const { authorize, getEffectivePlan } = await setupEntitlements();
    const expiredUser = database.userDb.createUser('expired-pro-user', 'unused');
    const activeUser = database.userDb.createUser('active-pro-user', 'unused');
    const expiredPro = database.userDb.updateMembershipPlan(
      expiredUser.id,
      'pro',
      new Date(Date.now() - 60_000).toISOString(),
    );
    const activePro = database.userDb.updateMembershipPlan(
      activeUser.id,
      'pro',
      new Date(Date.now() + 60_000).toISOString(),
    );

    expect(getEffectivePlan(expiredPro)).toBe('free');
    expect(authorize(expiredUser.id, 'skills.catalog')).toMatchObject({
      allowed: false,
      plan: 'free',
    });
    expect(getEffectivePlan(activePro)).toBe('pro');
    expect(authorize(activeUser.id, 'skills.catalog')).toMatchObject({
      allowed: true,
      plan: 'pro',
    });
  });

  it('checks the cloud account before a local Kernel Codex turn', async () => {
    const { authorizeCloudCapability } = await import('../utils/cloudAgentRuntimeEnv.js');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: 'Membership plan does not include this capability',
        code: 'CAPABILITY_DENIED',
        plan: 'free',
      }), { status: 403, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        capability: 'agent.codex',
        plan: 'pro',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const session = {
      cloudAccessToken: 'cloud-access-token',
      cloudBaseUrl: 'https://app.medtimehelp.com',
    };
    await expect(authorizeCloudCapability(session, 'agent.codex')).resolves.toMatchObject({
      allowed: false,
      code: 'CAPABILITY_DENIED',
    });
    await expect(authorizeCloudCapability(session, 'agent.codex')).resolves.toMatchObject({
      allowed: true,
      plan: 'pro',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.medtimehelp.com/api/gateway/authorize',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer cloud-access-token' }),
      }),
    );
  });
});
