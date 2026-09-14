import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getRuntimeSessionFilePath } from '../utils/storagePaths.js';
import { indexAutomationSession, readAutomationResult } from '../agent-runtime/automation-results.js';
import { syncPiSessionIndex } from '../pi-runtime/session-index.js';

let root, database;
const identity = { ownerKey: 'automation-test-owner', projectKey: 'project', runtimeId: 'pi', sessionId: 'run-1' };
const record = { id: 'automation-1', title: '每周文献', identity };
const run = { sessionId: identity.sessionId, startedAt: '2030-01-01T00:00:00Z', status: 'running' };
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'automation-index-'));
  vi.stubEnv('DATABASE_PATH', path.join(root, 'auth.db'));
  vi.stubEnv('MEDHELP_DATA_DIR', root);
  vi.resetModules();
  database = await import('../database/db.js');
  await database.initializeDatabase();
});
afterEach(async () => {
  database?.closeDatabase();
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});
it('indexes background conversations, recovers their result, and preserves titles through ordinary chat sync', async () => {
  const options = { dataDir: root };
  await indexAutomationSession(record, run, options);
  expect(database.sessionDb.getSessionByIdentity(identity)).toMatchObject({ display_name: expect.stringContaining('[自动化] 每周文献'), message_count: 0 });
  expect(database.sessionDb.getSessionByIdentity({ ...identity, ownerKey: 'other-owner' })).toBeFalsy();
  const file = getRuntimeSessionFilePath(identity, options);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, [
    { type: 'message', timestamp: run.startedAt, message: { role: 'user', content: '检索文献' } },
    { type: 'message', timestamp: run.startedAt, message: { role: 'assistant', content: [{ type: 'text', text: '# 自动报告' }], stopReason: 'stop' } },
  ].map((row) => JSON.stringify(row)).join('\n') + '\n');
  await indexAutomationSession(record, { ...run, status: 'completed' }, options);
  await syncPiSessionIndex(identity, { sessionDb: database.sessionDb, storageOptions: options });
  expect(database.sessionDb.getSessionByIdentity(identity)).toMatchObject({ display_name: expect.stringContaining('[自动化] 每周文献'), message_count: 2, metadata: { displayNameSource: 'automation' } });
  database.sessionDb.updateSessionName(identity, '用户改的标题');
  await indexAutomationSession(record, { ...run, status: 'completed' }, options);
  await syncPiSessionIndex(identity, { sessionDb: database.sessionDb, storageOptions: options });
  expect(database.sessionDb.getSessionByIdentity(identity).display_name).toBe('用户改的标题');
  await fs.rm(file);
  expect(await readAutomationResult(identity, options)).toMatchObject({ markdown: '# 自动报告', sessionExists: false });
});
