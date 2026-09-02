import { describe, expect, it } from 'vitest';

import { resolveLocalDocumentUrl, resolveOnlineResourceUrl } from './hostedNavigation.mjs';

describe('desktop hosted navigation', () => {
  const options = {
    cloudAppOrigin: 'https://app.medtimehelp.com',
    rendererOrigin: 'http://127.0.0.1:61234',
  };

  it('maps API documentation to the cloud website', () => {
    expect(resolveOnlineResourceUrl('http://127.0.0.1:61234/api-docs.html', options))
      .toBe('https://app.medtimehelp.com/api-docs.html');
  });

  it('keeps the local help page on the renderer origin', () => {
    expect(resolveOnlineResourceUrl('http://127.0.0.1:61234/help.html#start', options)).toBeNull();
    expect(resolveLocalDocumentUrl('http://127.0.0.1:61234/help.html#start', options))
      .toBe('http://127.0.0.1:61234/help.html#start');
    expect(resolveLocalDocumentUrl('https://app.medtimehelp.com/help.html', options)).toBeNull();
  });

  it('maps web download routes to the cloud website', () => {
    expect(resolveOnlineResourceUrl('http://127.0.0.1:61234/download', options))
      .toBe('https://app.medtimehelp.com/download');
    expect(resolveOnlineResourceUrl('http://127.0.0.1:61234/downloads/app.dmg', options))
      .toBe('https://app.medtimehelp.com/downloads/app.dmg');
  });

  it('does not remap application routes or third-party URLs', () => {
    expect(resolveOnlineResourceUrl('http://127.0.0.1:61234/projects/icu', options)).toBeNull();
    expect(resolveOnlineResourceUrl('https://pubmed.ncbi.nlm.nih.gov/123', options)).toBeNull();
  });
});
