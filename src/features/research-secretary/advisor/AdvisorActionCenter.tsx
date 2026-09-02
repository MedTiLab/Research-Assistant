import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Loader2, Plus, X } from 'lucide-react';
import type { Project } from '../../../types/app';
import { Button } from '../../../components/ui/button';
import { ExplorerPage, explorerItemClass } from '../../../components/explorer/ExplorerPage';
import { EmptyState, SectionCard } from '../components/WorkbenchUi';
import { useResearchSecretarySnapshot } from '../services/useResearchSecretarySnapshot';
import AdvisorActionCard from './AdvisorActionCard';

export default function AdvisorActionCenter({ projects, onMenuClick }: { projects: Project[]; onMenuClick?: () => void }) {
  const { t } = useTranslation('workbench');
  const { api, snapshot, refresh } = useResearchSecretarySnapshot(projects);
  const projectNames = new Map(projects.map((project) => [project.name, project.displayName]));
  const [selectedId, setSelectedId] = useState<string | null>(snapshot.advisorActions[0]?.id || null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [form, setForm] = useState({ meetingId: '', content: '', advisorName: '', projectId: '' });
  const actions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return snapshot.advisorActions;
    return snapshot.advisorActions.filter((action) => action.title.toLowerCase().includes(query) || (action.advisorName || '').toLowerCase().includes(query));
  }, [searchQuery, snapshot.advisorActions]);
  const selected = actions.find((action) => action.id === selectedId) || actions[0] || null;
  const statusLabel = (status: string) => status === 'done' ? t('status.done') : status === 'in_progress' ? t('status.inProgress') : t('status.pending');

  const mutate = async (operation: () => Promise<unknown>) => {
    setBusy(true); setMutationError(null);
    try { await operation(); await refresh(); }
    catch (cause) { setMutationError(cause instanceof Error ? cause.message : t('common.actionFailed')); }
    finally { setBusy(false); }
  };

  const createAdvisorAction = async () => {
    if (!form.content.trim()) return;
    let createdNoteId: string | null = null;
    await mutate(async () => {
      let meetingId = form.meetingId;
      if (!meetingId) {
        const meeting = await api.createMeeting({
          title: t('advisor.meetingTitle'), meetingDate: new Date().toISOString(), meetingType: 'one_on_one',
          myRole: 'attendee', status: 'done', projectId: form.projectId || undefined,
        });
        meetingId = meeting.id;
      }
      const note = await api.createNote(meetingId, {
        content: form.content.trim(), noteType: 'feedback', speaker: form.advisorName.trim() || t('common.advisorFallback'),
      });
      createdNoteId = note.id;
      setForm((current) => ({ ...current, content: '' }));
      setShowCreate(false);
    });
    if (createdNoteId) setSelectedId(createdNoteId);
  };

  return (
    <ExplorerPage
      onMenuClick={onMenuClick}
      eyebrow="Research operations"
      title={t('advisor.title')}
      countLabel={`${actions.length}`}
      searchPlaceholder={t('advisor.searchPlaceholder')}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      sidebar={actions.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-muted-foreground">{t('advisor.emptyList')}</p>
      ) : actions.map((action) => (
        <button key={action.id} type="button" onClick={() => setSelectedId(action.id)} className={explorerItemClass(selected?.id === action.id)}>
          <span className="min-w-0">
            <span className="block truncate">{action.title}</span>
            <span className="mt-1 block text-[11px] font-normal text-muted-foreground">{action.advisorName || t('common.advisorFallback')}</span>
          </span>
          <span className="text-xs font-normal text-muted-foreground">{statusLabel(action.status)}</span>
        </button>
      ))}
      resultsEyebrow={t('advisor.resultsEyebrow')}
      resultsTitle={selected?.title || t('advisor.detailTitle')}
      resultsDescription={t('advisor.description')}
      resultsActions={<Button size="sm" className="rounded-lg" onClick={() => setShowCreate((value) => !value)}>{showCreate ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{showCreate ? t('common.cancel') : t('advisor.add')}</Button>}
    >
      <div className="space-y-4 p-5">
        {mutationError && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{mutationError}</div>}
        {showCreate && (
          <SectionCard title={t('advisor.recordTitle')} icon={<Plus className="h-4 w-4 text-primary" />}>
            <div className="space-y-3">
              <label className="block text-xs font-medium">{t('advisor.linkedMeeting')}
                <select value={form.meetingId} onChange={(event) => setForm((current) => ({ ...current, meetingId: event.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm">
                  <option value="">{t('advisor.autoMeeting')}</option>
                  {snapshot.meetings.map((meeting) => <option key={meeting.id} value={meeting.id}>{meeting.title}</option>)}
                </select>
              </label>
              {!form.meetingId && <label className="block text-xs font-medium">{t('advisor.projectOptional')}<select value={form.projectId} onChange={(event) => setForm((current) => ({ ...current, projectId: event.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm"><option value="">{t('common.unlinked')}</option>{projects.map((project) => <option key={project.name} value={project.name}>{project.displayName || project.name}</option>)}</select></label>}
              <label className="block text-xs font-medium">{t('advisor.advisorName')}<input value={form.advisorName} maxLength={100} placeholder={t('common.advisorFallback')} onChange={(event) => setForm((current) => ({ ...current, advisorName: event.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm" /></label>
              <label className="block text-xs font-medium">{t('advisor.content')}<textarea value={form.content} maxLength={8000} rows={4} onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))} className="mt-1.5 w-full rounded-lg border bg-background p-3 text-sm" placeholder={t('advisor.contentPlaceholder')} /></label>
              <Button size="sm" disabled={busy || !form.content.trim()} onClick={() => void createAdvisorAction()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{t('advisor.save')}</Button>
            </div>
          </SectionCard>
        )}
        {selected ? <>
          <AdvisorActionCard action={selected} projectNames={projectNames} />
          <SectionCard title={t('advisor.statusFlow')} icon={<CheckCircle2 className="h-4 w-4 text-primary" />}>
            {selected.actionId ? <div className="flex flex-wrap gap-2">{([
              'open', 'in_progress', 'done',
            ] as const).map((status) => <Button key={status} size="sm" variant={selected.status === status ? 'default' : 'outline'} disabled={busy || selected.status === status} onClick={() => void mutate(() => api.updateAction(selected.actionId!, { status }))}>{statusLabel(status)}</Button>)}</div> : <div className="flex items-center justify-between gap-3"><p className="text-xs leading-5 text-muted-foreground">{t('advisor.promoteHint')}</p><Button size="sm" disabled={busy} onClick={() => void mutate(() => api.promoteNote(selected.id, { projectId: selected.projectId }))}>{t('advisor.promote')}</Button></div>}
          </SectionCard>
        </> : <EmptyState>{t('advisor.empty')}</EmptyState>}
      </div>
    </ExplorerPage>
  );
}
