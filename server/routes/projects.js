import express from 'express';
import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import os from 'os';
import {
  addProjectManually,
  cleanupUnusedConversationWorkspaces,
  createConversationWorkspace,
  extractProjectDirectory,
  getAllowedDataFolderEntriesFromConfig,
  getAllowedDataFoldersFromConfig,
  getWorkspaceRootFromConfig,
  setAllowedDataFoldersInConfig,
  setWorkspaceRootInConfig,
} from '../projects.js';
import { IS_PLATFORM } from '../constants/config.js';
import { createDownloadRateLimiter } from '../middleware/rate-limit.js';
import {
  isWindowsDrivePath,
  isWindowsDriveRootPath,
} from '../utils/filesystemBrowser.js';
import { isProtectedProjectPath } from '../../shared/internalProjectFiles.js';

const router = express.Router();
const limitProjectArchiveDownload = createDownloadRateLimiter({
  action: 'project-archive-download',
});

function sanitizeGitError(message, token) {
  if (!message || !token) return message;
  return message.replace(new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***');
}

function sanitizeArchiveFilename(input) {
  const normalized = String(input || 'project')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .slice(0, 120);

  return normalized || 'project';
}

const WORKSPACE_ARCHIVE_SCOPES = {
  all: {
    relativePath: '',
    archiveRoot: '',
    filenameSuffix: '',
  },
  publication: {
    relativePath: 'Publication',
    archiveRoot: 'Publication',
    filenameSuffix: 'Publication',
  },
  experimentAnalysis: {
    relativePath: 'Experiment',
    archiveRoot: 'Experiment',
    filenameSuffix: 'Experiment',
  },
};

export const DEFAULT_WORKSPACE_ARCHIVE_MAX_FILE_BYTES = 50 * 1024 * 1024;
export const WORKSPACE_ARCHIVE_EXCLUSION_NOTICE_NAME = 'ARCHIVE_EXCLUSIONS.txt';

const RAW_DATA_ARCHIVE_SEGMENTS = new Set([
  'raw',
  'raw-data',
  'raw-dataset',
  'raw-datasets',
  'original-data',
  'original-dataset',
  'original-datasets',
  'source-data',
  'source-dataset',
  'source-datasets',
  'source-files',
  'source-database',
  'source-databases',
  'input-data',
  'input-dataset',
  'input-datasets',
  'rawdata',
  'originaldata',
  'sourcedata',
  'inputdata',
  '原始数据',
  '原始资料',
  '源数据',
]);

const RAW_DATA_FILE_EXTENSIONS = new Set([
  'arrow',
  'csv',
  'db',
  'dta',
  'duckdb',
  'feather',
  'h5',
  'hdf5',
  'jsonl',
  'ndjson',
  'parquet',
  'rda',
  'rdata',
  'rds',
  'sas7bdat',
  'sav',
  'sqlite',
  'sqlite3',
  'tsv',
  'xls',
  'xlsx',
  'xpt',
  'zip',
]);

const MODEL_MEMORY_ARCHIVE_FILE_NAMES = new Set([
  'agents.md',
  'agents.md.bak',
  'claude.md',
  'claude.md.bak',
  'claude.local.md',
  'codex.md',
  'codex.md.bak',
  'gemini.md',
  'gemini.md.bak',
  'gemini.local.md',
  'working-summary.md',
  'research_lessons.md',
  'research_lessons.json',
  'deep_research_state.json',
]);

function getWorkspaceArchiveMaxFileBytes() {
  const configured = Number(process.env.WORKSPACE_ARCHIVE_MAX_FILE_BYTES);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }
  return DEFAULT_WORKSPACE_ARCHIVE_MAX_FILE_BYTES;
}

