import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { authSessionDb, userDb } from '../database/db.js';
import { IS_PLATFORM } from '../constants/config.js';
import { isTrialExpiredForAccess } from '../utils/accountAccess.js';
import { requireAuthorizedDeviceSession } from '../utils/authDevicePolicy.js';

// Get JWT secret from environment or use default (for development)
const JWT_SECRET = process.env.JWT_SECRET || 'claude-ui-dev-secret-change-in-production';
const JWT_PREVIOUS_SECRETS = (process.env.JWT_PREVIOUS_SECRETS || process.env.JWT_SECRET_PREVIOUS || '')
  .split(',')
  .map((secret) => secret.trim())
  .filter(Boolean);
const JWT_ACCESS_TOKEN_TTL = process.env.JWT_ACCESS_TOKEN_TTL || '15m';
const JWT_REFRESH_TOKEN_TTL = process.env.JWT_REFRESH_TOKEN_TTL || '30d';

const TOKEN_TYPES = {
  access: 'access',
  refresh: 'refresh',
};
const AUTH_PRESENCE_TTL_MS = 90 * 1000;

function markAuthPresence(req, userId) {
  if (userId == null || !req?.app?.locals) return;
  if (!(req.app.locals.authPresenceByUserId instanceof Map)) {
    req.app.locals.authPresenceByUserId = new Map();
  }

  const now = Date.now();
  req.app.locals.authPresenceByUserId.set(String(userId), now);

  // Keep the in-memory fallback bounded even on long-running servers.
  if (req.app.locals.authPresenceByUserId.size > 1000) {
    const cutoff = now - AUTH_PRESENCE_TTL_MS;
    for (const [id, lastSeenAt] of req.app.locals.authPresenceByUserId) {
      if (lastSeenAt < cutoff) req.app.locals.authPresenceByUserId.delete(id);
    }
  }
}

const isUserRecentlyPresent = (app, userId, now = Date.now()) => {
  const lastSeenAt = app?.locals?.authPresenceByUserId?.get(String(userId));
  return Number.isFinite(lastSeenAt) && lastSeenAt >= now - AUTH_PRESENCE_TTL_MS;
};

function ensureFullLocalAccess(user) {
  if (!user) return user;
  if (user.membership_plan === 'pro' && !user.membership_expires_at) return user;
  return userDb.updateMembershipPlan(user.id, 'pro', null) || user;
}

function getJwtSecretsForVerification() {
  return [JWT_SECRET, ...JWT_PREVIOUS_SECRETS];
}

