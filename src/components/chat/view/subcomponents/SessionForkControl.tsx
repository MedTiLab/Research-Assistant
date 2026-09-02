import { useState } from 'react';
import { GitFork, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ProjectSession, SessionProvider } from '../../../../types/app';
import { authenticatedFetch } from '../../../../utils/api';

export type SessionForkPoint = { id: string; turn: number; preview: string };

type SessionForkControlProps = {
  projectName: string;
  sessionId: string;
  provider: SessionProvider;
  pointId?: string;
  responseFromEnd?: number;
  disabled?: boolean;
  onForked: (session: ProjectSession & { __provider: SessionProvider }) => void;
};

export default function SessionForkControl({
  projectName,
  sessionId,
  provider,
  pointId = '',
  responseFromEnd,
  disabled = false,
  onForked,
}: SessionForkControlProps) {
  const { t } = useTranslation('sidebar');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const createFork = async () => {
    if ((!pointId && !responseFromEnd) || busy || disabled) return;
    setBusy(true);
    setError('');
    try {
      const base = `/api/projects/${encodeURIComponent(projectName)}/sessions/${encodeURIComponent(sessionId)}`;
      const response = await authenticatedFetch(`${base}/fork`, {
        method: 'POST',
        body: JSON.stringify({
          provider,
          ...(pointId ? { pointId } : { responseFromEnd }),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.session?.id) {
        throw new Error(result.error || t('sessions.branches.actionFailed'));
      }
      window.dispatchEvent(new Event('medhelp-session-list-changed'));
      onForked(result.session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('sessions.branches.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        disabled={(!pointId && !responseFromEnd) || busy || disabled}
        onClick={() => void createFork()}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground disabled:cursor-wait disabled:opacity-70"
        title={t('sessions.branches.fromHere')}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitFork className="h-3 w-3" />}
        <span>{busy ? t('sessions.branches.creating') : t('sessions.branches.fromHere')}</span>
      </button>
      {error ? <span role="alert" className="text-[11px] text-red-500 dark:text-red-400">{error}</span> : null}
    </>
  );
}
