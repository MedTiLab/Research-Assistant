import { History, Loader2, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { AccountConversation } from '../../types/app';
import { cn } from '../../lib/utils';
import { api } from '../../utils/api';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { Markdown } from '../chat/view/subcomponents/Markdown';

type ConversationHistoryDashboardProps = {
  isMobile?: boolean;
  onMenuClick?: () => void;
};

const PAGE_SIZE = 50;

function SectionPanel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/45 shadow-sm backdrop-blur-[1px] dark:bg-card/45">
      <div className="shrink-0 px-4 py-3.5 sm:px-5 sm:py-4">
        <h3 className="text-sm font-semibold leading-tight text-foreground">{title}</h3>
        <div className="mt-0.5 text-xs leading-tight text-muted-foreground">{subtitle}</div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col border-t border-border/50 px-4 pb-4 pt-1 sm:px-5 sm:pb-5">
        <div className="flex min-h-0 flex-1 flex-col">
          {children}
        </div>
      </div>
    </div>
  );
}

export default function ConversationHistoryDashboard(_props: ConversationHistoryDashboardProps) {
  const { t, i18n } = useTranslation('common');
  const [conversations, setConversations] = useState<AccountConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<AccountConversation | null>(null);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formatDate = useCallback((value?: string | null) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(i18n.language, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }, [i18n.language]);

  const loadConversation = useCallback(async (id: string) => {
    setSelectedId(id);
    setIsLoadingDetail(true);
    setError(null);
    try {
      const response = await api.conversations.get(id);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || t('conversationHistory.loadFailed'));
      setSelectedConversation(data?.conversation || null);
    } catch (loadError) {
      setSelectedConversation(null);
      setError(loadError instanceof Error ? loadError.message : t('conversationHistory.loadFailed'));
    } finally {
      setIsLoadingDetail(false);
    }
  }, [t]);

  const loadList = useCallback(async ({ append = false } = {}) => {
    setIsLoading(true);
    setError(null);
    try {
      const offset = append ? conversations.length : 0;
      const response = await api.conversations.list({ limit: PAGE_SIZE, offset, search: search.trim() });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || t('conversationHistory.loadFailed'));
      const nextItems = Array.isArray(data?.conversations) ? data.conversations : [];
      setConversations((previous) => append ? [...previous, ...nextItems] : nextItems);
      setHasMore(Boolean(data?.hasMore));
      if (!append) {
        const nextSelectedId = nextItems.some((item: AccountConversation) => item.id === selectedId)
          ? selectedId
          : nextItems[0]?.id || null;
        if (nextSelectedId) {
          void loadConversation(nextSelectedId);
        } else {
          setSelectedId(null);
          setSelectedConversation(null);
        }
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t('conversationHistory.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [conversations.length, loadConversation, search, selectedId, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadList();
    }, search ? 250 : 0);
    return () => window.clearTimeout(timer);
    // Reload only when the search query changes; list mutations call loadList explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const handleDelete = useCallback(async () => {
    if (!selectedConversation || !window.confirm(t('conversationHistory.deleteConfirm'))) return;
    setIsDeleting(true);
    setError(null);
    try {
      const response = await api.conversations.delete(selectedConversation.id);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || t('conversationHistory.deleteFailed'));
      const remaining = conversations.filter((item) => item.id !== selectedConversation.id);
      setConversations(remaining);
      setSelectedConversation(null);
      const nextId = remaining[0]?.id || null;
      setSelectedId(nextId);
      if (nextId) void loadConversation(nextId);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t('conversationHistory.deleteFailed'));
    } finally {
      setIsDeleting(false);
    }
  }, [conversations, loadConversation, selectedConversation, t]);

  const selectedSummary = useMemo(
    () => conversations.find((item) => item.id === selectedId) || selectedConversation,
    [conversations, selectedConversation, selectedId],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1600px] flex-col gap-3 p-4 sm:p-6">
        {error ? (
          <div className="shrink-0 rounded-2xl border border-clinical-warning/35 bg-clinical-warning/10 px-4 py-3 text-sm leading-relaxed text-clinical-warning">
            {error}
          </div>
        ) : null}

        <SectionPanel
          title={t('conversationHistory.title')}
          subtitle={t('conversationHistory.subtitle')}
        >
          <div className="grid h-full min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/70 bg-card/95 md:grid-cols-[minmax(220px,280px)_minmax(0,1fr)] md:grid-rows-[auto_minmax(0,1fr)] 2xl:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
            <div className="flex min-h-0 flex-col justify-center gap-3 border-b border-border/70 px-4 py-3 md:col-start-1 md:row-start-1 md:border-r">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                  {t('conversationHistory.directoryEyebrow')}
                </p>
                <div className="mt-1 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">{t('conversationHistory.directoryTitle')}</h3>
                  <span className="rounded-full border border-border/60 bg-muted/50 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                    {t('conversationHistory.conversationCount', { count: conversations.length })}
                  </span>
                </div>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('conversationHistory.searchPlaceholder')}
                  className="h-8 w-full rounded-lg border border-border/60 bg-background pl-8 pr-8 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50"
                />
                <button
                  type="button"
                  onClick={() => void loadList()}
                  disabled={isLoading}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted disabled:opacity-50"
                  title={t('buttons.refresh')}
                  aria-label={t('buttons.refresh')}
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
                </button>
              </div>
            </div>

            <ScrollArea className="panel-scroll-area sidebar-scroll-area min-h-0 border-b border-border/70 md:col-start-1 md:row-start-2 md:border-b-0 md:border-r">
              <div className="space-y-2 p-3">
                {isLoading && conversations.length === 0 ? (
                  <div className="flex h-40 items-center justify-center text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : conversations.length === 0 ? (
                  <div className="px-3 py-10 text-center">
                    <History className="mx-auto h-8 w-8 text-muted-foreground/60" />
                    <p className="mt-3 text-sm font-medium">{t('conversationHistory.emptyTitle')}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{t('conversationHistory.emptyDescription')}</p>
                  </div>
                ) : (
                  <>
                    {conversations.map((conversation) => (
                      <button
                        key={conversation.id}
                        type="button"
                        onClick={() => void loadConversation(conversation.id)}
                        className={cn(
                          'flex w-full flex-col gap-1 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
                          selectedId === conversation.id
                            ? 'border-border bg-muted/70 font-semibold text-foreground'
                            : 'border-border/70 bg-background text-foreground hover:bg-muted/60',
                        )}
                      >
                        <span className="truncate">{conversation.title}</span>
                        <span className="flex items-center gap-2 text-[11px] font-normal text-muted-foreground">
                          <span className="truncate">{conversation.projectLabel || conversation.provider}</span>
                          <span aria-hidden="true">·</span>
                          <span className="shrink-0">{conversation.messageCount} {t('conversationHistory.messages')}</span>
                        </span>
                        <span className="truncate text-[11px] font-normal text-muted-foreground">
                          {formatDate(conversation.updatedAt)}
                        </span>
                      </button>
                    ))}
                    {hasMore ? (
                      <Button variant="ghost" className="w-full" onClick={() => void loadList({ append: true })} disabled={isLoading}>
                        {t('conversationHistory.loadMore')}
                      </Button>
                    ) : null}
                  </>
                )}
              </div>
            </ScrollArea>

            <div className="flex min-h-0 flex-col justify-center border-b border-border/70 px-4 py-3 md:col-start-2 md:row-start-1 md:px-5">
              {!selectedId ? (
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                    {t('conversationHistory.results')}
                  </p>
                  <h3 className="mt-1 text-sm font-semibold text-foreground">{t('conversationHistory.selectHint')}</h3>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-muted-foreground">
                      {t('conversationHistory.results')}
                    </p>
                    <h3 className="mt-1 truncate text-sm font-semibold leading-tight text-foreground">
                      {selectedConversation?.title || selectedSummary?.title || t('conversationHistory.loadFailed')}
                    </h3>
                    <p className="mt-1 truncate text-xs leading-5 text-muted-foreground">
                      {[
                        selectedConversation?.projectLabel || selectedSummary?.projectLabel || t('conversationHistory.unknownProject'),
                        selectedConversation?.provider || selectedSummary?.provider,
                        formatDate(selectedConversation?.updatedAt || selectedSummary?.updatedAt),
                      ].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {selectedConversation ? (
                    <Button variant="outline" size="sm" className="shrink-0" onClick={() => void handleDelete()} disabled={isDeleting}>
                      {isDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                      {t('buttons.delete')}
                    </Button>
                  ) : null}
                </div>
              )}
            </div>

            <section className="flex min-h-0 min-w-0 flex-col overflow-hidden md:col-start-2 md:row-start-2">
              {isLoadingDetail ? (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : selectedConversation ? (
                <div className="panel-scroll-area min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-5">
                  <p className="mb-4 inline-flex items-center gap-1.5 text-[11px] leading-5 text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                    {t('conversationHistory.privacyNote')}
                  </p>
                  <div className="space-y-5">
                    {(selectedConversation.messages || []).map((message, index) => (
                      <article
                        key={`${message.timestamp}-${index}`}
                        className={message.role === 'user'
                          ? 'ml-auto max-w-[88%] rounded-xl border border-border/70 bg-muted/40 px-4 py-3'
                          : 'max-w-none border-l-2 border-border pl-4'}
                      >
                        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          {message.role === 'user' ? t('conversationHistory.you') : t('conversationHistory.assistant')}
                        </div>
                        <Markdown className="prose prose-sm max-w-none dark:prose-invert">
                          {message.content}
                        </Markdown>
                      </article>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
                  {selectedSummary?.title || t('conversationHistory.selectHint')}
                </div>
              )}
            </section>
          </div>
        </SectionPanel>
      </div>
    </div>
  );
}