function verifyTokenWithRotation(token, expectedType) {
  let lastError = null;

  for (const secret of getJwtSecretsForVerification()) {
    try {
      const decoded = jwt.verify(token, secret);
      if (expectedType && decoded.tokenType !== expectedType) {
        throw new jwt.JsonWebTokenError('Invalid token type');
      }
      if (!decoded.exp) {
        throw new jwt.JsonWebTokenError('Token expiration required');
      }
      return decoded;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new jwt.JsonWebTokenError('Invalid token');
}

const verifyAccessToken = (token) => verifyTokenWithRotation(token, TOKEN_TYPES.access);
const verifyRefreshToken = (token) => verifyTokenWithRotation(token, TOKEN_TYPES.refresh);

// Optional API key middleware
const validateApiKey = (req, res, next) => {
  // Skip API key validation if not configured
  if (!process.env.API_KEY) {
    return next();
  }
  
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  next();
};

// Account authentication never allocates a Kernel device slot. Keep this
// separate from authorization to execute work on a registered device.
const authenticateAccountToken = async (req, res, next) => {
  try {
    if (req.localKernelSession && req.user) {
      return next();
    }

    if (IS_PLATFORM) {
      const user = ensureFullLocalAccess(userDb.getFirstUser());
      if (!user) {
        return res.status(401).json({ error: 'No authenticated user found' });
      }
      req.user = user;
      markAuthPresence(req, user.id);
      return next();
    }

    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const decoded = verifyAccessToken(token);
    const user = ensureFullLocalAccess(userDb.getUserById(decoded.userId));
    if (!user) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }
    if (!decoded.sessionId) {
      return res.status(401).json({
        error: 'A device-bound session is required; please sign in again',
        code: 'AUTH_SESSION_REQUIRED',
      });
    }
    const session = authSessionDb.getActiveById(decoded.sessionId, user.id);
    if (!session) {
      return res.status(401).json({ error: 'Device session has been revoked or expired', code: 'AUTH_SESSION_NOT_FOUND' });
    }
    req.authSession = session;
    req.authSessionId = session.id;
    authSessionDb.touch(session.id, {
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    });

    req.user = user;
    markAuthPresence(req, user.id);
    return next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Local accounts have unrestricted access to the local workspace. A valid
// account session is sufficient; there is no remote membership or device gate.
const authenticateToken = authenticateAccountToken;

// Generate short-lived access token.
const generateToken = (user, sessionId = null) => {
  return jwt.sign(
    { 
      userId: user.id, 
      username: user.username,
      tokenType: TOKEN_TYPES.access,
      ...(sessionId ? { sessionId } : {}),
    },
    JWT_SECRET,
    { expiresIn: JWT_ACCESS_TOKEN_TTL }
  );
};

const generateRefreshToken = (user, sessionId = null) => {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username,
      tokenType: TOKEN_TYPES.refresh,
      tokenId: crypto.randomBytes(16).toString('base64url'),
      ...(sessionId ? { sessionId } : {}),
    },
    JWT_SECRET,
    { expiresIn: JWT_REFRESH_TOKEN_TTL }
  );
};

const generateAuthTokens = (user, options = {}) => {
  let sessionId = options.sessionId || null;
  if (!sessionId) {
    const generatedFingerprint = authSessionDb.hashDeviceFingerprint(
      `generated:${user.id}:${crypto.randomBytes(18).toString('hex')}`,
    );
    const created = authSessionDb.createWithLimit({
      userId: user.id,
      deviceFingerprintHash: generatedFingerprint,
      deviceLabel: options.deviceLabel || 'API client',
      countsAsDevice: false,
    });
    sessionId = created.session.id;
  }
  if (!authSessionDb.getActiveById(sessionId, user.id)) {
    throw new Error('Active authentication session not found');
  }

  const accessToken = generateToken(user, sessionId);
  const refreshToken = generateRefreshToken(user, sessionId);
  const refreshPayload = jwt.decode(refreshToken);
  const refreshExpiresAt = refreshPayload?.exp
    ? new Date(refreshPayload.exp * 1000).toISOString()
    : null;
  const stored = authSessionDb.setRefreshToken(
    sessionId,
    authSessionDb.hashRefreshToken(refreshToken),
    refreshExpiresAt,
  );
  if (!stored) {
    throw new Error('Unable to store refresh token for device session');
  }

  return {
    token: accessToken,
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresIn: JWT_ACCESS_TOKEN_TTL,
    refreshExpiresIn: JWT_REFRESH_TOKEN_TTL,
    sessionId,
  };
};

// WebSocket authentication function
const authenticateWebSocket = (token, wss) => {
  try {
    if (IS_PLATFORM) {
      const user = userDb.getFirstUser();
      return user ? { userId: user.id, username: user.username } : null;
    }

    if (!token) {
      return null;
    }

    const decoded = verifyAccessToken(token);
    const user = userDb.getUserById(decoded.userId);
    if (!user) {
      return null;
    }
    if (isTrialExpiredForAccess(user)) {
      return null;
    }

    if (!decoded.sessionId) return null;
    const session = requireAuthorizedDeviceSession(user, decoded.sessionId, wss);
    authSessionDb.touch(session.id);
    return { userId: user.id, username: user.username, sessionId: session.id };
  } catch (error) {
    console.error('WebSocket auth error:', error);
    return null;
  }
};

export {
  validateApiKey,
  authenticateAccountToken,
  authenticateToken,
  generateToken,
  generateAuthTokens,
  generateRefreshToken,
  authenticateWebSocket,
  verifyAccessToken,
  verifyRefreshToken,
  isUserRecentlyPresent,
  AUTH_PRESENCE_TTL_MS,
  JWT_ACCESS_TOKEN_TTL,
  JWT_REFRESH_TOKEN_TTL,
  JWT_SECRET
};
