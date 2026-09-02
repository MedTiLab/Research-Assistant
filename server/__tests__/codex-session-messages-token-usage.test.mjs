import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

let tempRoot = null;

async function loadProjectsModule() {
  vi.resetModules();
  return import('../projects.js');
}

async function createCodexSessionFile(sessionId, entries) {
    const sessionsDir = path.join(tempRoot, '.medhelpsec', 'codex_home', 'sessions', '2026', '03', '31');
  await mkdir(sessionsDir, { recursive: true });
  const sessionFile = path.join(
    sessionsDir,
    `rollout-2026-03-31T00-00-00-${sessionId}.jsonl`,
  );
  await writeFile(
    sessionFile,
    entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
    'utf8',
  );
}

describe('Codex session message token usage', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'medhelp-codex-token-usage-'));
    process.env.HOME = tempRoot;
    process.env.USERPROFILE = tempRoot;
  });

  afterEach(async () => {
    vi.resetModules();

    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;

    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;

    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('returns unsupported context usage when the Codex jsonl only has lifetime totals', async () => {
    const sessionId = '019d5000-0000-7000-8000-000000000001';
    await createCodexSessionFile(sessionId, [
      {
        type: 'response_item',
        timestamp: '2026-03-31T00:00:00.000Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'hello world' }],
        },
      },
      {
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { total_tokens: 245001 },
            model_context_window: 200000,
          },
        },
      },
    ]);

    const { getCodexSessionMessages } = await loadProjectsModule();
    const result = await getCodexSessionMessages(sessionId);

    expect(result.messages).toHaveLength(1);
    expect(result.tokenUsage).toEqual({
      used: null,
      total: 200000,
      unsupportedContext: true,
      message: 'Current context usage is unavailable for Codex sessions.',
      lifetimeTokens: 245001,
    });
  });

  it('returns current context usage when Codex jsonl includes it', async () => {
    const sessionId = '019d5000-0000-7000-8000-000000000002';
    await createCodexSessionFile(sessionId, [
      {
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { total_tokens: 301122 },
            current_context_usage: { total_tokens: 81234 },
            model_context_window: 200000,
          },
        },
      },
    ]);

    const { getCodexSessionMessages } = await loadProjectsModule();
    const result = await getCodexSessionMessages(sessionId);

    expect(result.tokenUsage).toEqual({
      used: 81234,
      total: 200000,
    });
  });

  it('filters Codex startup diagnostics from assistant message history', async () => {
    const sessionId = '019d5000-0000-7000-8000-000000000003';
    await createCodexSessionFile(sessionId, [
      {
        type: 'response_item',
        timestamp: '2026-03-31T00:00:00.000Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{
            type: 'output_text',
            text: [
              '⚠ Skipped loading 1 skill(s) due to invalid SKILL.md files.',
              '⚠ /Users/example/Research-Assistant/skills/medhelp-paper-reviewer/SKILL.md: invalid YAML: metadata: invalid type: string "Example", expected struct SkillFrontmatterMetadata',
              '• Starting MCP servers (3/4): notion (10s • esc to interrupt)',
            ].join('\n'),
          }],
        },
      },
      {
        type: 'response_item',
        timestamp: '2026-03-31T00:00:05.000Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Real assistant content' }],
        },
      },
    ]);

    const { getCodexSessionMessages } = await loadProjectsModule();
    const result = await getCodexSessionMessages(sessionId);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.message?.content).toBe('Real assistant content');
  });

  it('hides Codex prompt scaffolding while preserving the real user request', async () => {
    const sessionId = '019d5000-0000-7000-8000-000000000004';
    const internalPrompt = [
      '# MedHelp Skills (available outside the project workspace)',
      '',
      'MedHelp research skills are not inside this project.',
      '- /private/runtime/skills',
      '',
      '<path_display_rule>',
      'Keep internal paths private.',
      '</path_display_rule>',
      '',
      'User request:',
      '[Context: session-mode=research]',
      '[Context: This is a research workflow session.]',
      '',
      '继续修改真实问题',
    ].join('\n');

    await createCodexSessionFile(sessionId, [
      {
        type: 'response_item',
        timestamp: '2026-03-31T00:00:00.000Z',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: internalPrompt }],
        },
      },
      {
        type: 'response_item',
        timestamp: '2026-03-31T00:00:01.000Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: internalPrompt }],
        },
      },
      {
        type: 'response_item',
        timestamp: '2026-03-31T00:00:02.000Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '真实回答' }],
        },
      },
    ]);

    const { getCodexSessionMessages } = await loadProjectsModule();
    const result = await getCodexSessionMessages(sessionId);

    expect(result.messages.map((message) => message.message?.content)).toEqual([
      '继续修改真实问题',
      '真实回答',
    ]);
  });

  it('hides automatic goal-continuation context stored with the user role', async () => {
    const sessionId = '019d5000-0000-7000-8000-000000000005';
    const internalGoalContext = [
      '<codex_internal_context source="goal">',
      'Continue working toward the active thread goal.',
      '<objective>持续监控任务</objective>',
      '</codex_internal_context>',
    ].join('\n');

    await createCodexSessionFile(sessionId, [
      {
        type: 'response_item',
        timestamp: '2026-03-31T00:00:00.000Z',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: internalGoalContext }],
        },
      },
      {
        type: 'response_item',
        timestamp: '2026-03-31T00:00:01.000Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '继续监控中' }],
        },
      },
    ]);

    const { getCodexSessionMessages } = await loadProjectsModule();
    const result = await getCodexSessionMessages(sessionId);

    expect(result.messages.map((message) => message.message?.content)).toEqual(['继续监控中']);
  });

  it('preserves exec wrappers for frontend expansion and hides internal wait calls', async () => {
    const sessionId = '019d5000-0000-7000-8000-000000000006';
    await createCodexSessionFile(sessionId, [
      {
        type: 'response_item',
        timestamp: '2026-03-31T00:00:00.000Z',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'call-exec',
          input: 'const r = await tools.exec_command({"cmd":"pwd","workdir":"/tmp"});\ntext(r.output);',
        },
      },
      {
        type: 'response_item',
        timestamp: '2026-03-31T00:00:01.000Z',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'call-exec',
          output: '/tmp',
        },
      },
      {
        type: 'response_item',
        timestamp: '2026-03-31T00:00:02.000Z',
        payload: {
          type: 'custom_tool_call',
          name: 'exec',
          call_id: 'call-mcp',
          input: 'const r = await tools.mcp__medhelp_compute__status({});\ntext(r);',
        },
      },
      {
        type: 'response_item',
        timestamp: '2026-03-31T00:00:03.000Z',
        payload: {
          type: 'custom_tool_call',
          name: 'wait',
          call_id: 'call-wait',
          input: '{"cell_id":"123"}',
        },
      },
      {
        type: 'response_item',
        timestamp: '2026-03-31T00:00:04.000Z',
        payload: {
          type: 'custom_tool_call_output',
          call_id: 'call-wait',
          output: 'completed',
        },
      },
    ]);

    const { getCodexSessionMessages } = await loadProjectsModule();
    const result = await getCodexSessionMessages(sessionId);

    expect(result.messages.map((message) => message.toolName).filter(Boolean)).toEqual(['exec', 'exec']);
    expect(result.messages.some((message) => message.toolName === 'wait')).toBe(false);
    expect(result.messages[0]?.toolInput).toContain('tools.exec_command');
  });
});
