import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { hashFile, hashTaskDefinition } from '../pipeline/hash-utils.js';
import {
  parseVerifierOutput,
  transitionTaskStatus,
  verifyTaskIndependently,
} from '../pipeline/task-verifier.js';

const cleanupTargets = [];

async function createProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-task-verifier-'));
  cleanupTargets.push(projectPath);
  await fs.mkdir(path.join(projectPath, '.pipeline', 'tasks'), { recursive: true });
  await fs.writeFile(path.join(projectPath, '.pipeline', 'tasks', 'tasks.json'), JSON.stringify({
    master: { tasks: [{ id: 1, title: 'Analyze cohort', status: 'review', stage: 'experiment', details: 'Locked details' }] },
  }));
  return projectPath;
}

async function validFixture(projectPath, overrides = {}) {
  const task = {
    id: 1,
    title: 'Analyze cohort',
    status: 'review',
    stage: 'experiment',
    details: 'Locked details',
    dependencies: [],
    acceptanceCriteria: [
      { id: 'report_exists', type: 'file_exists', target: 'Experiment/analysis/report.md', required: true },
      { id: 'alignment', type: 'spec_alignment', required: true },
    ],
    expectedArtifacts: ['Experiment/analysis/report.md'],
    allowedOutputRoots: ['Experiment/analysis'],
    ...overrides.task,
  };
  const reportPath = path.join(projectPath, 'Experiment', 'analysis', 'report.md');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  const startedAt = new Date(Date.now() - 2_000).toISOString();
  await fs.writeFile(reportPath, '# Report\n\nValidated cohort result.');
  const stats = await fs.stat(reportPath);
  const taskHash = hashTaskDefinition(task);
  const taskEnvelope = {
    taskId: '1', taskHash, specHash: 'sha256:spec', specVersion: 2,
    acceptanceCriteria: task.acceptanceCriteria,
    expectedArtifacts: task.expectedArtifacts,
    allowedOutputRoots: task.allowedOutputRoots,
    noArtifactExpected: false,
  };
  const evidenceManifest = {
    schemaVersion: '2.0', status: 'submitted', runId: 'run-1', taskId: '1', taskHash,
    specHash: 'sha256:spec', executorSessionId: 'executor-session', startedAt,
    finishedAt: new Date().toISOString(),
    artifacts: [{
      relativePath: 'Experiment/analysis/report.md',
      sha256: await hashFile(reportPath),
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      sourceTool: 'Write',
      taskId: '1',
    }],
    structuredFindings: [],
    ...overrides.evidenceManifest,
  };
  return {
    task,
    taskEnvelope,
    evidenceManifest,
    researchSpec: { schemaVersion: '2.0', specVersion: 2, specHash: 'sha256:spec' },
    integrityResult: { pass: true, protectedFileChanges: [], drift: [] },
  };
}

function passingSemantic(sessionId = 'verifier-session', overrides = {}) {
  return {
    sessionId,
    stageTagSource: 'auto_research_verifier',
    createdAt: new Date().toISOString(),
    integrityResult: { pass: true, protectedFileChanges: [], drift: [] },
    output: {
      verdict: 'pass',
      summary: 'Passed.',
      checks: [{ code: 'SPEC_ALIGNMENT', criterionId: 'alignment', status: 'pass', detail: 'Aligned.', evidence: ['report.md'] }],
      drift: [],
      requiredCorrections: [],
      acceptedArtifacts: ['Experiment/analysis/report.md'],
      ...overrides,
    },
  };
}

afterEach(async () => {
  while (cleanupTargets.length > 0) await fs.rm(cleanupTargets.pop(), { recursive: true, force: true });
});

