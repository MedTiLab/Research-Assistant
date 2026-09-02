import crypto from 'crypto';
import tencentcloud from 'tencentcloud-sdk-nodejs-ses';

const DEFAULT_CODE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SEND_COOLDOWN_MS = 60 * 1000;
const DEFAULT_RATE_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_EMAIL_SEND_LIMIT = 5;
const DEFAULT_IP_SEND_LIMIT = 20;
const DEFAULT_VERIFY_ATTEMPTS = 5;

const verificationCodes = new Map();
const emailSendHistory = new Map();
const ipSendHistory = new Map();

export class RegistrationEmailVerificationError extends Error {
  constructor(message, { code, status = 400, retryAfterMs = null } = {}) {
    super(message);
    this.name = 'RegistrationEmailVerificationError';
    this.code = code || 'EMAIL_VERIFICATION_ERROR';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseOptionalBoolean(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function resolveSesConfig(env = process.env) {
  const secretId = String(env.TENCENT_SES_SECRET_ID || env.TENCENTCLOUD_SECRET_ID || '').trim();
  const secretKey = String(env.TENCENT_SES_SECRET_KEY || env.TENCENTCLOUD_SECRET_KEY || '').trim();
  const fromEmailAddress = String(env.TENCENT_SES_FROM || '').trim();
  const templateId = Number.parseInt(String(env.TENCENT_SES_TEMPLATE_ID || ''), 10);
  const region = String(env.TENCENT_SES_REGION || 'ap-guangzhou').trim();
  const endpoint = String(env.TENCENT_SES_ENDPOINT || 'ses.tencentcloudapi.com').trim();
  const subject = String(env.TENCENT_SES_SUBJECT || 'MedTimeHelp 邮箱验证码').trim();

  return {
    secretId,
    secretKey,
    fromEmailAddress,
    templateId,
    region,
    endpoint,
    subject,
    configured: Boolean(secretId && secretKey && fromEmailAddress && Number.isInteger(templateId) && templateId > 0),
  };
}

export function getRegistrationEmailVerificationStatus(env = process.env) {
  const config = resolveSesConfig(env);
  const explicitRequired = parseOptionalBoolean(env.REGISTRATION_EMAIL_VERIFICATION_REQUIRED);
  return {
    required: explicitRequired === null ? config.configured : explicitRequired,
    configured: config.configured,
  };
}

function getVerificationHashSecret() {
  return String(
    process.env.REGISTRATION_EMAIL_VERIFICATION_SECRET
      || process.env.JWT_SECRET
      || 'medhelp-registration-email-verification',
  );
}

function hashVerificationCode(email, code) {
  return crypto
    .createHmac('sha256', getVerificationHashSecret())
    .update(`${normalizeEmail(email)}:${String(code)}`)
    .digest();
}

function getClientKey(ipAddress) {
  return String(ipAddress || 'unknown').trim() || 'unknown';
}

function pruneHistory(store, key, now, windowMs) {
  const recent = (store.get(key) || []).filter((timestamp) => timestamp > now - windowMs);
  if (recent.length > 0) store.set(key, recent);
  else store.delete(key);
  return recent;
}

function reserveSendAttempt(store, key, now, windowMs, limit, errorCode, message) {
  const history = pruneHistory(store, key, now, windowMs);
  if (history.length >= limit) {
    const retryAfterMs = Math.max(1000, history[0] + windowMs - now);
    throw new RegistrationEmailVerificationError(message, {
      code: errorCode,
      status: 429,
      retryAfterMs,
    });
  }
  history.push(now);
  store.set(key, history);
}

function releaseSendAttempt(store, key, timestamp) {
  const history = store.get(key) || [];
  const index = history.indexOf(timestamp);
  if (index >= 0) history.splice(index, 1);
  if (history.length > 0) store.set(key, history);
  else store.delete(key);
}

async function deliverWithTencentSes({ email, code }) {
  const config = resolveSesConfig();
  if (!config.configured) {
    throw new RegistrationEmailVerificationError('Email verification service is not configured', {
      code: 'EMAIL_VERIFICATION_NOT_CONFIGURED',
      status: 503,
    });
  }

  const SesClient = tencentcloud.ses.v20201002.Client;
  const client = new SesClient({
    credential: {
      secretId: config.secretId,
      secretKey: config.secretKey,
    },
    region: config.region,
    profile: {
      httpProfile: {
        endpoint: config.endpoint,
      },
    },
  });

  return client.SendEmail({
    FromEmailAddress: config.fromEmailAddress,
    Destination: [email],
    Subject: config.subject,
    Template: {
      TemplateID: config.templateId,
      TemplateData: JSON.stringify({ code }),
    },
    TriggerType: 1,
  });
}

export async function issueRegistrationVerificationCode({
  email,
  ipAddress,
  now = Date.now(),
  deliver = deliverWithTencentSes,
} = {}) {
  const normalizedEmail = normalizeEmail(email);
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(normalizedEmail)) {
    throw new RegistrationEmailVerificationError('Invalid email format', {
      code: 'INVALID_EMAIL',
      status: 400,
    });
  }

  const codeTtlMs = parsePositiveInteger(process.env.REGISTRATION_EMAIL_CODE_TTL_MS, DEFAULT_CODE_TTL_MS);
  const cooldownMs = parsePositiveInteger(
    process.env.REGISTRATION_EMAIL_SEND_COOLDOWN_MS,
    DEFAULT_SEND_COOLDOWN_MS,
  );
  const rateWindowMs = parsePositiveInteger(
    process.env.REGISTRATION_EMAIL_RATE_WINDOW_MS,
    DEFAULT_RATE_WINDOW_MS,
  );
  const emailSendLimit = parsePositiveInteger(
    process.env.REGISTRATION_EMAIL_SEND_LIMIT,
    DEFAULT_EMAIL_SEND_LIMIT,
  );
  const ipSendLimit = parsePositiveInteger(
    process.env.REGISTRATION_EMAIL_IP_SEND_LIMIT,
    DEFAULT_IP_SEND_LIMIT,
  );
  const clientKey = getClientKey(ipAddress);
  const existing = verificationCodes.get(normalizedEmail);
  const recentEmailSends = pruneHistory(emailSendHistory, normalizedEmail, now, rateWindowMs);
  const lastEmailSendAt = recentEmailSends.at(-1);

  const cooldownStartedAt = Math.max(existing?.sentAt || 0, lastEmailSendAt || 0);
  if (cooldownStartedAt > 0 && cooldownStartedAt + cooldownMs > now) {
    const retryAfterMs = cooldownStartedAt + cooldownMs - now;
    throw new RegistrationEmailVerificationError('Please wait before requesting another verification code', {
      code: 'EMAIL_VERIFICATION_COOLDOWN',
      status: 429,
      retryAfterMs,
    });
  }

  reserveSendAttempt(
    emailSendHistory,
    normalizedEmail,
    now,
    rateWindowMs,
    emailSendLimit,
    'EMAIL_VERIFICATION_EMAIL_LIMIT',
    'Too many verification emails were requested for this address',
  );

  try {
    reserveSendAttempt(
      ipSendHistory,
      clientKey,
      now,
      rateWindowMs,
      ipSendLimit,
      'EMAIL_VERIFICATION_IP_LIMIT',
      'Too many verification emails were requested from this network',
    );
  } catch (error) {
    releaseSendAttempt(emailSendHistory, normalizedEmail, now);
    throw error;
  }

  const code = String(crypto.randomInt(100000, 1000000));
  try {
    const delivery = await deliver({ email: normalizedEmail, code });
    verificationCodes.set(normalizedEmail, {
      hash: hashVerificationCode(normalizedEmail, code),
      sentAt: now,
      expiresAt: now + codeTtlMs,
      attempts: 0,
    });
    return {
      expiresInSeconds: Math.ceil(codeTtlMs / 1000),
      retryAfterSeconds: Math.ceil(cooldownMs / 1000),
      messageId: delivery?.MessageId || null,
    };
  } catch (error) {
    releaseSendAttempt(emailSendHistory, normalizedEmail, now);
    releaseSendAttempt(ipSendHistory, clientKey, now);
    if (error instanceof RegistrationEmailVerificationError) throw error;
    throw new RegistrationEmailVerificationError('Failed to send verification email', {
      code: 'EMAIL_VERIFICATION_DELIVERY_FAILED',
      status: 502,
    });
  }
}

export function consumeRegistrationVerificationCode({ email, code, now = Date.now() } = {}) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedCode = String(code || '').trim();
  const entry = verificationCodes.get(normalizedEmail);
  const maxAttempts = parsePositiveInteger(
    process.env.REGISTRATION_EMAIL_VERIFY_ATTEMPTS,
    DEFAULT_VERIFY_ATTEMPTS,
  );

  if (!entry) {
    throw new RegistrationEmailVerificationError('Please request an email verification code first', {
      code: 'EMAIL_VERIFICATION_REQUIRED',
      status: 400,
    });
  }
  if (entry.expiresAt <= now) {
    verificationCodes.delete(normalizedEmail);
    throw new RegistrationEmailVerificationError('The email verification code has expired', {
      code: 'EMAIL_VERIFICATION_EXPIRED',
      status: 400,
    });
  }
  if (!/^\d{6}$/.test(normalizedCode)) {
    throw new RegistrationEmailVerificationError('The email verification code is invalid', {
      code: 'EMAIL_VERIFICATION_INVALID',
      status: 400,
    });
  }

  const submittedHash = hashVerificationCode(normalizedEmail, normalizedCode);
  if (!crypto.timingSafeEqual(entry.hash, submittedHash)) {
    entry.attempts += 1;
    if (entry.attempts >= maxAttempts) verificationCodes.delete(normalizedEmail);
    else verificationCodes.set(normalizedEmail, entry);
    throw new RegistrationEmailVerificationError('The email verification code is invalid', {
      code: 'EMAIL_VERIFICATION_INVALID',
      status: 400,
    });
  }

  verificationCodes.delete(normalizedEmail);
  return true;
}

export function resetRegistrationEmailVerificationState() {
  verificationCodes.clear();
  emailSendHistory.clear();
  ipSendHistory.clear();
}
