import { describe, expect, it } from 'vitest';

import { isUpdateAvailable } from './updateCheck.mjs';

describe('shared desktop isUpdateAvailable', () => {
  it('detects a newer patch/minor/major', () => {
    expect(isUpdateAvailable('1.1.2', '1.1.3')).toBe(true);
    expect(isUpdateAvailable('1.1.2', '1.2.0')).toBe(true);
    expect(isUpdateAvailable('1.1.2', '2.0.0')).toBe(true);
  });

  it('returns false for same or older', () => {
    expect(isUpdateAvailable('1.1.2', '1.1.2')).toBe(false);
    expect(isUpdateAvailable('1.1.2', '1.1.1')).toBe(false);
    expect(isUpdateAvailable('1.2.0', '1.1.9')).toBe(false);
  });

  it('is safe on malformed input', () => {
    expect(isUpdateAvailable('1.1.2', '')).toBe(false);
    expect(isUpdateAvailable('', '1.1.2')).toBe(false);
    expect(isUpdateAvailable('1.1.2', 'not-a-version')).toBe(false);
  });
});
