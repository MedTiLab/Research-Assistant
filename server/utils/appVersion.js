import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export function resolveAppVersion(fallback = '1.1.1') {
  if (process.env.npm_package_version) {
    return process.env.npm_package_version;
  }

  try {
    return require('../../package.json').version || fallback;
  } catch {
    return fallback;
  }
}
