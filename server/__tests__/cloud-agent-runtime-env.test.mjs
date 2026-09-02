import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveCloudAgentRuntimeEnv } from '../utils/cloudAgentRuntimeEnv.js';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

describe('cloud agent runtime environment', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the cache normally but force-refreshes credentials for a new agent turn', async () => {
    let requestCount = 0;
    const fetchMock = vi.fn(async (_url, options) => {
      requestCount += 1;
      expect(options.headers.Authorization).toBe('Bearer cloud-access-token');
      expect(options.headers['X-MedHelp-Client']).toBe('local-kernel');
      return jsonResponse({
        env: {
          MEDHELP_DATABASE_API_TOKEN: requestCount === 1 ? 'first-token' : 'second-token',
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const session = {
      cloudAccessToken: 'cloud-access-token',
      cloudBaseUrl: 'https://app.medtimehelp.com',
    };

    await expect(resolveCloudAgentRuntimeEnv(session)).resolves.toMatchObject({
      MEDHELP_DATABASE_API_TOKEN: 'first-token',
    });
    await expect(resolveCloudAgentRuntimeEnv(session)).resolves.toMatchObject({
      MEDHELP_DATABASE_API_TOKEN: 'first-token',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(resolveCloudAgentRuntimeEnv(session, { force: true })).resolves.toMatchObject({
      MEDHELP_DATABASE_API_TOKEN: 'second-token',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not attempt a cloud credential fetch without cloud login proof', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveCloudAgentRuntimeEnv({ cloudAccessToken: '' }, { force: true }))
      .resolves.toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
