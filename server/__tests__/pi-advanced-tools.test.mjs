import http from 'node:http';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPiRuntime } from '../agent-runtime/pi-runtime.js';
import { createPiHostManager } from '../pi-runtime/host-manager.js';
import { createAgentToolServices } from '../agent-runtime/tool-services.js';
import { readAgentRuntimeState } from '../agent-runtime/state-store.js';
import { createPiHostSessionStore, readPiSessionRecords } from '../pi-runtime/session-store.js';

const runtimeRoot = process.env.MEDHELP_PI_TEST_RUNTIME_ROOT;
const suite = runtimeRoot ? describe : describe.skip;
let root, upstream, runtime, requests;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-advanced-')); requests = []; });
afterEach(async () => { await runtime?.native.shutdown(); if (upstream) await new Promise((resolve) => upstream.close(resolve)); await fs.rm(root, { recursive: true, force: true }); runtime = null; upstream = null; });

async function setup(script, { mode = 'plan', approve = true, toolServices, hostEnv = {} } = {}) {
  upstream = http.createServer((request, response) => {
    let body = ''; request.setEncoding('utf8'); request.on('data', (data) => { body += data; });
    request.on('end', () => {
      requests.push(JSON.parse(body));
      const step = script(requests.length - 1, requests.at(-1));
      if (step?.error) { response.writeHead(400, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { message: step.error, type: 'invalid_request_error' } })); return; }
      const delta = step?.name ? { role: 'assistant', tool_calls: [{ index: 0, id: `call-${requests.length}`, type: 'function', function: { name: step.name, arguments: JSON.stringify(step.input) } }] } : { role: 'assistant', content: 'Complete' };
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const choice of [{ index: 0, delta, finish_reason: null }, { index: 0, delta: {}, finish_reason: step?.name ? 'tool_calls' : 'stop' }]) response.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [choice] })}\n\n`);
      if (step?.usage) response.write(`data: ${JSON.stringify({ id: 'test', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: step.usage, completion_tokens: 1, total_tokens: step.usage + 1 } })}\n\n`);
      response.end('data: [DONE]\n\n');
    });
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const identity = { ownerKey: 'test', projectKey: 'project', sessionId: 'advanced', runtimeId: 'pi' };
  runtime = createPiRuntime({ hostManager: createPiHostManager({ hostPath: path.join(runtimeRoot, 'sdk-host.mjs'), configRoot: path.join(root, 'config'), hostEnv }), resourceResolver: async () => ({ skills: [], mcpServers: [] }), toolServices });
  const options = { identity, projectPath: root, storageOptions: { dataDir: root }, permissionMode: mode, piProviderEnv: { MEDHELP_PI_PROVIDER: 'local-openai-compatible', MEDHELP_PI_MODEL: 'test-model', MEDHELP_PI_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1` } };
  const approvals = [];
  const writer = { send: (event) => {
    if (event.type !== 'agent-permission-request') return;
    approvals.push(event);
    queueMicrotask(() => runtime.native.resolveToolApproval(event.requestId, { allow: typeof approve === 'function' ? approve(event) : approve }, { ownerKey: 'test' }));
  } };
  return { identity, options, approvals, writer };
}
const call = (name, input) => ({ name: 'tool_call', input: { name, arguments: input } });

