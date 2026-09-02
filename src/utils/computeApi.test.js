import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildComputeApi } from './computeApi';

describe('compute API routing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('routes hosted compute selection through the browser-connected local Kernel', async () => {
    vi.stubGlobal('window', {
      location: {
        href: 'https://app.medtimehelp.com/',
        protocol: 'https:',
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    })));

    const computeApi = buildComputeApi({
      state: 'connected',
      endpoint: { httpBaseUrl: 'http://127.0.0.1:5055' },
      sessionToken: 'mh_loc_x',
    });

    await computeApi.getNodes();
    await computeApi.setActive(null);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:5055/api/local/compute/nodes',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer mh_loc_x' }),
        targetAddressSpace: 'loopback',
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:5055/api/local/compute/active',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer mh_loc_x' }),
        body: JSON.stringify({ nodeId: null }),
        targetAddressSpace: 'loopback',
      }),
    );
  });
});
