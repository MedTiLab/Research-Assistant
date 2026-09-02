import fs from 'node:fs';
import path from 'node:path';

const SESSION_FORMAT_VERSION = 1;
const MAX_TOKEN_LENGTH = 16_384;
const MAX_ENCRYPTED_PAYLOAD_BYTES = 256 * 1024;

function cleanOptionalString(value, maxLength = MAX_TOKEN_LENGTH) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function sanitizeSession(payload = {}) {
  const accessToken = cleanOptionalString(payload.accessToken || payload.token);
  if (!accessToken) {
    throw new Error('A valid access token is required');
  }

  const session = {
    accessToken,
    refreshToken: cleanOptionalString(payload.refreshToken),
    tokenType: cleanOptionalString(payload.tokenType, 64) || 'Bearer',
    expiresIn: Number.isFinite(payload.expiresIn) ? payload.expiresIn : null,
    refreshExpiresIn: Number.isFinite(payload.refreshExpiresIn) ? payload.refreshExpiresIn : null,
    sessionId: cleanOptionalString(payload.sessionId, 512),
    deviceFingerprint: cleanOptionalString(payload.deviceFingerprint, 512),
    user: payload.user && typeof payload.user === 'object' ? payload.user : null,
  };
  const serialized = JSON.stringify(session);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_ENCRYPTED_PAYLOAD_BYTES) {
    throw new Error('Desktop authentication session is too large');
  }
  return serialized;
}

export function saveDesktopAuthSession(filePath, safeStorage, payload) {
  if (!safeStorage?.isEncryptionAvailable?.()) return false;
  const serialized = sanitizeSession(payload);
  const encryptedPayload = safeStorage.encryptString(serialized).toString('base64');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({
    version: SESSION_FORMAT_VERSION,
    encryptedPayload,
  }), { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
  return true;
}

export function readDesktopAuthSession(filePath, safeStorage) {
  if (!safeStorage?.isEncryptionAvailable?.() || !fs.existsSync(filePath)) return null;
  try {
    const saved = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (
      saved?.version !== SESSION_FORMAT_VERSION
      || typeof saved.encryptedPayload !== 'string'
      || Buffer.byteLength(saved.encryptedPayload, 'base64') > MAX_ENCRYPTED_PAYLOAD_BYTES
    ) {
      return null;
    }
    const decrypted = safeStorage.decryptString(Buffer.from(saved.encryptedPayload, 'base64'));
    const session = JSON.parse(decrypted);
    return JSON.parse(sanitizeSession(session));
  } catch {
    return null;
  }
}

export function clearDesktopAuthSession(filePath) {
  fs.rmSync(filePath, { force: true });
}
