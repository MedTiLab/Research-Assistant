/**
 * PROJECT DISCOVERY AND MANAGEMENT SYSTEM
 * ========================================
 *
 * This module manages project discovery for agent sessions.
 *
 * ## Architecture Overview
 *
 * 1. **Claude Projects** (stored in ~/.claude/projects/)
 *    - Each project is a directory named with the project path encoded (/ replaced with -)
 *    - Contains .jsonl files with conversation history including 'cwd' field
 *    - Project metadata stored in ~/.medhelpsec/project-config.json
 *
 * ## Project Discovery Strategy
 *
 * 1. **Claude Projects Discovery**:
 *    - Scan ~/.claude/projects/ directory for Claude project folders
 *    - Extract actual project path from .jsonl files (cwd field)
 *    - Fall back to decoded directory name if no sessions exist
 *
 * 2. **Manual Project Addition**:
 *    - Users can manually add project paths via UI
 *    - Stored in ~/.medhelpsec/project-config.json with 'manuallyAdded' flag
 *
 * ## Error Handling
 *
 * - Missing ~/.claude directory is handled gracefully with automatic creation
 * - ENOENT errors are caught and handled without crashing
 * - Empty arrays returned when no projects/sessions exist
 *
 * ## Caching Strategy
 *
 * - Project directory extraction is cached to minimize file I/O
 * - Cache is cleared when project configuration changes
 * - Session data is fetched on-demand, not cached
 */

import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import { resolveSystemSkillsDir } from './utils/kernelAssetPaths.js';
import readline from 'readline';
import os from 'os';
import { buildSessionDisplayName, stripInternalContextPrefix } from './utils/sessionFormatting.js';
import { syncPiSessionIndex } from './pi-runtime/session-index.js';
import {
  extractSessionModeFromMetadata,
  extractSessionModeFromText,
  inferSessionModeFromUserMessage,
  normalizeSessionMode,
  readExplicitSessionModeFromMetadata,
} from './utils/sessionMode.js';
import { buildCodexTokenUsageFromTokenInfo } from './utils/sessionTokenUsage.js';
import {
  ensureProjectProviderSessionFile,
  findProviderSessionFile,
  resolveLegacyProjectConfigPaths,
  resolveProjectConfigPath,
  resolveUserSkillsDir,
} from './utils/storagePaths.js';
import {
  getMedHelpCodexSessionRoots,
  prepareMedHelpCodexHome,
} from './utils/codexHome.js';
import { assertExistingProjectDirectory } from './utils/projectFilesystemPath.js';
import {
  isCodexInternalContextContent,
  isCodexInternalNoticeContent,
  isCodexInternalPromptContent,
} from '../shared/codexInternalNotices.js';
import { extractVisibleUserContent } from '../shared/visibleUserContent.js';

const DRCLAW_SKILLS_DIR = resolveSystemSkillsDir();
const PROJECT_SKILL_FOLDERS = ['.claude', '.agents', '.codex'];
const CURRENT_DEFAULT_WORKSPACES_ROOT = os.homedir();
const DEFAULT_CONVERSATION_WORKSPACES_ROOT = path.join(os.homedir(), 'Documents', 'MedHelpSec');
const LEGACY_DEFAULT_WORKSPACES_ROOTS = [
  path.join(os.homedir(), 'medhelp_workspace'),
  path.join(os.homedir(), 'medhelp'),
  path.join(os.homedir(), 'dr-claw'),
  path.join(os.homedir(), 'vibelab'),
];
const DELETED_PROJECTS_CONFIG_KEY = '_deletedProjects';
const DEFAULT_CONVERSATION_PROJECT_PREFIX = 'general';

let projectConfigMutationQueue = Promise.resolve();

function isProjectTrashed(projectInfo = null, dbEntry = null) {
  return Boolean(projectInfo?.trash?.trashedAt || dbEntry?.metadata?.trash?.trashedAt);
}

function getSuppressedProjectMetadata(projectName, config = null, projectInfo = null) {
  return projectInfo?.deleted || config?.[DELETED_PROJECTS_CONFIG_KEY]?.[projectName] || null;
}

function isProjectSuppressed(projectName, config = null, projectInfo = null) {
  return Boolean(getSuppressedProjectMetadata(projectName, config, projectInfo)?.deletedAt);
}

function isSessionTrashed(session = null) {
  return Boolean(session?.metadata?.trash?.trashedAt);
}

function isConsultationSessionRecord(session = null) {
  return extractSessionModeFromMetadata(session?.metadata) === 'consultation'
    || normalizeSessionMode(session?.mode) === 'consultation';
}

function isSessionVisibleInProjectHistory(session = null) {
  return !isSessionTrashed(session) && !isConsultationSessionRecord(session);
}

function getDefaultConversationProjectDescriptor(userId = null, configuredWorkspaceRoot = null) {
  const ownerKey = userId == null
    ? 'local'
    : String(userId).replace(/[^A-Za-z0-9._-]+/g, '-');
  const configuredRoot = String(configuredWorkspaceRoot || '').trim();
  const fallbackRoot = path.resolve(
    process.env.WORKSPACES_ROOT
      || process.env.MEDHELP_DEFAULT_CONVERSATION_WORKSPACE
      || DEFAULT_CONVERSATION_WORKSPACES_ROOT,
  );
  const root = configuredRoot ? path.resolve(configuredRoot) : fallbackRoot;

  return {
    id: `${DEFAULT_CONVERSATION_PROJECT_PREFIX}-${ownerKey}`,
    // A folderless conversation still runs from the configured default
    // workspace. The UI simply does not treat that root as a connected project.
    path: root,
  };
}

async function ensureDefaultConversationProject(projectDb, userId = null, configuredWorkspaceRoot = null) {
  const descriptor = getDefaultConversationProjectDescriptor(userId, configuredWorkspaceRoot);
  const existing = projectDb.getProjectById(descriptor.id);
  const projectPath = descriptor.path;

  await fs.mkdir(projectPath, { recursive: true });
  projectDb.upsertProject(
    descriptor.id,
    existing?.user_id ?? userId ?? null,
    existing?.display_name || 'General',
    projectPath,
    existing?.is_starred || 0,
    existing?.last_accessed || new Date().toISOString(),
    {
      ...(existing?.metadata || {}),
      manuallyAdded: true,
      isDefaultWorkspace: true,
      protected: true,
    },
  );
  projectDirectoryCache.delete(descriptor.id);

  return descriptor.id;
}

function getProjectOwnerUserId(projectInfo = null, dbEntry = null) {
  return dbEntry?.user_id
    ?? projectInfo?.ownerUserId
    ?? projectInfo?.trash?.ownerUserId
    ?? projectInfo?.deleted?.ownerUserId
    ?? null;
}

function getDeletedProjectsStore(config) {
  if (!config[DELETED_PROJECTS_CONFIG_KEY] || typeof config[DELETED_PROJECTS_CONFIG_KEY] !== 'object') {
    config[DELETED_PROJECTS_CONFIG_KEY] = {};
  }

  return config[DELETED_PROJECTS_CONFIG_KEY];
}

function clearDeletedProjectMetadata(config, projectName) {
  if (!config?.[DELETED_PROJECTS_CONFIG_KEY]?.[projectName]) {
    return;
  }

  delete config[DELETED_PROJECTS_CONFIG_KEY][projectName];
  if (Object.keys(config[DELETED_PROJECTS_CONFIG_KEY]).length === 0) {
    delete config[DELETED_PROJECTS_CONFIG_KEY];
  }
}

async function readProjectInstanceId(projectPath) {
  if (!projectPath) {
    return null;
  }

  try {
    const instanceRaw = await fs.readFile(path.join(projectPath, 'instance.json'), 'utf8');
    const instanceData = JSON.parse(instanceRaw);
    return typeof instanceData?.instance_id === 'string' && instanceData.instance_id.trim()
      ? instanceData.instance_id.trim()
      : null;
  } catch (_) {
    return null;
  }
}