function normalizeArchiveNameToken(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[\s_.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeArchiveRelativePath(relativeArchivePath) {
  const normalizedPath = String(relativeArchivePath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');

  return normalizedPath;
}

function getArchivePathSegments(relativeArchivePath) {
  const normalizedPath = normalizeArchiveRelativePath(relativeArchivePath);
  return normalizedPath.split('/').filter(Boolean);
}

function isRawDataArchivePath(relativeArchivePath, isDirectory) {
  const pathSegments = getArchivePathSegments(relativeArchivePath);
  const normalizedSegments = pathSegments.map(normalizeArchiveNameToken);

  if (normalizedSegments.some((segment) => RAW_DATA_ARCHIVE_SEGMENTS.has(segment))) {
    return true;
  }

  if (isDirectory || pathSegments.length === 0) {
    return false;
  }

  const fileName = pathSegments[pathSegments.length - 1];
  const extension = path.extname(fileName).slice(1).toLowerCase();
  if (!RAW_DATA_FILE_EXTENSIONS.has(extension)) {
    return false;
  }

  const stem = normalizeArchiveNameToken(path.basename(fileName, path.extname(fileName)));
  return RAW_DATA_ARCHIVE_SEGMENTS.has(stem);
}

function isModelMemoryArchivePath(relativeArchivePath, isDirectory) {
  if (isDirectory) {
    return false;
  }

  const pathSegments = getArchivePathSegments(relativeArchivePath);
  if (pathSegments.length === 0) {
    return false;
  }

  const fileName = pathSegments[pathSegments.length - 1].toLowerCase();
  return MODEL_MEMORY_ARCHIVE_FILE_NAMES.has(fileName);
}

export function classifyWorkspaceArchiveEntry(relativeArchivePath, {
  isDirectory = false,
  isSymbolicLink = false,
  size = 0,
  maxFileBytes = getWorkspaceArchiveMaxFileBytes(),
} = {}) {
  const normalizedPath = normalizeArchiveRelativePath(relativeArchivePath);

  if (!normalizedPath) {
    return { include: true };
  }

  const pathSegments = getArchivePathSegments(normalizedPath);
  if (isProtectedProjectPath(normalizedPath)) {
    return { include: false, reason: 'protected_agent_assets' };
  }

  if (pathSegments.some((segment) => segment.startsWith('.'))) {
    return { include: false, reason: 'hidden_path' };
  }

  if (isSymbolicLink) {
    return { include: false, reason: 'symbolic_link' };
  }

  if (isModelMemoryArchivePath(normalizedPath, isDirectory)) {
    return { include: false, reason: 'model_memory' };
  }

  if (pathSegments.length === 1) {
    if (!isDirectory) {
      return { include: false, reason: 'root_file' };
    }
  }

  if (isRawDataArchivePath(normalizedPath, isDirectory)) {
    return { include: false, reason: 'raw_data' };
  }

  if (!isDirectory && Number.isFinite(size) && size > maxFileBytes) {
    return { include: false, reason: 'large_file', maxFileBytes };
  }

  return { include: true };
}

export function shouldIncludeWorkspaceArchiveEntry(relativeArchivePath, isDirectory) {
  return classifyWorkspaceArchiveEntry(relativeArchivePath, { isDirectory }).include;
}

function recordSkippedArchiveEntry(skippedEntries, relativeArchivePath, decision) {
  if (!Array.isArray(skippedEntries) || !decision || decision.include) {
    return;
  }

  skippedEntries.push({
    path: normalizeArchiveRelativePath(relativeArchivePath),
    reason: decision.reason || 'excluded',
    maxFileBytes: decision.maxFileBytes,
  });
}

function formatArchiveBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return 'unknown size';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatWorkspaceArchiveExclusionReason(entry) {
  switch (entry.reason) {
    case 'hidden_path':
      return 'hidden path';
    case 'root_file':
      return 'root-level file';
    case 'symbolic_link':
      return 'symbolic link';
    case 'model_memory':
      return 'model memory/context file';
    case 'protected_agent_assets':
      return 'protected agent instructions/skills';
    case 'raw_data':
      return 'raw/original data';
    case 'large_file':
      return `larger than ${formatArchiveBytes(entry.maxFileBytes)}`;
    default:
      return entry.reason || 'excluded';
  }
}

export function buildWorkspaceArchiveExclusionNotice(skippedEntries, {
  maxFileBytes = getWorkspaceArchiveMaxFileBytes(),
} = {}) {
  if (!Array.isArray(skippedEntries) || skippedEntries.length === 0) {
    return null;
  }

  const maxListedEntries = 500;
  const listedEntries = skippedEntries.slice(0, maxListedEntries);
  const lines = [
    'Some workspace files were intentionally excluded from this download.',
    '',
    `Rules: protected agent instructions/skills, hidden paths, root-level files, symbolic links, model memory/context files, raw/original data paths, and files larger than ${formatArchiveBytes(maxFileBytes)} are excluded.`,
    '',
    ...listedEntries.map((entry) => `- ${entry.path} (${formatWorkspaceArchiveExclusionReason(entry)})`),
  ];

  if (skippedEntries.length > listedEntries.length) {
    lines.push(`- ${skippedEntries.length - listedEntries.length} more excluded entries are not shown.`);
  }

  lines.push('');
  return lines.join('\n');
}

export async function addWorkspaceArchiveEntries(archive, absoluteDirPath, relativeArchiveDir = '', {
  skippedEntries = [],
  maxFileBytes = getWorkspaceArchiveMaxFileBytes(),
} = {}) {
  const entries = await fs.readdir(absoluteDirPath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));

  for (const entry of entries) {
    const absoluteEntryPath = path.join(absoluteDirPath, entry.name);
    const relativeArchivePath = relativeArchiveDir
      ? `${relativeArchiveDir}/${entry.name}`
      : entry.name;

    const initialDecision = classifyWorkspaceArchiveEntry(relativeArchivePath, {
      isDirectory: entry.isDirectory(),
      isSymbolicLink: entry.isSymbolicLink(),
      maxFileBytes,
    });
    if (!initialDecision.include) {
      recordSkippedArchiveEntry(skippedEntries, relativeArchivePath, initialDecision);
      continue;
    }

    if (entry.isDirectory()) {
      const stats = await fs.stat(absoluteEntryPath);
      archive.addFile(`${relativeArchivePath}/`, Buffer.alloc(0), '', stats);
      await addWorkspaceArchiveEntries(archive, absoluteEntryPath, relativeArchivePath, { skippedEntries, maxFileBytes });
      continue;
    }

    if (entry.isFile()) {
      const stats = await fs.stat(absoluteEntryPath);
      const fileDecision = classifyWorkspaceArchiveEntry(relativeArchivePath, {
        isDirectory: false,
        isSymbolicLink: false,
        size: stats.size,
        maxFileBytes,
      });
      if (!fileDecision.include) {
        recordSkippedArchiveEntry(skippedEntries, relativeArchivePath, fileDecision);
        continue;
      }

      const data = await fs.readFile(absoluteEntryPath);
      archive.addFile(relativeArchivePath, data, '', stats);
    }
  }
}

// Keep date-grouped conversation workspaces under the MedHelpSec document root.
const DEFAULT_WORKSPACES_ROOT = path.join(os.homedir(), 'Documents', 'MedHelpSec');

function getCompatibleWorkspaceRootSync() {
  if (process.env.WORKSPACES_ROOT) {
    return process.env.WORKSPACES_ROOT;
  }

  return DEFAULT_WORKSPACES_ROOT;
}

// Dynamic workspace root: config file > env var > compatible default root
export async function getWorkspacesRoot() {
  const configRoot = await getWorkspaceRootFromConfig();
  return configRoot || getCompatibleWorkspaceRootSync();
}

async function ensureDirectory(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
  return targetPath;
}

export function getWorkspaceDisplayPath(targetPath) {
  const normalizedPath = String(targetPath || '').replace(/\\/g, '/');
  const homeCandidates = [os.homedir()];
  try {
    homeCandidates.push(fsSync.realpathSync(os.homedir()));
  } catch {
    // Use os.homedir() as the fallback display root.
  }

  const normalizedHomes = homeCandidates
    .flat()
    .map((homePath) => String(homePath || '').replace(/\\/g, '/'))
    .filter(Boolean);

  for (const normalizedHome of new Set(normalizedHomes)) {
    if (normalizedPath === normalizedHome) {
      return '~';
    }
    if (normalizedPath.startsWith(`${normalizedHome}/`)) {
      return `~/${normalizedPath.slice(normalizedHome.length + 1)}`;
    }
  }

  return normalizedPath.replace(/^\/(Users|home)\/[^/]+/, '~');
}

export function expandWorkspaceInputPath(targetPath) {
  const value = String(targetPath || '').trim();
  if (value === '~') {
    return os.homedir();
  }
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

export async function getDefaultUserWorkspaceRoot(userId) {
  return getCompatibleWorkspaceRootSync();
}

export async function getUserWorkspacesRoot(userId) {
  const { userDb } = await import('../database/db.js');
  if (!userId) {
    return getWorkspacesRoot();
  }

  const user = userDb.getWorkspaceRootUser(userId);
  const configuredRoot = user?.workspace_root || null;
  const resolvedRoot = configuredRoot ? path.resolve(configuredRoot) : await getDefaultUserWorkspaceRoot(userId);
  return ensureDirectory(resolvedRoot);
}

// Keep a synchronous fallback for backward compat (used only at import time)
export const WORKSPACES_ROOT = getCompatibleWorkspaceRootSync();

// System-critical paths that should never be used as workspace directories
export const FORBIDDEN_PATHS = [
  // Unix
  '/',
  '/etc',
  '/bin',
  '/sbin',
  '/usr',
  '/dev',
  '/proc',
  '/sys',
  '/var',
  '/boot',
  '/root',
  '/lib',
  '/lib64',
  '/opt',
  '/tmp',
  '/run',
  // Windows
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  'C:\\System Volume Information',
  'C:\\$Recycle.Bin'
];

const FORBIDDEN_WINDOWS_ROOT_SEGMENTS = new Set([
  'windows',
  'program files',
  'program files (x86)',
  'programdata',
  'system volume information',
  '$recycle.bin',
]);

function normalizePathForSafetyCompare(targetPath) {
  const normalizedPath = path.normalize(targetPath);
  return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
}

function getForbiddenWorkspacePathReason(normalizedPath, { allowDriveRoot = false } = {}) {
  if (process.platform === 'win32') {
    if (isWindowsDriveRootPath(normalizedPath) && !allowDriveRoot) {
      return 'Cannot use a drive root as a workspace location';
    }

    const withoutDrive = normalizedPath.replace(/^[A-Za-z]:[\\/]+/, '');
    const firstSegment = withoutDrive.split(/[\\/]+/).filter(Boolean)[0]?.toLowerCase();
    if (firstSegment && FORBIDDEN_WINDOWS_ROOT_SEGMENTS.has(firstSegment)) {
      return `Cannot create workspace in system directory: ${firstSegment}`;
    }
  }

  const normalizedComparePath = normalizePathForSafetyCompare(normalizedPath);
  if (FORBIDDEN_PATHS.some((forbidden) => {
    if (forbidden === '/var' && process.platform !== 'win32' &&
        (normalizedPath.startsWith('/var/tmp') ||
         normalizedPath.startsWith('/var/folders'))) {
      return false;
    }

    const forbiddenComparePath = normalizePathForSafetyCompare(forbidden);
    return normalizedComparePath === forbiddenComparePath
      || normalizedComparePath.startsWith(`${forbiddenComparePath}${path.sep}`);
  }) || normalizedPath === '/') {
    return 'Cannot use system-critical directories as workspace locations';
  }

  return null;
}

function getRequestWorkspacePathOptions(req) {
  return req.localKernelSession
    ? {
        allowUserHome: true,
        allowWindowsDrives: true,
      }
    : {};
}

function getRequestProjectUserId(req) {
  return req.localKernelSession ? null : req.user?.id;
}

/**
 * Validates that a path is safe for workspace operations
 * @param {string} requestedPath - The path to validate
 * @param {{allowUserHome?: boolean}} options - Local mode can explicitly allow safe paths under the user's home directory
 * @returns {Promise<{valid: boolean, resolvedPath?: string, error?: string}>}
 */
export async function validateWorkspacePath(requestedPath, options = {}) {
  try {
    if (process.platform !== 'win32' && isWindowsDrivePath(requestedPath)) {
      return {
        valid: false,
        error: 'Client-local Windows paths cannot be used as hosted server workspaces',
      };
    }

    // Resolve to absolute path
    let absolutePath = path.resolve(requestedPath);

    // Check if path is a forbidden system directory
    const normalizedPath = path.normalize(absolutePath);
    const forbiddenReason = getForbiddenWorkspacePathReason(normalizedPath, {
      allowDriveRoot: options.allowDriveRoot,
    });
    if (forbiddenReason) {
      return {
        valid: false,
        error: forbiddenReason,
      };
    }

    // Additional check for paths starting with forbidden directories
    for (const forbidden of FORBIDDEN_PATHS) {
      const normalizedComparePath = normalizePathForSafetyCompare(normalizedPath);
      const forbiddenComparePath = normalizePathForSafetyCompare(forbidden);
      if (normalizedComparePath === forbiddenComparePath ||
          normalizedComparePath.startsWith(`${forbiddenComparePath}${path.sep}`)) {
        // Exception: /var/tmp and similar user-accessible paths might be allowed
        // but /var itself and most /var subdirectories should be blocked
        if (forbidden === '/var' && process.platform !== 'win32' &&
            (normalizedPath.startsWith('/var/tmp') ||
             normalizedPath.startsWith('/var/folders'))) {
          continue; // Allow these specific cases
        }

        return {
          valid: false,
          error: `Cannot create workspace in system directory: ${forbidden}`
        };
      }
    }

    // Try to resolve the real path (following symlinks)
    let realPath;
    try {
      // Check if path exists to resolve real path
      await fs.access(absolutePath);
      realPath = await fs.realpath(absolutePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Path doesn't exist yet - check parent directory
        let parentPath = path.dirname(absolutePath);
        try {
          const parentRealPath = await fs.realpath(parentPath);

          // Reconstruct the full path with real parent
          realPath = path.join(parentRealPath, path.basename(absolutePath));
        } catch (parentError) {
          if (parentError.code === 'ENOENT') {
            // Parent doesn't exist either - use the absolute path as-is
            realPath = absolutePath;
          } else {
            throw parentError;
          }
        }
      } else {
        throw error;
      }
    }

    const realPathForbiddenReason = getForbiddenWorkspacePathReason(path.normalize(realPath), {
      allowDriveRoot: options.allowDriveRoot,
    });
    if (realPathForbiddenReason) {
      return {
        valid: false,
        error: realPathForbiddenReason,
      };
    }

    // In OSS mode, custom paths under the user's home directory remain valid even if
    // the default suggested storage root is narrower (for example ~/medhelp_workspace).
    const currentWorkspacesRoot = await getWorkspacesRoot();
    const resolvedWorkspaceRoot = await fs.realpath(currentWorkspacesRoot);
    const resolvedUserHome = await fs.realpath(os.homedir());
    const allowUserHome = options.allowUserHome ?? !IS_PLATFORM;
    const allowWindowsDrives = options.allowWindowsDrives ?? (process.platform === 'win32' && allowUserHome);
    const configuredDataFolders = options.allowConfiguredDataFolders
      ? await getAllowedDataFoldersFromConfig()
      : [];
    const explicitAllowedFolders = Array.isArray(options.allowedDataFolders)
      ? options.allowedDataFolders
      : [];
    const resolvedDataFolders = [];
    for (const folderPath of [...configuredDataFolders, ...explicitAllowedFolders]) {
      try {
        resolvedDataFolders.push(await fs.realpath(folderPath));
      } catch {
        // Ignore stale configured folders until the user refreshes/saves settings.
      }
    }
    const allowedRoots = [
      ...(allowUserHome ? [resolvedWorkspaceRoot, resolvedUserHome] : [resolvedWorkspaceRoot]),
      ...resolvedDataFolders,
    ];

    let isWithinAllowedRoot = options.allowAnySafePath
      ? true
      : allowedRoots.some((allowedRoot) => (
          realPath.startsWith(allowedRoot + path.sep) || realPath === allowedRoot
        ));

    if (!isWithinAllowedRoot && allowWindowsDrives && isWindowsDrivePath(realPath)) {
      isWithinAllowedRoot = true;
    }

    // Ensure the resolved path is contained within the allowed workspace root
    if (!isWithinAllowedRoot) {
      return {
        valid: false,
        error: allowUserHome
          ? `Workspace path must be within your home directory or the configured workspace root: ${currentWorkspacesRoot}`
          : `Workspace path must be within the allowed workspace root: ${currentWorkspacesRoot}`
      };
    }

    // Additional symlink check for existing paths
    try {
      await fs.access(absolutePath);
      const stats = await fs.lstat(absolutePath);

      if (stats.isSymbolicLink()) {
        // Resolve target
        const linkTarget = await fs.readlink(absolutePath);
        const resolvedTarget = path.resolve(path.dirname(absolutePath), linkTarget);
        const realTarget = await fs.realpath(resolvedTarget);

        let symlinkWithinAllowedRoot = options.allowAnySafePath
          ? true
          : allowedRoots.some((allowedRoot) => (
              realTarget.startsWith(allowedRoot + path.sep) || realTarget === allowedRoot
            ));

        if (!symlinkWithinAllowedRoot && allowWindowsDrives && isWindowsDrivePath(realTarget)) {
          symlinkWithinAllowedRoot = true;
        }

        if (!symlinkWithinAllowedRoot) {
          return {
            valid: false,
            error: 'Symlink target is outside the allowed workspace root'
          };
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // Path doesn't exist - that's fine for new workspace creation
    }

    return {
      valid: true,
      resolvedPath: realPath
    };

  } catch (error) {
    return {
      valid: false,
      error: `Path validation failed: ${error.message}`
    };
  }
}

export async function validateUserWorkspacePath(requestedPath, userId, options = {}) {
  const validation = await validateWorkspacePath(requestedPath, options);
  if (!validation.valid) {
    return validation;
  }

  if (!userId) {
    return validation;
  }

  return {
    ...validation,
    resolvedPath: validation.resolvedPath || path.resolve(requestedPath),
    userRoot: await getUserWorkspacesRoot(userId),
  };
}

/**
 * Get current workspace root path
 * GET /api/projects/workspace-root
 */
router.get('/workspace-root', async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const currentRoot = userId ? await getUserWorkspacesRoot(userId) : await getWorkspacesRoot();
    const defaultRoot = userId ? await getDefaultUserWorkspaceRoot(userId) : (process.env.WORKSPACES_ROOT || DEFAULT_WORKSPACES_ROOT);
    res.json({
      path: currentRoot,
      defaultPath: defaultRoot,
      displayPath: getWorkspaceDisplayPath(currentRoot),
      displayRoot: getWorkspaceDisplayPath(currentRoot),
    });
  } catch (error) {
    console.error('Error getting workspace root:', error);
    res.status(500).json({ error: 'Failed to get workspace root' });
  }
});

router.post('/conversation-workspace', async (req, res) => {
  try {
    const projectUserId = getRequestProjectUserId(req);
    const workspaceRoot = await getUserWorkspacesRoot(projectUserId);
    const project = await createConversationWorkspace(workspaceRoot, projectUserId);
    return res.json({ success: true, project });
  } catch (error) {
    console.error('Error creating conversation workspace:', error);
    return res.status(500).json({
      error: error.message || 'Failed to create conversation workspace',
    });
  }
});

router.post('/conversation-workspace/cleanup', async (req, res) => {
  try {
    const projectUserId = getRequestProjectUserId(req);
    const workspaceRoot = await getUserWorkspacesRoot(projectUserId);
    const removed = await cleanupUnusedConversationWorkspaces(workspaceRoot, projectUserId);
    return res.json({ success: true, removedCount: removed.length });
  } catch (error) {
    console.error('Error cleaning unused conversation workspaces:', error);
    return res.status(500).json({
      error: error.message || 'Failed to clean unused conversation workspaces',
    });
  }
});

/**
 * Set workspace root path
 * PUT /api/projects/workspace-root
 */
router.put('/workspace-root', async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const { userDb } = await import('../database/db.js');
    const { path: newPath } = req.body;

    // If null/empty, reset to default
    if (!newPath) {
      if (userId) {
        userDb.updateWorkspaceRoot(userId, null);
      } else {
        await setWorkspaceRootInConfig(null);
      }
      const defaultRoot = userId ? await getDefaultUserWorkspaceRoot(userId) : (process.env.WORKSPACES_ROOT || DEFAULT_WORKSPACES_ROOT);
      return res.json({
        success: true,
        path: defaultRoot,
        defaultPath: defaultRoot,
        displayPath: getWorkspaceDisplayPath(defaultRoot),
        displayRoot: getWorkspaceDisplayPath(defaultRoot),
      });
    }

    const absolutePath = path.resolve(expandWorkspaceInputPath(newPath));

    // Validate the path exists and is a directory
    try {
      const stats = await fs.stat(absolutePath);
      if (!stats.isDirectory()) {
        return res.status(400).json({ error: 'Path is not a directory' });
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(400).json({ error: 'Directory does not exist' });
      }
      throw error;
    }

    // Check it's not a forbidden system path
    const normalizedPath = path.normalize(absolutePath);
    if (FORBIDDEN_PATHS.includes(normalizedPath) || normalizedPath === '/') {
      return res.status(400).json({ error: 'Cannot use system-critical directories' });
    }

    const validation = await validateWorkspacePath(absolutePath, getRequestWorkspacePathOptions(req));
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    if (userId) {
      userDb.updateWorkspaceRoot(userId, absolutePath);
    } else {
      await setWorkspaceRootInConfig(absolutePath);
    }
    res.json({
      success: true,
      path: absolutePath,
      defaultPath: userId ? await getDefaultUserWorkspaceRoot(userId) : (process.env.WORKSPACES_ROOT || DEFAULT_WORKSPACES_ROOT),
      displayPath: getWorkspaceDisplayPath(absolutePath),
      displayRoot: getWorkspaceDisplayPath(absolutePath),
    });
  } catch (error) {
    console.error('Error setting workspace root:', error);
    res.status(500).json({ error: 'Failed to set workspace root' });
  }
});

async function buildDataFoldersSettingsPayload(userId = null) {
  const currentRoot = userId ? await getUserWorkspacesRoot(userId) : await getWorkspacesRoot();
  const defaultRoot = userId ? await getDefaultUserWorkspaceRoot(userId) : (process.env.WORKSPACES_ROOT || DEFAULT_WORKSPACES_ROOT);
  const entries = await getAllowedDataFolderEntriesFromConfig();

  return {
    workspaceRoot: {
      path: currentRoot,
      defaultPath: defaultRoot,
      displayPath: getWorkspaceDisplayPath(currentRoot),
      displayRoot: getWorkspaceDisplayPath(currentRoot),
    },
    allowedFolders: entries.map((entry) => ({
      path: entry.path,
      displayPath: getWorkspaceDisplayPath(entry.path),
      exists: entry.exists,
    })),
  };
}

async function validateAllowedDataFolders(folderPaths = []) {
  const normalizedPaths = [];
  const seen = new Set();

  if (!Array.isArray(folderPaths)) {
    const error = new Error('folders must be an array');
    error.statusCode = 400;
    throw error;
  }

  if (folderPaths.length > 32) {
    const error = new Error('Too many data folders');
    error.statusCode = 400;
    throw error;
  }

  for (const folderPath of folderPaths) {
    const rawPath = typeof folderPath === 'string' ? folderPath : folderPath?.path;
    const requestedPath = String(rawPath || '').trim();
    if (!requestedPath) {
      continue;
    }

    const absolutePath = path.resolve(expandWorkspaceInputPath(requestedPath));
    const stats = await fs.stat(absolutePath).catch((error) => {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    });
    if (!stats) {
      const error = new Error(`Directory does not exist: ${requestedPath}`);
      error.statusCode = 400;
      throw error;
    }
    if (!stats.isDirectory()) {
      const error = new Error(`Path is not a directory: ${requestedPath}`);
      error.statusCode = 400;
      throw error;
    }

    const validation = await validateWorkspacePath(absolutePath, {
      allowAnySafePath: true,
    });
    if (!validation.valid) {
      const error = new Error(validation.error || `Invalid data folder: ${requestedPath}`);
      error.statusCode = 400;
      throw error;
    }

    const resolvedPath = validation.resolvedPath || absolutePath;
    const normalizedKey = process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
    if (seen.has(normalizedKey)) {
      continue;
    }
    seen.add(normalizedKey);
    normalizedPaths.push(resolvedPath);
  }

  return normalizedPaths;
}

/**
 * Get data-folder allowlist settings
 * GET /api/projects/data-folders
 */
router.get('/data-folders', async (req, res) => {
  try {
    res.json(await buildDataFoldersSettingsPayload(req.user?.id || null));
  } catch (error) {
    console.error('Error getting data folder settings:', error);
    res.status(500).json({ error: 'Failed to get data folder settings' });
  }
});

/**
 * Set data-folder allowlist settings
 * PUT /api/projects/data-folders
 */
router.put('/data-folders', async (req, res) => {
  try {
    const { folders } = req.body || {};
    const normalizedPaths = await validateAllowedDataFolders(folders || []);
    await setAllowedDataFoldersInConfig(normalizedPaths);
    res.json({
      success: true,
      ...(await buildDataFoldersSettingsPayload(req.user?.id || null)),
    });
  } catch (error) {
    console.error('Error setting data folder settings:', error);
    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : 'Failed to set data folder settings',
    });
  }
});

