import { CircleHelp, Columns3, PanelLeftOpen, Search, Settings, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import type { AppTab } from '../../../../types/app';
import { cn } from '../../../../lib/utils';
import Tooltip from '../../../Tooltip';
import MeetingNotificationCenter from '../../../../features/research-secretary/meetings/MeetingNotificationCenter';
import {
  buildSidebarNavTiles,
  groupSidebarNavTiles,
  partitionSidebarNavTiles,
  SIDEBAR_ICON_RAIL_WIDTH,
  type SidebarNavTileHandlers,
} from './sidebarNavTiles';

type SidebarIconRailProps = SidebarNavTileHandlers & {
  activeTab: AppTab;
  onExpand: () => void;
  projectPaneVisible?: boolean;
  onExpandProjectPane?: () => void;
  onOpenSearch: () => void;
  searchShortcut: string;
  onShowSettings: () => void;
  updateAvailable: boolean;
  onShowVersionModal: () => void;
  updateBusy?: boolean;
  t: TFunction;
};

function RailIconButton({
  label,
  isActive,
  onClick,
  children,
}: {
  label: string;
  isActive?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label} position="right" delay={120}>
      <button
        type="button"
        onClick={onClick}
        title={label}
        aria-label={label}
        aria-current={isActive ? 'page' : undefined}
        className={cn(
          'relative flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors',
          'hover:bg-accent/80 hover:text-foreground',
          isActive && 'bg-primary/12 text-primary shadow-sm',
        )}
      >
        {isActive && (
          <span className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary" />
        )}
        {children}
      </button>
    </Tooltip>
  );
}

export default function SidebarIconRail({
  activeTab,
  onExpand,
  projectPaneVisible = true,
  onExpandProjectPane,
  onOpenSearch,
  searchShortcut,
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
  onShowSettings,
  updateAvailable,
  onShowVersionModal,
  updateBusy = false,
  t,
}: SidebarIconRailProps) {
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
  const { railTiles } = partitionSidebarNavTiles(tiles);
  const groups = groupSidebarNavTiles(railTiles);

  return (
    <div
      className="medical-icon-rail relative z-30 flex h-full flex-shrink-0 flex-col items-center gap-1 overflow-visible border-r border-border/50 bg-card/90 py-2.5 backdrop-blur-sm dark:bg-card/80"
      style={{ width: SIDEBAR_ICON_RAIL_WIDTH }}
    >
      <RailIconButton
        label={t('common:versionUpdate.ariaLabels.showSidebar')}
        onClick={onExpand}
      >
        <PanelLeftOpen className="h-4 w-4" strokeWidth={1.9} />
      </RailIconButton>
      {!projectPaneVisible && onExpandProjectPane && (
        <RailIconButton
          label={t('common:versionUpdate.ariaLabels.showSidebar')}
          onClick={onExpandProjectPane}
        >
          <Columns3 className="h-4 w-4" strokeWidth={1.9} />
        </RailIconButton>
      )}
      <RailIconButton
        label={`${t('searchPalette.open')} (${searchShortcut})`}
        onClick={onOpenSearch}
      >
        <Search className="h-4 w-4" strokeWidth={1.9} />
      </RailIconButton>

      <div className="nav-divider my-0.5 w-7" />

      <nav className="flex w-full min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto" aria-label={t('rail.nav')}>
        {groups.map((entry, index) => (
          <div key={entry.group} className="flex w-full flex-col items-center gap-1.5">
            {index > 0 && <div className="nav-divider my-0.5 w-7" />}
            {entry.tiles.map((tile) => {
              const Icon = tile.icon;
              const isActive = tile.matchTabs.includes(activeTab);
              const label = t(tile.labelKey);

              return (
                <RailIconButton
                  key={tile.id}
                  label={label}
                  isActive={isActive}
                  onClick={tile.onClick}
                >
                  <Icon
                    className="h-5 w-5"
                    strokeWidth={isActive ? 2.25 : 1.85}
                  />
                </RailIconButton>
              );
            })}
          </div>
        ))}
      </nav>

      {updateAvailable && (
        <RailIconButton
          label={t('common:versionUpdate.ariaLabels.updateAvailable')}
          onClick={onShowVersionModal}
        >
          <Sparkles className={`h-5 w-5 text-blue-500 ${updateBusy ? 'animate-spin' : ''}`} />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
        </RailIconButton>
      )}

      <MeetingNotificationCenter variant="rail" />

      <RailIconButton
        label={t('actions.settings')}
        isActive={activeTab === 'settings'}
        onClick={onShowSettings}
      >
        <Settings className="h-5 w-5" strokeWidth={activeTab === 'settings' ? 2.25 : 1.85} />
      </RailIconButton>
      <Tooltip content={t('actions.help')} position="right" delay={120}>
        <a
          href="/help.html"
          target="_blank"
          rel="noreferrer"
          className="flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent/80 hover:text-foreground"
          aria-label={t('actions.help')}
          title={t('actions.help')}
        >
          <CircleHelp className="h-5 w-5" strokeWidth={1.85} />
        </a>
      </Tooltip>
    </div>
  );
}
