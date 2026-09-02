const LOCAL_NETWORK_PERMISSIONS = new Set([
  'local-network-access',
  'localNetworkAccess',
  'local-network',
  'localNetwork',
  'loopback-network',
  'loopbackNetwork',
]);

function isAudioOnlyMediaRequest(details = {}) {
  if (Array.isArray(details.mediaTypes)) {
    return details.mediaTypes.length > 0
      && details.mediaTypes.every((mediaType) => mediaType === 'audio');
  }
  return details.mediaType === 'audio';
}

export function isHostedDesktopPermissionAllowed(permission, details = {}) {
  if (LOCAL_NETWORK_PERMISSIONS.has(permission)) return true;
  return permission === 'media' && isAudioOnlyMediaRequest(details);
}
