import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyAgentRuntimeStateOperation,
  listAgentRuntimeStates,
  mutateAgentRuntimeState,
  readAgentRuntimeState,
  summarizeAgentWork,
  updateAgentRuntimeRun,
  updateAgentRuntimeTask,
} from '../agent-runtime/state-store.js';

let dataDir;

it('serializes managed host writes with background updates and enforces operation scope', async () => {
  const owner = identity('concurrent');
  await applyAgentRuntimeStateOperation(owner, 'upsertTask', ['child', { title: 'Child', status: 'running' }], { dataDir });
  await Promise.all([
    ...Array.from({ length: 20 }, (_, index) => applyAgentRuntimeStateOperation(owner, 'updateToolCall', [`call-${index}`, { status: 'completed' }], { dataDir })),
    updateAgentRuntimeTask(owner, 'child', { status: 'completed', result: 'ready' }, { dataDir }),
    applyAgentRuntimeStateOperation(owner, 'replaceTodos', [[{ content: 'A', status: 'in_progress' }, { content: 'B', status: 'in_progress' }]], { dataDir }),
  ]);
  const state = await applyAgentRuntimeStateOperation(owner, 'read', [], { dataDir });
  expect(state.toolCalls).toHaveLength(20);
  expect(state.tasks[0]).toMatchObject({ status: 'completed', result: 'ready' });
  expect(state.todos.map((todo) => todo.status)).toEqual(['in_progress', 'pending']);
  await expect(applyAgentRuntimeStateOperation(owner, '__proto__', [], { dataDir })).rejects.toThrow('Unknown agent state operation');
  expect((await readAgentRuntimeState({ ...owner, ownerKey: 'different-owner' }, { dataDir })).tasks).toEqual([]);
});

const identity = (sessionId) => ({
  ownerKey: 'owner-a',
  projectKey: 'project-a',
  runtimeId: 'pi',
  sessionId,
});

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-agent-state-'));
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('agent runtime state store', () => {
  it('persists provider-neutral work entities and classifies sidebar groups', async () => {
    await updateAgentRuntimeRun(identity('session-active'), 'run-a', {
      status: 'running',
      title: 'Active run',
    }, { dataDir });
    await updateAgentRuntimeTask(identity('session-active'), 'task-a', {
      title: 'Needs a decision',
      status: 'waiting_on_user',
    }, { dataDir });
    await updateAgentRuntimeTask(identity('session-scheduled'), 'task-b', {
      title: 'Scheduled review',
      status: 'scheduled',
      schedule: 'tomorrow',
    }, { dataDir });
    await mutateAgentRuntimeState(identity('session-active'), (state) => {
      state.todos.push({ id: 'todo-a', content: 'Inspect', status: 'in_progress' });
      state.artifacts.push({ id: 'artifact-a', path: 'report.md', kind: 'file' });
      state.contextItems.push({ id: 'context-a', path: 'AGENTS.md', type: 'instructions' });
      state.permissionRequests.push({ id: 'permission-a', status: 'pending', toolName: 'AskUserQuestion' });
      return state;
    }, { dataDir });

    const states = await listAgentRuntimeStates(identity('placeholder'), { dataDir });
    expect(states).toHaveLength(2);
    const activeState = await readAgentRuntimeState(identity('session-active'), { dataDir });
    expect(activeState).toMatchObject({
      todos: [expect.objectContaining({ id: 'todo-a' })],
      artifacts: [expect.objectContaining({ id: 'artifact-a' })],
      contextItems: [expect.objectContaining({ id: 'context-a' })],
      permissionRequests: [expect.objectContaining({ id: 'permission-a' })],
    });

    const summary = summarizeAgentWork(states);
    expect(summary.active).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'run-a', sessionId: 'session-active' }),
    ]));
    expect(summary.needsAttention).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'task-a' }),
      expect.objectContaining({ id: 'permission-a' }),
    ]));
    expect(summary.scheduled).toEqual([
      expect.objectContaining({ id: 'task-b', sessionId: 'session-scheduled' }),
    ]);
  });
});
