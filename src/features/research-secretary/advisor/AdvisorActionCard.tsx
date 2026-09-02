import { CalendarDays, Mail, MessageSquareText } from 'lucide-react';
import type { AdvisorAction } from '../domain/types';
import { SectionCard, StatusBadge, formatWorkbenchDate, getProjectLabel } from '../components/WorkbenchUi';

export default function AdvisorActionCard({ action, projectNames }: { action: AdvisorAction; projectNames: Map<string, string> }) {
  return (
    <SectionCard title={action.title} icon={<MessageSquareText className="h-4 w-4 text-primary" />} action={<StatusBadge tone={action.status === 'done' ? 'success' : action.priority === 'high' ? 'warning' : 'neutral'}>{action.status === 'done' ? '已完成' : action.status === 'in_progress' ? '进行中' : '待处理'}</StatusBadge>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground"><span>{action.advisorName || '导师'}</span><span>{getProjectLabel(action.projectId, projectNames)}</span><span className="inline-flex items-center gap-1">{action.source === 'email' ? <Mail className="h-3.5 w-3.5" /> : <CalendarDays className="h-3.5 w-3.5" />}{action.source === 'email' ? '邮件' : action.source === 'meeting_note' ? '会议记录' : action.source === 'calendar' ? '日历' : '手动'}</span><span>截止 {formatWorkbenchDate(action.dueAt, { month: 'short', day: 'numeric' })}</span></div>
        {action.feedback && <blockquote className="border-l-2 border-primary/40 pl-3 text-xs leading-5 text-muted-foreground">“{action.feedback}”</blockquote>}
        <div className="rounded-lg bg-muted/45 px-3 py-2.5 text-xs leading-5"><span className="font-medium text-foreground">下一步：</span><span className="text-muted-foreground">{action.nextAction}</span></div>
      </div>
    </SectionCard>
  );
}