async function mutateProjectConfig(mutator) {
  const operation = projectConfigMutationQueue.then(async () => {
    const config = await loadProjectConfig();
    const result = await mutator(config);
    await saveProjectConfig(config);
    return result;
  });

  projectConfigMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function pathExists(targetPath) {
  if (!targetPath) {
    return false;
  }

  try {
    await fs.access(targetPath);
    return true;
  } catch (_) {
    return false;
  }
}

export function encodeClaudeProjectDirName(projectName) {
  return String(projectName || '').replace(/[^A-Za-z0-9-]/g, '-');
}

async function resolveClaudeProjectDir(projectName) {
  const claudeProjectsRoot = path.join(os.homedir(), '.claude', 'projects');
  const exactDir = path.join(claudeProjectsRoot, projectName);
  const compatibleName = encodeClaudeProjectDirName(projectName);
  const compatibleDir = path.join(claudeProjectsRoot, compatibleName);

  if (await pathExists(exactDir)) {
    return exactDir;
  }
  if (compatibleDir !== exactDir && await pathExists(compatibleDir)) {
    return compatibleDir;
  }

  return exactDir;
}

async function resolveProviderSessionProjectPath(projectName, sessionId = null, provider = null) {
  const { projectDb, sessionDb } = await import('./database/db.js');
  const indexedSession = sessionId
    ? sessionDb.getSessionById(sessionId, { projectName, provider })
    : null;
  return indexedSession?.metadata?.projectPath
    || projectDb.getProjectById(projectName)?.path
    || await extractProjectDirectory(projectName).catch(() => null);
}

async function bootstrapProjectsIndexFromLegacySources(config, projectDb, userId = null, visibleWorkspaceRoots = []) {
  const candidateProjectNames = new Set(Object.keys(config).filter((key) => !key.startsWith('_')));
  const claudeProjectsRoot = path.join(os.homedir(), '.claude', 'projects');

  try {
    const entries = await fs.readdir(claudeProjectsRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        candidateProjectNames.add(entry.name);
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[projects] Failed to read Claude projects for bootstrap:', error.message);
    }
  }

  let seededCount = 0;

  for (const projectName of candidateProjectNames) {
    const projectInfo = config[projectName];
    if (isProjectSuppressed(projectName, config, projectInfo)) {
      continue;
    }

    let projectPath = projectInfo?.originalPath || projectInfo?.path || null;
    if (!projectPath) {
      projectPath = await extractProjectDirectory(projectName);
    }
    if (!projectPath) {
      continue;
    }

    const isManuallyAdded = Boolean(projectInfo?.manuallyAdded);
    if (!isManuallyAdded && visibleWorkspaceRoots.length > 0 && !await isPathWithinWorkspaceRoots(projectPath, visibleWorkspaceRoots)) {
      continue;
    }

    const existing = projectDb.getProjectById(projectName);
    const ownerUserId = existing?.user_id ?? getProjectOwnerUserId(projectInfo, existing) ?? userId ?? null;
    const metadata = { ...(existing?.metadata || {}) };

    if (isManuallyAdded) {
      metadata.manuallyAdded = true;
    } else {
      delete metadata.manuallyAdded;
    }

    if (projectInfo?.trash?.trashedAt) {
      metadata.trash = {
        ...projectInfo.trash,
        ownerUserId: projectInfo.trash.ownerUserId ?? ownerUserId,
      };
    }

    projectDb.upsertProject(
      projectName,
      ownerUserId,
      existing?.display_name || projectInfo?.displayName || null,
      projectPath,
      existing?.is_starred || 0,
      existing?.last_accessed || null,
      Object.keys(metadata).length > 0 ? metadata : null,
    );
    seededCount += 1;
  }

  return seededCount;
}

function buildTrashEntry(projectName, projectInfo = null, dbEntry = null) {
  const trashMeta = dbEntry?.metadata?.trash || projectInfo?.trash;
  if (!trashMeta?.trashedAt) {
    return null;
  }

  const filesExist = trashMeta.filesExist !== false;

  return {
    name: projectName,
    displayName: dbEntry?.display_name || projectInfo?.displayName || trashMeta.displayName || projectName,
    fullPath: trashMeta.originalPath || dbEntry?.path || projectInfo?.originalPath || '',
    path: trashMeta.originalPath || dbEntry?.path || projectInfo?.originalPath || '',
    originalPath: trashMeta.originalPath || projectInfo?.originalPath || '',
    trashPath: trashMeta.trashPath || dbEntry?.path || '',
    claudeTrashPath: trashMeta.claudeTrashPath || '',
    trashedAt: trashMeta.trashedAt,
    sessionCount:
      typeof trashMeta.sessionCount === 'number'
        ? trashMeta.sessionCount
        : Array.isArray(dbEntry?.metadata?.sessions)
          ? dbEntry.metadata.sessions.length
          : 0,
    canRestore: Boolean(trashMeta.originalPath && filesExist),
    filesExist,
  };
}

function normalizeTaskStatus(status) {
    const raw = String(status || '').trim().toLowerCase();
    if (!raw) return 'pending';
    if (raw === 'completed' || raw === 'complete') return 'done';
    if (raw === 'in_progress' || raw === 'inprogress') return 'in-progress';
    if (raw === 'todo' || raw === 'open') return 'pending';
    return raw;
}

// Import TaskMaster detection functions
async function detectTaskMasterFolder(projectPath) {
    try {
        const pipelinePath = path.join(projectPath, '.pipeline');
        const legacyPath = path.join(projectPath, '.taskmaster');
        let taskMasterPath = pipelinePath;

        const hasPipeline = await fs.access(pipelinePath).then(() => true).catch(() => false);
        if (!hasPipeline) {
            const hasLegacy = await fs.access(legacyPath).then(() => true).catch(() => false);
            if (hasLegacy) {
                await fs.cp(legacyPath, pipelinePath, { recursive: true, force: false });
                taskMasterPath = pipelinePath;
            } else {
                taskMasterPath = pipelinePath;
            }
        }

        // Check if .pipeline directory exists
        try {
            const stats = await fs.stat(taskMasterPath);
            if (!stats.isDirectory()) {
                return {
                    hasTaskmaster: false,
                    reason: '.pipeline exists but is not a directory'
                };
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                return {
                    hasTaskmaster: false,
                    reason: '.pipeline directory not found'
                };
            }
            throw error;
        }

        // Check for key TaskMaster files
        const keyFiles = [
            'tasks/tasks.json',
            'config.json'
        ];

        const fileStatus = {};
        let hasEssentialFiles = true;

        for (const file of keyFiles) {
            const filePath = path.join(taskMasterPath, file);
            try {
                await fs.access(filePath);
                fileStatus[file] = true;
            } catch (error) {
                fileStatus[file] = false;
                if (file === 'tasks/tasks.json') {
                    hasEssentialFiles = false;
                }
            }
        }

        // Parse tasks.json if it exists for metadata
        let taskMetadata = null;
        if (fileStatus['tasks/tasks.json']) {
            try {
                const tasksPath = path.join(taskMasterPath, 'tasks/tasks.json');
                const tasksContent = await fs.readFile(tasksPath, 'utf8');
                const tasksData = JSON.parse(tasksContent);

                // Handle both tagged and legacy formats
                let tasks = [];
                if (tasksData.tasks) {
                    // Legacy format
                    tasks = tasksData.tasks;
                } else {
                    // Tagged format - get tasks from all tags
                    Object.values(tasksData).forEach(tagData => {
                        if (tagData.tasks) {
                            tasks = tasks.concat(tagData.tasks);
                        }
                    });
                }

                // Calculate task statistics
                const stats = tasks.reduce((acc, task) => {
                    const taskStatus = normalizeTaskStatus(task.status);
                    acc.total++;
                    acc[taskStatus] = (acc[taskStatus] || 0) + 1;

                    // Count subtasks
                    if (task.subtasks) {
                        task.subtasks.forEach(subtask => {
                            const subtaskStatus = normalizeTaskStatus(subtask.status);
                            acc.subtotalTasks++;
                            acc.subtasks = acc.subtasks || {};
                            acc.subtasks[subtaskStatus] = (acc.subtasks[subtaskStatus] || 0) + 1;
                        });
                    }

                    return acc;
                }, {
                    total: 0,
                    subtotalTasks: 0,
                    pending: 0,
                    'in-progress': 0,
                    done: 0,
                    review: 0,
                    deferred: 0,
                    cancelled: 0,
                    subtasks: {}
                });

                taskMetadata = {
                    taskCount: stats.total,
                    subtaskCount: stats.subtotalTasks,
                    completed: stats.done || 0,
                    pending: stats.pending || 0,
                    inProgress: stats['in-progress'] || 0,
                    review: stats.review || 0,
                    completionPercentage: stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0,
                    lastModified: (await fs.stat(tasksPath)).mtime.toISOString()
                };
            } catch (parseError) {
                console.warn('Failed to parse tasks.json:', parseError.message);
                taskMetadata = { error: 'Failed to parse tasks.json' };
            }
        }

        return {
            hasTaskmaster: true,
            hasEssentialFiles,
            files: fileStatus,
            metadata: taskMetadata,
            path: taskMasterPath
        };

    } catch (error) {
        console.error('Error detecting TaskMaster folder:', error);
        return {
            hasTaskmaster: false,
            reason: `Error checking directory: ${error.message}`
        };
    }
}

// Cache for extracted project directories
const projectDirectoryCache = new Map();

// Clear cache when needed (called when project files change)
function clearProjectDirectoryCache() {
  projectDirectoryCache.clear();
}

// Load project configuration file
async function writeProjectConfigFile(configPath, config) {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

async function loadProjectConfig() {
  const configPath = resolveProjectConfigPath();
  try {
    const configData = await fs.readFile(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      return {};
    }
  }

  for (const legacyPath of resolveLegacyProjectConfigPaths(os.homedir())) {
    try {
      const configData = await fs.readFile(legacyPath, 'utf8');
      const parsed = JSON.parse(configData);
      try {
        await writeProjectConfigFile(configPath, parsed);
      } catch (migrationError) {
        console.warn('[projects] Failed to migrate legacy project config:', migrationError.message);
      }
      return parsed;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        return {};
      }
    }
  }

  // Return empty config if no config exists anywhere.
  return {};
}

async function migrateLegacyDefaultWorkspacesRoot(targetRoot = CURRENT_DEFAULT_WORKSPACES_ROOT) {
  if (path.resolve(targetRoot) === path.resolve(os.homedir())) {
    return targetRoot;
  }

  if (targetRoot !== CURRENT_DEFAULT_WORKSPACES_ROOT) {
    return targetRoot;
  }

  const currentExists = fsSync.existsSync(CURRENT_DEFAULT_WORKSPACES_ROOT);
  const existingLegacyRoot = LEGACY_DEFAULT_WORKSPACES_ROOTS.find((legacyRoot) => fsSync.existsSync(legacyRoot)) || null;

  if (!existingLegacyRoot || currentExists) {
    return targetRoot;
  }

  try {
    await fs.rename(existingLegacyRoot, CURRENT_DEFAULT_WORKSPACES_ROOT);
    return CURRENT_DEFAULT_WORKSPACES_ROOT;
  } catch (error) {
    console.warn('[projects] Failed to migrate legacy default workspace root, using legacy path:', error.message);
    return existingLegacyRoot;
  }
}

async function resolveConfiguredWorkspacesRoot(configRoot = null) {
  if (!configRoot) {
    return migrateLegacyDefaultWorkspacesRoot();
  }

  if (LEGACY_DEFAULT_WORKSPACES_ROOTS.includes(configRoot)) {
    return migrateLegacyDefaultWorkspacesRoot();
  }

  return configRoot;
}

async function normalizeWorkspaceRoots(roots) {
  const normalizedRoots = [];

  for (const root of roots) {
    if (!root) continue;

    try {
      const normalizedRoot = await normalizeComparablePath(root);
      if (!normalizedRoots.includes(normalizedRoot)) {
        normalizedRoots.push(normalizedRoot);
      }
    } catch (error) {
      console.warn('[projects] Failed to normalize workspace root:', root, error.message);
    }
  }

  return normalizedRoots;
}

async function getVisibleWorkspaceRoots(configRoot = null) {
  const resolvedRoot = process.env.WORKSPACES_ROOT || await resolveConfiguredWorkspacesRoot(configRoot);
  const candidateRoots = [resolvedRoot];

  const usesDefaultWorkspaceRoot =
    !process.env.WORKSPACES_ROOT &&
    (!configRoot ||
      configRoot === CURRENT_DEFAULT_WORKSPACES_ROOT ||
      LEGACY_DEFAULT_WORKSPACES_ROOTS.includes(configRoot) ||
      resolvedRoot === CURRENT_DEFAULT_WORKSPACES_ROOT ||
      LEGACY_DEFAULT_WORKSPACES_ROOTS.includes(resolvedRoot));

  if (usesDefaultWorkspaceRoot) {
    candidateRoots.push(...LEGACY_DEFAULT_WORKSPACES_ROOTS);
    candidateRoots.push(CURRENT_DEFAULT_WORKSPACES_ROOT);
  }

  return normalizeWorkspaceRoots(candidateRoots);
}

async function isPathWithinWorkspaceRoots(candidatePath, normalizedRoots) {
  const normalizedPath = await normalizeComparablePath(candidatePath);
  return normalizedRoots.some((root) => normalizedPath === root || normalizedPath.startsWith(root + path.sep));
}

function remapProjectPathToCurrentHome(projectPath) {
  if (!projectPath) {
    return null;
  }

  const normalizedPath = path.resolve(projectPath);
  const currentHome = path.resolve(os.homedir());
  const homeParent = path.dirname(currentHome);

  if (
    normalizedPath === currentHome
    || normalizedPath.startsWith(currentHome + path.sep)
    || !normalizedPath.startsWith(homeParent + path.sep)
  ) {
    return null;
  }

  const relativeFromHomeParent = path.relative(homeParent, normalizedPath);
  const [candidateHomeName, ...restSegments] = relativeFromHomeParent.split(path.sep).filter(Boolean);

  if (!candidateHomeName || candidateHomeName === path.basename(currentHome) || restSegments.length === 0) {
    return null;
  }

  return path.join(currentHome, ...restSegments);
}

function rewriteProjectMetadataPaths(metadata, oldPath, newPath) {
  if (!metadata || typeof metadata !== 'object') {
    return metadata;
  }

  let changed = false;
  const nextMetadata = { ...metadata };

  if (nextMetadata.originalPath === oldPath) {
    nextMetadata.originalPath = newPath;
    changed = true;
  }

  if (nextMetadata.path === oldPath) {
    nextMetadata.path = newPath;
    changed = true;
  }

  if (nextMetadata.trash?.originalPath === oldPath) {
    nextMetadata.trash = {
      ...nextMetadata.trash,
      originalPath: newPath,
    };
    changed = true;
  }

  return changed ? nextMetadata : metadata;
}

function rewriteProjectConfigPaths(config, projectName, oldPath, newPath) {
  let changed = false;
  const projectInfo = config?.[projectName];

  if (projectInfo?.originalPath === oldPath) {
    projectInfo.originalPath = newPath;
    changed = true;
  }

  if (projectInfo?.path === oldPath) {
    projectInfo.path = newPath;
    changed = true;
  }

  if (projectInfo?.trash?.originalPath === oldPath) {
    projectInfo.trash = {
      ...projectInfo.trash,
      originalPath: newPath,
    };
    changed = true;
  }

  const deletedProject = config?.[DELETED_PROJECTS_CONFIG_KEY]?.[projectName];
  if (deletedProject?.originalPath === oldPath) {
    deletedProject.originalPath = newPath;
    changed = true;
  }

  return changed;
}

async function maybeMigrateProjectPathToCurrentHome(projectName, projectPath, projectDb, config = null, existingEntry = null) {
  const migratedPath = remapProjectPathToCurrentHome(projectPath);
  if (!migratedPath || migratedPath === projectPath) {
    return null;
  }

  if (await pathExists(projectPath) || !await pathExists(migratedPath)) {
    return null;
  }

  let configDirty = false;
  if (config) {
    configDirty = rewriteProjectConfigPaths(config, projectName, projectPath, migratedPath);
  }

  if (projectDb) {
    const dbEntry = existingEntry || projectDb.getProjectById(projectName);
    if (dbEntry) {
      const nextMetadata = rewriteProjectMetadataPaths(dbEntry.metadata, projectPath, migratedPath);
      projectDb.upsertProject(
        projectName,
        dbEntry.user_id ?? null,
        dbEntry.display_name ?? null,
        migratedPath,
        dbEntry.is_starred ?? 0,
        dbEntry.last_accessed ?? null,
        nextMetadata || null,
      );
    }
  }

  console.log(`[projects] Remapped project path from previous home: ${projectName} -> ${migratedPath}`);

  return {
    oldPath: projectPath,
    newPath: migratedPath,
    configDirty,
  };
}

function remapLegacyProjectPath(projectPath) {
  if (!projectPath) return null;
  if (path.resolve(CURRENT_DEFAULT_WORKSPACES_ROOT) === path.resolve(os.homedir())) {
    return null;
  }

  const normalizedPath = path.resolve(projectPath);
  for (const legacyRoot of LEGACY_DEFAULT_WORKSPACES_ROOTS) {
    if (
      normalizedPath === legacyRoot ||
      normalizedPath.startsWith(legacyRoot + path.sep)
    ) {
      return path.join(
        CURRENT_DEFAULT_WORKSPACES_ROOT,
        path.relative(legacyRoot, normalizedPath)
      );
    }
  }

  return null;
}

function remapCurrentProjectPathsToLegacy(projectPath) {
  if (!projectPath) return [];
  if (path.resolve(CURRENT_DEFAULT_WORKSPACES_ROOT) === path.resolve(os.homedir())) {
    return [];
  }

  const normalizedPath = path.resolve(projectPath);
  if (
    normalizedPath !== CURRENT_DEFAULT_WORKSPACES_ROOT &&
    !normalizedPath.startsWith(CURRENT_DEFAULT_WORKSPACES_ROOT + path.sep)
  ) {
    return [];
  }

  return LEGACY_DEFAULT_WORKSPACES_ROOTS.map((legacyRoot) => (
    path.join(
      legacyRoot,
      path.relative(CURRENT_DEFAULT_WORKSPACES_ROOT, normalizedPath)
    )
  ));
}

function remapCurrentProjectPathToLegacy(projectPath) {
  return remapCurrentProjectPathsToLegacy(projectPath)[0] || null;
}

async function maybeMigrateLegacyProject(projectName, projectInfo, projectDb) {
  const legacyPath = projectInfo?.originalPath || projectInfo?.path;
  const migratedPath = remapLegacyProjectPath(legacyPath);

  if (!legacyPath || !migratedPath || migratedPath === legacyPath) {
    return null;
  }

  const legacyProjectId = projectName || encodeProjectPath(legacyPath);
  const migratedProjectId = encodeProjectPath(migratedPath);
  const legacyClaudeDir = path.join(os.homedir(), '.claude', 'projects', legacyProjectId);
  const migratedClaudeDir = path.join(os.homedir(), '.claude', 'projects', migratedProjectId);

  let legacyExists = false;
  let migratedExists = false;

  try {
    await fs.access(legacyPath);
    legacyExists = true;
  } catch (_) {}

  try {
    await fs.access(migratedPath);
    migratedExists = true;
  } catch (_) {}

  if (legacyExists && !migratedExists) {
    try {
      await fs.mkdir(path.dirname(migratedPath), { recursive: true });
      await fs.rename(legacyPath, migratedPath);
      migratedExists = true;
      legacyExists = false;
    } catch (error) {
      console.warn('[projects] Failed to move legacy project directory:', legacyPath, '->', migratedPath, error.message);
      return null;
    }
  }

  if (!migratedExists) {
    return null;
  }

  try {
    await fs.access(legacyClaudeDir);
    try {
      await fs.access(migratedClaudeDir);
    } catch (_) {
      await fs.rename(legacyClaudeDir, migratedClaudeDir);
    }
  } catch (_) {}

  if (projectDb && legacyProjectId !== migratedProjectId) {
    const existingMigratedProject = projectDb.getProjectById(migratedProjectId);
    if (!existingMigratedProject) {
      const existingLegacyProject = projectDb.getProjectById(legacyProjectId);
      if (existingLegacyProject) {
        projectDb.migrateProjectIdentity(legacyProjectId, migratedProjectId, migratedPath);
      }
    }
  } else if (projectDb) {
    projectDb.updateProjectPath(migratedProjectId, migratedPath);
  }

  return {
    oldId: legacyProjectId,
    newId: migratedProjectId,
    oldPath: legacyPath,
    newPath: migratedPath
  };
}

async function migrateLegacyProjects(config, projectDb) {
  let configDirty = false;

  for (const [projectName, projectInfo] of Object.entries(config)) {
    if (projectName.startsWith('_') || !projectInfo?.originalPath) {
      continue;
    }

    const migration = await maybeMigrateLegacyProject(projectName, projectInfo, projectDb);
    if (!migration) {
      continue;
    }

    const nextProjectInfo = {
      ...projectInfo,
      originalPath: migration.newPath
    };

    if (migration.oldId !== migration.newId) {
      if (!config[migration.newId]) {
        config[migration.newId] = nextProjectInfo;
      }
      delete config[projectName];
    } else {
      config[projectName] = nextProjectInfo;
    }
    configDirty = true;
  }

  if (configDirty) {
    await saveProjectConfig(config);
    clearProjectDirectoryCache();
  }

  return configDirty;
}

async function migrateProjectsToCurrentHome(config, projectDb) {
  let configDirty = false;
  const seenProjectIds = new Set();

  for (const dbEntry of projectDb.getAllProjects()) {
    seenProjectIds.add(dbEntry.id);
    const migration = await maybeMigrateProjectPathToCurrentHome(
      dbEntry.id,
      dbEntry.path,
      projectDb,
      config,
      dbEntry,
    );
    if (migration?.configDirty) {
      configDirty = true;
    }
  }

  for (const [projectName, projectInfo] of Object.entries(config)) {
    if (projectName.startsWith('_') || seenProjectIds.has(projectName)) {
      continue;
    }

    const projectPath = projectInfo?.originalPath || projectInfo?.path || null;
    if (!projectPath) {
      continue;
    }

    const migration = await maybeMigrateProjectPathToCurrentHome(
      projectName,
      projectPath,
      null,
      config,
    );
    if (migration?.configDirty) {
      configDirty = true;
    }
  }

  if (configDirty) {
    await saveProjectConfig(config);
    clearProjectDirectoryCache();
  }

  return configDirty;
}

// Save project configuration file
async function saveProjectConfig(config) {
  await writeProjectConfigFile(resolveProjectConfigPath(), config);
}

export function encodeProjectPath(projectPath) {
  return path.resolve(projectPath).replace(/[\\/:\s~_.]/g, '-');
}

// Generate better display name from path
async function generateDisplayName(projectName, actualProjectDir = null) {
  // Use actual project directory if provided, otherwise decode from project name
  let projectPath = actualProjectDir || projectName.replace(/-/g, '/');

  // Try to read package.json from the project path
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageData = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageData);

    // Return the name from package.json if it exists
    if (packageJson.name) {
      return packageJson.name;
    }
  } catch (error) {
    // Fall back to path-based naming if package.json doesn't exist or can't be read
  }

  // If it starts with /, it's an absolute path
  if (projectPath.startsWith('/')) {
    const parts = projectPath.split('/').filter(Boolean);
    // Return only the last folder name
    return parts[parts.length - 1] || projectPath;
  }

  return projectPath;
}

// Extract the actual project directory from JSONL sessions (with caching)
async function extractProjectDirectory(projectName) {
  // Check cache first
  if (projectDirectoryCache.has(projectName)) {
    return projectDirectoryCache.get(projectName);
  }

  // The project index is authoritative for manually added and synthetic
  // projects such as the fixed general-conversation workspace. Those IDs are
  // not encoded filesystem paths, so decoding the ID would point elsewhere.
  try {
    const { projectDb } = await import('./database/db.js');
    const indexedPath = projectDb.getProjectById(projectName)?.path;
    if (indexedPath) {
      projectDirectoryCache.set(projectName, indexedPath);
      return indexedPath;
    }
  } catch (error) {
    console.warn(`[projects] Failed to read indexed path for ${projectName}:`, error.message);
  }

  // Check project config for originalPath (manually added projects via UI or platform)
  // This handles projects with dashes in their directory names correctly
  const config = await loadProjectConfig();
  if (config[projectName]?.originalPath) {
    const originalPath = config[projectName].originalPath;
    projectDirectoryCache.set(projectName, originalPath);
    return originalPath;
  }

  const projectDir = await resolveClaudeProjectDir(projectName);
  const cwdCounts = new Map();
  let latestTimestamp = 0;
  let latestCwd = null;
  let extractedPath;

  try {
    // Check if the project directory exists
    await fs.access(projectDir);

    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));

    if (jsonlFiles.length === 0) {
      // Fall back to decoded project name if no sessions, but never to '/'
      const decoded = projectName.replace(/-/g, '/');
      extractedPath = decoded === '/' ? os.homedir() : decoded;
    } else {
      // Process all JSONL files to collect cwd values
      for (const file of jsonlFiles) {
        const jsonlFile = path.join(projectDir, file);
        const fileStream = fsSync.createReadStream(jsonlFile);
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity
        });

        for await (const line of rl) {
          if (line.trim()) {
            try {
              const entry = JSON.parse(line);

              if (entry.cwd) {
                // Count occurrences of each cwd
                cwdCounts.set(entry.cwd, (cwdCounts.get(entry.cwd) || 0) + 1);

                // Track the most recent cwd
                const timestamp = new Date(entry.timestamp || 0).getTime();
                if (timestamp > latestTimestamp) {
                  latestTimestamp = timestamp;
                  latestCwd = entry.cwd;
                }
              }
            } catch (parseError) {
              // Skip malformed lines
            }
          }
        }
        rl.close();
        fileStream.destroy();
      }

      // Determine the best cwd to use
      if (cwdCounts.size === 0) {
        // No cwd found, fall back to decoded project name, but never to '/'
        const decoded = projectName.replace(/-/g, '/');
        extractedPath = decoded === '/' ? os.homedir() : decoded;
      } else if (cwdCounts.size === 1) {
        // Only one cwd, use it
        extractedPath = Array.from(cwdCounts.keys())[0];
      } else {
        // Multiple cwd values - prefer the most recent one if it has reasonable usage
        const mostRecentCount = cwdCounts.get(latestCwd) || 0;
        const maxCount = Math.max(...cwdCounts.values());

        // Use most recent if it has at least 25% of the max count
        if (mostRecentCount >= maxCount * 0.25) {
          extractedPath = latestCwd;
        } else {
          // Otherwise use the most frequently used cwd
          for (const [cwd, count] of cwdCounts.entries()) {
            if (count === maxCount) {
              extractedPath = cwd;
              break;
            }
          }
        }

        // Fallback (shouldn't reach here)
        if (!extractedPath) {
          const decoded = projectName.replace(/-/g, '/');
          extractedPath = latestCwd || (decoded === '/' ? os.homedir() : decoded);
        }
      }
    }

    // Cache the result
    projectDirectoryCache.set(projectName, extractedPath);

    return extractedPath;

  } catch (error) {
    // If the directory doesn't exist, just use the decoded project name
    if (error.code === 'ENOENT') {
      const decoded = projectName.replace(/-/g, '/');
      extractedPath = decoded === '/' ? os.homedir() : decoded;
    } else {
      console.error(`Error extracting project directory for ${projectName}:`, error);
      // Fall back to decoded project name for other errors, but never to '/'
      const decoded = projectName.replace(/-/g, '/');
      extractedPath = decoded === '/' ? os.homedir() : decoded;
    }

    // Cache the fallback result too
    projectDirectoryCache.set(projectName, extractedPath);

    return extractedPath;
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  };

  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function mapIndexedSessionToProjectSession(session, provider) {
  const metadata = session?.metadata && typeof session.metadata === 'object' ? session.metadata : {};
  const mode = extractSessionModeFromMetadata(metadata);
  const lastActivity = session?.last_activity || session?.lastActivity || session?.created_at || session?.createdAt || null;
  const createdAt = session?.created_at || session?.createdAt || lastActivity;
  const messageCount = Number(session?.message_count ?? session?.messageCount ?? 0);
  const baseName = session?.display_name || session?.name || session?.summary || null;
  const tags = Array.isArray(session?.tags) ? session.tags : [];
  const identity = {
    sessionKey: session?.sessionKey || session?.session_key || null,
    ownerKey: session?.ownerKey || session?.owner_key || null,
    projectKey: session?.projectKey || session?.project_key || session?.project_name || null,
    runtimeId: session?.runtimeId
      || session?.runtime_id
      || (['claude', 'codex', 'pi'].includes(provider) ? provider : 'claude'),
    modelProviderId: session?.modelProviderId || session?.model_provider_id || null,
    modelId: session?.modelId || session?.model_id || null,
    catalogRevision: session?.catalogRevision ?? session?.catalog_revision ?? null,
  };

  if (provider === 'codex') {
    return {
      id: session.id,
      summary: baseName || 'Codex Session',
      name: baseName || 'Codex Session',
      createdAt,
      lastActivity,
      messageCount,
      mode,
      tags,
      ...identity,
      __provider: 'codex',
    };
  }

  if (provider === 'pi') {
    return {
      id: session.id,
      summary: baseName || 'Pi Session',
      name: baseName || 'Pi Session',
      createdAt,
      lastActivity,
      messageCount,
      mode,
      tags,
      ...identity,
      __provider: 'pi',
    };
  }

  if (provider === 'openrouter') {
    return {
      id: session.id,
      summary: baseName || 'OpenRouter Session',
      name: baseName || 'OpenRouter Session',
      createdAt,
      lastActivity,
      messageCount,
      mode,
      tags,
      ...identity,
      __provider: 'openrouter',
    };
  }

  if (provider === 'local') {
    return {
      id: session.id,
      summary: baseName || 'Local GPU Session',
      name: baseName || 'Local GPU Session',
      createdAt,
      lastActivity,
      messageCount,
      mode,
      tags,
      ...identity,
      __provider: 'local',
    };
  }

  return {
    id: session.id,
    summary: baseName || 'New Session',
    createdAt,
    lastActivity,
    messageCount,
    mode,
    tags,
    ...identity,
    __provider: 'claude',
  };
}

