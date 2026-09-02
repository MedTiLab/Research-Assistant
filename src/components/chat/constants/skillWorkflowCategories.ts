import {
  LOCAL_DATABASE_ANALYSIS_SKILLS,
  LOCAL_DATABASE_EXTRACTION_SKILLS,
} from './localDatabaseExtractionSkills';
import {
  MEDICAL_LITERATURE_REVIEW_DEFAULT_SKILLS,
} from './medicalLiteratureReviewSkills';

export const SKILL_WORKFLOW_CATEGORY_KEYS = [
  'pipeline',
  'deepResearch',
  'deepLiteratureSearch',
  'literatureDatabases',
  'citationTrace',
  'paperReading',
  'researchMonitoring',
  'databaseAccess',
  'ideation',
  'preAnalysis',
  'statisticalModeling',
  'medicalViz',
  'resultsIntegration',
  'paperWriting',
  'paperPolishing',
  'graphicalAbstract',
  'paperReview',
  'grantWriting',
  'promotion',
  'other',
] as const;

export type SkillWorkflowCategoryKey = typeof SKILL_WORKFLOW_CATEGORY_KEYS[number];

export type SkillWorkflowCategoryDefinition = {
  key: SkillWorkflowCategoryKey;
  icon: string;
  skills: readonly string[];
  primarySkills?: readonly string[];
  autoRoutePromptKey?: string;
};

export type SkillWorkflowCategoryConfig = {
  version?: number;
  skillCategories?: Record<string, string>;
  hiddenFromShortcuts?: string[];
};

export const DEFAULT_SKILL_WORKFLOW_CATEGORY_KEY: SkillWorkflowCategoryKey = 'other';

export const SKILL_WORKFLOW_CATEGORIES_UPDATED_EVENT = 'medhelp:skill-workflow-categories-updated';

export const SKILL_WORKFLOW_CATEGORY_DEFINITIONS: SkillWorkflowCategoryDefinition[] = [
  {
    key: 'deepResearch',
    icon: '🔍',
    skills: [...MEDICAL_LITERATURE_REVIEW_DEFAULT_SKILLS],
    primarySkills: [...MEDICAL_LITERATURE_REVIEW_DEFAULT_SKILLS],
  },
  {
    key: 'deepLiteratureSearch',
    icon: '🧭',
    skills: [
      'medhelp-deep-research',
      'academic-researcher',
      'research-lookup',
      'nature-academic-search',
    ],
  },
  {
    key: 'literatureDatabases',
    icon: '🗃️',
    skills: [
      'pubmed-database',
      'openalex-database',
      'biorxiv-database',
    ],
  },
  {
    key: 'citationTrace',
    icon: '🔗',
    skills: [
      'citation-management',
      'real-literature-trace',
      'nature-citation',
      'nature-ref-verifier',
    ],
  },
  {
    key: 'paperReading',
    icon: '📑',
    skills: [
      'paper-finder',
      'paper-analyzer',
      'medhelp-paper-reviewer',
      'nature-reader',
      'nature-paper-card',
      'nature-downloader',
    ],
  },
  {
    key: 'researchMonitoring',
    icon: '🛰️',
    skills: [
      'research-news',
      'nature-literature-pipeline',
    ],
  },
  {
    key: 'databaseAccess',
    icon: '🗂️',
    skills: [...LOCAL_DATABASE_EXTRACTION_SKILLS],
    primarySkills: [
      'medhelp-database-api-access',
    ],
  },
  {
    key: 'ideation',
    icon: '💡',
    skills: [
      'medhelp-idea-generation',
      'medhelp-idea-eval',
      'hypothesis-generation',
      'scientific-brainstorming',
    ],
  },
  { key: 'pipeline', icon: '🗺️', skills: ['medhelp-pipeline-planner'] },
  {
    key: 'preAnalysis',
    icon: '🩺',
    skills: [
      'clinical-preanalysis',
      'baseline-table',
      'data-transform',
      'exploratory-data-analysis',
      ...LOCAL_DATABASE_ANALYSIS_SKILLS,
      'statistical-analysis',
      'statsmodels',
      'scikit-survival',
    ],
  },
  {
    key: 'statisticalModeling',
    icon: '🧪',
    autoRoutePromptKey: 'skillShortcuts.routePrompts.statisticalModeling',
    skills: [
      'medhelp-experiment-analysis',
      'data-stats-analysis',
      'statistical-analysis',
      'statsmodels',
      'scikit-survival',
      'ukb-cohort-analysis',
      'pymc',
      'nature-statistics',
    ],
    primarySkills: [
      'statistical-analysis',
      'data-stats-analysis',
      'statsmodels',
      'scikit-survival',
    ],
  },
  {
    key: 'medicalViz',
    icon: '📈',
    autoRoutePromptKey: 'skillShortcuts.routePrompts.medicalVisualization',
    skills: [
      'data-visualization-biomedical',
      'r-graph-selector',
      'nature-figure',
      'scientific-visualization',
      'data-viz-plots',
      'matplotlib',
      'seaborn',
      'plotly',
    ],
    primarySkills: [
      'nature-figure',
      'data-visualization-biomedical',
      'scientific-visualization',
    ],
  },
  {
    key: 'resultsIntegration',
    icon: '📋',
    skills: [
      'medhelp-experiment-analysis',
      'scientific-writing',
      'nature-experiment-log',
    ],
  },
  {
    key: 'graphicalAbstract',
    icon: '🖼️',
    skills: [
      'medhelp-figure-gen',
      'scientific-schematics',
      'scientific-visualization',
    ],
  },
  {
    key: 'paperWriting',
    icon: '✏️',
    skills: [
      'medhelp-paper-writing',
      'nature-writing',
      'scientific-writing',
      'nature-data',
      'nature-paper-to-patent',
      'literature-review',
      'pubmed-database',
      'real-literature-trace',
      'citation-management',
      'latex-posters',
      'medhelp-humanizer',
    ],
    primarySkills: [
      'medhelp-paper-writing',
      'scientific-writing',
      'literature-review',
      'citation-management',
    ],
  },
  {
    key: 'paperPolishing',
    icon: '✨',
    skills: [
      'nature-polishing',
      'medhelp-humanizer',
      'scientific-writing',
      'citation-management',
      'venue-templates',
    ],
  },
  {
    key: 'paperReview',
    icon: '📋',
    skills: [
      'medhelp-paper-reviewer',
      'nature-reviewer',
      'nature-response',
      'peer-review',
      'medhelp-rebuttal',
      'medhelp-reference-audit',
      'citation-management',
      'medhelp-rclone-to-overleaf',
    ],
  },
  { key: 'grantWriting', icon: '📝', skills: ['nature-proposal-writer', 'medhelp-grant-proposal'] },
  {
    key: 'promotion',
    icon: '🎬',
    skills: ['nature-paper2ppt', 'making-academic-presentations', 'paper-2-web', 'scientific-slides', 'pptx-posters'],
  },
  { key: 'other', icon: '📦', skills: [] },
];

