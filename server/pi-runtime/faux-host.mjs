#!/usr/bin/env node

import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import readline from 'readline';

const PROTOCOL_VERSION = Number(process.env.PI_FAUX_PROTOCOL_VERSION || 1);
const BEHAVIOR = process.env.PI_FAUX_HOST_BEHAVIOR || 'normal';
let initialized = false;
let activeTurn = null;
let lastSessionId = null;

function send(payload, lineEnding = '\n') {
  process.stdout.write(`${JSON.stringify(payload)}${lineEnding}`);
}

function respond(id, result) {
  send({ id, ok: true, result });
}

function reject(id, code, message) {
  send({ id, ok: false, error: { code, message } });
}

function emit(event, sessionId, data = {}) {
  send({ event, sessionId, data });
}

async function appendRecords(sessionPath, records) {
  if (!sessionPath) throw new Error('sessionPath is required');
  await fs.mkdir(path.dirname(sessionPath), { recursive: true, mode: 0o700 });
  const payload = records.map((record) => JSON.stringify(record)).join('\n');
  await fs.appendFile(sessionPath, `${payload}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function readRecoverableRecords(sessionPath) {
  try {
    const contents = await fs.readFile(sessionPath, 'utf8');
    const lines = contents.split(/\r?\n/);
    if (!lines.at(-1)) lines.pop();
    return lines.map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        if (index === lines.length - 1) return null;
        throw error;
      }
    }).filter(Boolean);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function resolveSessionId(requested) {
  const value = typeof requested === 'string' ? requested.trim() : '';
  if (value && !value.startsWith('new-session-')) return value;
  return crypto.randomUUID();
}

function completeTurn(turn) {
  if (!activeTurn || activeTurn !== turn || turn.finished) return;
  turn.finished = true;
  activeTurn = null;
  const combinedPrompt = turn.prompts.join('\n');
  const text = `Faux Pi: ${combinedPrompt}`;
  const usage = {
    input_tokens: Math.max(1, Math.ceil(combinedPrompt.length / 4)),
    output_tokens: Math.max(1, Math.ceil(text.length / 4)),
    reasoning_tokens: 0,
  };
  Promise.resolve()
    .then(() => appendRecords(turn.sessionPath, [
      { type: 'assistant', sessionId: turn.sessionId, content: text, createdAt: new Date().toISOString() },
      { type: 'usage', sessionId: turn.sessionId, usage, createdAt: new Date().toISOString() },
    ]))
    .then(() => {
      emit('text_delta', turn.sessionId, { text });
      emit('usage', turn.sessionId, usage);
      emit('turn_completed', turn.sessionId, { status: 'completed' });
      respond(turn.requestId, { sessionId: turn.sessionId, status: 'completed', usage });
    })
    .catch((error) => reject(turn.requestId, 'PI_HOST_PROTOCOL_ERROR', error.message));
}

async function startPrompt(request, resume) {
  if (activeTurn) {
    reject(request.id, 'AGENT_TURN_ALREADY_ACTIVE', 'A faux Pi turn is already active.');
    return;
  }
  const params = request.params || {};
  const sessionId = resolveSessionId(params.sessionId);
  if (resume) {
    const records = await readRecoverableRecords(params.sessionPath);
    if (!records.some((record) => record.sessionId === sessionId)) {
      reject(request.id, 'PI_SESSION_NOT_FOUND', `Pi session "${sessionId}" was not found.`);
      return;
    }
  }
  lastSessionId = sessionId;
  await appendRecords(params.sessionPath, [
    ...(resume ? [] : [{ type: 'session_start', sessionId, modelId: params.modelId || 'pi-faux-v1' }]),
    { type: 'user', sessionId, content: String(params.prompt || ''), createdAt: new Date().toISOString() },
  ]);
  emit('session_started', sessionId, { resumed: resume });
  const turn = {
    requestId: request.id,
    sessionId,
    sessionPath: params.sessionPath,
    prompts: [String(params.prompt || '')],
    finished: false,
    timer: null,
  };
  activeTurn = turn;
  const delayMs = Number.isFinite(params.delayMs) ? Math.max(0, params.delayMs) : 0;
  turn.timer = setTimeout(() => completeTurn(turn), delayMs);
}

async function handleRequest(request) {
  if (!request || typeof request !== 'object' || typeof request.id !== 'string') return;
  if (request.method === 'initialize') {
    if (BEHAVIOR === 'startup-hang') return;
    if (BEHAVIOR === 'invalid-json') {
      process.stdout.write('{not-json}\n');
      return;
    }
    if (BEHAVIOR === 'crash') {
      process.exit(19);
      return;
    }
    if (BEHAVIOR === 'stderr-flood') {
      process.stderr.write('x'.repeat(1024 * 1024));
      return;
    }
    if (BEHAVIOR === 'stdout-flood') {
      process.stdout.write(`${'x'.repeat(1024 * 1024)}\n`);
      return;
    }
    initialized = true;
    respond(request.id, {
      protocolVersion: PROTOCOL_VERSION,
      provider: 'faux',
      state: 'ready',
    });
    return;
  }
  if (!initialized) {
    reject(request.id, 'PI_HOST_PROTOCOL_ERROR', 'Host is not initialized.');
    return;
  }

  if (request.method === 'prompt' || request.method === 'resume') {
    await startPrompt(request, request.method === 'resume');
    return;
  }
  if (request.method === 'steer') {
    if (!activeTurn || activeTurn.finished) {
      respond(request.id, { accepted: false });
      return;
    }
    const prompt = String(request.params?.prompt || '');
    activeTurn.prompts.push(prompt);
    await appendRecords(activeTurn.sessionPath, [{
      type: 'steer',
      sessionId: activeTurn.sessionId,
      content: prompt,
      createdAt: new Date().toISOString(),
    }]);
    emit('steering_received', activeTurn.sessionId, { prompt });
    respond(request.id, { accepted: true });
    return;
  }
  if (request.method === 'abort') {
    const turn = activeTurn;
    if (!turn || turn.finished) {
      respond(request.id, { aborted: false });
      return;
    }
    clearTimeout(turn.timer);
    turn.finished = true;
    activeTurn = null;
    await appendRecords(turn.sessionPath, [{
      type: 'turn_aborted',
      sessionId: turn.sessionId,
      createdAt: new Date().toISOString(),
    }]);
    emit('turn_aborted', turn.sessionId, { status: 'aborted' });
    respond(request.id, { aborted: true });
    reject(turn.requestId, 'PI_TURN_ABORTED', 'Pi turn was aborted.');
    return;
  }
  if (request.method === 'get_state') {
    respond(request.id, {
      state: activeTurn ? 'running' : 'idle',
      sessionId: activeTurn?.sessionId || lastSessionId,
      protocolVersion: PROTOCOL_VERSION,
    });
    return;
  }
  if (request.method === 'compact') {
    const params = request.params || {};
    const records = await readRecoverableRecords(params.sessionPath);
    const compacted = {
      type: 'compaction',
      sessionId: params.sessionId || lastSessionId,
      messageCount: records.filter((record) => ['user', 'assistant'].includes(record.type)).length,
      createdAt: new Date().toISOString(),
    };
    await appendRecords(params.sessionPath, [compacted]);
    respond(request.id, compacted);
    return;
  }
  reject(request.id, 'PI_HOST_PROTOCOL_ERROR', `Unknown Pi RPC method "${request.method}".`);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    send({ id: 'invalid', ok: false, error: { code: 'PI_HOST_PROTOCOL_ERROR', message: 'Invalid JSON request.' } });
    return;
  }
  Promise.resolve(handleRequest(request)).catch((error) => {
    reject(request.id, 'PI_HOST_PROTOCOL_ERROR', error?.message || 'Faux Pi Host failed.');
  });
});

input.once('close', () => {
  if (activeTurn?.timer) clearTimeout(activeTurn.timer);
  process.exit(0);
});
