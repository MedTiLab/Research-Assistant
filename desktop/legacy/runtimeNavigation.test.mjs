import { describe, expect, it } from 'vitest';

import { isRuntimeAppUrl, resolveRuntimeAppUrl } from './runtimeNavigation.mjs';

describe('Legacy Runtime renderer navigation', () => {
  it('loads the Runtime root when leaving the static boot shell', () => {
    expect(resolveRuntimeAppUrl('http://127.0.0.1:3001', 'file:///runtime-shell.html'))
      .toBe('http://127.0.0.1:3001/');
  });

  it('preserves the active route when a restarted Runtime changes port', () => {
    expect(resolveRuntimeAppUrl(
      'http://127.0.0.1:3012',
      'http://127.0.0.1:3001/session/abc?panel=files#detail',
      { preserveRoute: true },
    )).toBe('http://127.0.0.1:3012/session/abc?panel=files#detail');
  });

  it('rejects non-loopback Runtime endpoints', () => {
    expect(() => resolveRuntimeAppUrl('https://example.com', '')).toThrow('Invalid loopback Runtime URL');
  });

  it('compares renderer and Runtime origins', () => {
    expect(isRuntimeAppUrl('http://127.0.0.1:3001/session/a', 'http://127.0.0.1:3001')).toBe(true);
    expect(isRuntimeAppUrl('http://127.0.0.1:3002/', 'http://127.0.0.1:3001')).toBe(false);
  });
});
