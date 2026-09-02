import fs from 'fs/promises';
import path from 'path';

import { resolveAgentTemplatesDir } from '../utils/kernelAssetPaths.js';

const TEMPLATES_DIR = resolveAgentTemplatesDir();
export const PROJECT_CLAUDE_MEMORY_RELATIVE_PATH = path.join('.claude', 'rules', 'project.md');
const LEGACY_PROJECT_CLAUDE_MEMORY_RELATIVE_PATH = 'CLAUDE.md';
export const PROJECT_CLAUDE_RELATIVE_PATH = LEGACY_PROJECT_CLAUDE_MEMORY_RELATIVE_PATH;
export const TEMPLATE_CLAUDE_PATH = path.join(TEMPLATES_DIR, 'CLAUDE.md');
// AGENTS.md is the shared project-rules source for Codex.
export const PROJECT_AGENTS_RELATIVE_PATH = 'AGENTS.md';
export const TEMPLATE_AGENTS_PATH = path.join(TEMPLATES_DIR, 'AGENTS.md');
export const PROJECT_CODEX_RELATIVE_PATH = 'CODEX.md';
export const PROJECT_MEMORY_RELATIVE_PATH = path.join('.medhelpsec', 'MEMORY.md');
export const INTERIM_PROJECT_MEMORY_RELATIVE_PATH = path.join('.medhelp', 'MEMORY.md');
export const LEGACY_PROJECT_MEMORY_RELATIVE_PATH = 'MEMORY.md';
const LEGACY_PROJECT_GEMINI_RELATIVE_PATH = 'GEMINI.md';
const GENERATED_PROVIDER_DIRS = ['.agents', '.claude', '.codex', '.gemini'];
const VIRTUAL_PROJECT_INSTRUCTION_DIR = '.medhelp-agent-rules';
const GENERATED_SKILL_CONFIG_FILES = new Set([
  'skill-tag-mapping.json',
  'skills-index.md',
  'stage-skill-map.json',
]);

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function getPreferredProjectClaudeMemoryPath(projectPath) {
  return path.join(projectPath, PROJECT_CLAUDE_MEMORY_RELATIVE_PATH);
}

export async function resolveProjectClaudeMemoryPath(projectPath) {
  const legacyPath = path.join(projectPath, LEGACY_PROJECT_CLAUDE_MEMORY_RELATIVE_PATH);
  if (await pathExists(legacyPath)) {
    return legacyPath;
  }

  const preferredPath = getPreferredProjectClaudeMemoryPath(projectPath);
  if (await pathExists(preferredPath)) {
    return preferredPath;
  }

  return legacyPath;
}

async function readFileIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function removeIfExactGeneratedFile(destPath, templatePath) {
  try {
    const stat = await fs.lstat(destPath);
    if (!stat.isFile()) {
      return;
    }
  } catch {
    return;
  }

  const [destContent, templateContent] = await Promise.all([
    readFileIfExists(destPath),
    readFileIfExists(templatePath),
  ]);

  if (destContent !== null && templateContent !== null && destContent === templateContent) {
    await fs.unlink(destPath).catch(() => {});
  }
}

async function isExactGeneratedFile(destPath, templatePath) {
  try {
    const stat = await fs.lstat(destPath);
    if (!stat.isFile()) {
      return false;
    }
  } catch {
    return false;
  }

  const [destContent, templateContent] = await Promise.all([
    readFileIfExists(destPath),
    readFileIfExists(templatePath),
  ]);

  return destContent !== null && templateContent !== null && destContent === templateContent;
}

function getRelativeSymlinkTarget(sourcePath, linkPath) {
  return path.relative(path.dirname(linkPath), sourcePath) || '.';
}

