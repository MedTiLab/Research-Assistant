import path from 'path';
import { promises as fs } from 'fs';

const DEFAULT_KB_MANIFEST_RELATIVE_PATH = '.pipeline/docs/kb/manifest.json';
const WORKSPACE_MATERIALS_RULE_MARKER = 'Workspace materials rule:';
const OUTPUT_LOCATION_RULE_MARKER = 'Output location rule:';
const INDEXED_WORKSPACE_MATERIALS_MARKER = 'Indexed workspace materials:';
const MAX_INDEXED_ENTRY_SUMMARY_CHARS = 180;
const DEFAULT_INDEXED_ENTRY_LIMIT = 4;

const STAGE_LABELS = {
  literature: 'Literature',
  ideation: 'Ideation',
  experiment: 'Experiment',
  publication: 'Publication',
  promotion: 'Promotion',
  presentation: 'Promotion',
  research: 'Literature',
  survey: 'Literature',
};

const STAGE_OUTPUT_ROOTS = {
  literature: ['Literature/reports', 'Literature/references'],
  ideation: ['Ideation/ideas', 'Ideation/references'],
  experiment: [
    'Experiment/core_code',
    'Experiment/analysis',
    'Experiment/figures',
    'Experiment/tables',
    'Experiment/attachments',
    'Experiment/datasets',
    'Experiment/code_references',
  ],
  publication: [
    'Publication/manuscript',
    'Publication/figures',
    'Publication/tables',
    'Publication/supplementary',
  ],
  promotion: ['Promotion/slides', 'Promotion/audio', 'Promotion/video', 'Promotion/homepage'],
};

const STAGE_REPORT_ROOTS = {
  literature: 'Literature/reports',
  ideation: 'Ideation/ideas',
  experiment: 'Experiment/analysis',
  publication: 'Publication/manuscript',
  promotion: 'Promotion/slides',
};

const TASK_TYPE_REPORT_STAGE_FALLBACKS = {
  analysis: 'experiment',
  implementation: 'experiment',
  scripting: 'experiment',
  writing: 'publication',
  rendering: 'promotion',
  narration: 'promotion',
  delivery: 'promotion',
  exploration: 'literature',
};

const REPORT_STAGE_INFERENCE_RULES = {
  literature: [
    /\bliterature review\b/i,
    /\bevidence synthesis\b/i,
    /\bsystematic review\b/i,
    /\bscoping review\b/i,
    /\bmeta-analysis\b/i,
    /\bliterature\b/i,
    /\bsurvey\b/i,
    /\bevidence\b/i,
    /\bpubmed\b/i,
    /\bguideline\b/i,
    /\bprior work\b/i,
    /\bsearch strategy\b/i,
    /文献|综述|证据|检索|指南|先行研究|调研/,
  ],
  ideation: [
    /\bbrainstorm\b/i,
    /\bnovelty\b/i,
    /\bresearch idea\b/i,
    /\bidea\b/i,
    /\bproblem framing\b/i,
    /\bresearch question\b/i,
    /\bconcept\b/i,
    /\bfeasibility\b/i,
    /\bgap\b/i,
    /\bthesis\b/i,
    /想法|创意|点子|头脑风暴|创新性|选题|方向|研究问题|构思|可行性|空白/,
  ],
  experiment: [
    /\bexperiment\b/i,
    /\banalysis\b/i,
    /\bimplementation\b/i,
    /\bimplement\b/i,
    /\bcode\b/i,
    /\bdebug\b/i,
    /\bmodel\b/i,
    /\bdataset\b/i,
    /\btraining\b/i,
    /\btrain\b/i,
    /\bevaluation\b/i,
    /\bevaluate\b/i,
    /\bcox\b/i,
    /\bregression\b/i,
    /\bscript\b/i,
    /\bpipeline\b/i,
    /\bresults?\b/i,
    /\bstatistics?\b/i,
    /实验|分析|实现|代码|调试|模型|数据集|训练|评估|脚本|流程|结果|统计|回归|队列/,
  ],
  publication: [
    /\bmanuscript\b/i,
    /\bpaper draft\b/i,
    /\bcitation\b/i,
    /\breference audit\b/i,
    /\boverleaf\b/i,
    /\babstract\b/i,
    /\bintroduction\b/i,
    /\bmethods\b/i,
    /\bdiscussion\b/i,
    /\bjournal\b/i,
    /\bsubmission\b/i,
    /\brebuttal\b/i,
    /\bcover letter\b/i,
    /\bfigure legend\b/i,
    /论文|稿件|引文|参考文献|摘要|引言|方法|讨论|投稿|返修|回复审稿人|图注/,
  ],
  promotion: [
    /\bslides?\b/i,
    /\bdeck\b/i,
    /\bpresentation\b/i,
    /\bposter\b/i,
    /\bhomepage\b/i,
    /\blanding page\b/i,
    /\bvideo\b/i,
    /\bnarration\b/i,
    /\baudio\b/i,
    /\btts\b/i,
    /\bdemo\b/i,
    /\bpromotion\b/i,
    /幻灯|演示|汇报|答辩|海报|主页|首页|视频|旁白|配音|推广|宣发/,
  ],
};

