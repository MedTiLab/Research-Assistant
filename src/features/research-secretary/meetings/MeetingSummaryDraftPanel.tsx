import { useState } from 'react';
import { Check, Circle, Loader2, WandSparkles } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import type { MeetingSummaryDraft, ResearchMeeting } from '../domain/types';
import type { ResearchSecretaryApi } from '../services/researchSecretaryApi';

export default function MeetingSummaryDraftPanel({ meeting, api, onChanged }: { meeting: ResearchMeeting; api: ResearchSecretaryApi; onChanged: () => Promise<unknown> }) {
  const [draft, setDraft] = useState<MeetingSummaryDraft | null>(null);
  const [selectedNotes, setSelectedNotes] = useState<Set<number>>(new Set());
  const [selectedActions, setSelectedActions] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generate = async () => {
    setBusy(true); setError(null);
    try {
      const next = await api.summarizeMeeting(meeting.id);
      setDraft(next);
      setSelectedNotes(new Set(next.notes.map((_, index) => index)));
      setSelectedActions(new Set(next.candidateActions.map((_, index) => index)));
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : '生成纪要草稿失败'); }
    finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!draft) return;
    setBusy(true); setError(null);
    try {
      for (const index of [...selectedNotes]) {
        const note = draft.notes[index];
        await api.createNote(meeting.id, note);
      }
      for (const index of [...selectedActions]) {
        const action = draft.candidateActions[index];
        await api.createAction(meeting.id, action);
      }
      setDraft(null); await onChanged();
    } catch (nextError) { setError(nextError instanceof Error ? nextError.message : '保存确认内容失败'); }
    finally { setBusy(false); }
  };
  if (!draft) return <div><Button size="sm" variant="outline" onClick={() => void generate()} disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}生成纪要草稿</Button>{error && <div className="mt-2 text-xs text-red-600">{error}</div>}</div>;
  return <div className="space-y-4">
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3"><div className="text-xs font-medium text-muted-foreground">摘要草稿</div><div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{draft.summary || '未生成摘要文字'}</div></div>
    <DraftList title="候选纪要" items={draft.notes.map((note) => note.content)} selected={selectedNotes} onChange={setSelectedNotes} />
    <DraftList title="候选行动项" items={draft.candidateActions.map((action) => action.content)} selected={selectedActions} onChange={setSelectedActions} />
    <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDraft(null)}>放弃草稿</Button><Button disabled={busy || (selectedNotes.size === 0 && selectedActions.size === 0)} onClick={() => void confirm()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}确认选中内容并保存</Button></div>
    {error && <div className="text-xs text-red-600">{error}</div>}
  </div>;
}

function DraftList({ title, items, selected, onChange }: { title: string; items: string[]; selected: Set<number>; onChange: (next: Set<number>) => void }) {
  if (!items.length) return null;
  return <div><div className="mb-2 text-xs font-medium text-muted-foreground">{title}</div><div className="space-y-2">{items.map((item, index) => <button key={`${item}-${index}`} type="button" onClick={() => { const next = new Set(selected); if (next.has(index)) next.delete(index); else next.add(index); onChange(next); }} className="flex w-full items-start gap-2 rounded-lg border border-border/60 p-3 text-left">{selected.has(index) ? <Check className="mt-0.5 h-4 w-4 text-emerald-600" /> : <Circle className="mt-0.5 h-4 w-4 text-muted-foreground" />}<span className="text-sm text-foreground">{item}</span></button>)}</div></div>;
}
