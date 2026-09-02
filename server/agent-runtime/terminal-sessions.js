import crypto from 'node:crypto';
import pty from 'node-pty';
import { authorizePiBashInput } from '../pi-runtime/tool-policy.js';
import { mutateServiceState, readServiceState, serviceStatePath } from './durable-store.js';

// Shared with the existing interactive WebSocket terminal infrastructure.
export const ptySessionsMap = new Map();
const terminalKey = (identity, id) => JSON.stringify(['agent', identity.ownerKey, identity.projectKey, identity.sessionId, id]);
const MAX_OUTPUT = 128_000;
const READ_LIMIT = 16_000;
const safeEnv = () => Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TEMP', 'LANG', 'LC_ALL'].filter((key) => typeof process.env[key] === 'string').map((key) => [key, process.env[key]]));

export function createAgentTerminalSessions({ spawn = pty.spawn, sessions = ptySessionsMap, idleMs = 30 * 60_000 } = {}) {
  const owned = new Set();
  const keyFor = (context, id) => terminalKey(context.identity, id);
  const fileFor = (context) => serviceStatePath(context.identity, 'terminals', context.storageOptions);
  const save = (context, record) => mutateServiceState(fileFor(context), (rows) => [
    ...rows.filter((row) => row.id !== record.data.id), record.data,
  ].slice(-100));
  const touch = (context, key, record) => {
    clearTimeout(record.timeoutId);
    record.timeoutId = setTimeout(() => {
      record.data.status = 'timed_out';
      record.pty.kill();
      sessions.delete(key);
      save(context, record).catch(() => {});
    }, idleMs);
    record.timeoutId.unref?.();
  };
  const snapshot = (data, cursor = 0) => {
    const start = Math.max(data.offset, Math.min(Number(cursor) || 0, data.offset + data.output.length));
    const output = data.output.slice(start - data.offset, start - data.offset + READ_LIMIT);
    return { ...data, output, cursor: start + output.length, truncated: Number(cursor) < data.offset };
  };
  return {
    async execute(name, input, context) {
      if (name === 'terminal_open') {
        authorizePiBashInput({ command: input.command });
        const owner = context.identity.ownerKey;
        if ([...sessions.values()].filter((record) => record.agentOwner === owner && record.data?.status === 'running').length >= 4) throw new Error('At most four agent terminals may run per user');
        const id = crypto.randomUUID();
        const key = keyFor(context, id);
        const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
        const args = process.platform === 'win32' ? ['/d', '/s', '/c', input.command] : ['--noprofile', '--norc', '-c', input.command];
        const processHandle = spawn(shell, args, { name: 'xterm-256color', cols: 120, rows: 30, cwd: context.projectRoot, env: { ...safeEnv(), TERM: 'xterm-256color' } });
        const record = { pty: processHandle, agentOwner: owner, data: { id, terminal_id: id, sessionId: context.identity.sessionId, title: String(input.title || input.command).slice(0, 200), command: input.command, status: 'running', output: '', offset: 0, createdAt: new Date().toISOString() } };
        sessions.set(key, record);
        owned.add(key);
        let saveTimer;
        processHandle.onData((text) => {
          record.data.output += text;
          if (record.data.output.length > MAX_OUTPUT) {
            record.data.offset += record.data.output.length - MAX_OUTPUT;
            record.data.output = record.data.output.slice(-MAX_OUTPUT);
          }
          if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; save(context, record).catch(() => {}); }, 250);
          saveTimer?.unref?.();
        });
        processHandle.onExit(({ exitCode, signal }) => {
          clearTimeout(saveTimer);
          clearTimeout(record.timeoutId);
          record.data = { ...record.data, status: record.data.status === 'running' ? 'exited' : record.data.status, exitCode, signal, completedAt: new Date().toISOString() };
          sessions.delete(key);
          owned.delete(key);
          save(context, record).catch(() => {});
        });
        touch(context, key, record);
        try { await save(context, record); }
        catch (error) { clearTimeout(record.timeoutId); record.data.status = 'failed'; record.pty.kill(); sessions.delete(key); owned.delete(key); throw error; }
        return snapshot(record.data);
      }
      const rows = (await readServiceState(fileFor(context))).filter((row) => row.sessionId === context.identity.sessionId);
      if (name === 'terminal_list') return rows.map((row) => {
        const { output, ...metadata } = row;
        return { ...metadata, status: row.status === 'running' && !sessions.has(keyFor(context, row.id)) ? 'interrupted' : row.status };
      });
      const key = keyFor(context, input.terminal_id);
      const record = sessions.get(key);
      const stored = rows.find((row) => row.id === input.terminal_id);
      if (!record && !stored) throw new Error('Terminal not found in this conversation');
      if (name === 'terminal_read') {
        if (record) {
          touch(context, key, record);
          const wait = Math.max(0, Math.min(Number(input.wait_ms) || 0, 5000));
          if (wait && Number(input.cursor) >= record.data.offset + record.data.output.length) await new Promise((resolve) => setTimeout(resolve, wait));
        }
        return snapshot(record?.data || { ...stored, status: stored.status === 'running' ? 'interrupted' : stored.status }, input.cursor);
      }
      if (!record) throw new Error('Terminal is no longer running; it will not be restarted automatically');
      if (name === 'terminal_write') {
        if (typeof input.input !== 'string' || input.input.length > 16_000 || input.input.includes('\0')) throw new Error('Invalid terminal input');
        if (input.input.trim() && input.input !== '\u0003') authorizePiBashInput({ command: input.input });
        record.pty.write(input.input);
        touch(context, key, record);
      } else if (name === 'terminal_close') {
        record.data.status = 'cancelled';
        clearTimeout(record.timeoutId);
        record.pty.kill();
        sessions.delete(key);
        await save(context, record);
      } else throw new Error('Unknown terminal operation');
      return snapshot(record.data);
    },
    async shutdown() {
      for (const key of owned) {
        const record = sessions.get(key);
        if (record) { clearTimeout(record.timeoutId); record.data.status = 'interrupted'; record.pty.kill(); sessions.delete(key); }
      }
      owned.clear();
    },
  };
}

export async function listAgentTerminalWork(identity, options = {}) {
  const rows = await readServiceState(serviceStatePath(identity, 'terminals', options));
  return rows.map((row) => ({
    id: row.id, title: row.title, sessionId: row.sessionId, projectKey: identity.projectKey, runtimeId: 'pi',
    status: row.status === 'running' && !ptySessionsMap.has(terminalKey({ ...identity, sessionId: row.sessionId }, row.id)) ? 'interrupted' : row.status,
    updatedAt: row.completedAt || row.createdAt, terminal: true,
  }));
}
