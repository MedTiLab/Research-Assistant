import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { validateTaskGraph } from '../pipeline/task-graph.js';
import { syncTasksWithResearchBrief } from '../routes/taskmaster.js';

const cleanupTargets = [];

function brief() {
  return {
    pipeline: {
      startStage: 'literature',
      stages: {
        literature: {
          task_blueprints: [
            { id: 'source', title: 'Collect source', description: 'Collect the source.', taskType: 'exploration' },
            { id: 'analysis', title: 'Analyze source', description: 'Analyze the source.', taskType: 'analysis', dependencies: ['source'] },
          ],
        },
      },
    },
  };
}

async function projectWithTasks(tasks, briefData = brief()) {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-task-graph-'));
  cleanupTargets.push(projectPath);
  await fs.mkdir(path.join(projectPath, '.pipeline', 'docs'), { recursive: true });
  await fs.mkdir(path.join(projectPath, '.pipeline', 'tasks'), { recursive: true });
  await fs.writeFile(path.join(projectPath, '.pipeline', 'docs', 'research_brief.json'), JSON.stringify(briefData));
  await fs.writeFile(path.join(projectPath, '.pipeline', 'tasks', 'tasks.json'), JSON.stringify({ master: { tasks } }));
  return projectPath;
}

async function readTasks(projectPath) {
  return JSON.parse(await fs.readFile(path.join(projectPath, '.pipeline', 'tasks', 'tasks.json'), 'utf8')).master.tasks;
}

afterEach(async () => {
  while (cleanupTargets.length > 0) await fs.rm(cleanupTargets.pop(), { recursive: true, force: true });
});

describe('task ID finalization', () => {
  it('remaps dependencies to final IDs in replace mode with existing tasks', async () => {
    const existing = Array.from({ length: 20 }, (_, index) => ({ id: index + 1, title: `Old ${index + 1}`, status: 'done' }));
    const projectPath = await projectWithTasks(existing);
    await syncTasksWithResearchBrief(projectPath, { mode: 'replace' });
    const tasks = await readTasks(projectPath);
    expect(tasks.map((task) => task.id)).toEqual([21, 22]);
    expect(tasks[1].dependencies).toEqual(['21']);
  });

  it('maps append dependencies to an existing deduplicated blueprint', async () => {
    const projectPath = await projectWithTasks([{
      id: 20, title: 'Collect source', description: 'Collect the source.', status: 'done', sourceBlueprintId: 'source',
    }]);
    await syncTasksWithResearchBrief(projectPath, { mode: 'append' });
    const tasks = await readTasks(projectPath);
    const analysis = tasks.find((task) => task.sourceBlueprintId === 'analysis');
    expect(analysis.dependencies).toEqual(['20']);
    expect(validateTaskGraph(tasks).valid).toBe(true);
  });

  it('maps append dependencies to an existing signature when legacy tasks lack blueprint IDs', async () => {
    const projectPath = await projectWithTasks([{
      id: 20, title: 'Collect source', description: 'Collect the source.', status: 'done', stage: 'literature',
    }]);
    await syncTasksWithResearchBrief(projectPath, { mode: 'append' });
    const tasks = await readTasks(projectPath);
    const analysis = tasks.find((task) => task.sourceBlueprintId === 'analysis');
    expect(analysis.dependencies).toEqual(['20']);
    expect(validateTaskGraph(tasks).valid).toBe(true);
  });

  it('preserves blueprint dependencies in merge mode', async () => {
    const projectPath = await projectWithTasks([{
      id: 10, title: 'Collect source', description: 'Collect the source.', status: 'done', sourceBlueprintId: 'source',
    }]);
    await syncTasksWithResearchBrief(projectPath, { mode: 'merge' });
    const tasks = await readTasks(projectPath);
    const analysis = tasks.find((task) => task.sourceBlueprintId === 'analysis');
    expect(analysis.dependencies).toEqual(['10']);
    expect(validateTaskGraph(tasks).valid).toBe(true);
  });
});

