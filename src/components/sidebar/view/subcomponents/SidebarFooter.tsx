import { Settings, ArrowUpCircle, CircleHelp } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useAuth } from '../../../../contexts/AuthContext';
import UserAvatar from '../../../user-avatar/UserAvatar';
import MeetingNotificationCenter from '../../../../features/research-secretary/meetings/MeetingNotificationCenter';

type SidebarFooterProps = {
  updateAvailable: boolean;
  onShowVersionModal: () => void;
  updateLabel?: string;
  updateBusy?: boolean;
  onShowSettings: () => void;
  settingsActive?: boolean;
  t: TFunction;
};

type SidebarAuthUser = {
  username?: string | null;
  avatarId?: string | null;
  avatarUrl?: string | null;
};

function SidebarFooterAvatar({
  user,
  username,
  size,
}: {
  user?: SidebarAuthUser | null;
  username: string;
  size: number;
}) {
  return (
    <UserAvatar
      avatarId={user?.avatarId || undefined}
      avatarUrl={user?.avatarUrl || undefined}
      seed={username}
      size={size}
      decorative
      fallback="initials"
    />
  );
}

export default function SidebarFooter({
  updateAvailable,
  onShowVersionModal,
  updateLabel,
  updateBusy = false,
  onShowSettings,
  settingsActive = false,
  t,
}: SidebarFooterProps) {
  const { user } = useAuth() as { user?: SidebarAuthUser | null };
  const username = typeof user?.username === 'string' ? user.username.trim() : '';

  return (
    <div className="relative z-40 flex-shrink-0 overflow-visible" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}>
      <div className="nav-divider" />

      <div className="hidden h-11 items-center gap-1 px-2 md:flex">
        <button
          type="button"
          className={`flex h-8 min-w-0 flex-1 items-center rounded-lg pl-2 pr-1 transition-colors ${
            settingsActive
              ? 'bg-primary/12 text-primary'
              : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
          }`}
          onClick={onShowSettings}
          aria-current={settingsActive ? 'page' : undefined}
        >
          <Settings className="h-4 w-4 shrink-0" />
          <span className="ml-1.5 inline-flex h-4 shrink-0 items-center text-sm font-medium leading-none">{t('actions.settings')}</span>
          {username ? (
            <span className="ml-auto flex h-8 shrink-0 items-center justify-center">
              <SidebarFooterAvatar user={user} username={username} size={20} />
            </span>
          ) : null}
        </button>
        <MeetingNotificationCenter variant="footer" />
        <a
          href="/help.html"
          target="_blank"
          rel="noreferrer"
          aria-label={t('actions.help')}
          title={t('actions.help')}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          <CircleHelp className="h-4 w-4" />
        </a>
        {updateAvailable && (
          <button
            type="button"
            className="flex h-8 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-blue-50/80 px-2.5 text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-900/15 dark:text-blue-300 dark:hover:bg-blue-900/25"
            onClick={onShowVersionModal}
            disabled={updateBusy}
          >
            <ArrowUpCircle className={`h-4 w-4 shrink-0 ${updateBusy ? 'animate-spin' : ''}`} />
            <span className="text-sm font-medium leading-none">{updateLabel || t('common:versionUpdate.buttons.updateNow')}</span>
          </button>
        )}
      </div>

      <div className="p-3 pb-20 md:hidden">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`flex h-12 min-w-0 flex-1 items-center gap-3.5 rounded-xl px-4 transition-all active:scale-[0.98] ${
              settingsActive
                ? 'bg-primary/12 text-primary'
                : 'bg-muted/40 hover:bg-muted/60'
            }`}
            onClick={onShowSettings}
            aria-current={settingsActive ? 'page' : undefined}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-background/80">
              <Settings className="h-4.5 w-4.5 text-muted-foreground" />
            </div>
            <span className="text-base font-medium leading-none text-foreground">{t('actions.settings')}</span>
            {username ? (
              <span className="ml-auto flex h-8 shrink-0 items-center justify-center">
                <SidebarFooterAvatar user={user} username={username} size={26} />
              </span>
            ) : null}
          </button>
          <MeetingNotificationCenter variant="footer-mobile" />
          <a
            href="/help.html"
            target="_blank"
            rel="noreferrer"
            aria-label={t('actions.help')}
            title={t('actions.help')}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted/40 text-muted-foreground transition-all hover:bg-muted/60 active:scale-[0.98]"
          >
            <CircleHelp className="h-5 w-5" />
          </a>
          {updateAvailable && (
            <button
              type="button"
              className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border border-blue-200/60 bg-blue-50/80 px-3 text-blue-600 active:scale-[0.98] dark:border-blue-700/40 dark:bg-blue-900/15 dark:text-blue-300"
              onClick={onShowVersionModal}
              disabled={updateBusy}
            >
              <ArrowUpCircle className={`h-4.5 w-4.5 shrink-0 ${updateBusy ? 'animate-spin' : ''}`} />
              <span className="text-sm font-medium leading-none">{updateLabel || t('common:versionUpdate.buttons.updateNow')}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
