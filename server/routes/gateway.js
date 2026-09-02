import express from 'express';
import { gatewayDb } from '../database/db.js';
import { createCooldownRateLimiter } from '../middleware/rate-limit.js';
import {
  authorize,
  getEffectivePlan,
  getPlanCapabilities,
  KNOWN_CAPABILITIES,
} from '../utils/entitlements.js';

const router = express.Router();

const gatewayRateLimiter = createCooldownRateLimiter({
  action: 'gateway-privileged-call',
  windowMs: Number(process.env.GATEWAY_RATE_LIMIT_WINDOW_MS || 60_000),
  max: Number(process.env.GATEWAY_RATE_LIMIT_MAX || 60),
  message: 'Gateway calls are temporarily limited. Please wait before trying again.',
});

const DEFAULT_MONTHLY_QUOTAS = {
  pro: {
    'data.extract': 10000,
    'data.export': 1000,
    'model.cloud.call': 100000,
    'share.create': 10000,
    'sync.push': 10000,
  },
};

const DEFAULT_DEVICE_SOFT_LIMITS = {
  free: 1,
  pro: 5,
};

function envKeyForCapability(prefix, capability, plan) {
  const capabilityKey = String(capability || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const planKey = String(plan || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return `${prefix}_${capabilityKey}_${planKey}`;
}

function parseNonNegativeInteger(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.floor(parsed);
}

function quotaLimitFor(plan, capability) {
  const envSpecific = parseNonNegativeInteger(
    process.env[envKeyForCapability('GATEWAY_QUOTA', capability, plan)],
  );
  if (envSpecific !== null) {
    return envSpecific;
  }

  const envDefault = parseNonNegativeInteger(
    process.env[envKeyForCapability('GATEWAY_QUOTA', capability, 'DEFAULT')],
  );
  if (envDefault !== null) {
    return envDefault;
  }

  const normalizedPlan = String(plan || 'free').trim().toLowerCase();
  const limit = DEFAULT_MONTHLY_QUOTAS[normalizedPlan]?.[capability];
  return Number.isFinite(limit) ? limit : null;
}

function normalizeUnits(value, fallback = 1) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.ceil(parsed);
  }
  return fallback;
}

function getClientIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || null;
}

function getDeviceId(req) {
  return String(req.headers['x-medhelp-device-id'] || req.body?.deviceId || '').trim() || null;
}

function resolveResourceOwnerId(body = {}) {
  return body.resourceOwnerId ?? body.ownerId ?? body.userId ?? null;
}

function auditGatewayCall(req, {
  decision,
  capability,
  status,
  code,
  resourceOwnerId = null,
  source = null,
  units = 0,
  metadata = null,
} = {}) {
  if (!req.user?.id) {
    return null;
  }

  try {
    return gatewayDb.recordUsageEvent({
      userId: req.user.id,
      capability: capability || decision?.capability || 'unknown',
      plan: decision?.plan || getEffectivePlan(req.user),
      status,
      code: code || decision?.code || null,
      resourceOwnerId,
      source,
      units,
      deviceId: getDeviceId(req),
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'] || null,
      metadata,
    });
  } catch (error) {
    console.warn('[gateway] Failed to record usage event:', error.message);
    return null;
  }
}

function quotaSnapshot(userId, capability, plan, units = 1) {
  const limit = quotaLimitFor(plan, capability);
  const periodKey = gatewayDb.periodKey();
  const counter = gatewayDb.getQuotaCounter(userId, capability, periodKey);
  const used = counter?.usedUnits || 0;
  const remaining = limit === null ? null : Math.max(0, limit - used);

  return {
    limit,
    periodKey,
    used,
    remaining,
    requestedUnits: units,
  };
}

function checkQuota(userId, capability, plan, units = 1) {
  const quota = quotaSnapshot(userId, capability, plan, units);
  if (quota.limit === null) {
    return {
      allowed: true,
      ...quota,
    };
  }

  if (quota.used + units > quota.limit) {
    return {
      allowed: false,
      status: 402,
      code: 'QUOTA_EXCEEDED',
      reason: 'Monthly gateway quota exceeded',
      ...quota,
    };
  }

  return {
    allowed: true,
    ...quota,
  };
}

function sendDecision(res, decision) {
  if (decision.allowed) {
    return res.json({
      success: true,
      capability: decision.capability,
      plan: decision.plan,
      quota: decision.quota || undefined,
    });
  }

  return res.status(decision.status).json({
    error: decision.reason,
    code: decision.code,
    capability: decision.capability,
    plan: decision.plan,
    quota: decision.quota || undefined,
  });
}

router.get('/capabilities', (req, res) => {
  const plan = getEffectivePlan(req.user);
  return res.json({
    plan,
    capabilities: getPlanCapabilities(plan),
    knownCapabilities: [...KNOWN_CAPABILITIES].sort(),
  });
});

router.post('/authorize', (req, res) => {
  const resourceOwnerId = resolveResourceOwnerId(req.body);
  const source = req.body?.source || null;
  const decision = authorize(req.user?.id, req.body?.capability, {
    resourceOwnerId,
    source,
  });

  auditGatewayCall(req, {
    decision,
    status: decision.allowed ? 'authorized' : 'denied',
    resourceOwnerId,
    source,
    metadata: { path: '/authorize' },
  });

  return sendDecision(res, decision);
});

