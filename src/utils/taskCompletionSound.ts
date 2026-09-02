const UI_PREFERENCES_STORAGE_KEY = 'uiPreferences';
const COMPLETION_SOUND_PREFERENCE_KEY = 'completionSoundEnabled';
const MAX_TRACKED_COMPLETIONS = 500;

let webAudioContext: AudioContext | null = null;
const completedNotificationKeys = new Set<string>();

function normalizeCompletionKeys(
  sessionId?: string | null,
  relatedSessionIds: readonly string[] = [],
): string[] {
  const keys = [sessionId, ...relatedSessionIds]
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => value.trim());
  return [...new Set(keys.length > 0 ? keys : ['unscoped-completion'])];
}

function rememberCompletedKeys(keys: readonly string[]) {
  keys.forEach((key) => completedNotificationKeys.add(key));
  while (completedNotificationKeys.size > MAX_TRACKED_COMPLETIONS) {
    const oldestKey = completedNotificationKeys.values().next().value;
    if (typeof oldestKey !== 'string') break;
    completedNotificationKeys.delete(oldestKey);
  }
}

function readStoredPreference(): boolean {
  if (typeof window === 'undefined') {
    return true;
  }

  try {
    const stored = window.localStorage.getItem(UI_PREFERENCES_STORAGE_KEY);
    if (!stored) return true;
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    return typeof parsed?.[COMPLETION_SOUND_PREFERENCE_KEY] === 'boolean'
      ? parsed[COMPLETION_SOUND_PREFERENCE_KEY] as boolean
      : true;
  } catch {
    return true;
  }
}

function getWebAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const AudioContextConstructor = window.AudioContext
    || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) {
    return null;
  }

  if (!webAudioContext || webAudioContext.state === 'closed') {
    webAudioContext = new AudioContextConstructor();
  }
  return webAudioContext;
}

function scheduleChimeNote(
  context: AudioContext,
  destination: AudioNode,
  frequency: number,
  startAt: number,
  duration: number,
  peakGain: number,
) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(peakGain, startAt + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.03);
}

async function playWebCompletionChime(): Promise<boolean> {
  const context = getWebAudioContext();
  if (!context) return false;

  try {
    if (context.state === 'suspended') {
      await context.resume();
    }
    if (context.state !== 'running') {
      return false;
    }

    const masterGain = context.createGain();
    masterGain.gain.setValueAtTime(0.72, context.currentTime);
    masterGain.connect(context.destination);

    const startAt = context.currentTime + 0.015;
    scheduleChimeNote(context, masterGain, 659.25, startAt, 0.32, 0.13);
    scheduleChimeNote(context, masterGain, 880, startAt + 0.15, 0.46, 0.16);
    scheduleChimeNote(context, masterGain, 1_318.51, startAt + 0.15, 0.36, 0.035);
    return true;
  } catch {
    return false;
  }
}

export function isTaskCompletionSoundEnabled(): boolean {
  return readStoredPreference();
}

export async function primeTaskCompletionAudio(): Promise<void> {
  if (!readStoredPreference() || typeof window === 'undefined' || window.medhelpDesktop?.playCompletionSound) {
    return;
  }

  const context = getWebAudioContext();
  if (context?.state === 'suspended') {
    await context.resume().catch(() => undefined);
  }
}

export async function playTaskCompletionSound(): Promise<boolean> {
  if (typeof window === 'undefined') {
    return false;
  }

  if (window.medhelpDesktop?.playCompletionSound) {
    try {
      const played = await window.medhelpDesktop.playCompletionSound();
      if (played !== false) {
        return true;
      }
    } catch {
      // Fall back to the bundled web chime when native sound is unavailable.
    }
  }

  return playWebCompletionChime();
}

export function armTaskCompletionSound(
  sessionId?: string | null,
  relatedSessionIds: readonly string[] = [],
): void {
  normalizeCompletionKeys(sessionId, relatedSessionIds)
    .forEach((key) => completedNotificationKeys.delete(key));
}

export async function notifyTaskCompletion({
  sessionId,
  relatedSessionIds = [],
  isBackgroundConversation = false,
}: {
  sessionId?: string | null;
  relatedSessionIds?: readonly string[];
  isBackgroundConversation?: boolean;
}): Promise<boolean> {
  const completionKeys = normalizeCompletionKeys(sessionId, relatedSessionIds);
  const wasAlreadyCompleted = completionKeys.some((key) => completedNotificationKeys.has(key));
  rememberCompletedKeys(completionKeys);

  // Consume the terminal event before checking focus or preferences. Otherwise
  // a React re-render (or switching away later) can replay an old completion.
  if (wasAlreadyCompleted || !readStoredPreference() || typeof document === 'undefined') {
    return false;
  }

  const appIsInBackground = document.hidden || !document.hasFocus();
  if (!appIsInBackground && !isBackgroundConversation) {
    return false;
  }

  return playTaskCompletionSound();
}

export function resetTaskCompletionSoundForTests() {
  completedNotificationKeys.clear();
  webAudioContext = null;
}
