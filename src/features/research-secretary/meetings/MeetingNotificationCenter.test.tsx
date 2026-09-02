import { describe, expect, it, vi } from 'vitest';
import MeetingNotificationCenter from './MeetingNotificationCenter';
import { createWorkbenchI18n, renderWorkbench } from '../renderWithI18n';

vi.mock('../../../utils/api', () => ({
  authenticatedFetch: () => Promise.resolve({ ok: true, json: async () => ({ reminders: [] }) }),
}));

vi.mock('../../../contexts/WebSocketContext', () => ({
  useWebSocket: () => ({ latestMessage: null }),
}));

describe('MeetingNotificationCenter localization', () => {
  it('renders English labels in the sidebar when the app language is English', async () => {
    const i18n = await createWorkbenchI18n('en');
    const markup = renderWorkbench(<MeetingNotificationCenter variant="rail" />, i18n);

    expect(markup).toContain('Research secretary alerts');
    expect(markup).not.toContain('科研秘书通知');
  });
});
