import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TOOL_CONFIGS, getToolConfig, shouldHideToolResult } from './configs/toolConfigs';
import { ToolRenderer } from './ToolRenderer';
import { SubagentContainer } from './components/SubagentContainer';
import { parseTaskContent } from './components/ContentRenderers/TaskListContent';
import { convertSessionMessages } from '../utils/messageTransforms';
import { loadTranscriptWindow, reconcilePersistedSessionMessages } from '../utils/sessionTranscriptReconciliation';
import { normalizePiSessionRecord } from '../../../../server/pi-runtime/session-store.js';
import { isSubagentComplete } from '../../../../shared/agentToolPresentation.js';

describe('Pi and Claude tool presentation parity', () => {
  const piExamples: Array<[string, any, any]> = [
    ['browser_open', { url: 'https://example.org' }, { page_id: 'page-1', url: 'https://example.org', text: 'Page text', elements: [{ index: 0, tag: 'button', label: 'Continue' }], untrusted: true }],
    ['browser_show', { url: 'http://localhost:5173/app' }, { page_id: 'display:page-1', url: 'http://localhost:5173/app', sidebar_url: 'http://localhost:5173/app', status: 'display-requested', display_only: true }],
    ['browser_snapshot', { page_id: 'page-1' }, { url: 'https://example.org', text: 'Snapshot' }],
    ['browser_action', { page_id: 'page-1', action: 'close' }, { page_id: 'page-1', status: 'closed' }],
    ['integration_call', { integration_id: 'bio-research', tool: 'pubmed' }, { text: 'Paper', resources: [{ uri: 'https://example.org/paper', name: 'Source' }], untrusted: true }],
    ['tool_call', { name: 'integration_call', arguments: { integration_id: 'bio-research', tool: 'pubmed' } }, { text: 'Paper' }],
    ['automation_create', { title: 'Review' }, { id: 'auto-1', title: 'Review', status: 'active', nextRunAt: '2026-09-01T12:00:00Z', intervalMinutes: 60 }],
    ['automation_list', {}, [{ id: 'auto-1', title: 'Review', status: 'active', nextRunAt: '2026-09-01T12:00:00Z' }]],
    ['automation_update', { automation_id: 'auto-1', status: 'paused' }, { id: 'auto-1', title: 'Review', status: 'paused' }],
    ['integration_list', {}, [{ id: 'bio-research', type: 'stdio', installed: true, status: 'connected' }]],
    ['integration_tools', { integration_id: 'bio-research' }, { tools: [{ name: 'pubmed', description: 'Find papers' }] }],
    ['mcp_reconnect', { integration_id: 'bio-research' }, { tools: [{ name: 'pubmed' }] }],
    ['mcp_authorize', { integration_id: 'bio-research' }, { status: 'needs_authorization', authorizationUrl: 'https://example.org/auth' }],
    ['web_fetch', { url: 'https://example.org' }, { text: 'Body', links: [{ url: 'https://example.org/link' }], untrusted: true }],
    ['remember', { content: 'Fact', scope: 'user' }, 'Remembered'],
    ['memory_retrieve', { query: 'Fact' }, { memories: [{ scope: 'user', content: 'Fact' }], projectMemory: 'Project facts' }],
    ['terminal_list', {}, [{ terminal_id: 'pty-1', status: 'exited', exitCode: 1 }]],
    ['tool_search', { query: 'pubmed' }, [{ name: 'pubmed', description: 'Find papers' }]],
    ['tool_describe', { name: 'pubmed' }, { name: 'pubmed', description: 'Find papers', parameters: { type: 'object' } }],
    ['system_info', {}, 'Runtime information'],
  ];

  it.each(piExamples)('renders %s identically for live payloads and native history, keeping failures visible', (name, input, result) => {
    const content = typeof result === 'string' ? result : JSON.stringify(result);
    const live = { content, isError: false };
    const restored = convertSessionMessages([
      { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'call', name, arguments: input }] } },
      { type: 'message', message: { role: 'toolResult', toolCallId: 'call', toolName: name, content: [{ type: 'text', text: content }] } },
    ].flatMap<any>(normalizePiSessionRecord)).find((entry) => entry.isToolUse)!;
    const config = getToolConfig(name);
    expect(config).not.toBe(TOOL_CONFIGS.Default);
    expect(JSON.parse(restored.toolInput as string)).toEqual(name === 'tool_call' ? input.arguments : input);
    expect(config.result?.getContentProps?.(restored.toolResult)).toEqual(config.result?.getContentProps?.(live));
    const render = (toolResult: any) => renderToStaticMarkup(<ToolRenderer toolName={name} toolInput={input} toolResult={toolResult} mode="result" autoExpandTools />);
    expect(render(restored.toolResult)).toBe(render(live));
    const error = { content: 'Permission denied', isError: true };
    expect(shouldHideToolResult(name, error)).toBe(false);
    expect(shouldHideToolResult(name, { isError: true, content: 'TaskMaster not installed' })).toBe(false);
    expect(render(error)).toContain('Permission denied');
    expect(render(error)).toContain('role="alert"');
  });

  it.each(['terminal_open', 'terminal_read', 'terminal_write', 'terminal_close'])('keeps %s output in the conversation for live and restored messages', (name) => {
    const input = { command: 'echo ready', terminal_id: 'pty-1', input: 'continue\n' };
    const content = JSON.stringify({ terminal_id: 'pty-1', status: 'exited', exitCode: 0, output: 'Terminal output remains in chat' });
    const [restored] = convertSessionMessages([
      { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'terminal-call', name, arguments: input }] } },
      { type: 'message', message: { role: 'toolResult', toolCallId: 'terminal-call', toolName: name, content: [{ type: 'text', text: content }] } },
    ].flatMap<any>(normalizePiSessionRecord)).filter((entry) => entry.isToolUse);
    const render = (toolResult: any) => renderToStaticMarkup(<ToolRenderer toolName={name} toolInput={input} toolResult={toolResult} mode="result" autoExpandTools />);
    const live = { content, isError: false };
    expect(shouldHideToolResult(name, live)).toBe(false);
    expect(render(restored.toolResult)).toBe(render(live));
    expect(render(live)).toContain('Terminal output remains in chat');
  });

  it('shows MCP identity and the schedule without expanding a card', () => {
    for (const [name, input] of piExamples.filter(([name]) => ['integration_call', 'tool_call'].includes(name))) {
      expect(renderToStaticMarkup(<ToolRenderer toolName={name} toolInput={input} mode="input" />)).toContain('bio-research · pubmed');
    }
    const [, input, result] = piExamples.find(([name]) => name === 'automation_create')!;
    const html = renderToStaticMarkup(<ToolRenderer toolName="automation_create" toolInput={input} toolResult={{ content: JSON.stringify(result) }} mode="result" />);
    expect(html.match(/<summary[\s\S]*?<\/summary>/)?.[0]).toContain('下次运行');
    expect(html.match(/<summary[\s\S]*?<\/summary>/)?.[0]).toContain('每 60 分钟');
  });

  it('renders external data as text and only exposes safe, manual links', () => {
    const html = renderToStaticMarkup(<ToolRenderer toolName="BrowserOpen" toolInput={{}} mode="result" autoExpandTools toolResult={{ content: JSON.stringify({
      text: '<script>alert(1)</script> ![track](https://example.org/track)', untrusted: true,
      url: 'javascript:alert(1)', resources: [{ uri: 'data:text/html,bad' }, { uri: 'https://example.org/source', name: 'Source' }],
    }) }} />);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="data:');
    expect(html).toContain('href="https://example.org/source"');
    expect(html).toContain('noopener noreferrer');
  });

  it('leaves Claude MCP name parsing unchanged', () => {
    const [entry] = convertSessionMessages([{ role: 'assistant', content: [{ type: 'tool_use', id: 'mcp-1', name: 'mcp__bio__search', input: { query: 'paper' } }] }]);
    expect(entry).toMatchObject({ toolName: 'mcp__bio__search' });
    expect(JSON.parse(entry.toolInput as string)).toEqual({ query: 'paper' });
  });
  it('restores independent Pi results by id, including out-of-order errors', () => {
    const records = [
      { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'false' } }] } },
      { type: 'message', message: { role: 'toolResult', toolCallId: 'call-1', toolName: 'bash', content: [{ type: 'text', text: 'failed output' }], isError: true } },
    ].flatMap<any>((record) => normalizePiSessionRecord(record));
    for (const messages of [records, [...records].reverse()]) {
      expect(convertSessionMessages(messages).find((message) => message.isToolUse)).toMatchObject({
        toolId: 'call-1', toolCallId: 'call-1', toolError: true, toolResult: { content: 'failed output', isError: true },
      });
    }
  });

  it('preserves every Pi edit and Claude edit fields', () => {
    expect(TOOL_CONFIGS.Edit.input.getContentProps?.({ path: 'a.js', edits: [{ oldText: 'a', newText: 'b' }, { oldText: 'c', newText: 'd' }] }).changes)
      .toEqual([{ filePath: 'a.js', oldContent: 'a', newContent: 'b' }, { filePath: 'a.js', oldContent: 'c', newContent: 'd' }]);
    expect(TOOL_CONFIGS.Edit.input.getContentProps?.({ file_path: 'a.js', old_string: 'old', new_string: 'new' }))
      .toMatchObject({ oldContent: 'old', newContent: 'new' });
  });
  it('restores results supplied alongside a paginated tool call', () => {
    const messages = convertSessionMessages([{ role: 'assistant', content: [{ type: 'tool_use', id: 'call', name: 'Bash', input: { command: 'false' } }],
      toolResults: { call: { type: 'tool_result', toolCallId: 'call', output: 'failure output', isError: true } } }]);
    expect(messages[0].toolResult).toMatchObject({ content: 'failure output', isError: true });
  });

  it('retains the first Pi question and reply through a 69-record tool turn and replay', async () => {
    const record = (role: string, text: string) => ({ type: 'message', message: { role, content: [{ type: 'text', text }] } });
    const records = [
      record('user', '[Context: session-mode=research]\n\nKeep my first question'),
      record('assistant', 'Keep my first reply'),
      ...Array.from({ length: 33 }, (_, index) => [
        { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: `call-${index}`, name: 'bash', arguments: { command: `echo ${index}` } }] } },
        { type: 'message', message: { role: 'toolResult', toolCallId: `call-${index}`, toolName: 'bash', content: [{ type: 'text', text: `Result ${index}` }] } },
      ]).flat(),
      record('assistant', 'Final reply'),
    ].flatMap<any>(normalizePiSessionRecord);
    const initial = records.slice(0, 2);
    const snapshot = await loadTranscriptWindow({ start: 0, fetchPage: async (limit) => ({
      messages: records.slice(-limit), total: records.length, hasMore: records.length > limit,
    }) });
    const messages = convertSessionMessages(reconcilePersistedSessionMessages(initial, snapshot.messages));

    expect(messages[0]).toMatchObject({ type: 'user', content: 'Keep my first question' });
    expect(messages[1]).toMatchObject({ type: 'assistant', content: 'Keep my first reply' });
    expect(messages.at(-1)?.content).toBe('Final reply');
    expect(messages.filter((message) => message.isToolUse).map((message) => message.toolResult?.content))
      .toEqual(Array.from({ length: 33 }, (_, index) => `Result ${index}`));
  });

  it('displays search paths, task ids and todo envelopes without losing native data', () => {
    expect(TOOL_CONFIGS.Grep.result?.getContentProps?.({ content: 'src/a.js:10:match\nsrc/b.js:11:match' }).files).toEqual(['src/a.js', 'src/b.js']);
    expect(TOOL_CONFIGS.Glob.result?.getContentProps?.({ toolUseResult: { filenames: ['a.js'] } }).files).toEqual(['a.js']);
    expect(TOOL_CONFIGS.TaskCreate.input.getValue?.({ title: 'Review code' })).toBe('Review code');
    expect(TOOL_CONFIGS.TaskGet.input.getValue?.({ task_id: 'task-abc' })).toBe('#task-abc');
    expect(TOOL_CONFIGS.TodoRead.result?.getContentProps?.({ content: '{"todos":[{"content":"Review"}]}' }).todos).toHaveLength(1);
    expect(parseTaskContent('[{"id":"task-abc","title":"Review","status":"failed"}]')).toMatchObject([{ id: 'task-abc', subject: 'Review', status: 'failed' }]);
    expect(parseTaskContent('#15. [in_progress] Legacy task')).toMatchObject([{ id: '15', status: 'in_progress' }]);
    expect(shouldHideToolResult('bash', { content: 'PASS', isError: false })).toBe(false);
    expect(shouldHideToolResult('Read', { content: 'File not found', isError: true })).toBe(false);
  });

  it.each(['Task', 'Agent'])('recognizes %s and keeps asynchronous tasks running', (name) => {
    const messages = convertSessionMessages([
      { role: 'assistant', content: [{ type: 'tool_use', id: 'task-call', name, input: { description: 'Review' } }] },
      { type: 'tool_result', toolCallId: 'task-call', output: '{"task_id":"task-abc","status":"running"}' },
    ]);
    expect(messages[0]).toMatchObject({ toolName: 'Task', isSubagentContainer: true, subagentState: { isComplete: false, status: 'running' } });
  });

  it.each(['failed', 'cancelled', 'interrupted'])('does not show %s subagents as successful', (status) => {
    const toolResult = { content: JSON.stringify({ status }), isError: status === 'failed' };
    expect(isSubagentComplete(toolResult)).toBe(true);
    const html = renderToStaticMarkup(<SubagentContainer toolInput={{ description: 'Review' }} toolResult={toolResult} subagentState={{ childTools: [], currentToolIndex: -1, isComplete: true }} />);
    expect(html).not.toContain('Completed');
    expect(html.toLowerCase()).toContain(status);
  });
});
