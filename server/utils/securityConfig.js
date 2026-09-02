export const DEV_JWT_SECRET = 'claude-ui-dev-secret-change-in-production';

export function isProductionLikeServer({ nodeEnv, isLocalKernel, isDesktop }) {
  if (isLocalKernel || isDesktop) {
    return false;
  }
  return nodeEnv === 'production';
}

export function assertTrustedJwtSecret({ jwtSecret, nodeEnv, isLocalKernel, isDesktop }) {
  if (!isProductionLikeServer({ nodeEnv, isLocalKernel, isDesktop })) {
    return;
  }
  if (!jwtSecret || jwtSecret === DEV_JWT_SECRET) {
    throw new Error(
      'Refusing to start: JWT_SECRET is unset or is the built-in development secret. '
      + 'Set a strong JWT_SECRET (and JWT_PREVIOUS_SECRETS for rotation) before deploying.',
    );
  }
}

export function sanitizeAllowedOrigins(origins, { allowWildcard }) {
  if (allowWildcard) {
    return origins;
  }
  return origins.filter((origin) => origin !== '*');
}
