import { CheckCircle2, Circle, Clock3, FileText } from 'lucide-react';
import type { Manuscript, Submission } from '../domain/types';
import { SUBMISSION_STATUS_TONES } from '../domain/status';
import { SectionCard, StatusBadge, formatWorkbenchDate, getProjectLabel } from '../components/WorkbenchUi';

const statusLabels: Record<Submission['status'], string> = {
  draft: '草稿', journal_selected: '已选期刊', presubmission_check: '投稿前检查', submitted: '已投稿', with_editor: '编辑处理中', under_review: '外审中', minor_revision: '小修', major_revision: '大修', rejected: '拒稿', resubmitted: '已重投', accepted: '已接收', proof: '校样', published: '已发表',
};

export default function SubmissionCard({ submission, manuscript, projectNames }: { submission: Submission; manuscript?: Manuscript; projectNames: Map<string, string> }) {
  const readyDocuments = submission.documents.filter((document) => document.ready).length;
  return (
    <SectionCard
      title={manuscript?.shortTitle || manuscript?.title || submission.journal}
      icon={<FileText className="h-4 w-4 text-primary" />}
      action={<StatusBadge tone={SUBMISSION_STATUS_TONES[submission.status]}>{statusLabels[submission.status]}</StatusBadge>}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{submission.journal}</span>
          <span>{getProjectLabel(submission.projectId, projectNames)}</span>
          {submission.trackingCode && <span>{submission.trackingCode}</span>}
          {submission.deadline && <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300"><Clock3 className="h-3.5 w-3.5" />截止 {formatWorkbenchDate(submission.deadline, { month: 'short', day: 'numeric' })}</span>}
        </div>

        {submission.previousStatus && submission.previousStatus !== submission.status && (
          <div className="rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
            状态刚刚变化：{statusLabels[submission.previousStatus]} → {statusLabels[submission.status]}
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between text-xs"><span className="font-medium text-foreground">投稿材料</span><span className="text-muted-foreground">{readyDocuments}/{submission.documents.length} 已就绪</span></div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
            {submission.documents.map((document) => (
              <div key={document.kind} className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                {document.ready ? <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600" /> : <Circle className="h-3.5 w-3.5 flex-shrink-0" />}
                <span className="truncate">{document.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg bg-muted/45 px-3 py-2.5 text-xs leading-5"><span className="font-medium text-foreground">下一步：</span><span className="text-muted-foreground">{submission.nextAction || '等待投稿状态更新'}</span></div>
      </div>
    </SectionCard>
  );
}
