import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  armTaskCompletionSound,
  notifyTaskCompletion,
  playTaskCompletionSound,
  resetTaskCompletionSoundForTests,
} from './taskCompletionSound';

describe('task completion sound', () => {
  const storage = new Map<string, string>();
  const playCompletionSound = vi.fn(async () => true);
  let hasFocus = false;

  beforeEach(() => {
    storage.clear();
    playCompletionSound.mockClear();
    hasFocus = false;
    resetTaskCompletionSoundForTests();

    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
      },
      medhelpDesktop: { playCompletionSound },
    });
    vi.stubGlobal('document', {
      hidden: false,
      hasFocus: () => hasFocus,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the native desktop sound for previews', async () => {
    await expect(playTaskCompletionSound()).resolves.toBe(true);
    expect(playCompletionSound).toHaveBeenCalledTimes(1);
  });

  it('plays when the app is not focused', async () => {
    await expect(notifyTaskCompletion({ sessionId: 'session-away' })).resolves.toBe(true);
    expect(playCompletionSound).toHaveBeenCalledTimes(1);
  });

  it('plays for another conversation while the app is focused', async () => {
    hasFocus = true;
    await expect(notifyTaskCompletion({
      sessionId: 'session-background',
      isBackgroundConversation: true,
    })).resolves.toBe(true);
    expect(playCompletionSound).toHaveBeenCalledTimes(1);
  });

  it('stays silent for the visible conversation while focused', async () => {
    hasFocus = true;
    await expect(notifyTaskCompletion({ sessionId: 'session-visible' })).resolves.toBe(false);
    expect(playCompletionSound).not.toHaveBeenCalled();
  });

  it('respects the disabled preference', async () => {
    storage.set('uiPreferences', JSON.stringify({ completionSoundEnabled: false }));
    await expect(notifyTaskCompletion({
      sessionId: 'session-disabled',
      isBackgroundConversation: true,
    })).resolves.toBe(false);
    expect(playCompletionSound).not.toHaveBeenCalled();
  });

  it('deduplicates repeated terminal events for the same task even much later', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValueOnce(2_000).mockReturnValueOnce(60_000);
    await notifyTaskCompletion({ sessionId: 'session-duplicate', isBackgroundConversation: true });
    await notifyTaskCompletion({ sessionId: 'session-duplicate', isBackgroundConversation: true });
    expect(playCompletionSound).toHaveBeenCalledTimes(1);
    now.mockRestore();
  });

  it('consumes a visible completion so switching away cannot replay it', async () => {
    hasFocus = true;
    await expect(notifyTaskCompletion({ sessionId: 'session-visible-on-complete' })).resolves.toBe(false);

    hasFocus = false;
    await expect(notifyTaskCompletion({ sessionId: 'session-visible-on-complete' })).resolves.toBe(false);
    expect(playCompletionSound).not.toHaveBeenCalled();
  });

  it('allows one new sound after the next task turn is armed', async () => {
    await notifyTaskCompletion({ sessionId: 'session-next-turn', isBackgroundConversation: true });
    await notifyTaskCompletion({ sessionId: 'session-next-turn', isBackgroundConversation: true });

    armTaskCompletionSound('session-next-turn');
    await notifyTaskCompletion({ sessionId: 'session-next-turn', isBackgroundConversation: true });

    expect(playCompletionSound).toHaveBeenCalledTimes(2);
  });

  it('deduplicates terminal events across temporary and authoritative session ids', async () => {
    await notifyTaskCompletion({
      sessionId: 'temporary-session',
      relatedSessionIds: ['temporary-session', 'authoritative-session'],
      isBackgroundConversation: true,
    });
    await notifyTaskCompletion({
      sessionId: 'authoritative-session',
      isBackgroundConversation: true,
    });

    expect(playCompletionSound).toHaveBeenCalledTimes(1);
  });
});