const WORKFLOW_CATEGORY_KEY_SET = new Set<string>(SKILL_WORKFLOW_CATEGORY_KEYS);

const BASE_SKILL_CATEGORY_LOOKUP = new Map<string, SkillWorkflowCategoryKey>();
for (const category of SKILL_WORKFLOW_CATEGORY_DEFINITIONS) {
  for (const skill of category.skills) {
    if (!BASE_SKILL_CATEGORY_LOOKUP.has(normalizeSkillIdentifier(skill))) {
      BASE_SKILL_CATEGORY_LOOKUP.set(normalizeSkillIdentifier(skill), category.key);
    }
  }
}

const PRIMARY_SKILL_WORKFLOW_CATEGORY_OVERRIDES: Record<string, SkillWorkflowCategoryKey> = {
  'academic-researcher': 'deepLiteratureSearch',
  'nature-academic-search': 'deepLiteratureSearch',
  'biorxiv-database': 'literatureDatabases',
  'citation-management': 'citationTrace',
  'clinical-preanalysis': 'preAnalysis',
  'baseline-table': 'preAnalysis',
  'easyukb-analysis': 'preAnalysis',
  'gco-database-analysis': 'preAnalysis',
  'medhelp-deep-research': 'deepLiteratureSearch',
  'medhelp-paper-reviewer': 'paperReading',
  'nature-citation': 'citationTrace',
  'nature-ref-verifier': 'citationTrace',
  'nature-reader': 'paperReading',
  'nature-paper-card': 'paperReading',
  'nature-downloader': 'paperReading',
  'nature-literature-pipeline': 'researchMonitoring',
  'nature-experiment-log': 'resultsIntegration',
  'nature-statistics': 'statisticalModeling',
  'nature-writing': 'paperWriting',
  'nature-paper-to-patent': 'paperWriting',
  'nature-reviewer': 'paperReview',
  'nature-response': 'paperReview',
  'nature-proposal-writer': 'grantWriting',
  'nature-paper2ppt': 'promotion',
  'openalex-database': 'literatureDatabases',
  'paper-analyzer': 'paperReading',
  'paper-finder': 'paperReading',
  'pubmed-database': 'literatureDatabases',
  'real-literature-trace': 'citationTrace',
  'research-lookup': 'deepLiteratureSearch',
  'research-news': 'researchMonitoring',
  'statistical-analysis': 'statisticalModeling',
  statsmodels: 'statisticalModeling',
  'scikit-survival': 'statisticalModeling',
  'scientific-writing': 'paperWriting',
  'medhelp-humanizer': 'paperPolishing',
  'medhelp-experiment-analysis': 'resultsIntegration',
  'scientific-visualization': 'medicalViz',
};

