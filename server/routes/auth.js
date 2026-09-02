import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import {
  db,
  userDb,
  authSessionDb,
  auditLogDb,
} from '../database/db.js';
import {
  AUTH_PRESENCE_TTL_MS,
  authenticateAccountToken,
  generateAuthTokens,
  verifyRefreshToken,
} from '../middleware/auth.js';
import { getLocalKernelConfig } from '../utils/webShellMode.js';
import { isLoopbackHost } from '../utils/localKernelRuntime.js';
import { getDefaultAvatarId } from '../../shared/avatarCatalog.js';
import { getEffectivePlan, getPlanCapabilities } from '../utils/entitlements.js';
import { USERNAME_EMAIL_ERROR, isEmailLikeUsername } from '../../shared/usernamePolicy.js';
import {
  isTrialExpiredForAccess,
  normalizeUtcTimestamp,
  timestampToMilliseconds,
} from '../utils/accountAccess.js';
import {
  closeDeviceSessions,
  getDevicePlans,
  getEffectiveDevicePolicy,
} from '../utils/authDevicePolicy.js';

const router = express.Router();
const LEGAL_TERMS_VERSION = 'v2.0-2026-04-26';
const LEGAL_TERMS_REQUIRED_ERROR = 'Legal terms must be accepted before registration';

function requireAdmin(_req, res) {
  return res.status(404).json({ error: 'Administrator functions are not available' });
}

// Administrator endpoints are intentionally disabled in this local-only build.
// Keep this guard ahead of any legacy route declarations so no administrator
// operation can be reached, even with stale environment configuration.
router.use('/admin', requireAdmin);

function writeAuditLog(req, details) {
  return auditLogDb.create({
    actorName: details.actorName ?? null,
    ipAddress: req.ip || null,
    userAgent: String(req.headers['user-agent'] || '').trim() || null,
    ...details,
  });
}

function resolveAvatarId(user) {
  return user?.avatar_id || getDefaultAvatarId(`${user?.id || ''}:${user?.username || ''}`);
}

function normalizeClientValue(value, maxLength = 120) {
  const normalized = String(value || '').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function inferClientType(session) {
  if (session?.clientType) return session.clientType;
  const label = String(session?.deviceLabel || '').toLowerCase();
  const userAgent = String(session?.userAgent || '').toLowerCase();
  if (label.includes('cli')) return 'local-engine';
  if (userAgent.includes('electron')) {
    return userAgent.includes('windows') ? 'desktop-windows' : 'desktop-macos';
  }
  if (label.includes('browser') || userAgent) return 'web';
  return 'unknown';
}

function summarizeClient(session) {
  if (!session) return null;
  return {
    type: inferClientType(session),
    version: session.clientVersion || null,
    platform: session.clientPlatform || null,
    deviceLabel: session.deviceLabel || null,
    lastSeenAt: normalizeUtcTimestamp(session.lastSeenAt),
  };
}

function getTrialStatus(user) {
  const expiresAt = normalizeUtcTimestamp(user?.trial_expires_at);
  const expiresMs = timestampToMilliseconds(expiresAt);
  const remainingMs = expiresMs ? expiresMs - Date.now() : null;
  return {
    trialStartedAt: normalizeUtcTimestamp(user?.trial_started_at),
    trialExpiresAt: expiresAt,
    trialRemainingMs: remainingMs,
    trialRemainingDays: remainingMs == null ? null : Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000))),
    isTrialExpired: remainingMs != null ? remainingMs <= 0 : false,
  };
}

function getMembershipStatus(user) {
  const expiresAt = normalizeUtcTimestamp(user?.membership_expires_at);
  const expiresMs = timestampToMilliseconds(expiresAt);
  const effectivePlan = getEffectivePlan(user);
  const remainingMs = expiresMs == null ? null : expiresMs - Date.now();
  return {
    effectivePlan,
    membershipExpiresAt: expiresAt,
    membershipRemainingMs: remainingMs,
    membershipRemainingDays: remainingMs == null ? null : Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000))),
    isMembershipExpired: user?.membership_plan === 'pro' && effectivePlan !== 'pro',
  };
}

function toPublicAuthUser(user) {
  const trialStatus = getTrialStatus(user);
  const membershipStatus = getMembershipStatus(user);
  return {
    id: user.id,
    username: user.username,
    notificationEmail: user.notification_email || null,
    displayName: user.display_name || null,
    fullName: user.full_name || null,
    institution: user.institution || null,
    organization: user.organization || null,
    academicTitle: user.academic_title || null,
    researchField: user.research_field || null,
    usagePurpose: user.usage_purpose || null,
    googleScholarUrl: user.google_scholar_url || null,
    websiteUrl: user.website_url || null,
    orcid: user.orcid || null,
    aboutYou: user.about_you || null,
    analysisLanguagePreference: user.analysis_language_preference || 'auto',
    avatarId: resolveAvatarId(user),
    avatarUrl: user.avatar_url || null,
    membershipPlan: user.membership_plan || 'free',
    capabilities: getPlanCapabilities(membershipStatus.effectivePlan),
    legalTermsAccepted: user.accepted_legal_terms === 1,
    legalTermsAcceptedAt: normalizeUtcTimestamp(user.accepted_legal_terms_at),
    legalTermsVersion: user.accepted_legal_terms_version || null,
    ...membershipStatus,
    ...trialStatus,
  };
}

