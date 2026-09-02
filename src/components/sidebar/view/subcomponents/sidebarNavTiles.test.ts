import { describe, expect, it, vi } from 'vitest';

import {
  buildSidebarNavTiles,
  groupSidebarNavTiles,
  partitionSidebarNavTiles,
} from './sidebarNavTiles';

const handlers = {
  onOpenDashboard: vi.fn(),
  onOpenConversationHistory: vi.fn(),
  onOpenSubmissions: vi.fn(),
  onOpenThesis: vi.fn(),
  onOpenDailyReview: vi.fn(),
  onOpenMeetings: vi.fn(),
  onOpenAdvisor: vi.fn(),
  onOpenAutomation: vi.fn(),
  onOpenSkills: vi.fn(),
  onOpenNews: vi.fn(),
  onOpenCompanions: vi.fn(),
  onOpenMiniApps: vi.fn(),
};

describe('sidebar nav tiles', () => {
  it('keeps the core research operations destinations on the rail', () => {
    const { railTiles } = partitionSidebarNavTiles(buildSidebarNavTiles(handlers));

    expect(railTiles.map((tile) => tile.id)).toEqual([
      'dashboard',
      'meetings',
      'news',
      'submissions',
      'thesis',
      'advisor',
      'dailyReview',
      'automation',
      'skills',
      'miniApps',
      'conversationHistory',
    ]);
  });

  it('does not hide secondary destinations behind a more menu', () => {
    const { moreTiles } = partitionSidebarNavTiles(buildSidebarNavTiles(handlers));

    expect(moreTiles).toEqual([]);
  });

  it('keeps all destinations in one research group', () => {
    const groups = groupSidebarNavTiles(buildSidebarNavTiles(handlers));

    expect(groups.map((entry) => [entry.group, entry.tiles.map((tile) => tile.id)])).toEqual([
      ['research', [
        'dashboard',
        'meetings',
        'news',
        'submissions',
        'thesis',
        'advisor',
        'dailyReview',
        'automation',
        'skills',
        'miniApps',
        'conversationHistory',
      ]],
    ]);
  });
});