function getSessionPlaceholderName(provider) {
  switch (provider) {
    case 'codex':
      return 'Codex Session';
    case 'pi':
      return 'Pi Session';
    case 'openrouter':
      return 'OpenRouter Session';
    case 'local':
      return 'Local GPU Session';
    default:
      return 'New Session';
  }
}

const LEGACY_CODEX_PLACEHOLDER_SESSION_ID_RE = /^codex-\d+$/;

function isLegacyCodexPlaceholderSessionId(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    return false;
  }

  return (
    LEGACY_CODEX_PLACEHOLDER_SESSION_ID_RE.test(sessionId)
    || sessionId.startsWith('new-session-')
    || sessionId.startsWith('temp-')
  );
}

function isPlaceholderSessionName(provider, displayName) {
  return String(displayName || '').trim() === getSessionPlaceholderName(provider);
}

function isManualSessionDisplayName(session) {
  return session?.metadata?.displayNameSource === 'manual';
}

function isManualSummaryEntry(entry) {
  return entry?.isManual === true
    || entry?.source === 'medhelp-user-rename'
    || entry?.metadata?.displayNameSource === 'manual';
}

async function shouldRefreshIndexedSession(provider, indexedSession, parsedSession) {
  if (!parsedSession) {
    return false;
  }

  if (!indexedSession) {
    return true;
  }

  const indexedName = String(indexedSession.display_name || indexedSession.name || indexedSession.summary || '').trim();
  const parsedName = String(parsedSession.summary || parsedSession.name || '').trim();
  if (!isManualSessionDisplayName(indexedSession) && parsedName && indexedName !== parsedName) {
    return true;
  }

  const indexedCount = Number(indexedSession.message_count ?? indexedSession.messageCount ?? 0);
  const parsedCount = Number(parsedSession.messageCount ?? 0);
  if (parsedCount > indexedCount) {
    return true;
  }

  const { normalizeSessionTimestamp } = await import('./database/db.js');
  const indexedLastActivity = normalizeSessionTimestamp(indexedSession.last_activity || indexedSession.lastActivity);
  const parsedLastActivity = normalizeSessionTimestamp(parsedSession.lastActivity);
  if (parsedLastActivity && parsedLastActivity !== indexedLastActivity) {
    return true;
  }

  const indexedMode = extractSessionModeFromMetadata(indexedSession.metadata);
  const parsedMode = normalizeSessionMode(parsedSession.mode);
  if (indexedMode !== parsedMode) {
    return true;
  }

  return isPlaceholderSessionName(provider, indexedName) && Boolean(parsedName);
}

async function reconcileIndexedSessionFromSource(projectName, provider, parsedSession, indexedSession = null, projectPath = null) {
  const { sessionDb, normalizeSessionTimestamp } = await import('./database/db.js');

  const resolvedProjectPath =
    projectPath ||
    parsedSession.projectPath ||
    parsedSession.cwd ||
    indexedSession?.metadata?.projectPath ||
    await extractProjectDirectory(projectName).catch(() => null);
  const metadata = {
    ...(indexedSession?.metadata && typeof indexedSession.metadata === 'object' ? indexedSession.metadata : {}),
    sessionMode: normalizeSessionMode(parsedSession.mode),
    indexState: 'synced',
    displayNameSource: isManualSessionDisplayName(indexedSession)
      ? 'manual'
      : (parsedSession.displayNameSource || (parsedSession.summary ? 'user' : 'placeholder')),
  };
  if (resolvedProjectPath) {
    metadata.projectPath = resolvedProjectPath;
  }

  sessionDb.upsertSessionFromSource(parsedSession.id, projectName, provider, {
    displayName: isManualSessionDisplayName(indexedSession)
      ? indexedSession.display_name
      : (parsedSession.summary || parsedSession.name || null),
    lastActivity: normalizeSessionTimestamp(parsedSession.lastActivity),
    messageCount: Number(parsedSession.messageCount || 0),
    metadata,
    createdAt: parsedSession.createdAt || indexedSession?.created_at || null,
    isStarred: indexedSession?.is_starred ?? 0,
  });
}

async function reconcileClaudeSessionIndex(projectName, targetSessionId = null) {
  if (targetSessionId) {
    const projectDir = await resolveClaudeProjectDir(projectName);
    const sessionFile = path.join(projectDir, `${targetSessionId}.jsonl`);
    const { sessionDb } = await import('./database/db.js');

    try {
      await fs.access(sessionFile);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { sessions: [], hasMore: false, total: 0, session: null };
      }
      throw error;
    }

    const dbSessions = sessionDb.getSessionsByProject(projectName);
    const dbSessionMap = new Map(dbSessions.filter((session) => session.provider === 'claude').map((session) => [session.id, session]));
    const projectPath = await extractProjectDirectory(projectName).catch(() => null);
    const result = await parseJsonlSessions(sessionFile, projectName, dbSessionMap);
    const session = (result.sessions || []).find((item) => item.id === targetSessionId) || null;

    if (session) {
      const indexedSession = dbSessionMap.get(session.id) || null;
      if (await shouldRefreshIndexedSession('claude', indexedSession, session)) {
        await reconcileIndexedSessionFromSource(projectName, 'claude', session, indexedSession, projectPath);
      }
    }

    return {
      sessions: session ? [session] : [],
      hasMore: false,
      total: session ? 1 : 0,
      session,
    };
  }

  return getSessions(projectName, 0, 0);
}

async function reconcileOpenRouterSessionIndex(projectPath, options = {}) {
  const { sessionId = null, projectName = null } = options;
  if (!sessionId) return;
  const resolvedProjectName = projectName || encodeProjectPath(projectPath);
  const sessionFile = await ensureProjectProviderSessionFile({
    projectPath,
    providerDirName: 'openrouter-sessions',
    sessionId,
  });
  try {
    const raw = await fs.readFile(sessionFile, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    let displayName = null;
    let messageCount = 0;
    let lastActivity = null;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.role === 'user' && !displayName) {
          const raw = (entry.content || '').replace(/\s*\[Context:[^\]]*\]\s*/gi, '').trim();
          displayName = raw.slice(0, 100) || null;
        }
        if (entry.role === 'user' || entry.role === 'assistant') {
          messageCount++;
        }
        if (entry.ts) lastActivity = entry.ts;
      } catch {}
    }
    const { sessionDb } = await import('./database/db.js');
    sessionDb.upsertSession(
      sessionId,
      resolvedProjectName,
      'openrouter',
      displayName || 'OpenRouter Session',
      lastActivity || new Date().toISOString(),
      messageCount,
      null,
    );
  } catch (err) {
    console.warn(`[OpenRouter] Failed to reconcile session ${sessionId}:`, err.message);
  }
}

async function reconcileLocalGPUSessionIndex(projectPath, options = {}) {
  const { sessionId = null, projectName = null } = options;
  if (!sessionId) return;
  const resolvedProjectName = projectName || encodeProjectPath(projectPath);
  const sessionFile = await ensureProjectProviderSessionFile({
    projectPath,
    providerDirName: 'localgpu-sessions',
    sessionId,
  });
  try {
    const raw = await fs.readFile(sessionFile, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    let displayName = null;
    let messageCount = 0;
    let lastActivity = null;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.role === 'user' && !displayName) {
          const userText = (entry.content || '').replace(/\s*\[Context:[^\]]*\]\s*/gi, '').trim();
          displayName = userText.slice(0, 100) || null;
        }
        if (entry.role === 'user' || entry.role === 'assistant') {
          messageCount++;
        }
        if (entry.ts) lastActivity = entry.ts;
      } catch {}
    }
    const { sessionDb } = await import('./database/db.js');
    sessionDb.upsertSession(
      sessionId,
      resolvedProjectName,
      'local',
      displayName || 'Local GPU Session',
      lastActivity || new Date().toISOString(),
      messageCount,
      null,
    );
  } catch (err) {
    console.warn(`[LocalGPU] Failed to reconcile session ${sessionId}:`, err.message);
  }
}

async function reconcileCodexSessionIndex(projectPath, options = {}) {
  const {
    limit = 0,
    sessionId = null,
    previousSessionId = null,
    projectName = null,
    indexRef = null,
  } = options;
  const sessions = await getCodexSessions(projectPath, {
    limit,
    syncIndex: true,
    sessionId,
    projectName,
    indexRef,
  });

  if (previousSessionId && sessionId && previousSessionId !== sessionId) {
    const { sessionDb } = await import('./database/db.js');
    sessionDb.migrateSessionId(previousSessionId, sessionId, 'codex', projectName || encodeProjectPath(projectPath));
  }

  if (sessions.length > 0) {
    const { sessionDb } = await import('./database/db.js');
    const resolvedProjectName = projectName || encodeProjectPath(projectPath);
    const validSessionIds = new Set(sessions.map((entry) => entry?.id).filter(Boolean));
    const indexedSessions = sessionDb.getSessionsByProject(resolvedProjectName);

    indexedSessions
      .filter((entry) => entry?.provider === 'codex')
      .filter((entry) => isLegacyCodexPlaceholderSessionId(entry.id))
      .filter((entry) => !validSessionIds.has(entry.id))
      .forEach((entry) => sessionDb.deleteSession(entry.id, {
        projectName: resolvedProjectName,
        provider: 'codex',
      }));
  }

  return sessions;
}

async function reindexProjectSessions(projectName, options = {}) {
  const {
    providers = ['codex'],
    userId = null,
  } = options;
  const normalizedProviders = Array.isArray(providers)
    ? Array.from(new Set(providers.filter((provider) => ['codex'].includes(provider))))
    : ['codex'];

  const actualProjectPath = await extractProjectDirectory(projectName);
  if (!actualProjectPath) {
    throw new Error(`Project path not found for ${projectName}`);
  }

  const { projectDb, sessionDb } = await import('./database/db.js');
  const existingProject = projectDb.getProjectById(projectName);
  if (userId && existingProject?.user_id && existingProject.user_id !== userId) {
    throw new Error('You do not have permission to reindex this project');
  }

  const codexIndexRef = normalizedProviders.includes('codex') ? {} : null;

  for (const provider of normalizedProviders) {
    if (provider === 'codex') {
      await reconcileCodexSessionIndex(actualProjectPath, {
        limit: 0,
        projectName,
        indexRef: codexIndexRef,
      });
    }
  }

  const indexedSessions = sessionDb.getSessionsByProject(projectName).filter(isSessionVisibleInProjectHistory);
  return {
    providers: normalizedProviders,
    sessions: indexedSessions.filter((session) => session.provider === 'claude').map((session) => mapIndexedSessionToProjectSession(session, 'claude')),
    codexSessions: indexedSessions.filter((session) => session.provider === 'codex').map((session) => mapIndexedSessionToProjectSession(session, 'codex')),
    piSessions: indexedSessions.filter((session) => session.provider === 'pi').map((session) => mapIndexedSessionToProjectSession(session, 'pi')),
    openrouterSessions: indexedSessions.filter((session) => session.provider === 'openrouter').map((session) => mapIndexedSessionToProjectSession(session, 'openrouter')),
    localSessions: indexedSessions.filter((session) => session.provider === 'local').map((session) => mapIndexedSessionToProjectSession(session, 'local')),
  };
}

async function getProjects(userId, progressCallback = null, { sessionOwnerKey = userId } = {}) {
  const { projectDb, sessionDb, userDb } = await import('./database/db.js');
  const config = await loadProjectConfig();
  const projects = [];
  // Pi transcripts are scoped to the authenticated account, independently of
  // the local project's legacy database owner. Never mix those indexes.
  const visibleSession = (session) => isSessionVisibleInProjectHistory(session)
    && (session.provider !== 'pi' || sessionOwnerKey == null
      || String(session.ownerKey ?? session.owner_key) === String(sessionOwnerKey));

  await migrateLegacyProjects(config, projectDb);
  await migrateProjectsToCurrentHome(config, projectDb);

  const visibleWorkspaceRoots = await getVisibleWorkspaceRoots(config._workspacesRoot || null);
  let totalProjects = 0;
  let processedProjects = 0;

  let dbProjects = projectDb.getAllProjects(userId || null);
  if (dbProjects.length === 0) {
    const seededCount = await bootstrapProjectsIndexFromLegacySources(
      config,
      projectDb,
      userId || null,
      visibleWorkspaceRoots,
    );
    if (seededCount > 0) {
      dbProjects = projectDb.getAllProjects(userId || null);
    }
  }

  try {
    const configuredConversationRoot = userId
      ? userDb.getWorkspaceRootUser(userId)?.workspace_root || null
      : config._workspacesRoot || null;
    await ensureDefaultConversationProject(projectDb, userId || null, configuredConversationRoot);
    dbProjects = projectDb.getAllProjects(userId || null);
  } catch (error) {
    console.warn('[projects] Failed to prepare the default conversation workspace:', error.message);
  }

  try {
    const visibleProjects = [];
    for (const dbEntry of dbProjects) {
      const projectInfo = config[dbEntry.id];
      if (
        isProjectTrashed(projectInfo, dbEntry)
        || isProjectSuppressed(dbEntry.id, config, projectInfo)
      ) {
        continue;
      }

      const projectPath = dbEntry.path || projectInfo?.originalPath || null;
      if (!projectPath) {
        continue;
      }

      const isManuallyAdded = Boolean(dbEntry.metadata?.manuallyAdded || projectInfo?.manuallyAdded);
      if (!isManuallyAdded && !await isPathWithinWorkspaceRoots(projectPath, visibleWorkspaceRoots)) {
        console.log(`[projects] Skipping external DB project: ${dbEntry.id} at ${projectPath}`);
        continue;
      }

      visibleProjects.push({
        entry: { name: dbEntry.id },
        actualProjectDir: projectPath,
        dbEntry,
        isManuallyAdded,
      });
    }

    const projectNames = visibleProjects.map(({ entry }) => entry.name);
    let indexedSessions = sessionDb.getSessionsByProjects(projectNames).filter(visibleSession);
    const sessionsByProject = new Map();

    for (const session of indexedSessions) {
      if (!sessionsByProject.has(session.project_name)) {
        sessionsByProject.set(session.project_name, []);
      }
      sessionsByProject.get(session.project_name).push(session);
    }

    const stalePiSessions = indexedSessions.filter((session) => {
      if (session?.provider !== 'pi' || isManualSessionDisplayName(session)) {
        return false;
      }
      const displayName = String(session.display_name || '').trim();
      const messageCount = Number(session.message_count ?? session.messageCount ?? 0);
      return messageCount === 0
        || !displayName
        || displayName === getSessionPlaceholderName('pi')
        || session?.metadata?.displayNameSource === 'placeholder';
    });

    if (stalePiSessions.length > 0) {
      await Promise.allSettled(stalePiSessions.map((session) => syncPiSessionIndex({
        ownerKey: session.ownerKey || session.owner_key || String(userId ?? 'local'),
        projectKey: session.projectKey || session.project_name,
        runtimeId: 'pi',
        sessionId: session.id,
      }, { sessionDb })));

      indexedSessions = sessionDb.getSessionsByProjects(projectNames).filter(visibleSession);
      sessionsByProject.clear();
      for (const session of indexedSessions) {
        if (!sessionsByProject.has(session.project_name)) {
          sessionsByProject.set(session.project_name, []);
        }
        sessionsByProject.get(session.project_name).push(session);
      }
    }

    const suspiciousCodexProjects = visibleProjects.filter(({ entry }) => {
      const projectSessions = sessionsByProject.get(entry.name) || [];
      return projectSessions.some((session) => (
        session?.provider === 'codex' && isLegacyCodexPlaceholderSessionId(session.id)
      ));
    });

    if (suspiciousCodexProjects.length > 0) {
      const codexIndexRef = {};
      await Promise.allSettled(
        suspiciousCodexProjects.map(({ entry, actualProjectDir }) => (
          reconcileCodexSessionIndex(actualProjectDir, {
            limit: 0,
            projectName: entry.name,
            indexRef: codexIndexRef,
          })
        ))
      );

      indexedSessions = sessionDb.getSessionsByProjects(projectNames).filter(visibleSession);
      sessionsByProject.clear();
      for (const session of indexedSessions) {
        if (!sessionsByProject.has(session.project_name)) {
          sessionsByProject.set(session.project_name, []);
        }
        sessionsByProject.get(session.project_name).push(session);
      }
    }

    totalProjects = visibleProjects.length;

    const hydratedProjects = await mapWithConcurrency(visibleProjects, 6, async ({ entry, actualProjectDir, dbEntry, isManuallyAdded }) => {
      processedProjects++;

      if (progressCallback) {
        progressCallback({ phase: 'loading', current: processedProjects, total: totalProjects, currentProject: entry.name });
      }

      // In browser-shell/local-kernel mode the cloud server cannot access customer-local
      // project paths, so an fs.access failure must not hide a saved project on refresh.
      let projectPathAccessible = true;
      try {
        await fs.access(actualProjectDir);
        if (dbEntry?.metadata?.preserveFolderContents !== true) {
          await ensureProjectWorkOutputDirectory(actualProjectDir, {
            conversationWorkspace: dbEntry?.metadata?.isConversationWorkspace === true,
          });
        }
      } catch (error) {
        projectPathAccessible = false;
        if (error?.code === 'ENOENT' && !isManuallyAdded && process.env.MEDHELP_AUTO_TRASH_MISSING_PROJECTS === '1') {
          console.warn(`[projects] Auto-trashing missing project directory: ${entry.name} at ${actualProjectDir}`);
          try {
            await deleteProject(entry.name, false, userId || null);
          } catch (trashError) {
            console.warn('[projects] Failed to auto-trash missing project:', entry.name, trashError?.message);
          }
          return null;
        }
        if (['ENOENT', 'EACCES', 'EPERM'].includes(error?.code)) {
          console.warn(`[projects] Keeping project whose path is not reachable from this server: ${entry.name} at ${actualProjectDir}`);
        } else {
          throw error;
        }
      }

      const projectInfo = config[entry.name];
      const displayName = dbEntry?.display_name || projectInfo?.displayName || await generateDisplayName(entry.name, actualProjectDir);

      let dirCreatedAt = dbEntry?.created_at;
      if (!dirCreatedAt && projectPathAccessible) {
        try {
          const dirStat = await fs.stat(actualProjectDir);
          dirCreatedAt = dirStat.birthtime.toISOString();
        } catch (_) {}
      }

      const project = {
        name: entry.name,
        path: actualProjectDir,
        displayName,
        fullPath: actualProjectDir,
        isCustomName: !!(dbEntry?.display_name || projectInfo?.displayName),
        createdAt: dirCreatedAt,
        pathExists: projectPathAccessible,
        isLocalPathUnavailable: !projectPathAccessible,
        isDefaultWorkspace: dbEntry?.metadata?.isDefaultWorkspace === true,
        isConversationWorkspace: dbEntry?.metadata?.isConversationWorkspace === true,
        isStarred: !!dbEntry?.is_starred,
        sessions: [],
        sessionMeta: { hasMore: false, total: 0 }
      };

      const projectSessions = sessionsByProject.get(entry.name) || [];
      const claudeSessions = projectSessions.filter((session) => session.provider === 'claude');
      const codexSessions = projectSessions.filter((session) => session.provider === 'codex');
      const piSessions = projectSessions.filter((session) => session.provider === 'pi');
      const openrouterSessions = projectSessions.filter((session) => session.provider === 'openrouter');
      const localSessions = projectSessions.filter((session) => session.provider === 'local');

      project.sessions = claudeSessions.slice(0, 5).map((session) => mapIndexedSessionToProjectSession(session, 'claude'));
      project.sessionMeta = {
        total: claudeSessions.length,
        hasMore: claudeSessions.length > 5,
      };
      project.codexSessions = codexSessions.slice(0, 5).map((session) => mapIndexedSessionToProjectSession(session, 'codex'));
      project.piSessions = piSessions.slice(0, 5).map((session) => mapIndexedSessionToProjectSession(session, 'pi'));
      project.openrouterSessions = openrouterSessions.slice(0, 5).map((session) => mapIndexedSessionToProjectSession(session, 'openrouter'));
      project.localSessions = localSessions.slice(0, 5).map((session) => mapIndexedSessionToProjectSession(session, 'local'));
      project.runtimeSessions = [
        ...project.sessions,
        ...project.codexSessions,
        ...project.piSessions,
        ...project.openrouterSessions,
        ...project.localSessions,
      ];

      const taskmasterResult = projectPathAccessible
        ? await detectTaskMasterFolder(actualProjectDir).catch(() => null)
        : null;

      if (taskmasterResult) {
        const tm = taskmasterResult;
        project.taskmaster = {
          hasTaskmaster: tm.hasTaskmaster,
          hasEssentialFiles: tm.hasEssentialFiles,
          metadata: tm.metadata,
          status: tm.hasTaskmaster && tm.hasEssentialFiles ? 'configured' : 'not-configured'
        };
        project.pipeline = project.taskmaster;
      }

      return project;
    });

    projects.push(...hydratedProjects.filter(Boolean));
  } catch (error) {
    console.error('Error reading projects from database:', error);
  }

  return projects;
}

