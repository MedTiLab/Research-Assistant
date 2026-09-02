import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { writeAutoResearchRunJson } from '../pipeline/run-files.js';
import {
  buildAutoResearchResumeMetadata,
  buildAutoResearchResumeState,
  loadAutoResearchResumeState,
} from '../pipeline/resume.js';
import { hashJson, hashTaskDefinition, hashTasksDefinition } from '../pipeline/hash-utils.js';
import { computeResearchSpecHash } from '../pipeline/research-spec.js';

const cleanupTargets = [];

async function createTempProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-resume-'));
  cleanupTargets.push(projectPath);
  return projectPath;
}

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('auto-research resume state', () => {
  it('loads a resumable state when checkpoint matches the current next task', async () => {
    const projectPath = await createTempProject();
    const run = {
      id: 'run-resume-1',
      project_path: projectPath,
      status: 'failed',
      metadata: { autoResearchModelPolicyHash: 'sha256:model-policy' },
    };
    const nextTask = { id: 'task-2', title: 'Run experiment', status: 'pending', stage: 'experiment' };
    const tasks = [
      { id: 'task-1', title: 'Literature refs', status: 'done', stage: 'literature' },
      nextTask,
    ];
    const researchSpec = {
      schemaVersion: '2.0',
      specVersion: 1,
      status: 'approved',
      templateId: '',
    };
    researchSpec.specHash = computeResearchSpecHash(researchSpec);
    const specHash = researchSpec.specHash;
    await fs.mkdir(path.join(projectPath, '.pipeline', 'docs'), { recursive: true });
    await fs.mkdir(path.join(projectPath, '.pipeline', 'tasks'), { recursive: true });
    await fs.writeFile(path.join(projectPath, '.pipeline', 'docs', 'research_spec.json'), JSON.stringify(researchSpec));
    const tasksContent = JSON.stringify({ master: { tasks } });
    await fs.writeFile(path.join(projectPath, '.pipeline', 'tasks', 'tasks.json'), tasksContent);
    const { sha256 } = await import('../pipeline/hash-utils.js');
    await writeAutoResearchRunJson(projectPath, run.id, 'checkpoint.json', {
      nextTaskId: 'task-2',
      nextTaskTitle: 'Run experiment',
      nextStage: 'experiment',
      lastCompletedTaskId: null,
      lastCompletedTaskTitle: null,
      researchSpecHash: specHash,
      nextTaskHash: hashTaskDefinition(nextTask),
      tasksFileHash: sha256(tasksContent),
      tasksDefinitionHash: hashTasksDefinition(tasks),
      acceptedInputHashes: {},
      datasetSnapshotHash: hashJson({}),
      promptTemplateVersion: 'auto-research-v2.1',
      codeCommit: 'workspace:0.1.1',
      modelPolicyHash: 'sha256:model-policy',
      timestamp: '2026-04-04T00:00:00.000Z',
    });

    const pipelineState = {
      tasksValid: true,
      actionableTaskCount: 1,
      tasks,
      nextTask,
    };

    const resume = await loadAutoResearchResumeState({
      run,
      pipelineState,
    });

    expect(resume.available).toBe(true);
    expect(resume.nextTaskId).toBe('task-2');
    expect(resume.nextStage).toBe('experiment');
    expect(resume.summary).toContain('Run experiment');
  });

  it('rejects resume when checkpoint and current pipeline next task diverge', () => {
    const resume = buildAutoResearchResumeState({
      run: {
        id: 'run-resume-2',
        status: 'cancelled',
      },
      runTracking: {
        checkpoint: {
          nextTaskId: 'task-3',
          nextTaskTitle: 'Write paper',
        },
      },
      pipelineState: {
        tasksValid: true,
        actionableTaskCount: 1,
        tasks: [
          { id: 'task-4', title: 'Make slides', status: 'pending', stage: 'promotion' },
        ],
        nextTask: { id: 'task-4', title: 'Make slides', status: 'pending', stage: 'promotion' },
      },
    });

    expect(resume.available).toBe(false);
    expect(resume.reason).toBe('task_order_changed');
    expect(resume.code).toBe('TASK_ORDER_CHANGED');
  });

  it('rejects non-resumable run statuses', () => {
    const resume = buildAutoResearchResumeState({
      run: {
        id: 'run-resume-3',
        status: 'completed',
      },
      runTracking: {
        checkpoint: {
          nextTaskId: 'task-2',
        },
      },
      pipelineState: {
        tasksValid: true,
        actionableTaskCount: 1,
        tasks: [
          { id: 'task-2', title: 'Run experiment', status: 'pending', stage: 'experiment' },
        ],
        nextTask: { id: 'task-2', title: 'Run experiment', status: 'pending', stage: 'experiment' },
      },
    });

    expect(resume.available).toBe(false);
    expect(resume.reason).toBe('run_not_resumable');
  });

  it.each([
    {
      label: 'Research Spec',
      checkpoint: { researchSpecHash: 'sha256:old-spec', nextTaskHash: 'sha256:task' },
      current: { researchSpecHash: 'sha256:new-spec', nextTaskHash: 'sha256:task' },
      code: 'SPEC_HASH_MISMATCH',
    },
    {
      label: 'task body',
      checkpoint: { researchSpecHash: 'sha256:spec', nextTaskHash: 'sha256:old-task' },
      current: { researchSpecHash: 'sha256:spec', nextTaskHash: 'sha256:new-task' },
      code: 'TASK_HASH_MISMATCH',
    },
  ])('rejects resume when the $label hash changes', ({ checkpoint, current, code }) => {
    const nextTask = { id: 'task-2', title: 'Run experiment', status: 'pending', stage: 'experiment' };
    const resume = buildAutoResearchResumeState({
      run: { id: 'run-hash', status: 'failed' },
      pipelineState: {
        tasksValid: true,
        actionableTaskCount: 1,
        tasks: [nextTask],
        nextTask,
      },
      runTracking: {
        checkpoint: {
          nextTaskId: 'task-2',
          tasksFileHash: 'sha256:tasks',
          tasksDefinitionHash: 'sha256:definitions',
          ...checkpoint,
        },
      },
      currentIntegrity: {
        tasksFileHash: 'sha256:tasks',
        tasksDefinitionHash: 'sha256:definitions',
        acceptedInputHashes: {},
        ...current,
      },
    });

    expect(resume.available).toBe(false);
    expect(resume.code).toBe(code);
  });
});

describe('auto-research resume metadata', () => {
  it('increments resume count and records checkpoint provenance', () => {
    const metadata = buildAutoResearchResumeMetadata({
      existingMetadata: {
        mode: 'auto_research_v1',
        autoResearchResume: {
          resumeCount: 1,
        },
      },
      resumeState: {
        status: 'failed',
        checkpoint: {
          timestamp: '2026-04-04T00:00:00.000Z',
          nextTaskId: 'task-2',
          nextStage: 'experiment',
        },
      },
      provider: 'codex',
      model: 'gpt-5.4',
      permissionMode: 'bypassPermissions',
      resumedAt: '2026-04-04T01:00:00.000Z',
    });

    expect(metadata.autoResearchModel).toBe('gpt-5.4');
    expect(metadata.autoResearchPermissionMode).toBe('bypassPermissions');
    expect(metadata.autoResearchResume.resumeCount).toBe(2);
    expect(metadata.autoResearchResume.resumedFromStatus).toBe('failed');
    expect(metadata.autoResearchResume.checkpointNextTaskId).toBe('task-2');
  });
});
