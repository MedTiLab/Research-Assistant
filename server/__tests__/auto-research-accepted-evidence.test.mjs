import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  findMissingAcceptedDependencies,
  loadAcceptedDependencyEvidence,
} from '../pipeline/accepted-evidence.js';
import { hashFile, hashTaskDefinition } from '../pipeline/hash-utils.js';

const cleanupTargets = [];

async function createProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-accepted-evidence-'));
  cleanupTargets.push(projectPath);
  return projectPath;
}

async function writeAcceptedTask(projectPath, runId, task, specHash, artifactPath, overrides = {}) {
  const absoluteArtifactPath = path.join(projectPath, artifactPath);
  await fs.mkdir(path.dirname(absoluteArtifactPath), { recursive: true });
  await fs.writeFile(absoluteArtifactPath, `accepted evidence for task ${task.id}`);
  const stats = await fs.stat(absoluteArtifactPath);
  const taskHash = hashTaskDefinition(task);
  const taskDir = path.join(projectPath, '.pipeline', 'runs', runId, 'tasks', String(task.id));
  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(path.join(taskDir, 'evidence-manifest.json'), JSON.stringify({
    status: 'submitted', runId, taskId: String(task.id), taskHash, specHash,
    artifacts: [{
      relativePath: artifactPath,
      sha256: await hashFile(absoluteArtifactPath),
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      taskId: String(task.id),
    }],
    ...overrides.manifest,
  }));
  await fs.writeFile(path.join(taskDir, 'verification.json'), JSON.stringify({
    status: 'active', verdict: 'pass', runId, taskId: String(task.id), taskHash, specHash,
    summary: `Task ${task.id} accepted.`, acceptedArtifacts: [artifactPath],
    verifiedAt: overrides.verifiedAt || new Date().toISOString(),
    ...overrides.verification,
  }));
}

afterEach(async () => {
  while (cleanupTargets.length > 0) await fs.rm(cleanupTargets.pop(), { recursive: true, force: true });
});

describe('accepted dependency evidence boundary', () => {
  it('loads only verifier-pass evidence in the transitive dependency closure across runs', async () => {
    const projectPath = await createProject();
    const tasks = [
      { id: 1, title: 'Source', status: 'done', dependencies: [] },
      { id: 2, title: 'Analysis', status: 'done', dependencies: [1] },
      { id: 3, title: 'Synthesis', status: 'pending', dependencies: [2] },
      { id: 4, title: 'Unrelated', status: 'done', dependencies: [] },
    ];
    await writeAcceptedTask(projectPath, 'prior-run', tasks[0], 'sha256:spec', 'Literature/source.md');
    await writeAcceptedTask(projectPath, 'current-run', tasks[1], 'sha256:spec', 'Experiment/analysis.md');
    await writeAcceptedTask(projectPath, 'current-run', tasks[3], 'sha256:spec', 'Publication/unrelated.md');

    const accepted = await loadAcceptedDependencyEvidence(projectPath, {
      runId: 'current-run', currentTask: tasks[2], tasks, specHash: 'sha256:spec',
    });

    expect(accepted.map((entry) => entry.taskId).sort()).toEqual(['1', '2']);
    expect(findMissingAcceptedDependencies(tasks[2], tasks, accepted)).toEqual([]);
    expect(accepted.flatMap((entry) => entry.acceptedArtifacts).map((entry) => entry.relativePath))
      .not.toContain('Publication/unrelated.md');
  });

  it('rejects stale-spec, invalidated, and mutated artifacts', async () => {
    const projectPath = await createProject();
    const tasks = [
      { id: 1, title: 'Source', status: 'done', dependencies: [] },
      { id: 2, title: 'Analysis', status: 'done', dependencies: [1] },
      { id: 3, title: 'Synthesis', status: 'pending', dependencies: [2] },
    ];
    await writeAcceptedTask(projectPath, 'run-1', tasks[0], 'sha256:old-spec', 'Literature/source.md');
    await writeAcceptedTask(projectPath, 'run-1', tasks[1], 'sha256:spec', 'Experiment/analysis.md', {
      verification: { status: 'invalidated' },
    });
    await fs.writeFile(path.join(projectPath, 'Experiment', 'analysis.md'), 'mutated after verification');

    const accepted = await loadAcceptedDependencyEvidence(projectPath, {
      runId: 'run-1', currentTask: tasks[2], tasks, specHash: 'sha256:spec',
    });

    expect(accepted).toEqual([]);
    expect(findMissingAcceptedDependencies(tasks[2], tasks, accepted).sort()).toEqual(['1', '2']);
  });
});
