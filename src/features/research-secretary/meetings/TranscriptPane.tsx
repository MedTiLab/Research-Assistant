import { useEffect, useState } from 'react';
import { Clock3, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import type { MeetingTranscriptSegment } from '../domain/types';
import type { ResearchSecretaryApi } from '../services/researchSecretaryApi';

function timestamp(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function TranscriptPane({ segments, api, onChanged }: { segments: MeetingTranscriptSegment[]; api: ResearchSecretaryApi; onChanged: () => Promise<unknown> }) {
  const [drafts, setDrafts] = useState<Record<string, { speaker: string; text: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  useEffect(() => {
    setDrafts(Object.fromEntries(segments.map((segment) => [segment.id, { speaker: segment.speaker || '', text: segment.text }])))
  }, [segments]);
  const save = async (segment: MeetingTranscriptSegment) => {
    const draft = drafts[segment.id];
    if (!draft || (draft.speaker === (segment.speaker || '') && draft.text === segment.text)) return;
    setBusyId(segment.id);
    try { await api.updateTranscriptSegment(segment.id, { speaker: draft.speaker || undefined, text: draft.text }); await onChanged(); }
    finally { setBusyId(null); }
  };
  const done = segments.filter((segment) => segment.status === 'done').length;
  return <div className="mt-4">
    <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground"><span>转写进度</span><span>{done}/{segments.length}</span></div>
    <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: segments.length ? `${done / segments.length * 100}%` : '0%' }} /></div>
    {segments.length === 0 ? <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">录音分片上传后，转写会逐行出现在这里。</div> : <div className="space-y-2">{segments.map((segment) => {
      const draft = drafts[segment.id] || { speaker: segment.speaker || '', text: segment.text };
      return <div key={segment.id} className="rounded-lg border border-border/60 p-3">
        <div className="flex items-center justify-between gap-3"><span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Clock3 className="h-3 w-3" />{timestamp(segment.startMs)}–{timestamp(segment.endMs)}</span><span className="text-[11px] text-muted-foreground">{segment.status === 'done' ? '已完成' : segment.status === 'failed' ? '失败' : segment.status === 'transcribing' ? '转写中' : '等待中'}</span></div>
        {segment.status === 'failed' ? <div className="mt-2 flex items-center justify-between gap-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300"><span className="line-clamp-2">{segment.error || '转写失败'}</span><Button size="sm" variant="ghost" onClick={async () => { setBusyId(segment.id); try { await api.retryTranscriptSegment(segment.id); await onChanged(); } finally { setBusyId(null); } }} disabled={busyId === segment.id}><RefreshCw className="h-3.5 w-3.5" />重试</Button></div> : segment.status === 'done' ? <div className="mt-2 grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)]"><input value={draft.speaker} onChange={(event) => setDrafts((current) => ({ ...current, [segment.id]: { ...draft, speaker: event.target.value } }))} onBlur={() => void save(segment)} placeholder="我 / 导师" className="h-9 rounded-md border border-border bg-background px-2 text-xs" /><textarea value={draft.text} onChange={(event) => setDrafts((current) => ({ ...current, [segment.id]: { ...draft, text: event.target.value } }))} onBlur={() => void save(segment)} className="min-h-16 resize-y rounded-md border border-border bg-background px-3 py-2 text-sm leading-5" />{busyId === segment.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}</div> : <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在处理该分片</div>}
      </div>;
    })}</div>}
  </div>;
}