export function normalizeSkillIdentifier(value: string): string {
  return String(value || '').trim().toLowerCase();
}

export function normalizeSkillWorkflowCategoryKey(value: unknown): SkillWorkflowCategoryKey {
  const normalized = String(value || '').trim();
  if (normalized === 'baselineTable') {
    return 'preAnalysis';
  }
  if (WORKFLOW_CATEGORY_KEY_SET.has(normalized)) {
    return normalized as SkillWorkflowCategoryKey;
  }
  return DEFAULT_SKILL_WORKFLOW_CATEGORY_KEY;
}

export function notifySkillWorkflowCategoriesUpdated() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SKILL_WORKFLOW_CATEGORIES_UPDATED_EVENT));
}

export function parseSkillWorkflowCategoryConfig(payload: unknown): {
  assignments: Map<string, SkillWorkflowCategoryKey>;
  hiddenFromShortcuts: Set<string>;
} {
  if (!payload || typeof payload !== 'object') {
    return { assignments: new Map(), hiddenFromShortcuts: new Set() };
  }

  const parsed = payload as SkillWorkflowCategoryConfig;
  const assignments = new Map<string, SkillWorkflowCategoryKey>();

  for (const [skillName, categoryKey] of Object.entries(parsed.skillCategories ?? {})) {
    const normalizedSkill = normalizeSkillIdentifier(skillName);
    if (!normalizedSkill) continue;
    assignments.set(normalizedSkill, normalizeSkillWorkflowCategoryKey(categoryKey));
  }

  const hiddenFromShortcuts = new Set(
    (parsed.hiddenFromShortcuts ?? [])
      .map((skillName) => normalizeSkillIdentifier(skillName))
      .filter(Boolean),
  );

  return { assignments, hiddenFromShortcuts };
}

export function mergeUniqueSkills(skills: readonly string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const skill of skills) {
    const normalized = normalizeSkillIdentifier(skill);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(skill);
  }

  return merged;
}

export const DEFAULT_PRIMARY_SHORTCUT_SKILL_LIMIT = 4;

export function getPrimaryShortcutSkills(category: SkillWorkflowCategoryDefinition): string[] {
  const categorySkillSet = new Set(category.skills.map((skill) => normalizeSkillIdentifier(skill)));
  const configuredPrimarySkills = category.primarySkills && category.primarySkills.length > 0
    ? category.primarySkills
    : category.skills.slice(0, DEFAULT_PRIMARY_SHORTCUT_SKILL_LIMIT);
  const primarySkills = mergeUniqueSkills(configuredPrimarySkills)
    .filter((skill) => categorySkillSet.has(normalizeSkillIdentifier(skill)));

  return primarySkills.length > 0
    ? primarySkills
    : category.skills.slice(0, DEFAULT_PRIMARY_SHORTCUT_SKILL_LIMIT);
}

export function getSecondaryShortcutSkills(
  category: SkillWorkflowCategoryDefinition,
  primarySkills = getPrimaryShortcutSkills(category),
): string[] {
  const primarySkillSet = new Set(primarySkills.map((skill) => normalizeSkillIdentifier(skill)));
  return category.skills.filter((skill) => !primarySkillSet.has(normalizeSkillIdentifier(skill)));
}

export function getBaseSkillWorkflowCategoryKey(skillName: string): SkillWorkflowCategoryKey | null {
  const normalized = normalizeSkillIdentifier(skillName);
  return PRIMARY_SKILL_WORKFLOW_CATEGORY_OVERRIDES[normalized]
    ?? BASE_SKILL_CATEGORY_LOOKUP.get(normalized)
    ?? null;
}

