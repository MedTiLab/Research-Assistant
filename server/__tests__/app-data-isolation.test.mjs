import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../load-env-file.js', () => ({ loadEnvFile: () => {} }));
let root;
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

it('does not copy a legacy database into a fresh application data directory', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'medhelpsec-isolation-'));
  const oldRoot = path.join(root, '.medhelp');
  const newRoot = path.join(root, '.medhelpsec');
  fs.mkdirSync(oldRoot);
  fs.writeFileSync(path.join(oldRoot, 'auth.db'), 'legacy accounts and projects');
  vi.stubEnv('HOME', root);
  vi.stubEnv('USERPROFILE', root);
  vi.stubEnv('MEDHELP_DATA_DIR', newRoot);
  vi.stubEnv('DATABASE_PATH', '');
  vi.stubEnv('MEDHELP_DISABLE_LOGIN_SHELL_ENV_IMPORT', '1');
  await import('../load-env.js');
  expect(process.env.DATABASE_PATH).toBe(path.join(newRoot, 'auth.db'));
  expect(fs.existsSync(path.join(newRoot, 'auth.db'))).toBe(false);
  expect(fs.readFileSync(path.join(oldRoot, 'auth.db'), 'utf8')).toBe('legacy accounts and projects');
});
