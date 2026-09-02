import { afterEach, describe, expect, it, vi } from 'vitest';

import { getOnlineResourceUrl } from './onlineResources';

describe('getOnlineResourceUrl', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the cloud origin inside the desktop app', () => {
    vi.stubGlobal('window', {
      medhelpDesktop: { cloudAppOrigin: 'https://app.medtimehelp.com' },
    });
    expect(getOnlineResourceUrl('/api-docs.html'))
      .toBe('https://app.medtimehelp.com/api-docs.html');
  });

  it('keeps web links same-origin outside the desktop app', () => {
    vi.stubGlobal('window', {});
    expect(getOnlineResourceUrl('api-docs.html')).toBe('/api-docs.html');
  });
});
