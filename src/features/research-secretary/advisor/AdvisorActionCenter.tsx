import { useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Plus, X } from 'lucide-react';
import type { Project } from '../../../types/app';
import { Button } from '../../../components/ui/button';
import { ExplorerPage, explorerItemClass } from '../../../components/explorer/ExplorerPage';
import { EmptyState, SectionCard } from '../components/WorkbenchUi';
import { useResearchSecretarySnapshot } from '../services/useResearchSecretarySnapshot';
import AdvisorActionCard from './AdvisorActionCard';

export default function AdvisorActionCenter({ projects, onMenuClick }: { projects: Project[]; onMenuClick?: () => void }) {
  const { api, snapshot, refresh } = useResearchSecretarySnapshot(projects);
  const projectNames = new Map(projects.map((project) => [project.name, project.displayName]));
  const [selectedId, setSelectedId] = useState<string | null>(snapshot.advisorActions[0]?.id || null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [form, setForm] = useState({ meetingId: '', content: '', advisorName: '导师', projectId: '' });
  const actions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return snapshot.advisorActions;
    return snapshot.advisorActions.filter((action) => action.title.toLowerCase().includes(query) || (action.advisorName || '').toLowerCase().includes(query));
  }, [searchQuery, snapshot.advisorActions]);
  const selected = actions.find((action) => action.id === selectedId) || actions[0] || null;

  const mutate = async (operation: () => Promise<unknown>) => {
    setBusy(true); setMutationError(null);
    try { await operation(); await refresh(); }
    catch (cause) { setMutationError(cause instanceof Error ? cause.message : '操作失败'); }
    finally { setBusy(false); }
  };

  const createAdvisorAction = async () => {
    if (!form.content.trim()) return;
    let createdNoteId: string | null = null;
    await mutate(async () => {
      let meetingId = form.meetingId;
      if (!meetingId) {
        const meeting = await api.createMeeting({
          title: '导师事项记录', meetingDate: new Date().toISOString(), meetingType: 'one_on_one',
          myRole: 'attendee', status: 'done', projectId: form.projectId || undefined,
        });
        meetingId = meeting.id;
      }
      const note = await api.createNote(meetingId, {
        content: form.content.trim(), noteType: 'feedback', speaker: form.advisorName.trim() || '导师',
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
      title="导师事项"
      countLabel={`${actions.length}`}
      searchPlaceholder="搜索事项或导师…"
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      sidebar={actions.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-muted-foreground">暂无导师事项。</p>
      ) : actions.map((action) => (
        <button key={action.id} type="button" onClick={() => setSelectedId(action.id)} className={explorerItemClass(selected?.id === action.id)}>
          <span className="min-w-0">
            <span className="block truncate">{action.title}</span>
            <span className="mt-1 block text-[11px] font-normal text-muted-foreground">{action.advisorName || '导师'}</span>
          </span>
          <span className="text-xs font-normal text-muted-foreground">{action.status === 'done' ? '已完成' : action.status === 'in_progress' ? '进行中' : '待处理'}</span>
        </button>
      ))}
      resultsEyebrow="导师事项"
      resultsTitle={selected?.title || '事项详情'}
      resultsDescription="把导师反馈转成可执行 Action Item、Deadline 和 ResearchTask。"
      resultsActions={<Button size="sm" className="rounded-lg" onClick={() => setShowCreate((value) => !value)}>{showCreate ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{showCreate ? '取消' : '添加事项'}</Button>}
    >
      <div className="space-y-4 p-5">
        {mutationError && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{mutationError}</div>}
        {showCreate && (
          <SectionCard title="手动记录导师事项" icon={<Plus className="h-4 w-4 text-primary" />}>
            <div className="space-y-3">
              <label className="block text-xs font-medium">关联会议
                <select value={form.meetingId} onChange={(event) => setForm((current) => ({ ...current, meetingId: event.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm">
                  <option value="">未选择时自动创建一条一对一记录</option>
                  {snapshot.meetings.map((meeting) => <option key={meeting.id} value={meeting.id}>{meeting.title}</option>)}
                </select>
              </label>
              {!form.meetingId && <label className="block text-xs font-medium">所属项目（可选）<select value={form.projectId} onChange={(event) => setForm((current) => ({ ...current, projectId: event.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm"><option value="">不关联项目</option>{projects.map((project) => <option key={project.name} value={project.name}>{project.displayName || project.name}</option>)}</select></label>}
              <label className="block text-xs font-medium">导师称呼<input value={form.advisorName} maxLength={100} onChange={(event) => setForm((current) => ({ ...current, advisorName: event.target.value }))} className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm" /></label>
              <label className="block text-xs font-medium">事项内容<textarea value={form.content} maxLength={8000} rows={4} onChange={(event) => setForm((current) => ({ ...current, content: event.target.value }))} className="mt-1.5 w-full rounded-lg border bg-background p-3 text-sm" placeholder="记录导师的明确要求或反馈…" /></label>
              <Button size="sm" disabled={busy || !form.content.trim()} onClick={() => void createAdvisorAction()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}保存事项</Button>
            </div>
          </SectionCard>
        )}
        {selected ? <>
          <AdvisorActionCard action={selected} projectNames={projectNames} />
          <SectionCard title="状态流转" icon={<CheckCircle2 className="h-4 w-4 text-primary" />}>
            {selected.actionId ? <div className="flex flex-wrap gap-2">{([
              ['open', '待处理'], ['in_progress', '进行中'], ['done', '已完成'],
            ] as const).map(([status, label]) => <Button key={status} size="sm" variant={selected.status === status ? 'default' : 'outline'} disabled={busy || selected.status === status} onClick={() => void mutate(() => api.updateAction(selected.actionId!, { status }))}>{label}</Button>)}</div> : <div className="flex items-center justify-between gap-3"><p className="text-xs leading-5 text-muted-foreground">先转为行动项，之后即可在这里同步更新处理状态。</p><Button size="sm" disabled={busy} onClick={() => void mutate(() => api.promoteNote(selected.id, { projectId: selected.projectId }))}>转为行动项</Button></div>}
          </SectionCard>
        </> : <EmptyState>暂无导师事项。可以手动记录，或在组会中把导师反馈标为“反馈”。</EmptyState>}
      </div>
    </ExplorerPage>
  );
}
