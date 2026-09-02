import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';

import { hashJson } from './hash-utils.js';

const RESEARCH_SPEC_RELATIVE_PATH = '.pipeline/docs/research_spec.json';
const RESEARCH_SPEC_HISTORY_RELATIVE_DIR = '.pipeline/docs/research_spec.history';
const CHANGE_REQUESTS_RELATIVE_DIR = '.pipeline/change_requests';
const SPEC_STATUSES = new Set(['draft', 'needs_review', 'approved', 'superseded']);
const PLACEHOLDER_VALUES = new Set([
  '', 'none', 'null', 'n/a', 'na', 'todo', 'tbd', 'unknown', 'not sure', '-',
  '[]', '{}', 'placeholder', '待补充', '未知', '不确定', '占位符',
]);
const DANGEROUS_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const SYSTEM_SPEC_FIELDS = new Set([
  'schemaVersion', 'specVersion', 'specHash', 'status', 'approvedAt', 'approvedBy',
  'createdAt', 'updatedAt', 'sourceBriefHash',
]);
const ALLOWED_CHANGE_PATHS = new Set([
  'canonicalQuestion',
  'population.setting', 'population.inclusion', 'population.exclusion',
  'population.timeZero', 'population.followUp',
  'biomarkerOrExposure.name', 'biomarkerOrExposure.type',
  'biomarkerOrExposure.specimen', 'biomarkerOrExposure.assayPlatform',
  'biomarkerOrExposure.unit', 'biomarkerOrExposure.preprocessing',
  'biomarkerOrExposure.cutoff', 'biomarkerOrExposure.measurementWindow',
  'comparator', 'primaryOutcome.name', 'primaryOutcome.definition',
  'primaryOutcome.timeHorizon', 'secondaryOutcomes',
  'dataSource.name', 'dataSource.version', 'dataSource.tablesOrFields',
  'studyDesign', 'estimand', 'primaryModel', 'mandatoryCovariates',
  'mandatorySensitivityAnalyses', 'allowedExpansions', 'forbiddenChanges',
]);
const DEFAULT_LOCKED_BRIEF_PATHS = [
  'meta.primary_database', 'meta.database_version',
  'sections.literature.core_research_question',
  'sections.ideation.population_setting',
  'sections.ideation.inclusion_criteria',
  'sections.ideation.exclusion_criteria',
  'sections.ideation.time_zero',
  'sections.ideation.follow_up',
  'sections.ideation.biomarker_or_exposure',
  'sections.ideation.comparator',
  'sections.ideation.primary_outcome',
  'sections.ideation.outcome_definition',
  'sections.ideation.outcome_time_horizon',
  'sections.ideation.study_design',
  'sections.ideation.estimand',
  'sections.experiment.primary_model',
  'sections.experiment.mandatory_covariates',
  'sections.experiment.sensitivity_plan',
];

function getByPath(source, dottedPath) {
  return String(dottedPath || '').split('.').filter(Boolean).reduce((value, key) => (
    value && typeof value === 'object' ? value[key] : undefined
  ), source);
}

function assertSafeChangePath(dottedPath) {
  const normalized = String(dottedPath || '').trim();
  const segments = normalized.split('.').filter(Boolean);
  if (!normalized
    || segments.some((segment) => DANGEROUS_PATH_SEGMENTS.has(segment))
    || SYSTEM_SPEC_FIELDS.has(segments[0])
    || !ALLOWED_CHANGE_PATHS.has(normalized)) {
    const error = new Error(`Research Spec field "${normalized || '(empty)'}" is not changeable.`);
    error.code = 'CHANGE_REQUEST_FIELD_INVALID';
    throw error;
  }
  return normalized;
}

function setByPath(target, dottedPath, value) {
  const keys = assertSafeChangePath(dottedPath).split('.');
  let cursor = target;
  keys.slice(0, -1).forEach((key) => {
    if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) cursor[key] = {};
    cursor = cursor[key];
  });
  cursor[keys.at(-1)] = value;
}

function isPlaceholderLikeValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return PLACEHOLDER_VALUES.has(value.trim().toLowerCase());
  if (Array.isArray(value)) return value.length === 0 || value.every(isPlaceholderLikeValue);
  return false;
}

function firstMeaningful(values = [], fallback = '') {
  for (const value of values) {
    if (!isPlaceholderLikeValue(value)) return typeof value === 'string' ? value.trim() : value;
  }
  return fallback;
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.filter((item) => !isPlaceholderLikeValue(item));
  return isPlaceholderLikeValue(value) ? [] : [String(value).trim()];
}

function buildResearchSpecCore(spec = {}) {
  return {
    schemaVersion: spec.schemaVersion || '2.0',
    specVersion: Number(spec.specVersion || 1),
    status: SPEC_STATUSES.has(spec.status) ? spec.status : 'draft',
    templateId: spec.templateId || '',
    canonicalQuestion: spec.canonicalQuestion || '',
    population: spec.population || {},
    biomarkerOrExposure: spec.biomarkerOrExposure || {},
    comparator: spec.comparator || '',
    primaryOutcome: spec.primaryOutcome || {},
    secondaryOutcomes: spec.secondaryOutcomes || [],
    dataSource: spec.dataSource || {},
    studyDesign: spec.studyDesign || '',
    estimand: spec.estimand || '',
    primaryModel: spec.primaryModel || '',
    mandatoryCovariates: spec.mandatoryCovariates || [],
    mandatorySensitivityAnalyses: spec.mandatorySensitivityAnalyses || [],
    lockedBriefPaths: spec.lockedBriefPaths || [],
    allowedExpansions: spec.allowedExpansions || [],
    forbiddenChanges: spec.forbiddenChanges || [],
  };
}

function computeResearchSpecHash(spec = {}) {
  return hashJson(buildResearchSpecCore(spec));
}

function isMedicalResearchSpec(spec = {}) {
  return String(spec.templateId || '').toLowerCase().startsWith('medical-');
}

