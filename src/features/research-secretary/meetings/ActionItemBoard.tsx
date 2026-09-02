import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Circle, Loader2, ListTodo } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { cn } from '../../../lib/utils';
import type { MeetingActionItem } from '../domain/types';
import type { ResearchSecretaryApi } from '../services/researchSecretaryApi';
import { EmptyState, StatusBadge } from '../components/WorkbenchUi';

export default function ActionItemBoard({ actions, api, onChanged }: { actions: MeetingActionItem[]; api: ResearchSecretaryApi; onChanged: () => Promise<unknown> }) {
  const { t } = useTranslation('workbench');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (id: string, operation: () => Promise<unknown>) => {
    setBusyId(id); setError(null);
    try { await operation(); await onChanged(); }
    catch (nextError) { setError(nextError instanceof Error ? nextError.message : t('actions.operateFailed')); }
    finally { setBusyId(null); }
  };
  if (!actions.length) return <EmptyState>{t('actions.empty')}</EmptyState>;
  return <div className="space-y-2">
    {actions.map((action) => <div key={action.id} className="flex items-start gap-3 rounded-lg border border-border/60 p-3">
      <button type="button" disabled={busyId === action.id} onClick={() => void run(action.id, () => api.updateAction(action.id, { status: action.status === 'done' ? 'open' : 'done' }))} className="mt-0.5">{action.status === 'done' ? <Check className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-muted-foreground" />}</button>
      <div className="min-w-0 flex-1"><div className={cn('text-sm text-foreground', action.status === 'done' && 'line-through opacity-60')}>{action.content}</div>{action.dueDate && <div className="mt-1 text-xs text-muted-foreground">{t('actions.due', { date: action.dueDate })}</div>}<div className="mt-2">{action.taskId ? <StatusBadge tone="success">{t('actions.promotedTask', { id: action.taskId })}</StatusBadge> : action.projectId ? <Button size="sm" variant="ghost" disabled={busyId === action.id} onClick={() => void run(action.id, () => api.promoteActionToTask(action.id))}>{busyId === action.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListTodo className="h-3.5 w-3.5" />}{t('actions.promoteTask')}</Button> : <span className="text-[11px] text-muted-foreground">{t('actions.needProject')}</span>}</div></div>
      <StatusBadge tone={action.status === 'done' ? 'success' : 'neutral'}>{action.status === 'done' ? t('status.done') : t('status.pending')}</StatusBadge>
    </div>)}
    {error && <div className="text-xs text-red-600 dark:text-red-300">{error}</div>}
  </div>;
}
