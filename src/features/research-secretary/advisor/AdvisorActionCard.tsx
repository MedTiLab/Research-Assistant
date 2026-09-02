import { CalendarDays, Mail, MessageSquareText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AdvisorAction } from '../domain/types';
import { workbenchLocale } from '../i18n';
import { SectionCard, StatusBadge, formatWorkbenchDate, getProjectLabel } from '../components/WorkbenchUi';

export default function AdvisorActionCard({ action, projectNames }: { action: AdvisorAction; projectNames: Map<string, string> }) {
  const { t, i18n } = useTranslation('workbench');
  const locale = workbenchLocale(i18n.language);
  const statusLabel = action.status === 'done' ? t('status.done') : action.status === 'in_progress' ? t('status.inProgress') : t('status.pending');
  return (
    <SectionCard title={action.title} icon={<MessageSquareText className="h-4 w-4 text-primary" />} action={<StatusBadge tone={action.status === 'done' ? 'success' : action.priority === 'high' ? 'warning' : 'neutral'}>{statusLabel}</StatusBadge>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground"><span>{action.advisorName || t('common.advisorFallback')}</span><span>{getProjectLabel(action.projectId, projectNames, t('common.crossProject'))}</span><span className="inline-flex items-center gap-1">{action.source === 'email' ? <Mail className="h-3.5 w-3.5" /> : <CalendarDays className="h-3.5 w-3.5" />}{t(`advisor.source.${action.source}`)}</span>{action.dueAt && <span>{t('common.deadline', { date: formatWorkbenchDate(action.dueAt, { month: 'short', day: 'numeric' }, locale) })}</span>}</div>
        {action.feedback && <blockquote className="border-l-2 border-primary/40 pl-3 text-xs leading-5 text-muted-foreground">“{action.feedback}”</blockquote>}
        {action.nextAction && <div className="rounded-lg bg-muted/45 px-3 py-2.5 text-xs leading-5"><span className="font-medium text-foreground">{t('common.nextStep')}</span><span className="text-muted-foreground">{action.nextAction}</span></div>}
      </div>
    </SectionCard>
  );
}
