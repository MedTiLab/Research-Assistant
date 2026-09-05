import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const waitScript = fileURLToPath(new URL('./wait-for-backend.js', import.meta.url));
const tempDirs = [];
const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function environment() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'medhelp-wait-test-'));
  tempDirs.push(root);
  const shellMarker = path.join(root, 'shell-ran');
  const shellPath = path.join(root, 'fake-shell');
  fs.writeFileSync(shellPath, `#!/bin/sh\ntouch '${shellMarker}'\n`, { mode: 0o755 });
  return {
    root,
    shellMarker,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '1',
      MEDHELP_BACKEND_WAIT_TIMEOUT_MS: '3000',
      MEDHELP_RUNTIME_FILE: path.join(root, 'ports.json'),
      MEDHELP_DATA_DIR: path.join(root, 'data'),
      MEDHELP_LOGIN_SHELL: shellPath,
      MEDHELP_DISABLE_LOGIN_SHELL_ENV_IMPORT: '0',
    },
  };
}

describe('backend startup wait', () => {
  it('uses the runtime port without starting a shell or initializing app data', async () => {
    const test = environment();
    const server = http.createServer((req, res) => {
      res.writeHead(req.url === '/api/auth/status' ? 200 : 404);
      res.end('{}');
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    servers.push(server);
    fs.writeFileSync(test.env.MEDHELP_RUNTIME_FILE, JSON.stringify({ backend: { port: server.address().port, pid: process.pid } }));
    const { stdout, stderr } = await execFileAsync(process.execPath, [waitScript], { env: test.env, timeout: 5000 });
    expect(stdout).toContain('Backend ready');
    expect(stderr).toBe('');
    expect(fs.existsSync(test.shellMarker)).toBe(false);
    expect(fs.existsSync(test.env.MEDHELP_DATA_DIR)).toBe(false);
  });

  it('exits with an explicit error when the backend never becomes ready', async () => {
    const test = environment();
    test.env.MEDHELP_BACKEND_WAIT_TIMEOUT_MS = '100';
    await expect(execFileAsync(process.execPath, [waitScript], { env: test.env, timeout: 5000 }))
      .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('Backend did not become ready within 100ms') });
    expect(fs.existsSync(test.shellMarker)).toBe(false);
  });
});
