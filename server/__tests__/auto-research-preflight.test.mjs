import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { readPipelineState } from '../pipeline/state.js';
import { isModelValidForProvider, runAutoResearchPreflight } from '../pipeline/preflight.js';

const cleanupTargets = [];

async function createTempProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-auto-research-'));
  cleanupTargets.push(projectPath);
  return projectPath;
}

async function writePipelineFiles(projectPath, { researchBrief, tasks }) {
  await fs.mkdir(path.join(projectPath, '.pipeline', 'docs'), { recursive: true });
  await fs.mkdir(path.join(projectPath, '.pipeline', 'tasks'), { recursive: true });

  if (researchBrief !== undefined) {
    await fs.writeFile(
      path.join(projectPath, '.pipeline', 'docs', 'research_brief.json'),
      typeof researchBrief === 'string' ? researchBrief : JSON.stringify(researchBrief, null, 2),
      'utf8',
    );
  }

  if (tasks !== undefined) {
    await fs.writeFile(
      path.join(projectPath, '.pipeline', 'tasks', 'tasks.json'),
      typeof tasks === 'string' ? tasks : JSON.stringify(tasks, null, 2),
      'utf8',
    );
  }
}

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('auto-research pipeline state', () => {
  it('does not throw when tasks.json is invalid and reports a parse error instead', async () => {
    const projectPath = await createTempProject();
    await writePipelineFiles(projectPath, {
      researchBrief: { title: 'Valid brief' },
      tasks: '{"tasks": [',
    });

    const state = await readPipelineState(projectPath);

    expect(state.hasResearchBrief).toBe(true);
    expect(state.researchBriefValid).toBe(true);
    expect(state.hasTasksFile).toBe(true);
    expect(state.tasksValid).toBe(false);
    expect(state.tasks).toEqual([]);
    expect(state.tasksError).toBeTruthy();
  });
});

describe('auto-research preflight', () => {
  it('returns fail when critical pipeline inputs are invalid', async () => {
    const projectPath = await createTempProject();
    await writePipelineFiles(projectPath, {
      researchBrief: { title: 'Valid brief' },
      tasks: '{"tasks": [',
    });

    const pipelineState = await readPipelineState(projectPath);
    const report = await runAutoResearchPreflight({
      userId: 'user-1',
      profile: {},
      projectPath,
      provider: 'codex',
      model: 'gpt-5.4',
      pipelineState,
      env: { OPENAI_API_KEY: 'test-key' },
      mailConfig: {},
    });

    expect(report.overall).toBe('fail');
    expect(report.blockingChecks.map((check) => check.name)).toEqual(
      expect.arrayContaining(['notification_email', 'tasks_file', 'actionable_tasks']),
    );
  });

  it('returns warn when the run can start but email delivery settings are incomplete', async () => {
    const projectPath = await createTempProject();
    await writePipelineFiles(projectPath, {
      researchBrief: { title: 'Valid brief' },
      tasks: {
        tasks: [
          {
            id: 'task-1',
            title: 'Run literature',
            status: 'pending',
            stage: 'literature',
            nextActionPrompt: 'Do the next literature step.',
          },
        ],
      },
    });

    const pipelineState = await readPipelineState(projectPath);
    const report = await runAutoResearchPreflight({
      userId: 'user-1',
      profile: { notification_email: 'research@example.com' },
      projectPath,
      provider: 'codex',
      model: 'gpt-5.4',
      pipelineState,
      env: { OPENAI_API_KEY: 'test-key' },
      mailConfig: {},
    });

    expect(report.overall).toBe('warn');
    expect(report.blockingChecks).toEqual([]);
    expect(report.warningChecks.map((check) => check.name)).toEqual(
      expect.arrayContaining(['mail_sender', 'mail_delivery']),
    );
  });

  it('validates model compatibility by provider', () => {
    expect(isModelValidForProvider('codex', 'gpt-5.4')).toBe(true);
    expect(isModelValidForProvider('codex', 'anthropic/claude-sonnet-4')).toBe(false);
    expect(isModelValidForProvider('claude', 'custom/provider-model')).toBe(false);
  });

  it('blocks an incomplete medical Research Spec before freezing it', async () => {
    const projectPath = await createTempProject();
    await writePipelineFiles(projectPath, {
      researchBrief: {
        templateId: 'medical-database-research',
        meta: { title: 'Incomplete clinical study' },
      },
      tasks: {
        tasks: [{
          id: 'task-1',
          title: 'Run analysis',
          status: 'pending',
          stage: 'experiment',
          nextActionPrompt: 'Run analysis.',
        }],
      },
    });
    const pipelineState = await readPipelineState(projectPath);
    const report = await runAutoResearchPreflight({
      userId: 'user-1',
      profile: { notification_email: 'research@example.com' },
      projectPath,
      provider: 'codex',
      model: 'gpt-5.4',
      pipelineState,
      env: { OPENAI_API_KEY: 'test-key' },
      mailConfig: {},
    });

    expect(report.overall).toBe('fail');
    expect(report.blockingChecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'research_spec' }),
    ]));
    await expect(fs.access(path.join(projectPath, '.pipeline', 'docs', 'research_spec.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
