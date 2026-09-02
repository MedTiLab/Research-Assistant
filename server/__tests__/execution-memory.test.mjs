import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { getExecutionMemoryPaths } from '../execution-memory/files.js';
import {
  buildExecutionMemoryPromptPrefix,
  commitExecutionMemoryPromptCheckpoint,
  prepareExecutionPromptContext,
  readExecutionMemorySnapshot,
  resetExecutionMemoryPromptCheckpoints,
} from '../execution-memory/summary.js';
import { createExecutionMemoryTracker } from '../execution-memory/tracker.js';

const cleanupTargets = [];

async function createTempProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-execution-memory-'));
  cleanupTargets.push(projectPath);
  return projectPath;
}

afterEach(async () => {
  resetExecutionMemoryPromptCheckpoints();
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('execution memory', () => {
  it('records todo snapshots, findings, and artifacts for a session', async () => {
    const projectPath = await createTempProject();
    const tracker = createExecutionMemoryTracker({
      scope: 'session',
      projectPath,
      provider: 'claude',
      sessionId: 'session-exec-1',
      currentObjective: 'Analyze overall survival.',
    });

    await tracker.handlePayload({
      type: 'claude-response',
      data: {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'todo-1',
            name: 'TodoWrite',
            input: {
              todos: [
                { id: 'm1', content: 'Clean cohort', status: 'completed' },
                { id: 'm2', content: 'Run Cox model', status: 'in_progress' },
              ],
            },
          }],
        },
      },
    });

    await tracker.handlePayload({
      type: 'claude-response',
      data: {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'tool-1',
            name: 'Edit',
            input: {
              file_path: 'Experiment/analysis/cox_results.csv',
            },
          }],
        },
      },
    });

    await tracker.handlePayload({
      type: 'claude-response',
      data: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: 'Saved cox_results.csv',
          is_error: false,
        }],
      },
    });

    await tracker.handlePayload({
      type: 'claude-response',
      data: {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'text',
            text: 'HR 1.42 (95% CI 1.18-1.71), p = 0.0003 for OS in the treated cohort.',
          }],
        },
      },
    });

    const snapshot = await readExecutionMemorySnapshot({
      scope: 'session',
      projectPath,
      sessionId: 'session-exec-1',
      provider: 'claude',
    }, { ledgerLimit: 50 });

    expect(snapshot.microtasks.items).toHaveLength(2);
    expect(snapshot.microtasks.items.map((item) => item.status)).toEqual(['completed', 'in_progress']);
    expect(snapshot.derived.recentArtifacts).toContain('Experiment/analysis/cox_results.csv');
    expect(snapshot.derived.recentObservedFindings.some((finding) => finding.includes('HR 1.42'))).toBe(true);

    const paths = getExecutionMemoryPaths({
      scope: 'session',
      projectPath,
      sessionId: 'session-exec-1',
    });
    const [sessionSummary, workingSummary] = await Promise.all([
      fs.readFile(paths.sessionSummaryPath, 'utf8'),
      fs.readFile(paths.workingSummaryPath, 'utf8'),
    ]);

    expect(sessionSummary).toContain('Analyze overall survival.');
    expect(sessionSummary).toContain('Run Cox model');
    expect(workingSummary).toContain('Experiment/analysis/cox_results.csv');
  });

  it('moves provisional session state to the real session id and builds a resume prompt', async () => {
    const projectPath = await createTempProject();
    const tracker = createExecutionMemoryTracker({
      scope: 'session',
      projectPath,
      provider: 'claude',
      sessionId: 'new-session-123',
      currentObjective: 'Continue survival analysis.',
    });

    await tracker.handlePayload({
      type: 'claude-response',
      data: {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'todo-2',
            name: 'TodoWrite',
            input: {
              todos: [
                { id: 'm1', content: 'Prepare Kaplan-Meier plot', status: 'completed' },
                { id: 'm2', content: 'Draft result narrative', status: 'pending' },
              ],
            },
          }],
        },
      },
    });

    await tracker.setSessionId('session-real-123');

    const provisionalPaths = getExecutionMemoryPaths({
      scope: 'session',
      projectPath,
      sessionId: 'new-session-123',
    });
    const realPaths = getExecutionMemoryPaths({
      scope: 'session',
      projectPath,
      sessionId: 'session-real-123',
    });

    await expect(fs.access(provisionalPaths.rootDir)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(realPaths.rootDir)).resolves.toBeUndefined();

    const prompt = await buildExecutionMemoryPromptPrefix(
      {
        scope: 'session',
        projectPath,
        sessionId: 'session-real-123',
        provider: 'claude',
      },
      'Continue.',
      { fallbackCommand: 'Continue from the latest state.' },
    );

    expect(prompt).toContain('<execution_memory>');
    expect(prompt).toContain('Prepare Kaplan-Meier plot');
    expect(prompt).toContain('Draft result narrative');
  });

  it('caps the first memory capsule and sends only later state changes', async () => {
    const projectPath = await createTempProject();
    const scopeRef = {
      scope: 'session',
      projectPath,
      provider: 'codex',
      sessionId: 'compact-memory-session',
    };
    const paths = getExecutionMemoryPaths(scopeRef);
    await fs.mkdir(paths.rootDir, { recursive: true });
    const longText = 'A'.repeat(900);
    await fs.writeFile(paths.microtasksPath, `${JSON.stringify({
      version: 1,
      ...scopeRef,
      currentObjective: `Objective ${longText}`,
      currentTaskTitle: `Task ${longText}`,
      items: Array.from({ length: 12 }, (_, index) => ({
        id: `m${index}`,
        title: `Microtask ${index} ${longText}`,
        status: index < 6 ? 'completed' : 'pending',
      })),
    })}\n`, 'utf8');

    const firstSnapshot = await readExecutionMemorySnapshot(scopeRef);
    const first = prepareExecutionPromptContext(firstSnapshot);
    expect(first.mode).toBe('full');
    expect(first.text.length).toBeLessThanOrEqual(1_800);
    commitExecutionMemoryPromptCheckpoint(first.checkpoint);

    const unchanged = prepareExecutionPromptContext(firstSnapshot);
    expect(unchanged.mode).toBe('unchanged');
    expect(unchanged.text).toBe('');

    const microtasks = JSON.parse(await fs.readFile(paths.microtasksPath, 'utf8'));
    microtasks.items.push({ id: 'm-new', title: 'Validate the final report', status: 'pending' });
    await fs.writeFile(paths.microtasksPath, `${JSON.stringify(microtasks)}\n`, 'utf8');
    const changedSnapshot = await readExecutionMemorySnapshot(scopeRef);
    const delta = prepareExecutionPromptContext(changedSnapshot);
    expect(delta.mode).toBe('delta');
    expect(delta.text.length).toBeLessThanOrEqual(1_200);
    expect(delta.text).toContain('Mode: changes');
    expect(delta.text).toContain('Validate the final report');
  });

  it('records only the completed Codex assistant item instead of every accumulated delta', async () => {
    const projectPath = await createTempProject();
    const scopeRef = {
      scope: 'session',
      projectPath,
      provider: 'codex',
      sessionId: 'codex-delta-ledger',
    };
    const tracker = createExecutionMemoryTracker(scopeRef);
    for (const [lifecycle, content] of [
      ['updated', 'Partial'],
      ['updated', 'Partial response'],
      ['completed', 'Partial response completed.'],
    ]) {
      await tracker.handlePayload({
        type: 'codex-response',
        data: {
          type: 'item',
          itemType: 'agent_message',
          lifecycle,
          message: { content },
        },
      });
    }

    const snapshot = await readExecutionMemorySnapshot(scopeRef, { ledgerLimit: 20 });
    expect(snapshot.ledgerEvents.filter((event) => event.type === 'assistant_note')).toHaveLength(1);
  });
});