router.post('/extract', gatewayRateLimiter, (req, res) => {
  const resourceOwnerId = resolveResourceOwnerId(req.body);
  const source = req.body?.source || null;
  const decision = authorize(req.user?.id, 'data.extract', {
    resourceOwnerId,
    source,
  });

  if (!decision.allowed) {
    auditGatewayCall(req, {
      decision,
      status: 'denied',
      resourceOwnerId,
      source,
      metadata: { path: '/extract' },
    });
    return sendDecision(res, decision);
  }

  const units = normalizeUnits(req.body?.units);
  const quota = checkQuota(req.user.id, decision.capability, decision.plan, units);
  if (!quota.allowed) {
    const quotaDecision = {
      allowed: false,
      status: quota.status,
      code: quota.code,
      reason: quota.reason,
      capability: decision.capability,
      plan: decision.plan,
      quota,
    };
    auditGatewayCall(req, {
      decision: quotaDecision,
      status: 'denied',
      resourceOwnerId,
      source,
      metadata: { path: '/extract', quota },
    });
    return sendDecision(res, quotaDecision);
  }

  auditGatewayCall(req, {
    decision,
    status: 'not_implemented',
    resourceOwnerId,
    source,
    metadata: { path: '/extract', quota },
  });

  return res.status(501).json({
    error: 'Remote extraction engine is not enabled yet',
    code: 'GATEWAY_EXTRACT_NOT_IMPLEMENTED',
    capability: decision.capability,
    plan: decision.plan,
    quota,
  });
});

router.post('/model', gatewayRateLimiter, (req, res) => {
  const decision = authorize(req.user?.id, 'model.cloud.call');
  if (!decision.allowed) {
    auditGatewayCall(req, {
      decision,
      status: 'denied',
      metadata: { path: '/model' },
    });
    return sendDecision(res, decision);
  }

  const units = normalizeUnits(req.body?.units);
  const quota = checkQuota(req.user.id, decision.capability, decision.plan, units);
  if (!quota.allowed) {
    const quotaDecision = {
      allowed: false,
      status: quota.status,
      code: quota.code,
      reason: quota.reason,
      capability: decision.capability,
      plan: decision.plan,
      quota,
    };
    auditGatewayCall(req, {
      decision: quotaDecision,
      status: 'denied',
      metadata: { path: '/model', quota },
    });
    return sendDecision(res, quotaDecision);
  }

  auditGatewayCall(req, {
    decision,
    status: 'not_implemented',
    metadata: { path: '/model', quota },
  });

  return res.status(501).json({
    error: 'Gateway model proxy is not enabled yet',
    code: 'GATEWAY_MODEL_NOT_IMPLEMENTED',
    capability: decision.capability,
    plan: decision.plan,
    quota,
  });
});

router.get('/usage', (req, res) => {
  const events = gatewayDb.listUsageEvents(req.user.id, {
    limit: req.query.limit,
  });
  return res.json({ events });
});

router.get('/quota', (req, res) => {
  const plan = getEffectivePlan(req.user);
  const periodKey = String(req.query.periodKey || gatewayDb.periodKey()).trim() || gatewayDb.periodKey();
  const counters = gatewayDb.listQuotaCounters(req.user.id, { periodKey });
  const counterByCapability = new Map(counters.map((counter) => [counter.capability, counter]));
  const capabilities = getPlanCapabilities(plan);
  const quota = capabilities.map((capability) => {
    const counter = counterByCapability.get(capability);
    const limit = quotaLimitFor(plan, capability);
    const used = counter?.usedUnits || 0;
    return {
      capability,
      plan,
      periodKey,
      limit,
      used,
      remaining: limit === null ? null : Math.max(0, limit - used),
    };
  });

  return res.json({ plan, periodKey, quota });
});

router.get('/devices', (req, res) => {
  const plan = getEffectivePlan(req.user);
  const devices = gatewayDb.listDevices(req.user.id);
  const softLimit = DEFAULT_DEVICE_SOFT_LIMITS[plan] || DEFAULT_DEVICE_SOFT_LIMITS.free;
  return res.json({
    devices,
    softLimit,
    softLimitExceeded: devices.length > softLimit,
  });
});

router.post('/devices/register', (req, res) => {
  try {
    const plan = getEffectivePlan(req.user);
    const device = gatewayDb.registerDevice({
      userId: req.user.id,
      deviceFingerprint: req.body?.deviceFingerprint || req.headers['x-medhelp-device-fingerprint'] || req.headers['x-medhelp-device-id'],
      label: req.body?.label || null,
      userAgent: req.headers['user-agent'] || null,
      ipAddress: getClientIp(req),
    });
    const devices = gatewayDb.listDevices(req.user.id);
    const softLimit = DEFAULT_DEVICE_SOFT_LIMITS[plan] || DEFAULT_DEVICE_SOFT_LIMITS.free;
    return res.json({
      success: true,
      device,
      softLimit,
      softLimitExceeded: devices.length > softLimit,
    });
  } catch (error) {
    return res.status(400).json({
      error: error.message || 'Device registration failed',
      code: 'DEVICE_REGISTRATION_FAILED',
    });
  }
});

export default router;
