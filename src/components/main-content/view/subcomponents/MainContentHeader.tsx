import { ArrowLeft, ChevronsLeft, ChevronsRight, PanelRightOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import MobileMenuButton from './MobileMenuButton';
import MainContentTitle from './MainContentTitle';
import type { MainContentHeaderProps } from '../../types/types';
import type { AppTab } from '../../../../types/app';
import { cn } from '../../../../lib/utils';

const GLOBAL_BACK_TABS: AppTab[] = ['trash'];

/** Project sub-views opened from the session sidebar — back on the right, near the sidebar. */
const PROJECT_SUBPAGE_BACK_TABS: AppTab[] = [
  'survey',
  'files',
  'git',
  'context',
];

const SIDEBAR_CONTROL_BUTTON_CLASS = 'h-8 min-h-8 w-8 min-w-8';
const SIDEBAR_CONTROL_ICON_CLASS = 'h-3.5 w-3.5';
const MAIN_HEADER_ROW_CLASS = 'min-h-[68px] items-center gap-3 transition-transform duration-300 ease-out';

function HeaderBackButton({
  onClick,
  label,
  useChevronsIcon = false,
  sidebarStyle = false,
}: {
  onClick: () => void;
  label: string;
  useChevronsIcon?: boolean;
  sidebarStyle?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex flex-none items-center justify-center rounded-lg border border-border/70 bg-background/85 p-0 leading-none text-muted-foreground shadow-sm transition-colors hover:text-foreground [&_svg]:block',
        sidebarStyle ? SIDEBAR_CONTROL_BUTTON_CLASS : 'h-8 w-8',
      )}
      aria-label={label}
      title={label}
    >
      {sidebarStyle ? (
        <ChevronsRight className={SIDEBAR_CONTROL_ICON_CLASS} strokeWidth={2} />
      ) : useChevronsIcon ? (
        <ChevronsLeft className="h-5 w-5" strokeWidth={2} />
      ) : (
        <ArrowLeft className="h-4 w-4" strokeWidth={2} />
      )}
    </button>
  );
}

export default function MainContentHeader({
  activeTab,
  setActiveTab,
  selectedProject,
  selectedSession,
  isMobile,
  onMenuClick,
  onNavigateBack,
  contentInsetRight = 0,
  showExpandContextSidebar = false,
  onExpandContextSidebar,
}: MainContentHeaderProps) {
  const { t } = useTranslation();
  const backLabel = t('common:navigation.back');
  const expandSidebarLabel = t('chat:sessionContext.actions.expand');
  const showLeftBack = Boolean(onNavigateBack) && GLOBAL_BACK_TABS.includes(activeTab);
  const showRightBack = Boolean(onNavigateBack)
    && Boolean(selectedProject)
    && PROJECT_SUBPAGE_BACK_TABS.includes(activeTab);
  return (
    <div
      className={cn(
        'medical-workbench-header bg-background border-b border-border/60 px-3 sm:px-4 flex-shrink-0',
        isMobile && 'pwa-header-safe',
      )}
    >
      <div
        className={cn(MAIN_HEADER_ROW_CLASS, 'flex')}
        style={contentInsetRight > 0 ? { paddingRight: contentInsetRight } : undefined}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
          {isMobile && <MobileMenuButton onMenuClick={onMenuClick} />}

          {showLeftBack && onNavigateBack && (
            <HeaderBackButton
              onClick={onNavigateBack}
              label={backLabel}
            />
          )}

          <MainContentTitle
            activeTab={activeTab}
            selectedProject={selectedProject}
            selectedSession={selectedSession}
            isMobile={isMobile}
          />
        </div>

        <div className="flex items-center justify-end gap-2">
          {showRightBack && onNavigateBack && (
            <HeaderBackButton onClick={onNavigateBack} label={backLabel} sidebarStyle />
          )}

          {showExpandContextSidebar && onExpandContextSidebar && (
            <button
              type="button"
              onClick={onExpandContextSidebar}
              className={cn(
                'inline-flex flex-none items-center justify-center rounded-lg border border-border/70 bg-background/85 p-0 leading-none text-muted-foreground shadow-sm transition-colors hover:text-foreground [&_svg]:block',
                SIDEBAR_CONTROL_BUTTON_CLASS,
              )}
              aria-label={expandSidebarLabel}
              title={expandSidebarLabel}
            >
              <PanelRightOpen className={SIDEBAR_CONTROL_ICON_CLASS} strokeWidth={2} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
