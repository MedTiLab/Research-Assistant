import { useEffect, useMemo, useState } from 'react';
import { Check, Circle, CircleStop, ListChecks, Loader2, MessageSquareText, Plus, Trash2 } from 'lucide-react';
import type { Project } from '../../../types/app';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import { ExplorerPage, explorerItemClass } from '../../../components/explorer/ExplorerPage';
import { EmptyState, SectionCard, StatusBadge, formatWorkbenchDate } from '../components/WorkbenchUi';
import type { MeetingAgendaKind, MeetingNoteType, ResearchMeeting } from '../domain/types';
import { useResearchSecretarySnapshot } from '../services/useResearchSecretarySnapshot';
import MeetingRecorder from './MeetingRecorder';
import MeetingSummaryDraftPanel from './MeetingSummaryDraftPanel';
import TranscriptPane from './TranscriptPane';
import ActionItemBoard from './ActionItemBoard';
import type { WorkbenchCommand } from '../domain/workbenchCommand';

type Props = { projects: Project[]; onCommand?: (command: WorkbenchCommand) => void; onMenuClick?: () => void };
const STATUS_LABELS = { upcoming: '会前', in_progress: '会中', done: '会后' } as const;
const AGENDA_LABELS: Record<MeetingAgendaKind, string> = { carryover_action: '上次未完成', my_report: '我的汇报', question_for_advisor: '请导师决策', literature: '文献讨论' };
const NOTE_LABELS: Record<MeetingNoteType, string> = { feedback: '反馈', decision: '决定', question: '问题', idea: '想法' };
const FIELD_CLASS = 'h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10';

