import { afterEach, describe, expect, it } from 'vitest';

import {
  getCosPublicDownloadConfig,
  isCosPublicDownloadConfigured,
} from '../utils/cosPublicDownloads.js';

const ENV_KEYS = [
  'TENCENT_COS_SECRET_ID',
  'TENCENT_COS_SECRET_KEY',
  'TENCENT_COS_BUCKET',
  'TENCENT_COS_REGION',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('COS public download configuration', () => {
  it('requires a complete signing configuration', () => {
    for (const key of ENV_KEYS) delete process.env[key];
    expect(isCosPublicDownloadConfigured()).toBe(false);

    process.env.TENCENT_COS_SECRET_ID = 'id';
    process.env.TENCENT_COS_SECRET_KEY = 'key';
    process.env.TENCENT_COS_BUCKET = 'bucket-123';
    process.env.TENCENT_COS_REGION = 'ap-shanghai';

    expect(getCosPublicDownloadConfig()).toEqual({
      secretId: 'id',
      secretKey: 'key',
      bucket: 'bucket-123',
      region: 'ap-shanghai',
    });
    expect(isCosPublicDownloadConfigured()).toBe(true);
  });
});

