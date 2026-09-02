import type { ResearchStageId } from '../../main-content/view/subcomponents/ResearchStageBar';

/**
 * Map every guided-prompt scenario to one of the 5 research workflow stages.
 * Acts as the bridge between the ResearchStageBar (workflow scaffolding)
 * and the GuidedPromptStarter (scenario-driven chat templates).
 *
 * Stage tone color is kept in sync with ResearchStageBar:
 *   - literature  (sky)
 *   - ideation    (amber)
 *   - experiment  (emerald)
 *   - publication (violet)
 *   - promotion   (rose)
 */
export const SCENARIO_TO_STAGE: Record<string, ResearchStageId> = {
  // Stage 1 — Literature: evidence intake, paper review, and prior-work baseline.
  'start-full-project': 'literature',
  'literature-survey': 'literature',
  'paper-reproduction': 'literature',

  // Stage 2 — Ideation: research question, hypothesis, feasibility, and protocol shape.
  'research-idea': 'ideation',
  'grant-proposal': 'ideation',

  // Stage 3 — Experiment: data access, pre-analysis, modeling, figures, and results.
  'database-access': 'experiment',
  'pre-analysis': 'experiment',
  'baseline-table': 'experiment',
  'statistical-modeling': 'experiment',
  'medical-visualization': 'experiment',
  'results-integration': 'experiment',

  // Stage 4 — Publication: manuscript, graphical abstract, review, and rebuttal.
  'graphical-abstract': 'publication',
  'paper-writing': 'publication',
  'paper-polishing': 'publication',
  'manuscript-review': 'publication',
  'rebuttal-response': 'publication',

  // Stage 5 — Promotion: slides, posters, pages, and dissemination packages.
  'presentation-promotion': 'promotion',
};

export const STAGE_ID_ORDER: ResearchStageId[] = ['literature', 'ideation', 'experiment', 'publication', 'promotion'];

export const STAGE_INDEX_BY_ID: Record<ResearchStageId, number> = {
  literature: 1,
  ideation: 2,
  experiment: 3,
  publication: 4,
  promotion: 5,
};

export const ID_BY_STAGE_INDEX: Record<number, ResearchStageId> = {
  1: 'literature',
  2: 'ideation',
  3: 'experiment',
  4: 'publication',
  5: 'promotion',
};

export type StageTone = 'sky' | 'amber' | 'emerald' | 'violet' | 'rose';

export const STAGE_TONE: Record<ResearchStageId, StageTone> = {
  literature: 'sky',
  ideation: 'amber',
  experiment: 'emerald',
  publication: 'violet',
  promotion: 'rose',
};

/**
 * Tailwind class fragments for stage-aware UI surfaces. Keep these in lock-step
 * with the ResearchStageBar palette so the chat surface visually inherits the
 * current stage.
 */
export const STAGE_SURFACE: Record<StageTone, {
  /** Banner background / border combo (subtle). */
  banner: string;
  /** Solid accent text (for the leading dot + label). */
  text: string;
  /** Small dot bubble color. */
  dot: string;
  /** Border accent for highlight on guided-prompt panel. */
  ring: string;
}> = {
  sky: {
    banner: 'border-sky-200/70 bg-sky-50/70 dark:border-sky-900/40 dark:bg-sky-950/20',
    text: 'text-sky-800 dark:text-sky-200',
    dot: 'bg-sky-500',
    ring: 'ring-sky-400/30 dark:ring-sky-600/30',
  },
  amber: {
    banner: 'border-amber-200/70 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-950/20',
    text: 'text-amber-800 dark:text-amber-200',
    dot: 'bg-amber-500',
    ring: 'ring-amber-400/30 dark:ring-amber-600/30',
  },
  emerald: {
    banner: 'border-emerald-200/70 bg-emerald-50/70 dark:border-emerald-900/40 dark:bg-emerald-950/20',
    text: 'text-emerald-800 dark:text-emerald-200',
    dot: 'bg-emerald-500',
    ring: 'ring-emerald-400/30 dark:ring-emerald-600/30',
  },
  violet: {
    banner: 'border-violet-200/70 bg-violet-50/70 dark:border-violet-900/40 dark:bg-violet-950/20',
    text: 'text-violet-800 dark:text-violet-200',
    dot: 'bg-violet-500',
    ring: 'ring-violet-400/30 dark:ring-violet-600/30',
  },
  rose: {
    banner: 'border-rose-200/70 bg-rose-50/70 dark:border-rose-900/40 dark:bg-rose-950/20',
    text: 'text-rose-800 dark:text-rose-200',
    dot: 'bg-rose-500',
    ring: 'ring-rose-400/30 dark:ring-rose-600/30',
  },
};

/**
 * Resolve a stage id from a 1-based stage index, defaulting to 'literature'
 * when the value is out of range. Useful when consumers pass `currentStage`
 * as a number (e.g. ResearchStageBar's prop API).
 */
export function stageIdFromIndex(index: number | null | undefined): ResearchStageId {
  if (!index || !Number.isFinite(index)) {
    return 'literature';
  }
  return ID_BY_STAGE_INDEX[index] ?? 'literature';
}

/**
 * Returns the stage a given scenario belongs to. Unmapped scenarios fall back
 * to the first visible pipeline stage, so the UI never accidentally hides them.
 */
export function stageIdForScenario(scenarioId: string): ResearchStageId {
  return SCENARIO_TO_STAGE[scenarioId] ?? 'literature';
}
