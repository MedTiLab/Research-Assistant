import { describe, expect, it } from 'vitest';

import {
  DEV_JWT_SECRET,
  assertTrustedJwtSecret,
  isProductionLikeServer,
  sanitizeAllowedOrigins,
} from '../utils/securityConfig.js';

describe('isProductionLikeServer', () => {
  it('is true only for production cloud (not local/desktop)', () => {
    expect(isProductionLikeServer({ nodeEnv: 'production', isLocalKernel: false, isDesktop: false })).toBe(true);
    expect(isProductionLikeServer({ nodeEnv: 'production', isLocalKernel: true, isDesktop: false })).toBe(false);
    expect(isProductionLikeServer({ nodeEnv: 'production', isLocalKernel: false, isDesktop: true })).toBe(false);
    expect(isProductionLikeServer({ nodeEnv: 'development', isLocalKernel: false, isDesktop: false })).toBe(false);
  });
});

describe('assertTrustedJwtSecret', () => {
  it('throws in production with the dev default secret', () => {
    expect(() => assertTrustedJwtSecret({
      jwtSecret: DEV_JWT_SECRET, nodeEnv: 'production', isLocalKernel: false, isDesktop: false,
    })).toThrow(/JWT_SECRET/);
  });

  it('throws in production with an empty secret', () => {
    expect(() => assertTrustedJwtSecret({
      jwtSecret: '', nodeEnv: 'production', isLocalKernel: false, isDesktop: false,
    })).toThrow(/JWT_SECRET/);
  });

  it('passes in production with a strong secret', () => {
    expect(() => assertTrustedJwtSecret({
      jwtSecret: 'x'.repeat(40), nodeEnv: 'production', isLocalKernel: false, isDesktop: false,
    })).not.toThrow();
  });

  it('does not throw for local kernel or desktop even with the dev secret', () => {
    expect(() => assertTrustedJwtSecret({
      jwtSecret: DEV_JWT_SECRET, nodeEnv: 'production', isLocalKernel: true, isDesktop: false,
    })).not.toThrow();
    expect(() => assertTrustedJwtSecret({
      jwtSecret: DEV_JWT_SECRET, nodeEnv: 'production', isLocalKernel: false, isDesktop: true,
    })).not.toThrow();
  });

  it('does not throw in development', () => {
    expect(() => assertTrustedJwtSecret({
      jwtSecret: '', nodeEnv: 'development', isLocalKernel: false, isDesktop: false,
    })).not.toThrow();
  });
});

describe('sanitizeAllowedOrigins', () => {
  it('drops "*" when wildcard is not allowed', () => {
    expect(sanitizeAllowedOrigins(['*', 'https://app.medtimehelp.com'], { allowWildcard: false }))
      .toEqual(['https://app.medtimehelp.com']);
  });

  it('keeps "*" when wildcard is explicitly allowed', () => {
    expect(sanitizeAllowedOrigins(['*'], { allowWildcard: true })).toEqual(['*']);
  });
});
