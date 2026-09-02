import { describe, expect, it } from 'vitest';

import {
  isRuntimeObservationType,
  normalizeAgentRuntimeEvents,
  normalizeRuntimeObservations,
} from '../agent-runtime/observations/index.js';

function stripObservationMetadata(observations) {
  return observations.map(({ provider, ...observation }) => observation);
}

describe('agent runtime observations', () => {
  it('normalizes Claude assistant text, reasoning activity, tool use, and usage', () => {
    const payload = {
      type: 'claude-response',
      data: {
        type: 'assistant',
        message: {
          role: 'assistant',
          usage: { input_tokens: 10, output_tokens: 4 },
          content: [
            { type: 'thinking', thinking: 'private reasoning must not escape' },
            { type: 'text', text: 'The visible answer.' },
            { type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: 'report.md' } },
          ],
        },
      },
    };

    const originalPayload = structuredClone(payload);
    const observations = normalizeRuntimeObservations(payload);
    expect(observations.every((observation) => observation.provider === 'claude')).toBe(true);
    expect(payload).toEqual(originalPayload);
    expect(JSON.stringify(observations)).not.toContain('private reasoning must not escape');
    expect(observations.find((observation) => observation.type === 'reasoning_activity'))
      .toMatchObject({ type: 'reasoning_activity', status: 'active' });
    expect(observations.find((observation) => observation.type === 'reasoning_activity'))
      .not.toHaveProperty('content');
    expect(stripObservationMetadata(observations)).toEqual([
      { type: 'reasoning_activity', status: 'active' },
      {
        type: 'tool_use',
        toolCallId: 'tool-1',
        parentToolUseId: null,
        toolName: 'Read',
        toolInput: { path: 'report.md' },
      },
      {
        type: 'assistant_text',
        text: 'The visible answer.',
        message: { role: 'assistant', content: 'The visible answer.' },
      },
      {
        type: 'usage_updated',
        usage: expect.objectContaining({
          provider: 'claude',
          inputTokens: 10,
          outputTokens: 4,
          totalTokens: 14,
        }),
      },
    ]);
  });

  it('normalizes Claude tool results and todo snapshots', () => {
    const todo = normalizeRuntimeObservations({
      type: 'claude-response',
      data: {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'todo-1',
            name: 'TodoWrite',
            input: { todos: [{ content: 'Run analysis', status: 'in-progress' }] },
          }],
        },
      },
    });
    const result = normalizeRuntimeObservations({
      type: 'claude-response',
      data: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: [{ type: 'text', text: 'Saved report.md' }],
        }],
      },
    });

    expect(stripObservationMetadata(todo)).toEqual([{
      type: 'todo_snapshot',
      source: 'TodoWrite',
      todos: [{ id: 'todo-1', title: 'Run analysis', status: 'in_progress' }],
    }]);
    expect(stripObservationMetadata(result)).toEqual([{
      type: 'tool_result',
      toolCallId: 'tool-1',
      output: 'Saved report.md',
      isError: false,
    }]);
  });

  it('normalizes Codex agent messages and command lifecycle', () => {
    const updated = normalizeRuntimeObservations({
      type: 'codex-response',
      data: {
        type: 'item',
        itemType: 'agent_message',
        lifecycle: 'updated',
        message: { role: 'assistant', content: 'Partial' },
      },
    });
    const completed = normalizeRuntimeObservations({
      type: 'codex-response',
      data: {
        type: 'item',
        itemType: 'agent_message',
        lifecycle: 'completed',
        message: { role: 'assistant', content: 'Final answer' },
      },
    });
    const commandStarted = normalizeRuntimeObservations({
      type: 'codex-response',
      data: {
        type: 'item',
        itemType: 'command_execution',
        itemId: 'cmd-1',
        lifecycle: 'started',
        command: 'npm test',
      },
    });
    const commandCompleted = normalizeRuntimeObservations({
      type: 'codex-response',
      data: {
        type: 'item',
        itemType: 'command_execution',
        itemId: 'cmd-1',
        lifecycle: 'completed',
        output: 'passed',
        exitCode: 0,
      },
    });

    expect(updated).toEqual([]);
    expect(stripObservationMetadata(completed)).toEqual([{
      type: 'assistant_text',
      text: 'Final answer',
      message: { role: 'assistant', content: 'Final answer' },
    }]);
    expect(stripObservationMetadata(commandStarted)).toEqual([{
      type: 'tool_use',
      toolCallId: 'cmd-1',
      toolName: 'Bash',
      toolInput: { command: 'npm test' },
      source: 'codex_command_execution',
    }]);
    expect(stripObservationMetadata(commandCompleted)).toEqual([{
      type: 'tool_result',
      toolCallId: 'cmd-1',
      output: 'passed',
      isError: false,
    }]);
  });

  it('normalizes Codex file changes and MCP tool calls', () => {
    const fileChanges = normalizeRuntimeObservations({
      type: 'codex-response',
      data: {
        type: 'item',
        itemType: 'file_change',
        changes: [{ path: 'server/a.js' }, { filePath: 'server/b.js' }],
      },
    });
    const mcpCall = normalizeRuntimeObservations({
      type: 'codex-response',
      data: {
        type: 'item',
        itemType: 'mcp_tool_call',
        itemId: 'mcp-1',
        tool: 'lookup',
        arguments: { query: 'term' },
        status: 'completed',
        result: { count: 2 },
      },
    });

    expect(stripObservationMetadata(fileChanges)).toEqual([
      { type: 'artifact_created', path: 'server/a.js', kind: 'file_change', source: 'codex_file_change' },
      { type: 'artifact_created', path: 'server/b.js', kind: 'file_change', source: 'codex_file_change' },
    ]);
    expect(stripObservationMetadata(mcpCall)).toEqual([
      {
        type: 'tool_use',
        toolCallId: 'mcp-1',
        toolName: 'lookup',
        toolInput: { query: 'term' },
        source: 'codex_mcp_tool_call',
      },
      {
        type: 'tool_result',
        toolCallId: 'mcp-1',
        output: '{"count":2}',
        isError: false,
      },
    ]);
  });

  it('normalizes the todo shape emitted by Codex turn/plan/updated', () => {
    const observations = normalizeRuntimeObservations({
      type: 'codex-response',
      data: {
        type: 'item',
        itemType: 'todo_list',
        lifecycle: 'updated',
        items: [
          { text: 'Inspect the cohort', status: 'completed', completed: true },
          { text: 'Run the model', status: 'in_progress', completed: false },
        ],
      },
    });

    expect(stripObservationMetadata(observations)).toEqual([{
      type: 'todo_snapshot',
      source: 'codex_todo_list',
      todos: [
        { id: 'todo-1', title: 'Inspect the cohort', status: 'completed' },
        { id: 'todo-2', title: 'Run the model', status: 'in_progress' },
      ],
    }]);
  });

  it('normalizes Pi host events through the provider-neutral observation contract', () => {
    expect(normalizeRuntimeObservations({
      type: 'pi-response',
      runtimeId: 'pi',
      data: {
        event: 'tool_started',
        sessionId: 'pi-session',
        data: { toolCallId: 'pi-tool', toolName: 'read', input: { path: 'paper.md' } },
      },
    })).toEqual([{
      type: 'tool_use',
      provider: 'pi',
      toolCallId: 'pi-tool',
      toolName: 'Read',
      toolId: 'read',
      nativeToolName: 'read',
      toolInput: { path: 'paper.md' },
    }]);

    expect(normalizeRuntimeObservations({
      type: 'pi-response',
      runtimeId: 'pi',
      data: {
        event: 'usage',
        sessionId: 'pi-session',
        data: { input: 8, output: 2, cacheRead: 1, totalTokens: 10 },
      },
    })[0]).toMatchObject({
      type: 'usage_updated',
      provider: 'pi',
      usage: { provider: 'pi', inputTokens: 8, outputTokens: 2, totalTokens: 10 },
    });
  });

  it.each([
    ['claude', {
      type: 'claude-response',
      data: {
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tool-a', name: 'Read', input: { path: 'a.md' } }] },
      },
    }],
    ['codex', {
      type: 'codex-response',
      data: { type: 'item', itemType: 'command_execution', itemId: 'tool-a', lifecycle: 'started', command: 'pwd' },
    }],
    ['pi', {
      type: 'pi-response',
      data: { event: 'tool_started', sessionId: 'session-a', data: { toolCallId: 'tool-a', toolName: 'read', input: { path: 'a.md' } } },
    }],
  ])('emits the same ToolCall event schema for %s', (provider, payload) => {
    expect(normalizeAgentRuntimeEvents(payload, {
      provider,
      sessionId: 'session-a',
      runId: 'run-a',
    })).toEqual([
      expect.objectContaining({
        schema: 'medhelp.agent-runtime-event.v1',
        type: 'tool_call.started',
        entityType: 'ToolCall',
        provider,
        runtimeId: provider,
        sessionId: 'session-a',
        runId: 'run-a',
        entityId: 'tool-a',
      }),
    ]);
  });

  it('does not infer lifecycle observations from transport messages', () => {
    const transportLifecyclePayloads = [
      { type: 'codex-response', data: { type: 'turn_started' } },
      { type: 'codex-response', data: { type: 'turn_complete' } },
      { type: 'codex-response', data: { type: 'turn_failed', error: 'failed' } },
      { type: 'codex-complete', sessionId: 'codex-session' },
      { type: 'codex-error', sessionId: 'codex-session', error: 'failed' },
      { type: 'claude-complete', sessionId: 'claude-session' },
      { type: 'claude-error', sessionId: 'claude-session', error: 'failed' },
    ];

    expect(transportLifecyclePayloads.map((payload) => normalizeRuntimeObservations(payload)))
      .toEqual(transportLifecyclePayloads.map(() => []));
    expect(isRuntimeObservationType('turn_started')).toBe(false);
    expect(isRuntimeObservationType('turn_completed')).toBe(false);
    expect(isRuntimeObservationType('turn_failed')).toBe(false);
  });

  it('emits reasoning and provider-aware usage observations', () => {
    const observationTypes = [
      normalizeRuntimeObservations({
        type: 'codex-response',
        data: { type: 'status', status: 'reasoning', content: 'must remain ignored' },
      })[0]?.type,
      normalizeRuntimeObservations({
        type: 'token-budget',
        data: {
          used: 14,
          total: 100,
          breakdown: { input: 10, output: 4, cacheRead: 3, reasoning: 2 },
        },
      }, { provider: 'codex' })[0]?.type,
    ];

    expect(observationTypes).toEqual(['reasoning_activity', 'usage_updated']);
    expect(observationTypes.every(isRuntimeObservationType)).toBe(true);
  });

  it('does not add medical findings to generic runtime observations', () => {
    const observations = normalizeRuntimeObservations({
      type: 'claude-response',
      data: {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: 'HR 1.42 (95% CI 1.18-1.71), p = 0.0003.',
        },
      },
    });

    expect(observations[0]).not.toHaveProperty('findings');
  });
});
