import { describe, expect, it, vi } from 'vitest';

import { broadcastWorkbenchUpdate } from '../workbench-websocket.js';

describe('workbench websocket broadcast', () => {
  it('sends only to open sockets owned by the changed user', () => {
    const matching = { readyState: 1, authUserId: 7, send: vi.fn() };
    const otherUser = { readyState: 1, authUserId: 8, send: vi.fn() };
    const closed = { readyState: 3, authUserId: 7, send: vi.fn() };

    expect(broadcastWorkbenchUpdate({ clients: new Set([matching, otherUser, closed]) }, {
      userId: 7,
      scope: 'action',
      meetingId: 'meeting-1',
    })).toBe(1);
    expect(JSON.parse(matching.send.mock.calls[0][0])).toMatchObject({
      type: 'workbench-updated', scope: 'action', meetingId: 'meeting-1',
    });
    expect(otherUser.send).not.toHaveBeenCalled();
    expect(closed.send).not.toHaveBeenCalled();
  });
});
