import { AlarmClock } from 'lucide-react';
import type { ResearchTask, Submission } from '../domain/types';
import { SectionCard, StatusBadge, formatWorkbenchDate } from '../components/WorkbenchUi';

export default function DeadlineCard({ tasks, submissions }: { tasks: ResearchTask[]; submissions: Submission[] }) {
  const deadlines = [
    ...tasks.filter((task) => task.dueAt && task.status !== 'done').map((task) => ({ id: task.id, title: task.title, at: task.dueAt!, kind: '任务' })),
    ...submissions.filter((submission) => submission.deadline).map((submission) => ({ id: submission.id, title: `${submission.journal} 修回`, at: submission.deadline!, kind: '投稿' })),
  ].sort((left, right) => left.at.localeCompare(right.at)).slice(0, 3);

  return (
    <SectionCard title="Deadline" icon={<AlarmClock className="h-4 w-4 text-primary" />}>
      <div className="space-y-3">
        {deadlines.map((deadline, index) => (
          <div key={deadline.id} className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{deadline.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">{formatWorkbenchDate(deadline.at)}</div>
            </div>
            <StatusBadge tone={index === 0 ? 'danger' : index === 1 ? 'warning' : 'neutral'}>{deadline.kind}</StatusBadge>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
