import { promises as fs } from 'fs';
import path from 'path';

export const WINDOWS_DRIVES_ROOT = '__medhelp_windows_drives__';

function normalizeWindowsNamespacePath(value) {
  return String(value || '').trim().replace(/^\\\\\?\\/, '');
}

export function isWindowsDriveListPath(value) {
  return String(value || '').trim() === WINDOWS_DRIVES_ROOT;
}

export function isWindowsDriveRootPath(value) {
  return /^[A-Za-z]:[\\/]?$/.test(normalizeWindowsNamespacePath(value));
}

export function isWindowsDrivePath(value) {
  return /^[A-Za-z]:(?:[\\/]|$)/.test(normalizeWindowsNamespacePath(value));
}

export function getFilesystemBrowserDisplayPath(value) {
  if (isWindowsDriveListPath(value)) {
    return 'This PC';
  }
  return String(value || '');
}

export function getFilesystemBrowserParentPath(currentPath, {
  boundaryPath = null,
  platform = process.platform,
  pathModule = path,
} = {}) {
  const value = String(currentPath || '').trim();
  if (!value || isWindowsDriveListPath(value)) {
    return null;
  }

  if (platform === 'win32') {
    if (isWindowsDriveRootPath(value)) {
      return WINDOWS_DRIVES_ROOT;
    }

    const parentPath = pathModule.dirname(value);
    return parentPath && parentPath !== value ? parentPath : null;
  }

  const resolvedCurrentPath = pathModule.resolve(value);
  const resolvedBoundaryPath = boundaryPath ? pathModule.resolve(boundaryPath) : null;
  if (resolvedBoundaryPath && resolvedCurrentPath === resolvedBoundaryPath) {
    return null;
  }

  const parentPath = pathModule.dirname(resolvedCurrentPath);
  if (!parentPath || parentPath === resolvedCurrentPath) {
    return null;
  }

  if (resolvedBoundaryPath && !resolvedCurrentPath.startsWith(`${resolvedBoundaryPath}${pathModule.sep}`)) {
    return null;
  }

  return parentPath;
}

export async function getWindowsDriveSuggestions({
  fsApi = fs,
  platform = process.platform,
} = {}) {
  if (platform !== 'win32') {
    return [];
  }

  const driveLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const suggestions = [];

  await Promise.all(driveLetters.map(async (letter) => {
    const drivePath = `${letter}:\\`;
    try {
      const stats = await fsApi.stat(drivePath);
      if (!stats?.isDirectory?.()) {
        return;
      }
      suggestions.push({
        path: drivePath,
        displayPath: drivePath,
        name: drivePath,
        type: 'directory',
        isDrive: true,
      });
    } catch {
      // Ignore unavailable, unmounted, or inaccessible drive letters.
    }
  }));

  return suggestions.sort((a, b) => a.name.localeCompare(b.name));
}
