import express from 'express';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import router, { builtInCommandsForProvider } from '../routes/commands.js';

let root, server, base;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-commands-'));
  vi.spyOn(os, 'homedir').mockReturnValue(root);
  const app = express(); app.use(express.json()); app.use(router);
  server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { vi.restoreAllMocks(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
const post = (route, data) => fetch(`${base}/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

describe('Pi command isolation', () => {
  it('filters Pi builtins without changing Claude/Codex or custom command discovery', async () => {
    await fs.mkdir(path.join(root, '.claude', 'commands'), { recursive: true });
    await fs.writeFile(path.join(root, '.claude', 'commands', 'review.md'), '# Review');
    const pi = await (await post('list', { provider: 'pi' })).json();
    expect(pi.builtIn.map((command) => command.name)).toEqual(['/config', '/status']);
    expect(pi.custom.map((command) => command.name)).toContain('/review');
    expect(builtInCommandsForProvider('claude').map((command) => command.name)).toEqual(['/help', '/clear', '/model', '/cost', '/memory', '/config', '/status', '/rewind']);
    expect(builtInCommandsForProvider('codex')).toEqual(builtInCommandsForProvider('claude'));
  });
  it('rejects a directly submitted Pi rewind but preserves the Claude response', async () => {
    const rejected = await post('execute', { commandName: '/rewind', context: { provider: 'pi' } });
    expect(rejected.status).toBe(400);
    expect((await rejected.json()).message).toContain('not supported in Pi');
    const claude = await post('execute', { commandName: '/rewind', context: { provider: 'claude' } });
    expect(await claude.json()).toMatchObject({ action: 'rewind', data: { steps: 1 } });
  });
});
