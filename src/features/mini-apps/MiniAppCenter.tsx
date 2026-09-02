import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Code2, Copy, Download, ExternalLink, FileUp, Play, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
import { ExplorerPage, explorerItemClass } from '../../components/explorer/ExplorerPage';
import { api } from '../../utils/api';
import { sandboxMiniAppHtml, STARTER_MINI_APP } from './sandbox';
import type { MiniApp, MiniAppSummary } from './types';
import type { ChatPromptDraft } from '../../utils/chatPromptDraft';
import { createAppChatDraft } from './createAppChatDraft';

async function json<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload as T;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function MiniAppCenter({ onMenuClick, onCreateWithAgent }: { onMenuClick?: () => void; onCreateWithAgent?: (draft: ChatPromptDraft) => void }) {
  const { t } = useTranslation('common');
  const { t: tChat } = useTranslation('chat');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [apps, setApps] = useState<MiniAppSummary[]>([]);
  const [selected, setSelected] = useState<MiniApp | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft] = useState({ name: '', description: '', icon: '🧪', html: STARTER_MINI_APP });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await json<{ apps: MiniAppSummary[] }>(await api.miniApps.list());
      setApps(payload.apps);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visibleApps = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? apps.filter((app) => `${app.name} ${app.description}`.toLowerCase().includes(normalized)) : apps;
  }, [apps, query]);

  const open = async (id: string) => {
    setBusy(true);
    try {
      const payload = await json<{ app: MiniApp }>(await api.miniApps.get(id));
      setSelected(payload.app);
      setDraft({ name: payload.app.name, description: payload.app.description, icon: payload.app.icon || '🧪', html: payload.app.html });
      setEditing(false);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const payload = selected
        ? await json<{ app: MiniApp }>(await api.miniApps.update(selected.id, draft))
        : await json<{ app: MiniApp }>(await api.miniApps.create(draft));
      setSelected(payload.app);
      setDraft({ name: payload.app.name, description: payload.app.description, icon: payload.app.icon || '🧪', html: payload.app.html });
      setEditing(false);
      setReloadKey((value) => value + 1);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const beginCreate = () => {
    if (onCreateWithAgent) {
      onCreateWithAgent(createAppChatDraft(tChat));
      return;
    }
    setSelected(null);
    setDraft({ name: t('myApps.starterName'), description: t('myApps.starterDescription'), icon: '🧪', html: STARTER_MINI_APP });
    setEditing(true);
  };

  const openStandalone = () => {
    if (!selected) return;
    const url = URL.createObjectURL(new Blob([sandboxMiniAppHtml(selected.html)], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const exportSelected = () => {
    if (!selected) return;
    const url = URL.createObjectURL(new Blob([selected.html], { type: 'text/html' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${selected.name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'research-app'}.html`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const cloneSelected = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const payload = await json<{ app: MiniApp }>(await api.miniApps.create({
        name: t('myApps.copySuffix', { name: selected.name }),
        description: selected.description,
        icon: selected.icon,
        html: selected.html,
      }));
      setSelected(payload.app);
      setDraft({ name: payload.app.name, description: payload.app.description, icon: payload.app.icon || '🧪', html: payload.app.html });
      await load();
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      setError(t('myApps.fileTooLarge'));
      return;
    }
    const html = await file.text();
    setSelected(null);
    setDraft({ name: file.name.replace(/\.html?$/i, '') || t('myApps.importedName'), description: t('myApps.importedDescription'), icon: '📦', html });
    setEditing(true);
  };

  if (editing) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3 md:px-5">
          <button type="button" onClick={() => selected ? setEditing(false) : setEditing(false)} className="rounded-lg p-2 hover:bg-muted"><ArrowLeft className="h-4 w-4" /></button>
          <div className="font-semibold">{selected ? t('myApps.editTitle', { name: selected.name }) : t('myApps.createTitle')}</div>
          <button type="button" disabled={busy || !draft.name.trim()} onClick={() => void save()} className="ml-auto inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"><Save className="h-4 w-4" />{t('myApps.saveAndRun')}</button>
        </div>
        {error && <div className="flex items-center justify-between border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive">{error}<button type="button" onClick={() => setError('')}><X className="h-4 w-4" /></button></div>}
        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(360px,0.8fr)_1.2fr]">
          <div className="min-h-0 overflow-y-auto border-r p-4">
            <div className="mb-4 grid grid-cols-[72px_1fr] gap-3"><label className="text-sm font-medium">{t('myApps.icon')}<input value={draft.icon} onChange={(event) => setDraft((value) => ({ ...value, icon: event.target.value.slice(0, 16) }))} className="mt-1 w-full rounded-lg border bg-background px-2 py-2 text-center" /></label><label className="text-sm font-medium">{t('myApps.name')}<input value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-1 w-full rounded-lg border bg-background px-3 py-2" maxLength={80} /></label></div>
            <label className="mb-4 block text-sm font-medium">{t('myApps.desc')}<input value={draft.description} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} className="mt-1 w-full rounded-lg border bg-background px-3 py-2" maxLength={500} /></label>
            <label className="block text-sm font-medium">{t('myApps.source')}<textarea spellCheck={false} value={draft.html} onChange={(event) => setDraft((value) => ({ ...value, html: event.target.value }))} className="mt-1 min-h-[520px] w-full resize-none rounded-xl border bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-primary" /></label>
          </div>
          <div className="min-h-[360px] bg-muted/30 p-3"><iframe title={t('myApps.preview')} sandbox="allow-scripts allow-modals" referrerPolicy="no-referrer" srcDoc={sandboxMiniAppHtml(draft.html)} className="h-full w-full rounded-xl border bg-white shadow-sm" /></div>
        </div>
      </div>
    );
  }

  return (
    <>
      <input ref={fileInputRef} type="file" accept=".html,.htm,text/html" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ''; }} />
      <ExplorerPage
        onMenuClick={onMenuClick}
        eyebrow={t('tabs.miniApps')}
        title={t('tabs.miniApps')}
        countLabel={`${visibleApps.length}`}
        searchPlaceholder={t('myApps.searchPlaceholder')}
        searchValue={query}
        onSearchChange={setQuery}
        sidebar={loading ? (
          <p className="px-1 py-8 text-center text-sm text-muted-foreground">{t('myApps.loading')}</p>
        ) : visibleApps.length === 0 ? (
          <p className="px-1 py-8 text-center text-sm text-muted-foreground">{apps.length ? t('myApps.noMatch') : t('myApps.emptyList')}</p>
        ) : visibleApps.map((app) => (
          <button key={app.id} type="button" disabled={busy} onClick={() => void open(app.id)} className={explorerItemClass(selected?.id === app.id)}>
            <span className="flex min-w-0 items-center gap-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-base">{app.icon || '🧪'}</span>
              <span className="min-w-0">
                <span className="block truncate">{app.name}</span>
                <span className="mt-0.5 block truncate text-[11px] font-normal text-muted-foreground">{app.description || t('myApps.noDescription')}</span>
              </span>
            </span>
          </button>
        ))}
        resultsEyebrow={t('tabs.miniApps')}
        resultsTitle={selected?.name || t('myApps.selectApp')}
        resultsDescription={selected?.description || t('myApps.description')}
        resultsActions={(
          <div className="flex flex-wrap gap-2">
            {selected ? (
              <>
                <button type="button" onClick={() => setReloadKey((value) => value + 1)} className="rounded-lg border px-3 py-2 text-sm hover:bg-muted" title={t('myApps.refresh')}><RefreshCw className="h-4 w-4" /></button>
                <button type="button" onClick={openStandalone} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"><ExternalLink className="h-4 w-4" />{t('myApps.openApp')}</button>
                <button type="button" onClick={() => void cloneSelected()} disabled={busy} className="rounded-lg border p-2 hover:bg-muted disabled:opacity-50" title={t('myApps.clone')} aria-label={t('myApps.clone')}><Copy className="h-4 w-4" /></button>
                <button type="button" onClick={exportSelected} className="rounded-lg border p-2 hover:bg-muted" title={t('myApps.export')} aria-label={t('myApps.exportAria')}><Download className="h-4 w-4" /></button>
                <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted"><Code2 className="h-4 w-4" />{t('myApps.editSource')}</button>
                <button type="button" onClick={async () => { if (!confirm(t('myApps.deleteConfirm', { name: selected.name }))) return; await json(await api.miniApps.delete(selected.id)); setSelected(null); await load(); }} className="rounded-lg border px-3 py-2 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title={t('buttons.delete')}><Trash2 className="h-4 w-4" /></button>
              </>
            ) : null}
            <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold hover:bg-muted"><FileUp className="h-4 w-4" />{t('myApps.importHtml')}</button>
            <button type="button" onClick={beginCreate} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" />{t('myApps.createWithAgent')}</button>
          </div>
        )}
      >
        {error && <div className="flex items-center justify-between border-b border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}<button type="button" onClick={() => setError('')}><X className="h-4 w-4" /></button></div>}
        {selected ? (
          <iframe key={reloadKey} title={selected.name} sandbox="allow-scripts allow-modals" referrerPolicy="no-referrer" srcDoc={sandboxMiniAppHtml(selected.html)} className="h-full min-h-[520px] w-full border-0 bg-white" />
        ) : (
          <div className="flex h-full min-h-[320px] flex-col items-center justify-center p-8 text-center">
            <Play className="mb-3 h-10 w-10 text-primary" />
            <div className="font-semibold">{apps.length ? t('myApps.emptyPick') : t('myApps.emptyTitle')}</div>
            <p className="mt-1 text-sm text-muted-foreground">{t('myApps.emptyHint')}</p>
          </div>
        )}
      </ExplorerPage>
    </>
  );
}