/**
 * Download a workspace as a zip archive
 * GET /api/projects/:projectName/download
 */
router.get('/:projectName/download', limitProjectArchiveDownload, async (req, res) => {
  try {
    const { projectName } = req.params;
    const { projectDb } = await import('../database/db.js');
    const projectRecord = projectDb.getProjectById(projectName);

    if (!projectRecord || (req.user?.id && projectRecord.user_id != null && Number(projectRecord.user_id) !== Number(req.user.id))) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const projectPath = projectRecord.path || await extractProjectDirectory(projectName);
    if (!projectPath) {
      return res.status(404).json({ error: 'Project path not found' });
    }

    const resolvedPath = await fs.realpath(projectPath);
    const projectStats = await fs.stat(resolvedPath);
    if (!projectStats.isDirectory()) {
      return res.status(400).json({ error: 'Project path is not a directory' });
    }

    const requestedScope = String(req.query.scope || 'all');
    const archiveScope = WORKSPACE_ARCHIVE_SCOPES[requestedScope];
    if (!archiveScope) {
      return res.status(400).json({ error: 'Invalid download scope' });
    }

    const AdmZip = (await import('adm-zip')).default;
    const archive = new AdmZip();
    const skippedEntries = [];
    const maxFileBytes = getWorkspaceArchiveMaxFileBytes();

    if (archiveScope.relativePath) {
      const scopedPath = path.join(resolvedPath, archiveScope.relativePath);
      const resolvedScopedPath = await fs.realpath(scopedPath).catch(() => null);
      if (!resolvedScopedPath) {
        return res.status(404).json({ error: `Folder not found: ${archiveScope.archiveRoot}` });
      }

      const relativeFromProject = path.relative(resolvedPath, resolvedScopedPath);
      if (relativeFromProject.startsWith('..') || path.isAbsolute(relativeFromProject)) {
        return res.status(400).json({ error: 'Download scope is outside the project' });
      }

      const scopedStats = await fs.stat(resolvedScopedPath);
      if (!scopedStats.isDirectory()) {
        return res.status(400).json({ error: `Download scope is not a directory: ${archiveScope.archiveRoot}` });
      }

      archive.addFile(`${archiveScope.archiveRoot}/`, Buffer.alloc(0), '', scopedStats);
      await addWorkspaceArchiveEntries(archive, resolvedScopedPath, archiveScope.archiveRoot, { skippedEntries, maxFileBytes });
    } else {
      await addWorkspaceArchiveEntries(archive, resolvedPath, '', { skippedEntries, maxFileBytes });
    }

    const exclusionNotice = buildWorkspaceArchiveExclusionNotice(skippedEntries, { maxFileBytes });
    if (exclusionNotice) {
      archive.addFile(
        WORKSPACE_ARCHIVE_EXCLUSION_NOTICE_NAME,
        Buffer.from(exclusionNotice, 'utf8'),
      );
    }

    const archiveBuffer = archive.toBuffer();
    const archiveBaseName = sanitizeArchiveFilename(projectRecord?.display_name || path.basename(resolvedPath) || projectName);
    const archiveName = `${archiveBaseName}${archiveScope.filenameSuffix ? `-${archiveScope.filenameSuffix}` : ''}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(archiveName)}"; filename*=UTF-8''${encodeURIComponent(archiveName)}`);
    res.setHeader('Content-Length', String(archiveBuffer.length));
    res.send(archiveBuffer);
  } catch (error) {
    console.error('Error downloading workspace archive:', error);
    res.status(500).json({ error: error.message || 'Failed to create workspace archive' });
  }
});