describe('task graph validation', () => {
  it.each([
    ['DEPENDENCY_NOT_FOUND', [{ id: 1, status: 'pending', dependencies: [9] }]],
    ['SELF_DEPENDENCY', [{ id: 1, status: 'pending', dependencies: [1] }]],
    ['DEPENDENCY_CYCLE', [{ id: 1, status: 'pending', dependencies: [2] }, { id: 2, status: 'pending', dependencies: [1] }]],
    ['DUPLICATE_TASK_ID', [{ id: 1, status: 'pending' }, { id: 1, status: 'pending' }]],
    ['MULTIPLE_IN_PROGRESS_TASKS', [{ id: 1, status: 'in-progress' }, { id: 2, status: 'in-progress' }]],
  ])('reports %s', (code, tasks) => {
    expect(validateTaskGraph(tasks).errors.map((error) => error.code)).toContain(code);
  });
});

describe('medical public database research template', () => {
  it('keeps required-field refinement enabled for legacy templates by default', async () => {
    const legacyBrief = brief();
    legacyBrief.pipeline.stages.literature.required_elements = ['sections.literature.core_research_question'];
    const projectPath = await projectWithTasks([], legacyBrief);

    await syncTasksWithResearchBrief(projectPath, { mode: 'replace' });
    const tasks = await readTasks(projectPath);

    expect(tasks.some((task) => task.sourceBlueprintId === 'literature.missing.sections.literature.core_research_question')).toBe(true);
  });

  it('builds the complete compact workflow with app database and figure skills', async () => {
    const templatePath = new URL('../taskmaster-templates/medical-database-research.json', import.meta.url);
    const template = JSON.parse(await fs.readFile(templatePath, 'utf8'));
    const projectPath = await projectWithTasks([], {
      templateId: template.id,
      pipeline: template.pipeline,
      sections: {},
    });

    await syncTasksWithResearchBrief(projectPath, { mode: 'replace' });
    const tasks = await readTasks(projectPath);
    const byBlueprint = new Map(tasks.map((task) => [task.sourceBlueprintId, task]));

    expect(tasks).toHaveLength(19);
    expect(tasks.some((task) => task.sourceBlueprintId.includes('.refine.'))).toBe(false);
    expect(tasks.some((task) => task.sourceBlueprintId.includes('.missing.'))).toBe(false);
    expect(byBlueprint.has('promotion.quality_gate')).toBe(true);
    expect(validateTaskGraph(tasks).valid).toBe(true);

    const discovery = byBlueprint.get('registry_literature_and_asset_map');
    const extraction = byBlueprint.get('registry_build_and_qc');
    const figure = byBlueprint.get('registry_publication_figures');
    expect(discovery.suggestedSkills).toContain('medhelp-database-api-access');
    expect(discovery.description).toContain('three materially different discovery passes');
    expect(extraction.suggestedSkills).toContain('medhelp-database-api-access');
    expect(figure.suggestedSkills).toContain('nature-figure');
    expect(figure.inputsNeeded).toContain('sections.publication.figure_backend');
    expect(figure.expectedArtifacts).toEqual(expect.arrayContaining([
      'Publication/figures/main-figure.svg',
      'Publication/figures/main-figure.pdf',
      'Publication/figures/main-figure.tiff',
      'Publication/figures/main-figure-source-data.csv',
    ]));

    const allSkills = new Set(tasks.flatMap((task) => task.suggestedSkills));
    expect(allSkills.has('dataset-discovery')).toBe(false);
    expect(allSkills.has('ukb-cohort-analysis')).toBe(false);

    const literatureGate = byBlueprint.get('literature.quality_gate');
    const cohortDesign = byBlueprint.get('registry_cohort_design');
    const experimentGate = byBlueprint.get('experiment.quality_gate');
    const figureTask = byBlueprint.get('registry_publication_figures');
    expect(cohortDesign.dependencies).toContain(String(literatureGate.id));
    expect(figureTask.dependencies).toContain(String(experimentGate.id));
  });
});
