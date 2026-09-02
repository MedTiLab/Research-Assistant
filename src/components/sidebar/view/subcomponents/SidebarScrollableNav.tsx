import type { TFunction } from 'i18next';
import type { AppTab } from '../../../../types/app';
import { cn } from '../../../../lib/utils';
import {
  buildSidebarNavTiles,
  partitionSidebarNavTiles,
  type SidebarNavTileHandlers,
} from './sidebarNavTiles';

type SidebarScrollableNavProps = SidebarNavTileHandlers & {
  activeTab: AppTab;
  t: TFunction;
};

export default function SidebarScrollableNav({
  activeTab,
  onOpenDashboard,
  onOpenConversationHistory,
  onOpenSubmissions,
  onOpenThesis,
  onOpenDailyReview,
  onOpenMeetings,
  onOpenAdvisor,
  onOpenAutomation,
  onOpenSkills,
  onOpenNews,
  onOpenCompanions,
  onOpenMiniApps,
  t,
}: SidebarScrollableNavProps) {
  const tiles = buildSidebarNavTiles({
    onOpenDashboard,
    onOpenConversationHistory,
    onOpenSubmissions,
    onOpenThesis,
    onOpenDailyReview,
    onOpenMeetings,
    onOpenAdvisor,
    onOpenAutomation,
    onOpenSkills,
    onOpenNews,
    onOpenCompanions,
    onOpenMiniApps,
  });
  const { railTiles, moreTiles } = partitionSidebarNavTiles(tiles);

  if (railTiles.length === 0 && moreTiles.length === 0) {
    return null;
  }

  return (
    <nav className="px-1.5 py-1 md:px-0 md:py-0" aria-label={t('rail.nav')}>
      <div className="flex flex-col gap-0.5">
        {railTiles.map((tile) => {
          const Icon = tile.icon;
          const isActive = tile.matchTabs.includes(activeTab);
          const label = t(tile.labelKey);

          return (
            <button
              key={tile.id}
              type="button"
              onClick={tile.onClick}
              title={label}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                isActive
                  ? 'bg-accent/90 text-foreground'
                  : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
              )}
            >
              <Icon
                className="h-4 w-4 flex-shrink-0"
                strokeWidth={isActive ? 2.2 : 1.85}
              />
              <span className="truncate text-[0.84375rem] font-medium">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
