import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildResearchSpecFromBrief,
  approveResearchSpec,
  createResearchSpecChangeRequest,
  createResearchSpecDraft,
  ensureResearchSpec,
  loadResearchSpec,
  resolveResearchSpecChangeRequest,
  validateResearchSpecCompleteness,
} from '../pipeline/research-spec.js';

const cleanupTargets = [];

async function createTempProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-research-spec-'));
  cleanupTargets.push(projectPath);
  return projectPath;
}

function medicalBrief() {
  return {
    templateId: 'medical-database-research',
    meta: { title: 'Biomarker and mortality', primary_database: 'UK Biobank', database_version: '2026-01 extraction' },
    sections: {
      literature: {
        core_research_question: 'Is plasma biomarker X associated with 30-day mortality?',
        literature_scope: 'Plasma biomarker X and 30-day mortality',
      },
      ideation: {
        research_goal: 'Estimate the adjusted association',
        problem_framing: 'ICU adults at admission, followed for 30 days',
        evidence_plan: '30-day all-cause mortality from linked records',
        population_setting: 'Adults receiving critical care in participating hospitals',
        inclusion_criteria: ['Age 18 years or older'],
        exclusion_criteria: ['Missing index admission date'],
        time_zero: 'Date of ICU admission',
        follow_up: '30 days after admission or until death',
        biomarker_or_exposure: 'Plasma biomarker X',
        measurement_type: 'biomarker',
        specimen: 'Plasma',
        assay_platform: 'Olink Explore 3072',
        unit: 'NPX',
        measurement_window: 'Within 24 hours before or after ICU admission',
        comparator: 'Per standard deviation lower biomarker concentration',
        primary_outcome: '30-day all-cause mortality',
        outcome_definition: 'Death in linked mortality records within 30 days',
        outcome_time_horizon: '30 days',
        study_design: 'Retrospective cohort study',
        estimand: 'Adjusted hazard ratio for 30-day mortality per SD higher biomarker X among eligible ICU adults',
      },
      experiment: {
        hypothesis_or_validation_goal: 'Adjusted hazard ratio at 30 days',
        dataset_or_data_source: 'UKB fields and mortality linkage',
        method_or_protocol: 'Retrospective cohort design',
        evaluation_plan: 'Cox model with prespecified covariates',
        primary_model: 'Cox proportional hazards model',
        mandatory_covariates: ['Age', 'Sex'],
      },
    },
  };
}

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    await fs.rm(cleanupTargets.pop(), { recursive: true, force: true });
  }
});

