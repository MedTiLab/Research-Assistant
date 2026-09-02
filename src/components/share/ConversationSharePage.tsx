import { AlertCircle, Clock, LockKeyhole, MessageSquare, Share2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import { api } from '../../utils/api';
import { Markdown } from '../chat/view/subcomponents/Markdown';

type SharedConversationMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
};

type SharedConversation = {
  token: string;
  visibility: 'public' | 'private';
  title: string;
  project?: {
    name?: string;
    displayName?: string;
  };
  session?: {
    id?: string;
    provider?: string;
  };
  messages: SharedConversationMessage[];
  messageCount?: number;
  createdAt?: string | null;
  expiresAt?: string | null;
  url?: string;
};

function formatProvider(provider?: string | null) {
  if (provider === 'codex') return 'Codex';
  if (provider === 'pi') return 'Pi';
  if (provider === 'openrouter') return 'OpenRouter';
  if (provider === 'local') return 'Local GPU';
  return 'Claude';
}

function formatDate(value?: string | null) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function getErrorMessage(status: number, fallback: string) {
  if (status === 401) {
    return 'This private share link requires sign in.';
  }
  if (status === 403) {
    return 'You do not have access to this private share link.';
  }
  if (status === 404) {
    return 'This share link was not found or has been revoked.';
  }
  if (status === 410) {
    return 'This share link has expired.';
  }
  return fallback;
}

export default function ConversationSharePage() {
  const { token = '' } = useParams();
  const [share, setShare] = useState<SharedConversation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadShare = async () => {
      if (!token) {
        setError('Share token is missing.');
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await api.shares.getConversation(token);
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(getErrorMessage(response.status, data?.error || 'Failed to load share link.'));
        }

        if (!cancelled) {
          setShare(data?.share || null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setShare(null);
          setError(loadError instanceof Error ? loadError.message : 'Failed to load share link.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadShare();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const messages = useMemo(
    () => (Array.isArray(share?.messages) ? share.messages : []),
    [share?.messages],
  );
  const projectLabel = share?.project?.displayName || share?.project?.name || '';
  const providerLabel = formatProvider(share?.session?.provider);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card shadow-sm">
              <MessageSquare className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                MedHelp
              </div>
              <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
                {share?.title || 'Shared conversation'}
              </h1>
            </div>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
            {share?.visibility === 'private' ? (
              <LockKeyhole className="h-3.5 w-3.5" />
            ) : (
              <Share2 className="h-3.5 w-3.5" />
            )}
            {share?.visibility === 'private' ? 'Private link' : 'Public link'}
          </div>
        </header>

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center py-20 text-sm text-muted-foreground">
            <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-muted-foreground" />
            Loading shared conversation...
          </div>
        ) : error ? (
          <div className="mx-auto mt-16 flex max-w-xl flex-col items-center rounded-2xl border border-border/70 bg-card p-6 text-center shadow-sm">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <h2 className="mt-3 text-lg font-semibold">Unable to open share link</h2>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          </div>
        ) : share ? (
          <>
            <section className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/50 py-3 text-xs text-muted-foreground">
              {projectLabel ? <span>{projectLabel}</span> : null}
              <span>{providerLabel}</span>
              <span>{messages.length} messages</span>
              {share.createdAt ? (
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {formatDate(share.createdAt)}
                </span>
              ) : null}
            </section>

            <main className="flex-1 py-6">
              <div className="space-y-5">
                {messages.map((message, index) => {
                  const isUser = message.role === 'user';
                  return (
                    <article
                      key={`${message.role}-${message.timestamp || index}-${index}`}
                      className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={isUser ? 'max-w-[88%] sm:max-w-[78%]' : 'w-full'}>
                        <div className={`mb-1 text-xs font-medium ${isUser ? 'text-right text-muted-foreground' : 'text-muted-foreground'}`}>
                          {isUser ? 'User' : providerLabel}
                          {message.timestamp ? ` · ${formatDate(message.timestamp)}` : ''}
                        </div>
                        {isUser ? (
                          <div className="rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-sm">
                            <div className="whitespace-pre-wrap break-words">{message.content}</div>
                          </div>
                        ) : (
                          <div className="prose-share rounded-none text-[15px] leading-relaxed">
                            <Markdown className="prose prose-sm max-w-none dark:prose-invert">
                              {message.content}
                            </Markdown>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </main>
          </>
        ) : null}
      </div>
    </div>
  );
}