function buildResearchSpecFromBrief(brief = {}, { createdAt = new Date().toISOString() } = {}) {
  const structured = brief.researchSpec && typeof brief.researchSpec === 'object' ? brief.researchSpec : {};
  const ideation = getByPath(brief, 'sections.ideation') || {};
  const experiment = getByPath(brief, 'sections.experiment') || {};
  const templateId = brief.templateId || structured.templateId || '';
  const medical = String(templateId).toLowerCase().startsWith('medical-');
  const explicitlyApproved = structured.status === 'approved' && structured.approvedAt && structured.approvedBy;
  const spec = {
    schemaVersion: '2.0',
    specVersion: Number(structured.specVersion || 1),
    status: medical ? (explicitlyApproved ? 'approved' : 'needs_review') : 'approved',
    approvedAt: explicitlyApproved ? structured.approvedAt : (medical ? null : createdAt),
    approvedBy: explicitlyApproved ? structured.approvedBy : (medical ? null : 'system:generic-migration'),
    templateId,
    createdAt,
    updatedAt: createdAt,
    sourceBriefHash: hashJson(brief),
    canonicalQuestion: firstMeaningful([
      structured.canonicalQuestion,
      getByPath(brief, 'sections.literature.core_research_question'),
      brief.canonicalQuestion,
      getByPath(brief, 'meta.title'),
    ]),
    population: {
      setting: firstMeaningful([structured.population?.setting, ideation.population_setting]),
      inclusion: normalizeList(firstMeaningful([structured.population?.inclusion, ideation.inclusion_criteria], [])),
      exclusion: normalizeList(firstMeaningful([structured.population?.exclusion, ideation.exclusion_criteria], [])),
      timeZero: firstMeaningful([structured.population?.timeZero, ideation.time_zero]),
      followUp: firstMeaningful([structured.population?.followUp, ideation.follow_up]),
    },
    biomarkerOrExposure: {
      name: firstMeaningful([structured.biomarkerOrExposure?.name, ideation.biomarker_or_exposure, ideation.exposure]),
      type: firstMeaningful([structured.biomarkerOrExposure?.type, ideation.measurement_type]),
      specimen: firstMeaningful([structured.biomarkerOrExposure?.specimen, ideation.specimen]),
      assayPlatform: firstMeaningful([structured.biomarkerOrExposure?.assayPlatform, ideation.assay_platform]),
      unit: firstMeaningful([structured.biomarkerOrExposure?.unit, ideation.unit]),
      preprocessing: firstMeaningful([structured.biomarkerOrExposure?.preprocessing, ideation.preprocessing]),
      cutoff: firstMeaningful([structured.biomarkerOrExposure?.cutoff, ideation.cutoff]),
      measurementWindow: firstMeaningful([structured.biomarkerOrExposure?.measurementWindow, ideation.measurement_window]),
    },
    comparator: firstMeaningful([structured.comparator, ideation.comparator]),
    primaryOutcome: {
      name: firstMeaningful([structured.primaryOutcome?.name, ideation.primary_outcome]),
      definition: firstMeaningful([structured.primaryOutcome?.definition, ideation.outcome_definition]),
      timeHorizon: firstMeaningful([structured.primaryOutcome?.timeHorizon, ideation.outcome_time_horizon]),
    },
    secondaryOutcomes: normalizeList(firstMeaningful([structured.secondaryOutcomes, ideation.secondary_outcomes], [])),
    dataSource: {
      name: firstMeaningful([structured.dataSource?.name, getByPath(brief, 'meta.primary_database'), experiment.dataset_name]),
      version: firstMeaningful([structured.dataSource?.version, getByPath(brief, 'meta.database_version')]),
      tablesOrFields: normalizeList(firstMeaningful([
        structured.dataSource?.tablesOrFields,
        getByPath(brief, 'sections.literature.registry_data_assets'),
      ], [])),
    },
    studyDesign: firstMeaningful([structured.studyDesign, ideation.study_design]),
    estimand: firstMeaningful([structured.estimand, ideation.estimand]),
    primaryModel: firstMeaningful([structured.primaryModel, experiment.primary_model]),
    mandatoryCovariates: normalizeList(firstMeaningful([structured.mandatoryCovariates, experiment.mandatory_covariates], [])),
    mandatorySensitivityAnalyses: normalizeList(firstMeaningful([
      structured.mandatorySensitivityAnalyses,
      experiment.sensitivity_plan,
    ], [])),
    lockedBriefPaths: Array.isArray(structured.lockedBriefPaths) ? structured.lockedBriefPaths : DEFAULT_LOCKED_BRIEF_PATHS,
    allowedExpansions: normalizeList(structured.allowedExpansions),
    forbiddenChanges: normalizeList(firstMeaningful([structured.forbiddenChanges, [
      'research population', 'primary biomarker/exposure', 'primary outcome',
      'data source', 'study design', 'estimand',
    ]], [])),
  };
  spec.specHash = computeResearchSpecHash(spec);
  return spec;
}

function validateTimeZero(value) {
  const text = String(value || '').trim();
  return text.length >= 4 && /(index|baseline|enrol|enroll|admission|diagnos|start|date|day\s*0|time\s*zero|入组|基线|入院|诊断|起始|索引日|时间零点)/i.test(text);
}

function validateFollowUp(value) {
  const text = String(value || '').trim();
  return text.length >= 3 && /(\d+\s*(day|week|month|year|天|周|月|年)|until|through|censor|discharge|death|end of|随访|截至|出院|死亡|终止)/i.test(text);
}

function validateStudyDesign(value) {
  return /(cohort|case[- ]?control|cross[- ]?sectional|randomi[sz]ed|clinical trial|target trial|self[- ]controlled|case crossover|time series|registry|队列|病例对照|横断面|随机|临床试验|目标试验|自身对照|时间序列|登记研究)/i.test(String(value || ''));
}

