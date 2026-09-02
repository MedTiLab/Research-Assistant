import COS from 'cos-nodejs-sdk-v5';

let cachedClient = null;
let cachedClientIdentity = '';

export function getCosPublicDownloadConfig() {
  return {
    secretId: String(process.env.TENCENT_COS_SECRET_ID || '').trim(),
    secretKey: String(process.env.TENCENT_COS_SECRET_KEY || '').trim(),
    bucket: String(process.env.TENCENT_COS_BUCKET || '').trim(),
    region: String(process.env.TENCENT_COS_REGION || 'ap-shanghai').trim(),
  };
}

export function isCosPublicDownloadConfigured(config = getCosPublicDownloadConfig()) {
  return Boolean(config.secretId && config.secretKey && config.bucket && config.region);
}

function getCosClient(config) {
  const identity = `${config.secretId}:${config.secretKey}`;
  if (!cachedClient || cachedClientIdentity !== identity) {
    cachedClient = new COS({
      SecretId: config.secretId,
      SecretKey: config.secretKey,
    });
    cachedClientIdentity = identity;
  }
  return cachedClient;
}

export function createCosPublicDownloadUrl(objectKey, {
  config = getCosPublicDownloadConfig(),
  expires = 60 * 60,
} = {}) {
  if (!isCosPublicDownloadConfigured(config)) {
    return Promise.reject(new Error('COS public download signing is not configured'));
  }

  return new Promise((resolve, reject) => {
    getCosClient(config).getObjectUrl({
      Bucket: config.bucket,
      Region: config.region,
      Key: objectKey,
      Sign: true,
      Expires: expires,
    }, (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(data.Url);
    });
  });
}

