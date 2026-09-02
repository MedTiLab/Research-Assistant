import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildResearchAwarePromptPrefix,
  deleteResearchLesson,
  readResearchLessons,
  upsertManualResearchLesson,
} from '../execution-memory/lessons.js';

async function seedLessonsFile(projectPath, items) {
  const docsDir = path.join(projectPath, '.pipeline', 'docs');
  await fs.mkdir(docsDir, { recursive: true });
  await fs.writeFile(
    path.join(docsDir, 'research_lessons.json'),
    `${JSON.stringify({ version: 1, updatedAt: null, items }, null, 2)}\n`,
    'utf8',
  );
  return docsDir;
}

function autoLesson(index, overrides = {}) {
  return {
    id: `legacy-${index}`,
    slug: `legacy-auto-${index}`,
    title: `Legacy auto rule ${index}`,
    category: 'data-qc',
    status: 'candidate',
    source: 'auto',
    severity: 'high',
    summary: 'Generic guidance.',
    trigger: 'always',
    correctPattern: 'Check everything.',
    stageHints: ['experiment'],
    timesSeen: 9,
    ...overrides,
  };
}

const cleanupTargets = [];

async function createTempProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-research-lessons-'));
  cleanupTargets.push(projectPath);
  return projectPath;
}

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('research lessons', () => {
  it('purges auto-captured lessons from disk on read and keeps hand-written ones', async () => {
    const projectPath = await createTempProject();
    const docsDir = await seedLessonsFile(projectPath, [autoLesson(0), autoLesson(1)]);

    await upsertManualResearchLesson(projectPath, {
      title: 'Drop the pilot batch',
      trigger: 'assembling the analysis cohort',
      correctPattern: 'Exclude batch 0, its assay calibration drifted.',
      stageHints: ['experiment'],
    });

    const state = await readResearchLessons(projectPath);
    expect(state.items).toHaveLength(1);
    expect(state.items[0].title).toBe('Drop the pilot batch');
    expect(state.items[0].source).toBe('manual');

    const rawJson = await fs.readFile(path.join(docsDir, 'research_lessons.json'), 'utf8');
    expect(rawJson).not.toContain('legacy-auto-0');
    expect(rawJson).toContain('Drop the pilot batch');

    const markdown = await fs.readFile(path.join(docsDir, 'research_lessons.md'), 'utf8');
    expect(markdown).not.toContain('Legacy auto rule');
    expect(markdown).toContain('Drop the pilot batch');
  });

  it('never puts lessons into the prompt: they are a file the user owns, not hidden context', async () => {
    const projectPath = await createTempProject();

    await upsertManualResearchLesson(projectPath, {
      title: 'Reverse CESD items before summing',
      trigger: 'building the CESD-10 score from CHARLS',
      correctPattern: 'Reverse items 5 and 8 before summing.',
      severity: 'high',
    });

    const prompt = await buildResearchAwarePromptPrefix(
      { scope: 'session', projectPath, provider: 'claude', sessionId: 'sess-no-inject', stage: 'experiment' },
      'Continue the analysis.',
      { includeExecutionMemory: false },
    );

    expect(prompt).not.toContain('<research_lessons>');
    expect(prompt).not.toContain('Reverse CESD items before summing');
    expect(prompt).toContain('User request:\nContinue the analysis.');

    // The lesson is still on disk, untouched, for the user to read and edit.
    const state = await readResearchLessons(projectPath);
    expect(state.items).toHaveLength(1);
    expect(state.items[0].title).toBe('Reverse CESD items before summing');
  });

  it('injects task context and execution memory for Codex by default', async () => {
    const projectPath = await createTempProject();
    const sessionId = 'codex-task-context-session';
    const sessionDir = path.join(projectPath, '.pipeline', 'sessions', sessionId);
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionDir, 'microtasks.json'),
      `${JSON.stringify({
        version: 1,
        scope: 'session',
        sessionId,
        provider: 'codex',
        currentObjective: 'Finish the current Cox analysis task.',
        currentTaskId: '7',
        currentTaskTitle: 'Run Cox model',
        stage: 'experiment',
        items: [
          { id: 'm1', title: 'Prepare survival dataset', status: 'completed' },
          { id: 'm2', title: 'Fit adjusted Cox model', status: 'pending' },
        ],
      }, null, 2)}\n`,
      'utf8',
    );

    const prompt = await buildResearchAwarePromptPrefix(
      {
        scope: 'session',
        projectPath,
        provider: 'codex',
        sessionId,
        stage: 'experiment',
      },
      '继续执行。',
      {
        taskContext: {
          id: '7',
          title: 'Run Cox model',
          stage: 'experiment',
          status: 'in-progress',
          priority: 'high',
          description: 'Fit adjusted survival models and report hazard ratios.',
          details: 'Use the cleaned cohort and save a Markdown task report.',
          testStrategy: 'Verify sample size and proportional hazards diagnostics.',
          nextActionPrompt: 'Run the adjusted Cox model, write outputs, and update task bookkeeping.',
          whyNext: 'This task is already in progress and should be finished first.',
          requiredInputs: ['cohort_definition', 'covariate_set'],
          suggestedSkills: ['data-stats-analysis', 'statistical-analysis'],
          dependencies: ['6'],
        },
      },
    );

    expect(prompt).toContain('<task_context>');
    expect(prompt).toContain('Task ID: 7');
    expect(prompt).toContain('Why this task is next: This task is already in progress');
    expect(prompt).toContain('Next action prompt: Run the adjusted Cox model');
    expect(prompt).toContain('Required inputs: cohort_definition, covariate_set');
    expect(prompt).toContain('<execution_memory>');
    expect(prompt).toContain('Current objective: Finish the current Cox analysis task.');
    expect(prompt).toContain('Open microtasks:');
    expect(prompt).toContain('Fit adjusted Cox model');
    expect(prompt).toContain('User request:\n继续执行。');
  });
});

