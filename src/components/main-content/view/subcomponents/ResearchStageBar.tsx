import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BookOpen,
  FileText,
  FlaskConical,
  Lightbulb,
  Megaphone,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../../../lib/utils';

export type ResearchStageId = 'literature' | 'ideation' | 'experiment' | 'publication' | 'promotion';

interface StageMeta {
  id: ResearchStageId;
  index: number;
  labelKey: string;
  compactLabelKey: string;
  hintKey: string;
  icon: LucideIcon;
  tone: 'sky' | 'amber' | 'emerald' | 'violet' | 'rose';
}

const STAGE_ORDER: StageMeta[] = [
  { id: 'literature',  index: 1, labelKey: 'common:researchStages.literature',  compactLabelKey: 'common:researchStages.literatureBar',  hintKey: 'common:researchStages.literatureHint',  icon: BookOpen,      tone: 'sky' },
  { id: 'ideation',    index: 2, labelKey: 'common:researchStages.ideation',    compactLabelKey: 'common:researchStages.ideationBar',    hintKey: 'common:researchStages.ideationHint',    icon: Lightbulb,     tone: 'amber' },
  { id: 'experiment',  index: 3, labelKey: 'common:researchStages.experiment',  compactLabelKey: 'common:researchStages.experimentBar',  hintKey: 'common:researchStages.experimentHint',  icon: FlaskConical,  tone: 'emerald' },
  { id: 'publication', index: 4, labelKey: 'common:researchStages.publication', compactLabelKey: 'common:researchStages.publicationBar', hintKey: 'common:researchStages.publicationHint', icon: FileText,      tone: 'violet' },
  { id: 'promotion',   index: 5, labelKey: 'common:researchStages.promotion',   compactLabelKey: 'common:researchStages.promotionBar',   hintKey: 'common:researchStages.promotionHint',   icon: Megaphone,     tone: 'rose' },
];

const TONE_ACTIVE: Record<StageMeta['tone'], string> = {
  sky:     'border-sky-300/80 bg-sky-50 text-sky-800 dark:border-sky-800/60 dark:bg-sky-950/30 dark:text-sky-200',
  amber:   'border-amber-300/80 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200',
  emerald: 'border-emerald-300/80 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-200',
  violet:  'border-violet-300/80 bg-violet-50 text-violet-800 dark:border-violet-800/60 dark:bg-violet-950/30 dark:text-violet-200',
  rose:    'border-rose-300/80 bg-rose-50 text-rose-800 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-200',
};

const TONE_DOT: Record<StageMeta['tone'], string> = {
  sky:     'bg-sky-500',
  amber:   'bg-amber-500',
  emerald: 'bg-emerald-500',
  violet:  'bg-violet-500',
  rose:    'bg-rose-500',
};

export interface ResearchStageBarProps {
  /** 1-based selected stage index. Defaults to 1 (literature). */
  currentStage?: number;
  /** Artifact counts decide whether a stage has actually started. Tasks alone keep a stage waiting. */
  stageArtifactCounts?: Partial<Record<ResearchStageId, number>>;
  /** Optional click handler. Receives stage id. */
  onStageSelect?: (stage: ResearchStageId, index: number) => void;
  /** Compact mode hides the hint text on each chip. */
  compact?: boolean;
  /** Sit inside the workbench header row instead of occupying its own row. */
  embedded?: boolean;
  className?: string;
  contentInsetRight?: number;
}

