import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertNodePtySpawnHelperExecutable,
  ensureNodePtySpawnHelperExecutable,
  getNodePtySpawnHelperPath,
} from '../../scripts/node-pty-spawn-helper.mjs';

const temporaryRoots = [];

async function createHelper(mode = 0o644) {
  const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-node-pty-helper-'));
  temporaryRoots.push(runtimeRoot);
  const helperPath = getNodePtySpawnHelperPath(runtimeRoot, 'arm64');
  await fs.mkdir(path.dirname(helperPath), { recursive: true });
  await fs.writeFile(helperPath, 'helper');
  await fs.chmod(helperPath, mode);
  return { runtimeRoot, helperPath };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('node-pty macOS spawn helper permissions', () => {
  it('repairs a non-executable helper before the Kernel is packaged', async () => {
    const { runtimeRoot, helperPath } = await createHelper(0o644);

    const result = ensureNodePtySpawnHelperExecutable({
      runtimeRoot,
      platform: 'darwin',
      arch: 'arm64',
    });

    expect(result).toMatchObject({ repaired: true, helperPath, previousMode: 0o644, mode: 0o755 });
    expect((await fs.stat(helperPath)).mode & 0o777).toBe(0o755);
  });

  it('rejects a macOS package preflight when the helper cannot execute', async () => {
    const { runtimeRoot } = await createHelper(0o644);

    expect(() => assertNodePtySpawnHelperExecutable({
      runtimeRoot,
      platform: 'darwin',
      arch: 'arm64',
    })).toThrow(/must be executable.*mode 644/i);
  });

  it('accepts an already executable helper without changing it', async () => {
    const { runtimeRoot } = await createHelper(0o755);

    expect(ensureNodePtySpawnHelperExecutable({
      runtimeRoot,
      platform: 'darwin',
      arch: 'arm64',
    })).toMatchObject({ repaired: false, previousMode: 0o755, mode: 0o755 });
  });
});