const STAGE_CONTEXT_PREFIXES = {
  literature: ['Literature/', 'literature/', 'Survey/', 'Research/', '.pipeline/docs/kb/uploads/', '.pipeline/docs/kb/notes/'],
  ideation: ['Ideation/', 'Literature/', 'literature/', 'Survey/', 'Research/', '.pipeline/docs/kb/uploads/', '.pipeline/docs/kb/notes/'],
  experiment: ['Experiment/', 'Ideation/', 'Literature/', 'literature/', 'Survey/', '.pipeline/docs/kb/uploads/', '.pipeline/docs/kb/notes/'],
  publication: ['Publication/', 'Experiment/', 'Literature/', 'literature/', 'Survey/', '.pipeline/docs/kb/uploads/', '.pipeline/docs/kb/notes/'],
  promotion: ['Promotion/', 'Publication/', 'Experiment/', '.pipeline/docs/kb/uploads/', '.pipeline/docs/kb/notes/'],
};

function collapseWhitespace(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clipText(value = '', maxChars = MAX_INDEXED_ENTRY_SUMMARY_CHARS) {
  const normalized = collapseWhitespace(value);
  if (!normalized || normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function normalizeStageName(stage) {
  const value = collapseWhitespace(stage).toLowerCase();
  if (!value) return '';
  if (value === 'presentation') return 'promotion';
  if (value === 'research' || value === 'survey') return 'literature';
  return value;
}

function inferStageFromText(text = '') {
  const normalizedText = collapseWhitespace(text);
  if (!normalizedText) {
    return '';
  }

  let bestStage = '';
  let bestScore = 0;

  Object.entries(REPORT_STAGE_INFERENCE_RULES).forEach(([stage, patterns]) => {
    const score = patterns.reduce((count, pattern) => (
      pattern.test(normalizedText) ? count + 1 : count
    ), 0);

    if (score > bestScore) {
      bestScore = score;
      bestStage = stage;
    }
  });

  return bestScore > 0 ? bestStage : '';
}

export function resolveReportStage({ stage = '', text = '', taskType = '' } = {}) {
  const normalizedStage = normalizeStageName(stage);
  if (normalizedStage && STAGE_REPORT_ROOTS[normalizedStage]) {
    return normalizedStage;
  }

  const inferredStage = inferStageFromText(text);
  if (inferredStage) {
    return inferredStage;
  }

  const normalizedTaskType = collapseWhitespace(taskType).toLowerCase();
  return TASK_TYPE_REPORT_STAGE_FALLBACKS[normalizedTaskType] || '';
}

function buildReportPlacementHint(resolvedStage = '') {
  const reportRoot = STAGE_REPORT_ROOTS[resolvedStage];
  const generalRule = 'Never use hidden folders such as .pipeline/docs/chat-reports for routine report artifacts. If the stage is unclear, infer the closest visible stage from the conversation content: literature/evidence -> Literature/reports, ideas/planning -> Ideation/ideas, code/results/analysis reports -> Experiment/analysis, generated analysis figures/charts/plots/images -> Experiment/figures, generated analysis tables/table source files -> Experiment/tables, other experiment-generated supporting files -> Experiment/attachments, manuscript/citations -> Publication/manuscript, slides/poster/homepage/video -> Promotion/slides. If still unclear, use the current active stage directory.';
  const experimentFigureRule = resolvedStage === 'experiment'
    ? ' For experiment artifacts, route result figures, charts, plots, and analysis images to Experiment/figures; result tables and table source files to Experiment/tables; other experiment-generated supporting files that are not reports, figures, tables, reusable code, or datasets to Experiment/attachments; and statistical notes, analysis reports, and result summaries to Experiment/analysis.'
    : '';
  const publicationRule = resolvedStage === 'publication'
    ? ' For publication artifacts, route manuscripts, abstracts, outlines, and manuscript change logs to Publication/manuscript; finalized manuscript/submission figure panels and figure legends to Publication/figures; tables to Publication/tables; and supplementary materials, checklists, and supplemental files to Publication/supplementary. Do not place routine analysis plots in Publication/figures.'
    : '';

  if (!reportRoot) {
    return `${generalRule}${experimentFigureRule}${publicationRule}`;
  }

  return `If the deliverable is a report, review, summary, plan, findings note, or change log, persist it as a Markdown file under ${reportRoot}. ${generalRule}${experimentFigureRule}${publicationRule}`;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function sortByUpdatedAtDesc(left, right) {
  return new Date(right?.updatedAt || 0).getTime() - new Date(left?.updatedAt || 0).getTime();
}

function scoreKnowledgeBaseEntry(entry = {}, stage = '') {
  const normalizedStage = normalizeStageName(stage);
  const relativePath = collapseWhitespace(entry?.relativePath);
  const sourceType = collapseWhitespace(entry?.sourceType).toLowerCase();
  let score = 0;

  if (sourceType === 'user_upload') score += 80;
  if (sourceType === 'manual_note') score += 70;
  if (sourceType === 'research_brief') score += 65;
  if (sourceType === 'literature_report' || sourceType === 'survey_report') score += normalizedStage === 'literature' ? 60 : 30;
  if (sourceType === 'publication_artifact') score += normalizedStage === 'publication' ? 40 : 15;

  if (relativePath === '.pipeline/docs/research_brief.json') {
    score += 55;
  }

  const prefixes = STAGE_CONTEXT_PREFIXES[normalizedStage] || [];
  if (prefixes.some((prefix) => relativePath.startsWith(prefix))) {
    score += 45;
  }

  if (relativePath.startsWith('.pipeline/docs/kb/uploads/')) {
    score += 35;
  }

  if (relativePath.startsWith('.pipeline/docs/kb/notes/')) {
    score += 30;
  }

  if (relativePath.startsWith('.pipeline/docs/kb/news/')) {
    score += 10;
  }

  if (entry?.summary) {
    score += 5;
  }

  return score;
}

function selectIndexedWorkspaceMaterials(entries = [], stage = '', limit = DEFAULT_INDEXED_ENTRY_LIMIT) {
  const ranked = (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      ...entry,
      _score: scoreKnowledgeBaseEntry(entry, stage),
    }))
    .filter((entry) => entry._score > 0)
    .sort((left, right) => {
      if (right._score !== left._score) {
        return right._score - left._score;
      }
      return sortByUpdatedAtDesc(left, right);
    });

  const selected = [];
  const seen = new Set();
  for (const entry of ranked) {
    const key = collapseWhitespace(entry.relativePath).toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    selected.push(entry);
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

export function buildWorkspaceMaterialsRule() {
  return `${WORKSPACE_MATERIALS_RULE_MARKER} before execution, inspect .pipeline/docs/kb/manifest.json when it exists and open the most relevant files under .pipeline/docs/kb/uploads/, .pipeline/docs/kb/notes/, and the active stage directories. Treat workspace documents as required task inputs instead of ignoring them.`;
}

export function buildAcceptedOnlyMaterialsRule() {
  return `${WORKSPACE_MATERIALS_RULE_MARKER} Auto Research accepted-only mode is active. Use only the approved Research Spec, explicit task inputs, user uploads/manual notes listed below, and verifier-pass artifacts from this task's dependency closure under the current specHash. Do not browse arbitrary stage directories, drafts, failed/revise outputs, or old-spec artifacts.`;
}

export function buildOutputLocationRule(stage = '', text = '', taskType = '') {
  const resolvedStage = resolveReportStage({ stage, text, taskType });
  const normalizedStage = normalizeStageName(stage) || resolvedStage;
  const stageLabel = STAGE_LABELS[normalizedStage] || 'Pipeline';
  const outputRoots = STAGE_OUTPUT_ROOTS[normalizedStage] || [];
  const reportPersistenceHint = buildReportPlacementHint(resolvedStage);
  const figureRoutingRule = 'Experiment-stage outputs must stay in the experiment package by default: generated result figures, charts, plots, and analysis images go to Experiment/figures; result tables and table source files go to Experiment/tables; and other experiment-generated supporting files go to Experiment/attachments. Use Publication/figures, Publication/tables, or Publication/supplementary only when the user explicitly asks to promote finalized manuscript/submission artifacts into the publication package.';
  if (outputRoots.length === 0) {
    return `${OUTPUT_LOCATION_RULE_MARKER} read instance.json first and write generated artifacts into the canonical pipeline directories for the active stage. Do not place code, reports, drafts, datasets, results, or figures in the project root unless the task explicitly requires it. ${figureRoutingRule} ${reportPersistenceHint}`;
  }

  return `${OUTPUT_LOCATION_RULE_MARKER} read instance.json first and write generated artifacts only under the canonical ${stageLabel} directories: ${outputRoots.join(', ')}. Do not place code, reports, drafts, datasets, results, or figures in the project root unless the task explicitly requires it. ${figureRoutingRule} ${reportPersistenceHint}`;
}

function buildIndexedWorkspaceMaterialsBlock(context = {}, stage = '') {
  const entries = selectIndexedWorkspaceMaterials(context?.manifest?.entries || [], stage);
  if (entries.length === 0) {
    return '';
  }

  const lines = [
    `${INDEXED_WORKSPACE_MATERIALS_MARKER} use these project materials as direct inputs for this task:`,
  ];

  entries.forEach((entry) => {
    const title = collapseWhitespace(entry?.title);
    const relativePath = collapseWhitespace(entry?.relativePath);
    const summary = clipText(entry?.summary || '');
    const prefix = title ? `${relativePath} (${title})` : relativePath;
    lines.push(summary ? `- ${prefix} — ${summary}` : `- ${prefix}`);
  });

  return lines.join('\n');
}

export async function loadTaskPromptContext(projectPath, options = {}) {
  const manifestPath = path.join(projectPath, DEFAULT_KB_MANIFEST_RELATIVE_PATH);
  let manifest = null;

  if (await pathExists(manifestPath)) {
    try {
      const raw = await fs.readFile(manifestPath, 'utf8');
      manifest = JSON.parse(raw);
    } catch (error) {
      console.warn('[TaskPromptContext] Failed to read knowledge-base manifest:', error?.message || error);
    }
  }

  return {
    projectPath,
    manifestPath,
    mode: options.mode || 'workspace',
    specHash: options.specHash || null,
    dependencyTaskIds: Array.isArray(options.dependencyTaskIds) ? options.dependencyTaskIds.map(String) : [],
    acceptedEvidence: Array.isArray(options.acceptedEvidence) ? options.acceptedEvidence : [],
    manifest: options.mode === 'accepted-only' && manifest
      ? {
          ...manifest,
          entries: (manifest.entries || []).filter((entry) => (
            ['user_upload', 'manual_note'].includes(String(entry.sourceType || '').toLowerCase())
            || (options.acceptedInputFiles || []).includes(entry.relativePath)
          )),
        }
      : manifest,
  };
}

export function enrichTaskPrompt(basePrompt = '', { stage = '', context = null } = {}) {
  const acceptedOnly = context?.mode === 'accepted-only';
  const prompt = String(basePrompt || '')
    .split('\n')
    .filter((line) => !(acceptedOnly && line.trim().startsWith(WORKSPACE_MATERIALS_RULE_MARKER)))
    .join('\n')
    .trim();
  const blocks = [prompt].filter(Boolean);

  if (!prompt.includes(WORKSPACE_MATERIALS_RULE_MARKER)) {
    blocks.push(acceptedOnly ? buildAcceptedOnlyMaterialsRule() : buildWorkspaceMaterialsRule());
  }

  if (!prompt.includes(OUTPUT_LOCATION_RULE_MARKER)) {
    blocks.push(buildOutputLocationRule(stage, prompt));
  }

  const indexedMaterialsBlock = buildIndexedWorkspaceMaterialsBlock(context, stage);
  if (indexedMaterialsBlock && !prompt.includes(INDEXED_WORKSPACE_MATERIALS_MARKER)) {
    blocks.push(indexedMaterialsBlock);
  }

  return blocks.join('\n\n').trim();
}

export function enrichTaskForExecution(task = {}, context = null) {
  return {
    ...task,
    nextActionPrompt: enrichTaskPrompt(task?.nextActionPrompt || '', {
      stage: task?.stage || '',
      context,
    }),
  };
}

export {
  DEFAULT_KB_MANIFEST_RELATIVE_PATH,
  INDEXED_WORKSPACE_MATERIALS_MARKER,
  OUTPUT_LOCATION_RULE_MARKER,
  STAGE_OUTPUT_ROOTS,
  STAGE_REPORT_ROOTS,
  WORKSPACE_MATERIALS_RULE_MARKER,
};