/**
 * Create a new workspace
 * POST /api/projects/create-workspace
 *
 * Body:
 * - workspaceType: 'existing' | 'new'
 * - path: string (workspace path)
 * - githubUrl?: string (optional, for new workspaces)
 * - githubTokenId?: number (optional, ID of stored token)
 * - newGithubToken?: string (optional, one-time token)
 */
router.post('/create-workspace', async (req, res) => {
  try {
    const { workspaceType, path: workspacePath, githubUrl, githubTokenId, newGithubToken, displayName, connectionMode } = req.body;

    // Validate required fields
    if (!workspaceType || !workspacePath) {
      return res.status(400).json({ error: 'workspaceType and path are required' });
    }

    if (!['existing', 'new'].includes(workspaceType)) {
      return res.status(400).json({ error: 'workspaceType must be "existing" or "new"' });
    }

    // Validate path safety before any operations
    const projectUserId = getRequestProjectUserId(req);
    const validation = await validateUserWorkspacePath(
      workspacePath,
      projectUserId,
      {
        ...getRequestWorkspacePathOptions(req),
        allowAnySafePath: connectionMode === 'localFolder' && (!IS_PLATFORM || Boolean(req.localKernelSession)),
      },
    );
    if (!validation.valid) {
      return res.status(400).json({
        error: 'Invalid workspace path',
        details: validation.error
      });
    }

    const absolutePath = validation.resolvedPath;

    // Handle existing workspace
    if (workspaceType === 'existing') {
      // Check if the path exists
      try {
        await fs.access(absolutePath);
        const stats = await fs.stat(absolutePath);

        if (!stats.isDirectory()) {
          return res.status(400).json({ error: 'Path exists but is not a directory' });
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          return res.status(404).json({ error: 'Workspace path does not exist' });
        }
        throw error;
      }

      // Add the existing workspace to the project list
      const preserveFolderContents = connectionMode === 'localFolder';
      const project = await addProjectManually(absolutePath, displayName, projectUserId, {
        initializeWorkspace: !preserveFolderContents,
        metadata: preserveFolderContents ? { preserveFolderContents: true } : undefined,
      });

      return res.json({
        success: true,
        project,
        message: 'Existing workspace added successfully'
      });
    }

    // Handle new workspace creation
    if (workspaceType === 'new') {
      // Create the directory if it doesn't exist
      await fs.mkdir(absolutePath, { recursive: true });

      // If GitHub URL is provided, clone the repository
      if (githubUrl) {
        let githubToken = null;

        // Get GitHub token if needed
        if (githubTokenId) {
          // Fetch token from database
          const token = await getGithubTokenById(githubTokenId, req.user.id);
          if (!token) {
            // Clean up created directory
            await fs.rm(absolutePath, { recursive: true, force: true });
            return res.status(404).json({ error: 'GitHub token not found' });
          }
          githubToken = token.github_token;
        } else if (newGithubToken) {
          githubToken = newGithubToken;
        }

        // Extract repo name from URL for the clone destination
        const normalizedUrl = githubUrl.replace(/\/+$/, '').replace(/\.git$/, '');
        const repoName = normalizedUrl.split('/').pop() || 'repository';
        const clonePath = path.join(absolutePath, repoName);

        // Check if clone destination already exists to prevent data loss
        try {
          await fs.access(clonePath);
          return res.status(409).json({
            error: 'Directory already exists',
            details: `The destination path "${clonePath}" already exists. Please choose a different location or remove the existing directory.`
          });
        } catch (err) {
          // Directory doesn't exist, which is what we want
        }

        // Clone the repository into a subfolder
        try {
          await cloneGitHubRepository(githubUrl, clonePath, githubToken);
        } catch (error) {
          // Only clean up if clone created partial data (check if dir exists and is empty or partial)
          try {
            const stats = await fs.stat(clonePath);
            if (stats.isDirectory()) {
              await fs.rm(clonePath, { recursive: true, force: true });
            }
          } catch (cleanupError) {
            // Directory doesn't exist or cleanup failed - ignore
          }
          throw new Error(`Failed to clone repository: ${error.message}`);
        }

        // Add the cloned repo path to the project list
        const project = await addProjectManually(clonePath, displayName, projectUserId);

        return res.json({
          success: true,
          project,
          message: 'New workspace created and repository cloned successfully'
        });
      }

      // Add the new workspace to the project list (no clone)
      const project = await addProjectManually(absolutePath, displayName, projectUserId);

      return res.json({
        success: true,
        project,
        message: 'New workspace created successfully'
      });
    }

  } catch (error) {
    console.error('Error creating workspace:', error);
    res.status(500).json({
      error: error.message || 'Failed to create workspace',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * Helper function to get GitHub token from database
 */
async function getGithubTokenById(tokenId, userId) {
  const { getDatabase } = await import('../database/db.js');
  const db = await getDatabase();

  const credential = await db.get(
    'SELECT * FROM user_credentials WHERE id = ? AND user_id = ? AND credential_type = ? AND is_active = 1',
    [tokenId, userId, 'github_token']
  );

  // Return in the expected format (github_token field for compatibility)
  if (credential) {
    return {
      ...credential,
      github_token: credential.credential_value
    };
  }

  return null;
}

/**
 * Clone repository with progress streaming (SSE)
 * GET /api/projects/clone-progress
 */
router.get('/clone-progress', async (req, res) => {
  const { path: workspacePath, githubUrl, githubTokenId, newGithubToken } = req.query;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  try {
    if (!workspacePath || !githubUrl) {
      sendEvent('error', { message: 'workspacePath and githubUrl are required' });
      res.end();
      return;
    }

    const validation = await validateUserWorkspacePath(workspacePath, req.user?.id);
    if (!validation.valid) {
      sendEvent('error', { message: validation.error });
      res.end();
      return;
    }

    const absolutePath = validation.resolvedPath;

    await fs.mkdir(absolutePath, { recursive: true });

    let githubToken = null;
    if (githubTokenId) {
      const token = await getGithubTokenById(parseInt(githubTokenId), req.user.id);
      if (!token) {
        await fs.rm(absolutePath, { recursive: true, force: true });
        sendEvent('error', { message: 'GitHub token not found' });
        res.end();
        return;
      }
      githubToken = token.github_token;
    } else if (newGithubToken) {
      githubToken = newGithubToken;
    }

    const normalizedUrl = githubUrl.replace(/\/+$/, '').replace(/\.git$/, '');
    const repoName = normalizedUrl.split('/').pop() || 'repository';
    const clonePath = path.join(absolutePath, repoName);

    // Check if clone destination already exists to prevent data loss
    try {
      await fs.access(clonePath);
      sendEvent('error', { message: `Directory "${repoName}" already exists. Please choose a different location or remove the existing directory.` });
      res.end();
      return;
    } catch (err) {
      // Directory doesn't exist, which is what we want
    }

    let cloneUrl = githubUrl;
    if (githubToken) {
      try {
        const url = new URL(githubUrl);
        url.username = githubToken;
        url.password = '';
        cloneUrl = url.toString();
      } catch (error) {
        // SSH URL or invalid - use as-is
      }
    }

    sendEvent('progress', { message: `Cloning into '${repoName}'...` });

    const gitProcess = spawn('git', ['clone', '--progress', cloneUrl, clonePath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0'
      }
    });

    let lastError = '';

    gitProcess.stdout.on('data', (data) => {
      const message = data.toString().trim();
      if (message) {
        sendEvent('progress', { message });
      }
    });

    gitProcess.stderr.on('data', (data) => {
      const message = data.toString().trim();
      lastError = message;
      if (message) {
        sendEvent('progress', { message });
      }
    });

    gitProcess.on('close', async (code) => {
      if (code === 0) {
        try {
          const project = await addProjectManually(clonePath, null, req.user?.id);
          sendEvent('complete', { project, message: 'Repository cloned successfully' });
        } catch (error) {
          sendEvent('error', { message: `Clone succeeded but failed to add project: ${error.message}` });
        }
      } else {
        const sanitizedError = sanitizeGitError(lastError, githubToken);
        let errorMessage = 'Git clone failed';
        if (lastError.includes('Authentication failed') || lastError.includes('could not read Username')) {
          errorMessage = 'Authentication failed. Please check your credentials.';
        } else if (lastError.includes('Repository not found')) {
          errorMessage = 'Repository not found. Please check the URL and ensure you have access.';
        } else if (lastError.includes('already exists')) {
          errorMessage = 'Directory already exists';
        } else if (sanitizedError) {
          errorMessage = sanitizedError;
        }
        try {
          await fs.rm(clonePath, { recursive: true, force: true });
        } catch (cleanupError) {
          console.error('Failed to clean up after clone failure:', sanitizeGitError(cleanupError.message, githubToken));
        }
        sendEvent('error', { message: errorMessage });
      }
      res.end();
    });

    gitProcess.on('error', (error) => {
      if (error.code === 'ENOENT') {
        sendEvent('error', { message: 'Git is not installed or not in PATH' });
      } else {
        sendEvent('error', { message: error.message });
      }
      res.end();
    });

    req.on('close', () => {
      gitProcess.kill();
    });

  } catch (error) {
    sendEvent('error', { message: error.message });
    res.end();
  }
});

/**
 * Helper function to clone a GitHub repository
 */
function cloneGitHubRepository(githubUrl, destinationPath, githubToken = null) {
  return new Promise((resolve, reject) => {
    let cloneUrl = githubUrl;

    if (githubToken) {
      try {
        const url = new URL(githubUrl);
        url.username = githubToken;
        url.password = '';
        cloneUrl = url.toString();
      } catch (error) {
        // SSH URL - use as-is
      }
    }

    const gitProcess = spawn('git', ['clone', '--progress', cloneUrl, destinationPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0'
      }
    });

    let stdout = '';
    let stderr = '';

    gitProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    gitProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    gitProcess.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        let errorMessage = 'Git clone failed';

        if (stderr.includes('Authentication failed') || stderr.includes('could not read Username')) {
          errorMessage = 'Authentication failed. Please check your GitHub token.';
        } else if (stderr.includes('Repository not found')) {
          errorMessage = 'Repository not found. Please check the URL and ensure you have access.';
        } else if (stderr.includes('already exists')) {
          errorMessage = 'Directory already exists';
        } else if (stderr) {
          errorMessage = stderr;
        }

        reject(new Error(errorMessage));
      }
    });

    gitProcess.on('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(new Error('Git is not installed or not in PATH'));
      } else {
        reject(error);
      }
    });
  });
}

export default router;