suite('Pi advanced tool end-to-end', () => {
  it('branches the real SDK transcript, switches both ways after reopening and never reverts files', async () => {
    const { options, identity } = await setup(() => null);
    const evidence = path.join(root, 'keep.txt'); await fs.writeFile(evidence, 'disk state must stay');
    await runtime.start('COMMON_FIRST', options);
    await runtime.resume('ORIGINAL_SECOND', options);
    const forkPoints = await runtime.native.forkPoints(identity, options);
    expect(forkPoints.map((point) => point.preview)).toEqual(['COMMON_FIRST', 'ORIGINAL_SECOND']);
    const forked = await runtime.native.forkSession(identity, { pointId: forkPoints[0].id }, options);
    const forkedTranscript = await createPiHostSessionStore(options.storageOptions).read({ ...identity, sessionId: forked.sessionId });
    expect(JSON.stringify(forkedTranscript.messages)).toContain('COMMON_FIRST');
    expect(JSON.stringify(forkedTranscript.messages)).not.toContain('ORIGINAL_SECOND');
    const before = await runtime.native.branches(identity, options);
    const forkPoint = before.messages.find((message) => message.role === 'assistant').id;
    const created = await runtime.native.changeBranch(identity, 'create', { entryId: forkPoint, label: 'Alternative' }, options);
    expect(created.branches).toHaveLength(2);
    expect(created.branches.find((branch) => branch.id === created.activeBranchId)).toMatchObject({ parentId: 'main', fromEntryId: forkPoint });
    expect(created.filesReverted).toBe(false);
    await runtime.resume('ALTERNATE_SECOND', options);
    const store = createPiHostSessionStore(options.storageOptions);
    const alternate = await store.read(identity);
    expect(JSON.stringify(alternate.messages)).toContain('ALTERNATE_SECOND');
    expect(JSON.stringify(alternate.messages)).not.toContain('ORIGINAL_SECOND');
    expect(JSON.stringify(requests.at(-1).messages)).not.toContain('ORIGINAL_SECOND');
    await runtime.native.changeBranch(identity, 'switch', { branchId: 'main' }, options);
    const original = await store.read(identity);
    expect(original.branchState.activeBranchId).toBe('main');
    expect(JSON.stringify(original.messages)).toContain('ORIGINAL_SECOND');
    expect(JSON.stringify(original.messages)).not.toContain('ALTERNATE_SECOND');
    await runtime.native.changeBranch(identity, 'switch', { branchId: created.activeBranchId }, options);
    const restored = await runtime.native.branches(identity, options);
    expect(restored.activeBranchId).toBe(created.activeBranchId);
    expect(restored.branches).toHaveLength(2);
    await expect(runtime.native.changeBranch(identity, 'create', { entryId: 'unknown' }, options)).rejects.toThrow('complete user or assistant');
    expect(await fs.readFile(evidence, 'utf8')).toBe('disk state must stay');
  }, 25000);
  it('restores the selected branch todos and plan for both the UI and subsequent tools', async () => {
    const todos = [{ content: 'MAIN_TODO', status: 'in_progress' }];
    const { options, identity } = await setup((index) => ({
      1: { name: 'todo_write', input: { todos } },
      2: { name: 'plan_update', input: { title: 'Main plan', plan: 'MAIN_PLAN' } },
      4: { name: 'todo_read', input: {} },
    })[index]);
    await runtime.start('Common starting point', options);
    await runtime.resume('Create main todo and plan', options);
    const initialState = await runtime.native.sessionState(identity, options);
    const forkPoint = (await runtime.native.branches(identity, options)).messages.find((message) => message.role === 'assistant').id;
    const alternate = await runtime.native.changeBranch(identity, 'create', { entryId: forkPoint }, options);
    expect(await runtime.native.sessionState(identity, options)).toMatchObject({ todos: [], plan: null });
    await runtime.resume('Read this branch todos', options);
    expect(requests.at(-1).messages.filter((message) => message.role === 'tool').at(-1).content).toBe('[]');
    await runtime.native.changeBranch(identity, 'switch', { branchId: 'main' }, options);
    expect(await runtime.native.sessionState(identity, options)).toMatchObject({ todos: initialState.todos, plan: initialState.plan });
    expect((await createPiHostSessionStore(options.storageOptions).read(identity)).agentState).toMatchObject({ todos: initialState.todos, plan: initialState.plan });
    await runtime.native.changeBranch(identity, 'switch', { branchId: alternate.activeBranchId }, options);
    expect(await runtime.native.sessionState(identity, options)).toMatchObject({ todos: [], plan: null });
  }, 25000);
  it('spills full bash output within the project, tightens the session budget across turns and reads it back', async () => {
    const { options } = await setup((index, payload) => {
      if ([0, 1, 3].includes(index)) return { name: 'bash', input: { command: `node -e "process.stdout.write('A'.repeat(100000)+'TAIL')"` } };
      if (index === 4) {
        const result = payload.messages.filter((message) => message.role === 'tool').at(-1).content;
        return { name: 'read', input: { path: result.match(/Full content: (.+?)\. Use read/)[1], offset: 1, limit: 1 } };
      }
      return null;
    }, { mode: 'auto', hostEnv: { MEDHELP_PI_OUTPUT_MAX_BYTES: '8192', MEDHELP_PI_OUTPUT_SESSION_BYTES: '10000', MEDHELP_PI_OUTPUT_TIGHT_BYTES: '2048' } });
    const events = [];
    await runtime.start('Large results', options, { send: (event) => events.push(event) });
    expect(events.some((event) => event.data?.event === 'tool_updated' && event.data.data.output.includes('AAAA'))).toBe(true);
    await runtime.resume('Another result', options);
    const contents = requests.at(-1).messages.filter((message) => message.role === 'tool').map((message) => message.content);
    expect(contents[0]).toContain('limit 8192');
    expect(contents[2]).toContain('session budget reached; tightened per-tool limit 2048');
    expect(contents[3]).toContain('Output truncated');
    const fullPath = contents[0].match(/Full content: (.+?)\. Use read/)[1];
    expect(fullPath.startsWith(`${await fs.realpath(root)}/.medhelpsec/tool-output/`)).toBe(true);
    expect(await fs.readFile(fullPath, 'utf8')).toBe('A'.repeat(100000) + 'TAIL');
  }, 25000);

  it('resets persisted output usage only after successful manual compaction and recovers a missing reset marker', async () => {
    let mainRequest = 0, rejectSummary = true;
    const bash = { name: 'bash', input: { command: `node -e "process.stdout.write('B'.repeat(20000))"` } };
    const { options, identity } = await setup((_index, payload) => {
      if (!payload.tools?.length) return rejectSummary ? bash : null;
      return [1, 2, 4, 6].includes(mainRequest++) ? bash : null;
    }, { mode: 'auto', hostEnv: { MEDHELP_PI_OUTPUT_MAX_BYTES: '8192', MEDHELP_PI_OUTPUT_SESSION_BYTES: '10000', MEDHELP_PI_OUTPUT_TIGHT_BYTES: '2048' } });
    const budget = async () => (await readPiSessionRecords(identity, options.storageOptions)).records.filter((entry) => entry.customType === 'medhelp.output_budget').at(-1)?.data;
    await runtime.start('Earlier context to summarize', options);
    await runtime.resume('CURRENT_CONTEXT '.repeat(7000), options);
    const before = await budget(); expect(before.usedBytes).toBeGreaterThan(10000);
    await expect(runtime.native.compact(identity, options)).rejects.toThrow('Summarization attempted to call a tool');
    expect(await budget()).toEqual(before);
    rejectSummary = false;
    const compacted = await runtime.native.compact(identity, options);
    expect(compacted.context).toMatchObject({ estimated: true, tokens: expect.any(Number), contextWindow: expect.any(Number) });
    expect(compacted.context.tokens).toBeGreaterThan(0);
    expect((await createPiHostSessionStore(options.storageOptions).read(identity)).tokenUsage)
      .toMatchObject({ used: compacted.context.tokens, total: compacted.context.contextWindow, estimated: true });
    expect(await budget()).toMatchObject({ usedBytes: 0, resetReason: 'compaction' });
    await runtime.resume('MORE_CONTEXT '.repeat(8000), options);
    expect(requests.at(-1).messages.filter((message) => message.role === 'tool').at(-1).content).toContain('per-tool limit 8192');
    await runtime.native.compact(identity, options);
    const { records, sessionPath } = await readPiSessionRecords(identity, options.storageOptions);
    const reset = records.findLastIndex((entry) => entry.customType === 'medhelp.output_budget');
    expect(records[reset].data.usedBytes).toBe(0);
    // Simulate a crash after SDK appendCompaction but before our reset marker was appended.
    await fs.writeFile(sessionPath, records.filter((_entry, index) => index !== reset).map((entry) => JSON.stringify(entry)).join('\n') + '\n');
    await runtime.resume('Output after recovered compact', options);
    expect(requests.at(-1).messages.filter((message) => message.role === 'tool').at(-1).content).toContain('per-tool limit 8192');
  }, 25000);

  it.each(['host threshold', 'SDK threshold', 'SDK overflow retry'])('restores output allowance after automatic compaction: %s', async (kind) => {
    let mainRequest = 0;
    const { options, identity } = await setup((_index, payload) => {
      if (!payload.tools?.length) return null;
      const index = mainRequest++;
      if ([1, 2, 4].includes(index)) return { name: 'bash', input: { command: `node -e "process.stdout.write('A'.repeat(20000))"` } };
      if (index === 3) return kind === 'SDK overflow retry' ? { error: 'maximum context length exceeded' } : { usage: kind === 'SDK threshold' ? 120000 : 70000 };
      return null;
    }, { mode: 'auto', hostEnv: { MEDHELP_PI_OUTPUT_MAX_BYTES: '8192', MEDHELP_PI_OUTPUT_SESSION_BYTES: '10000', MEDHELP_PI_OUTPUT_TIGHT_BYTES: '2048' } });
    await runtime.start('Earlier context to summarize', options);
    const events = [];
    await runtime.resume('CURRENT_CONTEXT '.repeat(7000), options, { send: (event) => events.push(event) });
    const reason = kind === 'host threshold' ? 'manual' : kind === 'SDK threshold' ? 'threshold' : 'overflow';
    expect(events.some((event) => event.data?.event === 'auto_compaction_end' && event.data.data.reason === reason && event.data.data.success), JSON.stringify(events.filter((event) => event.data?.event?.includes('compaction')))).toBe(true);
    const displayedContext = events.filter((event) => event.data?.event === 'usage').at(-1).data.data.context;
    expect(displayedContext.tokens).toBeGreaterThan(0);
    expect(displayedContext.contextWindow).toBeGreaterThan(0);
    expect((await createPiHostSessionStore(options.storageOptions).read(identity)).tokenUsage)
      .toMatchObject({ used: displayedContext.tokens, total: displayedContext.contextWindow, estimated: Boolean(displayedContext.estimated) });
    if (kind !== 'SDK overflow retry') await runtime.resume('Output after automatic compact', options);
    // Overflow retry runs this tool inside the same Host: the live closure must reset too.
    expect(requests.at(-1).messages.filter((message) => message.role === 'tool').at(-1).content).toContain('per-tool limit 8192');
    const { records } = await readPiSessionRecords(identity, options.storageOptions);
    expect(records.some((entry) => entry.type === 'compaction')).toBe(true);
    expect(records.some((entry) => entry.customType === 'medhelp.output_budget' && entry.data.resetReason === 'compaction' && entry.data.usedBytes === 0)).toBe(true);
  }, 25000);

  it('reads PDF and Office text through read, rejects escaped paths and reports extraction failures', async () => {
    const { default: PDFDocument } = await import('pdfkit');
    const { Document, Packer, Paragraph } = await import('docx');
    const { default: AdmZip } = await import('adm-zip');
    for (const [filename, body] of [['paper.pdf', 'PDF_BODY_SENTINEL'], ['blank.pdf', '']]) {
      const pdf = new PDFDocument(); const chunks = [];
      const ready = new Promise((resolve) => { pdf.on('data', (chunk) => chunks.push(chunk)); pdf.on('end', resolve); });
      if (body) pdf.text(body);
      pdf.end(); await ready;
      await fs.writeFile(path.join(root, filename), Buffer.concat(chunks));
    }
    await fs.writeFile(path.join(root, 'draft.docx'), await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('DOCX_BODY_SENTINEL')] }] })));
    const deck = new AdmZip(); deck.addFile('ppt/slides/slide1.xml', Buffer.from('<p:sld xmlns:a="urn:test"><a:t>PPTX_BODY_SENTINEL</a:t></p:sld>')); deck.writeZip(path.join(root, 'slides.pptx'));
    const workbook = new AdmZip();
    workbook.addFile('xl/workbook.xml', Buffer.from('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>'));
    workbook.addFile('xl/_rels/workbook.xml.rels', Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'));
    workbook.addFile('xl/worksheets/sheet1.xml', Buffer.from('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>XLSX_BODY_SENTINEL</t></is></c></row></sheetData></worksheet>'));
    workbook.writeZip(path.join(root, 'data.xlsx'));
    await fs.writeFile(path.join(root, 'broken.docx'), 'not a document');
    await fs.writeFile(path.join(root, 'broken.pdf'), 'not a PDF');
    const files = ['paper.pdf', 'draft.docx', 'data.xlsx', 'slides.pptx', '../outside.pdf', 'broken.docx', 'blank.pdf', 'broken.pdf'];
    const { options } = await setup((index) => files[index] ? { name: 'read', input: { path: files[index] } } : null);
    await runtime.start('Read documents', options);
    const results = requests.at(-1).messages.filter((message) => message.role === 'tool').map((message) => message.content);
    for (const [index, type] of ['PDF', 'DOCX', 'XLSX', 'PPTX'].entries()) expect(results[index]).toContain(`${type}_BODY_SENTINEL`);
    expect(results[4]).toContain('inside the project');
    expect(results[5]).toContain('Document extraction failed');
    expect(results[6]).toContain('no extractable text');
    expect(results[7]).toContain('Document extraction failed');
    expect((await fs.readdir(path.join(root, '.medhelpsec/tool-output'), { recursive: true })).filter((name) => name.includes('.txt'))).toEqual([]);
    // Exercise the exact bundled worker format shipped by the secure Kernel,
    // outside the source tree so hidden runtime asset dependencies fail here.
    const { build } = await import('esbuild');
    const worker = path.join(root, 'document-worker.cjs');
    await build({ entryPoints: [path.resolve('server/pi-runtime/document-worker.js')], outfile: worker, bundle: true, platform: 'node', format: 'cjs', target: 'node22', minify: true });
    for (const [file, type] of [['paper.pdf', 'PDF'], ['draft.docx', 'DOCX'], ['data.xlsx', 'XLSX'], ['slides.pptx', 'PPTX']]) {
      expect(execFileSync(process.execPath, [worker, path.join(root, file)], { encoding: 'utf8', cwd: root, env: { ...process.env, PATH: root, NODE_PATH: '' }, timeout: 10000 })).toContain(`${type}_BODY_SENTINEL`);
    }
  }, 25000);
  it('keeps partial bash output on timeout and closes its process before completing the result', async () => {
    const { options } = await setup((index) => index === 0 ? { name: 'bash', input: { command: `node -e "console.log('START:'+process.pid);setInterval(()=>{},1000)"`, timeout: 500 } } : null, { mode: 'auto' });
    await runtime.start('Run bounded command', options);
    const result = requests.at(-1).messages.filter((message) => message.role === 'tool').at(-1).content;
    expect(result).toContain('500ms timeout');
    const pid = Number(result.match(/START:(\d+)/)[1]);
    expect(() => process.kill(pid, 0)).toThrow();
    expect(requests[0].tools.find((tool) => tool.function.name === 'bash').function.parameters.properties.timeout.description).toContain('milliseconds');
  }, 10000);

  it('resizes a real image above 8 MB and evicts old images from model context across resumed turns', async () => {
    const { default: sharp } = await import('sharp');
    const { randomBytes } = await import('node:crypto');
    const file = path.join(root, 'screenshot.png');
    await sharp(randomBytes(1800 * 1600 * 3), { raw: { width: 1800, height: 1600, channels: 3 } }).png({ compressionLevel: 0 }).toFile(file);
    expect((await fs.stat(file)).size).toBeGreaterThan(8 * 1024 * 1024);
    const { options } = await setup(() => null, { hostEnv: { MEDHELP_PI_IMAGE_CONTEXT_COUNT: '1' } });
    options.piProviderEnv.MEDHELP_PI_VISION = 'true';
    options.attachments = [
      { name: 'screenshot.png', path: file, kind: 'image', mimeType: 'image/png' },
      { name: 'second.png', path: file, kind: 'image', mimeType: 'image/png' },
    ];
    const events = [];
    await runtime.start('First image', options, { send: (event) => events.push(event) });
    await runtime.resume('Second image', options);
    await runtime.resume('Third image', options);
    expect(events.find((event) => event.data?.event === 'attachment_delivery').data.data.attachments[0]).toMatchObject({ status: 'sent', resized: true });
    expect(events.find((event) => event.data?.event === 'attachment_delivery').data.data.attachments[1]).toMatchObject({ status: 'not_sent', reason: 'image_context_limit' });
    for (const request of requests) expect(JSON.stringify(request.messages).match(/data:image\/jpeg;base64,/g)).toHaveLength(1);
    expect(JSON.stringify(requests.at(-1).messages)).toContain('Earlier image omitted');
    expect((await fs.stat(file)).size).toBeGreaterThan(8 * 1024 * 1024);
  }, 25000);
  it('spills oversized service errors before Host IPC without hiding or losing the error', async () => {
    const errorText = `${'REMOTE_ERROR '.repeat(100000)}FINAL_ERROR_SENTINEL`;
    const toolServices = createAgentToolServices({ memory: { execute: async () => { throw new Error(errorText); } } });
    const { options } = await setup((index) => index === 0 ? call('memory_retrieve', {}) : null, { toolServices });
    const events = [];
    await runtime.start('Retrieve evidence', options, { send: (event) => events.push(event) });
    const result = requests.at(-1).messages.filter((message) => message.role === 'tool').at(-1).content;
    expect(result).toContain('Error output truncated for transport');
    expect(events.find((event) => event.data?.event === 'tool_completed').data.data.isError).toBe(true);
    const file = result.match(/Full content: (.+?)\. Use read/)[1];
    expect(await fs.readFile(file, 'utf8')).toBe(errorText);
  }, 15000);
  it('requires formal plan approval, switches to Ask, then separately approves an actual write', async () => {
    const steps = [
      { name: 'plan_update', input: { title: 'Create output', plan: '1. Write result.txt\n2. Read back and verify.' } },
      { name: 'exit_plan_mode', input: {} },
      { name: 'write', input: { path: 'result.txt', content: 'approved result' } },
    ];
    const { options, identity, writer, approvals } = await setup((index) => steps[index]);
    await runtime.start('Plan and implement', options, writer);
    expect(approvals.map((request) => request.toolName), JSON.stringify(requests.at(-1).messages).slice(-6000)).toEqual(['ExitPlanMode', 'Write']);
    expect(approvals[0].input).toMatchObject({ revision: 1, plan: steps[0].input.plan });
    expect(requests[0].tools.some((tool) => tool.function.name === 'write')).toBe(false);
    expect(requests[2].tools.some((tool) => tool.function.name === 'write')).toBe(true);
    expect(await fs.readFile(path.join(root, 'result.txt'), 'utf8')).toBe('approved result');
    expect((await readAgentRuntimeState(identity, { dataDir: root })).plan.status).toBe('approved');
    const transcript = await createPiHostSessionStore({ dataDir: root }).read(identity);
    expect(JSON.stringify(transcript.messages)).toContain('Read back and verify');
  }, 25_000);

  it('keeps mutation blocked after rejected approval, even through a deferred gateway', async () => {
    const steps = [
      { name: 'plan_update', input: { title: 'Denied', plan: 'Create a terminal.' } },
      { name: 'exit_plan_mode', input: {} },
      call('terminal_open', { command: 'printf should-not-run' }),
    ];
    const { options, identity, writer, approvals } = await setup((index) => steps[index], { approve: false });
    await runtime.start('Plan only', options, writer);
    expect(approvals.map((request) => request.toolName)).toEqual(['ExitPlanMode']);
    expect((await readAgentRuntimeState(identity, { dataDir: root })).plan.status).toBe('rejected');
    expect(JSON.stringify(requests.at(-1).messages)).toContain('Submit the plan for approval');
  }, 25_000);

  it('keeps a PTY alive between Pi hosts and routes Memory to the existing adapter', async () => {
    let terminalId;
    let retrieved = 0;
    const services = createAgentToolServices({ memory: { execute: async (name) => { expect(name).toBe('memory_retrieve'); retrieved += 1; return { source: 'existing-memory', memories: ['existing fact'] }; } } });
    const originalExecute = services.execute;
    services.execute = async (...args) => { const result = await originalExecute(...args); if (args[0] === 'terminal_open') terminalId = result.terminal_id; return result; };
    let phase = 0;
    const { options, identity, writer, approvals } = await setup((index) => {
      if (!phase) return index === 0 ? call('terminal_open', { command: 'read value; printf "ROUND:%s" "$value"' }) : null;
      return [call('terminal_write', { terminal_id: terminalId, input: 'continued\n' }), call('terminal_read', { terminal_id: terminalId, wait_ms: 1000 }), call('memory_retrieve', {})][index - 2];
    }, { mode: 'ask', toolServices: services });
    await runtime.start('Start terminal', options, writer);
    expect(terminalId).toBeTruthy();
    phase = 1;
    await runtime.resume('Continue terminal and recall memory', options, writer);
    expect(retrieved).toBe(1);
    expect(approvals.map((request) => request.toolName)).toEqual(['TerminalOpen', 'TerminalWrite']);
    expect(JSON.stringify(requests.at(-1).messages)).toContain('ROUND:continued');
    expect(JSON.stringify(requests.at(-1).messages)).toContain('existing fact');
    expect((await readAgentRuntimeState(identity, { dataDir: root })).contextItems).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'memory_retrieve' })]));
    const restored = await createPiHostSessionStore({ dataDir: root }).read(identity);
    const toolUses = restored.messages.flatMap((message) => Array.isArray(message.content) ? message.content.filter((part) => part.type === 'tool_use') : []);
    expect(toolUses.map((part) => part.name)).toEqual(['TerminalOpen', 'TerminalWrite', 'TerminalRead', 'MemoryRetrieve']);
    expect(restored.messages.filter((message) => message.type === 'tool_result').map((message) => message.toolName)).toEqual(['TerminalOpen', 'TerminalWrite', 'TerminalRead', 'MemoryRetrieve']);
  }, 25_000);
});