function lastPathSegment(value: string): string {
  const segments = value.split('/').filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : '';
}

export function buildSkillWorkflowCategories(
  assignments = new Map<string, SkillWorkflowCategoryKey>(),
  options: {
    installedSkills?: Set<string>;
    hiddenFromShortcuts?: Set<string>;
  } = {},
): SkillWorkflowCategoryDefinition[] {
  const installedSkills = options.installedSkills;
  const hiddenFromShortcuts = options.hiddenFromShortcuts ?? new Set<string>();
  const dynamicSkillsByCategory = new Map<SkillWorkflowCategoryKey, string[]>();

  for (const [skillName, categoryKey] of assignments.entries()) {
    if (hiddenFromShortcuts.has(skillName)) continue;
    if (installedSkills && !installedSkills.has(skillName)) continue;
    const baseCategoryKey = getBaseSkillWorkflowCategoryKey(skillName);
    if (baseCategoryKey === categoryKey) continue;
    const list = dynamicSkillsByCategory.get(categoryKey) ?? [];
    list.push(skillName);
    dynamicSkillsByCategory.set(categoryKey, list);
  }

  return SKILL_WORKFLOW_CATEGORY_DEFINITIONS.map((category) => ({
    ...category,
    skills: mergeUniqueSkills([
      ...category.skills.filter((skillName) => {
        const normalized = normalizeSkillIdentifier(skillName);
        if (hiddenFromShortcuts.has(normalized)) return false;
        return !installedSkills || installedSkills.has(normalized);
      }),
      ...(dynamicSkillsByCategory.get(category.key) ?? []).sort((a, b) => a.localeCompare(b)),
    ]),
    primarySkills: category.primarySkills?.filter((skillName) => {
      const normalized = normalizeSkillIdentifier(skillName);
      if (hiddenFromShortcuts.has(normalized)) return false;
      return !installedSkills || installedSkills.has(normalized);
    }),
  }));
}

export function workflowCategoryKeyForScenarioId(scenarioId: string): SkillWorkflowCategoryKey | null {
  const map: Record<string, SkillWorkflowCategoryKey> = {
    'start-full-project': 'pipeline',
    'paper-reproduction': 'deepResearch',
    'literature-survey': 'deepResearch',
    'database-access': 'databaseAccess',
    'research-idea': 'ideation',
    'pre-analysis': 'preAnalysis',
    'baseline-table': 'preAnalysis',
    'statistical-modeling': 'statisticalModeling',
    'medical-visualization': 'medicalViz',
    'results-integration': 'resultsIntegration',
    'graphical-abstract': 'graphicalAbstract',
    'paper-writing': 'paperWriting',
    'paper-polishing': 'paperPolishing',
    'manuscript-review': 'paperReview',
    'rebuttal-response': 'paperReview',
    'presentation-promotion': 'promotion',
    'grant-proposal': 'grantWriting',
  };

  return map[scenarioId] ?? null;
}

function pickAssignedWorkflowCategory(
  assignments: Map<string, SkillWorkflowCategoryKey> | undefined,
  skillName: string,
  dirPath?: string,
) {
  if (!assignments) return null;
  const candidates = [
    skillName,
    dirPath ?? '',
    lastPathSegment(dirPath ?? ''),
  ];

  for (const candidate of candidates) {
    const normalized = normalizeSkillIdentifier(candidate);
    if (!normalized) continue;
    const category = assignments.get(normalized);
    if (category) return category;
  }

  return null;
}

function isTechnicalSkillPath(dirPath: string | undefined): boolean {
  const topLevel = normalizeSkillIdentifier((dirPath ?? '').split('/').filter(Boolean)[0] ?? '');
  return [
    'agents',
    'distributed-training',
    'emerging-techniques',
    'evaluation',
    'fine-tuning',
    'inference-serving',
    'infrastructure',
    'mechanistic-interpretability',
    'mlops',
    'model-architecture',
    'multimodal',
    'observability',
    'optimization',
    'post-training',
    'prompt-engineering',
    'rag',
    'safety-alignment',
    'tokenization',
  ].includes(topLevel);
}

function buildInferenceSignal(name: string, dirPath?: string, summary?: string, tags: string[] = []): string {
  const identitySignal = [name, dirPath ?? ''].join(' ');
  if (dirPath) {
    return normalizeSkillIdentifier(identitySignal);
  }
  return normalizeSkillIdentifier([
    identitySignal,
    summary ?? '',
    ...tags,
  ].join(' '));
}

