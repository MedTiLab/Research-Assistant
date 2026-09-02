import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  captureProtectedFileSnapshot,
  restoreProtectedFileSnapshot,
  verifyProtectedFileSnapshot,
} from '../pipeline/drift-guard.js';

const cleanupTargets = [];

async function createProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-drift-guard-'));
  cleanupTargets.push(projectPath);
  await fs.mkdir(path.join(projectPath, '.pipeline', 'docs'), { recursive: true });
  await fs.mkdir(path.join(projectPath, '.pipeline', 'tasks'), { recursive: true });
  await fs.writeFile(path.join(projectPath, '.pipeline', 'docs', 'research_spec.json'), '{"specHash":"sha256:test"}\n');
  await fs.writeFile(path.join(projectPath, '.pipeline', 'docs', 'research_brief.json'), JSON.stringify({
    sections: { ideation: { problem_framing: 'ICU adults' } },
  }));
  await fs.writeFile(path.join(projectPath, '.pipeline', 'tasks', 'tasks.json'), JSON.stringify({
    master: { tasks: [{ id: 1, title: 'Task', status: 'in-progress', details: '' }] },
  }));
  return projectPath;
}

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    await fs.rm(cleanupTargets.pop(), { recursive: true, force: true });
  }
});

describe('auto research drift guard', () => {
  it('blocks unaudited task status/details changes and task-body changes', async () => {
    const projectPath = await createProject();
    const snapshot = await captureProtectedFileSnapshot({ projectPath, researchSpec: { specHash: 'sha256:test' } });
    const tasksPath = path.join(projectPath, '.pipeline', 'tasks', 'tasks.json');
    const payload = JSON.parse(await fs.readFile(tasksPath, 'utf8'));
    payload.master.tasks[0].status = 'review';
    payload.master.tasks[0].details = 'Evidence recorded';
    await fs.writeFile(tasksPath, JSON.stringify(payload));

    const stateChange = await verifyProtectedFileSnapshot(snapshot);
    expect(stateChange.pass).toBe(false);
    expect(stateChange.protectedFileChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '.pipeline/tasks/tasks.json' }),
    ]));

    await restoreProtectedFileSnapshot(snapshot, stateChange);
    const restored = JSON.parse(await fs.readFile(tasksPath, 'utf8'));
    expect(restored.master.tasks[0]).toMatchObject({ status: 'in-progress', details: '' });

    restored.master.tasks[0].title = 'Changed scope';
    await fs.writeFile(tasksPath, JSON.stringify(restored));
    const changed = await verifyProtectedFileSnapshot(snapshot);
    expect(changed.pass).toBe(false);
    expect(changed.protectedFileChanges[0].path).toBe('.pipeline/tasks/tasks.json');
  });

  it('restores invalid tasks and brief JSON instead of throwing', async () => {
    const projectPath = await createProject();
    const snapshot = await captureProtectedFileSnapshot({
      projectPath,
      researchSpec: { specHash: 'sha256:test', lockedBriefPaths: ['sections.ideation.problem_framing'] },
      currentTaskId: 1,
    });
    const tasksPath = path.join(projectPath, '.pipeline', 'tasks', 'tasks.json');
    const briefPath = path.join(projectPath, '.pipeline', 'docs', 'research_brief.json');
    await fs.writeFile(tasksPath, '{bad');
    await fs.writeFile(briefPath, '{bad');

    const result = await verifyProtectedFileSnapshot(snapshot);
    expect(result.pass).toBe(false);
    expect(result.protectedFileChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '.pipeline/tasks/tasks.json', parseError: expect.any(String) }),
      expect.objectContaining({ path: '.pipeline/docs/research_brief.json', parseError: expect.any(String) }),
    ]));
    await restoreProtectedFileSnapshot(snapshot, result);
    const restoredTasks = await fs.readFile(tasksPath, 'utf8');
    const restoredBrief = await fs.readFile(briefPath, 'utf8');
    expect(() => JSON.parse(restoredTasks)).not.toThrow();
    expect(() => JSON.parse(restoredBrief)).not.toThrow();
  });

  it('detects and restores locked research brief fields and protected files', async () => {
    const projectPath = await createProject();
    const snapshot = await captureProtectedFileSnapshot({
      projectPath,
      researchSpec: {
        specHash: 'sha256:test',
        lockedBriefPaths: ['sections.ideation.problem_framing'],
      },
    });
    const briefPath = path.join(projectPath, '.pipeline', 'docs', 'research_brief.json');
    await fs.writeFile(briefPath, JSON.stringify({
      sections: { ideation: { problem_framing: 'All hospitalized adults' } },
    }));
    const specPath = path.join(projectPath, '.pipeline', 'docs', 'research_spec.json');
    await fs.writeFile(specPath, '{"specHash":"sha256:tampered"}\n');

    const result = await verifyProtectedFileSnapshot(snapshot);
    expect(result.pass).toBe(false);
    expect(result.drift[0]).toMatchObject({
      field: 'sections.ideation.problem_framing',
      before: 'ICU adults',
      after: 'All hospitalized adults',
    });

    await restoreProtectedFileSnapshot(snapshot, result);
    expect(JSON.parse(await fs.readFile(briefPath, 'utf8')).sections.ideation.problem_framing).toBe('ICU adults');
    expect(await fs.readFile(specPath, 'utf8')).toContain('sha256:test');
  });
});
