const DEFAULT_COOLDOWN_MS = 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 1;
const DEFAULT_DOWNLOAD_MAX_ATTEMPTS = 30;
const CLEANUP_INTERVAL_ATTEMPTS = 100;

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return fallback;
}

function getClientAddress(req) {
  const forwardedFor = req.headers?.['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

function getUserIdentity(req) {
  if (req.user?.id != null) {
    return `user:${req.user.id}`;
  }
  if (req.user?.username) {
    return `username:${req.user.username}`;
  }
  return 'anonymous';
}

function cleanupExpiredEntries(store, now) {
  for (const [key, entry] of store.entries()) {
    if (!entry || entry.resetAt <= now) {
      store.delete(key);
    }
  }
}

export function createCooldownRateLimiter({
  action,
  windowMs = parsePositiveInteger(process.env.DOWNLOAD_RATE_LIMIT_WINDOW_MS, DEFAULT_COOLDOWN_MS),
  max = DEFAULT_MAX_ATTEMPTS,
  keyGenerator,
  message = 'Too many requests. Please wait before trying again.',
} = {}) {
  if (!action) {
    throw new Error('createCooldownRateLimiter requires an action name');
  }

  const limitWindowMs = parsePositiveInteger(windowMs, DEFAULT_COOLDOWN_MS);
  const maxAttempts = parsePositiveInteger(max, DEFAULT_MAX_ATTEMPTS);
  const store = new Map();
  let attemptsSinceCleanup = 0;

  return (req, res, next) => {
    const now = Date.now();
    attemptsSinceCleanup += 1;
    if (attemptsSinceCleanup >= CLEANUP_INTERVAL_ATTEMPTS) {
      attemptsSinceCleanup = 0;
      cleanupExpiredEntries(store, now);
    }

    const key = keyGenerator
      ? keyGenerator(req)
      : `${action}:${getUserIdentity(req)}:${getClientAddress(req)}`;
    const existing = store.get(key);
    const entry = existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + limitWindowMs };

    if (entry.count >= maxAttempts) {
      const retryAfterMs = Math.max(0, entry.resetAt - now);
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));

      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.setHeader('X-RateLimit-Limit', String(maxAttempts));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

      return res.status(429).json({
        error: message,
        code: 'RATE_LIMITED',
        action,
        retryAfterMs,
        retryAfterSeconds,
        resetAt: new Date(entry.resetAt).toISOString(),
      });
    }

    entry.count += 1;
    store.set(key, entry);
    res.setHeader('X-RateLimit-Limit', String(maxAttempts));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, maxAttempts - entry.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
    return next();
  };
}

export function createDownloadRateLimiter(options = {}) {
  return createCooldownRateLimiter({
    max: parsePositiveInteger(process.env.DOWNLOAD_RATE_LIMIT_MAX, DEFAULT_DOWNLOAD_MAX_ATTEMPTS),
    message: 'Download is temporarily limited. Please wait before trying again.',
    ...options,
  });
}

export function createDataExportRateLimiter(options = {}) {
  return createCooldownRateLimiter({
    message: 'Data export is temporarily limited. Please wait before trying again.',
    ...options,
  });
}
