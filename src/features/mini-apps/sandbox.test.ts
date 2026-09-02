import { describe, expect, it } from 'vitest';
import { sandboxMiniAppHtml } from './sandbox';

describe('mini app sandbox document', () => {
  it('injects a restrictive CSP into an existing head', () => {
    const result = sandboxMiniAppHtml('<!doctype html><html><head><title>x</title></head><body></body></html>');
    expect(result).toContain('Content-Security-Policy');
    expect(result).toContain("default-src 'none'");
    expect(result).toContain("connect-src 'none'");
    expect(result.indexOf('Content-Security-Policy')).toBeLessThan(result.indexOf('<title>'));
  });

  it('creates a head when the imported document omitted one', () => {
    const result = sandboxMiniAppHtml('<html><body>hello</body></html>');
    expect(result).toContain('<head><meta http-equiv="Content-Security-Policy"');
    expect(result).toContain('<body>hello</body>');
  });
});