function toLocalDateTime(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function MeetingCenter({ projects, onCommand, onMenuClick }: Props) {
  const { api, snapshot, isLoading, error, refresh } = useResearchSecretarySnapshot(projects);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [meetingDetails, setMeetingDetails] = useState<Record<string, ResearchMeeting>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [newAgenda, setNewAgenda] = useState('');
  const [agendaKind, setAgendaKind] = useState<MeetingAgendaKind>('my_report');
  const [noteContent, setNoteContent] = useState('');
  const [noteSpeaker, setNoteSpeaker] = useState('我');
  const [noteType, setNoteType] = useState<MeetingNoteType>('idea');
  const [searchQuery, setSearchQuery] = useState('');
  const [form, setForm] = useState({
    title: '', meetingDate: toLocalDateTime(new Date(Date.now() + 86_400_000)),
    meetingType: 'group' as ResearchMeeting['meetingType'], myRole: 'presenter' as ResearchMeeting['myRole'],
    location: '', projectId: '',
  });
  const meetings = useMemo(() => [...snapshot.meetings].sort((a, b) => a.meetingDate.localeCompare(b.meetingDate)), [snapshot.meetings]);
  const visibleMeetings = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return meetings;
    return meetings.filter((meeting) => meeting.title.toLowerCase().includes(query) || (meeting.location || '').toLowerCase().includes(query));
  }, [meetings, searchQuery]);
  const selectedSummary = visibleMeetings.find((meeting) => meeting.id === selectedId) || visibleMeetings[0] || meetings.find((meeting) => meeting.id === selectedId) || null;
  const selected = selectedSummary ? meetingDetails[selectedSummary.id] || selectedSummary : null;

  useEffect(() => {
    if (!selectedId && meetings[0]) setSelectedId(meetings[0].id);
    if (selectedId && !meetings.some((meeting) => meeting.id === selectedId)) setSelectedId(meetings[0]?.id || null);
  }, [meetings, selectedId]);

  useEffect(() => {
    if (!selectedSummary || meetingDetails[selectedSummary.id]) return;
    let cancelled = false;
    void api.getMeeting(selectedSummary.id).then((meeting) => {
      if (!cancelled) setMeetingDetails((current) => ({ ...current, [meeting.id]: meeting }));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [api, meetingDetails, selectedSummary]);

  const mutate = async (operation: () => Promise<unknown>) => {
    setBusy(true); setMutationError(null);
    try {
      await operation();
      await refresh();
      if (selectedId) {
        const meeting = await api.getMeeting(selectedId);
        setMeetingDetails((current) => ({ ...current, [meeting.id]: meeting }));
      }
    }
    catch (nextError) { setMutationError(nextError instanceof Error ? nextError.message : '操作失败'); }
    finally { setBusy(false); }
  };

  const createMeeting = async () => {
    if (!form.title.trim() || !form.meetingDate) return;
    let createdId: string | null = null;
    await mutate(async () => {
      const created = await api.createMeeting({
        title: form.title.trim(), meetingDate: new Date(form.meetingDate).toISOString(),
        meetingType: form.meetingType, myRole: form.myRole,
        location: form.location.trim() || undefined, projectId: form.projectId || undefined,
      });
      createdId = created.id; setShowCreate(false); setForm((current) => ({ ...current, title: '', location: '' }));
    });
    if (createdId) setSelectedId(createdId);
  };

  const carryovers = selected?.agenda?.filter((item) => item.kind === 'carryover_action') || [];
  const regularAgenda = selected?.agenda?.filter((item) => item.kind !== 'carryover_action') || [];

  return (
    <ExplorerPage
      onMenuClick={onMenuClick}
      eyebrow="Research operations"
      title="组会列表"
      countLabel={`${visibleMeetings.length}/${meetings.length}`}
      searchPlaceholder="搜索组会标题或地点…"
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      sidebar={isLoading && meetings.length === 0 ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : visibleMeetings.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-muted-foreground">{meetings.length === 0 ? '还没有组会记录。' : '没有匹配的组会。'}</p>
      ) : visibleMeetings.map((meeting) => (
        <button key={meeting.id} type="button" onClick={() => { setSelectedId(meeting.id); setShowCreate(false); }} className={explorerItemClass(selected?.id === meeting.id && !showCreate)}>
          <span className="min-w-0">
            <span className="block truncate">{meeting.title}</span>
            <span className="mt-1 block text-[11px] font-normal text-muted-foreground">{formatWorkbenchDate(meeting.meetingDate)}</span>
          </span>
          <MeetingStatus meeting={meeting} />
        </button>
      ))}
      resultsEyebrow="组会闭环"
      resultsTitle={showCreate ? '新建组会' : selected?.title || '组会详情'}
      resultsDescription={showCreate ? '会前带入未完成事项，会中记录反馈和决定，会后确认行动项。' : selected ? (
        <span className="flex flex-wrap gap-x-5 gap-y-2">
          <span>{formatWorkbenchDate(selected.meetingDate)}</span>
          {selected.location ? <span>{selected.location}</span> : null}
          <span>{selected.myRole === 'presenter' ? '我的角色：汇报人' : '我的角色：参会人'}</span>
        </span>
      ) : '选择或新建一场组会。'}
      resultsActions={(
        <div className="flex items-center gap-2">
          {!showCreate && selected ? <MeetingStatus meeting={selected} /> : null}
          {!showCreate && selected && <Button size="sm" variant="outline" onClick={() => onCommand?.({ prompt: `帮我逐项核对「${selected.title}」的会前准备、纪要和行动项`, entity: { kind: 'meeting', id: selected.id }, skills: ['medhelp-workbench-review'] })}><MessageSquareText className="h-4 w-4" />让助手核对</Button>}
          {!showCreate && selected?.status === 'upcoming' && <Button size="sm" onClick={() => void mutate(() => api.updateMeeting(selected.id, { status: 'in_progress' }))} disabled={busy}>开始组会</Button>}
          {!showCreate && selected?.status === 'in_progress' && <Button size="sm" variant="outline" onClick={() => void mutate(() => api.updateMeeting(selected.id, { status: 'done' }))} disabled={busy}><CircleStop className="h-4 w-4" />结束组会</Button>}
          <Button size="sm" className="rounded-lg" onClick={() => setShowCreate((value) => !value)}><Plus className="h-4 w-4" />{showCreate ? '取消' : '新建组会'}</Button>
        </div>
      )}
    >
      {(error || mutationError) && <div className="mx-5 mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{mutationError || error}</div>}
      {showCreate ? (
        <div className="p-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Field label="标题"><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className={FIELD_CLASS} placeholder="例如：课题组周例会" /></Field>
            <Field label="时间"><input type="datetime-local" value={form.meetingDate} onChange={(event) => setForm({ ...form, meetingDate: event.target.value })} className={FIELD_CLASS} /></Field>
            <Field label="关联项目"><select value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })} className={FIELD_CLASS}><option value="">跨项目</option>{projects.map((project) => <option key={project.name} value={project.name}>{project.displayName}</option>)}</select></Field>
            <Field label="类型"><select value={form.meetingType} onChange={(event) => setForm({ ...form, meetingType: event.target.value as ResearchMeeting['meetingType'] })} className={FIELD_CLASS}><option value="group">课题组组会</option><option value="one_on_one">导师一对一</option><option value="journal_club">文献汇报</option><option value="progress">进展汇报</option></select></Field>
            <Field label="我的角色"><select value={form.myRole} onChange={(event) => setForm({ ...form, myRole: event.target.value as ResearchMeeting['myRole'] })} className={FIELD_CLASS}><option value="presenter">汇报人</option><option value="attendee">参会人</option></select></Field>
            <Field label="地点 / 会议链接"><input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} className={FIELD_CLASS} /></Field>
          </div>
          <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setShowCreate(false)}>取消</Button><Button onClick={() => void createMeeting()} disabled={busy || !form.title.trim() || !form.meetingDate}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}创建并带入未完成事项</Button></div>
        </div>
      ) : !selected ? (
        <div className="p-5"><EmptyState>还没有真实组会记录。点击“新建组会”开始第一次闭环。</EmptyState></div>
      ) : (
      <div className="space-y-4 p-5">
        {selected.status === 'upcoming' && <>
          <SectionCard title={`上次未完成 · ${carryovers.length}`} icon={<Circle className="h-4 w-4 text-amber-500" />}>{carryovers.length === 0 ? <EmptyState>没有需要从上次延续的事项。</EmptyState> : <div className="divide-y divide-border/60">{carryovers.map((item) => <AgendaRow key={item.id} item={item} busy={busy} onToggle={() => mutate(() => api.updateAgendaItem(item.id, { done: !item.done }))} onDelete={() => mutate(() => api.deleteAgendaItem(item.id))} />)}</div>}</SectionCard>
          <SectionCard title={`本次议程 · ${regularAgenda.length}`} icon={<ListChecks className="h-4 w-4 text-primary" />}>
            <div className="mb-4 flex flex-col gap-2 sm:flex-row"><select value={agendaKind} onChange={(event) => setAgendaKind(event.target.value as MeetingAgendaKind)} className={cn(FIELD_CLASS, 'sm:w-40')}><option value="my_report">我的汇报</option><option value="question_for_advisor">请导师决策</option><option value="literature">文献讨论</option></select><input value={newAgenda} onChange={(event) => setNewAgenda(event.target.value)} className={cn(FIELD_CLASS, 'min-w-0 flex-1')} placeholder="添加一个明确的议程条目" /><Button disabled={busy || !newAgenda.trim()} onClick={() => void mutate(async () => { await api.createAgendaItem(selected.id, { kind: agendaKind, title: newAgenda.trim(), orderIndex: selected.agenda?.length || 0 }); setNewAgenda(''); })}><Plus className="h-4 w-4" />添加</Button></div>
            {regularAgenda.length === 0 ? <EmptyState>议程为空。先写下这次要汇报、讨论或请导师决策的事项。</EmptyState> : <div className="divide-y divide-border/60">{regularAgenda.map((item) => <AgendaRow key={item.id} item={item} busy={busy} onToggle={() => mutate(() => api.updateAgendaItem(item.id, { done: !item.done }))} onDelete={() => mutate(() => api.deleteAgendaItem(item.id))} />)}</div>}
          </SectionCard>
        </>}

        {selected.status === 'in_progress' && <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
          <SectionCard title="议程" icon={<ListChecks className="h-4 w-4 text-primary" />}><div className="divide-y divide-border/60">{(selected.agenda || []).map((item) => <AgendaRow key={item.id} item={item} busy={busy} onToggle={() => mutate(() => api.updateAgendaItem(item.id, { done: !item.done }))} />)}</div></SectionCard>
          <SectionCard title="实时记录" icon={<MessageSquareText className="h-4 w-4 text-primary" />}>
            <MeetingRecorder meetingId={selected.id} api={api} onChanged={refresh} />
            <div className="grid gap-2 sm:grid-cols-[100px_110px_minmax(0,1fr)]"><input value={noteSpeaker} onChange={(event) => setNoteSpeaker(event.target.value)} className={FIELD_CLASS} placeholder="说话人" /><select value={noteType} onChange={(event) => setNoteType(event.target.value as MeetingNoteType)} className={FIELD_CLASS}>{Object.entries(NOTE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><div className="flex gap-2"><input value={noteContent} onChange={(event) => setNoteContent(event.target.value)} className={cn(FIELD_CLASS, 'min-w-0 flex-1')} placeholder="记录反馈、决定、问题或想法" /><Button disabled={busy || !noteContent.trim()} onClick={() => void mutate(async () => { await api.createNote(selected.id, { speaker: noteSpeaker.trim() || undefined, content: noteContent.trim(), noteType }); setNoteContent(''); })}>记录</Button></div></div>
            <NotesList meeting={selected} busy={busy} onPromote={(noteId) => mutate(() => api.promoteNote(noteId))} />
            <TranscriptPane segments={selected.transcriptSegments || []} api={api} onChanged={refresh} />
          </SectionCard>
        </div>}

        {selected.status === 'done' && <>
          <SectionCard title="AI 纪要草稿（确认后才保存）"><MeetingSummaryDraftPanel meeting={selected} api={api} onChanged={refresh} /></SectionCard>
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title={`纪要 · ${selected.notes?.length || 0}`} icon={<MessageSquareText className="h-4 w-4 text-primary" />}><NotesList meeting={selected} busy={busy} onPromote={(noteId) => mutate(() => api.promoteNote(noteId))} /></SectionCard>
            <SectionCard title={`行动项 · ${selected.actions?.length || 0}`} icon={<Check className="h-4 w-4 text-primary" />}><ActionItemBoard actions={selected.actions || []} api={api} onChanged={refresh} /></SectionCard>
          </div>
          <SectionCard title={`转写全文 · ${selected.transcriptSegments?.length || 0}`}><TranscriptPane segments={selected.transcriptSegments || []} api={api} onChanged={refresh} /></SectionCard>
        </>}

        <div className="flex justify-end"><Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" disabled={busy} onClick={() => { if (window.confirm(`确定删除“${selected.title}”及其全部记录吗？`)) void mutate(() => api.deleteMeeting(selected.id)); }}><Trash2 className="h-4 w-4" />删除组会</Button></div>
      </div>
      )}
    </ExplorerPage>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-1.5 text-xs text-muted-foreground"><span>{label}</span>{children}</label>;
}