async function getTrashedProjects(userId = null) {
  const { projectDb } = await import('./database/db.js');
  const config = await loadProjectConfig();
  const allDbProjects = projectDb.getAllProjects();
  const dbProjectMap = new Map(allDbProjects.map((entry) => [entry.id, entry]));
  const allProjectNames = new Set([
    ...Object.keys(config).filter((key) => !key.startsWith('_')),
    ...allDbProjects.map((entry) => entry.id),
  ]);

  const trashEntries = [];

  for (const projectName of allProjectNames) {
    const projectInfo = config[projectName];
    const dbEntry = dbProjectMap.get(projectName);

    if (!isProjectTrashed(projectInfo, dbEntry)) {
      continue;
    }

    const ownerUserId = getProjectOwnerUserId(projectInfo, dbEntry);
    if (userId && ownerUserId !== userId) {
      continue;
    }

    const trashEntry = buildTrashEntry(projectName, projectInfo, dbEntry);
    if (trashEntry) {
      trashEntries.push(trashEntry);
    }
  }

  return trashEntries.sort(
    (left, right) => new Date(right.trashedAt).getTime() - new Date(left.trashedAt).getTime(),
  );
}

async function getSessions(projectName, limit = 5, offset = 0, userId = null) {
  const projectDir = await resolveClaudeProjectDir(projectName);
  const { sessionDb, projectDb } = await import('./database/db.js');
  const projectRecord = projectDb.getProjectById(projectName);
  if (userId && projectRecord?.user_id && Number(projectRecord.user_id) !== Number(userId)) {
    throw new Error('You do not have permission to read sessions in this project');
  }

  try {
    // Check if the project directory exists before trying to read it
    try {
      await fs.access(projectDir);
    } catch (err) {
      if (err.code === 'ENOENT') {
        // No Claude sessions for this project yet, which is fine for manual projects
        return { sessions: [], hasMore: false, total: 0 };
      }
      throw err;
    }

    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-'));

    if (jsonlFiles.length === 0) {
      return { sessions: [], hasMore: false, total: 0 };
    }

    // Fetch indexed sessions from database - filter by userId?
    // Usually sessions inherit project ownership, but we store it anyway.
    const dbSessions = sessionDb.getSessionsByProject(
      projectName,
      userId === null || userId === undefined ? {} : { ownerKey: String(userId) },
    );
    const dbSessionMap = new Map(dbSessions.filter(s => s.provider === 'claude').map(s => [s.id, s]));
    const projectPath = await extractProjectDirectory(projectName).catch(() => null);

    // ... (rest of getSessions remains mostly same, but ensures it uses the DB map correctly)


    // Sort files by modification time (newest first)
    const filesWithStats = await Promise.all(
      jsonlFiles.map(async (file) => {
        const filePath = path.join(projectDir, file);
        const stats = await fs.stat(filePath);
        return { file, mtime: stats.mtime };
      })
    );
    filesWithStats.sort((a, b) => b.mtime - a.mtime);

    const allSessions = new Map();
    const allEntries = [];
    const uuidToSessionMap = new Map();

    // Collect all sessions and entries from all files
    for (const { file } of filesWithStats) {
      const jsonlFile = path.join(projectDir, file);
      const result = await parseJsonlSessions(jsonlFile, projectName, dbSessionMap);

      result.sessions.forEach(session => {
        if (!allSessions.has(session.id)) {
          allSessions.set(session.id, session);
        }
      });

      allEntries.push(...result.entries);

      // Early exit optimization for large projects
      if (allSessions.size >= (limit + offset) * 2 && allEntries.length >= Math.min(3, filesWithStats.length)) {
        break;
      }
    }

    // Build UUID-to-session mapping for timeline detection
    allEntries.forEach(entry => {
      if (entry.uuid && entry.sessionId) {
        uuidToSessionMap.set(entry.uuid, entry.sessionId);
      }
    });

    // Group sessions by first user message ID
    const sessionGroups = new Map(); // firstUserMsgId -> { latestSession, allSessions[] }
    const sessionToFirstUserMsgId = new Map(); // sessionId -> firstUserMsgId

    // Find the first user message for each session
    allEntries.forEach(entry => {
      if (entry.sessionId && entry.type === 'user' && entry.parentUuid === null && entry.uuid) {
        // This is a first user message in a session (parentUuid is null)
        const firstUserMsgId = entry.uuid;

        if (!sessionToFirstUserMsgId.has(entry.sessionId)) {
          sessionToFirstUserMsgId.set(entry.sessionId, firstUserMsgId);

          const session = allSessions.get(entry.sessionId);
          if (session) {
            if (!sessionGroups.has(firstUserMsgId)) {
              sessionGroups.set(firstUserMsgId, {
                latestSession: session,
                allSessions: [session]
              });
            } else {
              const group = sessionGroups.get(firstUserMsgId);
              group.allSessions.push(session);

              // Update latest session if this one is more recent
              if (new Date(session.lastActivity) > new Date(group.latestSession.lastActivity)) {
                group.latestSession = session;
              }
            }
          }
        }
      }
    });

    // Collect all sessions that don't belong to any group (standalone sessions)
    const groupedSessionIds = new Set();
    sessionGroups.forEach(group => {
      group.allSessions.forEach(session => groupedSessionIds.add(session.id));
    });

    const standaloneSessionsArray = Array.from(allSessions.values())
      .filter(session => !groupedSessionIds.has(session.id));

    // Combine grouped sessions (only show latest from each group) + standalone sessions
    const latestFromGroups = Array.from(sessionGroups.values()).map(group => {
      const session = { ...group.latestSession };
      // Add metadata about grouping
      if (group.allSessions.length > 1) {
        session.isGrouped = true;
        session.groupSize = group.allSessions.length;
        session.groupSessions = group.allSessions.map(s => s.id);
      }
      return session;
    });
    const visibleSessions = [...latestFromGroups, ...standaloneSessionsArray]
      .filter(session => !session.summary.startsWith('{ "'))
      .filter(session => !isConsultationSessionRecord(session))
      .filter(session => !isConsultationSessionRecord(dbSessionMap.get(session.id)))
      .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

    // Hide trashed sessions by default.
    const isTrashed = (session) => {
      const indexed = dbSessionMap.get(session?.id) || null;
      return Boolean(indexed?.metadata?.trash?.trashedAt);
    };
    const untrashedSessions = visibleSessions.filter((session) => !isTrashed(session));

    await Promise.all(
      untrashedSessions.map(async (session) => {
        const indexedSession = dbSessionMap.get(session.id) || null;
        if (!await shouldRefreshIndexedSession('claude', indexedSession, session)) {
          return;
        }

        await reconcileIndexedSessionFromSource(projectName, 'claude', session, indexedSession, projectPath);
      })
    );

    const total = untrashedSessions.length;
    const paginatedSessions = (
      limit > 0 ? untrashedSessions.slice(offset, offset + limit) : untrashedSessions.slice(offset)
    ).map((session) => {
      const indexed = dbSessionMap.get(session.id) || null;
      return {
        ...session,
        sessionKey: indexed?.sessionKey || null,
        ownerKey: indexed?.ownerKey || null,
        projectKey: indexed?.projectKey || projectName,
        runtimeId: 'claude',
      };
    });
    const hasMore = limit > 0 ? offset + limit < total : false;

    return {
      sessions: paginatedSessions,
      hasMore,
      total,
      offset,
      limit
    };
  } catch (error) {
    console.error(`Error reading sessions for project ${projectName}:`, error);
    return { sessions: [], hasMore: false, total: 0 };
  }
}

async function parseJsonlSessions(filePath, projectName = null, dbSessionMap = null) {
  const sessions = new Map();
  const entries = [];

  try {
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);
          entries.push(entry);

          if (entry.sessionId) {
            if (!sessions.has(entry.sessionId)) {
              const indexedSession = dbSessionMap?.get(entry.sessionId) || null;
              const hasManualDisplayName = isManualSessionDisplayName(indexedSession);
              const initialSummary = hasManualDisplayName && indexedSession?.display_name
                ? indexedSession.display_name
                : 'New Session';

              sessions.set(entry.sessionId, {
                id: entry.sessionId,
                summary: initialSummary,
                displayNameSource: hasManualDisplayName ? 'manual' : 'placeholder',
                messageCount: 0,
                lastActivity: new Date(),
                cwd: entry.cwd || '',
                firstUserDisplayName: null,
                lastUserMessage: null,
                lastAssistantMessage: null,
                mode: dbSessionMap && dbSessionMap.has(entry.sessionId)
                  ? (readExplicitSessionModeFromMetadata(dbSessionMap.get(entry.sessionId).metadata) || 'research')
                  : 'research',
                tags: dbSessionMap && dbSessionMap.has(entry.sessionId)
                  ? (Array.isArray(dbSessionMap.get(entry.sessionId).tags) ? dbSessionMap.get(entry.sessionId).tags : [])
                  : []
              });
            }

            const session = sessions.get(entry.sessionId);

            // Provider-generated summaries contain model/system context and are
            // not user input. Only summaries explicitly written by MedHelpSec's
            // rename action may override the first visible user request.
            if (entry.type === 'summary' && entry.summary && isManualSummaryEntry(entry)) {
              session.summary = String(entry.summary).trim();
              session.displayNameSource = 'manual';
            }

            // Track last user and assistant messages (skip system messages)
            if (entry.message?.role === 'user' && entry.message?.content) {
              const content = entry.message.content;

              // Extract text from all text parts if it's an array
              let textContent = '';
              if (Array.isArray(content)) {
                textContent = content
                  .filter(part => part.type === 'text')
                  .map(part => part.text)
                  .join(' ');
              } else if (typeof content === 'string') {
                textContent = content;
              }

              const modeFromMessage = typeof textContent === 'string'
                ? extractSessionModeFromText(textContent)
                : null;
              if (modeFromMessage) {
                session.mode = modeFromMessage;
              }

              if (textContent && textContent.length > 0) {
                const hasExplicitVisibilityBoundary = extractVisibleUserContent(textContent) !== null;
                const cleaned = stripInternalContextPrefix(textContent, false);

                const isSystemMessage = !hasExplicitVisibilityBoundary && typeof cleaned === 'string' && (
                  cleaned.startsWith('<command-name>') ||
                  cleaned.startsWith('<command-message>') ||
                  cleaned.startsWith('<command-args>') ||
                  cleaned.startsWith('<local-command-stdout>') ||
                  cleaned.startsWith('<system-reminder>') ||
                  cleaned.startsWith('Caveat:') ||
                  cleaned.startsWith('This session is being continued from a previous') ||
                  cleaned.startsWith('Invalid API key') ||
                  cleaned.includes('{"subtasks":') || // Filter Task Master prompts
                  cleaned.includes('CRITICAL: You MUST respond with ONLY a JSON') || // Filter Task Master system prompts
                  cleaned === 'Warmup' // Explicitly filter out "Warmup"
                );

                if (cleaned && !isSystemMessage) {
                  const userDisplayName = buildSessionDisplayName(textContent);
                  if (userDisplayName && !session.firstUserDisplayName) {
                    session.firstUserDisplayName = userDisplayName;
                    if (session.displayNameSource !== 'manual') {
                      session.summary = userDisplayName;
                      session.displayNameSource = 'user';
                    }
                  }
                  session.lastUserMessage = cleaned;
                }
              }
            } else if (entry.message?.role === 'assistant' && entry.message?.content) {
              // Skip API error messages using the isApiErrorMessage flag
              if (entry.isApiErrorMessage === true) {
                // Skip this message entirely
              } else {
                // Track last assistant text message
                let assistantText = null;

                if (Array.isArray(entry.message.content)) {
                  for (const part of entry.message.content) {
                    if (part.type === 'text' && part.text) {
                      assistantText = part.text;
                    }
                  }
                } else if (typeof entry.message.content === 'string') {
                  assistantText = entry.message.content;
                }

                if (assistantText) {
                  const cleaned = stripInternalContextPrefix(assistantText, false);

                  // Additional filter for assistant messages with system content
                  const isSystemAssistantMessage = typeof cleaned === 'string' && (
                    cleaned.startsWith('Invalid API key') ||
                    cleaned.includes('{"subtasks":') ||
                    cleaned.includes('CRITICAL: You MUST respond with ONLY a JSON')
                  );

                  if (cleaned && !isSystemAssistantMessage) {
                    session.lastAssistantMessage = cleaned;
                  }
                }
              }
            }

            session.messageCount++;

            if (entry.timestamp) {
              session.lastActivity = new Date(entry.timestamp);
            }
          }
        } catch (parseError) {
          // Skip malformed lines silently
        }
      }
    }
    rl.close();
    fileStream.destroy();

    // A generated title is always based on the first visible user request. Do
    // not fall back to assistant text or provider/system summaries.
    for (const session of sessions.values()) {
      if (session.displayNameSource !== 'manual' && session.firstUserDisplayName) {
        session.summary = session.firstUserDisplayName;
        session.displayNameSource = 'user';
      }
    }

    // Filter out sessions that contain JSON responses (Task Master errors)
    const allSessions = Array.from(sessions.values());
    const filteredSessions = allSessions.filter(session => {
      const shouldFilter = session.summary.startsWith('{ "');
      if (shouldFilter) {
      }
      // Log a sample of summaries to debug
      if (Math.random() < 0.01) { // Log 1% of sessions
      }
      return !shouldFilter;
    });


    return {
      sessions: filteredSessions,
      entries: entries
    };

  } catch (error) {
    console.error('Error reading JSONL file:', error);
    return { sessions: [], entries: [] };
  }
}

// Parse an agent JSONL file and extract tool uses/results for grouped rendering
async function parseAgentTools(filePath) {
  const tools = [];

  try {
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line);

        if (entry.message?.role === 'assistant' && Array.isArray(entry.message?.content)) {
          for (const part of entry.message.content) {
            if (part.type === 'tool_use') {
              tools.push({
                toolId: part.id,
                toolName: part.name,
                toolInput: part.input,
                timestamp: entry.timestamp
              });
            }
          }
        }

        if (entry.message?.role === 'user' && Array.isArray(entry.message?.content)) {
          for (const part of entry.message.content) {
            if (part.type === 'tool_result') {
              const tool = tools.find(t => t.toolId === part.tool_use_id);
              if (tool) {
                tool.toolResult = {
                  content: typeof part.content === 'string'
                    ? part.content
                    : Array.isArray(part.content)
                      ? part.content.map(c => c.text || '').join('\n')
                      : JSON.stringify(part.content),
                  isError: Boolean(part.is_error)
                };
              }
            }
          }
        }
      } catch (parseError) {
        // Skip malformed lines
      }
    }
    rl.close();
    fileStream.destroy();
  } catch (error) {
    console.warn(`Error parsing agent file ${filePath}:`, error.message);
  }

  return tools;
}

export function selectClaudeSessionTranscriptFiles(files, sessionId) {
  const transcriptFiles = files.filter(
    (file) => file.endsWith('.jsonl') && !file.startsWith('agent-'),
  );
  const directFileName = `${sessionId}.jsonl`;

  // Current Claude/Agent SDK storage names the top-level transcript after the
  // session id. Use that exact file when present; the full-directory fallback
  // is retained for legacy layouts whose filenames did not carry the id.
  return transcriptFiles.includes(directFileName)
    ? [directFileName]
    : transcriptFiles;
}

