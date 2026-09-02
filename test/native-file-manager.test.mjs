import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildNativeFileManagerLaunch,
  openPathInNativeFileManager,
} from '../server/utils/nativeFileManager.js';

test('builds Windows Explorer launch from SystemRoot', () => {
  const launch = buildNativeFileManagerLaunch('C:\\Users\\Alice\\My Project', {
    isDirectory: true,
    platform: 'win32',
    env: { SystemRoot: 'C:\\Windows' },
  });

  assert.equal(launch.command, 'C:\\Windows\\explorer.exe');
  assert.deepEqual(launch.args, ['C:\\Users\\Alice\\My Project']);
  assert.equal(launch.openedPath, 'C:\\Users\\Alice\\My Project');
});

test('builds Windows Explorer file selection launch', () => {
  const launch = buildNativeFileManagerLaunch('C:\\Users\\Alice\\My Project\\result file.pdf', {
    isDirectory: false,
    platform: 'win32',
    env: { WINDIR: 'C:\\Windows' },
  });

  assert.equal(launch.command, 'C:\\Windows\\explorer.exe');
  assert.deepEqual(launch.args, ['/select,C:\\Users\\Alice\\My Project\\result file.pdf']);
});

test('falls back to explorer.exe when absolute Windows Explorer command cannot spawn', async () => {
  const calls = [];
  const openedPath = await openPathInNativeFileManager(
    'C:\\Users\\Alice\\My Project',
    { isDirectory: () => true },
    {
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows' },
      spawnFn: async (command, args) => {
        calls.push({ command, args });
        if (calls.length === 1) {
          throw Object.assign(new Error('not found'), { code: 'ENOENT' });
        }
      },
    },
  );

  assert.equal(openedPath, 'C:\\Users\\Alice\\My Project');
  assert.deepEqual(calls, [
    { command: 'C:\\Windows\\explorer.exe', args: ['C:\\Users\\Alice\\My Project'] },
    { command: 'explorer.exe', args: ['C:\\Users\\Alice\\My Project'] },
  ]);
});

test('keeps macOS reveal behavior', () => {
  const launch = buildNativeFileManagerLaunch('/Users/alice/project/file.pdf', {
    isDirectory: false,
    platform: 'darwin',
  });

  assert.equal(launch.command, 'open');
  assert.deepEqual(launch.args, ['-R', '/Users/alice/project/file.pdf']);
});

test('opens containing folder on Linux for files', () => {
  const launch = buildNativeFileManagerLaunch('/home/alice/project/file.pdf', {
    isDirectory: false,
    platform: 'linux',
    env: {},
    release: '6.8.0-generic',
  });

  assert.equal(launch.command, 'xdg-open');
  assert.deepEqual(launch.args, ['/home/alice/project']);
});
