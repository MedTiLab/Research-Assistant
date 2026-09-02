import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Circle, CircleStop, ListChecks, Loader2, MessageSquareText, Plus, Trash2 } from 'lucide-react';
import type { Project } from '../../../types/app';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import { ExplorerPage, explorerItemClass } from '../../../components/explorer/ExplorerPage';
import { EmptyState, SectionCard, StatusBadge, formatWorkbenchDate } from '../components/WorkbenchUi';
import type { MeetingAgendaKind, MeetingNoteType, ResearchMeeting } from '../domain/types';
import { workbenchLocale } from '../i18n';
import { useResearchSecretarySnapshot } from '../services/useResearchSecretarySnapshot';
import MeetingRecorder from './MeetingRecorder';
import MeetingSummaryDraftPanel from './MeetingSummaryDraftPanel';
import TranscriptPane from './TranscriptPane';
import ActionItemBoard from './ActionItemBoard';
import type { WorkbenchCommand } from '../domain/workbenchCommand';

type Props = { projects: Project[]; onCommand?: (command: WorkbenchCommand) => void; onMenuClick?: () => void };
const FIELD_CLASS = 'h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10';
const NOTE_TYPES: MeetingNoteType[] = ['feedback', 'decision', 'question', 'idea'];

function toLocalDateTime(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function MeetingCenter({ projects, onCommand, onMenuClick }: Props) {
  const { t, i18n } = useTranslation('workbench');
  const locale = workbenchLocale(i18n.language);
  const { api, snapshot, isLoading, error, refresh } = useResearchSecretarySnapshot(projects);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [meetingDetails, setMeetingDetails] = useState<Record<string, ResearchMeeting>>({});
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [newAgenda, setNewAgenda] = useState('');
  const [agendaKind, setAgendaKind] = useState<MeetingAgendaKind>('my_report');
  const [noteContent, setNoteContent] = useState('');
  const [noteSpeaker, setNoteSpeaker] = useState('');
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
    catch (nextError) { setMutationError(nextError instanceof Error ? nextError.message : t('common.actionFailed')); }
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
      title={t('meetings.title')}
      countLabel={`${visibleMeetings.length}/${meetings.length}`}
      searchPlaceholder={t('meetings.searchPlaceholder')}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      sidebar={isLoading && meetings.length === 0 ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : visibleMeetings.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-muted-foreground">{meetings.length === 0 ? t('meetings.emptyList') : t('meetings.noMatch')}</p>
      ) : visibleMeetings.map((meeting) => (
        <button key={meeting.id} type="button" onClick={() => { setSelectedId(meeting.id); setShowCreate(false); }} className={explorerItemClass(selected?.id === meeting.id && !showCreate)}>
          <span className="min-w-0">
            <span className="block truncate">{meeting.title}</span>
            <span className="mt-1 block text-[11px] font-normal text-muted-foreground">{formatWorkbenchDate(meeting.meetingDate, undefined, locale)}</span>
          </span>
          <MeetingStatus meeting={meeting} />
        </button>
      ))}
      resultsEyebrow={t('meetings.resultsEyebrow')}
      resultsTitle={showCreate ? t('meetings.newMeeting') : selected?.title || t('meetings.detailTitle')}
      resultsDescription={showCreate ? t('meetings.createDescription') : selected ? (
        <span className="flex flex-wrap gap-x-5 gap-y-2">
          <span>{formatWorkbenchDate(selected.meetingDate, undefined, locale)}</span>
          {selected.location ? <span>{selected.location}</span> : null}
          <span>{selected.myRole === 'presenter' ? t('meetings.rolePresenter') : t('meetings.roleAttendee')}</span>
        </span>
      ) : t('meetings.emptySelect')}
      resultsActions={(
        <div className="flex items-center gap-2">
          {!showCreate && selected ? <MeetingStatus meeting={selected} /> : null}
          {!showCreate && selected && <Button size="sm" variant="outline" onClick={() => onCommand?.({ prompt: t('meetings.reviewPrompt', { title: selected.title }), entity: { kind: 'meeting', id: selected.id }, skills: ['medhelp-workbench-review'] })}><MessageSquareText className="h-4 w-4" />{t('meetings.reviewWithAssistant')}</Button>}
          {!showCreate && selected?.status === 'upcoming' && <Button size="sm" onClick={() => void mutate(() => api.updateMeeting(selected.id, { status: 'in_progress' }))} disabled={busy}>{t('meetings.startMeeting')}</Button>}
          {!showCreate && selected?.status === 'in_progress' && <Button size="sm" variant="outline" onClick={() => void mutate(() => api.updateMeeting(selected.id, { status: 'done' }))} disabled={busy}><CircleStop className="h-4 w-4" />{t('meetings.endMeeting')}</Button>}
          <Button size="sm" className="rounded-lg" onClick={() => setShowCreate((value) => !value)}><Plus className="h-4 w-4" />{showCreate ? t('common.cancel') : t('meetings.newMeeting')}</Button>
        </div>
      )}
    >
      {(error || mutationError) && <div className="mx-5 mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{mutationError || error}</div>}
      {showCreate ? (
        <div className="p-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Field label={t('meetings.fields.title')}><input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className={FIELD_CLASS} placeholder={t('meetings.titlePlaceholder')} /></Field>
            <Field label={t('meetings.fields.time')}><input type="datetime-local" value={form.meetingDate} onChange={(event) => setForm({ ...form, meetingDate: event.target.value })} className={FIELD_CLASS} /></Field>
            <Field label={t('meetings.fields.project')}><select value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })} className={FIELD_CLASS}><option value="">{t('common.crossProject')}</option>{projects.map((project) => <option key={project.name} value={project.name}>{project.displayName}</option>)}</select></Field>
            <Field label={t('meetings.fields.type')}><select value={form.meetingType} onChange={(event) => setForm({ ...form, meetingType: event.target.value as ResearchMeeting['meetingType'] })} className={FIELD_CLASS}><option value="group">{t('meetings.types.group')}</option><option value="one_on_one">{t('meetings.types.one_on_one')}</option><option value="journal_club">{t('meetings.types.journal_club')}</option><option value="progress">{t('meetings.types.progress')}</option></select></Field>
            <Field label={t('meetings.fields.role')}><select value={form.myRole} onChange={(event) => setForm({ ...form, myRole: event.target.value as ResearchMeeting['myRole'] })} className={FIELD_CLASS}><option value="presenter">{t('meetings.roles.presenter')}</option><option value="attendee">{t('meetings.roles.attendee')}</option></select></Field>
            <Field label={t('meetings.fields.location')}><input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} className={FIELD_CLASS} /></Field>
          </div>
          <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setShowCreate(false)}>{t('common.cancel')}</Button><Button onClick={() => void createMeeting()} disabled={busy || !form.title.trim() || !form.meetingDate}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{t('meetings.createWithCarryover')}</Button></div>
        </div>
      ) : !selected ? (
        <div className="p-5"><EmptyState>{t('meetings.emptyState')}</EmptyState></div>
      ) : (
      <div className="space-y-4 p-5">
        {selected.status === 'upcoming' && <>
          <SectionCard title={t('meetings.carryoverTitle', { count: carryovers.length })} icon={<Circle className="h-4 w-4 text-amber-500" />}>{carryovers.length === 0 ? <EmptyState>{t('meetings.carryoverEmpty')}</EmptyState> : <div className="divide-y divide-border/60">{carryovers.map((item) => <AgendaRow key={item.id} item={item} busy={busy} onToggle={() => mutate(() => api.updateAgendaItem(item.id, { done: !item.done }))} onDelete={() => mutate(() => api.deleteAgendaItem(item.id))} />)}</div>}</SectionCard>
          <SectionCard title={t('meetings.agendaTitle', { count: regularAgenda.length })} icon={<ListChecks className="h-4 w-4 text-primary" />}>
            <div className="mb-4 flex flex-col gap-2 sm:flex-row"><select value={agendaKind} onChange={(event) => setAgendaKind(event.target.value as MeetingAgendaKind)} className={cn(FIELD_CLASS, 'sm:w-40')}><option value="my_report">{t('meetings.agendaKind.my_report')}</option><option value="question_for_advisor">{t('meetings.agendaKind.question_for_advisor')}</option><option value="literature">{t('meetings.agendaKind.literature')}</option></select><input value={newAgenda} onChange={(event) => setNewAgenda(event.target.value)} className={cn(FIELD_CLASS, 'min-w-0 flex-1')} placeholder={t('meetings.agendaPlaceholder')} /><Button disabled={busy || !newAgenda.trim()} onClick={() => void mutate(async () => { await api.createAgendaItem(selected.id, { kind: agendaKind, title: newAgenda.trim(), orderIndex: selected.agenda?.length || 0 }); setNewAgenda(''); })}><Plus className="h-4 w-4" />{t('common.add')}</Button></div>
            {regularAgenda.length === 0 ? <EmptyState>{t('meetings.agendaEmpty')}</EmptyState> : <div className="divide-y divide-border/60">{regularAgenda.map((item) => <AgendaRow key={item.id} item={item} busy={busy} onToggle={() => mutate(() => api.updateAgendaItem(item.id, { done: !item.done }))} onDelete={() => mutate(() => api.deleteAgendaItem(item.id))} />)}</div>}
          </SectionCard>
        </>}

        {selected.status === 'in_progress' && <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
          <SectionCard title={t('meetings.agenda')} icon={<ListChecks className="h-4 w-4 text-primary" />}><div className="divide-y divide-border/60">{(selected.agenda || []).map((item) => <AgendaRow key={item.id} item={item} busy={busy} onToggle={() => mutate(() => api.updateAgendaItem(item.id, { done: !item.done }))} />)}</div></SectionCard>
          <SectionCard title={t('meetings.liveNotes')} icon={<MessageSquareText className="h-4 w-4 text-primary" />}>
            <MeetingRecorder meetingId={selected.id} api={api} onChanged={refresh} />
            <div className="grid gap-2 sm:grid-cols-[100px_110px_minmax(0,1fr)]"><input value={noteSpeaker} onChange={(event) => setNoteSpeaker(event.target.value)} className={FIELD_CLASS} placeholder={t('meetings.speaker')} /><select value={noteType} onChange={(event) => setNoteType(event.target.value as MeetingNoteType)} className={FIELD_CLASS}>{NOTE_TYPES.map((value) => <option key={value} value={value}>{t(`meetings.noteType.${value}`)}</option>)}</select><div className="flex gap-2"><input value={noteContent} onChange={(event) => setNoteContent(event.target.value)} className={cn(FIELD_CLASS, 'min-w-0 flex-1')} placeholder={t('meetings.notePlaceholder')} /><Button disabled={busy || !noteContent.trim()} onClick={() => void mutate(async () => { await api.createNote(selected.id, { speaker: noteSpeaker.trim() || undefined, content: noteContent.trim(), noteType }); setNoteContent(''); })}>{t('meetings.record')}</Button></div></div>
            <NotesList meeting={selected} busy={busy} onPromote={(noteId) => mutate(() => api.promoteNote(noteId))} />
            <TranscriptPane segments={selected.transcriptSegments || []} api={api} onChanged={refresh} />
          </SectionCard>
        </div>}

        {selected.status === 'done' && <>
          <SectionCard title={t('meetings.summaryDraft')}><MeetingSummaryDraftPanel meeting={selected} api={api} onChanged={refresh} /></SectionCard>
          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title={t('meetings.notesTitle', { count: selected.notes?.length || 0 })} icon={<MessageSquareText className="h-4 w-4 text-primary" />}><NotesList meeting={selected} busy={busy} onPromote={(noteId) => mutate(() => api.promoteNote(noteId))} /></SectionCard>
            <SectionCard title={t('meetings.actionsTitle', { count: selected.actions?.length || 0 })} icon={<Check className="h-4 w-4 text-primary" />}><ActionItemBoard actions={selected.actions || []} api={api} onChanged={refresh} /></SectionCard>
          </div>
          <SectionCard title={t('meetings.transcriptTitle', { count: selected.transcriptSegments?.length || 0 })}><TranscriptPane segments={selected.transcriptSegments || []} api={api} onChanged={refresh} /></SectionCard>
        </>}

        <div className="flex justify-end"><Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" disabled={busy} onClick={() => { if (window.confirm(t('meetings.deleteConfirm', { title: selected.title }))) void mutate(() => api.deleteMeeting(selected.id)); }}><Trash2 className="h-4 w-4" />{t('meetings.deleteMeeting')}</Button></div>
      </div>
      )}
    </ExplorerPage>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-1.5 text-xs text-muted-foreground"><span>{label}</span>{children}</label>;
}

