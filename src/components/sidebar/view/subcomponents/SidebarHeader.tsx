import { Columns3, PanelLeftClose, RefreshCw, Search } from 'lucide-react';
import type { TFunction } from 'i18next';
import { Button } from '../../../ui/button';
import { IS_PLATFORM } from '../../../../constants/config';
import BrandLogo from '../../../BrandLogo';

type SidebarHeaderProps = {
  isPWA: boolean;
  isMobile: boolean;
  onOpenSearch: () => void;
  searchShortcut: string;
  onRefresh: () => void;
  isRefreshing: boolean;
  onCollapseSidebar: () => void;
  showDesktopActions?: boolean;
  onCollapsePrimaryNav?: () => void;
  onExpandProjectPane?: () => void;
  projectPaneVisible?: boolean;
  t: TFunction;
};

export default function SidebarHeader({
  isPWA,
  isMobile,
  onOpenSearch,
  searchShortcut,
  onRefresh,
  isRefreshing,
  onCollapseSidebar,
  showDesktopActions = true,
  onCollapsePrimaryNav,
  onExpandProjectPane,
  projectPaneVisible = true,
  t,
}: SidebarHeaderProps) {
  const searchLabel = `${t('searchPalette.open')} (${searchShortcut})`;
  const LogoBlock = () => (
    <div className="medical-brand-lockup flex items-center gap-2.5 min-w-0">
      <BrandLogo className="h-8 w-8 flex-shrink-0 opacity-100 drop-shadow-sm dark:opacity-[0.62]" />
      <div className="flex min-w-0 flex-col leading-tight">
        <h1 className="text-base font-bold tracking-tight text-foreground truncate">
          {t('app.title')}
        </h1>
      </div>
    </div>
  );

  return (
    <div className="medical-sidebar-header flex-shrink-0">
      {/* Desktop header */}
      <div
        className="hidden md:block px-3 pt-3 pb-2"
        style={{}}
      >
        <div className="flex items-center justify-between gap-2">
          {IS_PLATFORM ? (
            <a
              href="https://github.com/MedTiLab/Research-Assistant"
              className="flex items-center gap-2.5 min-w-0 hover:opacity-80 transition-opacity"
              title={t('tooltips.viewEnvironments')}
            >
              <LogoBlock />
            </a>
          ) : (
            <LogoBlock />
          )}

          {(showDesktopActions || onCollapsePrimaryNav || (!projectPaneVisible && onExpandProjectPane)) && <div className="flex items-center gap-0.5 flex-shrink-0">
            {!projectPaneVisible && onExpandProjectPane && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-accent/80 rounded-lg"
                onClick={onExpandProjectPane}
                title={t('common:versionUpdate.ariaLabels.showSidebar')}
                aria-label={t('common:versionUpdate.ariaLabels.showSidebar')}
              >
                <Columns3 className="w-3.5 h-3.5" />
              </Button>
            )}
            {onCollapsePrimaryNav && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-accent/80 rounded-lg"
                onClick={onCollapsePrimaryNav}
                title={t('tooltips.hideSidebar')}
                aria-label={t('tooltips.hideSidebar')}
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
              </Button>
            )}
            {showDesktopActions && <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-accent/80 rounded-lg"
              onClick={onOpenSearch}
              title={searchLabel}
              aria-label={searchLabel}
            >
              <Search className="w-3.5 h-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-accent/80 rounded-lg"
              onClick={onRefresh}
              disabled={isRefreshing}
              title={t('tooltips.refresh')}
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  isRefreshing ? 'animate-spin' : ''
                }`}
              />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground hover:bg-accent/80 rounded-lg"
              onClick={onCollapseSidebar}
              title={t('tooltips.hideSidebar')}
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </Button>
            </>}
          </div>}
        </div>

      </div>

      {/* Desktop divider */}
      <div className="hidden md:block nav-divider" />

      {/* Mobile header */}
      <div
        className="md:hidden p-3 pb-2"
        style={isPWA && isMobile ? { paddingTop: '16px' } : {}}
      >
        <div className="flex items-center justify-between">
          {IS_PLATFORM ? (
            <a
              href="https://github.com/MedTiLab/Research-Assistant"
              className="flex items-center gap-2.5 active:opacity-70 transition-opacity min-w-0"
              title={t('tooltips.viewEnvironments')}
            >
              <LogoBlock />
            </a>
          ) : (
            <LogoBlock />
          )}

          <div className="flex gap-1.5 flex-shrink-0">
            <button
              type="button"
              className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center active:scale-95 transition-all"
              onClick={onOpenSearch}
              aria-label={searchLabel}
              title={searchLabel}
            >
              <Search className="w-4 h-4 text-muted-foreground" />
            </button>
            <button
              type="button"
              className="w-8 h-8 rounded-lg bg-muted/50 flex items-center justify-center active:scale-95 transition-all"
              onClick={onRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw className={`w-4 h-4 text-muted-foreground ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

      </div>

      {/* Mobile divider */}
      <div className="md:hidden nav-divider" />
    </div>
  );
}
