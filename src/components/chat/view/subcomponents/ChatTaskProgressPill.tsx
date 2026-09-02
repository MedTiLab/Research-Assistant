import React, { useMemo } from 'react';
import { Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTaskMaster } from '../../../../contexts/TaskMasterContext';
import TaskProgressCard from './TaskProgressCard';

type TaskItem = {
  id?: string | number;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  stage?: string;
  details?: string;
  testStrategy?: string;
  taskType?: string;
  nextActionPrompt?: string;
  whyNext?: string;
  inputsNeeded?: string[];
  suggestedSkills?: string[];
  dependencies?: Array<string | number>;
  guidance?: {
    requiredInputs?: string[];
    suggestedSkills?: string[];
    nextActionPrompt?: string;
    whyNext?: string;
  } | null;
};

interface ChatTaskProgressPillProps {
  provider?: string;
  projectName?: string;
  sessionId?: string | null;
  onStartTask?: (prompt?: string, task?: TaskItem | null) => void;
  className?: string;
  compact?: boolean;
  hideWhenEmpty?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}

type TaskMasterContextValue = {
  tasks?: TaskItem[];
  nextTask?: TaskItem | null;
  isLoadingTasks?: boolean;
};

const STAGE_ALIASES: Record<string, string> = {
  data: 'experiment',
  analysis: 'experiment',
  experiment_dev: 'experiment',
  experimentdev: 'experiment',
  writing: 'publication',
  presentation: 'promotion',
};

const normalizeStage = (stage?: string | null) => {
  const normalized = String(stage || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return STAGE_ALIASES[normalized] || normalized;
};

const isDoneStatus = (status?: string) => String(status || '').toLowerCase() === 'done';
const isActiveStatus = (status?: string) => ['in-progress', 'review', 'pending'].includes(String(status || '').toLowerCase());

export default function ChatTaskProgressPill({
  onStartTask,
  className = '',
  compact = false,
  hideWhenEmpty = false,
  expanded,
  onExpandedChange,
}: ChatTaskProgressPillProps) {
  const { t } = useTranslation('chat');
  const {
    tasks = [],
    nextTask,
    isLoadingTasks,
  } = useTaskMaster() as TaskMasterContextValue;

  const summary = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((task) => isDoneStatus(task.status)).length;
    const inProgress = tasks.filter((task) => task.status === 'in-progress').length;
    const pending = tasks.filter((task) => task.status === 'pending').length;
    return { total, done, inProgress, pending };
  }, [tasks]);

  const actionPrompt = nextTask?.nextActionPrompt || nextTask?.guidance?.nextActionPrompt || '';
  const whyNext = nextTask?.whyNext || nextTask?.guidance?.whyNext || '';
  const hasTasks = summary.total > 0;
  const isLoading = Boolean(isLoadingTasks);
  const activeTask = nextTask || tasks.find((task) => isActiveStatus(task.status)) || null;
  const currentStageKey = normalizeStage(activeTask?.stage);
  const currentStageLabel = currentStageKey
    ? t(`tasks.stages.${currentStageKey}`, { defaultValue: activeTask?.stage || currentStageKey })
    : '';
  const stageTasks = currentStageKey
    ? tasks.filter((task) => normalizeStage(task.stage) === currentStageKey)
    : [];
  const stageDone = stageTasks.filter((task) => isDoneStatus(task.status)).length;
  const stageProgressText = currentStageLabel
    ? stageTasks.length > 0
      ? t('tasks.compact.stageProgress', {
          stage: currentStageLabel,
          done: stageDone,
          total: stageTasks.length,
          defaultValue: 'Stage {{stage}} · {{done}}/{{total}} done',
        })
      : t('tasks.compact.stageOnly', {
          stage: currentStageLabel,
          defaultValue: 'Stage {{stage}}',
        })
    : '';

  if (hideWhenEmpty && !hasTasks && !isLoading) {
    return null;
  }

  return (
    <TaskProgressCard label={t('tasks.compact.projectLabel')} compact={compact} className={className}
      expanded={expanded} onExpandedChange={onExpandedChange} done={summary.done} total={summary.total}
      subtitle={isLoading
        ? t('tasks.loading', { defaultValue: 'Loading tasks...' })
        : stageProgressText || (hasTasks
          ? t('tasks.compact.progress', { done: summary.done, total: summary.total, pending: summary.pending })
          : t('tasks.compact.noTasks', { defaultValue: 'No tasks yet. Start by chatting with the Agent.' }))}
      title={activeTask?.title || (hasTasks
        ? t('tasks.compact.allDone')
        : t('tasks.compact.emptyTitle', { defaultValue: 'Task progress unavailable' }))}
      action={nextTask && !compact ? (
        <button type="button" onClick={() => onStartTask?.(actionPrompt, nextTask)}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90">
          <Play className="h-3 w-3" />{t('tasks.compact.useInChat')}
        </button>
      ) : null}>
      {hasTasks ? <>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {currentStageLabel && <span>{t('tasks.compact.stageLabel')}: {currentStageLabel}</span>}
          <span>{t('tasks.compact.done')}: {summary.done}</span>
          <span>{t('tasks.compact.inProgress')}: {summary.inProgress}</span>
          <span>{t('tasks.compact.pending')}: {summary.pending}</span>
        </div>
        {whyNext && <p className="line-clamp-2 text-xs text-muted-foreground">{whyNext}</p>}
      </> : <p className="text-xs text-muted-foreground">{t('tasks.compact.emptyHint')}</p>}
    </TaskProgressCard>
  );
}