export async function readClaudeSessionPageFromFile(filePath, sessionId, {
  limit,
  offset = 0,
  chunkSize = 256 * 1024,
} = {}) {
  const pageLimit = Math.max(1, Math.trunc(Number(limit) || 1));
  const pageOffset = Math.max(0, Math.trunc(Number(offset) || 0));
  const readChunkSize = Math.max(1024, Math.trunc(Number(chunkSize) || 256 * 1024));
  const newestFirst = [];
  let matchingSeen = 0;
  let hasMore = false;

  const processLine = (lineBuffer) => {
    if (!lineBuffer?.length) return false;
    try {
      const entry = JSON.parse(lineBuffer.toString('utf8'));
      if (entry.sessionId !== sessionId) return false;
      matchingSeen += 1;
      if (matchingSeen <= pageOffset) return false;
      if (newestFirst.length < pageLimit) {
        newestFirst.push(entry);
        return false;
      }
      hasMore = true;
      return true;
    } catch {
      return false;
    }
  };

  const fileHandle = await fs.open(filePath, 'r');
  try {
    const { size } = await fileHandle.stat();
    let position = size;
    let remainder = Buffer.alloc(0);
    let stopped = false;

    while (position > 0 && !stopped) {
      const bytesToRead = Math.min(readChunkSize, position);
      position -= bytesToRead;
      const chunk = Buffer.allocUnsafe(bytesToRead);
      const { bytesRead } = await fileHandle.read(chunk, 0, bytesToRead, position);
      const combined = Buffer.concat([chunk.subarray(0, bytesRead), remainder]);
      let lineEnd = combined.length;

      for (let index = combined.length - 1; index >= 0; index -= 1) {
        if (combined[index] !== 0x0a) continue;
        if (processLine(combined.subarray(index + 1, lineEnd))) {
          stopped = true;
          break;
        }
        lineEnd = index;
      }
      remainder = stopped ? Buffer.alloc(0) : combined.subarray(0, lineEnd);
    }

    if (!stopped && remainder.length) {
      processLine(remainder);
    }
  } finally {
    await fileHandle.close();
  }

  return {
    messages: newestFirst.reverse(),
    // The UI consumes hasMore rather than total. When the reverse scan stops
    // early, expose a conservative lower bound without reading the whole file.
    total: hasMore ? pageOffset + newestFirst.length + 1 : matchingSeen,
    hasMore,
    offset: pageOffset,
    limit: pageLimit,
  };
}

// Get messages for a specific session with pagination support
async function getSessionMessages(projectName, sessionId, limit = null, offset = 0, provider = 'claude', userId = null) {
  console.log(`[DEBUG] getSessionMessages - project: ${projectName}, session: ${sessionId}, provider: ${provider}`);
  if (userId !== null && userId !== undefined) {
    const { projectDb } = await import('./database/db.js');
    const projectRecord = projectDb.getProjectById(projectName);
    if (projectRecord?.user_id && Number(projectRecord.user_id) !== Number(userId)) {
      throw new Error('You do not have permission to read this session');
    }
  }
  if (provider === 'openrouter') {
    const projectPath = await resolveProviderSessionProjectPath(projectName, sessionId, provider);
    const openrouterSessionFile = await findProviderSessionFile({
      projectPath,
      providerDirName: 'openrouter-sessions',
      sessionId,
    });
    console.log(`[DEBUG] Reading OpenRouter session file: ${openrouterSessionFile}`);
    try {
      if (!openrouterSessionFile) {
        return limit === null ? [] : { messages: [], total: 0, hasMore: false };
      }
      await fs.access(openrouterSessionFile);
      const messages = [];
      const raw = await fs.readFile(openrouterSessionFile, 'utf-8');
      for (const line of raw.trim().split('\n').filter(Boolean)) {
        try {
          const entry = JSON.parse(line);
          if (entry.role === 'system') continue;
          if (entry.role === 'user') {
            messages.push({
              type: 'message',
              role: 'user',
              content: entry.content || '',
              timestamp: entry.ts,
            });
          } else if (entry.role === 'assistant') {
            // Emit text content as a message if present
            if (entry.content) {
              messages.push({
                type: 'message',
                role: 'assistant',
                content: entry.content,
                timestamp: entry.ts,
              });
            }
            // Emit tool_use entries for each tool call (matches Codex/Claude history format)
            if (Array.isArray(entry.tool_calls)) {
              for (const tc of entry.tool_calls) {
                let toolInput;
                try { toolInput = tc.function?.arguments || '{}'; } catch { toolInput = '{}'; }
                messages.push({
                  type: 'tool_use',
                  timestamp: entry.ts,
                  toolName: tc.function?.name || 'unknown',
                  toolInput,
                  toolCallId: tc.id,
                });
              }
            }
          } else if (entry.role === 'tool') {
            messages.push({
              type: 'tool_result',
              role: 'tool',
              output: entry.content,
              tool_call_id: entry.tool_call_id,
              toolCallId: entry.tool_call_id,
              timestamp: entry.ts,
            });
          }
        } catch {}
      }

      console.log(`[DEBUG] Found ${messages.length} valid messages in OpenRouter session file`);
      const total = messages.length;
      if (limit === null) return messages;

      const startIndex = Math.max(0, total - offset - limit);
      const endIndex = total - offset;
      return {
        messages: messages.slice(startIndex, endIndex),
        total,
        hasMore: startIndex > 0,
        offset,
        limit,
      };
    } catch (e) {
      console.warn(`Could not read OpenRouter session ${sessionId}:`, e.message);
      return limit === null ? [] : { messages: [], total: 0, hasMore: false };
    }
  }

  if (provider === 'local') {
    const projectPath = await resolveProviderSessionProjectPath(projectName, sessionId, provider);
    const localSessionFile = await findProviderSessionFile({
      projectPath,
      providerDirName: 'localgpu-sessions',
      sessionId,
    });
    console.log(`[DEBUG] Reading Local GPU session file: ${localSessionFile}`);
    try {
      if (!localSessionFile) {
        return limit === null ? [] : { messages: [], total: 0, hasMore: false };
      }
      await fs.access(localSessionFile);
      const messages = [];
      const raw = await fs.readFile(localSessionFile, 'utf-8');
      for (const line of raw.trim().split('\n').filter(Boolean)) {
        try {
          const entry = JSON.parse(line);
          if (entry.role === 'system') continue;
          if (entry.role === 'user') {
            messages.push({
              type: 'message',
              role: 'user',
              content: entry.content || '',
              timestamp: entry.ts,
            });
          } else if (entry.role === 'assistant') {
            if (entry.content) {
              messages.push({
                type: 'message',
                role: 'assistant',
                content: entry.content,
                timestamp: entry.ts,
              });
            }
            if (Array.isArray(entry.tool_calls)) {
              for (const toolCall of entry.tool_calls) {
                let toolInput;
                try { toolInput = toolCall.function?.arguments || '{}'; } catch { toolInput = '{}'; }
                messages.push({
                  type: 'tool_use',
                  timestamp: entry.ts,
                  toolName: toolCall.function?.name || 'unknown',
                  toolInput,
                  toolCallId: toolCall.id,
                });
              }
            }
          } else if (entry.role === 'tool') {
            messages.push({
              type: 'tool_result',
              role: 'tool',
              output: entry.content,
              tool_call_id: entry.tool_call_id,
              toolCallId: entry.tool_call_id,
              timestamp: entry.ts,
            });
          }
        } catch {}
      }

      console.log(`[DEBUG] Found ${messages.length} valid messages in Local GPU session file`);
      const total = messages.length;
      if (limit === null) return messages;

      const startIndex = Math.max(0, total - offset - limit);
      const endIndex = total - offset;
      return {
        messages: messages.slice(startIndex, endIndex),
        total,
        hasMore: startIndex > 0,
        offset,
        limit,
      };
    } catch (e) {
      console.warn(`Could not read Local GPU session ${sessionId}:`, e.message);
      return limit === null ? [] : { messages: [], total: 0, hasMore: false };
    }
  }

  const projectDir = await resolveClaudeProjectDir(projectName);

  try {
    const files = await fs.readdir(projectDir);
    // agent-*.jsonl files contain subagent tool history, handled separately below
    const jsonlFiles = selectClaudeSessionTranscriptFiles(files, sessionId);
    const agentFiles = files.filter(file => file.endsWith('.jsonl') && file.startsWith('agent-'));

    if (jsonlFiles.length === 0) {
      return { messages: [], total: 0, hasMore: false };
    }

    let messages = [];
    let directPage = null;
    const agentToolsCache = new Map();

    const directFileName = `${sessionId}.jsonl`;
    if (limit !== null && jsonlFiles.length === 1 && jsonlFiles[0] === directFileName) {
      directPage = await readClaudeSessionPageFromFile(
        path.join(projectDir, directFileName),
        sessionId,
        { limit, offset },
      );
      messages = directPage.messages;
    } else {
      // Legacy fallback: scan candidate files whose names do not identify the
      // session. Modern transcripts never take this path.
      for (const file of jsonlFiles) {
        const jsonlFile = path.join(projectDir, file);
        const fileStream = fsSync.createReadStream(jsonlFile);
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity
        });

        for await (const line of rl) {
          if (line.trim()) {
            try {
              const entry = JSON.parse(line);
              if (entry.sessionId === sessionId) {
                messages.push(entry);
              }
            } catch (parseError) {
              console.warn('Error parsing line:', parseError.message);
            }
          }
        }
        rl.close();
        fileStream.destroy();
      }
    }

    // Collect Task agent IDs and hydrate grouped subagent tool history
    const agentIds = new Set();
    for (const message of messages) {
      if (message.toolUseResult?.agentId) {
        agentIds.add(message.toolUseResult.agentId);
      }
    }

    for (const agentId of agentIds) {
      const agentFileName = `agent-${agentId}.jsonl`;
      if (agentFiles.includes(agentFileName)) {
        const agentFilePath = path.join(projectDir, agentFileName);
        const tools = await parseAgentTools(agentFilePath);
        agentToolsCache.set(agentId, tools);
      }
    }

    for (const message of messages) {
      if (message.toolUseResult?.agentId) {
        const tools = agentToolsCache.get(message.toolUseResult.agentId);
        if (tools && tools.length > 0) {
          message.subagentTools = tools;
        }
      }
    }

    // Sort messages by timestamp
    const sortedMessages = messages.sort((a, b) =>
      new Date(a.timestamp || 0) - new Date(b.timestamp || 0)
    );

    if (directPage) {
      return {
        ...directPage,
        messages: sortedMessages,
      };
    }

    const total = sortedMessages.length;

    // If no limit is specified, return all messages (backward compatibility)
    if (limit === null) {
      return sortedMessages;
    }

    // Apply pagination - for recent messages, we need to slice from the end
    // offset 0 should give us the most recent messages
    const startIndex = Math.max(0, total - offset - limit);
    const endIndex = total - offset;
    const paginatedMessages = sortedMessages.slice(startIndex, endIndex);
    const hasMore = startIndex > 0;

    return {
      messages: paginatedMessages,
      total,
      hasMore,
      offset,
      limit
    };
  } catch (error) {
    console.error(`Error reading messages for session ${sessionId}:`, error);
    return limit === null ? [] : { messages: [], total: 0, hasMore: false };
  }
}

// Rename a project's display name
async function renameProject(projectName, newDisplayName, userId = null) {
  const { projectDb } = await import('./database/db.js');
  const trimmedName = (newDisplayName || '').trim();

  const existing = projectDb.getProjectById(projectName);
  if (existing) {
    if (userId && existing.user_id && existing.user_id !== userId) {
      throw new Error('You do not have permission to rename this project');
    }
    projectDb.updateProjectName(projectName, trimmedName);
  } else {
    const actualPath = await extractProjectDirectory(projectName);
    projectDb.upsertProject(projectName, userId, trimmedName, actualPath);
  }

  await mutateProjectConfig(async (config) => {
    if (!trimmedName) {
      if (config[projectName]) {
        delete config[projectName].displayName;
        if (Object.keys(config[projectName]).length === 0) {
          delete config[projectName];
        }
      }
      return;
    }

    if (!config[projectName]) {
      const actualPath = await extractProjectDirectory(projectName);
      config[projectName] = {
        originalPath: actualPath
      };
    }

    config[projectName].displayName = trimmedName;
  });

  return true;
}

// Delete a session from a project
async function deleteSession(projectName, sessionId, provider = 'claude', userId = null) {
  const { sessionDb } = await import('./database/db.js');
  const sessionLookup = {
    projectName,
    provider,
    ...(userId === null || userId === undefined ? {} : { ownerKey: String(userId) }),
  };
  const indexedSession = sessionDb.getSessionById(sessionId, sessionLookup);

  if (provider === 'openrouter') {
    const projectPath = indexedSession?.metadata?.projectPath || await resolveProviderSessionProjectPath(projectName, sessionId, provider);
    const openrouterSessionFile = await findProviderSessionFile({
      projectPath,
      providerDirName: 'openrouter-sessions',
      sessionId,
    });
    let deletedFile = false;
    if (openrouterSessionFile) {
      try {
        await fs.unlink(openrouterSessionFile);
        deletedFile = true;
      } catch (e) {
        if (e?.code !== 'ENOENT') {
          console.error(`[OpenRouter] Failed to delete session ${sessionId}:`, e.message);
          throw new Error(`Failed to delete OpenRouter session: ${e.message}`);
        }
      }
    }

    const deletedIndex = indexedSession?.provider === 'openrouter' || deletedFile;
    if (deletedIndex) {
      sessionDb.deleteSession(sessionId, sessionLookup);
    }

    if (deletedFile || deletedIndex) {
      console.log(`[OpenRouter] Deleted session ${sessionId}${deletedFile ? ` file: ${openrouterSessionFile}` : ' from index only'}`);
      return true;
    }

    throw new Error(`OpenRouter session ${sessionId} not found in file system or index`);
  }

  if (provider === 'local') {
    const projectPath = indexedSession?.metadata?.projectPath || await resolveProviderSessionProjectPath(projectName, sessionId, provider);
    const localSessionFile = await findProviderSessionFile({
      projectPath,
      providerDirName: 'localgpu-sessions',
      sessionId,
    });
    let deletedFile = false;
    if (localSessionFile) {
      try {
        await fs.unlink(localSessionFile);
        deletedFile = true;
      } catch (e) {
        if (e?.code !== 'ENOENT') {
          console.error(`[LocalGPU] Failed to delete session ${sessionId}:`, e.message);
          throw new Error(`Failed to delete Local GPU session: ${e.message}`);
        }
      }
    }

    const deletedIndex = indexedSession?.provider === 'local' || deletedFile;
    if (deletedIndex) {
      sessionDb.deleteSession(sessionId, sessionLookup);
    }

    if (deletedFile || deletedIndex) {
      console.log(`[LocalGPU] Deleted session ${sessionId}${deletedFile ? ` file: ${localSessionFile}` : ' from index only'}`);
      return true;
    }

    throw new Error(`Local GPU session ${sessionId} not found in file system or index`);
  }

  const projectDir = await resolveClaudeProjectDir(projectName);

  try {
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));

    let matchedFiles = 0;
    let removedEntries = 0;

    for (const file of jsonlFiles) {
      const jsonlFile = path.join(projectDir, file);
      const content = await fs.readFile(jsonlFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      let fileRemovedEntries = 0;

      const filteredLines = lines.filter(line => {
        try {
          const data = JSON.parse(line);
          if (data.sessionId === sessionId) {
            fileRemovedEntries += 1;
            return false;
          }
          return true;
        } catch {
          return true; // Keep malformed lines
        }
      });

      if (fileRemovedEntries > 0) {
        matchedFiles += 1;
        removedEntries += fileRemovedEntries;

        if (filteredLines.length > 0) {
          await fs.writeFile(jsonlFile, filteredLines.join('\n') + '\n');
        } else {
          await fs.unlink(jsonlFile);
        }
      }
    }

    const deletedIndex = indexedSession?.provider === 'claude' || matchedFiles > 0;
    if (deletedIndex) {
      sessionDb.deleteSession(sessionId, sessionLookup);
    }

    if (matchedFiles > 0 || deletedIndex) {
      console.log(
        `[Claude] Deleted session ${sessionId} from ${matchedFiles} file(s), removed ${removedEntries} entr${removedEntries === 1 ? 'y' : 'ies'}`,
      );
      return true;
    }

    throw new Error(`Session ${sessionId} not found in any files or index`);
  } catch (error) {
    if (error?.code === 'ENOENT' && indexedSession?.provider === 'claude') {
      sessionDb.deleteSession(sessionId, sessionLookup);
      console.log(`[Claude] Deleted session ${sessionId} from index only; project directory missing: ${projectDir}`);
      return true;
    }
    console.error(`Error deleting session ${sessionId} from project ${projectName}:`, error);
    throw error;
  }
}

// Soft-delete: move a session to trash (do not delete underlying provider files).
async function trashSession(projectName, sessionId, provider = 'claude', userId = null, options = {}) {
  const { sessionDb, projectDb } = await import('./database/db.js');

  const normalizedProvider = provider || 'claude';
  const projectRow = projectDb.getProjectById(projectName);
  const projectUserId = options.projectUserId === undefined ? userId : options.projectUserId;
  if (projectUserId != null && projectRow?.user_id != null && String(projectRow.user_id) !== String(projectUserId)) {
    throw new Error('You do not have permission to delete this session');
  }

  // Codex sessions can exist on disk but be missing or partially stale in the SQLite index.
  // Before moving one to trash, backfill from the provider source so the trash view has
  // the real title, timestamps, and counts instead of a placeholder row.
  if (normalizedProvider === 'codex') {
    const actualProjectPath = projectRow?.path || await extractProjectDirectory(projectName).catch(() => null);
    if (actualProjectPath) {
      await reconcileCodexSessionIndex(actualProjectPath, {
        limit: 0,
        sessionId,
        projectName,
      });
    }
  }

  // Ensure there's an index row to attach trash metadata to.
  const sessionLookup = {
    projectName,
    provider: normalizedProvider,
    ...(options.ownerKey != null ? { ownerKey: String(options.ownerKey) }
      : userId == null ? {} : { ownerKey: String(userId) }),
  };
  let existing = sessionDb.getSessionById(sessionId, sessionLookup);
  if (!existing) {
    sessionDb.upsertSessionPlaceholder(
      sessionId,
      projectName,
      normalizedProvider,
      null,
      null,
      null,
      sessionLookup,
    );
    existing = sessionDb.getSessionById(sessionId, sessionLookup);
  } else if (existing.project_name && existing.project_name !== projectName) {
    throw new Error('Session does not belong to this project');
  }

  const trashedAt = new Date().toISOString();
  const updated = sessionDb.setSessionTrash(sessionId, {
    trashedAt,
    projectName,
    provider: normalizedProvider,
  }, sessionLookup);

  return Boolean(updated?.metadata?.trash?.trashedAt);
}

async function restoreSession(projectName, sessionId, userId = null, provider = null, options = {}) {
  const { sessionDb, projectDb } = await import('./database/db.js');

  const projectRow = projectDb.getProjectById(projectName);
  const projectUserId = options.projectUserId === undefined ? userId : options.projectUserId;
  if (projectUserId != null && projectRow?.user_id != null && String(projectRow.user_id) !== String(projectUserId)) {
    throw new Error('You do not have permission to restore this session');
  }

  const sessionLookup = {
    projectName,
    ...(provider ? { provider } : {}),
    ...(options.ownerKey != null ? { ownerKey: String(options.ownerKey) }
      : userId == null ? {} : { ownerKey: String(userId) }),
  };
  const session = sessionDb.getSessionById(sessionId, sessionLookup);
  if (!session || session.project_name !== projectName) {
    throw new Error('Session not found');
  }

  const trashMeta = session?.metadata?.trash;
  if (!trashMeta?.trashedAt) {
    throw new Error('Session is not in trash');
  }

  const updated = sessionDb.clearSessionTrash(sessionId, sessionLookup);
  return Boolean(updated && !updated?.metadata?.trash?.trashedAt);
}