async function ensureTemplateSymlink(sourcePath, linkPath, options = {}) {
  const linkTargetPath = options.linkTargetPath || sourcePath;
  let shouldCreate = true;

  try {
    const stat = await fs.lstat(linkPath);
    if (stat.isSymbolicLink()) {
      const currentTarget = await fs.readlink(linkPath);
      const currentResolved = path.resolve(path.dirname(linkPath), currentTarget);
      if (currentResolved === linkTargetPath) {
        shouldCreate = false;
      } else {
        await fs.unlink(linkPath);
      }
    } else if (await isExactGeneratedFile(linkPath, sourcePath)) {
      await fs.unlink(linkPath);
    } else {
      shouldCreate = false;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  if (!shouldCreate) {
    return;
  }

  await fs.mkdir(path.dirname(linkPath), { recursive: true });
  await fs.symlink(getRelativeSymlinkTarget(linkTargetPath, linkPath), linkPath, 'file');
}

async function removeEmptyDirectory(dirPath) {
  try {
    const entries = await fs.readdir(dirPath);
    if (entries.length === 0) {
      await fs.rmdir(dirPath);
    }
  } catch {
    // Directory is absent or not empty; both are fine.
  }
}

async function cleanupGeneratedSkillsDir(skillsDir) {
  let entries;
  try {
    entries = await fs.readdir(skillsDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(skillsDir, entry.name);
    if (entry.isSymbolicLink()) {
      await fs.unlink(entryPath).catch(() => {});
      continue;
    }

    if (entry.isDirectory()) {
      await cleanupGeneratedSkillsDir(entryPath);
      await removeEmptyDirectory(entryPath);
      continue;
    }

    if (entry.isFile() && GENERATED_SKILL_CONFIG_FILES.has(entry.name)) {
      await fs.unlink(entryPath).catch(() => {});
    }
  }

  await removeEmptyDirectory(skillsDir);
}

async function removeGeneratedInstructionSymlink(projectPath, relativeDest) {
  const linkPath = path.join(projectPath, relativeDest);
  try {
    const stat = await fs.lstat(linkPath);
    if (!stat.isSymbolicLink()) return;
    const target = await fs.readlink(linkPath);
    const resolved = path.resolve(path.dirname(linkPath), target);
    const virtualRoot = path.join(projectPath, VIRTUAL_PROJECT_INSTRUCTION_DIR) + path.sep;
    if (resolved.startsWith(virtualRoot)) {
      await fs.unlink(linkPath).catch(() => {});
    }
  } catch {
    // Missing or unreadable link: nothing to clean.
  }
}

export async function cleanupGeneratedProjectAgentAssets(projectPath) {
  await Promise.all([
    removeIfExactGeneratedFile(
      path.join(projectPath, PROJECT_CLAUDE_RELATIVE_PATH),
      TEMPLATE_CLAUDE_PATH,
    ),
    removeIfExactGeneratedFile(
      path.join(projectPath, PROJECT_AGENTS_RELATIVE_PATH),
      TEMPLATE_AGENTS_PATH,
    ),
    removeIfExactGeneratedFile(
      path.join(projectPath, PROJECT_CODEX_RELATIVE_PATH),
      TEMPLATE_AGENTS_PATH,
    ),
  ]);

  await Promise.all([
    removeGeneratedInstructionSymlink(projectPath, PROJECT_AGENTS_RELATIVE_PATH),
    removeGeneratedInstructionSymlink(projectPath, PROJECT_CLAUDE_RELATIVE_PATH),
    removeGeneratedInstructionSymlink(projectPath, PROJECT_CODEX_RELATIVE_PATH),
    removeGeneratedInstructionSymlink(projectPath, LEGACY_PROJECT_GEMINI_RELATIVE_PATH),
  ]);

  for (const providerDir of GENERATED_PROVIDER_DIRS) {
    const providerPath = path.join(projectPath, providerDir);
    await cleanupGeneratedSkillsDir(path.join(providerPath, 'skills'));
    await removeEmptyDirectory(providerPath);
  }
}

async function ensureProjectClaudeMemoryFiles(projectPath) {
  const preferredPath = getPreferredProjectClaudeMemoryPath(projectPath);
  const legacyPath = path.join(projectPath, PROJECT_CLAUDE_RELATIVE_PATH);
  const legacyExists = await pathExists(legacyPath);

  if (legacyExists) return;

  const preferredExists = await pathExists(preferredPath);
  if (preferredExists) {
    await ensureTemplateSymlink(preferredPath, legacyPath);
    return;
  }

  await ensureTemplateSymlink(TEMPLATE_CLAUDE_PATH, legacyPath);
}

/**
 * Create the shared durable memory file in MedHelpSec's hidden project metadata
 * directory. A legacy memory file is moved when that can be done without
 * overwriting another memory file.
 */
export async function ensureProjectMemoryFile(projectPath) {
  const memoryPath = path.join(projectPath, PROJECT_MEMORY_RELATIVE_PATH);
  const interimMemoryPath = path.join(projectPath, INTERIM_PROJECT_MEMORY_RELATIVE_PATH);
  const legacyMemoryPath = path.join(projectPath, LEGACY_PROJECT_MEMORY_RELATIVE_PATH);
  await fs.mkdir(path.dirname(memoryPath), { recursive: true });

  if (await pathExists(memoryPath)) {
    return { path: memoryPath, created: false, migrated: false };
  }

  for (const compatiblePath of [interimMemoryPath, legacyMemoryPath]) {
    try {
      const legacyStats = await fs.lstat(compatiblePath);
      if (legacyStats.isFile() && !legacyStats.isSymbolicLink()) {
        await fs.rename(compatiblePath, memoryPath);
        if (compatiblePath === interimMemoryPath) {
          await removeEmptyDirectory(path.dirname(interimMemoryPath));
        }
        return { path: memoryPath, created: false, migrated: true };
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  try {
    await fs.writeFile(memoryPath, '# Project Memory\n\n', { encoding: 'utf8', flag: 'wx' });
    return { path: memoryPath, created: true, migrated: false };
  } catch (err) {
    if (err.code === 'EEXIST') {
      return { path: memoryPath, created: false, migrated: false };
    }
    throw err;
  }
}

/**
 * Static template files to copy into new Research Lab projects.
 * Each entry maps a source template to its destination path relative to the project root.
 */
const TEMPLATES = [];

const ROOT_PROJECT_TEMPLATES = [
  { src: TEMPLATE_AGENTS_PATH, dest: PROJECT_AGENTS_RELATIVE_PATH },
  { src: TEMPLATE_CLAUDE_PATH, dest: PROJECT_CLAUDE_RELATIVE_PATH },
  { src: TEMPLATE_AGENTS_PATH, dest: PROJECT_CODEX_RELATIVE_PATH },
];

export async function writeProjectInstructionLinks(projectPath) {
  for (const { src, dest } of ROOT_PROJECT_TEMPLATES) {
    const destPath = path.join(projectPath, dest);
    const linkTargetPath = path.join(projectPath, VIRTUAL_PROJECT_INSTRUCTION_DIR, dest);
    try {
      await ensureTemplateSymlink(src, destPath, { linkTargetPath });
    } catch (err) {
      console.error(`[templates] Failed to link ${dest}:`, err.message);
    }
  }
}

export function getProjectAgentsPath(projectPath) {
  return path.join(projectPath, PROJECT_AGENTS_RELATIVE_PATH);
}

export async function resolveProjectAgentsPath(projectPath) {
  const projectAgentsPath = getProjectAgentsPath(projectPath);
  if (await pathExists(projectAgentsPath)) {
    return projectAgentsPath;
  }
  return TEMPLATE_AGENTS_PATH;
}

/**
 * Write agent instruction template files into a project directory.
 * Copies static .md templates from this directory.
 * Skips any file that already exists so user customizations are preserved.
 * @param {string} projectPath - Absolute path to the project directory.
 */
export async function writeProjectTemplates(projectPath, options = {}) {
  const includeRootAgentTemplates = options?.includeRootAgentTemplates === true;
  const writeClaudeMemoryFile = options?.writeClaudeMemoryFile === true;

  if (writeClaudeMemoryFile) {
    try {
      await ensureProjectClaudeMemoryFiles(projectPath);
    } catch (err) {
      console.error('[templates] Failed to write Claude project memory files:', err.message);
    }
  }

  const templatesToWrite = includeRootAgentTemplates
    ? [...TEMPLATES, ...ROOT_PROJECT_TEMPLATES]
    : TEMPLATES;

  for (const { src, dest } of templatesToWrite) {
    const destPath = path.join(projectPath, dest);
    try {
      if (includeRootAgentTemplates && ROOT_PROJECT_TEMPLATES.some((entry) => entry.dest === dest)) {
        await ensureTemplateSymlink(src, destPath);
        continue;
      }

      if (await pathExists(destPath)) continue;

      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.copyFile(path.join(TEMPLATES_DIR, src), destPath);
    } catch (err) {
      console.error(`[templates] Failed to write ${dest}:`, err.message);
    }
  }
}
