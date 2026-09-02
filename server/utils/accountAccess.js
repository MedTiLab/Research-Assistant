function normalizeUtcTimestamp(value) {
  if (!value) return null;
  const timestamp = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(timestamp)) {
    return `${timestamp.replace(' ', 'T')}Z`;
  }
  return timestamp;
}

function timestampToMilliseconds(value) {
  const parsed = Date.parse(normalizeUtcTimestamp(value) || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function hasActiveProMembership(user, now = Date.now()) {
  if (String(user?.membership_plan || 'free').trim().toLowerCase() !== 'pro') {
    return false;
  }

  const expiresMs = timestampToMilliseconds(user?.membership_expires_at);
  return expiresMs == null || expiresMs > now;
}

function isTrialExpiredForAccess(user, now = Date.now()) {
  if (hasActiveProMembership(user, now)) {
    return false;
  }

  const expiresMs = timestampToMilliseconds(user?.trial_expires_at);
  return expiresMs != null && expiresMs <= now;
}

export {
  hasActiveProMembership,
  isTrialExpiredForAccess,
  normalizeUtcTimestamp,
  timestampToMilliseconds,
};
