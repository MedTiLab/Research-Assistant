import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import {
  assertSafeArchiveEntries,
  buildRsyncInvocation,
  buildScpInvocation,
  buildSshInvocation,
  cleanPtyOutput,
  createSyncSnapshot,
  diffSyncSnapshots,
  execProcess,
  normalizeSyncEntries,
  runProjectSync,
  shouldExcludeSyncPath,
  terminateActiveComputeProcesses,
} from '../compute-node.js';

afterEach(async () => {
  await terminateActiveComputeProcesses();
});

describe('compute node process invocations', () => {
  it('uses ssh.exe directly for password SSH on Windows without Bash', () => {
    expect(buildSshInvocation({
      host: '192.0.2.10',
      user: 'researcher',
      port: 2222,
      password: 'not-printed',
    }, 'uname -a', 'win32')).toEqual({
      command: 'ssh.exe',
      args: [
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'ConnectTimeout=15',
        '-o', 'ConnectionAttempts=1',
        '-o', 'ServerAliveInterval=15',
        '-o', 'ServerAliveCountMax=3',
        '-p', '2222',
        'researcher@192.0.2.10',
        'uname -a',
      ],
    });
  });

  it('keeps a Windows private-key path as one SSH argument', () => {
    const invocation = buildSshInvocation({
      host: 'compute.example',
      user: 'researcher',
      keyPath: 'C:\\Users\\Research User\\.ssh\\id_ed25519',
    }, 'hostname', 'win32');

    expect(invocation.command).toBe('ssh.exe');
    expect(invocation.args).toEqual(expect.arrayContaining([
      '-o', 'BatchMode=yes',
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=3',
    ]));
    expect(invocation.args).toContain('C:\\Users\\Research User\\.ssh\\id_ed25519');
    expect(invocation.args).not.toContain('bash');
  });

  it('uses built-in scp.exe instead of rsync.exe for Windows synchronization', () => {
    const invocation = buildScpInvocation({
      host: 'compute.example',
      user: 'researcher',
      port: 2222,
      keyPath: 'C:\\Users\\Research User\\.ssh\\id_ed25519',
    }, 'C:\\Research Project\\project.tgz', 'researcher@compute.example:/tmp/project.tgz', 'win32');

    expect(invocation.command).toBe('scp.exe');
    expect(invocation.args).toEqual(expect.arrayContaining([
      '-P', '2222',
      '-o', 'BatchMode=yes',
      '-o', 'ServerAliveInterval=15',
      '-i', 'C:\\Users\\Research User\\.ssh\\id_ed25519',
      'C:\\Research Project\\project.tgz',
      'researcher@compute.example:/tmp/project.tgz',
    ]));
    expect(invocation.command).not.toContain('rsync');
  });

  it('refuses to build an rsync process on Windows', () => {
    expect(() => buildRsyncInvocation({
      host: 'compute.example',
      user: 'researcher',
    }, 'source', 'destination', [], 'win32')).toThrow(/not used for Windows/i);
  });

  it('keeps partial rsync transfers and reports progress without compressing large files', () => {
    const invocation = buildRsyncInvocation({
      host: 'compute.example',
      user: 'researcher',
    }, '/local/project/', 'researcher@compute.example:~/project/', [], 'darwin');

    expect(invocation.args).toEqual(expect.arrayContaining([
      '-a',
      '--partial',
      '--progress',
    ]));
    expect(invocation.args.join(' ')).toContain('-o ServerAliveInterval=15');
    expect(invocation.args).not.toContain('-avz');
    expect(invocation.args).not.toContain('-z');
  });

  it('rejects unsafe download paths and archive entries', () => {
    expect(normalizeSyncEntries(['logs/', 'results/output.csv'])).toEqual(['logs/', 'results/output.csv']);
    expect(() => normalizeSyncEntries(['../secrets'])).toThrow(/unsafe sync path/i);
    expect(() => normalizeSyncEntries(['C:\\Windows\\System32'])).toThrow(/unsafe sync path/i);
    expect(() => assertSafeArchiveEntries('results/output.csv\n../escape.txt')).toThrow(/unsafe path/i);
    expect(() => assertSafeArchiveEntries('logs/run.log\nresults/output.csv')).not.toThrow();
  });

  it('removes password prompts and the password itself from PTY output', () => {
    const output = [
      "researcher@compute.example's password: ",
      'secret-value',
      '=== Connection OK ===',
      'Linux compute 6.8.0 x86_64',
    ].join('\r\n');

    expect(cleanPtyOutput(output, 'secret-value')).toBe([
      '=== Connection OK ===',
      'Linux compute 6.8.0 x86_64',
    ].join('\n'));
  });

  it('terminates a child process when the operation timeout expires', async () => {
    const startedAt = Date.now();
    await expect(execProcess(process.execPath, [
      '-e',
      'setInterval(() => {}, 1000)',
    ], {
      timeoutMs: 50,
      operation: 'Hung test process',
    })).rejects.toMatchObject({
      code: 'COMPUTE_PROCESS_TIMEOUT',
    });
    expect(Date.now() - startedAt).toBeLessThan(3000);
  });

  it('treats transfer timeouts as idle timeouts when progress continues', async () => {
    await expect(execProcess(process.execPath, [
      '-e',
      'let count = 0; const timer = setInterval(() => { process.stdout.write("."); count += 1; if (count === 5) { clearInterval(timer); } }, 150)',
    ], {
      timeoutMs: 500,
      timeoutMode: 'idle',
      operation: 'Progressing transfer',
    })).resolves.toBe('.....');
  });

  it('terminates a child process when the caller cancels the operation', async () => {
    const controller = new AbortController();
    const processPromise = execProcess(process.execPath, [
      '-e',
      'setInterval(() => {}, 1000)',
    ], {
      timeoutMs: 10_000,
      signal: controller.signal,
      operation: 'Cancelled test process',
    });
    controller.abort();
    await expect(processPromise).rejects.toMatchObject({
      name: 'AbortError',
      code: 'COMPUTE_PROCESS_ABORTED',
    });
  });

  it('reclaims an unfinished sync when the same project starts a newer sync', async () => {
    const node = { id: 'node-1' };
    let firstWasCancelled = false;
    const first = runProjectSync(node, '/tmp/project-a', null, async (signal) => (
      await new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          firstWasCancelled = true;
          reject(signal.reason);
        }, { once: true });
      })
    ));
    await Promise.resolve();

    const second = runProjectSync(node, '/tmp/project-a', null, async () => 'new sync completed');

    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(second).resolves.toBe('new sync completed');
    expect(firstWasCancelled).toBe(true);
  });

  it('builds an incremental snapshot and skips excluded large files when unchanged', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-compute-snapshot-'));
    try {
      await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
      await fs.mkdir(path.join(projectRoot, 'node_modules', 'package'), { recursive: true });
      await fs.writeFile(path.join(projectRoot, 'src', 'analysis.py'), 'print("v1")\n');
      await fs.writeFile(path.join(projectRoot, 'model.bin'), Buffer.alloc(1024 * 1024, 7));
      await fs.writeFile(path.join(projectRoot, 'node_modules', 'package', 'index.js'), 'ignored');

      const excludes = ['node_modules', '*.pyc'];
      const first = await createSyncSnapshot(projectRoot, excludes);
      const second = await createSyncSnapshot(projectRoot, excludes);
      expect(diffSyncSnapshots(first, second)).toEqual([]);
      expect(first['model.bin']?.size).toBe(1024 * 1024);
      expect(first['node_modules']).toBeUndefined();

      await new Promise((resolve) => setTimeout(resolve, 10));
      await fs.writeFile(path.join(projectRoot, 'src', 'analysis.py'), 'print("v2 changed")\n');
      const third = await createSyncSnapshot(projectRoot, excludes);
      const changes = diffSyncSnapshots(second, third);
      expect(changes).toContain('src/analysis.py');
      expect(changes).not.toContain('model.bin');
    } finally {
      await fs.rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('matches rsync-style project exclusions at any depth', () => {
    const excludes = ['.git', 'node_modules', '*.db', 'server/data', '.env.*'];
    expect(shouldExcludeSyncPath('nested/node_modules/pkg/index.js', excludes)).toBe(true);
    expect(shouldExcludeSyncPath('server/data/private.sqlite', excludes)).toBe(true);
    expect(shouldExcludeSyncPath('results/cache.db', excludes)).toBe(true);
    expect(shouldExcludeSyncPath('src/database.js', excludes)).toBe(false);
  });
});
