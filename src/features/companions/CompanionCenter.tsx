import { useCallback, useEffect, useMemo, useState } from 'react';
import { Brain, Plus, Save, Sparkles, Trash2, X } from 'lucide-react';
import { ExplorerPage, explorerItemClass } from '../../components/explorer/ExplorerPage';
import { api } from '../../utils/api';
import CompanionAvatar from './CompanionAvatar';
import { COMPANION_AVATARS, type Companion, type CompanionAvatar as Avatar, type CompanionMemory } from './types';
import { notifyCompanionsChanged } from './useDesktopCompanionSync';

async function json<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload as T;
}

export default function CompanionCenter({ onMenuClick }: { onMenuClick?: () => void }) {
  const [companions, setCompanions] = useState<Companion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [memories, setMemories] = useState<CompanionMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newMemory, setNewMemory] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', avatar: 'mochi' as Avatar, persona: '' });
  const [searchQuery, setSearchQuery] = useState('');

  const visibleCompanions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return companions;
    return companions.filter((item) => item.name.toLowerCase().includes(query) || item.persona.toLowerCase().includes(query));
  }, [companions, searchQuery]);
  const selected = useMemo(() => visibleCompanions.find((item) => item.id === selectedId) || visibleCompanions[0] || null, [selectedId, visibleCompanions]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await json<{ companions: Companion[] }>(await api.companions.list());
      setCompanions(payload.companions);
      setSelectedId((current) => payload.companions.some((item) => item.id === current) ? current : payload.companions[0]?.id || null);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMemories = useCallback(async (id: string) => {
    try {
      const payload = await json<{ memories: CompanionMemory[] }>(await api.companions.memories(id));
      setMemories(payload.memories);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (selected?.id && !creating) void loadMemories(selected.id); else setMemories([]); }, [creating, loadMemories, selected?.id]);
  useEffect(() => {
    if (selected && !creating) setDraft({ name: selected.name, avatar: selected.avatar, persona: selected.persona });
  }, [creating, selected]);

  const update = async (body: Record<string, unknown>) => {
    if (!selected) return;
    setBusy(true);
    try {
      await json(await api.companions.update(selected.id, body));
      await load();
      notifyCompanionsChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const name = draft.name.trim() || '新伙伴';
    setBusy(true);
    try {
      const payload = await json<{ companion: Companion }>(await api.companions.create({ ...draft, name }));
      setCreating(false);
      await load();
      setSelectedId(payload.companion.id);
      notifyCompanionsChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="grid h-full place-items-center text-sm text-muted-foreground">正在唤醒桌面伙伴…</div>;

  return (
    <ExplorerPage
      onMenuClick={onMenuClick}
      eyebrow="Companions"
      title="伙伴列表"
      countLabel={`${visibleCompanions.length}`}
      searchPlaceholder="搜索伙伴…"
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      sidebar={visibleCompanions.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-muted-foreground">还没有伙伴。</p>
      ) : visibleCompanions.map((item) => (
        <button key={item.id} type="button" onClick={() => { setSelectedId(item.id); setCreating(false); }} className={explorerItemClass(selected?.id === item.id && !creating)}>
          <span className="flex min-w-0 items-center gap-2">
            <CompanionAvatar avatar={item.avatar} size="sm" />
            <span className="min-w-0">
              <span className="block truncate">{item.name}</span>
              <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">Lv.{item.level} · {item.mood}</span>
            </span>
          </span>
        </button>
      ))}
      resultsEyebrow="桌面伙伴"
      resultsTitle={creating ? '创建新伙伴' : selected?.name || '伙伴详情'}
      resultsDescription={creating ? '选择形象并定义它与你相处的方式。' : '每个伙伴都有独立的形象、人格、成长状态与记忆。'}
      resultsActions={<button type="button" onClick={() => { setCreating(true); setDraft({ name: '', avatar: 'mochi', persona: '' }); }} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"><Plus className="h-4 w-4" />新建伙伴</button>}
    >
      <div className="space-y-4 p-5">
        {error && <div className="flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}<button type="button" onClick={() => setError('')}><X className="h-4 w-4" /></button></div>}
        {(selected || creating) ? (
          <div className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
            <section className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="mb-5 flex items-center gap-4">
                <CompanionAvatar avatar={draft.avatar} size="md" />
                <div className="flex-1"><h2 className="font-semibold">{creating ? '创建新伙伴' : selected?.name}</h2><p className="text-xs text-muted-foreground">选择形象并定义它与你相处的方式</p></div>
                {!creating && selected && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.desktopEnabled} onChange={(event) => void update({ desktopEnabled: event.target.checked })} disabled={busy} />显示桌面浮窗</label>}
              </div>
              <label className="mb-4 block text-sm font-medium">名字<input value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-1.5 w-full rounded-xl border bg-background px-3 py-2 outline-none focus:border-primary" maxLength={48} /></label>
              <div className="mb-4"><div className="mb-2 text-sm font-medium">形象</div><div className="grid grid-cols-6 gap-2">{COMPANION_AVATARS.map((avatar) => <button key={avatar.id} type="button" onClick={() => setDraft((value) => ({ ...value, avatar: avatar.id }))} className={`rounded-xl p-1.5 ${draft.avatar === avatar.id ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-muted'}`}><CompanionAvatar avatar={avatar.id} size="sm" /></button>)}</div></div>
              <label className="block text-sm font-medium">人格设定<textarea value={draft.persona} onChange={(event) => setDraft((value) => ({ ...value, persona: event.target.value }))} className="mt-1.5 min-h-28 w-full resize-y rounded-xl border bg-background px-3 py-2 outline-none focus:border-primary" placeholder="例如：温和但直率，善于把复杂问题拆成小步骤。" maxLength={2000} /></label>
              <div className="mt-5 flex justify-between gap-3">
                {!creating && selected ? <button type="button" onClick={async () => { if (!confirm(`确定删除 ${selected.name}？它的记忆也会被删除。`)) return; await json(await api.companions.delete(selected.id)); await load(); notifyCompanionsChanged(); }} className="inline-flex items-center gap-2 rounded-xl border border-destructive/30 px-3 py-2 text-sm text-destructive"><Trash2 className="h-4 w-4" />删除</button> : <button type="button" onClick={() => setCreating(false)} className="rounded-xl border px-3 py-2 text-sm">取消</button>}
                <button type="button" disabled={busy} onClick={() => creating ? void create() : void update(draft)} className="ml-auto inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"><Save className="h-4 w-4" />{creating ? '创建' : '保存'}</button>
              </div>
            </section>

            {!creating && selected && <section className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between"><div><h2 className="flex items-center gap-2 font-semibold"><Brain className="h-4 w-4 text-primary" />独立记忆</h2><p className="mt-1 text-xs text-muted-foreground">这些内容只属于 {selected.name}</p></div><div className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"><Sparkles className="mr-1 inline h-3 w-3" />{selected.xp} XP</div></div>
              <form onSubmit={async (event) => { event.preventDefault(); if (!newMemory.trim()) return; await json(await api.companions.createMemory(selected.id, { content: newMemory })); setNewMemory(''); await Promise.all([loadMemories(selected.id), load()]); }} className="mb-4 flex gap-2"><input value={newMemory} onChange={(event) => setNewMemory(event.target.value)} className="min-w-0 flex-1 rounded-xl border bg-background px-3 py-2 text-sm outline-none focus:border-primary" placeholder="记住我的偏好、习惯或重要事项…" /><button className="rounded-xl bg-primary px-3 text-primary-foreground" type="submit"><Plus className="h-4 w-4" /></button></form>
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">{memories.map((memory) => <div key={memory.id} className="group flex items-start gap-3 rounded-xl border bg-background p-3"><div className="flex-1 text-sm leading-6">{memory.content}<div className="mt-1 text-[11px] text-muted-foreground">{new Date(memory.createdAt).toLocaleString()}</div></div><button type="button" onClick={async () => { await json(await api.companions.deleteMemory(selected.id, memory.id)); await loadMemories(selected.id); }} className="opacity-0 transition-opacity group-hover:opacity-100"><Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" /></button></div>)}{memories.length === 0 && <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">还没有记忆</div>}</div>
            </section>}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">还没有伙伴。创建一个，让它陪你完成今天的研究。</div>
        )}
      </div>
    </ExplorerPage>
  );
}
