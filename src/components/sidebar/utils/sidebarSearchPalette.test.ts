import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { Project } from '../../../types/app';
import type { SessionWithProvider } from '../types/types';
import {
  buildSidebarSearchPalette,
  flattenSidebarSearchItems,
  formatModShortcut,
  isApplePlatform,
  SIDEBAR_SEARCH_CHAT_LIMIT,
} from './sidebarSearchPalette';

const t = ((key: string) => {
  const labels: Record<string, string> = {
    'projects.newSession': 'New Session',
    'projects.codexSession': 'Codex Session',
    'searchPalette.newConversation': 'New conversation',
    'searchPalette.newSession': 'New analysis session',
    'searchPalette.conversationHistory': 'Conversation history',
  };
  return labels[key] || key;
}) as TFunction;

const project = (name: string, displayName = name): Project => ({
  name,
  displayName,
  fullPath: `/workspaces/${name}`,
  sessions: [],
});

const session = (
  id: string,
  summary: string,
  lastActivity: string,
): SessionWithProvider => ({
  id,
  summary,
  lastActivity,
  __provider: 'claude',
});

describe('sidebar search palette', () => {
  it('formats shortcuts for Apple and other platforms', () => {
    expect(formatModShortcut(true, 'K')).toBe('⌘K');
    expect(formatModShortcut(false, 'K')).toBe('Ctrl+K');
    expect(isApplePlatform('MacIntel')).toBe(true);
    expect(isApplePlatform('Win32')).toBe(false);
  });

  it('shows recent chats and quick actions when the query is empty', () => {
    const medhelp = project('medhelp');
    const pilot = project('PilotDeck');
    const groups = buildSidebarSearchPalette({
      projects: [medhelp, pilot],
      getSessions: (item) => {
        if (item.name === 'medhelp') {
          return [
            session('s1', 'Adjust sidebar icons', '2026-08-24T10:00:00.000Z'),
            session('s2', 'Older chat', '2026-08-20T10:00:00.000Z'),
          ];
        }
        return [session('s3', 'Pilot notes', '2026-08-23T10:00:00.000Z')];
      },
      query: '',
      t,
    });

    expect(groups.map((group) => group.id)).toEqual(['chats', 'actions']);
    expect(groups[0].items.map((item) => item.title)).toEqual([
      'Adjust sidebar icons',
      'Pilot notes',
      'Older chat',
    ]);
    expect(groups[0].items[0]).toMatchObject({
      kind: 'chat',
      projectLabel: 'medhelp',
      shortcutIndex: 1,
    });
    expect(groups[1].items.map((item) => item.id)).toEqual([
      'newConversation',
      'conversationHistory',
    ]);
  });

  it('always offers one default-folder conversation action', () => {
    const groups = buildSidebarSearchPalette({
      projects: [project('medhelp')],
      getSessions: () => [],
      query: '',
      t,
    });

    const actions = groups.find((group) => group.id === 'actions');
    expect(actions?.items.map((item) => item.id)).toEqual([
      'newConversation',
      'conversationHistory',
    ]);
  });

  it('caps the empty-state chat list and assigns numbered shortcuts', () => {
    const workspace = project('medhelp');
    const groups = buildSidebarSearchPalette({
      projects: [workspace],
      getSessions: () =>
        Array.from({ length: 12 }, (_, index) =>
          session(`s${index}`, `Chat ${index}`, `2026-08-24T${String(index).padStart(2, '0')}:00:00.000Z`),
        ),
      query: '',
      t,
    });

    const chats = groups[0].items;
    expect(chats).toHaveLength(SIDEBAR_SEARCH_CHAT_LIMIT);
    expect(chats.map((item) => (item.kind === 'chat' ? item.shortcutIndex : undefined))).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
  });

  it('matches chats by title or project name and lists matching projects', () => {
    const medhelp = project('medhelp', 'MedHelp');
    const other = project('other');
    const groups = buildSidebarSearchPalette({
      projects: [medhelp, other],
      getSessions: (item) => {
        if (item.name === 'medhelp') {
          return [session('s1', 'Sidebar search', '2026-08-24T10:00:00.000Z')];
        }
        return [session('s2', 'Unrelated', '2026-08-24T09:00:00.000Z')];
      },
      query: 'medhelp',
      t,
    });

    expect(groups.map((group) => group.id)).toEqual(['chats', 'projects']);
    expect(groups[0].items).toHaveLength(1);
    expect(groups[0].items[0]).toMatchObject({ kind: 'chat', title: 'Sidebar search' });
    expect(groups[1].items[0]).toMatchObject({ kind: 'project', title: 'MedHelp' });
    expect(groups[0].items[0].kind === 'chat' && groups[0].items[0].shortcutIndex).toBeUndefined();
  });

  it('filters quick actions by the current language label', () => {
    const groups = buildSidebarSearchPalette({
      projects: [project('medhelp')],
      getSessions: () => [session('s1', 'Chat', '2026-08-24T10:00:00.000Z')],
      query: 'history',
      t,
    });

    const items = flattenSidebarSearchItems(groups);
    expect(items.filter((item) => item.kind === 'action').map((item) => item.id)).toEqual([
      'conversationHistory',
    ]);
  });
});
