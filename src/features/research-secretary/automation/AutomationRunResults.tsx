import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, MessageSquareText, RefreshCw } from 'lucide-react';
import { automationRequestJson, automationRunsPath, markAutomationRunRead, type AutomationRecord, type AutomationRun, type AutomationResult } from '../services/automationsApi';

export default function AutomationRunResults({ item, requestedSessionId, onOpenSession }: {
  item: AutomationRecord;
  requestedSessionId?: string;
  onOpenSession?: (sessionId: string, projectKey: string) => void;
}) {
  const { t } = useTranslation('workbench');
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(requestedSessionId || null);
  const [result, setResult] = useState<AutomationResult | null>(null);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => { if (requestedSessionId) setSelectedId(requestedSessionId); }, [requestedSessionId]);
  useEffect(() => {
    let active = true;
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const rows = await automationRequestJson<AutomationRun[]>(automationRunsPath(item));
        if (active) {
          setRuns(rows);
          setSelectedId((current) => rows.some((run) => run.sessionId === current) ? current : rows[0]?.sessionId || null);
          setError('');
        }
      } catch (cause) { if (active) setError(String(cause instanceof Error ? cause.message : cause)); }
      finally { pending = false; }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [item.id, item.projectKey, item.lastStatus, revision]);

  const selectedRun = runs.find((run) => run.sessionId === selectedId);
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    let pending = false;
    setResult(null);
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await automationRequestJson<AutomationResult>(automationRunsPath(item, `/${encodeURIComponent(selectedId)}`));
        if (!active) return;
        setResult(next);
        setError('');

      } catch (cause) { if (active) setError(String(cause instanceof Error ? cause.message : cause)); }
      finally { pending = false; }
    };
    void load();
    const timer = selectedRun?.status === 'running' ? window.setInterval(() => void load(), 5000) : null;
    return () => { active = false; if (timer) window.clearInterval(timer); };
  }, [item.id, item.projectKey, selectedId, selectedRun?.status, revision]);

  const markRead = () => {
    if (!selectedId || result?.status === 'running') return;
    void markAutomationRunRead({ automationId: item.id, projectKey: item.projectKey, sessionId: selectedId })
      .then(() => setRuns((current) => current.map((run) => run.sessionId === selectedId ? { ...run, readAt: new Date().toISOString() } : run)))
      .catch((cause) => setError(String(cause instanceof Error ? cause.message : cause)));
  };
  const openConversation = () => {
    if (!selectedId || !onOpenSession) return;
    onOpenSession(selectedId, item.projectKey);
    markRead();
  };

  const download = () => {
    if (!result?.markdown) return;
    const url = URL.createObjectURL(new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${item.title.replace(/[\\/:*?"<>|]/g, '-')}-${result.startedAt?.slice(0, 10) || 'result'}.md`;
    anchor.click();
    markRead();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <section className="rounded-xl border bg-card px-4 py-3" aria-label={t('automation.resultsTitle')}>
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="mr-auto text-sm font-semibold">{t('automation.resultsTitle')}</h3>
      {runs.length > 0 && <select aria-label={t('automation.chooseRun')} value={selectedId || ''} onChange={(event) => setSelectedId(event.target.value)} className="min-w-0 max-w-full rounded-lg border bg-background px-2 py-1.5 text-xs">
        {runs.map((run) => <option key={run.sessionId} value={run.sessionId}>{new Date(run.startedAt).toLocaleString()} · {t(`automation.runStatus.${run.status}`, { defaultValue: run.status })}{!run.readAt && run.status !== 'running' ? ' ●' : ''}</option>)}
      </select>}
      <button type="button" onClick={() => setRevision((value) => value + 1)} aria-label={t('automation.refresh')} className="rounded-lg p-1.5 hover:bg-muted"><RefreshCw className="h-3.5 w-3.5" /></button>
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
    {!runs.length ? <p className="mt-2 text-xs text-muted-foreground">{t('automation.noRuns')}</p> : <>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" disabled={!result?.sessionExists || !onOpenSession} onClick={openConversation} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40"><MessageSquareText className="h-3.5 w-3.5" />{t('automation.openConversation')}</button>
        <button type="button" disabled={!result?.markdown} onClick={download} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"><Download className="h-3.5 w-3.5" />{t('automation.downloadResult')}</button>
        {Boolean(result?.warnings.length) && <span className="text-xs text-amber-700 dark:text-amber-400">{t('automation.resultWarnings', { count: result?.warnings.length })}</span>}
      </div>
      {result?.error && <p role="alert" className="mt-2 break-words text-xs text-destructive">{result.error}</p>}
      {!result?.markdown && <p role="status" className="mt-2 text-xs text-muted-foreground">{t(!result ? 'automation.loadingResult' : result.status === 'running' ? 'automation.resultRunning' : 'automation.noReport')}</p>}
    </>}
  </section>;
}
