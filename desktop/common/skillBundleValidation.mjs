import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

function visibleDirectories(entries) {
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'));
}

/**
 * Count skill directories using the same rule as the runtime loaders: a
 * directory is one skill when it directly contains SKILL.md, and a skill owns
 * its subtree. Category directories are traversed until a skill is found.
 */
export async function countSkillDirectories(directory) {
  const entries = await fsPromises.readdir(directory, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && entry.name === 'SKILL.md')) {
    return 1;
  }

  let count = 0;
  for (const entry of visibleDirectories(entries)) {
    count += await countSkillDirectories(path.join(directory, entry.name));
  }
  return count;
}

export function countSkillDirectoriesSync(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && entry.name === 'SKILL.md')) {
    return 1;
  }

  let count = 0;
  for (const entry of visibleDirectories(entries)) {
    count += countSkillDirectoriesSync(path.join(directory, entry.name));
  }
  return count;
}

export function requirePositiveSkillCount(value, label = 'Skill bundle') {
  const count = Number(value);
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`${label} must declare a positive integer skill count, found ${value ?? 'missing'}.`);
  }
  return count;
}
