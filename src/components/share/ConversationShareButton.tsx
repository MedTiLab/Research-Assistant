import { Check, Copy, Globe2, LockKeyhole, Share2, Upload, X } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/utils';
import Tooltip from '../Tooltip';
import type { Project, ProjectSession, SessionProvider } from '../../types/app';
import { api } from '../../utils/api';
import { copyTextToClipboard } from '../../utils/clipboard';

type ShareVisibility = 'public' | 'private';

type ConversationShareButtonProps = {
  project: Project | null;
  session: ProjectSession | null;
  onOpen?: () => void;
  variant?: 'toolbar' | 'sidebar';
  stopPropagation?: boolean;
  buttonClassName?: string;
  iconClassName?: string;
};

function getSessionTitle(session: ProjectSession | null, fallback: string) {
  if (!session) {
    return fallback;
  }

  const title = session.summary || session.title || session.name;
  return typeof title === 'string' && title.trim() ? title.trim() : fallback;
}

function getSessionProvider(session: ProjectSession): SessionProvider {
  return session.__provider || 'claude';
}

export default function ConversationShareButton({
  project,
  session,
  onOpen,
  variant = 'toolbar',
  stopPropagation = false,
  buttonClassName,
  iconClassName,
}: ConversationShareButtonProps) {
  const { t } = useTranslation();
  const [isSharing, setIsSharing] = useState(false);
  const [isSharePanelOpen, setIsSharePanelOpen] = useState(false);
  const [shareVisibility, setShareVisibility] = useState<ShareVisibility>('public');
  const [shareUrl, setShareUrl] = useState('');
  const [shareUrlVisibility, setShareUrlVisibility] = useState<ShareVisibility | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const sharePanelRef = useRef<HTMLDivElement | null>(null);

  const sessionTitle = getSessionTitle(session, t('sidebar:projects.newSession'));
  const canShare = Boolean(project && session && !session.id.startsWith('new-session-'));
  const isSidebarVariant = variant === 'sidebar';
  const TriggerIcon = isSidebarVariant ? Share2 : Upload;

  const openSharePanel = (event?: MouseEvent<HTMLButtonElement>) => {
    if (stopPropagation) {
      event?.stopPropagation();
    }

    if (!canShare) {
      return;
    }

    setShareError(null);
    onOpen?.();
    setIsSharePanelOpen(true);
  };

  const copyShareUrl = async (url: string) => {
    const copied = await copyTextToClipboard(url);
    if (copied) {
      setShareCopied(true);
    } else {
      window.prompt(t('sidebar:messages.shareSessionCopyPrompt'), url);
    }
  };

  const createShareLink = async () => {
    if (!project || !session || isSharing || !canShare) {
      return;
    }

    setIsSharing(true);
    setShareError(null);
    setShareCopied(false);
    try {
      const response = await api.shares.createConversation({
        projectName: project.name,
        sessionId: session.id,
        provider: getSessionProvider(session),
        visibility: shareVisibility,
        title: sessionTitle,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || t('sidebar:messages.shareSessionFailed'));
      }

      const nextShareUrl = data?.url || data?.share?.url;
      if (!nextShareUrl) {
        throw new Error(t('sidebar:messages.shareSessionFailed'));
      }

      setShareUrl(nextShareUrl);
      setShareUrlVisibility(shareVisibility);
    } catch (error) {
      console.error('Failed to create session share link:', error);
      setShareError(error instanceof Error ? error.message : t('sidebar:messages.shareSessionFailed'));
    } finally {
      setIsSharing(false);
    }
  };

  useEffect(() => {
    if (!isSharePanelOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const clickedPanel = sharePanelRef.current?.contains(target);
      if (!clickedPanel) {
        setIsSharePanelOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsSharePanelOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSharePanelOpen]);

  useEffect(() => {
    if (!shareCopied) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setShareCopied(false);
    }, 1800);

    return () => {
      window.clearTimeout(timer);
    };
  }, [shareCopied]);

  return (
    <>
      <Tooltip content={t('sidebar:tooltips.shareSession')} position={isSidebarVariant ? 'top' : 'bottom'}>
        <button
          type="button"
          onClick={openSharePanel}
          disabled={!canShare || isSharing}
          className={cn(
            isSidebarVariant
              ? 'flex h-6 w-6 items-center justify-center rounded bg-gray-50 text-gray-600 transition-all hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-900/20 dark:text-gray-400 dark:hover:bg-gray-900/40'
              : 'relative flex items-center gap-1.5 px-2.5 py-[5px] text-xs font-medium rounded-md transition-all duration-150',
            isSidebarVariant
              ? isSharePanelOpen && 'bg-gray-100 dark:bg-gray-900/40'
              : isSharePanelOpen
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:text-muted-foreground/60',
            buttonClassName,
          )}
          aria-label={t('sidebar:shareSession.action')}
          aria-expanded={isSharePanelOpen}
          data-session-share-trigger={isSidebarVariant ? 'true' : undefined}
        >
          <TriggerIcon className={cn(isSidebarVariant ? 'h-3 w-3' : 'h-4 w-4', iconClassName)} strokeWidth={2} />
          {!isSidebarVariant && <span className="hidden lg:inline">{t('sidebar:shareSession.action')}</span>}
        </button>
      </Tooltip>

      {isSharePanelOpen && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/20 p-4 backdrop-blur-[1px]">
          <div
            ref={sharePanelRef}
            className="w-full max-w-[23rem] overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl ring-1 ring-black/5 dark:border-slate-800 dark:bg-slate-950 dark:ring-white/10"
            role="dialog"
            aria-modal="true"
            aria-label={t('sidebar:shareSession.title')}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">{t('sidebar:shareSession.title')}</div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground" title={sessionTitle}>
                  {sessionTitle}
                </div>
              </div>
              <button
                type="button"
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => setIsSharePanelOpen(false)}
                aria-label={t('sidebar:tooltips.cancel')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 grid gap-2">
              {(['public', 'private'] as ShareVisibility[]).map((visibility) => {
                const isActive = shareVisibility === visibility;
                const Icon = visibility === 'public' ? Globe2 : LockKeyhole;
                return (
                  <button
                    key={visibility}
                    type="button"
                    className={cn(
                      'flex items-start gap-2 rounded-xl border px-3 py-2 text-left transition-colors',
                      isActive
                        ? 'border-primary/40 bg-primary/[0.08] text-foreground'
                        : 'border-border/70 bg-background/70 text-foreground hover:bg-muted/60',
                    )}
                    onClick={() => {
                      setShareVisibility(visibility);
                      setShareError(null);
                      if (shareUrlVisibility && shareUrlVisibility !== visibility) {
                        setShareUrl('');
                        setShareUrlVisibility(null);
                        setShareCopied(false);
                      }
                    }}
                  >
                    <Icon className={cn('mt-0.5 h-4 w-4 flex-shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')} />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{t(`sidebar:shareSession.${visibility}.label`)}</span>
                      <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                        {t(`sidebar:shareSession.${visibility}.description`)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-wait disabled:opacity-70"
              onClick={() => void createShareLink()}
              disabled={isSharing}
            >
              {isSharing ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <Share2 className="h-4 w-4" />
              )}
              {isSharing ? t('sidebar:messages.shareSessionCreating') : t('sidebar:shareSession.createLink')}
            </button>

            {shareError ? (
              <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-4 text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                {shareError}
              </div>
            ) : null}

            {shareUrl ? (
              <div className="mt-3 rounded-xl border border-border/70 bg-muted/35 p-2.5">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-foreground">{t('sidebar:shareSession.linkCardTitle')}</div>
                  <div className="rounded-full border border-border/70 bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {shareUrlVisibility ? t(`sidebar:shareSession.${shareUrlVisibility}.label`) : ''}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div
                    className="min-w-0 flex-1 truncate rounded-lg border border-border/60 bg-background px-2.5 py-2 font-mono text-[11px] text-muted-foreground"
                    title={shareUrl}
                  >
                    {shareUrl}
                  </div>
                  <button
                    type="button"
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-foreground text-background transition-colors hover:bg-foreground/90"
                    onClick={() => void copyShareUrl(shareUrl)}
                    title={t('sidebar:shareSession.copyLink')}
                  >
                    {shareCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
                {shareCopied ? (
                  <div className="mt-1.5 text-xs text-primary">
                    {t('sidebar:messages.shareSessionCopied')}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-xs leading-4 text-muted-foreground">
                {t('sidebar:shareSession.emptyLinkHint')}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