function validateResearchSpecCompleteness(spec = {}) {
  if (!isMedicalResearchSpec(spec)) return { valid: true, missing: [], invalid: [], warnings: [] };
  const required = [
    ['canonicalQuestion', spec.canonicalQuestion],
    ['population.setting', spec.population?.setting],
    ['population.timeZero', spec.population?.timeZero],
    ['population.followUp', spec.population?.followUp],
    ['biomarkerOrExposure.name', spec.biomarkerOrExposure?.name],
    ['primaryOutcome.name', spec.primaryOutcome?.name],
    ['primaryOutcome.definition', spec.primaryOutcome?.definition],
    ['primaryOutcome.timeHorizon', spec.primaryOutcome?.timeHorizon],
    ['dataSource.name', spec.dataSource?.name],
    ['studyDesign', spec.studyDesign],
    ['estimand', spec.estimand],
    ['primaryModel', spec.primaryModel],
  ];
  if (/medical-(?:database-research|ukb-cohort)/i.test(spec.templateId || '')) {
    required.push(['dataSource.version', spec.dataSource?.version]);
  }
  const biomarkerRequired = String(spec.biomarkerOrExposure?.type || '').toLowerCase() === 'biomarker'
    || [spec.biomarkerOrExposure?.specimen, spec.biomarkerOrExposure?.assayPlatform, spec.biomarkerOrExposure?.unit]
      .some((value) => !isPlaceholderLikeValue(value));
  if (biomarkerRequired) {
    required.push(
      ['biomarkerOrExposure.specimen', spec.biomarkerOrExposure?.specimen],
      ['biomarkerOrExposure.assayPlatform', spec.biomarkerOrExposure?.assayPlatform],
      ['biomarkerOrExposure.unit', spec.biomarkerOrExposure?.unit],
      ['biomarkerOrExposure.measurementWindow', spec.biomarkerOrExposure?.measurementWindow],
    );
  }
  const missing = required.filter(([, value]) => isPlaceholderLikeValue(value)).map(([field]) => field);
  const invalid = [];
  if (!missing.includes('population.timeZero') && !validateTimeZero(spec.population?.timeZero)) invalid.push('population.timeZero');
  if (!missing.includes('population.followUp') && !validateFollowUp(spec.population?.followUp)) invalid.push('population.followUp');
  if (!missing.includes('primaryOutcome.name') && (String(spec.primaryOutcome?.name).length > 160 || /\n/.test(String(spec.primaryOutcome?.name)))) invalid.push('primaryOutcome.name');
  if (!missing.includes('studyDesign') && !validateStudyDesign(spec.studyDesign)) invalid.push('studyDesign');
  return { valid: missing.length === 0 && invalid.length === 0, missing, invalid, warnings: [] };
}

