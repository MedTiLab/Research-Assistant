import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api';
import type { AgentWorkItem } from './useAgentWork';
import { AGENT_WORK_CHANGED, agentStatusLabel, usePiSessionState } from './usePiSessionState';

export default function AgentWorkDetails({ item, onClose, onOpen }: { item: AgentWorkItem; onClose: () => void; onOpen?: (item: AgentWorkItem) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const { state, error: loadError, refresh } = usePiSessionState(item.projectKey || '', item.sessionId || null, !item.terminal);
  const task = state?.tasks?.find((task) => task.id === item.id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const act = async (action: string) => {
    setBusy(true); setError(null);
    try {
      const response = await api.piTaskAction(item.projectKey, item.sessionId, item.id, action);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Task action failed');
      refresh(); window.dispatchEvent(new Event(AGENT_WORK_CHANGED));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Task action failed'); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} onCancel={onClose} onClose={onClose} className="w-[min(720px,94vw)] max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-background p-5 text-foreground shadow-xl backdrop:bg-black/40" aria-label={item.title || (zh ? '任务详情' : 'Task details')}>
    <div className="mb-3 flex items-start justify-between gap-3">
      <h2 className="min-w-0 break-words text-sm font-semibold">{task?.title || item.title || (zh ? '任务详情' : 'Task details')}</h2>
      <button type="button" autoFocus onClick={onClose} className="rounded border px-2 py-1 text-xs">{zh ? '关闭' : 'Close'}</button>
    </div>
    {item.terminal ? <TerminalDetails item={item} /> : <>
      <div className="mb-3 text-xs text-muted-foreground">{agentStatusLabel(task?.status || item.status, zh)} · {task?.id || item.id}</div>
      {(error || loadError) && <p role="alert" className="mb-3 text-xs text-red-600">{error || loadError}</p>}
      {task?.description && <pre className="mb-3 whitespace-pre-wrap break-words text-xs">{task.description}</pre>}
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {onOpen && <button type="button" className="rounded border px-2 py-1" onClick={() => { onOpen({ ...item, sessionId: task?.childSessionId || item.sessionId }); onClose(); }}>{zh ? '打开会话' : 'Open conversation'}</button>}
        {task && ['queued', 'running', 'in_progress', 'waiting_on_user', 'blocked', 'scheduled'].includes(task.status) && <button type="button" disabled={busy} onClick={() => void act('cancel')} className="rounded border px-2 py-1 disabled:opacity-50">{zh ? '取消任务' : 'Cancel task'}</button>}
        {task?.background && ['failed', 'cancelled', 'interrupted'].includes(task.status) && <button type="button" disabled={busy} onClick={() => void act('retry')} className="rounded border px-2 py-1 disabled:opacity-50">{zh ? '重试（只读子任务）' : 'Retry (read-only task)'}</button>}
      </div>
      {task?.error && <pre role="alert" className="mb-3 whitespace-pre-wrap text-xs text-red-600">{task.error.message || JSON.stringify(task.error)}</pre>}
      {task?.result && <pre className="mb-3 whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 text-xs">{typeof task.result === 'string' ? task.result : JSON.stringify(task.result, null, 2)}</pre>}
      {(task?.childTools || []).map((tool: any) => <details key={tool.toolId} className="mb-1 rounded border p-2 text-xs">
        <summary className="cursor-pointer">{tool.toolName} {tool.toolResult?.isError ? '✕' : tool.toolResult ? '✓' : '…'}</summary>
        <pre className="mt-2 whitespace-pre-wrap break-words">{typeof tool.toolInput === 'string' ? tool.toolInput : JSON.stringify(tool.toolInput, null, 2)}</pre>
        <pre className="mt-2 whitespace-pre-wrap break-words">{typeof tool.toolResult?.content === 'string' ? tool.toolResult.content : JSON.stringify(tool.toolResult?.content, null, 2)}</pre>
      </details>)}
    </>}
  </dialog>;
}

function TerminalDetails({ item }: { item: AgentWorkItem }) {
  const { i18n } = useTranslation();
  const zh = i18n.language.startsWith('zh');
  const [terminal, setTerminal] = useState<any>(null);
  const [output, setOutput] = useState('');
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false, loading = false, cursor = 0;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const response = await api.piTerminalRead(item.projectKey, item.sessionId, item.id, cursor);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Terminal read failed');
        if (!cancelled) {
          cursor = data.cursor;
          setTerminal(data); setError(null);
          setOutput((previous) => `${data.truncated && !previous ? '[Earlier output truncated]\n' : ''}${previous}${data.output || ''}`.slice(-128000));
        }
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Terminal read failed'); }
      finally { loading = false; }
    };
    void load(); const timer = window.setInterval(() => void load(), 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [item.projectKey, item.sessionId, item.id]);
  const send = async (action: string, text = '') => {
    setBusy(true); setError(null);
    try {
      const response = await api.piTerminalAction(item.projectKey, item.sessionId, item.id, action, text);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Terminal action failed');
      setTerminal(data); setInput(''); window.dispatchEvent(new Event(AGENT_WORK_CHANGED));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Terminal action failed'); }
    finally { setBusy(false); }
  };
  return <>
    <p className="mb-2 text-xs">{agentStatusLabel(terminal?.status || item.status, zh)}{terminal?.exitCode != null ? ` · exit ${terminal.exitCode}` : ''}</p>
    <pre className="mb-2 whitespace-pre-wrap text-xs">$ {terminal?.command || item.title}</pre>
    <pre className="max-h-[45vh] min-h-24 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-100">{output || (zh ? '等待输出…' : 'Waiting for output…')}</pre>
    {error && <p role="alert" className="mt-2 text-xs text-red-600">{error}</p>}
    <form className="mt-3 flex flex-wrap gap-2 text-xs" onSubmit={(event) => { event.preventDefault(); void send('input', `${input}\n`); }}>
      <input aria-label={zh ? '终端输入' : 'Terminal input'} value={input} maxLength={15999} onChange={(event) => setInput(event.target.value)} disabled={busy || terminal?.status !== 'running'} className="min-w-0 flex-1 rounded border bg-background px-2 py-1" />
      <button type="submit" disabled={busy || terminal?.status !== 'running'} className="rounded border px-2 py-1 disabled:opacity-50">{zh ? '发送' : 'Send'}</button>
      <button type="button" disabled={busy || terminal?.status !== 'running'} onClick={() => void send('input', '\u0003')} className="rounded border px-2 py-1 disabled:opacity-50">Ctrl+C</button>
      <button type="button" disabled={busy || terminal?.status !== 'running'} onClick={() => void send('close')} className="rounded border px-2 py-1 disabled:opacity-50">{zh ? '终止' : 'Stop'}</button>
    </form>
  </>;
}