async function getTrashedSessions(userId = null, { sessionOwnerKey = userId } = {}) {
  const { sessionDb, projectDb } = await import('./database/db.js');
  const trashed = sessionDb.listTrashedSessions(userId);
  return trashed
    .filter((row) => row.runtimeId !== 'pi' || sessionOwnerKey == null || row.ownerKey === String(sessionOwnerKey))
    .map((row) => {
      const project = projectDb.getProjectById(row.project_name);
      return {
        id: row.id,
        sessionKey: row.sessionKey,
        ownerKey: row.ownerKey,
        projectKey: row.projectKey,
        runtimeId: row.runtimeId,
        projectName: row.project_name,
        provider: row.provider,
        displayName: row.display_name || 'Deleted Session',
        lastActivity: row.last_activity || null,
        messageCount: row.message_count || 0,
        trashedAt: row.metadata?.trash?.trashedAt || null,
        projectDisplayName: project?.display_name || row.project_name,
      };
    })
    .filter((s) => typeof s.trashedAt === 'string' && s.trashedAt);
}

// Check if a project is empty (has no sessions)
async function isProjectEmpty(projectName) {
  try {
    const sessionsResult = await getSessions(projectName, 1, 0);
    return sessionsResult.total === 0;
  } catch (error) {
    console.error(`Error checking if project ${projectName} is empty:`, error);
    return false;
  }
}

// Delete a project (force=true to delete with sessions). This hides the project and records it in trash metadata.
async function deleteProject(projectName, force = false, userId = null) {
  const { projectDb, sessionDb } = await import('./database/db.js');

  try {
    const existing = projectDb.getProjectById(projectName);
    const initialConfig = await loadProjectConfig();
    const initialProjectInfo = initialConfig[projectName];
    const ownerUserId = existing?.user_id ?? getProjectOwnerUserId(initialProjectInfo, existing) ?? userId ?? null;

    if (userId && ownerUserId && ownerUserId !== userId) {
      throw new Error('You do not have permission to delete this project');
    }

    const isEmpty = await isProjectEmpty(projectName);
    if (!isEmpty && !force) {
      throw new Error('Cannot delete project with existing sessions');
    }

    if (isProjectTrashed(initialProjectInfo, existing)) {
      return true;
    }

    const sessionCount = sessionDb.getSessionsByProject(projectName).length;
    let projectPath = initialProjectInfo?.path || initialProjectInfo?.originalPath || existing?.path || null;
    if (!projectPath) {
      projectPath = await extractProjectDirectory(projectName);
    }

    const trashedAt = new Date().toISOString();
    const filesExist = await pathExists(projectPath);
    const instanceId = await readProjectInstanceId(projectPath);
    const displayName = existing?.display_name || initialProjectInfo?.displayName || path.basename(projectPath || projectName);

    const mutationResult = await mutateProjectConfig((config) => {
      const currentConfig = config[projectName] || {};
      if (isProjectTrashed(currentConfig, existing)) {
        return {
          alreadyTrashed: true,
          currentConfig,
          trashMetadata: currentConfig.trash || existing?.metadata?.trash || null,
        };
      }

      clearDeletedProjectMetadata(config, projectName);
      const trashMetadata = {
        ...(currentConfig.trash || {}),
        trashedAt,
        originalPath: projectPath,
        trashPath: '',
        claudeTrashPath: '',
        sessionCount,
        displayName,
        filesExist,
        ownerUserId,
        instanceId,
      };

      config[projectName] = {
        ...currentConfig,
        originalPath: currentConfig.originalPath || projectPath,
        ownerUserId,
        trash: trashMetadata,
      };
      delete config[projectName].deleted;

      // Also mark project as "suppressed" so it won't be re-seeded back into
      // the visible list by legacy/bootstrap indexing even if other flows
      // re-upsert the project metadata.
      const deletedProjects = getDeletedProjectsStore(config);
      deletedProjects[projectName] = {
        deletedAt: trashedAt,
        ownerUserId,
        originalPath: trashMetadata.originalPath,
        displayName: trashMetadata.displayName,
      };

      return {
        alreadyTrashed: false,
        currentConfig: config[projectName],
        trashMetadata,
      };
    });

    if (mutationResult.alreadyTrashed) {
      return true;
    }

    const metadata = {
      ...(existing?.metadata || {}),
      trash: mutationResult.trashMetadata,
    };

    if (mutationResult.currentConfig?.manuallyAdded || existing?.metadata?.manuallyAdded) {
      metadata.manuallyAdded = true;
    } else {
      delete metadata.manuallyAdded;
    }

    projectDb.upsertProject(
      projectName,
      ownerUserId,
      existing?.display_name || initialProjectInfo?.displayName || null,
      projectPath,
      existing?.is_starred || 0,
      existing?.last_accessed || null,
      Object.keys(metadata).length > 0 ? metadata : null,
    );
    projectDirectoryCache.delete(projectName);

    return true;
  } catch (error) {
    console.error(`Error deleting project ${projectName}:`, error);
    throw error;
  }
}

async function restoreProject(projectName, userId = null) {
  const { projectDb } = await import('./database/db.js');
  const config = await loadProjectConfig();
  const existing = projectDb.getProjectById(projectName);
  const projectInfo = config[projectName];
  const ownerUserId = existing?.user_id ?? getProjectOwnerUserId(projectInfo, existing) ?? userId ?? null;

  if (userId && ownerUserId && ownerUserId !== userId) {
    throw new Error('You do not have permission to restore this project');
  }

  const trashMeta = existing?.metadata?.trash || projectInfo?.trash;
  if (!trashMeta?.trashedAt) {
    throw new Error('Project is not in trash');
  }

  const originalPath = trashMeta.originalPath;
  if (!originalPath) {
    throw new Error('Original project path is missing');
  }

  if (!await pathExists(originalPath)) {
    throw new Error('Project files are missing from the original path and cannot be restored');
  }

  const nextMetadata = { ...(existing?.metadata || {}) };
  delete nextMetadata.trash;

  projectDb.upsertProject(
    projectName,
    ownerUserId,
    existing?.display_name || projectInfo?.displayName || trashMeta.displayName || null,
    originalPath,
    existing?.is_starred || 0,
    existing?.last_accessed || null,
    Object.keys(nextMetadata).length > 0 ? nextMetadata : null,
  );
  projectDb.setProjectMetadata(
    projectName,
    Object.keys(nextMetadata).length > 0 ? nextMetadata : null,
  );

  await mutateProjectConfig((nextConfig) => {
    const nextProjectInfo = {
      ...(nextConfig[projectName] || {}),
      originalPath,
      ownerUserId,
    };
    delete nextProjectInfo.trash;
    delete nextProjectInfo.deleted;
    clearDeletedProjectMetadata(nextConfig, projectName);
    nextConfig[projectName] = nextProjectInfo;
  });

  await ensureProjectSkillLinks(originalPath);
  projectDirectoryCache.delete(projectName);
  return true;
}

async function deleteTrashedProject(projectName, mode = 'logical', userId = null) {
  const { projectDb, sessionDb } = await import('./database/db.js');
  const config = await loadProjectConfig();
  const existing = projectDb.getProjectById(projectName);
  const projectInfo = config[projectName];
  const ownerUserId = existing?.user_id ?? getProjectOwnerUserId(projectInfo, existing) ?? userId ?? null;

  if (userId && ownerUserId && ownerUserId !== userId) {
    throw new Error('You do not have permission to delete this trashed project');
  }

  const trashMeta = existing?.metadata?.trash || projectInfo?.trash;
  if (!trashMeta?.trashedAt) {
    throw new Error('Project is not in trash');
  }

  if (mode === 'physical') {
    if (trashMeta.originalPath && await pathExists(trashMeta.originalPath)) {
      const storedInstanceId = trashMeta.instanceId || projectInfo?.trash?.instanceId || null;
      if (!storedInstanceId) {
        throw new Error('Cannot safely delete project files because this trash entry has no recorded instance identity. Use logical delete instead.');
      }

      const currentInstanceId = await readProjectInstanceId(trashMeta.originalPath);
      if (!currentInstanceId || currentInstanceId !== storedInstanceId) {
        throw new Error('Project files at the original path no longer match this trash entry. Refusing physical delete.');
      }

      await fs.rm(trashMeta.originalPath, { recursive: true, force: true });

      try {
        const codexSessions = await getCodexSessions(trashMeta.originalPath, { limit: 0 });
        for (const session of codexSessions) {
          try {
            await deleteCodexSession(session.id);
          } catch (err) {
            console.warn(`Failed to delete Codex session ${session.id}:`, err.message);
          }
        }
      } catch (err) {
        console.warn('Failed to delete Codex sessions:', err.message);
      }

    }

    try {
      const projectDir = await resolveClaudeProjectDir(projectName);
      await fs.rm(projectDir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`Failed to delete Claude project dir for ${projectName}:`, err.message);
    }

    await mutateProjectConfig((nextConfig) => {
      delete nextConfig[projectName];
      clearDeletedProjectMetadata(nextConfig, projectName);
    });
    projectDb.deleteProject(projectName);
    sessionDb.deleteSessionsByProject(
      projectName,
      userId === null || userId === undefined ? {} : { ownerKey: String(userId) },
    );
    projectDirectoryCache.delete(projectName);
    return true;
  }

  const deletedAt = new Date().toISOString();
  await mutateProjectConfig((nextConfig) => {
    const deletedProjects = getDeletedProjectsStore(nextConfig);
    deletedProjects[projectName] = {
      deletedAt,
      ownerUserId,
      originalPath: trashMeta.originalPath || projectInfo?.originalPath || existing?.path || '',
      displayName: existing?.display_name || projectInfo?.displayName || trashMeta.displayName || projectName,
    };
    delete nextConfig[projectName];
  });

  projectDb.deleteProject(projectName);
  sessionDb.deleteSessionsByProject(
    projectName,
    userId === null || userId === undefined ? {} : { ownerKey: String(userId) },
  );
  projectDirectoryCache.delete(projectName);
  return true;
}

/**
 * Prepare MedHelpSec's hidden project metadata and, for internal deployments,
 * expose provider skill links. User-facing business folders are intentionally
 * left alone so a new project starts as a clean, ordinary directory.
 */
async function collectSkillDirs(baseDir) {
  const results = []; // { name, absolutePath }

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const hasSkillMd = entries.some(e => e.isFile() && e.name === 'SKILL.md');
    if (hasSkillMd) {
      results.push({ name: path.basename(dir), absolutePath: dir });
      return; // Don't recurse deeper into a skill directory
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        await walk(path.join(dir, entry.name));
      }
    }
  }

  await walk(baseDir);
  return results;
}

function getRelativeSymlinkTarget(sourcePath, linkPath) {
  return path.relative(path.dirname(linkPath), sourcePath) || '.';
}

function isEnabledEnvFlag(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

export function shouldExposeProjectAgentAssets(options = {}) {
  if (typeof options.exposeAgentAssets === 'boolean') {
    return options.exposeAgentAssets;
  }
  return isEnabledEnvFlag(process.env.MEDHELP_EXPOSE_PROJECT_AGENT_ASSETS);
}

/**
 * Load the set of platform-provided skill names from skill-tag-mapping.json.
 */
function getCoreSkillNames() {
  try {
    const mappingPath = path.join(DRCLAW_SKILLS_DIR, 'skill-tag-mapping.json');
    const raw = fsSync.readFileSync(mappingPath, 'utf8');
    const mapping = JSON.parse(raw);
    return new Set(mapping.platformNativeSkills || []);
  } catch {
    return new Set();
  }
}

/**
 * Generate a compact skills-index.md for the .agents/skills/ directory.
 * Reads YAML frontmatter (name, description) from each SKILL.md and produces
 * a markdown table grouped by platform skills and library skills.
 *
 * @param {Array<{name: string, absolutePath: string}>} skillDirs
 * @returns {string} Markdown content for skills-index.md
 */
async function generateSkillsIndex(skillDirs) {
  const matter = (await import('gray-matter')).default;
  const coreNames = getCoreSkillNames();

  const coreSkills = [];
  const librarySkills = [];

  for (const { name, absolutePath } of skillDirs) {
    const skillMdPath = path.join(absolutePath, 'SKILL.md');
    let skillName = name;
    let description = '';
    try {
      const content = await fs.readFile(skillMdPath, 'utf8');
      const { data } = matter(content);
      if (data.name) skillName = data.name;
      if (data.description) {
        // Collapse newlines (YAML block scalars) and escape pipe chars for markdown tables
        const cleaned = data.description.replace(/[\r\n]+/g, ' ').replace(/\|/g, '/').trim();
        description = cleaned.length > 120
          ? cleaned.slice(0, 117) + '...'
          : cleaned;
      }
    } catch {
      // Skip skills with unreadable SKILL.md
      continue;
    }

    const entry = { dirName: name, skillName, description };
    if (coreNames.has(name)) {
      coreSkills.push(entry);
    } else {
      librarySkills.push(entry);
    }
  }

  coreSkills.sort((a, b) => a.dirName.localeCompare(b.dirName));
  librarySkills.sort((a, b) => a.dirName.localeCompare(b.dirName));

  const lines = [
    '# Skills Index',
    '',
    '> **Do NOT read all SKILL.md files at once.** Use this index to find the right skill, then read only that one.',
    '',
    '## Platform Skills',
    '',
    '| Skill | Path | Description |',
    '|-------|------|-------------|',
  ];
  for (const s of coreSkills) {
    lines.push(`| ${s.skillName} | \`.agents/skills/${s.dirName}/SKILL.md\` | ${s.description} |`);
  }

  lines.push('', '## Library Skills', '');
  lines.push('| Skill | Path | Description |');
  lines.push('|-------|------|-------------|');
  for (const s of librarySkills) {
    lines.push(`| ${s.skillName} | \`.agents/skills/library/${s.dirName}/SKILL.md\` | ${s.description} |`);
  }

  lines.push('');
  return lines.join('\n');
}

async function ensureProjectWorkOutputDirectory(projectPath, options = {}) {
  try {
    if (options.conversationWorkspace) {
      await Promise.all([
        fs.mkdir(path.join(projectPath, 'work'), { recursive: true }),
        fs.mkdir(path.join(projectPath, 'outputs'), { recursive: true }),
      ]);
    } else {
      await fs.mkdir(path.join(projectPath, 'work-output'), { recursive: true });
    }
  } catch (err) {
    console.error('[projects] Failed to create project output directories:', err.message);
  }
}

async function ensureProjectSkillLinks(projectPath, options = {}) {
  projectPath = await assertExistingProjectDirectory(projectPath);
  const userSkillsDir = options.userId != null ? resolveUserSkillsDir(options.userId) : null;
  const exposeProjectAgentAssets = shouldExposeProjectAgentAssets(options);
  let conversationWorkspace = options.conversationWorkspace === true;
  let preserveFolderContents = options.preserveFolderContents === true;
  if (!conversationWorkspace || !preserveFolderContents) {
    try {
      const { projectDb } = await import('./database/db.js');
      const registeredProject = projectDb.getProjectByPath(
        projectPath,
        options.userId ?? null,
      ) || projectDb.getProjectByPath(projectPath);
      conversationWorkspace ||= registeredProject?.metadata?.isConversationWorkspace === true;
      preserveFolderContents ||= registeredProject?.metadata?.preserveFolderContents === true;
    } catch {
      // Fall back to standard project initialization when the index is unavailable.
    }
  }

  // Linked folders are user-owned trees. Merely registering or using one must
  // never add MedHelp metadata, output folders, templates, or skill links.
  if (preserveFolderContents) {
    return;
  }

  await ensureProjectWorkOutputDirectory(projectPath, { conversationWorkspace });

  // Conversation folders are ephemeral task workspaces, not durable projects.
  // Keep them free of project memory and provider-specific agent assets.
  if (conversationWorkspace) {
    return;
  }

  // Keep customer workspaces free of MedHelpSec-private agent assets by default.
  // Internal/dev deployments can opt in with MEDHELP_EXPOSE_PROJECT_AGENT_ASSETS=1.
  try {
    const {
      cleanupGeneratedProjectAgentAssets,
      ensureProjectMemoryFile,
      writeProjectTemplates,
    } = await import('./templates/index.js');
    await ensureProjectMemoryFile(projectPath);
    if (exposeProjectAgentAssets) {
      await writeProjectTemplates(projectPath, {
        includeRootAgentTemplates: true,
        writeClaudeMemoryFile: true,
      });
    } else {
      // Do not write provider instruction files into customer
      // projects. Rules are injected at runtime from backend templates.
      await cleanupGeneratedProjectAgentAssets(projectPath);
    }
  } catch (err) {
    console.error('[projects] Failed to manage project agent assets:', err.message);
  }

  if (!exposeProjectAgentAssets) {
    return;
  }

  try {
    const systemSkillDirs = [];
    try {
      await fs.access(DRCLAW_SKILLS_DIR);
      systemSkillDirs.push(...await collectSkillDirs(DRCLAW_SKILLS_DIR));
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.warn('[projects] medhelp skills dir not found, skipping system skill symlinks:', DRCLAW_SKILLS_DIR);
      } else {
        console.error('[projects] Cannot access medhelp skills dir:', err.message);
      }
    }

    const userSkillDirs = [];
    if (userSkillsDir) {
      try {
        await fs.mkdir(userSkillsDir, { recursive: true });
        userSkillDirs.push(...await collectSkillDirs(userSkillsDir));
      } catch (err) {
        console.error('[projects] Cannot access user skills dir:', err.message);
      }
    }

    const skillDirs = [];
    const seenSkillNames = new Set();
    for (const skill of systemSkillDirs) {
      if (seenSkillNames.has(skill.name)) continue;
      seenSkillNames.add(skill.name);
      skillDirs.push(skill);
    }
    for (const skill of userSkillDirs) {
      if (seenSkillNames.has(skill.name)) {
        console.warn(`[projects] User skill "${skill.name}" conflicts with an existing system skill and will not be linked.`);
        continue;
      }
      seenSkillNames.add(skill.name);
      skillDirs.push(skill);
    }

    if (skillDirs.length === 0) return;

    // Warn about name collisions
    const seen = new Map();
    for (const skill of skillDirs) {
      if (seen.has(skill.name)) {
        console.warn(`[projects] Skill name collision: "${skill.name}" found at both ${seen.get(skill.name)} and ${skill.absolutePath}`);
      } else {
        seen.set(skill.name, skill.absolutePath);
      }
    }

    const coreNames = getCoreSkillNames();

    for (const dir of PROJECT_SKILL_FOLDERS) {
      const skillsSubdir = path.join(projectPath, dir, 'skills');
      const isAgents = dir === '.agents';
      try {
        await fs.mkdir(skillsSubdir, { recursive: true });
        if (isAgents) {
          await fs.mkdir(path.join(skillsSubdir, 'library'), { recursive: true });
        }
      } catch (err) {
        console.error(`[projects] Failed to create ${dir}/skills:`, err.message);
        continue;
      }

      for (const { name, absolutePath } of skillDirs) {
        // For .agents/: core skills at top level, library skills under library/
        const linkPath = isAgents && !coreNames.has(name)
          ? path.join(skillsSubdir, 'library', name)
          : path.join(skillsSubdir, name);
        const linkTarget = getRelativeSymlinkTarget(absolutePath, linkPath);
        try {
          try {
            await fs.unlink(linkPath);
          } catch (_) {
            // ignore if not exists or not a symlink
          }
          // Clean up stale top-level symlink when migrating library skills into library/
          if (isAgents && !coreNames.has(name)) {
            try { await fs.unlink(path.join(skillsSubdir, name)); } catch (_) {}
          }
          await fs.symlink(linkTarget, linkPath, 'dir');
        } catch (err) {
          console.error(`[projects] Failed to symlink ${name} in ${dir}/skills:`, err.message);
        }
      }

      // Write the skills index for .agents/ so Codex can discover skills lazily
      if (isAgents) {
        try {
          const indexContent = await generateSkillsIndex(skillDirs);
          await fs.writeFile(path.join(skillsSubdir, 'skills-index.md'), indexContent, 'utf8');
        } catch (err) {
          console.error('[projects] Failed to write skills-index.md:', err.message);
        }
      }

      // Symlink the skill catalog metadata from MedHelpSec into each provider folder.
      for (const jsonFile of ['skill-tag-mapping.json']) {
        const srcJson = path.join(DRCLAW_SKILLS_DIR, jsonFile);
        const destJson = path.join(skillsSubdir, jsonFile);
        const linkTarget = getRelativeSymlinkTarget(srcJson, destJson);
        try {
          await fs.access(srcJson);
          try { await fs.unlink(destJson); } catch (_) {}
          await fs.symlink(linkTarget, destJson, 'file');
        } catch (err) {
          if (err.code !== 'ENOENT') {
            console.error(`[projects] Failed to symlink ${jsonFile} in ${dir}/skills:`, err.message);
          }
        }
      }
    }
  } catch (err) {
    console.error('[projects] ensureProjectSkillLinks failed:', err.message);
  }
}