function MeetingStatus({ meeting }: { meeting: ResearchMeeting }) {
  const { t } = useTranslation('workbench');
  return <StatusBadge tone={meeting.status === 'done' ? 'success' : meeting.status === 'in_progress' ? 'warning' : 'neutral'}>{t(`meetings.meetingStatus.${meeting.status}`)}</StatusBadge>;
}

function AgendaRow({ item, busy, onToggle, onDelete }: { item: NonNullable<ResearchMeeting['agenda']>[number]; busy: boolean; onToggle: () => Promise<void>; onDelete?: () => Promise<void> }) {
  const { t } = useTranslation('workbench');
  return <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"><button type="button" disabled={busy} onClick={() => void onToggle()} className="mt-0.5">{item.done ? <Check className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-muted-foreground" />}</button><div className="min-w-0 flex-1"><div className={cn('text-sm text-foreground', item.done && 'line-through opacity-60')}>{item.title}</div><div className="mt-1 text-[11px] text-muted-foreground">{t(`meetings.agendaKind.${item.kind}`)}</div></div>{onDelete && <button type="button" disabled={busy} onClick={() => void onDelete()} className="text-muted-foreground hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}</div>;
}

function NotesList({ meeting, busy, onPromote }: { meeting: ResearchMeeting; busy: boolean; onPromote: (noteId: string) => Promise<void> }) {
  const { t } = useTranslation('workbench');
  if (!meeting.notes?.length) return <EmptyState>{t('meetings.noNotes')}</EmptyState>;
  return <div className="mt-4 space-y-2">{meeting.notes.map((note) => <div key={note.id} className="rounded-lg border border-border/60 p-3"><div className="flex items-center justify-between gap-3"><div className="text-xs text-muted-foreground">{note.speaker || t('common.unlabeled')} · {t(`meetings.noteType.${note.noteType}`)}</div>{note.promotedActionId ? <StatusBadge tone="success">{t('meetings.promoted')}</StatusBadge> : <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onPromote(note.id)}>{t('meetings.promote')}</Button>}</div><div className="mt-2 text-sm leading-6 text-foreground">{note.content}</div></div>)}</div>;
}
