import { userDb } from '../database/db.js';
import { authorizeCloudCapability } from './cloudAgentRuntimeEnv.js';

const PLAN_CAPABILITIES = {
  free: [
    'agent.pi',
  ],
  pro: [
    'data.extract',
    'data.export',
    'model.cloud.call',
    'sync.push',
    'share.create',
    'agent.pi',
    'agent.claude',
    'agent.codex',
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
  ],
};

const KNOWN_CAPABILITIES = new Set(Object.values(PLAN_CAPABILITIES).flat());

function normalizePlan(plan) {
  const normalized = String(plan || 'free').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PLAN_CAPABILITIES, normalized)
    ? normalized
    : 'free';
}

function normalizeCapability(capability) {
  return String(capability || '').trim().toLowerCase();
}

function getEffectivePlan(user) {
  const plan = normalizePlan(user?.membership_plan);
  if (plan !== 'pro' || !user?.membership_expires_at) {
    return plan;
  }

  const rawExpiry = String(user.membership_expires_at).trim();
  const normalizedExpiry = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(rawExpiry)
    ? `${rawExpiry.replace(' ', 'T')}Z`
    : rawExpiry;
  const expiryMs = Date.parse(normalizedExpiry);
  return Number.isFinite(expiryMs) && expiryMs > Date.now() ? 'pro' : 'free';
}

function denied({ code, status = 403, reason, capability, plan = null }) {
  return {
    allowed: false,
    code,
    status,
    reason,
    capability,
    plan,
  };
}

function allowed({ capability, plan }) {
  return {
    allowed: true,
    code: 'ALLOWED',
    status: 200,
    reason: 'Capability allowed',
    capability,
    plan,
  };
}

function sameOwner(userId, resourceOwnerId) {
  if (resourceOwnerId === undefined || resourceOwnerId === null || resourceOwnerId === '') {
    return true;
  }
  return String(userId) === String(resourceOwnerId);
}

function authorize(userId, capability, context = {}) {
  const normalizedCapability = normalizeCapability(capability);
  if (!normalizedCapability || !KNOWN_CAPABILITIES.has(normalizedCapability)) {
    return denied({
      code: 'UNKNOWN_CAPABILITY',
      reason: 'Capability is not recognized',
      capability: normalizedCapability || null,
    });
  }

  const user = userDb.getUserById(userId);
  if (!user) {
    return denied({
      code: 'USER_NOT_FOUND',
      status: 401,
      reason: 'User not found or inactive',
      capability: normalizedCapability,
    });
  }

  if (!sameOwner(user.id, context.resourceOwnerId)) {
    return denied({
      code: 'TENANT_FORBIDDEN',
      reason: 'Resource belongs to a different user',
      capability: normalizedCapability,
      plan: getEffectivePlan(user),
    });
  }

  const plan = getEffectivePlan(user);
  const capabilities = new Set(PLAN_CAPABILITIES[plan] || []);
  if (!capabilities.has(normalizedCapability)) {
    return denied({
      code: 'CAPABILITY_DENIED',
      reason: 'Membership plan does not include this capability',
      capability: normalizedCapability,
      plan,
    });
  }

  return allowed({ capability: normalizedCapability, plan });
}

function requireCapability(capability, contextBuilder = null) {
  return async (req, res, next) => {
    try {
      const context = typeof contextBuilder === 'function' ? contextBuilder(req) : {};
      const decision = req.localKernelSession
        ? await authorizeCloudCapability(req.localKernelSession, capability)
        : authorize(req.user?.id, capability, context);
      if (!decision.allowed) {
        return res.status(decision.status).json({
          error: decision.reason,
          code: decision.code,
          capability: decision.capability,
          plan: decision.plan,
        });
      }
      req.entitlement = decision;
      return next();
    } catch (error) {
      console.error('[entitlements] Capability check failed:', error.message);
      return res.status(503).json({
        error: 'Unable to verify feature access',
        code: 'ENTITLEMENT_CHECK_FAILED',
        capability,
        plan: null,
      });
    }
  };
}

function getPlanCapabilities(plan) {
  const normalizedPlan = normalizePlan(plan);
  return [...(PLAN_CAPABILITIES[normalizedPlan] || [])];
}

export {
  authorize,
  getEffectivePlan,
  getPlanCapabilities,
  requireCapability,
  KNOWN_CAPABILITIES,
  PLAN_CAPABILITIES,
};