function buildAuthPayload(user, sessionId) {
  return {
    success: true,
    ...generateAuthTokens(user, { sessionId }),
    user: toPublicAuthUser(user),
  };
}

function getOnlineSessionIds(wss) {
  const online = new Set();
  for (const client of wss?.clients || []) {
    if (client?.readyState === 1 && client.authSessionId) {
      online.add(String(client.authSessionId));
    }
  }
  return online;
}

function formatDeviceCode(deviceFingerprintHash) {
  const normalized = String(deviceFingerprintHash || '')
    .replace(/[^a-f0-9]/gi, '')
    .toUpperCase();
  if (!normalized) return null;
  const shortHash = normalized.slice(0, 12).padEnd(12, '0');
  return `MH-${shortHash.match(/.{1,4}/g).join('-')}`;
}

function decorateDeviceSessions(sessions, wss, currentSessionId = null) {
  const onlineSessionIds = getOnlineSessionIds(wss);
  const recentThreshold = Date.now() - AUTH_PRESENCE_TTL_MS;
  return sessions.map((session) => {
    const {
      deviceFingerprintHash,
      activeSessionId,
      activeLastSeenAt,
      registrationOrder,
      ...safeSession
    } = session;
    const effectiveActiveSessionId = activeSessionId || (
      session.countsAsDevice && !session.revokedAt ? session.id : null
    );
    const effectiveActiveLastSeenAt = activeLastSeenAt || (
      effectiveActiveSessionId ? session.lastSeenAt : null
    );
    const normalizedSession = {
      ...safeSession,
      createdAt: normalizeUtcTimestamp(session.createdAt),
      lastSeenAt: normalizeUtcTimestamp(session.lastSeenAt),
      refreshExpiresAt: normalizeUtcTimestamp(session.refreshExpiresAt),
      // Device registration survives logout/session expiry. Revocation here only
      // describes the representative login session, not the device itself.
      revokedAt: null,
    };
    const normalizedActiveLastSeenAt = normalizeUtcTimestamp(effectiveActiveLastSeenAt);
    return {
      ...normalizedSession,
      // A short, stable identifier is enough to distinguish devices in the UI.
      // Do not expose the complete stored fingerprint hash to clients.
      deviceCode: formatDeviceCode(deviceFingerprintHash),
      clientType: inferClientType(normalizedSession),
      online: Boolean(effectiveActiveSessionId) && (
        onlineSessionIds.has(String(effectiveActiveSessionId))
        || (timestampToMilliseconds(normalizedActiveLastSeenAt) ?? 0) >= recentThreshold
      ),
      current: currentSessionId
        ? String(effectiveActiveSessionId) === String(currentSessionId)
        : false,
    };
  });
}

function getRegistrationSettings() {
  return {
    registrationEnabled: true,
    requireApproval: false,
    defaultTrialDays: 0,
    defaultTrialHours: 0,
    devicePlans: getDevicePlans(),
  };
}

function resolveRequestDevice(req) {
  const userAgent = String(req.headers['user-agent'] || '').trim();
  const suppliedFingerprint = String(
    req.body?.deviceFingerprint
      || req.headers['x-medhelp-device-fingerprint']
      || req.headers['x-medhelp-device-id']
      || '',
  ).trim();
  // IP addresses and user agents are shared (and spoofable). An unidentified
  // client must not inherit an existing device registration through that pair.
  const fallbackFingerprint = `unidentified:${crypto.randomBytes(24).toString('base64url')}`;
  return {
    fingerprintHash: authSessionDb.hashDeviceFingerprint(suppliedFingerprint || fallbackFingerprint),
    label: String(req.body?.deviceLabel || req.body?.deviceName || '').trim()
      || (userAgent ? 'Browser or API client' : 'Unknown device'),
    ipAddress: req.ip || null,
    userAgent: userAgent || null,
    clientType: normalizeClientValue(req.body?.clientType, 40),
    clientVersion: normalizeClientValue(req.body?.clientVersion, 40),
    clientPlatform: normalizeClientValue(req.body?.clientPlatform, 80),
  };
}

function openDeviceSession(req, user) {
  const device = resolveRequestDevice(req);
  const policy = getEffectiveDevicePolicy(user);
  const created = authSessionDb.createWithLimit({
    userId: user.id,
    deviceFingerprintHash: device.fingerprintHash,
    deviceLabel: device.label,
    ipAddress: device.ipAddress,
    userAgent: device.userAgent,
    clientType: device.clientType,
    clientVersion: device.clientVersion,
    clientPlatform: device.clientPlatform,
    // All logins are account-only, independent of untrusted client metadata.
    // The Kernel must obtain a separate server-side device authorization.
    countsAsDevice: false,
    maxDevices: policy.maxDevices,
    overflowPolicy: policy.overflowPolicy,
  });
  closeDeviceSessions(req.app?.locals?.wss, created.revokedSessionIds, 'device-session-replaced');
  return { ...created, policy };
}

function normalizeKernelVersion(value) {
  const normalized = normalizeClientValue(value, 40);
  return normalized && /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(normalized)
    ? normalized
    : null;
}

