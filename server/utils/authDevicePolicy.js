import { appSettingsDb, authSessionDb } from '../database/db.js';
import { getEffectivePlan } from './entitlements.js';
import { timestampToMilliseconds } from './accountAccess.js';
import { isWebShellOnlyMode } from './webShellMode.js';

export const DEVICE_POLICY_SETTING_KEYS = {
  freeDeviceLimit: 'auth_device_limit_free',
  proDeviceLimit: 'auth_device_limit_pro',
  freeOverflowPolicy: 'auth_device_overflow_free',
  proOverflowPolicy: 'auth_device_overflow_pro',
};
export const DEVICE_OVERFLOW_POLICIES = new Set(['reject', 'evict-oldest']);

export function getDevicePlans() {
  const readLimit = (key, fallback) => {
    const parsed = Number.parseInt(appSettingsDb.get(key) ?? String(fallback), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  const readOverflowPolicy = (key) => {
    const value = String(appSettingsDb.get(key) || '').trim();
    return DEVICE_OVERFLOW_POLICIES.has(value) ? value : 'reject';
  };
  return {
    free: {
      maxDevices: readLimit(DEVICE_POLICY_SETTING_KEYS.freeDeviceLimit, 1),
      overflowPolicy: readOverflowPolicy(DEVICE_POLICY_SETTING_KEYS.freeOverflowPolicy),
    },
    pro: {
      maxDevices: readLimit(DEVICE_POLICY_SETTING_KEYS.proDeviceLimit, 0),
      overflowPolicy: readOverflowPolicy(DEVICE_POLICY_SETTING_KEYS.proOverflowPolicy),
    },
  };
}

export function getEffectiveDevicePolicy(user) {
  const plan = getEffectivePlan(user);
  const planPolicy = getDevicePlans()[plan];
  const override = Number(user?.device_limit_override);
  const configuredLimit = user?.device_limit_override == null || !Number.isFinite(override) || override < 0
    ? planPolicy.maxDevices
    : override;
  return {
    plan,
    maxDevices: configuredLimit === 0 ? null : Math.max(1, Math.floor(configuredLimit)),
    overflowPolicy: DEVICE_OVERFLOW_POLICIES.has(user?.device_overflow_policy)
      ? user.device_overflow_policy
      : planPolicy.overflowPolicy,
  };
}

export function closeDeviceSessions(wss, sessionIds, reason = 'device-session-revoked') {
  const targets = new Set((sessionIds || []).map(String));
  if (targets.size === 0) return;
  for (const client of wss?.clients || []) {
    if (client?.authSessionId && targets.has(String(client.authSessionId))) {
      client.close(4001, reason);
    }
  }
}

export function enforceCurrentDeviceLimit(user, wss) {
  const policy = getEffectiveDevicePolicy(user);
  const sessions = authSessionDb.listCountedActiveForUser(user.id);
  if (policy.maxDevices == null || sessions.length <= policy.maxDevices) return [];

  const ordered = [...sessions].sort((left, right) =>
    (timestampToMilliseconds(left.createdAt) || 0) - (timestampToMilliseconds(right.createdAt) || 0)
      || left.registrationOrder - right.registrationOrder
      || String(left.id).localeCompare(String(right.id)));
  const sessionsToRevoke = policy.overflowPolicy === 'evict-oldest'
    ? ordered.slice(0, ordered.length - policy.maxDevices)
    : ordered.slice(policy.maxDevices);
  const revokedIds = sessionsToRevoke.flatMap((session) =>
    authSessionDb.revokeDevice(session.id, user.id, 'device-limit-changed')?.revokedSessionIds || []);
  closeDeviceSessions(wss, revokedIds, 'device-limit-changed');
  return revokedIds;
}

// Allocate only when authorizing an execution backend: an explicit Kernel
// authorization, or access to a server that itself runs the local workload.
export function activateDeviceSession(user, sessionId, wss) {
  if (!authSessionDb.getActiveById(sessionId, user.id)) {
    const error = new Error('Active authentication session not found');
    error.code = 'AUTH_SESSION_NOT_FOUND';
    throw error;
  }
  enforceCurrentDeviceLimit(user, wss);
  const policy = getEffectiveDevicePolicy(user);
  const activated = authSessionDb.activateForDeviceLimit({
    sessionId,
    userId: user.id,
    maxDevices: policy.maxDevices,
    overflowPolicy: policy.overflowPolicy,
  });
  closeDeviceSessions(wss, activated.revokedSessionIds, 'device-limit-evicted');
  return { ...activated, policy };
}

export function requireAuthorizedDeviceSession(user, sessionId, wss) {
  const current = authSessionDb.getActiveById(sessionId, user.id);
  if (!current) {
    const error = new Error('Active authentication session not found');
    error.code = 'AUTH_SESSION_NOT_FOUND';
    throw error;
  }
  if (!current.countsAsDevice) {
    // A full local server is already the execution backend. It has no separate
    // Kernel handshake, so authorize the device here for both HTTP and WS.
    // Cloud web shells still require explicit Kernel authorization. This mode
    // comes only from server configuration, never client headers or metadata.
    if (!isWebShellOnlyMode()) {
      return activateDeviceSession(user, sessionId, wss).session;
    }
    const error = new Error('Connect and authorize the Local Engine before using this service');
    error.code = 'KERNEL_DEVICE_REQUIRED';
    throw error;
  }
  enforceCurrentDeviceLimit(user, wss);
  const session = authSessionDb.getActiveById(sessionId, user.id);
  if (!session) {
    const error = new Error('Device session has been revoked or expired');
    error.code = 'AUTH_SESSION_NOT_FOUND';
    throw error;
  }
  return session;
}