function MeetingStatus({ meeting }: { meeting: ResearchMeeting }) {
  return <StatusBadge tone={meeting.status === 'done' ? 'success' : meeting.status === 'in_progress' ? 'warning' : 'neutral'}>{STATUS_LABELS[meeting.status]}</StatusBadge>;
}

function AgendaRow({ item, busy, onToggle, onDelete }: { item: NonNullable<ResearchMeeting['agenda']>[number]; busy: boolean; onToggle: () => Promise<void>; onDelete?: () => Promise<void> }) {
  return <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"><button type="button" disabled={busy} onClick={() => void onToggle()} className="mt-0.5">{item.done ? <Check className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-muted-foreground" />}</button><div className="min-w-0 flex-1"><div className={cn('text-sm text-foreground', item.done && 'line-through opacity-60')}>{item.title}</div><div className="mt-1 text-[11px] text-muted-foreground">{AGENDA_LABELS[item.kind]}</div></div>{onDelete && <button type="button" disabled={busy} onClick={() => void onDelete()} className="text-muted-foreground hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}</div>;
}

function NotesList({ meeting, busy, onPromote }: { meeting: ResearchMeeting; busy: boolean; onPromote: (noteId: string) => Promise<void> }) {
  if (!meeting.notes?.length) return <EmptyState>还没有会议记录。</EmptyState>;
  return <div className="mt-4 space-y-2">{meeting.notes.map((note) => <div key={note.id} className="rounded-lg border border-border/60 p-3"><div className="flex items-center justify-between gap-3"><div className="text-xs text-muted-foreground">{note.speaker || '未标注'} · {NOTE_LABELS[note.noteType]}</div>{note.promotedActionId ? <StatusBadge tone="success">已转行动项</StatusBadge> : <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onPromote(note.id)}>转行动项</Button>}</div><div className="mt-2 text-sm leading-6 text-foreground">{note.content}</div></div>)}</div>;
}
