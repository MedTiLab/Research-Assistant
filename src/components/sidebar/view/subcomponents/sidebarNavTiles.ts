import {
  AppWindow,
  BookOpenCheck,
  Bot,
  ClipboardCheck,
  FileCheck2,
  History,
  LayoutDashboard,
  MessageSquareText,
  Newspaper,
  Presentation,
  HeartHandshake,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import type { AppTab } from '../../../../types/app';
import { isAppModuleVisible, isAppTabVisible, type AppModuleId } from '../../../../config/appModules';

/** Shared physical frame for both desktop icon rails; follows Appearance > Interface scale. */
export const SIDEBAR_ICON_RAIL_WIDTH = '3.5rem';

/** Width of the desktop-only global navigation column in the expanded three-pane shell. */
export const SIDEBAR_DESKTOP_NAV_WIDTH = 176;

/** Numeric counterpart used by chat layout calculations that reserve rail space. */
export function getSidebarIconRailWidth(uiFontScale: number) {
  const normalizedScale = Number.isFinite(uiFontScale) ? uiFontScale / 100 : 1;
  return 56 * normalizedScale;
}

export type SidebarNavTileId =
  | 'dashboard'
  | 'conversationHistory'
  | 'submissions'
  | 'thesis'
  | 'dailyReview'
  | 'meetings'
  | 'advisor'
  | 'automation'
  | 'skills'
  | 'companions'
  | 'miniApps'
  | 'news';

export type SidebarNavGroup = 'research';
export type SidebarNavPlacement = 'rail' | 'more';

export type SidebarNavTile = {
  id: SidebarNavTileId;
  moduleId: AppModuleId;
  matchTabs: AppTab[];
  labelKey: string;
  icon: LucideIcon;
  group: SidebarNavGroup;
  placement: SidebarNavPlacement;
  onClick: () => void;
};

export type SidebarNavTileHandlers = {
  onOpenDashboard: () => void;
  onOpenConversationHistory: () => void;
  onOpenSubmissions: () => void;
  onOpenThesis: () => void;
  onOpenDailyReview: () => void;
  onOpenMeetings: () => void;
  onOpenAdvisor: () => void;
  onOpenAutomation: () => void;
  onOpenSkills: () => void;
  onOpenNews: () => void;
  onOpenCompanions: () => void;
  onOpenMiniApps: () => void;
};

export function isSidebarNavTileVisible(tile: SidebarNavTile) {
  return isAppModuleVisible(tile.moduleId) && tile.matchTabs.some((tab) => isAppTabVisible(tab));
}

export function buildSidebarNavTiles(handlers: SidebarNavTileHandlers): SidebarNavTile[] {
  const tiles: SidebarNavTile[] = [
    {
      id: 'dashboard',
      moduleId: 'dashboard',
      matchTabs: ['dashboard'],
      labelKey: 'common:tabs.dashboard',
      icon: LayoutDashboard,
      group: 'research',
      placement: 'rail',
      onClick: handlers.onOpenDashboard,
    },
    {
      id: 'meetings',
      moduleId: 'meetings',
      matchTabs: ['meetings'],
      labelKey: 'common:tabs.meetings',
      icon: Presentation,
      group: 'research',
      placement: 'rail',
      onClick: handlers.onOpenMeetings,
    },
    {
      id: 'news',
      moduleId: 'news',
      matchTabs: ['news'],
      labelKey: 'common:tabs.news',
      icon: Newspaper,
      group: 'research',
      placement: 'rail',
      onClick: handlers.onOpenNews,
    },
    {
      id: 'submissions',
      moduleId: 'submissions',
      matchTabs: ['submissions'],
      labelKey: 'common:tabs.submissions',
      icon: FileCheck2,
      group: 'research',
      placement: 'rail',
      onClick: handlers.onOpenSubmissions,
    },
    {
      id: 'thesis',
      moduleId: 'thesis',
      matchTabs: ['thesis'],
      labelKey: 'common:tabs.thesis',
      icon: BookOpenCheck,
      group: 'research',
      placement: 'rail',
      onClick: handlers.onOpenThesis,
    },
    {
      id: 'advisor',
      moduleId: 'advisor',
      matchTabs: ['advisor'],
      labelKey: 'common:tabs.advisor',
      icon: MessageSquareText,
      group: 'research',
      placement: 'rail',
      onClick: handlers.onOpenAdvisor,
    },
    {
      id: 'dailyReview',
      moduleId: 'dailyReview',
      matchTabs: ['dailyReview'],
      labelKey: 'common:tabs.dailyReview',
      icon: ClipboardCheck,
      group: 'research',
      placement: 'rail',
      onClick: handlers.onOpenDailyReview,
    },
    {
      id: 'automation',
      moduleId: 'automation',
      matchTabs: ['automation'],
      labelKey: 'common:tabs.automation',
      icon: Bot,
      group: 'research',
      placement: 'rail',
      onClick: handlers.onOpenAutomation,
    },
    {
      id: 'skills',
      moduleId: 'medlibrary',
      matchTabs: ['skills'],
      labelKey: 'common:tabs.skills',
      icon: Sparkles,
      group: 'research',
      placement: 'rail',
      onClick: handlers.onOpenSkills,
    },
    {
      id: 'companions',
      moduleId: 'companions',
      matchTabs: ['companions'],
      labelKey: 'common:tabs.companions',
      icon: HeartHandshake,
      group: 'research',
      placement: 'rail',
      onClick: handlers.onOpenCompanions,
    },
    {
      id: 'miniApps',
      moduleId: 'miniApps',
      matchTabs: ['miniApps'],
      labelKey: 'common:tabs.miniApps',
      icon: AppWindow,
      group: 'research',
      placement: 'rail',
      onClick: handlers.onOpenMiniApps,
    },
    {
      id: 'conversationHistory',
      moduleId: 'conversationHistory',
      matchTabs: ['conversationHistory'],
      labelKey: 'common:tabs.conversationHistory',
      icon: History,
      group: 'research',
      placement: 'rail',
      onClick: handlers.onOpenConversationHistory,
    },
  ];

  return tiles.filter(isSidebarNavTileVisible);
}

export const SIDEBAR_NAV_GROUP_ORDER: SidebarNavGroup[] = ['research'];

export function groupSidebarNavTiles(tiles: SidebarNavTile[]) {
  return SIDEBAR_NAV_GROUP_ORDER
    .map((group) => ({
      group,
      tiles: tiles.filter((tile) => tile.group === group),
    }))
    .filter((entry) => entry.tiles.length > 0);
}

export function partitionSidebarNavTiles(tiles: SidebarNavTile[]) {
  return {
    railTiles: tiles.filter((tile) => tile.placement !== 'more'),
    moreTiles: tiles.filter((tile) => tile.placement === 'more'),
  };
}