describe('manual research lessons', () => {
  it('stores a hand-written lesson as confirmed and derives a title when omitted', async () => {
    const projectPath = await createTempProject();

    const { lesson, created } = await upsertManualResearchLesson(projectPath, {
      trigger: '用 CHARLS 构造 CESD-10 抑郁得分时',
      correctPattern: '先按 codebook 反转第 5、7 题再求和，不要直接 sum。',
      severity: 'high',
      stageHints: ['experiment'],
    });

    expect(created).toBe(true);
    expect(lesson.source).toBe('manual');
    expect(lesson.status).toBe('confirmed');
    expect(lesson.slug.startsWith('manual-')).toBe(true);
    expect(lesson.title).toContain('codebook');

    const state = await readResearchLessons(projectPath);
    expect(state.items).toHaveLength(1);
  });

  it('rejects a lesson that is missing the trigger or the corrective action', async () => {
    const projectPath = await createTempProject();

    await expect(upsertManualResearchLesson(projectPath, {
      trigger: '只有触发条件',
    })).rejects.toThrow('trigger and correctPattern are required');
  });

  it('updates an existing lesson in place and can delete it', async () => {
    const projectPath = await createTempProject();

    const { lesson } = await upsertManualResearchLesson(projectPath, {
      trigger: '旧触发条件',
      correctPattern: '旧做法',
    });

    const updated = await upsertManualResearchLesson(projectPath, {
      slug: lesson.slug,
      title: '新标题',
      trigger: '新触发条件',
      correctPattern: '新做法',
    });

    expect(updated.created).toBe(false);
    expect(updated.lesson.slug).toBe(lesson.slug);
    expect(updated.lesson.title).toBe('新标题');

    const afterUpdate = await readResearchLessons(projectPath);
    expect(afterUpdate.items).toHaveLength(1);
    expect(afterUpdate.items[0].trigger).toBe('新触发条件');

    const removal = await deleteResearchLesson(projectPath, lesson.slug);
    expect(removal.deleted).toBe(true);
    expect((await readResearchLessons(projectPath)).items).toHaveLength(0);
  });

});
