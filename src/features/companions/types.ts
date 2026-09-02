export type CompanionAvatar = 'mochi' | 'ink' | 'roux' | 'pixel' | 'bolt' | 'boo';
export type CompanionMood = 'calm' | 'happy' | 'focused' | 'sleepy';

export interface Companion {
  id: string;
  name: string;
  avatar: CompanionAvatar;
  persona: string;
  desktopEnabled: boolean;
  isDefault: boolean;
  mood: CompanionMood;
  xp: number;
  level: number;
  createdAt: string;
  updatedAt: string;
}

export interface CompanionMemory {
  id: string;
  content: string;
  category: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export const COMPANION_AVATARS: Array<{ id: CompanionAvatar; glyph: string; color: string }> = [
  { id: 'mochi', glyph: '●ᴗ●', color: 'from-rose-200 to-orange-100' },
  { id: 'ink', glyph: '◕‿◕', color: 'from-indigo-200 to-sky-100' },
  { id: 'roux', glyph: 'ᵔᴥᵔ', color: 'from-amber-200 to-yellow-100' },
  { id: 'pixel', glyph: '■‿■', color: 'from-emerald-200 to-cyan-100' },
  { id: 'bolt', glyph: 'ϟᴗϟ', color: 'from-yellow-200 to-lime-100' },
  { id: 'boo', glyph: '◉ᴗ◉', color: 'from-violet-200 to-fuchsia-100' },
];

export function companionAvatar(avatar: string) {
  return COMPANION_AVATARS.find((item) => item.id === avatar) || COMPANION_AVATARS[0];
}
