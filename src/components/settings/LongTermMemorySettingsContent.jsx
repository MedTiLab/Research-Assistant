import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrainCircuit, Check, Download, Edit3, Pin, PinOff, Plus, Search, ShieldCheck, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { api } from '../../utils/api';
import { CAPABILITIES } from '../../hooks/useEntitlements';
import ProFeatureGate from '../entitlements/ProFeatureGate';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

function Toggle({ checked, disabled, label, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-muted-foreground/30'} disabled:opacity-50`}
    >
      <span className={`mt-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  );
}

function LongTermMemorySettingsBody() {
  const { t } = useTranslation('settings');
  const [memories, setMemories] = useState([]);
  const [settings, setSettings] = useState({ enabled: true, autoCaptureEnabled: true });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [memoryLimit, setMemoryLimit] = useState(300);
  const importInputRef = useRef(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.settings.longTermMemory();
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || t('longTermMemorySettings.messages.loadError'));
      setMemories(Array.isArray(payload.memories) ? payload.memories : []);
      setMemoryLimit(Number(payload.stats?.limit) || 300);
      setSettings({
        enabled: payload.settings?.enabled !== false,
        autoCaptureEnabled: payload.settings?.autoCaptureEnabled !== false,
      });
      setError('');
      setNotice('');
    } catch (loadError) {
      setError(loadError.message || t('longTermMemorySettings.messages.loadError'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState === 'visible') void load({ silent: true });
    };
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [load]);

  const visibleMemories = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return memories.filter((memory) => {
      const sourceMatches = sourceFilter === 'all'
        || (sourceFilter === 'pinned' ? memory.pinned === true : memory.source === sourceFilter);
      const queryMatches = !normalized
        || String(memory.content || '').toLocaleLowerCase().includes(normalized)
        || String(memory.conversation_id || '').toLocaleLowerCase().includes(normalized);
      return sourceMatches && queryMatches;
    });
  }, [memories, query, sourceFilter]);

  const memoryStats = useMemo(() => ({
    total: memories.length,
    manual: memories.filter((memory) => memory.source === 'manual').length,
    automatic: memories.filter((memory) => memory.source === 'automatic').length,
    pinned: memories.filter((memory) => memory.pinned === true).length,
  }), [memories]);

  const getMutationError = (payload, fallbackKey) => (
    payload?.code === 'MEMORY_SENSITIVE_CONTENT'
      ? t('longTermMemorySettings.messages.sensitiveContent')
      : payload?.code === 'MEMORY_LIMIT_REACHED'
        ? t('longTermMemorySettings.messages.limitReached')
        : payload?.error || t(fallbackKey)
  );

  const updateSettings = async (updates) => {
    setBusy(true);
    setError('');
    try {
      const response = await api.settings.updateLongTermMemorySettings(updates);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || t('longTermMemorySettings.messages.settingsError'));
      setSettings(payload.settings);
    } catch (updateError) {
      setError(updateError.message || t('longTermMemorySettings.messages.settingsError'));
    } finally {
      setBusy(false);
    }
  };

  const addMemory = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    setError('');
    try {
      const response = await api.settings.createLongTermMemory(draft.trim());
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(getMutationError(payload, 'longTermMemorySettings.messages.createError'));
      if (payload.memory) {
        setMemories((current) => [payload.memory, ...current.filter((item) => item.id !== payload.memory.id)]);
      }
      setDraft('');
    } catch (createError) {
      setError(createError.message || t('longTermMemorySettings.messages.createError'));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (memoryId) => {
    if (!editDraft.trim()) return;
    setBusy(true);
    try {
      const response = await api.settings.updateLongTermMemory(memoryId, editDraft.trim());
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(getMutationError(payload, 'longTermMemorySettings.messages.updateError'));
      setMemories((current) => current.map((memory) => memory.id === memoryId ? payload.memory : memory));
      setEditingId(null);
      setEditDraft('');
      setError('');
    } catch (updateError) {
      setError(updateError.message || t('longTermMemorySettings.messages.updateError'));
    } finally {
      setBusy(false);
    }
  };

  const togglePinned = async (memory) => {
    setBusy(true);
    setError('');
    try {
      const response = await api.settings.setLongTermMemoryPinned(memory.id, !memory.pinned);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || t('longTermMemorySettings.messages.pinError'));
      setMemories((current) => current.map((item) => item.id === memory.id ? payload.memory : item));
    } catch (pinError) {
      setError(pinError.message || t('longTermMemorySettings.messages.pinError'));
    } finally {
      setBusy(false);
    }
  };

  const clearAutomaticMemory = async () => {
    if (!window.confirm(t('longTermMemorySettings.messages.confirmClearAutomatic'))) return;
    setBusy(true);
    try {
      const response = await api.settings.clearAutomaticLongTermMemory();
      if (!response.ok) throw new Error(t('longTermMemorySettings.messages.clearAutomaticError'));
      setMemories((current) => current.filter((memory) => memory.source !== 'automatic' || memory.pinned));
      setError('');
    } catch (clearError) {
      setError(clearError.message || t('longTermMemorySettings.messages.clearAutomaticError'));
    } finally {
      setBusy(false);
    }
  };

  const exportMemory = () => {
    const payload = JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      memories: memories.map(({ content, source, pinned, conversation_id, created_at, updated_at }) => ({
        content, source, pinned: pinned === true, conversationId: conversation_id || null, createdAt: created_at, updatedAt: updated_at,
      })),
    }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `medhelp-long-term-memory-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const importMemory = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      if (file.size > 1_000_000) throw new Error(t('longTermMemorySettings.messages.importTooLarge'));
      const parsed = JSON.parse(await file.text());
      const imported = Array.isArray(parsed) ? parsed : parsed?.memories;
      if (!Array.isArray(imported)) throw new Error(t('longTermMemorySettings.messages.importInvalid'));
      const response = await api.settings.importLongTermMemories(imported);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || t('longTermMemorySettings.messages.importError'));
      await load({ silent: true });
      setNotice(t('longTermMemorySettings.messages.importResult', {
        added: Number(payload.added) || 0,
        skipped: Number(payload.skipped) || 0,
        rejected: Number(payload.rejected) || 0,
      }));
    } catch (importError) {
      setError(importError.message || t('longTermMemorySettings.messages.importError'));
      setNotice('');
    } finally {
      setBusy(false);
    }
  };

  const deleteMemory = async (memoryId) => {
    if (!window.confirm(t('longTermMemorySettings.messages.confirmDelete'))) return;
    setBusy(true);
    try {
      const response = await api.settings.deleteLongTermMemory(memoryId);
      if (!response.ok) throw new Error(t('longTermMemorySettings.messages.deleteError'));
      setMemories((current) => current.filter((memory) => memory.id !== memoryId));
      setError('');
    } catch (deleteError) {
      setError(deleteError.message || t('longTermMemorySettings.messages.deleteError'));
    } finally {
      setBusy(false);
    }
  };

  const clearMemory = async () => {
    if (!window.confirm(t('longTermMemorySettings.messages.confirmClear'))) return;
    setBusy(true);
    try {
      const response = await api.settings.clearLongTermMemory();
      if (!response.ok) throw new Error(t('longTermMemorySettings.messages.clearError'));
      setMemories([]);
      setError('');
    } catch (clearError) {
      setError(clearError.message || t('longTermMemorySettings.messages.clearError'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="py-10 text-center text-sm text-muted-foreground">{t('longTermMemorySettings.messages.loading')}</div>;
  }

  return (
    <div className="space-y-5">
      <div className="border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <BrainCircuit className="h-5 w-5 text-violet-500" />
          <h3 className="text-lg font-semibold text-foreground">{t('longTermMemorySettings.title')}</h3>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t('longTermMemorySettings.description')}</p>
      </div>

      {error && <div className="rounded-lg border border-red-300/60 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-300/60 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">{notice}</div>}

      <div className="divide-y divide-border rounded-lg border border-border">
        <div className="flex items-center justify-between gap-4 p-4">
          <div><div className="text-sm font-medium">{t('longTermMemorySettings.recall.title')}</div><div className="mt-1 text-xs text-muted-foreground">{t('longTermMemorySettings.recall.description')}</div></div>
          <Toggle checked={settings.enabled} disabled={busy} label={t('longTermMemorySettings.recall.title')} onChange={(enabled) => updateSettings({ enabled })} />
        </div>
        <div className="flex items-center justify-between gap-4 p-4">
          <div><div className="flex items-center gap-2 text-sm font-medium"><Sparkles className="h-4 w-4 text-violet-500" />{t('longTermMemorySettings.autoCapture.title')}</div><div className="mt-1 text-xs text-muted-foreground">{t('longTermMemorySettings.autoCapture.description')}</div></div>
          <Toggle checked={settings.autoCaptureEnabled} disabled={busy} label={t('longTermMemorySettings.autoCapture.title')} onChange={(autoCaptureEnabled) => updateSettings({ autoCaptureEnabled })} />
        </div>
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950/20">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <div><div className="font-medium text-foreground">{t('longTermMemorySettings.safety.title')}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{t('longTermMemorySettings.safety.description')}</p></div>
      </div>

      <div className="rounded-lg border border-border p-4">
        <div className="mb-3 text-sm font-medium">{t('longTermMemorySettings.add.title')}</div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={draft} maxLength={240} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void addMemory(); }} placeholder={t('longTermMemorySettings.add.placeholder')} className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
          <Button type="button" onClick={addMemory} disabled={busy || !draft.trim()} className="gap-2"><Plus className="h-4 w-4" />{t('longTermMemorySettings.add.action')}</Button>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h4 className="text-sm font-medium">{t('longTermMemorySettings.list.title', { count: memories.length })}</h4><p className="mt-1 text-xs text-muted-foreground">{t('longTermMemorySettings.list.description', { limit: memoryLimit })}</p></div>
          <div className="flex items-center gap-2">
            <label className="flex h-9 items-center gap-2 rounded-md border border-input px-3 text-sm"><Search className="h-4 w-4 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('longTermMemorySettings.list.search')} className="w-36 bg-transparent outline-none" /></label>
            <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={importMemory} />
            <Button type="button" size="sm" variant="outline" onClick={() => importInputRef.current?.click()} disabled={busy} className="gap-1"><Upload className="h-4 w-4" />{t('longTermMemorySettings.list.import')}</Button>
            {memories.length > 0 && <Button type="button" size="sm" variant="outline" onClick={exportMemory} disabled={busy} className="gap-1"><Download className="h-4 w-4" />{t('longTermMemorySettings.list.export')}</Button>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {[
            ['all', memoryStats.total],
            ['manual', memoryStats.manual],
            ['automatic', memoryStats.automatic],
            ['pinned', memoryStats.pinned],
          ].map(([filter, count]) => (
            <Button key={filter} type="button" size="sm" variant={sourceFilter === filter ? 'default' : 'outline'} onClick={() => setSourceFilter(filter)}>
              {t(`longTermMemorySettings.filters.${filter}`, { count })}
            </Button>
          ))}
          <div className="ml-auto flex gap-2">
            {memoryStats.automatic > 0 && <Button type="button" size="sm" variant="outline" onClick={clearAutomaticMemory} disabled={busy}>{t('longTermMemorySettings.list.clearAutomatic')}</Button>}
            {memories.length > 0 && <Button type="button" size="sm" variant="outline" onClick={clearMemory} disabled={busy} className="text-destructive">{t('longTermMemorySettings.list.clear')}</Button>}
          </div>
        </div>

        {visibleMemories.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">{query || sourceFilter !== 'all' ? t('longTermMemorySettings.list.noMatches') : t('longTermMemorySettings.list.empty')}</div>
        ) : visibleMemories.map((memory) => (
          <div key={memory.id} className="rounded-lg border border-border p-4">
            {editingId === memory.id ? (
              <div className="flex flex-col gap-2 sm:flex-row"><input value={editDraft} maxLength={240} onChange={(event) => setEditDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void saveEdit(memory.id); }} className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" /><Button size="sm" variant="ghost" aria-label={t('longTermMemorySettings.actions.cancel')} title={t('longTermMemorySettings.actions.cancel')} onClick={() => { setEditingId(null); setEditDraft(''); }}><X className="h-4 w-4" /></Button><Button size="sm" aria-label={t('longTermMemorySettings.actions.save')} title={t('longTermMemorySettings.actions.save')} onClick={() => saveEdit(memory.id)} disabled={busy || !editDraft.trim()}><Check className="h-4 w-4" /></Button></div>
            ) : (
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1"><p className="text-sm leading-6 text-foreground">{memory.content}</p><div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Badge variant={memory.source === 'automatic' ? 'secondary' : 'outline'}>{memory.source === 'automatic' ? t('longTermMemorySettings.list.automatic') : t('longTermMemorySettings.list.manual')}</Badge>{memory.pinned && <Badge variant="outline" className="gap-1"><Pin className="h-3 w-3" />{t('longTermMemorySettings.list.pinned')}</Badge>}{memory.safe === false && <Badge variant="destructive">{t('longTermMemorySettings.list.blockedSensitive')}</Badge>}{memory.updated_at && <span>{new Date(memory.updated_at).toLocaleString()}</span>}{memory.conversation_id && <span title={memory.conversation_id}>{t('longTermMemorySettings.list.fromConversation', { id: memory.conversation_id.slice(0, 12) })}</span>}</div></div>
                <Button size="sm" variant="ghost" aria-label={memory.pinned ? t('longTermMemorySettings.actions.unpin') : t('longTermMemorySettings.actions.pin')} title={memory.pinned ? t('longTermMemorySettings.actions.unpin') : t('longTermMemorySettings.actions.pin')} onClick={() => togglePinned(memory)} disabled={busy}>{memory.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}</Button>
                <Button size="sm" variant="ghost" aria-label={t('longTermMemorySettings.actions.edit')} title={t('longTermMemorySettings.actions.edit')} onClick={() => { setEditingId(memory.id); setEditDraft(memory.content); }} disabled={busy}><Edit3 className="h-4 w-4" /></Button>
                <Button size="sm" variant="ghost" aria-label={t('longTermMemorySettings.actions.delete')} title={t('longTermMemorySettings.actions.delete')} onClick={() => deleteMemory(memory.id)} disabled={busy}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LongTermMemorySettingsContent() {
  return <ProFeatureGate capability={CAPABILITIES.persistentMemory} feature="projectMemory" compact><LongTermMemorySettingsBody /></ProFeatureGate>;
}
