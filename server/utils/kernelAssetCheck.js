import { promises as fs } from 'fs';
import path from 'path';

import {
  isSecureDistribution,
  resolveAgentTemplatesDir,
  resolveSystemSkillsDir,
} from './kernelAssetPaths.js';

const REQUIRED_TEMPLATES = ['CLAUDE.md', 'AGENTS.md'];

/**
 * Count directories that directly contain a SKILL.md. Mirrors collectSkillDirs
 * in claudeSkillPlugin.js: a skill is not recursed into once found, but
 * category directories that only group skills are.
 */
async function countSkills(baseDir) {
  let total = 0;

  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    if (entries.some((entry) => entry.isFile() && entry.name === 'SKILL.md')) {
      total += 1;
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        await walk(path.join(dir, entry.name));
      }
    }
  }

  await walk(baseDir);
  return total;
}

async function isReadableFile(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return false;
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check that the assets the Kernel reads from disk at runtime are actually
 * there. The compiled Kernel bundles JavaScript only — skills and rule
 * templates are read with fs at runtime, so a binary shipped without them
 * starts cleanly and then silently gives customers a stock agent with no
 * MedHelp rules and no skills.
 */
export async function inspectKernelAssets() {
  const skillsDir = resolveSystemSkillsDir();
  const templatesDir = resolveAgentTemplatesDir();
  const problems = [];

  const skillCount = await countSkills(skillsDir);
  if (skillCount === 0) {
    problems.push(`No skills found under ${skillsDir} (set MEDHELP_SKILLS_DIR to the bundled skills directory).`);
  }

  const templates = {};
  for (const name of REQUIRED_TEMPLATES) {
    const filePath = path.join(templatesDir, name);
    const present = await isReadableFile(filePath);
    templates[name] = present;
    if (!present) {
      problems.push(`Missing agent rule template ${name} under ${templatesDir} (set MEDHELP_TEMPLATES_DIR).`);
    }
  }

  return {
    ok: problems.length === 0,
    secureDistribution: isSecureDistribution(),
    skills: { dir: skillsDir, count: skillCount },
    templates: { dir: templatesDir, files: templates },
    problems,
  };
}

/**
 * Fail loudly rather than degrade silently. In the compiled Kernel a missing
 * asset root is unrecoverable and must stop startup; in a source checkout it is
 * usually a dev running a subset of the tree, so warn and continue.
 */
export async function assertKernelAssets(options = {}) {
  const logger = options.logger || console;
  const report = await inspectKernelAssets();

  if (report.ok) {
    logger.log?.(
      `[kernel-assets] ${report.skills.count} skills from ${report.skills.dir}; rule templates from ${report.templates.dir}`,
    );
    return report;
  }

  const detail = report.problems.map((problem) => `  - ${problem}`).join('\n');

  if (report.secureDistribution) {
    throw new Error(`MedHelp Local Engine is missing required runtime assets:\n${detail}`);
  }

  logger.warn?.(`[kernel-assets] Degraded — agents will run without MedHelp rules or skills:\n${detail}`);
  return report;
}