// Add a project manually to the config (without creating folders)
async function addProjectManually(projectPath, displayName = null, userId = null, options = {}) {
  const { projectDb } = await import('./database/db.js');
  const absolutePath = path.resolve(projectPath);

  try {
    await fs.access(absolutePath);
  } catch (error) {
    throw new Error(`Path does not exist: ${absolutePath}`);
  }

  const projectName = encodeProjectPath(absolutePath);

  const existingById = projectDb.getProjectById(projectName);
  if (
    userId
    && existingById?.user_id != null
    && Number(existingById.user_id) !== Number(userId)
  ) {
    throw new Error('You do not have permission to access this project path');
  }

  // Explicitly adding an existing directory also restores its visibility. Do
  // not return early for an indexed folder: it may still carry a trash marker.
  const existingByPath = projectDb.getProjectByPath(absolutePath, userId);
  const existing = existingByPath || existingById;
  const oldProjectName = existing?.id || projectName;
  if (oldProjectName !== projectName) {
    projectDb.migrateProjectIdentity(oldProjectName, projectName, absolutePath);
  }
  const metadata = {
    ...(existing?.metadata || {}),
    manuallyAdded: true,
    ...(options?.metadata && typeof options.metadata === 'object' ? options.metadata : {}),
  };
  delete metadata.trash;
  delete metadata.deleted;
  const ownerUserId = existing?.user_id ?? userId ?? null;
  projectDb.upsertProject(projectName, ownerUserId, displayName || existing?.display_name || null,
    absolutePath, existing?.is_starred || 0, new Date().toISOString(), metadata);

  await mutateProjectConfig((config) => {
    const info = {
      ...(config[oldProjectName] || {}),
      ...(config[projectName] || {}),
      manuallyAdded: true,
      originalPath: absolutePath,
      ownerUserId: ownerUserId ?? config[projectName]?.ownerUserId ?? config[oldProjectName]?.ownerUserId ?? null,
    };
    delete info.trash;
    delete info.deleted;
    clearDeletedProjectMetadata(config, oldProjectName);
    clearDeletedProjectMetadata(config, projectName);
    if (oldProjectName !== projectName) delete config[oldProjectName];
    if (displayName) info.displayName = displayName;
    if (metadata.isConversationWorkspace === true) info.isConversationWorkspace = true;
    if (metadata.preserveFolderContents === true) info.preserveFolderContents = true;
    config[projectName] = info;
  });
  projectDirectoryCache.delete(oldProjectName);
  projectDirectoryCache.delete(projectName);
  if (options.initializeWorkspace !== false) {
    // Project creation/import is also the repair point for workspaces created
    // by older MedHelp versions. Plain linked folders explicitly opt out.
    await ensureProjectSkillLinks(absolutePath, {
      userId,
      conversationWorkspace: metadata.isConversationWorkspace === true,
      preserveFolderContents: metadata.preserveFolderContents === true,
    });
  }

  let dirCreatedAt = null;
  try {
    const dirStat = await fs.stat(absolutePath);
    dirCreatedAt = dirStat.birthtime.toISOString();
  } catch (_) {}

  return {
    name: projectName,
    path: absolutePath,
    fullPath: absolutePath,
    displayName: displayName || existing?.display_name || await generateDisplayName(projectName, absolutePath),
    isManuallyAdded: true,
    isConversationWorkspace: metadata.isConversationWorkspace === true,
    createdAt: existing?.created_at || dirCreatedAt,
    alreadyExists: Boolean(existing),
    sessions: [],
  };
}

