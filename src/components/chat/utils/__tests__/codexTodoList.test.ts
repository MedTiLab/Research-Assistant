import { describe, expect, it } from 'vitest';

import {
  normalizeCodexTodoItems,
  retainCodexTodoSnapshot,
  upsertCodexTodoSnapshot,
} from '../codexTodoList';
import { deriveSessionContextSummary } from '../sessionContextSummary';

describe('Codex todo-list messages', () => {
  it('normalizes app-server plan statuses for the existing TodoWrite renderer', () => {
    expect(normalizeCodexTodoItems([
      { text: 'Inspect the cohort', status: 'completed', completed: true },
      { text: 'Run the model', status: 'inProgress', completed: false },
      { text: 'Write the report', status: 'pending', completed: false },
    ], 'plan:turn-1')).toEqual([
      { id: 'plan:turn-1:1', content: 'Inspect the cohort', status: 'completed' },
      { id: 'plan:turn-1:2', content: 'Run the model', status: 'in_progress' },
      { id: 'plan:turn-1:3', content: 'Write the report', status: 'pending' },
    ]);
  });

  it('keeps only the latest Codex plan snapshot in chat state', () => {
    const first = upsertCodexTodoSnapshot([], {
      itemId: 'plan:turn-1',
      sessionId: 'session-1',
      items: [{ text: 'Inspect the cohort', status: 'in_progress' }],
    }, '2026-08-24T00:00:00.000Z');
    const second = upsertCodexTodoSnapshot(first, {
      itemId: 'plan:turn-2',
      sessionId: 'session-1',
      items: [{ text: 'Write the report', status: 'pending' }],
    }, '2026-08-24T00:01:00.000Z');

    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({
      toolName: 'TodoWrite',
      codexItemId: 'plan:turn-2',
      codexSessionId: 'session-1',
      isCodexTodoSnapshot: true,
      toolInput: {
        todos: [{ content: 'Write the report', status: 'pending' }],
      },
    });

    expect(deriveSessionContextSummary(second, '/workspace/demo').tasks).toMatchObject([
      { label: 'Write the report', detail: 'pending', kind: 'todo' },
    ]);
  });

  it('retains the live snapshot when the persisted transcript is reconciled', () => {
    const live = upsertCodexTodoSnapshot([], {
      itemId: 'plan:turn-1',
      sessionId: 'session-1',
      items: [{ text: 'Run the model', status: 'in_progress' }],
    }, '2026-08-24T00:01:00.000Z');
    const persisted = [
      { type: 'user', content: 'Start', timestamp: '2026-08-24T00:00:00.000Z' },
      { type: 'assistant', content: 'Done', timestamp: '2026-08-24T00:02:00.000Z' },
    ];

    const retained = retainCodexTodoSnapshot(live, persisted, 'session-1');

    expect(retained.map((message) => message.content || message.toolName)).toEqual([
      'Start',
      'TodoWrite',
      'Done',
    ]);
    expect(retainCodexTodoSnapshot(live, persisted, 'session-2')).toEqual(persisted);
  });

  it('removes the current snapshot when Codex clears its plan', () => {
    const existing = upsertCodexTodoSnapshot([], {
      itemId: 'plan:turn-1',
      items: [{ text: 'Inspect the cohort', status: 'pending' }],
    });

    expect(upsertCodexTodoSnapshot(existing, {
      itemId: 'plan:turn-1',
      items: [],
    })).toEqual([]);
  });
});
