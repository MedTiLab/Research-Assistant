import { ShieldAlert } from 'lucide-react';
import type { ResearchTask, Submission } from '../domain/types';
import { SectionCard, StatusBadge } from '../components/WorkbenchUi';

export default function ResearchAlertsCard({ tasks, submissions }: { tasks: ResearchTask[]; submissions: Submission[] }) {
  const alerts = [
    ...submissions.filter((submission) => submission.status === 'major_revision').map((submission) => ({ id: submission.id, title: `${submission.journal} 返回大修`, detail: submission.nextAction, tone: 'danger' as const })),
    ...tasks.filter((task) => task.status === 'blocked' || task.priority === 'urgent').map((task) => ({ id: task.id, title: task.title, detail: task.nextAction, tone: 'warning' as const })),
  ];
  return (
    <SectionCard title="风险提醒" icon={<ShieldAlert className="h-4 w-4 text-red-600" />}>
      <div className="space-y-3">
        {alerts.slice(0, 3).map((alert) => (
          <div key={alert.id} className="rounded-lg border border-red-200/70 bg-red-50/60 p-3 dark:border-red-900/70 dark:bg-red-950/25">
            <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-foreground">{alert.title}</span><StatusBadge tone={alert.tone}>需处理</StatusBadge></div>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">下一步：{alert.detail}</p>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
