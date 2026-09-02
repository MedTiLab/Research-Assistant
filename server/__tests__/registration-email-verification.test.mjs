import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  consumeRegistrationVerificationCode,
  getRegistrationEmailVerificationStatus,
  issueRegistrationVerificationCode,
  resetRegistrationEmailVerificationState,
} from '../utils/registrationEmailVerification.js';

const originalEnv = {
  REGISTRATION_EMAIL_VERIFICATION_REQUIRED: process.env.REGISTRATION_EMAIL_VERIFICATION_REQUIRED,
  REGISTRATION_EMAIL_VERIFICATION_SECRET: process.env.REGISTRATION_EMAIL_VERIFICATION_SECRET,
  REGISTRATION_EMAIL_CODE_TTL_MS: process.env.REGISTRATION_EMAIL_CODE_TTL_MS,
  REGISTRATION_EMAIL_SEND_COOLDOWN_MS: process.env.REGISTRATION_EMAIL_SEND_COOLDOWN_MS,
  TENCENT_SES_SECRET_ID: process.env.TENCENT_SES_SECRET_ID,
  TENCENT_SES_SECRET_KEY: process.env.TENCENT_SES_SECRET_KEY,
  TENCENT_SES_FROM: process.env.TENCENT_SES_FROM,
  TENCENT_SES_TEMPLATE_ID: process.env.TENCENT_SES_TEMPLATE_ID,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('registration email verification', () => {
  beforeEach(() => {
    resetRegistrationEmailVerificationState();
    process.env.REGISTRATION_EMAIL_VERIFICATION_SECRET = 'test-email-verification-secret';
    process.env.REGISTRATION_EMAIL_CODE_TTL_MS = '300000';
    process.env.REGISTRATION_EMAIL_SEND_COOLDOWN_MS = '60000';
  });

  afterEach(() => {
    resetRegistrationEmailVerificationState();
    restoreEnv();
  });

  it('issues a six-digit code, verifies it once, and rejects replay', async () => {
    let deliveredCode = null;
    const result = await issueRegistrationVerificationCode({
      email: 'Person@Example.com',
      ipAddress: '127.0.0.1',
      now: 1_000,
      deliver: async ({ email, code }) => {
        expect(email).toBe('person@example.com');
        deliveredCode = code;
        return { MessageId: 'message-1' };
      },
    });

    expect(deliveredCode).toMatch(/^\d{6}$/);
    expect(result).toMatchObject({
      expiresInSeconds: 300,
      retryAfterSeconds: 60,
      messageId: 'message-1',
    });
    expect(consumeRegistrationVerificationCode({
      email: 'PERSON@example.com',
      code: deliveredCode,
      now: 2_000,
    })).toBe(true);
    expect(() => consumeRegistrationVerificationCode({
      email: 'person@example.com',
      code: deliveredCode,
      now: 2_000,
    })).toThrow('Please request an email verification code first');
  });

  it('enforces resend cooldown and code expiration', async () => {
    let deliveredCode = null;
    const deliver = async ({ code }) => {
      deliveredCode = code;
      return {};
    };

    await issueRegistrationVerificationCode({
      email: 'person@example.com',
      ipAddress: '127.0.0.1',
      now: 10_000,
      deliver,
    });
    await expect(issueRegistrationVerificationCode({
      email: 'person@example.com',
      ipAddress: '127.0.0.1',
      now: 20_000,
      deliver,
    })).rejects.toMatchObject({
      code: 'EMAIL_VERIFICATION_COOLDOWN',
      status: 429,
    });
    expect(() => consumeRegistrationVerificationCode({
      email: 'person@example.com',
      code: deliveredCode,
      now: 310_001,
    })).toThrow('expired');
  });

  it('automatically requires verification when SES is fully configured', () => {
    delete process.env.REGISTRATION_EMAIL_VERIFICATION_REQUIRED;
    process.env.TENCENT_SES_SECRET_ID = 'secret-id';
    process.env.TENCENT_SES_SECRET_KEY = 'secret-key';
    process.env.TENCENT_SES_FROM = 'MedTimeHelp <noreply@notify.medtimehelp.com>';
    process.env.TENCENT_SES_TEMPLATE_ID = '123456';

    expect(getRegistrationEmailVerificationStatus()).toEqual({
      required: true,
      configured: true,
    });
  });
});
