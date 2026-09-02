import { describe, expect, it } from 'vitest';

import { claudeRuntime, codexRuntime, piRuntime } from '../agent-runtime/index.js';
import { normalizeAgentToolName } from '../../shared/agentRuntimeEvents.js';

describe('agent runtime provider capability parity', () => {
  it('keeps legacy capability booleans available', () => {
    expect(claudeRuntime.capabilities).toMatchObject({
      sessionResume: true,
      steering: true,
      nativeSkills: true,
      thinking: true,
      nativeContextCompaction: false,
      persistentAppServer: false,
    });
    expect(codexRuntime.capabilities).toMatchObject({
      sessionResume: true,
      steering: true,
      nativeSkills: true,
      thinking: false,
      interactiveToolApproval: false,
      planMode: false,
      nativeContextCompaction: true,
      persistentAppServer: true,
    });
    expect(piRuntime.capabilities).toMatchObject({
      sessionResume: true,
      steering: true,
      nativeSkills: true,
      thinking: true,
      interactiveToolApproval: true,
      planMode: true,
      nativeContextCompaction: true,
      backgroundSubagents: true,
      persistentTasks: true,
      persistentTodos: true,
      persistentArtifacts: true,
    });
  });

  it('describes Claude-native runtime behavior precisely', () => {
    expect(claudeRuntime.capabilities.capabilityDetails).toEqual({
      skills: { mode: 'claude-native-plugin' },
      steering: { mode: 'live-input' },
      reasoning: { mode: 'thinking-control', activityEvents: true },
      approval: { mode: 'sdk-callback' },
      context: { compaction: 'provider-managed' },
      process: { mode: 'sdk-query' },
    });
  });

  it('describes Codex-native runtime behavior precisely', () => {
    expect(codexRuntime.capabilities.capabilityDetails).toEqual({
      skills: { mode: 'medhelp-codex-bridge' },
      steering: { mode: 'turn-steer', buffersBeforeTurnId: true },
      reasoning: { mode: 'reasoning-effort', activityEvents: true },
      approval: { mode: 'app-server', interactive: false, fallback: 'deny' },
      context: { compaction: 'native' },
      process: { mode: 'persistent-app-server' },
    });
  });

  it('includes Pi in provider parity with normalized tools and persistent work state', () => {
    expect(piRuntime.capabilities.capabilityDetails).toMatchObject({
      approval: { mode: 'permission-bridge', interactive: true },
      context: { compaction: 'rpc' },
      process: { mode: 'one-host-per-turn', backgroundSubagents: true },
      tasks: { persistent: true, backgroundSubagents: true },
      todos: { persistent: true },
      artifacts: { persistent: true },
      terminal: { mode: 'persistent-pty-sessions', restartRecovery: 'history-only' },
      memory: { mode: 'existing-medhelp-stores' },
      plan: { formal: true, approval: true },
      deferredTools: true,
      automations: { persistent: true, executionMode: 'readOnly', requiresRunningBackend: true },
      tools: {
        readOnly: ['read', 'grep', 'find', 'ls', 'system_info'],
        approvalRequired: ['write', 'edit', 'bash'],
        coordination: [
          'ask_user',
          'todo_read',
          'todo_write',
          'task_create',
          'task_update',
          'task_list',
          'task_get',
          'task',
        ],
      },
    });
  });

  it.each([
    ['read', 'read', 'Read'],
    ['ask_user', 'ask_user', 'AskUserQuestion'],
    ['todo_write', 'todo_write', 'TodoWrite'],
    ['task', 'delegate_task', 'Task'],
    ['terminal_open', 'terminal_open', 'TerminalOpen'],
    ['exit_plan_mode', 'exit_plan_mode', 'ExitPlanMode'],
    ['memory_retrieve', 'memory_retrieve', 'MemoryRetrieve'],
    ['app_publish', 'app_publish', 'AppPublish'],
    ['media_generate', 'media_generate', 'MediaGenerate'],
  ])('normalizes Pi tool %s once in the backend', (nativeName, id, displayName) => {
    expect(normalizeAgentToolName(nativeName)).toEqual({ id, displayName, nativeName });
  });
});
