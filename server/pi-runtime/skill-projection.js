import { promises as fs } from 'fs';
import path from 'path';
import { resolveSystemSkillsDir } from '../utils/kernelAssetPaths.js';
import { resolveUserSkillsDir } from '../utils/storagePaths.js';

const MAX_PROJECTED_SKILLS = 512;
const MAX_SCANNED_DIRECTORIES = 4096;
const MAX_SCAN_DEPTH = 8;
const MAX_SKILL_FILE_BYTES = 1024 * 1024;
const SAFE_SKILL_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;

function isInside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function readUserSkillOrigins(userSkillsDir) {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(userSkillsDir, 'stage-skill-map.json'), 'utf8'));
    return parsed?.skillOrigins && typeof parsed.skillOrigins === 'object' && !Array.isArray(parsed.skillOrigins)
      ? parsed.skillOrigins
      : {};
  } catch {
    return {};
  }
}

async function collectRootSkills(root, { source, origins = null } = {}) {
  const skills = [];
  const diagnostics = [];
  let canonicalRoot;
  try {
    canonicalRoot = await fs.realpath(path.resolve(root));
  } catch (error) {
    if (error?.code !== 'ENOENT') diagnostics.push({ source, code: 'root_unavailable' });
    return { skills, diagnostics };
  }

  let scannedDirectories = 0;
  async function visit(directory, relativeDirectory = '', depth = 0) {
    if (depth > MAX_SCAN_DEPTH || scannedDirectories >= MAX_SCANNED_DIRECTORIES) {
      diagnostics.push({ source, name: relativeDirectory || undefined, code: 'scan_limit_exceeded' });
      return;
    }
    scannedDirectories += 1;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      diagnostics.push({ source, name: relativeDirectory || undefined, code: 'root_unavailable' });
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    if (relativeDirectory) {
      const name = path.basename(directory);
      const skillEntry = entries.find((entry) => entry.name === 'SKILL.md');
      if (skillEntry) {
        if (!SAFE_SKILL_NAME.test(name)) {
          diagnostics.push({ source, name, code: 'invalid_name' });
          return;
        }
        const origin = origins?.[relativeDirectory.split(path.sep).join('/')]
          || origins?.[name];
        if (origins && typeof origin !== 'string') {
          diagnostics.push({ source, name, code: 'unmanaged_user_skill' });
          return;
        }
        try {
          const canonicalDir = await fs.realpath(directory);
          if (!isInside(canonicalRoot, canonicalDir)) throw new Error('path_escape');
          const skillStat = await fs.lstat(path.join(canonicalDir, 'SKILL.md'));
          if (!skillEntry.isFile() || !skillStat.isFile() || skillStat.isSymbolicLink() || skillStat.size > MAX_SKILL_FILE_BYTES) {
            diagnostics.push({ source, name, code: 'invalid_skill_file' });
            return;
          }
          skills.push(Object.freeze({ name, source, sourceDir: canonicalDir, origin: origin || source }));
        } catch (error) {
          diagnostics.push({ source, name, code: error?.message === 'path_escape' ? 'path_escape' : 'invalid_skill' });
        }
        // A skill directory owns its subtree; nested assets are not separate skills.
        return;
      }
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || ['node_modules', 'dist', 'build'].includes(entry.name)) continue;
      await visit(path.join(directory, entry.name), path.join(relativeDirectory, entry.name), depth + 1);
    }
  }
  await visit(canonicalRoot);
  // Preserve the previously supported top-level skill when a newly discovered
  // nested skill has the same name, then keep the projection deterministic.
  skills.sort((left, right) => {
    const leftDepth = path.relative(canonicalRoot, left.sourceDir).split(path.sep).length;
    const rightDepth = path.relative(canonicalRoot, right.sourceDir).split(path.sep).length;
    return leftDepth - rightDepth || left.name.localeCompare(right.name) || left.sourceDir.localeCompare(right.sourceDir);
  });
  return { skills, diagnostics };
}

export async function resolveTrustedPiSkills(options = {}) {
  const systemSkillsDir = path.resolve(options.systemSkillsDir || resolveSystemSkillsDir());
  const userSkillsDir = Object.prototype.hasOwnProperty.call(options, 'userSkillsDir')
    ? options.userSkillsDir
    : (options.userId != null ? resolveUserSkillsDir(options.userId, options) : null);
  const system = await collectRootSkills(systemSkillsDir, { source: 'system' });
  const userOrigins = userSkillsDir ? await readUserSkillOrigins(userSkillsDir) : {};
  const user = userSkillsDir
    ? await collectRootSkills(path.resolve(userSkillsDir), { source: 'user', origins: userOrigins })
    : { skills: [], diagnostics: [] };
  const seen = new Set();
  const skills = [];
  const diagnostics = [...system.diagnostics, ...user.diagnostics];
  for (const skill of [...system.skills, ...user.skills]) {
    const collisionKey = skill.name.toLocaleLowerCase('en-US');
    if (seen.has(collisionKey)) {
      diagnostics.push({ source: skill.source, name: skill.name, code: 'name_collision' });
      continue;
    }
    seen.add(collisionKey);
    if (skills.length >= MAX_PROJECTED_SKILLS) {
      diagnostics.push({ source: skill.source, name: skill.name, code: 'limit_exceeded' });
      continue;
    }
    skills.push(skill);
  }
  return Object.freeze({ skills: Object.freeze(skills), diagnostics: Object.freeze(diagnostics) });
}

async function mountSkill(sourceDir, destination, options = {}) {
  const platform = options.platform || process.platform;
  try {
    await fs.symlink(sourceDir, destination, platform === 'win32' ? 'junction' : 'dir');
    return 'link';
  } catch {
    await fs.cp(sourceDir, destination, {
      recursive: true,
      force: false,
      errorOnExist: true,
      filter: (source) => path.basename(source) !== '.git',
    });
    return 'copy';
  }
}

export async function createTrustedPiSkillProjection(configDir, projection, options = {}) {
  const skills = Array.isArray(projection?.skills) ? projection.skills : [];
  if (skills.length === 0) return Object.freeze({ paths: [], manifest: [] });
  const root = path.join(path.resolve(configDir), 'skills');
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const paths = [];
  const manifest = [];
  for (const skill of skills) {
    const destination = path.join(root, skill.name);
    const mode = await mountSkill(skill.sourceDir, destination, options);
    paths.push(path.relative(configDir, destination));
    manifest.push({ name: skill.name, source: skill.source, origin: skill.origin, mode });
  }
  return Object.freeze({ paths: Object.freeze(paths), manifest: Object.freeze(manifest) });
}

export const PI_SKILL_PROJECTION_LIMITS = Object.freeze({
  maxSkills: MAX_PROJECTED_SKILLS,
  maxSkillFileBytes: MAX_SKILL_FILE_BYTES,
  maxScannedDirectories: MAX_SCANNED_DIRECTORIES,
  maxScanDepth: MAX_SCAN_DEPTH,
});
