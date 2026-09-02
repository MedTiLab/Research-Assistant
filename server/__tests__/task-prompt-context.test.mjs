import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildOutputLocationRule,
  enrichTaskForExecution,
  INDEXED_WORKSPACE_MATERIALS_MARKER,
  loadTaskPromptContext,
  OUTPUT_LOCATION_RULE_MARKER,
  WORKSPACE_MATERIALS_RULE_MARKER,
} from '../pipeline/task-prompt-context.js';

const cleanupTargets = [];

async function createTempProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-task-prompt-'));
  cleanupTargets.push(projectPath);
  return projectPath;
}

async function writeKnowledgeBaseManifest(projectPath, entries) {
  const manifestPath = path.join(projectPath, '.pipeline', 'docs', 'kb', 'manifest.json');
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify({
    version: '1.0',
    projectName: 'test-project',
    generatedAt: new Date().toISOString(),
    entryCount: entries.length,
    sourceBreakdown: {},
    entries,
  }, null, 2)}\n`, 'utf8');
}

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('task prompt context', () => {
  it('injects workspace materials and canonical stage output roots into execution prompts', async () => {
    const projectPath = await createTempProject();
    await writeKnowledgeBaseManifest(projectPath, [
      {
        id: 'file:.pipeline/docs/kb/uploads/clinical-protocol.md',
        sourceType: 'user_upload',
        title: 'Clinical Protocol',
        relativePath: '.pipeline/docs/kb/uploads/clinical-protocol.md',
        updatedAt: '2026-04-14T00:00:00.000Z',
        summary: 'Primary endpoint, inclusion criteria, and the planned subgroup analysis are defined here.',
      },
      {
        id: 'brief:research_brief',
        sourceType: 'research_brief',
        title: 'Research Brief',
        relativePath: '.pipeline/docs/research_brief.json',
        updatedAt: '2026-04-14T00:01:00.000Z',
        summary: 'Evaluate whether the new cohort definition changes the hazard ratio estimates.',
      },
      {
        id: 'file:Experiment/tables/baseline-table.csv',
        sourceType: 'project_report',
        title: 'Baseline Table',
        relativePath: 'Experiment/tables/baseline-table.csv',
        updatedAt: '2026-04-14T00:02:00.000Z',
        summary: 'Baseline characteristics and standardized mean differences.',
      },
    ]);

    const context = await loadTaskPromptContext(projectPath);
    const task = enrichTaskForExecution({
      id: 7,
      title: 'Run adjusted Cox analysis',
      stage: 'experiment',
      nextActionPrompt: 'Task: Run adjusted Cox analysis',
    }, context);

    expect(task.nextActionPrompt).toContain(WORKSPACE_MATERIALS_RULE_MARKER);
    expect(task.nextActionPrompt).toContain(OUTPUT_LOCATION_RULE_MARKER);
    expect(task.nextActionPrompt).toContain('Experiment/core_code');
    expect(task.nextActionPrompt).toContain('Experiment/analysis');
    expect(task.nextActionPrompt).toContain('Experiment/figures');
    expect(task.nextActionPrompt).toContain('Experiment/tables');
    expect(task.nextActionPrompt).toContain('Experiment/attachments');
    expect(task.nextActionPrompt).toContain('generated result figures, charts, plots, and analysis images go to Experiment/figures');
    expect(task.nextActionPrompt).toContain('result tables and table source files go to Experiment/tables');
    expect(task.nextActionPrompt).not.toContain('persist it as a Markdown file under .pipeline/docs/chat-reports');
    expect(task.nextActionPrompt).toContain('Never use hidden folders such as .pipeline/docs/chat-reports');
    expect(task.nextActionPrompt).toContain(INDEXED_WORKSPACE_MATERIALS_MARKER);
    expect(task.nextActionPrompt).toContain('.pipeline/docs/kb/uploads/clinical-protocol.md');
    expect(task.nextActionPrompt).toContain('Primary endpoint, inclusion criteria');
    expect(task.nextActionPrompt).toContain('.pipeline/docs/research_brief.json');
  });

  it('does not duplicate prompt guardrails when they are already present', async () => {
    const projectPath = await createTempProject();
    const context = await loadTaskPromptContext(projectPath);
    const existingPrompt = [
      'Task: Review outputs',
      `${WORKSPACE_MATERIALS_RULE_MARKER} already present.`,
      `${OUTPUT_LOCATION_RULE_MARKER} already present.`,
      `${INDEXED_WORKSPACE_MATERIALS_MARKER} already present.`,
    ].join('\n\n');

    const task = enrichTaskForExecution({
      id: 3,
      title: 'Review outputs',
      stage: 'publication',
      nextActionPrompt: existingPrompt,
    }, context);

    expect(task.nextActionPrompt.match(new RegExp(WORKSPACE_MATERIALS_RULE_MARKER, 'g'))).toHaveLength(1);
    expect(task.nextActionPrompt.match(new RegExp(OUTPUT_LOCATION_RULE_MARKER, 'g'))).toHaveLength(1);
    expect(task.nextActionPrompt.match(new RegExp(INDEXED_WORKSPACE_MATERIALS_MARKER, 'g'))).toHaveLength(1);
  });

  it('routes report guidance to a visible stage directory when stage is missing but the prompt implies literature work', () => {
    const rule = buildOutputLocationRule('', 'Please run a literature review, collect PubMed evidence, and summarize prior work.');

    expect(rule).toContain('Literature/reports');
    expect(rule).not.toContain('<agent-name>');
    expect(rule).not.toContain('persist it as a Markdown file under .pipeline/docs/chat-reports');
    expect(rule).toContain('Never use hidden folders such as .pipeline/docs/chat-reports');
  });

  it('routes publication outputs to the submission package folders', () => {
    const rule = buildOutputLocationRule('publication', 'Draft the manuscript, generate tables and figures, and prepare a cover letter.');

    expect(rule).toContain('Publication/manuscript');
    expect(rule).toContain('Publication/figures');
    expect(rule).toContain('Publication/tables');
    expect(rule).toContain('Publication/supplementary');
    expect(rule).toContain('Use Publication/figures, Publication/tables, or Publication/supplementary only when the user explicitly asks');
    expect(rule).toContain('Do not place routine analysis plots in Publication/figures');
    expect(rule).not.toContain('Publication/paper');
    expect(rule).not.toContain('Publication/attachments');
    expect(rule).not.toContain('Publication/cover_letter');
    expect(rule).not.toContain('Publication/journal_targets');
    expect(rule).not.toContain('<agent-name>');
  });

  it('routes experiment figures away from the publication package by default', () => {
    const rule = buildOutputLocationRule('experiment', 'Run survival analysis and generate Kaplan-Meier plots.');

    expect(rule).toContain('Experiment/figures');
    expect(rule).toContain('result figures, charts, plots, and analysis images to Experiment/figures');
    expect(rule).toContain('result tables and table source files to Experiment/tables');
    expect(rule).toContain('Experiment/attachments');
    expect(rule).toContain('Use Publication/figures, Publication/tables, or Publication/supplementary only when the user explicitly asks');
  });
});
