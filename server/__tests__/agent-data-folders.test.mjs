import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getConfiguredAllowedDataFolders,
  withAllowedDataFoldersAgentEnv,
} from '../utils/allowedDataFolders.js';

let root, data, sibling;
const save = (folders) => fs.writeFile(path.join(root, 'project-config.json'), JSON.stringify({ _allowedDataFolders: folders }));
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-data-ro-')));
  data = path.join(root, 'data');
  sibling = path.join(root, 'data-other');
  await Promise.all([data, sibling].map((folder) => fs.mkdir(folder)));
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('authoritative execution-host data folders', () => {
  it('normalizes aliases, deduplicates and ignores missing paths, files and relative paths', async () => {
    const alias = path.join(root, 'alias');
    await fs.symlink(data, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await fs.writeFile(path.join(root, 'file'), 'test');
    await save([data, { path: alias }, path.join(root, 'missing'), path.join(root, 'file'), 'relative', null]);
    expect(getConfiguredAllowedDataFolders({ dataDir: root })).toEqual([data]);
  });
  it('reads changes every turn and removes stale/cloud-provided environment grants', async () => {
    await fs.mkdir(path.join(data, 'database/data/sources'), { recursive: true });
    await fs.writeFile(path.join(data, 'server.js'), '// fixture');
    await save([data]);
    const env = withAllowedDataFoldersAgentEnv({ MEDHELP_ALLOWED_DATA_FOLDERS: JSON.stringify([sibling]), DATABASE_API_TOKEN: 'keep' }, { dataDir: root });
    expect(JSON.parse(env.MEDHELP_ALLOWED_DATA_FOLDERS)).toEqual([data]);
    expect(env.MEDHELP_LOCAL_DATABASE_RAW_ROOT).toBe(path.join(data, 'database/data/sources'));
    expect(env.MEDHELP_LOCAL_DATABASE_APP_ROOT).toBe(data);
    await save([]);
    const refreshed = withAllowedDataFoldersAgentEnv(env, { dataDir: root });
    expect(refreshed).toEqual({ DATABASE_API_TOKEN: 'keep' });
    expect(env.MEDHELP_ALLOWED_DATA_FOLDERS).toBeDefined();
  });
  it('fails closed on malformed config', async () => {
    await fs.writeFile(path.join(root, 'project-config.json'), '{invalid');
    expect(getConfiguredAllowedDataFolders({ dataDir: root })).toEqual([]);
  });
});
