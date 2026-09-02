import { promises as fs } from 'fs';
import path from 'path';

import { isWindowsDrivePath } from './filesystemBrowser.js';

function createProjectPathError(code, message, projectPath) {
  const error = new Error(message);
  error.code = code;
  error.projectPath = projectPath;
  return error;
}

export function assertAbsoluteProjectFilesystemPath(projectPath, {
  platform = process.platform,
} = {}) {
  const rawPath = String(projectPath || '').trim();
  if (!rawPath) {
    throw createProjectPathError(
      'MISSING_PROJECT_PATH',
      'Project path is required for filesystem access.',
      rawPath,
    );
  }

  if (platform !== 'win32' && (isWindowsDrivePath(rawPath) || /^\\\\/.test(rawPath))) {
    throw createProjectPathError(
      'CLIENT_LOCAL_PROJECT_PATH',
      `Client-local project path "${rawPath}" cannot be accessed by the hosted server.`,
      rawPath,
    );
  }

  const pathApi = platform === 'win32' ? path.win32 : path;
  if (!pathApi.isAbsolute(rawPath)) {
    throw createProjectPathError(
      'NON_ABSOLUTE_PROJECT_PATH',
      `Project path "${rawPath}" is not an absolute filesystem path.`,
      rawPath,
    );
  }

  return pathApi.normalize(rawPath);
}

export async function assertExistingProjectDirectory(projectPath, {
  fsApi = fs,
  platform = process.platform,
} = {}) {
  const normalizedPath = assertAbsoluteProjectFilesystemPath(projectPath, { platform });
  let stats;
  try {
    stats = await fsApi.stat(normalizedPath);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw createProjectPathError(
        'PROJECT_PATH_NOT_FOUND',
        `Project directory "${normalizedPath}" does not exist on this machine.`,
        normalizedPath,
      );
    }
    throw error;
  }

  if (!stats.isDirectory()) {
    throw createProjectPathError(
      'PROJECT_PATH_NOT_DIRECTORY',
      `Project path "${normalizedPath}" is not a directory.`,
      normalizedPath,
    );
  }

  return normalizedPath;
}
