import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { syncTasksWithResearchBrief, updateTaskRecord } from '../routes/taskmaster.js';

const cleanupTargets = [];

async function createTempProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-taskmaster-brief-sync-'));
  cleanupTargets.push(projectPath);
  return projectPath;
}

async function writeBrief(projectPath, brief) {
  const briefPath = path.join(projectPath, '.pipeline', 'docs', 'research_brief.json');
  await fs.mkdir(path.dirname(briefPath), { recursive: true });
  await fs.writeFile(briefPath, `${JSON.stringify(brief, null, 2)}\n`, 'utf8');
}

function createBrief(taskTitle, taskDescription, extraBlueprint = null) {
  return {
    meta: {
      title: 'Task sync test',
    },
    pipeline: {
      startStage: 'literature',
      stages: {
        literature: {
          task_blueprints: [
            {
              id: 'literature.baseline',
              title: taskTitle,
              description: taskDescription,
              taskType: 'analysis',
            },
            ...(extraBlueprint ? [extraBlueprint] : []),
          ],
        },
      },
    },
  };
}

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('taskmaster brief sync', () => {
  it('merges regenerated tasks with existing task state instead of replacing progress', async () => {
    const projectPath = await createTempProject();
    await writeBrief(projectPath, createBrief('Draft baseline question', 'Old description.'));

    const initialSync = await syncTasksWithResearchBrief(projectPath, { mode: 'merge' });
    expect(initialSync.synced).toBe(true);
    expect(initialSync.tasks).toHaveLength(1);
    expect(initialSync.tasks[0]).toMatchObject({
      id: 1,
      title: 'Draft baseline question',
      status: 'pending',
      sourceBlueprintId: 'literature.baseline',
    });

    await updateTaskRecord(projectPath, 1, {
      status: 'in-progress',
      details: 'Manual progress note',
    });

    await writeBrief(projectPath, createBrief(
      'Refine baseline research question',
      'New description from the updated brief.',
      {
        id: 'literature.evidence',
        title: 'Collect seed references',
        description: 'Gather the first pass of core references.',
        taskType: 'analysis',
      },
    ));

    const mergeSync = await syncTasksWithResearchBrief(projectPath, { mode: 'merge' });
    expect(mergeSync.synced).toBe(true);
    expect(mergeSync.tasks).toHaveLength(2);

    const [updatedTask, newTask] = mergeSync.tasks;
    expect(updatedTask).toMatchObject({
      id: 1,
      title: 'Refine baseline research question',
      description: 'New description from the updated brief.',
      status: 'in-progress',
      details: 'Manual progress note',
      sourceBlueprintId: 'literature.baseline',
    });
    expect(newTask).toMatchObject({
      id: 2,
      title: 'Collect seed references',
      status: 'pending',
      sourceBlueprintId: 'literature.evidence',
    });
  });
});