function toResearchSpecPromptView(spec = {}) {
  return {
    ...buildResearchSpecCore(spec),
    approvedAt: spec.approvedAt || null,
    approvedBy: spec.approvedBy || null,
    specHash: spec.specHash || computeResearchSpecHash(spec),
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function loadResearchSpec(projectPath) {
  const filePath = path.join(projectPath, RESEARCH_SPEC_RELATIVE_PATH);
  try {
    const spec = await readJson(filePath);
    const computedHash = computeResearchSpecHash(spec);
    const validStatus = SPEC_STATUSES.has(spec.status);
    return {
      exists: true,
      valid: validStatus && computedHash === spec.specHash,
      filePath,
      spec,
      computedHash,
      error: !validStatus
        ? 'Stored Research Spec has an invalid status.'
        : computedHash === spec.specHash ? null : 'Stored Research Spec hash does not match its locked fields.',
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, valid: false, filePath, spec: null, computedHash: null, error: null };
    return { exists: true, valid: false, filePath, spec: null, computedHash: null, error: error.message };
  }
}

async function writeResearchSpec(projectPath, spec) {
  const filePath = path.join(projectPath, RESEARCH_SPEC_RELATIVE_PATH);
  const nextSpec = { ...spec, updatedAt: spec.updatedAt || new Date().toISOString() };
  nextSpec.specHash = computeResearchSpecHash(nextSpec);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(nextSpec, null, 2)}\n`, 'utf8');
  return nextSpec;
}

async function syncApprovedSpecToBrief(projectPath, spec) {
  const briefPath = path.join(projectPath, '.pipeline', 'docs', 'research_brief.json');
  try {
    const brief = await readJson(briefPath);
    brief.researchSpec = {
      ...toResearchSpecPromptView(spec),
      approvedAt: spec.approvedAt,
      approvedBy: spec.approvedBy,
    };
    await fs.writeFile(briefPath, `${JSON.stringify(brief, null, 2)}\n`, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function createResearchSpecDraft(projectPath, brief = null) {
  const sourceBrief = brief || await readJson(path.join(projectPath, '.pipeline', 'docs', 'research_brief.json'));
  const existing = await loadResearchSpec(projectPath);
  const draft = buildResearchSpecFromBrief(sourceBrief, { createdAt: existing.spec?.createdAt || new Date().toISOString() });
  draft.specVersion = Number(existing.spec?.specVersion || 1);
  if (isMedicalResearchSpec(draft)) {
    draft.status = 'needs_review';
    draft.approvedAt = null;
    draft.approvedBy = null;
  }
  return writeResearchSpec(projectPath, draft);
}

async function approveResearchSpec(projectPath, { approvedBy = 'user' } = {}) {
  const state = await loadResearchSpec(projectPath);
  if (!state.valid || !state.spec) {
    const error = new Error(state.error || 'Create a Research Spec draft before approval.');
    error.code = 'RESEARCH_SPEC_INVALID';
    throw error;
  }
  const validation = validateResearchSpecCompleteness(state.spec);
  if (!validation.valid) {
    const error = new Error(`Research Spec is incomplete or invalid: ${[...validation.missing, ...validation.invalid].join(', ')}`);
    error.code = 'RESEARCH_SPEC_INCOMPLETE';
    error.validation = validation;
    throw error;
  }
  const approved = await writeResearchSpec(projectPath, {
    ...state.spec,
    status: 'approved',
    approvedAt: new Date().toISOString(),
    approvedBy: String(approvedBy || 'user'),
    updatedAt: new Date().toISOString(),
  });
  await syncApprovedSpecToBrief(projectPath, approved);
  return approved;
}

async function ensureResearchSpec(projectPath, brief = null, { requireApproved = true } = {}) {
  const existing = await loadResearchSpec(projectPath);
  let spec = existing.valid ? existing.spec : null;
  if (existing.exists && !existing.valid) {
    const error = new Error(existing.error || 'Research Spec is invalid.');
    error.code = 'RESEARCH_SPEC_INVALID';
    throw error;
  }
  if (!spec) {
    const sourceBrief = brief || await readJson(path.join(projectPath, '.pipeline', 'docs', 'research_brief.json'));
    const candidate = buildResearchSpecFromBrief(sourceBrief);
    if (requireApproved && candidate.status !== 'approved') {
      const error = new Error('Research Spec requires explicit review and approval before Auto Research can start.');
      error.code = 'RESEARCH_SPEC_APPROVAL_REQUIRED';
      throw error;
    }
    spec = await writeResearchSpec(projectPath, candidate);
  }
  if (requireApproved && spec.status !== 'approved') {
    const error = new Error(`Research Spec status is ${spec.status}; approved is required.`);
    error.code = 'RESEARCH_SPEC_APPROVAL_REQUIRED';
    throw error;
  }
  return spec;
}

function safeChangeRequestId(value) {
  const normalized = String(value || '').trim();
  return /^[a-zA-Z0-9._-]+$/.test(normalized) ? normalized : null;
}

function inferAffectedStages(field) {
  if (/^(canonicalQuestion|population|biomarkerOrExposure|comparator|primaryOutcome|dataSource|studyDesign|estimand)/.test(field)) {
    return ['ideation', 'experiment', 'publication', 'promotion'];
  }
  if (/^(primaryModel|mandatoryCovariates|mandatorySensitivityAnalyses)/.test(field)) return ['experiment', 'publication', 'promotion'];
  return ['literature', 'ideation', 'experiment', 'publication', 'promotion'];
}

async function listResearchSpecChangeRequests(projectPath) {
  const directory = path.join(projectPath, CHANGE_REQUESTS_RELATIVE_DIR);
  try {
    const names = (await fs.readdir(directory)).filter((name) => name.endsWith('.json'));
    const requests = await Promise.all(names.map((name) => readJson(path.join(directory, name))));
    return requests.sort((left, right) => String(right.requestedAt || '').localeCompare(String(left.requestedAt || '')));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function createResearchSpecChangeRequest(projectPath, request = {}) {
  const field = assertSafeChangePath(request.field);
  if (!String(request.reason || '').trim()) {
    const error = new Error('A reason is required for a Research Spec change request.');
    error.code = 'CHANGE_REQUEST_INVALID';
    throw error;
  }
  const id = safeChangeRequestId(request.id) || crypto.randomUUID();
  const payload = {
    id,
    runId: request.runId || '',
    taskId: request.taskId || '',
    field,
    before: request.before,
    after: request.after,
    reason: request.reason || '',
    supportingEvidence: Array.isArray(request.supportingEvidence) ? request.supportingEvidence : [],
    impact: {
      affectedStages: Array.isArray(request.impact?.affectedStages) ? request.impact.affectedStages : inferAffectedStages(field),
      affectedTaskIds: Array.isArray(request.impact?.affectedTaskIds) ? request.impact.affectedTaskIds.map(String) : [],
      invalidateDescendants: request.impact?.invalidateDescendants !== false,
    },
    requestedAt: request.requestedAt || new Date().toISOString(),
    status: 'pending',
  };
  const directory = path.join(projectPath, CHANGE_REQUESTS_RELATIVE_DIR);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, `${id}.json`), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

function extractTasksContainer(raw) {
  if (Array.isArray(raw)) return { tasks: raw, apply: (tasks) => tasks };
  if (Array.isArray(raw?.tasks)) return { tasks: raw.tasks, apply: (tasks) => ({ ...raw, tasks }) };
  const tag = Object.keys(raw || {}).find((key) => Array.isArray(raw[key]?.tasks)) || 'master';
  return {
    tasks: Array.isArray(raw?.[tag]?.tasks) ? raw[tag].tasks : [],
    apply: (tasks) => ({ ...raw, [tag]: { ...(raw?.[tag] || {}), tasks } }),
  };
}

function expandAffectedTaskIds(tasks, request) {
  const affected = new Set((request.impact?.affectedTaskIds || []).map(String));
  const stages = new Set(request.impact?.affectedStages || []);
  tasks.forEach((task) => { if (stages.has(task.stage)) affected.add(String(task.id)); });
  if (!request.impact?.invalidateDescendants) return affected;
  let changed = true;
  while (changed) {
    changed = false;
    tasks.forEach((task) => {
      if (affected.has(String(task.id))) return;
      if ((task.dependencies || []).some((dependency) => affected.has(String(dependency)))) {
        affected.add(String(task.id));
        changed = true;
      }
    });
  }
  return affected;
}

async function invalidateRunArtifacts(projectPath, oldSpec, newSpec, affectedTaskIds, requestId) {
  const runsDir = path.join(projectPath, '.pipeline', 'runs');
  let runNames = [];
  try { runNames = await fs.readdir(runsDir); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  for (const runName of runNames) {
    const tasksDir = path.join(runsDir, runName, 'tasks');
    let taskNames = [];
    try { taskNames = await fs.readdir(tasksDir); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    for (const taskName of taskNames) {
      if (!affectedTaskIds.has(String(taskName))) continue;
      for (const fileName of ['verification.json', 'evidence-manifest.json']) {
        const filePath = path.join(tasksDir, taskName, fileName);
        try {
          const payload = await readJson(filePath);
          if (payload.specHash !== oldSpec.specHash) continue;
          await fs.writeFile(filePath, `${JSON.stringify({
            ...payload,
            status: 'invalidated',
            invalidatedAt: new Date().toISOString(),
            invalidatedByChangeRequest: requestId,
            invalidatedBySpecVersion: newSpec.specVersion,
          }, null, 2)}\n`, 'utf8');
        } catch (error) { if (error?.code !== 'ENOENT') throw error; }
      }
    }
    const checkpointPath = path.join(runsDir, runName, 'checkpoint.json');
    try {
      const checkpoint = await readJson(checkpointPath);
      if (checkpoint.researchSpecHash === oldSpec.specHash) {
        await fs.writeFile(checkpointPath, `${JSON.stringify({
          ...checkpoint,
          invalidated: true,
          invalidatedAt: new Date().toISOString(),
          invalidatedByChangeRequest: requestId,
          invalidatedBySpecVersion: newSpec.specVersion,
        }, null, 2)}\n`, 'utf8');
      }
    } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
}

async function invalidateTasksForSpecChange(projectPath, oldSpec, newSpec, request) {
  const tasksPath = path.join(projectPath, '.pipeline', 'tasks', 'tasks.json');
  let affectedTaskIds = new Set();
  try {
    const raw = await readJson(tasksPath);
    const container = extractTasksContainer(raw);
    affectedTaskIds = expandAffectedTaskIds(container.tasks, request);
    const tasks = container.tasks.map((task) => affectedTaskIds.has(String(task.id)) ? {
      ...task,
      status: 'pending',
      executionState: {
        ...(task.executionState || {}),
        verificationStatus: 'invalidated',
        invalidatedAt: new Date().toISOString(),
        invalidatedByChangeRequest: request.id,
        invalidatedBySpecVersion: newSpec.specVersion,
      },
      updatedAt: new Date().toISOString(),
    } : task);
    await fs.writeFile(tasksPath, `${JSON.stringify(container.apply(tasks), null, 2)}\n`, 'utf8');
  } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  await invalidateRunArtifacts(projectPath, oldSpec, newSpec, affectedTaskIds, request.id);
  const claimsLedger = path.join(projectPath, '.pipeline', 'docs', 'accepted-claims.jsonl');
  await fs.mkdir(path.dirname(claimsLedger), { recursive: true });
  for (const taskId of affectedTaskIds) {
    await fs.appendFile(claimsLedger, `${JSON.stringify({
      status: 'invalidated',
      taskId,
      specHash: oldSpec.specHash,
      invalidatedBySpecVersion: newSpec.specVersion,
      invalidatedByChangeRequest: request.id,
      invalidatedAt: new Date().toISOString(),
    })}\n`, 'utf8');
  }
  return [...affectedTaskIds];
}

async function archiveResearchSpec(projectPath, spec) {
  const historyDir = path.join(projectPath, RESEARCH_SPEC_HISTORY_RELATIVE_DIR);
  await fs.mkdir(historyDir, { recursive: true });
  await fs.writeFile(path.join(historyDir, `v${spec.specVersion}.json`), `${JSON.stringify({ ...spec, status: 'superseded' }, null, 2)}\n`, 'utf8');
}

async function resolveResearchSpecChangeRequest(projectPath, id, decision, { resolvedBy = 'user' } = {}) {
  const safeId = safeChangeRequestId(id);
  if (!safeId || !['approved', 'rejected'].includes(decision)) {
    const error = new Error('Invalid change request resolution.');
    error.code = 'CHANGE_REQUEST_INVALID';
    throw error;
  }
  const requestPath = path.join(projectPath, CHANGE_REQUESTS_RELATIVE_DIR, `${safeId}.json`);
  const request = await readJson(requestPath);
  if (request.status !== 'pending') {
    const error = new Error('Change request has already been resolved.');
    error.code = 'CHANGE_REQUEST_RESOLVED';
    throw error;
  }
  assertSafeChangePath(request.field);
  let spec = null;
  let affectedTaskIds = [];
  if (decision === 'approved') {
    const oldSpec = await ensureResearchSpec(projectPath);
    if (Object.prototype.hasOwnProperty.call(request, 'before')
      && hashJson(getByPath(oldSpec, request.field)) !== hashJson(request.before)) {
      const error = new Error('Change request is stale because the current Research Spec value changed.');
      error.code = 'CHANGE_REQUEST_STALE';
      throw error;
    }
    const nextSpec = structuredClone(oldSpec);
    setByPath(nextSpec, request.field, request.after);
    nextSpec.specVersion = Number(oldSpec.specVersion || 1) + 1;
    nextSpec.status = 'approved';
    nextSpec.approvedAt = new Date().toISOString();
    nextSpec.approvedBy = String(resolvedBy || 'user');
    nextSpec.updatedAt = new Date().toISOString();
    const validation = validateResearchSpecCompleteness(nextSpec);
    if (!validation.valid) {
      const error = new Error(`Requested change produces an invalid Research Spec: ${[...validation.missing, ...validation.invalid].join(', ')}`);
      error.code = 'RESEARCH_SPEC_INCOMPLETE';
      throw error;
    }
    await archiveResearchSpec(projectPath, oldSpec);
    spec = await writeResearchSpec(projectPath, nextSpec);
    await syncApprovedSpecToBrief(projectPath, spec);
    affectedTaskIds = await invalidateTasksForSpecChange(projectPath, oldSpec, spec, request);
  } else {
    const tasksPath = path.join(projectPath, '.pipeline', 'tasks', 'tasks.json');
    try {
      const raw = await readJson(tasksPath);
      const container = extractTasksContainer(raw);
      const tasks = container.tasks.map((task) => (
        task.status === 'blocked' && task.executionState?.changeRequestId === request.id
          ? { ...task, status: 'pending', executionState: { ...task.executionState, blockCode: null, changeRequestId: null }, updatedAt: new Date().toISOString() }
          : task
      ));
      await fs.writeFile(tasksPath, `${JSON.stringify(container.apply(tasks), null, 2)}\n`, 'utf8');
    } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  const resolved = {
    ...request,
    status: decision,
    resolvedAt: new Date().toISOString(),
    resolvedBy,
    impact: { ...(request.impact || {}), affectedTaskIds },
    ...(spec ? { resultingSpecVersion: spec.specVersion, resultingSpecHash: spec.specHash } : {}),
  };
  await fs.writeFile(requestPath, `${JSON.stringify(resolved, null, 2)}\n`, 'utf8');
  return { request: resolved, spec, affectedTaskIds };
}

export {
  ALLOWED_CHANGE_PATHS,
  CHANGE_REQUESTS_RELATIVE_DIR,
  DEFAULT_LOCKED_BRIEF_PATHS,
  RESEARCH_SPEC_HISTORY_RELATIVE_DIR,
  RESEARCH_SPEC_RELATIVE_PATH,
  approveResearchSpec,
  assertSafeChangePath,
  buildResearchSpecCore,
  buildResearchSpecFromBrief,
  computeResearchSpecHash,
  createResearchSpecChangeRequest,
  createResearchSpecDraft,
  ensureResearchSpec,
  getByPath,
  isMedicalResearchSpec,
  isPlaceholderLikeValue,
  listResearchSpecChangeRequests,
  loadResearchSpec,
  resolveResearchSpecChangeRequest,
  toResearchSpecPromptView,
  validateResearchSpecCompleteness,
  writeResearchSpec,
};
