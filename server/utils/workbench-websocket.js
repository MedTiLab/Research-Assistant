import { getConnectedClientUserId, OPEN_WEBSOCKET_STATE } from './projectRealtime.js';

export function broadcastWorkbenchUpdate(wss, { userId, scope, meetingId = null } = {}) {
  if (!wss || userId == null || typeof scope !== 'string' || !scope.trim()) return 0;
  const message = JSON.stringify({
    type: 'workbench-updated',
    scope: scope.trim(),
    meetingId: meetingId || undefined,
    timestamp: new Date().toISOString(),
  });
  let delivered = 0;
  for (const client of wss.clients || []) {
    if (
      client?.readyState !== OPEN_WEBSOCKET_STATE
      || String(getConnectedClientUserId(client)) !== String(userId)
    ) continue;
    try {
      client.send(message);
      delivered += 1;
    } catch (error) {
      console.warn('[workbench] Failed to broadcast update:', error?.message || error);
    }
  }
  return delivered;
}