describe('research spec', () => {
  it('creates and verifies a stable frozen spec from the research brief', async () => {
    const projectPath = await createTempProject();
    const brief = medicalBrief();
    await fs.mkdir(path.join(projectPath, '.pipeline', 'docs'), { recursive: true });
    await fs.writeFile(
      path.join(projectPath, '.pipeline', 'docs', 'research_brief.json'),
      JSON.stringify(brief),
      'utf8',
    );

    const draft = await createResearchSpecDraft(projectPath);
    expect(draft.status).toBe('needs_review');
    await expect(ensureResearchSpec(projectPath)).rejects.toMatchObject({ code: 'RESEARCH_SPEC_APPROVAL_REQUIRED' });
    const spec = await approveResearchSpec(projectPath, { approvedBy: 'user:test' });
    await expect(ensureResearchSpec(projectPath)).resolves.toMatchObject({ status: 'approved' });
    const loaded = await loadResearchSpec(projectPath);

    expect(spec.specHash).toMatch(/^sha256:/);
    expect(spec.canonicalQuestion).toContain('plasma biomarker X');
    expect(spec.dataSource.name).toBe('UK Biobank');
    expect(loaded.valid).toBe(true);
    expect(loaded.spec.specHash).toBe(spec.specHash);
    expect(validateResearchSpecCompleteness(spec)).toMatchObject({ valid: true, missing: [], invalid: [] });
  });

  it('does not reuse mixed legacy paragraphs as distinct timing and outcome fields', () => {
    const spec = buildResearchSpecFromBrief({
      templateId: 'medical-database-research',
      meta: { title: 'Legacy draft', primary_database: 'UKB' },
      sections: {
        ideation: { problem_framing: 'Adults at admission followed for 30 days', evidence_plan: 'Mortality analysis' },
        experiment: { method_or_protocol: 'Cohort protocol', evaluation_plan: 'Cox model' },
      },
    });
    expect(spec.status).toBe('needs_review');
    expect(spec.population.timeZero).toBe('');
    expect(spec.population.followUp).toBe('');
    expect(spec.primaryOutcome.timeHorizon).toBe('');
    expect(validateResearchSpecCompleteness(spec).valid).toBe(false);
  });

  it('rejects placeholders and dangerous change-request paths', async () => {
    const spec = buildResearchSpecFromBrief({
      ...medicalBrief(),
      sections: {
        ...medicalBrief().sections,
        ideation: { ...medicalBrief().sections.ideation, time_zero: 'TBD' },
      },
    });
    expect(validateResearchSpecCompleteness(spec).missing).toContain('population.timeZero');

    const projectPath = await createTempProject();
    await expect(createResearchSpecChangeRequest(projectPath, {
      field: '__proto__.polluted', reason: 'test', after: true,
    })).rejects.toMatchObject({ code: 'CHANGE_REQUEST_FIELD_INVALID' });
    await expect(createResearchSpecChangeRequest(projectPath, {
      field: 'specHash', reason: 'test', after: 'bad',
    })).rejects.toMatchObject({ code: 'CHANGE_REQUEST_FIELD_INVALID' });
  });

  it('reports missing locked medical fields', () => {
    const spec = buildResearchSpecFromBrief({
      templateId: 'medical-database-research',
      meta: { title: 'Incomplete study' },
    });

    const validation = validateResearchSpecCompleteness(spec);

    expect(validation.valid).toBe(false);
    expect(validation.missing).toEqual(expect.arrayContaining([
      'population.setting',
      'biomarkerOrExposure.name',
      'primaryOutcome.name',
      'dataSource.name',
    ]));
  });

  it('invalidates affected tasks, descendants, run evidence, checkpoints, and accepted claims after approval', async () => {
    const projectPath = await createTempProject();
    const docsDir = path.join(projectPath, '.pipeline', 'docs');
    const tasksDir = path.join(projectPath, '.pipeline', 'tasks');
    await fs.mkdir(docsDir, { recursive: true });
    await fs.mkdir(tasksDir, { recursive: true });
    await fs.writeFile(path.join(docsDir, 'research_brief.json'), JSON.stringify(medicalBrief()));
    await createResearchSpecDraft(projectPath);
    const oldSpec = await approveResearchSpec(projectPath, { approvedBy: 'user:test' });

    const tasks = [
      { id: 1, title: 'Literature', stage: 'literature', status: 'done', dependencies: [] },
      { id: 2, title: 'Model', stage: 'experiment', status: 'done', dependencies: [1] },
      { id: 3, title: 'Paper', stage: 'publication', status: 'done', dependencies: [2] },
    ];
    await fs.writeFile(path.join(tasksDir, 'tasks.json'), JSON.stringify({ master: { tasks } }));
    const taskRunDir = path.join(projectPath, '.pipeline', 'runs', 'run-1', 'tasks', '2');
    await fs.mkdir(taskRunDir, { recursive: true });
    await fs.writeFile(path.join(taskRunDir, 'verification.json'), JSON.stringify({
      taskId: '2', specHash: oldSpec.specHash, status: 'active', verdict: 'pass',
    }));
    await fs.writeFile(path.join(taskRunDir, 'evidence-manifest.json'), JSON.stringify({
      taskId: '2', specHash: oldSpec.specHash, status: 'submitted', artifacts: [],
    }));
    await fs.writeFile(path.join(projectPath, '.pipeline', 'runs', 'run-1', 'checkpoint.json'), JSON.stringify({
      researchSpecHash: oldSpec.specHash, nextTaskId: '3',
    }));
    await fs.writeFile(path.join(docsDir, 'accepted-claims.jsonl'), `${JSON.stringify({
      status: 'accepted', taskId: '2', specHash: oldSpec.specHash, claim: 'Old model result',
    })}\n`);

    const request = await createResearchSpecChangeRequest(projectPath, {
      field: 'primaryModel',
      before: oldSpec.primaryModel,
      after: 'Flexible parametric survival model',
      reason: 'The proportional-hazards diagnostic failed.',
      impact: { affectedStages: [], affectedTaskIds: ['2'], invalidateDescendants: true },
    });
    const resolution = await resolveResearchSpecChangeRequest(projectPath, request.id, 'approved', {
      resolvedBy: 'user:reviewer',
    });

    const nextTasks = JSON.parse(await fs.readFile(path.join(tasksDir, 'tasks.json'), 'utf8')).master.tasks;
    expect(nextTasks.map((task) => [String(task.id), task.status])).toEqual([
      ['1', 'done'], ['2', 'pending'], ['3', 'pending'],
    ]);
    expect(resolution.affectedTaskIds.sort()).toEqual(['2', '3']);
    expect(resolution.spec.specVersion).toBe(oldSpec.specVersion + 1);
    expect(resolution.spec.specHash).not.toBe(oldSpec.specHash);
    expect(JSON.parse(await fs.readFile(path.join(taskRunDir, 'verification.json'), 'utf8')))
      .toMatchObject({ status: 'invalidated', invalidatedByChangeRequest: request.id });
    expect(JSON.parse(await fs.readFile(path.join(taskRunDir, 'evidence-manifest.json'), 'utf8')))
      .toMatchObject({ status: 'invalidated', invalidatedByChangeRequest: request.id });
    expect(JSON.parse(await fs.readFile(path.join(projectPath, '.pipeline', 'runs', 'run-1', 'checkpoint.json'), 'utf8')))
      .toMatchObject({ invalidated: true, invalidatedByChangeRequest: request.id });
    const claimEvents = (await fs.readFile(path.join(docsDir, 'accepted-claims.jsonl'), 'utf8'))
      .trim().split('\n').map((line) => JSON.parse(line));
    expect(claimEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'invalidated', taskId: '2', invalidatedByChangeRequest: request.id }),
      expect.objectContaining({ status: 'invalidated', taskId: '3', invalidatedByChangeRequest: request.id }),
    ]));
    expect(JSON.parse(await fs.readFile(path.join(docsDir, 'research_spec.history', `v${oldSpec.specVersion}.json`), 'utf8')))
      .toMatchObject({ status: 'superseded', specHash: oldSpec.specHash });
  });
});
