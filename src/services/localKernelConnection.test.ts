import { beforeEach, describe, expect, it } from 'vitest';

import { getActiveLocalKernel, setActiveLocalKernel } from './localKernelConnection';

describe('localKernelConnection', () => {
  beforeEach(() => setActiveLocalKernel(null, null));

  it('returns null when not connected', () => {
    expect(getActiveLocalKernel()).toBeNull();
  });

  it('stores httpBaseUrl + token when connected', () => {
    setActiveLocalKernel({ httpBaseUrl: 'http://127.0.0.1:5055' } as any, 'mh_loc_x');
    expect(getActiveLocalKernel()).toEqual({
      httpBaseUrl: 'http://127.0.0.1:5055',
      sessionToken: 'mh_loc_x',
    });
  });

  it('clears when endpoint or token missing', () => {
    setActiveLocalKernel({ httpBaseUrl: 'http://127.0.0.1:5055' } as any, null);
    expect(getActiveLocalKernel()).toBeNull();
  });
});