function getKernelVersionFromUserAgent(req) {
  const match = String(req.headers['user-agent'] || '').match(/^MedHelp-Local-Kernel\/(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)/i);
  return normalizeKernelVersion(match?.[1]);
}

function activateKernelDeviceSession(req, metadata = {}) {
  if (!req.authSessionId) {
    const error = new Error('A device-bound login session is required before connecting the Local Kernel');
    error.code = 'AUTH_SESSION_REQUIRED';
    throw error;
  }

  const kernelVersion = normalizeKernelVersion(metadata.kernelVersion);
  const kernelPlatform = normalizeClientValue(metadata.kernelPlatform, 80);
  if (kernelVersion || kernelPlatform) {
    authSessionDb.touch(req.authSessionId, {
      clientVersion: kernelVersion,
      clientPlatform: kernelPlatform,
      force: true,
    });
  }

  return {
    newlyActivated: false,
    session: authSessionDb.getActiveById(req.authSessionId, req.user.id),
    policy: { maxDevices: null, overflowPolicy: 'allow' },
  };
}

function sendKernelDeviceActivationError(req, res, error) {
  if (error?.code === 'DEVICE_LIMIT_REACHED') {
    writeAuditLog(req, {
      category: 'login', level: 'warning', event: 'kernel_device_limit_reached',
      actorName: req.user?.username || null,
      targetType: 'user', targetId: req.user?.id,
      message: `本地引擎授权被拒绝：已达到 ${error.maxDevices} 台设备的限制`,
    });
    return res.status(409).json({
      error: error.message,
      code: error.code,
      maxDevices: error.maxDevices,
    });
  }
  if (error?.code === 'AUTH_SESSION_REQUIRED') {
    return res.status(409).json({ error: error.message, code: error.code });
  }
  if (error?.code === 'AUTH_SESSION_NOT_FOUND') {
    return res.status(401).json({ error: error.message, code: error.code });
  }
  console.error('[ERROR] Kernel device activation failed:', error.message);
  return res.status(500).json({ error: 'Unable to activate this Kernel device' });
}

const LOCAL_NO_AUTH_DEVICE = 'medhelp-local-no-auth';

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isLoopbackRequestAddress(value) {
  const host = String(value || '').trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  const normalized = host.startsWith('::ffff:') ? host.slice(7) : host;
  return isLoopbackHost(normalized);
}

function isLocalNoAuthRequest(req) {
  if (!isTruthyEnv(process.env.MEDHELP_LOCAL_NO_AUTH)) return false;
  if (process.env.NODE_ENV === 'production') return false;
  const ip = req.ip || req.socket?.remoteAddress || '';
  if (!isLoopbackRequestAddress(ip)) return false;
  const origin = String(req.headers.origin || req.headers.referer || '').trim();
  if (!origin) return true;
  try {
    return isLoopbackRequestAddress(new URL(origin).hostname);
  } catch {
    return false;
  }
}

function ensureLocalDevProUser(user) {
  if (!user) return user;
  if (getEffectivePlan(user) === 'pro') return user;
  return userDb.updateMembershipPlan(user.id, 'pro') || user;
}

function ensureLocalDevUser() {
  const existing = userDb.getFirstUser();
  if (existing) return ensureLocalDevProUser(existing);
  const passwordHash = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 12);
  const created = userDb.createUser('local', passwordHash, 'local@localhost.local', {
    acceptedLegalTerms: true,
    acceptedLegalTermsAt: new Date().toISOString(),
    acceptedLegalTermsVersion: LEGAL_TERMS_VERSION,
  });
  return ensureLocalDevProUser(created);
}

function issueLocalNoAuthPayload(req, user) {
  const fingerprintHash = authSessionDb.hashDeviceFingerprint(LOCAL_NO_AUTH_DEVICE);
  const existing = authSessionDb.listActiveForUser(user.id)
    .find((session) => session.deviceFingerprintHash === fingerprintHash);
  if (existing?.id) {
    return buildAuthPayload(user, existing.id);
  }
  const created = authSessionDb.createWithLimit({
    userId: user.id,
    deviceFingerprintHash: fingerprintHash,
    deviceLabel: 'Local development',
    ipAddress: req.ip || null,
    userAgent: String(req.headers['user-agent'] || '').trim() || null,
    clientType: 'local-engine',
    countsAsDevice: false,
  });
  return buildAuthPayload(user, created.session.id);
}