export function resolveSkillWorkflowCategoryKey({
  name,
  dirPath,
  summary,
  tags = [],
  assignments,
}: {
  name: string;
  dirPath?: string;
  summary?: string;
  tags?: string[];
  assignments?: Map<string, SkillWorkflowCategoryKey>;
}): SkillWorkflowCategoryKey {
  const assignedCategory = pickAssignedWorkflowCategory(assignments, name, dirPath);
  if (assignedCategory) {
    return assignedCategory;
  }

  const baseCategory = getBaseSkillWorkflowCategoryKey(name)
    ?? (dirPath ? getBaseSkillWorkflowCategoryKey(lastPathSegment(dirPath)) : null);
  if (baseCategory) {
    return baseCategory;
  }

  if (isTechnicalSkillPath(dirPath)) {
    return DEFAULT_SKILL_WORKFLOW_CATEGORY_KEY;
  }

  const signal = buildInferenceSignal(name, dirPath, summary, tags);

  if (/(pipeline|pathway|planner|planning|orchestrator|workflow|prepare-resources)/.test(signal)) {
    return 'pipeline';
  }

  if (/(research-news|monitor|weekly-digest|paper-alert|literature-alert|news)/.test(signal)) {
    return 'researchMonitoring';
  }

  if (/(paper-finder|paper-analyzer|paper-reading|read-paper|paper-triage)/.test(signal)) {
    return 'paperReading';
  }

  if (/(citation|reference|bibliography|bibtex|nature-citation|real-literature|trace)/.test(signal)) {
    return 'citationTrace';
  }

  if (/(pubmed|biorxiv|medrxiv|openalex|semantic-scholar|crossref|literature-database)/.test(signal)) {
    return 'literatureDatabases';
  }

  if (/(deep-research|research-lookup|academic-researcher|literature-search|evidence-search)/.test(signal)) {
    return 'deepLiteratureSearch';
  }

  if (/(literature|evidence|systematic-review|meta-analysis|scoping-review)/.test(signal)) {
    return 'deepResearch';
  }

  if (/(easyukb-analysis|gco-database-analysis|database-analysis|baseline|table 1|table-one|three-line|smd)/.test(signal)) {
    return 'preAnalysis';
  }

  if (/(database|cohort|biobank|mimic|eicu|nwicu|nhanes|ukb|cfps|cgss|charls|chfs|chip|chns|clds|clhls|css|share|hrs|elsa|klosa|lasi|mhas|pic|geo-database|globocan|gco-database|data-access|datacommons)/.test(signal)) {
    return 'databaseAccess';
  }

  if (/(idea|ideation|brainstorm|hypothesis|novelty|creative-thinking)/.test(signal)) {
    return 'ideation';
  }

  if (/(preanalysis|pre-analysis|preprocessing|data-transform|exploratory-data-analysis|eda|missingness)/.test(signal)) {
    return 'preAnalysis';
  }

  if (/(statistical|stats|regression|cox|survival|pymc|bayesian|modeling|hypothesis-test)/.test(signal)) {
    return 'statisticalModeling';
  }

  if (/(graphical-abstract|schematic|schema|figure-gen)/.test(signal)) {
    return 'graphicalAbstract';
  }

  if (/(visualization|visualisation|plot|chart|figure|matplotlib|seaborn|plotly|graph-selector|heatmap|forest|volcano|journal-figure|data-viz)/.test(signal)) {
    return 'medicalViz';
  }

  if (/(results-integration|experiment-analysis|results|strobe|consort)/.test(signal)) {
    return 'resultsIntegration';
  }

  if (/(polish|polishing|humanizer|humanize|copyedit|language-edit)/.test(signal)) {
    return 'paperPolishing';
  }

  if (/(review|rebuttal|peer-review|reference-audit|manuscript-review|reviewer)/.test(signal)) {
    return 'paperReview';
  }

  if (/(grant|proposal|funding)/.test(signal)) {
    return 'grantWriting';
  }

  if (/(presentation|slides|slide|poster|pptx|powerpoint|promotion|translation|paper-2-web)/.test(signal)) {
    return 'promotion';
  }

  if (/(writing|manuscript|paper-writing|publication|latex|venue|nature-data|scientific-writing)/.test(signal)) {
    return 'paperWriting';
  }

  return DEFAULT_SKILL_WORKFLOW_CATEGORY_KEY;
}