function formatConversationWorkspaceDate(date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatConversationWorkspaceTime(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}-${minutes}-${seconds}`;
}

const AUTO_CONVERSATION_STALE_MS = 5 * 60 * 1000;
const DISPOSABLE_CONVERSATION_ROOT_ENTRIES = new Set([
  '.DS_Store',
  '.pipeline',
  'outputs',
  'work',
]);

async function isUnusedAutoConversationDirectory(projectPath) {
  let entries;
  try {
    const stats = await fs.lstat(projectPath);
    if (!stats.isDirectory() || stats.isSymbolicLink()) return false;
    entries = await fs.readdir(projectPath, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (!DISPOSABLE_CONVERSATION_ROOT_ENTRIES.has(entry.name)) return false;
    if (entry.name === '.DS_Store') continue;
    if (!entry.isDirectory() || entry.isSymbolicLink()) return false;
    if (entry.name === 'work' || entry.name === 'outputs') {
      const visibleEntries = (await fs.readdir(path.join(projectPath, entry.name)))
        .filter((name) => name !== '.DS_Store');
      if (visibleEntries.length > 0) return false;
    }
  }

  return true;
}

async function cleanupUnusedConversationWorkspaces(workspaceRoot, userId = null, options = {}) {
  const root = path.resolve(String(workspaceRoot || '').trim());
  const nowMs = options.now instanceof Date ? options.now.getTime() : Date.now();
  const staleMs = Number.isFinite(Number(options.staleMs))
    ? Math.max(0, Number(options.staleMs))
    : AUTO_CONVERSATION_STALE_MS;
  const { projectDb, sessionDb } = await import('./database/db.js');
  const removed = [];
  const projects = projectDb.getAllProjects(userId).filter((project) => (
    project?.metadata?.autoGenerated === true
    && project?.metadata?.isConversationWorkspace === true
    && (userId == null
      ? project.user_id == null
      : Number(project.user_id) === Number(userId))
  ));

  for (const project of projects) {
    const projectPath = path.resolve(String(project.path || ''));
    const relativePath = path.relative(root, projectPath);
    const pathParts = relativePath.split(path.sep);
    const isExpectedPath = relativePath
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath)
      && pathParts.length === 2
      && /^\d{4}-\d{2}-\d{2}$/.test(pathParts[0])
      && /^conversation-\d{2}-\d{2}-\d{2}(?:-\d+)?$/.test(pathParts[1]);
    if (!isExpectedPath) continue;
    if (sessionDb.getSessionsByProject(project.id).length > 0) continue;

    let stats;
    try {
      stats = await fs.stat(projectPath);
    } catch {
      projectDb.deleteProject(project.id);
      await mutateProjectConfig((config) => { delete config[project.id]; });
      removed.push(projectPath);
      continue;
    }
    if (nowMs - stats.mtimeMs < staleMs) continue;
    if (!await isUnusedAutoConversationDirectory(projectPath)) continue;

    await fs.rm(projectPath, { recursive: true, force: true });
    projectDb.deleteProject(project.id);
    await mutateProjectConfig((config) => { delete config[project.id]; });
    projectDirectoryCache.delete(project.id);
    removed.push(projectPath);

    const dateRoot = path.dirname(projectPath);
    try {
      if ((await fs.readdir(dateRoot)).length === 0) await fs.rmdir(dateRoot);
    } catch {
      // Another conversation may have appeared while cleanup was running.
    }
  }

  return removed;
}

async function createConversationWorkspace(workspaceRoot, userId = null, options = {}) {
  const root = path.resolve(String(workspaceRoot || '').trim());
  const now = options.now instanceof Date ? options.now : new Date();
  await cleanupUnusedConversationWorkspaces(root, userId, { now });
  const dateName = formatConversationWorkspaceDate(now);
  const timeName = formatConversationWorkspaceTime(now);
  const dateRoot = path.join(root, dateName);
  await fs.mkdir(dateRoot, { recursive: true });

  let conversationPath = null;
  for (let suffix = 0; suffix < 1000; suffix += 1) {
    const baseName = `conversation-${timeName}`;
    const folderName = suffix === 0 ? baseName : `${baseName}-${suffix + 1}`;
    const candidatePath = path.join(dateRoot, folderName);
    try {
      await fs.mkdir(candidatePath, { recursive: false });
      conversationPath = candidatePath;
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }

  if (!conversationPath) {
    throw new Error('Unable to allocate a unique conversation folder');
  }

  const displayTime = timeName.replaceAll('-', ':');
  return addProjectManually(conversationPath, `${dateName} ${displayTime}`, userId, {
    metadata: {
      isConversationWorkspace: true,
      conversationDate: dateName,
      autoGenerated: true,
    },
  });
}

async function normalizeComparablePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return '';
  }

  const withoutLongPathPrefix = inputPath.startsWith('\\\\?\\')
    ? inputPath.slice(4)
    : inputPath;
  const normalized = path.normalize(withoutLongPathPrefix.trim());

  if (!normalized) {
    return '';
  }

  const resolved = path.resolve(normalized);
  try {
    const realPath = await fs.realpath(resolved);
    return process.platform === 'win32' ? realPath.toLowerCase() : realPath;
  } catch (_) {
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }
}

async function findCodexJsonlFiles(dir) {
  const files = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await findCodexJsonlFiles(fullPath));
      } else if (entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    // Skip directories we can't read
  }

  return files;
}

function getCodexSessionRoots() {
  return getMedHelpCodexSessionRoots();
}

async function findCodexSessionFileById(sessionId, rootDirs = null) {
  if (!sessionId) {
    return null;
  }

  if (rootDirs == null) {
    await prepareMedHelpCodexHome();
  }
  const effectiveRootDirs = rootDirs ?? getCodexSessionRoots().map((root) => root.path);
  const normalizedRoots = Array.isArray(effectiveRootDirs) ? effectiveRootDirs : [effectiveRootDirs];
  for (const rootDir of normalizedRoots) {
    try {
      await fs.access(rootDir);
    } catch {
      continue;
    }

    const jsonlFiles = await findCodexJsonlFiles(rootDir);
    const matchingFile = jsonlFiles.find((filePath) => path.basename(filePath).includes(sessionId));
    if (matchingFile) {
      return matchingFile;
    }
  }

  return null;
}

async function buildCodexSessionsIndex() {
  await prepareMedHelpCodexHome();
  const sessionsByProject = new Map();
  const indexedSessionIds = new Set();

  // Codex Desktop moves rollout files into archived_sessions when a task is
  // archived. Keep those files discoverable so MedHelpSec can still render the
  // indexed conversation after the move. Active files win if both copies exist.
  for (const root of getCodexSessionRoots()) {
    const jsonlFiles = await findCodexJsonlFiles(root.path);

    for (const filePath of jsonlFiles) {
      try {
        const sessionData = await parseCodexSessionFile(filePath);
        if (!sessionData?.id || indexedSessionIds.has(sessionData.id)) {
          continue;
        }

        const normalizedProjectPath = await normalizeComparablePath(sessionData.cwd);
        if (!normalizedProjectPath) {
          continue;
        }

        const session = {
          id: sessionData.id,
          summary: sessionData.summary || 'Codex Session',
          displayNameSource: sessionData.displayNameSource,
          messageCount: sessionData.messageCount || 0,
          lastActivity: sessionData.timestamp ? new Date(sessionData.timestamp) : new Date(),
          cwd: sessionData.cwd,
          model: sessionData.model,
          mode: normalizeSessionMode(sessionData.mode),
          filePath,
          archived: root.archived,
          provider: 'codex',
        };

        if (!sessionsByProject.has(normalizedProjectPath)) {
          sessionsByProject.set(normalizedProjectPath, []);
        }

        sessionsByProject.get(normalizedProjectPath).push(session);
        indexedSessionIds.add(sessionData.id);
      } catch (error) {
        console.warn(`Could not parse Codex session file ${filePath}:`, error.message);
      }
    }
  }

  for (const sessions of sessionsByProject.values()) {
    sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  }

  return sessionsByProject;
}

// Fetch Codex sessions for a given project path
async function getCodexSessions(projectPath, options = {}) {
  const { limit = 5, indexRef = null, syncIndex = false, sessionId: targetSessionId = null, projectName: providedProjectName = null } = options;
  const projectName = providedProjectName || encodeProjectPath(projectPath);
  try {
    const { sessionDb } = await import('./database/db.js');
    const normalizedProjectPath = await normalizeComparablePath(projectPath);
    const legacyProjectPaths = remapCurrentProjectPathsToLegacy(projectPath);
    const normalizedLegacyProjectPaths = (
      await Promise.all(legacyProjectPaths.map((legacyProjectPath) => normalizeComparablePath(legacyProjectPath)))
    ).filter(Boolean);
    const legacyProjectNames = legacyProjectPaths.map((legacyProjectPath) => encodeProjectPath(legacyProjectPath));
    if (!normalizedProjectPath) {
      return [];
    }

    if (indexRef && !indexRef.sessionsByProject) {
      indexRef.sessionsByProject = await buildCodexSessionsIndex();
    }

    const sessionsByProject = indexRef?.sessionsByProject || await buildCodexSessionsIndex();
    const sessions = [...(sessionsByProject.get(normalizedProjectPath) || [])];

    for (const normalizedLegacyProjectPath of normalizedLegacyProjectPaths) {
      if (normalizedLegacyProjectPath !== normalizedProjectPath) {
        sessions.push(...(sessionsByProject.get(normalizedLegacyProjectPath) || []));
      }
    }

    // Return limited sessions for performance (0 = unlimited for deletion)
    const dbSessions = [
      ...sessionDb.getSessionsByProject(projectName),
      ...legacyProjectNames
        .filter((legacyProjectName) => legacyProjectName && legacyProjectName !== projectName)
        .flatMap((legacyProjectName) => sessionDb.getSessionsByProject(legacyProjectName)),
    ];
    const dbSessionMap = new Map(dbSessions.filter((session) => session.provider === 'codex').map((session) => [session.id, session]));
    const dedupedSessions = Array.from(new Map(sessions.map((session) => [session.id, session])).values()).map((session) => {
      const indexedSession = dbSessionMap.get(session.id) || null;
      const manualDisplayName = isManualSessionDisplayName(indexedSession)
        ? indexedSession.display_name
        : null;
      return {
        ...session,
        sessionKey: indexedSession?.sessionKey || null,
        ownerKey: indexedSession?.ownerKey || null,
        projectKey: indexedSession?.projectKey || projectName,
        runtimeId: 'codex',
        ...(manualDisplayName ? {
          summary: manualDisplayName,
          name: manualDisplayName,
          displayNameSource: 'manual',
        } : {}),
        mode: indexedSession
          ? (readExplicitSessionModeFromMetadata(indexedSession.metadata) || normalizeSessionMode(session.mode))
          : normalizeSessionMode(session.mode),
        tags: indexedSession
          ? (Array.isArray(indexedSession.tags) ? indexedSession.tags : [])
          : (Array.isArray(session.tags) ? session.tags : []),
      };
    });
    const visibleSessions = dedupedSessions.filter((session) => (
      !isConsultationSessionRecord(session)
      && !isConsultationSessionRecord(dbSessionMap.get(session.id))
    ));
    const filteredSessions = targetSessionId
      ? visibleSessions.filter((session) => session.id === targetSessionId)
      : visibleSessions;

    if (syncIndex) {
      await Promise.allSettled(
        filteredSessions.map(async (session) => {
          const indexedSession = sessionDb.getSessionById(session.id, {
            projectName,
            provider: 'codex',
          });
          await reconcileIndexedSessionFromSource(projectName, 'codex', {
            ...session,
            summary: session.summary || session.name,
            createdAt: session.createdAt || session.lastActivity,
          }, indexedSession, projectPath);
        })
      );
    }

    return limit > 0 ? filteredSessions.slice(0, limit) : filteredSessions;

  } catch (error) {
    console.error('Error fetching Codex sessions:', error);
    return [];
  }
}

// Parse a Codex session JSONL file to extract metadata
async function parseCodexSessionFile(filePath) {
  try {
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let sessionMeta = null;
    let lastTimestamp = null;
    let firstUserDisplayName = null;
    let messageCount = 0;
    let detectedSessionMode = null;
    let latestManualSummary = null;

    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);

          // Track timestamp
          if (entry.timestamp) {
            lastTimestamp = entry.timestamp;
          }

          // Extract session metadata
          if (entry.type === 'session_meta' && entry.payload) {
            sessionMeta = {
              id: entry.payload.id,
              cwd: entry.payload.cwd,
              model: entry.payload.model || entry.payload.model_provider,
              timestamp: entry.timestamp,
              git: entry.payload.git
            };
          }

          if (
            entry.type === 'summary'
            && typeof entry.summary === 'string'
            && entry.summary.trim()
            && isManualSummaryEntry(entry)
          ) {
            latestManualSummary = entry.summary.trim();
          }

          // Count messages and extract user messages for summary
          if (entry.type === 'event_msg' && entry.payload?.type === 'user_message') {
            messageCount++;
            if (entry.payload.message) {
              const modeFromMessage = extractSessionModeFromText(entry.payload.message);
              if (modeFromMessage) {
                detectedSessionMode = modeFromMessage;
              }

              const hasExplicitVisibilityBoundary = extractVisibleUserContent(entry.payload.message) !== null;
              const cleanedUserMessage = stripInternalContextPrefix(entry.payload.message, false);
              if (cleanedUserMessage && (hasExplicitVisibilityBoundary || !isCodexSystemPromptContent(cleanedUserMessage))) {
                if (!detectedSessionMode) {
                  detectedSessionMode = inferSessionModeFromUserMessage(cleanedUserMessage);
                }
                if (!firstUserDisplayName) {
                  firstUserDisplayName = buildSessionDisplayName(entry.payload.message);
                }
              }
            }
          }

          if (entry.type === 'response_item' && entry.payload?.type === 'message' && entry.payload.role === 'assistant') {
            messageCount++;
          }

        } catch (parseError) {
          // Skip malformed lines
        }
      }
    }
    rl.close();
    fileStream.destroy();

    if (sessionMeta) {
      return {
        ...sessionMeta,
        timestamp: lastTimestamp || sessionMeta.timestamp,
        mode: detectedSessionMode || 'research',
        summary: latestManualSummary || firstUserDisplayName || 'Codex Session',
        displayNameSource: latestManualSummary ? 'manual' : (firstUserDisplayName ? 'user' : 'placeholder'),
        messageCount
      };
    }

    return null;

  } catch (error) {
    console.error('Error parsing Codex session file:', error);
    return null;
  }
}

/**
 * Detect system prompt / instruction content in Codex messages
 * (AGENTS.md, skill listings, instruction blocks)
 */
function isCodexSystemPromptContent(text) {
  const normalizedText = typeof text === 'string' ? text.trim() : '';
  if (!normalizedText) return false;
  if (isCodexInternalNoticeContent(normalizedText)) return true;
  if (isCodexInternalPromptContent(normalizedText)) return true;

  const lines = normalizedText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const startupDiagnosticPatterns = [
    /^⚠\s*Skipped loading .*invalid SKILL\.md files?/i,
    /^⚠\s*\/.*SKILL\.md:\s*invalid YAML:/i,
    /^⚠\s*MCP client for .* failed to start:/i,
    /^⚠\s*The figma MCP server is not logged in\./i,
    /^⚠\s*Heads up, you have less than \d+% of your .* limit left\./i,
    /^•\s*Starting MCP servers/i,
  ];
  const matchedDiagnosticLines = lines.reduce((count, line) => (
    startupDiagnosticPatterns.some((pattern) => pattern.test(line)) ? count + 1 : count
  ), 0);
  if (matchedDiagnosticLines >= 2 || /^•\s*Starting MCP servers/i.test(normalizedText)) {
    return true;
  }

  if (!text || text.length < 200) return false;
  if (/^#\s+(AGENTS|SKILL|INSTRUCTIONS)/m.test(text)) return true;
  if (text.includes('<INSTRUCTIONS>') || text.includes('</INSTRUCTIONS>')) return true;
  if (/^#+\s+.*instructions\s+for\s+\//im.test(text)) return true;
  if (text.includes('Base directory for this skill:') && text.length > 500) return true;
  if (text.length > 2000 && /^\d+\)\s/m.test(text) && /\bskill\b/i.test(text)) return true;
  const skillPathCount = (text.match(/SKILL\.md\)/g) || []).length;
  if (skillPathCount >= 3) return true;
  if (text.includes('### How to use skills') || text.includes('## How to use skills')) return true;
  if (text.includes('Trigger rules:') && text.includes('skill') && text.length > 500) return true;
  return false;
}

// Get messages for a specific Codex session
async function getCodexSessionMessages(sessionId, limit = null, offset = 0) {
  try {
    const sessionFilePath = await findCodexSessionFileById(sessionId);

    if (!sessionFilePath) {
      console.warn(`Codex session file not found for session ${sessionId}`);
      return { messages: [], total: 0, hasMore: false };
    }

    const messages = [];
    const hiddenToolCallIds = new Set();
    let latestTokenInfo = null;
    const fileStream = fsSync.createReadStream(sessionFilePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    // Helper to extract text from Codex content array
    const extractText = (content) => {
      if (!Array.isArray(content)) return content;
      return content
        .map(item => {
          if (item.type === 'input_text' || item.type === 'output_text') {
            return item.text;
          }
          if (item.type === 'text') {
            return item.text;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
    };

    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);

          // Keep the latest token_count event so token usage matches the dedicated
          // token-usage endpoint and never treats lifetime totals as current context.
          if (entry.type === 'event_msg' && entry.payload?.type === 'token_count' && entry.payload?.info) {
            latestTokenInfo = entry.payload.info;
          }

          // Extract messages from response_item
          if (entry.type === 'response_item' && entry.payload?.type === 'message') {
            const content = entry.payload.content;
            const role = entry.payload.role || 'assistant';
            const textContent = extractText(content);
            const hasExplicitVisibilityBoundary = role === 'user'
              && extractVisibleUserContent(textContent) !== null;

            // Skip system context messages (environment_context)
            if (!hasExplicitVisibilityBoundary && textContent?.includes('<environment_context>')) {
              continue;
            }

            // Automatic goal-continuation context is stored as a user-role
            // rollout item, but it is internal metadata and must never appear
            // as a purple user message in conversation history.
            if (!hasExplicitVisibilityBoundary && role === 'user' && isCodexInternalContextContent(textContent)) {
              continue;
            }

            const visibleText = role === 'user'
              ? stripInternalContextPrefix(textContent, false)
              : textContent;

            // User rollout entries can contain prompt scaffolding plus the real
            // request; preserve only the request. Assistant/system echoes are
            // never part of conversation history.
            if (
              textContent
              && isCodexSystemPromptContent(textContent)
              && !hasExplicitVisibilityBoundary
              && !(role === 'user' && isCodexInternalPromptContent(textContent))
            ) {
              continue;
            }

            // Only add if there's actual content
            if (visibleText?.trim()) {
              messages.push({
                type: role === 'user' ? 'user' : 'assistant',
                timestamp: entry.timestamp,
                message: {
                  role: role,
                  content: visibleText
                }
              });
            }
          }

          // Skip Codex reasoning items - they are brief status notes, not useful to display

          if (entry.type === 'response_item' && entry.payload?.type === 'function_call') {
            let toolName = entry.payload.name;
            let toolInput = entry.payload.arguments;

            if (toolName === 'wait') {
              if (entry.payload.call_id) hiddenToolCallIds.add(entry.payload.call_id);
              continue;
            }

            // Map Codex tool names to Claude equivalents
            if (toolName === 'shell_command') {
              toolName = 'Bash';
              try {
                const args = JSON.parse(entry.payload.arguments);
                toolInput = JSON.stringify({ command: args.command });
              } catch (e) {
                // Keep original if parsing fails
              }
            }

            messages.push({
              type: 'tool_use',
              timestamp: entry.timestamp,
              toolName: toolName,
              toolInput: toolInput,
              toolCallId: entry.payload.call_id
            });
          }

          if (entry.type === 'response_item' && entry.payload?.type === 'function_call_output') {
            if (hiddenToolCallIds.has(entry.payload.call_id)) {
              continue;
            }
            messages.push({
              type: 'tool_result',
              timestamp: entry.timestamp,
              toolCallId: entry.payload.call_id,
              output: entry.payload.output
            });
          }

          if (entry.type === 'response_item' && entry.payload?.type === 'custom_tool_call') {
            const rawToolName = entry.payload.name || 'custom_tool';
            const input = entry.payload.input || '';

            if (rawToolName === 'wait') {
              if (entry.payload.call_id) hiddenToolCallIds.add(entry.payload.call_id);
              continue;
            }

            const toolName = rawToolName;
            const visibleToolInput = input;

            if (toolName === 'apply_patch') {
              // Parse Codex patch format and convert to Claude Edit format
              const fileMatch = input.match(/\*\*\* Update File: (.+)/);
              const filePath = fileMatch ? fileMatch[1].trim() : 'unknown';

              // Extract old and new content from patch
              const lines = input.split('\n');
              const oldLines = [];
              const newLines = [];

              for (const line of lines) {
                if (line.startsWith('-') && !line.startsWith('---')) {
                  oldLines.push(line.substring(1));
                } else if (line.startsWith('+') && !line.startsWith('+++')) {
                  newLines.push(line.substring(1));
                }
              }

              messages.push({
                type: 'tool_use',
                timestamp: entry.timestamp,
                toolName: 'Edit',
                toolInput: JSON.stringify({
                  file_path: filePath,
                  old_string: oldLines.join('\n'),
                  new_string: newLines.join('\n')
                }),
                toolCallId: entry.payload.call_id
              });
            } else {
              messages.push({
                type: 'tool_use',
                timestamp: entry.timestamp,
                toolName: toolName,
                toolInput: visibleToolInput,
                toolCallId: entry.payload.call_id
              });
            }
          }

          if (entry.type === 'response_item' && entry.payload?.type === 'custom_tool_call_output') {
            if (hiddenToolCallIds.has(entry.payload.call_id)) {
              continue;
            }
            messages.push({
              type: 'tool_result',
              timestamp: entry.timestamp,
              toolCallId: entry.payload.call_id,
              output: entry.payload.output || ''
            });
          }

        } catch (parseError) {
          // Skip malformed lines
        }
      }
    }
    rl.close();
    fileStream.destroy();

    // Sort by timestamp
    messages.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

    const total = messages.length;
    const tokenUsage = latestTokenInfo ? buildCodexTokenUsageFromTokenInfo(latestTokenInfo) : null;

    // Apply pagination if limit is specified
    if (limit !== null) {
      const startIndex = Math.max(0, total - offset - limit);
      const endIndex = total - offset;
      const paginatedMessages = messages.slice(startIndex, endIndex);
      const hasMore = startIndex > 0;

      return {
        messages: paginatedMessages,
        total,
        hasMore,
        offset,
        limit,
        tokenUsage
      };
    }

    return { messages, tokenUsage };

  } catch (error) {
    console.error(`Error reading Codex session messages for ${sessionId}:`, error);
    return { messages: [], total: 0, hasMore: false };
  }
}

async function deleteCodexSession(sessionId, options = {}) {
  try {
    const { sessionDb } = await import('./database/db.js');
    const sessionLookup = {
      provider: 'codex',
      ...(options.projectName ? { projectName: options.projectName } : {}),
      ...(options.ownerKey !== null && options.ownerKey !== undefined
        ? { ownerKey: String(options.ownerKey) }
        : {}),
    };
    const indexedSession = sessionDb.getSessionById(sessionId, sessionLookup);
    let deletedFile = false;

    const sessionFilePath = await findCodexSessionFileById(sessionId);
    if (sessionFilePath) {
      await fs.unlink(sessionFilePath);
      deletedFile = true;
    }

    const deletedIndex =
      indexedSession?.provider === 'codex' || deletedFile;

    if (deletedIndex) {
      sessionDb.deleteSession(sessionId, sessionLookup);
    }

    if (deletedFile || deletedIndex) {
      return true;
    }

    throw new Error(`Codex session file not found for session ${sessionId}`);
  } catch (error) {
    console.error(`Error deleting Codex session ${sessionId}:`, error);
    throw error;
  }
}

const ALLOWED_DATA_FOLDERS_CONFIG_KEY = '_allowedDataFolders';

function expandConfigPathInput(targetPath) {
  const value = String(targetPath || '').trim();
  if (value === '~') {
    return os.homedir();
  }
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

async function normalizeAllowedDataFolderEntries(folderPaths = []) {
  const seen = new Set();
  const entries = [];

  for (const folderPath of Array.isArray(folderPaths) ? folderPaths : []) {
    const rawPath = typeof folderPath === 'string'
      ? folderPath
      : folderPath?.path;
    const trimmedPath = String(rawPath || '').trim();
    if (!trimmedPath) {
      continue;
    }

    const absolutePath = path.resolve(expandConfigPathInput(trimmedPath));
    let resolvedPath = absolutePath;
    let exists = false;

    try {
      resolvedPath = await fs.realpath(absolutePath);
      exists = true;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    const normalizedKey = process.platform === 'win32'
      ? resolvedPath.toLowerCase()
      : resolvedPath;
    if (seen.has(normalizedKey)) {
      continue;
    }
    seen.add(normalizedKey);

    entries.push({
      path: resolvedPath,
      exists,
    });
  }

  return entries;
}

async function getAllowedDataFolderEntriesFromConfig() {
  const config = await loadProjectConfig();
  return normalizeAllowedDataFolderEntries(config[ALLOWED_DATA_FOLDERS_CONFIG_KEY] || []);
}

async function getAllowedDataFoldersFromConfig() {
  const entries = await getAllowedDataFolderEntriesFromConfig();
  return entries
    .filter((entry) => entry.exists)
    .map((entry) => entry.path);
}

async function setAllowedDataFoldersInConfig(folderPaths = []) {
  const entries = await normalizeAllowedDataFolderEntries(folderPaths);
  await mutateProjectConfig((config) => {
    const nextPaths = entries.map((entry) => entry.path);
    if (nextPaths.length > 0) {
      config[ALLOWED_DATA_FOLDERS_CONFIG_KEY] = nextPaths;
    } else {
      delete config[ALLOWED_DATA_FOLDERS_CONFIG_KEY];
    }
  });
  return getAllowedDataFolderEntriesFromConfig();
}

// Get workspace root from project config
async function getWorkspaceRootFromConfig() {
  const config = await loadProjectConfig();
  const resolvedRoot = await resolveConfiguredWorkspacesRoot(config._workspacesRoot || null);

  if (resolvedRoot && config._workspacesRoot !== resolvedRoot) {
    await mutateProjectConfig((nextConfig) => {
      nextConfig._workspacesRoot = resolvedRoot;
    });
  }

  return resolvedRoot || null;
}

// Save workspace root to project config
async function setWorkspaceRootInConfig(workspacesRoot) {
  await mutateProjectConfig((config) => {
    if (workspacesRoot) {
      config._workspacesRoot = workspacesRoot;
    } else {
      delete config._workspacesRoot;
    }
  });
}

// Rename a session (Claude, Codex, OpenRouter, or local)
async function renameSession(projectName, sessionId, newSummary, provider = 'claude', userId = null) {
  if (!newSummary || newSummary.trim() === '') {
    throw new Error('New session name cannot be empty');
  }

  const trimmedSummary = newSummary.trim();
  const { sessionDb, projectDb } = await import('./database/db.js');

  // Basic security: if project is in DB, check if it belongs to this user
  const project = projectDb.getProjectById(projectName);
  if (project && userId && project.user_id && project.user_id !== userId) {
    throw new Error('You do not have permission to modify sessions in this project');
  }

  // Handle Codex sessions (JSONL)
  if (provider === 'codex') {
    try {
      const codexSessionFile = await findCodexSessionFileById(sessionId);

      if (codexSessionFile) {
        const summaryEntry = {
          type: 'summary',
          sessionId,
          summary: trimmedSummary,
          title: trimmedSummary,
          isManual: true,
          source: 'medhelp-user-rename',
          timestamp: new Date().toISOString(),
        };
        await fs.appendFile(codexSessionFile, JSON.stringify(summaryEntry) + '\n');
      } else {
        const indexedSession = sessionDb.getSessionById(sessionId, {
          projectName,
          provider: 'codex',
          ...(userId === null || userId === undefined ? {} : { ownerKey: String(userId) }),
        });
        if (indexedSession?.provider !== 'codex') {
          throw new Error(`Codex session file not found for session ${sessionId}`);
        }
        console.warn(`[Codex] Session file missing for ${sessionId}; updating indexed title only.`);
      }

      sessionDb.updateSessionName(sessionId, trimmedSummary, {
        projectName,
        provider: 'codex',
        ...(userId === null || userId === undefined ? {} : { ownerKey: String(userId) }),
      });
      console.log(`[Codex] Renamed session ${sessionId} to "${trimmedSummary}"`);
      return true;
    } catch (e) {
      console.error(`[Codex] Failed to rename session ${sessionId}:`, e.message);
      throw new Error(`Failed to rename Codex session: ${e.message}`);
    }
  }
  // 3. Handle Claude sessions (JSONL)
  else {
    const projectDir = await resolveClaudeProjectDir(projectName);

    try {
      // Check if project directory exists first
      try {
        await fs.access(projectDir);
      } catch (e) {
        console.error(`[Claude] Project directory not found: ${projectDir}`);
        throw new Error(`Claude project directory not found: ${projectName}`);
      }

      const files = await fs.readdir(projectDir);
      const jsonlFiles = files.filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-'));

      if (jsonlFiles.length === 0) {
        throw new Error('No session files found for this project');
      }

      // Check all JSONL files to find which one contains the session
      for (const file of jsonlFiles) {
        const jsonlFile = path.join(projectDir, file);
        const content = await fs.readFile(jsonlFile, 'utf8');
        const lines = content.split('\n').filter(line => line.trim());

        const hasSession = lines.some(line => {
          try {
            const data = JSON.parse(line);
            return data.sessionId === sessionId;
          } catch {
            return false;
          }
        });

        if (hasSession) {
          // Append a new summary record for this sessionId
          const summaryEntry = {
            type: 'summary',
            sessionId: sessionId,
            summary: trimmedSummary,
            isManual: true,
            source: 'medhelp-user-rename',
            timestamp: new Date().toISOString()
          };
          await fs.appendFile(jsonlFile, JSON.stringify(summaryEntry) + '\n');

          // Update medhelp's own index
          sessionDb.updateSessionName(sessionId, trimmedSummary, {
            projectName,
            provider,
            ...(userId === null || userId === undefined ? {} : { ownerKey: String(userId) }),
          });

          console.log(`[Claude] Renamed session ${sessionId} to "${trimmedSummary}"`);
          return true;
        }
      }

      throw new Error(`Session ${sessionId} not found in any files`);
    } catch (error) {
      console.error(`Error renaming session ${sessionId} in project ${projectName}:`, error);
      throw error;
    }
  }
}

export {
  getProjects,
  getTrashedProjects,
  getTrashedSessions,
  getSessions,
  getSessionMessages,
  parseJsonlSessions,
  renameProject,
  renameSession,
  deleteSession,
  trashSession,
  restoreSession,
  isProjectEmpty,
  deleteProject,
  restoreProject,
  deleteTrashedProject,
  addProjectManually,
  ensureDefaultConversationProject,
  createConversationWorkspace,
  cleanupUnusedConversationWorkspaces,
  loadProjectConfig,
  saveProjectConfig,
  extractProjectDirectory,
  clearProjectDirectoryCache,
  getCodexSessions,
  getCodexSessionMessages,
  findCodexSessionFileById,
  deleteCodexSession,
  reconcileClaudeSessionIndex,
  reconcileCodexSessionIndex,
  reconcileOpenRouterSessionIndex,
  reconcileLocalGPUSessionIndex,
  reindexProjectSessions,
  ensureProjectSkillLinks,
  getAllowedDataFolderEntriesFromConfig,
  getAllowedDataFoldersFromConfig,
  getWorkspaceRootFromConfig,
  setAllowedDataFoldersInConfig,
  setWorkspaceRootInConfig
};