describe('independent task verifier', () => {
  it('rejects invalid or unstructured verifier output', () => {
    expect(parseVerifierOutput('Looks good, passed.')).toBeNull();
    expect(parseVerifierOutput('{"verdict":"pass","checks":[]}')).toBeNull();
  });

  it('blocks instead of passing when semantic JSON is invalid', async () => {
    const projectPath = await createProject();
    const fixture = await validFixture(projectPath);
    const result = await verifyTaskIndependently({
      projectPath, runId: 'run-1', tasks: [fixture.task], ...fixture,
      semanticVerify: async () => ({
        output: 'passed', sessionId: 'verifier-session', stageTagSource: 'auto_research_verifier',
        createdAt: new Date().toISOString(), integrityResult: { pass: true, protectedFileChanges: [], drift: [] },
      }),
    });
    expect(result.verdict).toBe('block');
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'VERIFIER_OUTPUT_INVALID', status: 'fail' }),
    ]));
  });

  it('enforces actor-specific status transitions without mutating immutable details', async () => {
    const projectPath = await createProject();
    await expect(transitionTaskStatus(projectPath, 1, 'done', { actor: 'executor' }))
      .rejects.toMatchObject({ code: 'TASK_TRANSITION_FORBIDDEN' });
    const updated = await transitionTaskStatus(projectPath, 1, 'done', {
      actor: 'verifier', runId: 'run-2', detail: 'Independent verification passed.',
    });
    expect(updated.status).toBe('done');
    expect(updated.details).toBe('Locked details');
    expect(updated.executionState.evidenceSummary).toContain('passed');
  });

  it('blocks missing or reused session identities', async () => {
    const projectPath = await createProject();
    const fixture = await validFixture(projectPath);
    const missing = await verifyTaskIndependently({
      projectPath, runId: 'run-missing-session', tasks: [fixture.task], ...fixture,
      semanticVerify: async () => ({ ...passingSemantic(), sessionId: null }),
    });
    expect(missing.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'VERIFIER_SESSION_INDEPENDENT', status: 'fail' }),
    ]));
    const reused = await verifyTaskIndependently({
      projectPath, runId: 'run-same-session', tasks: [fixture.task], ...fixture,
      semanticVerify: async () => passingSemantic('executor-session'),
    });
    expect(reused.verdict).toBe('block');
  });

  it.each([
    ['semantic drift', { drift: [{ field: 'primaryOutcome' }] }],
    ['required corrections', { requiredCorrections: ['Fix model'] }],
  ])('blocks pass with %s', async (_, semanticOverride) => {
    const projectPath = await createProject();
    const fixture = await validFixture(projectPath);
    const result = await verifyTaskIndependently({
      projectPath, runId: 'run-strict-pass', tasks: [fixture.task], ...fixture,
      semanticVerify: async () => passingSemantic('verifier-session', semanticOverride),
    });
    expect(result.verdict).toBe('block');
  });

  it('blocks artifact mutation after evidence submission', async () => {
    const projectPath = await createProject();
    const fixture = await validFixture(projectPath);
    await fs.appendFile(path.join(projectPath, 'Experiment', 'analysis', 'report.md'), '\nchanged');
    const result = await verifyTaskIndependently({
      projectPath, runId: 'run-mutated', tasks: [fixture.task], ...fixture,
      semanticVerify: async () => passingSemantic(),
    });
    expect(result.verdict).toBe('block');
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'EVIDENCE_ARTIFACT_HASH_MATCH', status: 'fail' }),
    ]));
  });

  it('does not pass an empty acceptance and evidence contract', async () => {
    const projectPath = await createProject();
    const fixture = await validFixture(projectPath, {
      task: { acceptanceCriteria: [], expectedArtifacts: [] },
      evidenceManifest: { artifacts: [], createdArtifacts: [] },
    });
    fixture.taskEnvelope.acceptanceCriteria = [];
    fixture.taskEnvelope.expectedArtifacts = [];
    const result = await verifyTaskIndependently({
      projectPath, runId: 'run-empty', tasks: [fixture.task], ...fixture,
      semanticVerify: async () => passingSemantic(),
    });
    expect(result.verdict).toBe('block');
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'ACCEPTANCE_CONTRACT_PRESENT', status: 'fail' }),
      expect.objectContaining({ code: 'EVIDENCE_NON_EMPTY', status: 'fail' }),
    ]));
  });
});