router.get('/status', async (req, res) => {
  const settings = getRegistrationSettings();
  const payload = {
    needsSetup: false,
    isAuthenticated: false,
    registrationEnabled: settings.registrationEnabled,
    requireApproval: settings.requireApproval,
    registrationEmailVerificationRequired: false,
    devicePlans: settings.devicePlans,
    localKernel: getLocalKernelConfig(),
  };

  if (!isLocalNoAuthRequest(req)) {
    return res.json(payload);
  }

  try {
    const user = ensureLocalDevUser();
    const session = issueLocalNoAuthPayload(req, user);
    return res.json({
      ...payload,
      ...session,
      localNoAuth: true,
      isAuthenticated: true,
    });
  } catch (error) {
    console.error('[ERROR] Local no-auth session failed:', error.message);
    return res.json(payload);
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const normalizedUsername = String(username || '').trim();

    if (!normalizedUsername || !password) {
      writeAuditLog(req, {
        category: 'login', level: 'warning', event: 'user_login_failed',
        actorName: normalizedUsername || null, message: '用户登录失败：账号或密码为空',
      });
      return res.status(400).json({ error: 'Username or email and password are required' });
    }

    let user = userDb.getUserByLoginIdentifier(normalizedUsername);
    if (!user) {
      writeAuditLog(req, {
        category: 'login', level: 'warning', event: 'user_login_failed',
        actorName: normalizedUsername, message: '用户登录失败：账号不存在或已禁用',
      });
      return res.status(401).json({ error: 'Invalid username, email, or password' });
    }

    const isValidPassword = await bcrypt.compare(String(password), user.password_hash);
    if (!isValidPassword) {
      writeAuditLog(req, {
        category: 'login', level: 'warning', event: 'user_login_failed',
        actorName: normalizedUsername, targetType: 'user', targetId: user.id,
        message: '用户登录失败：密码错误',
      });
      return res.status(401).json({ error: 'Invalid username, email, or password' });
    }

    user = ensureLocalDevProUser(user);

    const { session } = openDeviceSession(req, user);
    userDb.updateLastLogin(user.id);

    writeAuditLog(req, {
      category: 'login', event: 'user_login_success', actorName: user.username,
      targetType: 'user', targetId: user.id, message: `用户 ${user.username} 登录成功`,
    });

    return res.json(buildAuthPayload(user, session.id));
  } catch (error) {
    console.error('Login error:', error);
    writeAuditLog(req, {
      category: 'system', level: 'error', event: 'user_login_error',
      actorName: String(req.body?.username || '').trim() || null,
      message: `用户登录处理异常：${error.message}`,
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/refresh', (req, res) => {
  try {
    const refreshToken = String(req.body?.refreshToken || '').trim();
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded.sessionId) {
      return res.status(401).json({ error: 'Legacy refresh token requires a new login' });
    }
    let user = userDb.getUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }
    user = ensureLocalDevProUser(user);

    const suppliedFingerprint = String(
      req.body?.deviceFingerprint
        || req.headers['x-medhelp-device-fingerprint']
        || req.headers['x-medhelp-device-id']
        || '',
    ).trim();
    const session = authSessionDb.verifyRefreshToken({
      sessionId: decoded.sessionId,
      userId: decoded.userId,
      tokenHash: authSessionDb.hashRefreshToken(refreshToken),
      deviceFingerprintHash: suppliedFingerprint
        ? authSessionDb.hashDeviceFingerprint(suppliedFingerprint)
        : null,
    });
    if (!session) {
      return res.status(401).json({ error: 'Device session has been revoked or refresh token is invalid' });
    }

    const refreshedDevice = resolveRequestDevice(req);
    authSessionDb.touch(session.id, {
      ipAddress: refreshedDevice.ipAddress,
      userAgent: refreshedDevice.userAgent,
      clientType: refreshedDevice.clientType,
      clientVersion: refreshedDevice.clientVersion,
      clientPlatform: refreshedDevice.clientPlatform,
      force: true,
    });

    return res.json(buildAuthPayload(user, session.id));
  } catch (error) {
    console.error('Refresh token error:', error);
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

router.get('/admin/status', (req, res) => {
  const settings = getRegistrationSettings();
  res.json({
    adminConfigured: adminConfigured(),
    registrationEnabled: settings.registrationEnabled,
    requireApproval: settings.requireApproval,
    defaultTrialDays: settings.defaultTrialDays,
    defaultTrialHours: settings.defaultTrialHours,
    devicePlans: settings.devicePlans,
    activeUsers: userDb.countActiveUsers(),
  });
});

router.post('/admin/login', (req, res) => {
  const { username, password } = req.body || {};
  const config = getAdminConfig();
  if (!config.username || (!config.password && !config.passwordHash)) {
    writeAuditLog(req, {
      category: 'system', level: 'error', event: 'admin_not_configured',
      message: '管理员登录失败：管理员账号尚未配置',
    });
    return res.status(503).json({ error: 'Administrator account is not configured' });
  }

  if (String(username || '') !== config.username || !verifyAdminPassword(password)) {
    writeAuditLog(req, {
      category: 'login', level: 'warning', event: 'admin_login_failed',
      actorName: String(username || '').trim() || null, message: '管理员登录失败：账号或密码错误',
    });
    return res.status(401).json({ error: 'Invalid administrator username or password' });
  }

  const token = generateAdminToken(config.username);
  ADMIN_TOKEN_STORE.set(token, { username: config.username });
  writeAuditLog(req, {
    category: 'login', event: 'admin_login_success', actorName: config.username,
    message: `管理员 ${config.username} 登录成功`,
  });
  return res.json({ success: true, token });
});

router.get('/admin/users', requireAdmin, (req, res) => {
  const users = userDb.listAdminUsers(true).map((user) => toAdminUser(user, req.app));
  res.json({ users });
});

router.get('/admin/logs', requireAdmin, (req, res) => {
  try {
    return res.json(auditLogDb.list({
      category: String(req.query.category || 'system'),
      page: req.query.page,
      pageSize: req.query.pageSize,
      search: req.query.search,
    }));
  } catch (error) {
    console.error('[ERROR] Admin logs query failed:', error.message);
    return res.status(500).json({ error: 'Failed to load logs' });
  }
});

router.get('/admin/registration-requests', requireAdmin, (req, res) => {
  const status = String(req.query.status || 'pending').trim() || 'pending';
  res.json({ requests: registrationRequestDb.list(status) });
});

router.patch('/admin/users/:id/membership', requireAdmin, (req, res) => {
  const membershipPlan = String(req.body?.membershipPlan || '').trim().toLowerCase();
  if (!['free', 'pro'].includes(membershipPlan)) {
    return res.status(400).json({ error: 'Invalid membership plan' });
  }

  let membershipExpiresAt;
  if (membershipPlan === 'pro' && Object.prototype.hasOwnProperty.call(req.body || {}, 'membershipExpiresAt')) {
    const rawExpiry = req.body.membershipExpiresAt;
    if (rawExpiry === null || rawExpiry === '') {
      membershipExpiresAt = null;
    } else {
      const expiryMs = Date.parse(String(rawExpiry));
      if (!Number.isFinite(expiryMs)) {
        return res.status(400).json({ error: 'Invalid membership expiration date' });
      }
      membershipExpiresAt = new Date(expiryMs).toISOString();
    }
  }

  const user = userDb.updateMembershipPlan(req.params.id, membershipPlan, membershipExpiresAt);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  enforceCurrentDeviceLimit(user, req.app?.locals?.wss);

  writeAuditLog(req, {
    category: 'operation', event: 'membership_updated', targetType: 'user', targetId: user.id,
    message: `更新用户 ${user.username} 的会员等级为 ${membershipPlan.toUpperCase()}`,
  });

  return res.json({ success: true, user: toAdminUser(user, req.app) });
});

router.patch('/admin/users/:id/device-policy', requireAdmin, (req, res) => {
  const body = req.body || {};
  let maxDevices = null;
  if (body.maxDevices !== null && body.maxDevices !== undefined && body.maxDevices !== '') {
    const parsed = Number.parseInt(String(body.maxDevices), 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      return res.status(400).json({ error: 'maxDevices must be between 0 and 100, or null to inherit the plan' });
    }
    maxDevices = parsed;
  }

  const overflowPolicy = body.overflowPolicy == null || body.overflowPolicy === ''
    ? null
    : String(body.overflowPolicy);
  if (overflowPolicy && !DEVICE_OVERFLOW_POLICIES.has(overflowPolicy)) {
    return res.status(400).json({ error: 'Invalid device overflow policy' });
  }

  const user = userDb.updateDevicePolicy(req.params.id, { maxDevices, overflowPolicy });
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  enforceCurrentDeviceLimit(user, req.app?.locals?.wss);
  writeAuditLog(req, {
    category: 'operation', event: 'device_policy_updated', targetType: 'user', targetId: user.id,
    message: `更新用户 ${user.username} 的设备规则`,
  });
  return res.json({ success: true, user: toAdminUser(user, req.app) });
});

router.get('/admin/users/:id/devices', requireAdmin, (req, res) => {
  const user = userDb.getAdminUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const devices = decorateDeviceSessions(
    authSessionDb.listCountedActiveForUser(user.id),
    req.app?.locals?.wss,
  );
  return res.json({ devices, policy: getEffectiveDevicePolicy(user) });
});

router.delete('/admin/users/:id/devices/:sessionId', requireAdmin, (req, res) => {
  const revoked = authSessionDb.revokeDevice(req.params.sessionId, req.params.id, 'admin-revoked');
  if (!revoked) return res.status(404).json({ error: 'Registered device not found' });
  closeDeviceSessions(req.app?.locals?.wss, revoked.revokedSessionIds, 'admin-revoked');
  writeAuditLog(req, {
    category: 'operation', event: 'device_revoked', targetType: 'user', targetId: req.params.id,
    message: `管理员下线用户 ${req.params.id} 的设备`,
  });
  return res.json({ success: true });
});

router.patch('/admin/users/:id/trial', requireAdmin, (req, res) => {
  const body = req.body || {};
  let trialExpiresAt = null;
  let expireNow = false;

  if (body.expireNow === true) {
    expireNow = true;
    trialExpiresAt = new Date().toISOString();
  } else if (Object.prototype.hasOwnProperty.call(body, 'trialHours')) {
    const hours = Number(body.trialHours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 87600) {
      return res.status(400).json({ error: 'trialHours must be between 0 and 87600' });
    }
    trialExpiresAt = trialDateFromDuration(hours, 'hours');
  } else if (Object.prototype.hasOwnProperty.call(body, 'trialDays')) {
    const days = Number(body.trialDays);
    if (!Number.isFinite(days) || days < 0 || days > 3650) {
      return res.status(400).json({ error: 'trialDays must be between 0 and 3650' });
    }
    trialExpiresAt = trialDateFromDuration(days, 'days');
  } else if (Object.prototype.hasOwnProperty.call(body, 'trialExpiresAt')) {
    if (body.trialExpiresAt) {
      const parsed = Date.parse(String(body.trialExpiresAt));
      if (!Number.isFinite(parsed)) {
        return res.status(400).json({ error: 'Invalid trial expiration date' });
      }
      trialExpiresAt = new Date(parsed).toISOString();
    }
  }

  const trialPatch = { trialExpiresAt };
  if (Object.prototype.hasOwnProperty.call(body, 'trialStartedAt')) {
    trialPatch.trialStartedAt = body.trialStartedAt || null;
  }

  const user = userDb.updateTrial(req.params.id, trialPatch);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  if (expireNow) {
    const revokedIds = authSessionDb.revokeAllForUser(user.id, 'admin-trial-expired');
    closeDeviceSessions(req.app?.locals?.wss, revokedIds, 'trial-expired');
  }

  writeAuditLog(req, {
    category: 'operation', event: expireNow ? 'trial_expired_immediately' : 'trial_updated', targetType: 'user', targetId: user.id,
    message: expireNow ? `立即结束用户 ${user.username} 的试用期` : `更新用户 ${user.username} 的试用期`,
  });

  return res.json({ success: true, user: toAdminUser(user, req.app) });
});

router.post('/admin/users/:id/password-reset', requireAdmin, async (req, res) => {
  const user = userDb.getAdminUserById(req.params.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const rawPassword = String(req.body?.newPassword || '').trim();
  const newPassword = rawPassword || crypto.randomBytes(8).toString('base64url');
  const passwordHash = await bcrypt.hash(newPassword, 12);
  const updated = userDb.updatePasswordByUsername(user.username, passwordHash);
  if (!updated) {
    return res.status(404).json({ error: 'User not found' });
  }

  const revokedIds = authSessionDb.revokeAllForUser(user.id, 'admin-password-reset');
  closeDeviceSessions(req.app?.locals?.wss, revokedIds, 'admin-password-reset');

  writeAuditLog(req, {
    category: 'operation', level: 'warning', event: 'password_reset', targetType: 'user', targetId: user.id,
    message: `重置用户 ${user.username} 的密码`,
  });

  return res.json({ success: true, newPassword });
});

router.patch('/admin/users/:id/disable', requireAdmin, (req, res) => {
  const revokedIds = authSessionDb.revokeAllForUser(req.params.id, 'account-disabled');
  const disabled = userDb.disableUser(req.params.id);
  if (!disabled) {
    return res.status(404).json({ error: 'User not found' });
  }

  closeDeviceSessions(req.app?.locals?.wss, revokedIds, 'account-disabled');

  const user = userDb.getAdminUserById(req.params.id);
  writeAuditLog(req, {
    category: 'operation', level: 'warning', event: 'user_disabled', targetType: 'user', targetId: req.params.id,
    message: `禁用用户 ${user?.username || req.params.id}`,
  });

  return res.json({ success: true });
});

router.patch('/admin/users/:id/enable', requireAdmin, (req, res) => {
  const enabled = userDb.enableUser(req.params.id);
  if (!enabled) {
    return res.status(404).json({ error: 'Disabled user not found' });
  }

  const user = userDb.getAdminUserById(req.params.id);
  writeAuditLog(req, {
    category: 'operation', event: 'user_enabled', targetType: 'user', targetId: user.id,
    message: `恢复用户 ${user.username}`,
  });
  return res.json({ success: true, user: toAdminUser(user, req.app) });
});

router.delete('/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const deleteProjects = String(req.query.deleteProjects || 'false').toLowerCase() === 'true';
    const user = userDb.getAdminUserById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (deleteProjects) {
      // Route each project through the real deletion pipeline (soft delete to
      // trash) so on-disk files, project.json config and session records are
      // handled consistently instead of leaving orphaned data on the server.
      const { deleteProject } = await import('../projects.js');
      const projectIds = userDb.listProjectIdsForUser(user.id);
      for (const projectId of projectIds) {
        try {
          await deleteProject(projectId, true, null);
        } catch (err) {
          console.error('[ERROR] Admin failed to delete project', projectId, err.message);
        }
      }
    } else {
      userDb.preserveUsersProjects(req.params.id);
    }

    const deleted = userDb.deleteUser(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'User not found' });
    }

    writeAuditLog(req, {
      category: 'operation', level: 'warning', event: 'user_deleted', targetType: 'user', targetId: user.id,
      message: `删除用户 ${user.username}${deleteProjects ? '及其项目' : '（保留项目）'}`,
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('[ERROR] Admin delete user failed:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

router.patch('/admin/settings', requireAdmin, (req, res) => {
  const body = req.body || {};
  if (Object.prototype.hasOwnProperty.call(body, 'registrationEnabled')) {
    setSetting(SETTINGS_KEYS.registrationEnabled, body.registrationEnabled ? 'true' : 'false');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'requireApproval')) {
    setSetting(SETTINGS_KEYS.requireApproval, body.requireApproval ? 'true' : 'false');
  }
  if (Object.prototype.hasOwnProperty.call(body, 'defaultTrialDays')) {
    const trialDays = Number.parseInt(String(body.defaultTrialDays || '').trim(), 10);
    if (!Number.isFinite(trialDays) || trialDays < 0 || trialDays > 3650) {
      return res.status(400).json({ error: 'defaultTrialDays must be between 0 and 3650' });
    }
    setSetting(SETTINGS_KEYS.defaultTrialDays, String(trialDays));
  }
  if (Object.prototype.hasOwnProperty.call(body, 'defaultTrialHours')) {
    const trialHours = Number.parseInt(String(body.defaultTrialHours || '').trim(), 10);
    if (!Number.isFinite(trialHours) || trialHours < 0 || trialHours > 23) {
      return res.status(400).json({ error: 'defaultTrialHours must be between 0 and 23' });
    }
    setSetting(SETTINGS_KEYS.defaultTrialHours, String(trialHours));
  }

  if (body.devicePlans && typeof body.devicePlans === 'object') {
    for (const plan of ['free', 'pro']) {
      const planConfig = body.devicePlans[plan];
      if (!planConfig || typeof planConfig !== 'object') continue;
      if (Object.prototype.hasOwnProperty.call(planConfig, 'maxDevices')) {
        const parsed = Number.parseInt(String(planConfig.maxDevices), 10);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
          return res.status(400).json({ error: `${plan} maxDevices must be between 0 and 100` });
        }
        setSetting(
          plan === 'free' ? SETTINGS_KEYS.freeDeviceLimit : SETTINGS_KEYS.proDeviceLimit,
          String(parsed),
        );
      }
      if (Object.prototype.hasOwnProperty.call(planConfig, 'overflowPolicy')) {
        const policy = String(planConfig.overflowPolicy || '');
        if (!DEVICE_OVERFLOW_POLICIES.has(policy)) {
          return res.status(400).json({ error: `Invalid ${plan} overflow policy` });
        }
        setSetting(
          plan === 'free' ? SETTINGS_KEYS.freeOverflowPolicy : SETTINGS_KEYS.proOverflowPolicy,
          policy,
        );
      }
    }
  }

  for (const user of userDb.listAdminUsers()) {
    if (!user.is_active) continue;
    enforceCurrentDeviceLimit(user, req.app?.locals?.wss);
  }

  writeAuditLog(req, {
    category: 'operation', event: 'admin_settings_updated', message: '更新注册、试用或设备套餐设置',
  });

  res.json({ success: true, settings: getRegistrationSettings() });
});

router.post('/register', async (req, res) => {
  try {
    const {
      username,
      password,
      notificationEmail,
      acceptedLegalTerms,
    } = req.body || {};
    const normalizedUsername = String(username || '').trim();
    const normalizedEmail = String(notificationEmail || '').trim().toLowerCase();

    if (!normalizedUsername || !password || !normalizedEmail) {
      return res.status(400).json({ error: 'Username, password, and email are required' });
    }

    if (normalizedUsername.length < 3 || String(password).length < 6) {
      return res.status(400).json({ error: 'Username must be at least 3 characters, password at least 6 characters' });
    }

    if (isEmailLikeUsername(normalizedUsername)) {
      return res.status(400).json({ error: USERNAME_EMAIL_ERROR, code: 'USERNAME_CANNOT_BE_EMAIL' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    if (acceptedLegalTerms !== true) {
      return res.status(400).json({ error: LEGAL_TERMS_REQUIRED_ERROR });
    }

    const existingUsername = db.prepare('SELECT id FROM users WHERE username = ? AND is_active = 1').get(normalizedUsername);
    if (existingUsername) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    const existingEmail = db.prepare(`
      SELECT id FROM users
      WHERE LOWER(notification_email) = LOWER(?) AND is_active = 1
      LIMIT 1
    `).get(normalizedEmail);
    if (existingEmail) {
      return res.status(409).json({ error: 'Email is already registered' });
    }

    const passwordHash = await bcrypt.hash(String(password), 12);
    const acceptedLegalTermsAt = new Date().toISOString();
    const user = db.transaction(() => {
      const created = userDb.createUser(
        normalizedUsername,
        passwordHash,
        normalizedEmail,
        {
          acceptedLegalTerms: true,
          acceptedLegalTermsAt,
          acceptedLegalTermsVersion: LEGAL_TERMS_VERSION,
        },
      );
      return userDb.updateMembershipPlan(created.id, 'pro', null);
    })();
    const { session } = openDeviceSession(req, user);
    return res.json({
      ...buildAuthPayload(user, session.id),
      pendingReview: false,
    });
  } catch (error) {
    console.error('Registration error:', error);
    if (String(error.code || '').startsWith('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'Username already exists' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/admin/registration-requests/:id/approve', requireAdmin, (req, res) => {
  const request = registrationRequestDb.getById(req.params.id);
  if (!request) {
    return res.status(404).json({ error: 'Registration request not found' });
  }
  if (request.status !== 'pending') {
    return res.status(409).json({ error: `Registration request has already been ${request.status}` });
  }
  if (isEmailLikeUsername(request.username)) {
    return res.status(400).json({ error: USERNAME_EMAIL_ERROR, code: 'USERNAME_CANNOT_BE_EMAIL' });
  }

  const conflictingUser = db.prepare(`
    SELECT id
    FROM users
    WHERE is_active = 1
      AND (username = ? OR LOWER(notification_email) = LOWER(?))
    LIMIT 1
  `).get(request.username, request.notification_email);
  if (conflictingUser) {
    return res.status(409).json({ error: 'Username or email is already registered' });
  }

  const settings = getRegistrationSettings();
  const user = db.transaction(() => {
    const createdUser = userDb.createUser(
      request.username,
      request.password_hash,
      request.notification_email,
      {
        trialDays: settings.defaultTrialDays,
        trialHours: settings.defaultTrialHours,
        acceptedLegalTerms: request.accepted_legal_terms === 1,
        acceptedLegalTermsAt: request.accepted_legal_terms_at || null,
        acceptedLegalTermsVersion: request.accepted_legal_terms_version || null,
      },
    );
    registrationRequestDb.approve(request.id, createdUser.id);
    return createdUser;
  })();

  writeAuditLog(req, {
    category: 'operation', event: 'registration_approved', targetType: 'user', targetId: user.id,
    message: `通过用户 ${user.username} 的注册申请`,
  });

  return res.json({ success: true, user: toPublicAuthUser(user) });
});

router.post('/admin/registration-requests/:id/reject', requireAdmin, (req, res) => {
  const request = registrationRequestDb.getById(req.params.id);
  if (!request) {
    return res.status(404).json({ error: 'Registration request not found' });
  }
  if (request.status !== 'pending') {
    return res.status(409).json({ error: `Registration request has already been ${request.status}` });
  }

  const updated = registrationRequestDb.reject(request.id, String(req.body?.note || 'Rejected by administrator'));
  writeAuditLog(req, {
    category: 'operation', level: 'warning', event: 'registration_rejected',
    targetType: 'registration_request', targetId: request.id,
    message: `拒绝用户 ${request.username} 的注册申请`,
  });
  return res.json({ success: true, request: updated });
});

router.get('/user', authenticateAccountToken, (req, res) => {
  if (/^MedHelp-Local-Kernel\//i.test(String(req.headers['user-agent'] || ''))) {
    try {
      activateKernelDeviceSession(req, {
        kernelVersion: getKernelVersionFromUserAgent(req),
      });
    } catch (error) {
      return sendKernelDeviceActivationError(req, res, error);
    }
  }
  res.json({
    user: toPublicAuthUser(req.user),
  });
});

router.post('/logout', authenticateAccountToken, (req, res) => {
  if (req.authSessionId) {
    authSessionDb.revoke(req.authSessionId, req.user.id, 'user-logout');
    closeDeviceSessions(req.app?.locals?.wss, [req.authSessionId], 'user-logout');
  }
  writeAuditLog(req, {
    category: 'login', event: 'user_logout', actorName: req.user.username,
    targetType: 'user', targetId: req.user.id, message: `用户 ${req.user.username} 退出登录`,
  });
  res.json({ success: true });
});

router.post('/presence', authenticateAccountToken, (req, res) => {
  if (req.authSessionId) {
    const device = resolveRequestDevice(req);
    authSessionDb.touch(req.authSessionId, {
      ipAddress: device.ipAddress,
      userAgent: device.userAgent,
      clientType: device.clientType,
      clientVersion: device.clientVersion,
      clientPlatform: device.clientPlatform,
      force: true,
    });
    return res.json({ success: true, timestamp: new Date().toISOString() });
  }

  try {
    const { session } = openDeviceSession(req, req.user);
    return res.json({
      ...buildAuthPayload(req.user, session.id),
      sessionMigrated: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (error?.code === 'DEVICE_LIMIT_REACHED') {
      return res.status(409).json({
        error: error.message,
        code: error.code,
        maxDevices: error.maxDevices,
      });
    }
    console.error('Legacy presence migration error:', error);
    return res.status(500).json({ error: 'Unable to register this device session' });
  }
});

router.post('/kernel-device/activate', authenticateAccountToken, (req, res) => {
  try {
    const activated = activateKernelDeviceSession(req, {
      kernelVersion: req.body?.kernelVersion,
      kernelPlatform: req.body?.kernelPlatform,
    });
    return res.json({
      success: true,
      countedAsDevice: true,
      newlyActivated: activated.newlyActivated,
      device: decorateDeviceSessions(
        [activated.session],
        req.app?.locals?.wss,
        req.authSessionId,
      )[0],
      policy: activated.policy,
      user: toPublicAuthUser(req.user),
    });
  } catch (error) {
    return sendKernelDeviceActivationError(req, res, error);
  }
});

router.post('/project-count', authenticateAccountToken, (req, res) => {
  const projectCount = Number(req.body?.projectCount);
  if (!Number.isInteger(projectCount) || projectCount < 0 || projectCount > 10000) {
    return res.status(400).json({ error: 'projectCount must be an integer between 0 and 10000' });
  }
  userDb.updateCurrentProjectCount(req.user.id, projectCount);
  return res.json({ success: true, projectCount });
});

router.get('/devices', authenticateAccountToken, (req, res) => {
  const devices = decorateDeviceSessions(
    authSessionDb.listCountedActiveForUser(req.user.id),
    req.app?.locals?.wss,
    req.authSessionId,
  );
  res.json({ devices, policy: getEffectiveDevicePolicy(req.user) });
});

router.delete('/devices/:sessionId', authenticateAccountToken, (req, res) => {
  const revoked = authSessionDb.revokeDevice(req.params.sessionId, req.user.id, 'user-revoked');
  if (!revoked) {
    return res.status(404).json({ error: 'Registered device not found' });
  }
  closeDeviceSessions(req.app?.locals?.wss, revoked.revokedSessionIds, 'user-revoked');
  return res.json({
    success: true,
    currentSessionRevoked: revoked.revokedSessionIds.some(
      (sessionId) => String(sessionId) === String(req.authSessionId || ''),
    ),
  });
});

export default router;
