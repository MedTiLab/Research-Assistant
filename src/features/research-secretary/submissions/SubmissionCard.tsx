import { CheckCircle2, Circle, Clock3, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Manuscript, Submission } from '../domain/types';
import { SUBMISSION_STATUS_TONES } from '../domain/status';
import { workbenchLocale } from '../i18n';
import { SectionCard, StatusBadge, formatWorkbenchDate, getProjectLabel } from '../components/WorkbenchUi';

export default function SubmissionCard({ submission, manuscript, projectNames }: { submission: Submission; manuscript?: Manuscript; projectNames: Map<string, string> }) {
  const { t, i18n } = useTranslation('workbench');
  const locale = workbenchLocale(i18n.language);
  const readyDocuments = submission.documents.filter((document) => document.ready).length;
  const statusLabel = (status: Submission['status']) => t(`submissionStatus.${status}`);
  return (
    <SectionCard
      title={manuscript?.shortTitle || manuscript?.title || submission.journal}
      icon={<FileText className="h-4 w-4 text-primary" />}
      action={<StatusBadge tone={SUBMISSION_STATUS_TONES[submission.status]}>{statusLabel(submission.status)}</StatusBadge>}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{submission.journal}</span>
          <span>{getProjectLabel(submission.projectId, projectNames, t('common.crossProject'))}</span>
          {submission.trackingCode && <span>{submission.trackingCode}</span>}
          {submission.deadline && <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300"><Clock3 className="h-3.5 w-3.5" />{t('common.deadline', { date: formatWorkbenchDate(submission.deadline, { month: 'short', day: 'numeric' }, locale) })}</span>}
        </div>

        {submission.previousStatus && submission.previousStatus !== submission.status && (
          <div className="rounded-lg border border-amber-200/70 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
            {t('submissions.statusChanged', { from: statusLabel(submission.previousStatus), to: statusLabel(submission.status) })}
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between text-xs"><span className="font-medium text-foreground">{t('submissions.materials')}</span><span className="text-muted-foreground">{t('submissions.readyCount', { ready: readyDocuments, total: submission.documents.length })}</span></div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
            {submission.documents.map((document) => (
              <div key={document.kind} className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                {document.ready ? <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600" /> : <Circle className="h-3.5 w-3.5 flex-shrink-0" />}
                <span className="truncate">{document.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg bg-muted/45 px-3 py-2.5 text-xs leading-5"><span className="font-medium text-foreground">{t('common.nextStep')}</span><span className="text-muted-foreground">{submission.nextAction || t('submissions.waitingStatus')}</span></div>
      </div>
    </SectionCard>
  );
}