export default function ResearchStageBar({
  currentStage = 1,
  stageArtifactCounts,
  onStageSelect,
  compact = false,
  embedded = false,
  className,
  contentInsetRight = 0,
}: ResearchStageBarProps) {
  const { t } = useTranslation();
  const clampedCurrent = useMemo(
    () => Math.min(Math.max(1, Math.floor(currentStage)), STAGE_ORDER.length),
    [currentStage],
  );

  return (
    <nav
      role="navigation"
      aria-label={t('common:researchStages.title')}
      className={cn(
        embedded
          ? 'medical-research-stagebar medical-research-stagebar--embedded w-max max-w-full flex-none'
          : 'medical-research-stagebar w-full flex-shrink-0 bg-background/80 px-3 py-1.5 backdrop-blur-sm transition-[padding] duration-300 ease-out',
        className,
      )}
      style={!embedded && contentInsetRight > 0 ? { paddingRight: contentInsetRight } : undefined}
    >
      <div
        className={cn(
          'medical-research-stage-track flex w-max max-w-full items-center justify-center gap-1 overflow-x-auto rounded-full border border-border/45 bg-muted/20 px-1.5 py-1 shadow-sm',
          !embedded && cn('mx-auto', compact ? 'max-w-xl' : 'max-w-2xl'),
        )}
      >
      {STAGE_ORDER.map((stage, idx) => {
        const Icon = stage.icon;
        const isSelected = stage.index === clampedCurrent;
        const artifactCount = stageArtifactCounts?.[stage.id] ?? 0;
        const hasArtifacts = artifactCount > 0;
        const nextStage = STAGE_ORDER[idx + 1];
        const nextHasArtifacts = nextStage ? (stageArtifactCounts?.[nextStage.id] ?? 0) > 0 : false;
        const artifactStateLabel = hasArtifacts
          ? t('common:researchStages.artifactsLine', { count: artifactCount })
          : t('common:researchStages.waiting');
        const stateLabel = isSelected
          ? `${t('common:researchStages.currentStage')} · ${artifactStateLabel}`
          : artifactStateLabel;

        return (
          <div key={stage.id} className="flex flex-none items-center gap-1">
            <button
              type="button"
              onClick={onStageSelect ? () => onStageSelect(stage.id, stage.index) : undefined}
              title={`${stateLabel} · ${t(stage.hintKey)}`}
              aria-label={`${t(stage.labelKey)} · ${stateLabel}`}
              aria-current={isSelected ? 'step' : undefined}
              className={cn(
                'group inline-flex h-7 w-[7.5rem] flex-none items-center justify-center gap-1.5 rounded-full border px-2.5 text-[11.5px] transition-colors duration-150',
                onStageSelect ? 'cursor-pointer' : 'cursor-default',
                hasArtifacts && isSelected
                  ? `${TONE_ACTIVE[stage.tone]} shadow-sm ring-1 ring-current/15`
                  : hasArtifacts
                    ? 'border-border/70 bg-background/85 text-foreground/75 hover:text-foreground'
                    : isSelected
                      ? 'border-dashed border-primary/40 bg-background/70 text-foreground shadow-sm'
                      : 'border-dashed border-border/60 bg-background/40 text-muted-foreground/80 hover:text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'inline-flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full border text-[9.5px] font-semibold tabular-nums',
                  hasArtifacts
                    ? `${TONE_DOT[stage.tone]} border-transparent text-white`
                    : isSelected
                      ? 'border-primary/50 bg-primary/5'
                      : 'border-border/70 bg-background/50',
                )}
              >
                {stage.index}
              </span>
              <Icon className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={isSelected ? 2.2 : hasArtifacts ? 2 : 1.8} />
              <span className="min-w-0 truncate font-medium leading-none">
                {t(stage.compactLabelKey, { defaultValue: t(stage.labelKey) })}
              </span>
              {isSelected && (
                <span className={cn('h-1.5 w-1.5 flex-shrink-0 rounded-full', TONE_DOT[stage.tone])} />
              )}
            </button>
            {idx < STAGE_ORDER.length - 1 && (
              <span
                aria-hidden="true"
                className={cn(
                  'inline-block h-px w-2 flex-shrink-0 transition-colors',
                  hasArtifacts && nextHasArtifacts ? 'bg-foreground/30' : 'bg-border/70',
                )}
              />
            )}
          </div>
        );
      })}
      </div>
    </nav>
  );
}
