import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveSystemSkillsDir } from './kernelAssetPaths.js';
import { resolveUserClaudePluginDir, resolveUserSkillsDir } from './storagePaths.js';

const SYSTEM_SKILLS_DIR = resolveSystemSkillsDir();

const PLUGIN_MANIFEST = {
  name: 'medhelp-skills',
  description: 'MedHelp research skills provided to Claude Code as native skills.',
  version: '1.0.0',
};

const LEGACY_MEDHELP_SKILL_PREFIX = 'inno-';
const CANONICAL_MEDHELP_SKILL_PREFIX = 'medhelp-';

function isShadowedLegacyMedHelpSkill(name, canonicalSkillNames) {
  if (!name.startsWith(LEGACY_MEDHELP_SKILL_PREFIX)) return false;
  const canonicalName = `${CANONICAL_MEDHELP_SKILL_PREFIX}${name.slice(LEGACY_MEDHELP_SKILL_PREFIX.length)}`;
  return canonicalSkillNames.has(canonicalName);
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Mount one skill into the generated Claude plugin.
 *
 * Windows directory symlinks require Developer Mode or an elevated token on
 * many customer machines. Directory junctions do not have that requirement,
 * so prefer them there. If the filesystem or endpoint protection still blocks
 * link creation, fall back to a real recursive copy so skills remain usable.
 */
export async function mountClaudeSkillDirectory(source, destination, options = {}) {
  const platform = options.platform || process.platform;
  const symlink = options.symlink || fs.symlink.bind(fs);
  const copy = options.copy || fs.cp.bind(fs);
  const linkType = platform === 'win32' ? 'junction' : 'dir';

  try {
    await symlink(source, destination, linkType);
    return linkType;
  } catch (linkError) {
    try {
      await copy(source, destination, {
        recursive: true,
        force: true,
        errorOnExist: false,
      });
      return 'copy';
    } catch (copyError) {
      const error = new Error(
        `link failed: ${linkError.message}; copy fallback failed: ${copyError.message}`,
      );
      error.cause = copyError;
      throw error;
    }
  }
}

/**
 * Walk baseDir and collect every directory that directly contains a SKILL.md.
 * Does not recurse into a skill once found.
 */
async function collectSkillDirs(baseDir) {
  const results = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    if (entries.some((entry) => entry.isFile() && entry.name === 'SKILL.md')) {
      results.push({ name: path.basename(dir), absolutePath: dir });
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        await walk(path.join(dir, entry.name));
      }
    }
  }

  if (await pathExists(baseDir)) {
    await walk(baseDir);
  }
  return results;
}

/**
 * Build/refresh a backend-private local Claude Code plugin that exposes MedHelp
 * system + user skills, so Claude gets skills without any .claude/skills symlink
 * inside the customer project. Returns the plugin dir path, or null if there are
 * no skills to expose.
 *
 * @param {string|number|null} userId
 * @param {{pluginDir?: string, systemSkillsDir?: string, userSkillsDir?: string|null}} [options]
 */
export async function ensureClaudeSkillPlugin(userId, options = {}) {
  const pluginDir = options.pluginDir || resolveUserClaudePluginDir(userId);
  const systemSkillsDir = options.systemSkillsDir || SYSTEM_SKILLS_DIR;
  const userSkillsDir = Object.prototype.hasOwnProperty.call(options, 'userSkillsDir')
    ? options.userSkillsDir
    : (userId != null ? resolveUserSkillsDir(userId) : null);

  const systemSkills = await collectSkillDirs(systemSkillsDir);
  const userSkills = userSkillsDir ? await collectSkillDirs(userSkillsDir) : [];
  if (systemSkills.length === 0 && userSkills.length === 0) {
    return null;
  }

  const manifestDir = path.join(pluginDir, '.claude-plugin');
  await fs.mkdir(manifestDir, { recursive: true });
  await fs.writeFile(
    path.join(manifestDir, 'plugin.json'),
    JSON.stringify(PLUGIN_MANIFEST, null, 2),
    'utf8',
  );

  const skillsDir = path.join(pluginDir, 'skills');
  await fs.rm(skillsDir, { recursive: true, force: true });
  await fs.mkdir(skillsDir, { recursive: true });

  const canonicalSkillNames = new Set(
    [...systemSkills, ...userSkills]
      .map(({ name }) => name)
      .filter((name) => name.startsWith(CANONICAL_MEDHELP_SKILL_PREFIX)),
  );
  const visibleUserSkills = userSkills.filter(
    ({ name }) => !isShadowedLegacyMedHelpSkill(name, canonicalSkillNames),
  );

  const seen = new Set();
  let mountedSkillCount = 0;
  for (const { name, absolutePath } of [...systemSkills, ...visibleUserSkills]) {
    if (seen.has(name)) continue;
    seen.add(name);
    try {
      await mountClaudeSkillDirectory(absolutePath, path.join(skillsDir, name));
      mountedSkillCount += 1;
    } catch (err) {
      console.warn(`[claude-skill-plugin] Failed to mount skill ${name}:`, err.message);
    }
  }

  if (mountedSkillCount === 0) {
    throw new Error(
      `Failed to mount all ${seen.size} Claude skills into ${skillsDir}. `
      + 'Check filesystem permissions and endpoint protection logs.',
    );
  }

  return pluginDir;
}
