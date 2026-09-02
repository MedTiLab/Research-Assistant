import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { readPipelineState } from '../pipeline/state.js';

const cleanupTargets = [];

async function createTempProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-pipeline-state-'));
  cleanupTargets.push(projectPath);
  return projectPath;
}

async function writeTasks(projectPath, tasks) {
  const tasksPath = path.join(projectPath, '.pipeline', 'tasks', 'tasks.json');
  await fs.mkdir(path.dirname(tasksPath), { recursive: true });
  await fs.writeFile(tasksPath, `${JSON.stringify({ master: { tasks } }, null, 2)}\n`, 'utf8');
}

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('pipeline state', () => {
  it('treats review tasks as actionable and prefers them as the next task after in-progress work', async () => {
    const projectPath = await createTempProject();
    await writeTasks(projectPath, [
      { id: 1, title: 'Completed task', status: 'done', stage: 'literature' },
      { id: 2, title: 'Review quality gate', status: 'review', stage: 'publication' },
      { id: 3, title: 'Pending task', status: 'pending', stage: 'promotion' },
    ]);

    const state = await readPipelineState(projectPath);

    expect(state.actionableTaskCount).toBe(2);
    expect(state.nextTaskKind).toBe('verify');
    expect(state.nextReviewTask.id).toBe(2);
    expect(state.nextTask).toMatchObject({
      id: 2,
      status: 'review',
      title: 'Review quality gate',
    });
  });

  it('preserves complete and unknown task fields', async () => {
    const projectPath = await createTempProject();
    await writeTasks(projectPath, [{
      id: 7,
      title: 'Run pre-analysis',
      description: 'Assess cohort support.',
      status: 'pending',
      dependencies: [2, '6'],
      details: 'Detailed protocol',
      test_strategy: 'Check cohort counts',
      inputsNeeded: ['sections.experiment.dataset_or_data_source'],
      suggestedSkills: ['clinical-preanalysis'],
      acceptanceCriteria: [{ code: 'COUNTS_REPORTED', required: true }],
      expectedArtifacts: ['Experiment/analysis/preanalysis-report.md'],
      allowedOutputRoots: ['Experiment/analysis'],
      customFutureField: { keep: true },
    }]);

    const state = await readPipelineState(projectPath);

    expect(state.tasks[0]).toMatchObject({
      description: 'Assess cohort support.',
      dependencies: ['2', '6'],
      details: 'Detailed protocol',
      testStrategy: 'Check cohort counts',
      inputsNeeded: ['sections.experiment.dataset_or_data_source'],
      suggestedSkills: ['clinical-preanalysis'],
      acceptanceCriteria: [{ code: 'COUNTS_REPORTED', required: true }],
      expectedArtifacts: ['Experiment/analysis/preanalysis-report.md'],
      allowedOutputRoots: ['Experiment/analysis'],
      customFutureField: { keep: true },
    });
  });

  it('skips tasks whose dependencies are unresolved', async () => {
    const projectPath = await createTempProject();
    await writeTasks(projectPath, [
      { id: 1, title: 'Build cohort', status: 'pending', stage: 'experiment' },
      { id: 2, title: 'Run model', status: 'pending', stage: 'experiment', dependencies: [1] },
    ]);

    const state = await readPipelineState(projectPath);

    expect(state.nextExecutionTask.id).toBe(1);
    expect(state.blockedTasks).toEqual([
      expect.objectContaining({ id: 2, unresolvedDependencies: ['1'] }),
    ]);
  });

  it('does not schedule a quality gate for execution and waits for prior stage tasks', async () => {
    const projectPath = await createTempProject();
    await writeTasks(projectPath, [
      { id: 1, title: 'Build cohort', status: 'done', stage: 'experiment' },
      { id: 2, title: 'Run model', status: 'done', stage: 'experiment' },
      {
        id: 3,
        title: 'Review Experiment quality gate',
        status: 'pending',
        stage: 'experiment',
        sourceBlueprintId: 'experiment.quality_gate',
      },
    ]);

    const state = await readPipelineState(projectPath);

    expect(state.nextExecutionTask).toBeNull();
    expect(state.nextReviewTask.id).toBe(3);
    expect(state.nextTaskKind).toBe('verify');
  });
});
