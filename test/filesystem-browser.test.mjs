import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';

import {
  WINDOWS_DRIVES_ROOT,
  getFilesystemBrowserDisplayPath,
  getFilesystemBrowserParentPath,
  getWindowsDriveSuggestions,
  isWindowsDriveRootPath,
} from '../server/utils/filesystemBrowser.js';

test('Windows drive root browses up to the virtual drive list', () => {
  assert.equal(
    getFilesystemBrowserParentPath('D:\\', {
      platform: 'win32',
      pathModule: path.win32,
    }),
    WINDOWS_DRIVES_ROOT,
  );
});

test('Windows directories browse up within the same drive', () => {
  assert.equal(
    getFilesystemBrowserParentPath('D:\\MedHelp\\Project', {
      platform: 'win32',
      pathModule: path.win32,
    }),
    'D:\\MedHelp',
  );

  assert.equal(
    getFilesystemBrowserParentPath('D:\\MedHelp', {
      platform: 'win32',
      pathModule: path.win32,
    }),
    'D:\\',
  );
});

test('POSIX browsing respects the configured boundary', () => {
  assert.equal(
    getFilesystemBrowserParentPath('/Users/alice/medhelp/Project', {
      boundaryPath: '/Users/alice/medhelp',
      platform: 'darwin',
      pathModule: path.posix,
    }),
    '/Users/alice/medhelp',
  );

  assert.equal(
    getFilesystemBrowserParentPath('/Users/alice/medhelp', {
      boundaryPath: '/Users/alice/medhelp',
      platform: 'darwin',
      pathModule: path.posix,
    }),
    null,
  );
});

test('Windows drive suggestions include only accessible directory drives', async () => {
  const fakeFs = {
    async stat(targetPath) {
      if (targetPath === 'C:\\' || targetPath === 'E:\\') {
        return { isDirectory: () => true };
      }
      throw new Error('not mounted');
    },
  };

  const suggestions = await getWindowsDriveSuggestions({
    fsApi: fakeFs,
    platform: 'win32',
  });

  assert.deepEqual(suggestions.map((item) => item.path), ['C:\\', 'E:\\']);
  assert.equal(suggestions[0].isDrive, true);
});

test('Windows virtual drive list has a stable display label', () => {
  assert.equal(getFilesystemBrowserDisplayPath(WINDOWS_DRIVES_ROOT), 'This PC');
  assert.equal(isWindowsDriveRootPath('D:\\'), true);
  assert.equal(isWindowsDriveRootPath('\\\\?\\D:\\'), true);
  assert.equal(isWindowsDriveRootPath('D:\\MedHelp'), false);
});
