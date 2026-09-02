import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { buildResearchAwarePromptPrefix } from '../execution-memory/lessons.js';
import { buildTaskEnvelope, readTaskEnvelope, writeTaskEnvelope } from '../pipeline/task-envelope.js';

const cleanupTargets = [];

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    await fs.rm(cleanupTargets.pop(), { recursive: true, force: true });
  }
});

describe('Auto Research task context', () => {
  it('injects the complete task envelope and frozen Research Spec', async () => {
    const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-auto-task-context-'));
    cleanupTargets.push(projectPath);
    const longDescription = `Start:${' clinical detail'.repeat(180)}:End`;
    const researchSpec = {
      specVersion: 3,
      specHash: 'sha256:frozen',
      canonicalQuestion: 'Does biomarker X predict 30-day mortality in ICU adults?',
      population: { setting: 'ICU adults', timeZero: 'admission', followUp: '30 days' },
      primaryOutcome: { name: '30-day mortality' },
      dataSource: { name: 'MIMIC-IV' },
      studyDesign: 'retrospective cohort',
      estimand: 'adjusted hazard ratio',
    };
    const task = {
      id: 12,
      title: 'Run pre-analysis',
      description: longDescription,
      status: 'in-progress',
      stage: 'experiment',
      dependencies: ['10', '11'],
      inputsNeeded: ['sections.experiment.dataset_or_data_source'],
      suggestedSkills: ['clinical-preanalysis'],
      testStrategy: 'Report N, events, missingness, and model formula.',
      acceptanceCriteria: [{ code: 'COHORT_COUNTS_REPORTED', required: true }],
      expectedArtifacts: ['Experiment/analysis/preanalysis-report.md'],
      allowedOutputRoots: ['Experiment/analysis'],
      acceptedInputFiles: ['Experiment/datasets/cohort.csv'],
      verificationMode: 'strict',
      maxAttempts: 4,
      maxVerificationAttempts: 2,
      nextActionPrompt: 'Run the frozen pre-analysis plan.',
    };
    const envelope = buildTaskEnvelope({ task, runId: 'run-context', researchSpec, actor: 'executor' });
    await writeTaskEnvelope(projectPath, 'run-context', envelope);
    const storedEnvelope = await readTaskEnvelope(projectPath, 'run-context', '12');
    const prompt = await buildResearchAwarePromptPrefix(
      { scope: 'run', projectPath, runId: 'run-context', provider: 'codex', stage: 'experiment' },
      task.nextActionPrompt,
      {
        taskContext: storedEnvelope,
        researchSpec,
        includeExecutionMemory: false,
      },
    );

    expect(prompt).toContain('<research_spec>');
    expect(prompt).toContain('Priority: research_spec > task_context > execution_memory.');
    expect(prompt).toContain('<task_context>');
    expect(prompt).toContain('Task ID: 12');
    expect(prompt).toContain(':End');
    expect(prompt).toContain('Dependencies: 10, 11');
    expect(prompt).toContain('Acceptance criteria: {"code":"COHORT_COUNTS_REPORTED","required":true}');
    expect(prompt).toContain('Expected artifacts: Experiment/analysis/preanalysis-report.md');
    expect(prompt).toContain('Accepted input files: Experiment/datasets/cohort.csv');
    expect(prompt).toContain('Verification mode: strict');
    expect(prompt).toContain('Maximum attempts: 4');
    expect(envelope.sessionIsolation).toBe('new-session-per-task');
  });
});
