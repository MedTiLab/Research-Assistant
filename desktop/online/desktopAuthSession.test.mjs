import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  clearDesktopAuthSession,
  readDesktopAuthSession,
  saveDesktopAuthSession,
} from './desktopAuthSession.mjs';

let tempRoot = null;

function createSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (value) => value.toString('utf8').replace(/^encrypted:/, ''),
  };
}

afterEach(() => {
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

describe('desktop authentication session persistence', () => {
  it('round-trips the tokens through encrypted storage with owner-only permissions', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'medhelp-desktop-auth-'));
    const sessionPath = path.join(tempRoot, 'session.json');
    const safeStorage = createSafeStorage();

    expect(saveDesktopAuthSession(sessionPath, safeStorage, {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      sessionId: 'session-id',
      deviceFingerprint: 'device-id',
      user: { id: 'user-1' },
    })).toBe(true);

    const raw = fs.readFileSync(sessionPath, 'utf8');
    expect(raw).not.toContain('access-token');
    expect(raw).not.toContain('refresh-token');
    expect(fs.statSync(sessionPath).mode & 0o777).toBe(0o600);
    expect(readDesktopAuthSession(sessionPath, safeStorage)).toMatchObject({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      sessionId: 'session-id',
      deviceFingerprint: 'device-id',
      user: { id: 'user-1' },
    });
  });

  it('returns no session for corrupt or unavailable encrypted storage', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'medhelp-desktop-auth-'));
    const sessionPath = path.join(tempRoot, 'session.json');
    fs.writeFileSync(sessionPath, '{"version":1,"encryptedPayload":"broken"}');

    expect(readDesktopAuthSession(sessionPath, createSafeStorage())).toBeNull();
    expect(saveDesktopAuthSession(sessionPath, { isEncryptionAvailable: () => false }, {
      accessToken: 'access-token',
    })).toBe(false);
  });

  it('removes the persisted session on logout', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'medhelp-desktop-auth-'));
    const sessionPath = path.join(tempRoot, 'session.json');
    saveDesktopAuthSession(sessionPath, createSafeStorage(), { accessToken: 'access-token' });

    clearDesktopAuthSession(sessionPath);

    expect(fs.existsSync(sessionPath)).toBe(false);
  });
});
