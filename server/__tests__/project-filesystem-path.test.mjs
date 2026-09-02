import { describe, expect, it } from 'vitest';
import path from 'path';

import {
  assertAbsoluteProjectFilesystemPath,
  assertExistingProjectDirectory,
} from '../utils/projectFilesystemPath.js';

describe('project filesystem path safety', () => {
  it('rejects a client-local Windows drive path on a hosted Linux server', () => {
    expect(() => assertAbsoluteProjectFilesystemPath('D:\\课题\\公共\\气候', { platform: 'linux' }))
      .toThrowError(expect.objectContaining({ code: 'CLIENT_LOCAL_PROJECT_PATH' }));
  });

  it('rejects a lossy decoded Windows project id before it can become server-relative', () => {
    expect(() => assertAbsoluteProjectFilesystemPath('D//课题/公共/气候', { platform: 'linux' }))
      .toThrowError(expect.objectContaining({ code: 'NON_ABSOLUTE_PROJECT_PATH' }));
  });

  it('accepts an existing absolute server project directory', async () => {
    const normalized = await assertExistingProjectDirectory(process.cwd());
    expect(normalized).toBe(path.normalize(process.cwd()));
  });

  it('rejects a missing absolute server project directory instead of creating it', async () => {
    const missingPath = path.join(process.cwd(), '.missing-project-path-safety-test');
    await expect(assertExistingProjectDirectory(missingPath))
      .rejects.toMatchObject({ code: 'PROJECT_PATH_NOT_FOUND' });
  });
});
