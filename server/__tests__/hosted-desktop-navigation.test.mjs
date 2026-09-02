import { describe, expect, it } from 'vitest';

import {
  isHostedHttpUrl,
  isRendererOwnedNavigationUrl,
} from '../../desktop/online/hostedNavigation.mjs';

const CLOUD_ORIGIN = 'https://app.medtimehelp.com';

describe('hosted desktop navigation', () => {
  it('recognizes renderer-owned image URLs that must not replace the app', () => {
    expect(isRendererOwnedNavigationUrl('blob:https://app.medtimehelp.com/image-id')).toBe(true);
    expect(isRendererOwnedNavigationUrl('data:image/png;base64,YWJj')).toBe(true);
  });

  it('only treats HTTP(S) pages as hosted application URLs', () => {
    expect(isHostedHttpUrl('https://app.medtimehelp.com/chat', CLOUD_ORIGIN)).toBe(true);
    expect(isHostedHttpUrl('blob:https://app.medtimehelp.com/image-id', CLOUD_ORIGIN)).toBe(false);
    expect(isHostedHttpUrl('data:image/png;base64,YWJj', CLOUD_ORIGIN)).toBe(false);
    expect(isHostedHttpUrl('https://example.com/image.png', CLOUD_ORIGIN)).toBe(false);
  });
});
