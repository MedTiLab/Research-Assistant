import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  ensureClaudeSkillPlugin,
  mountClaudeSkillDirectory,
} from '../utils/claudeSkillPlugin.js';

const tempRoots = [];
async function tmp() {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-skill-plugin-'));
  tempRoots.push(d);
  return d;
}
async function makeSkill(root, name, description) {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\nsecret body`,
    'utf8',
  );
  return dir;
}
afterEach(async () => {
  for (const d of tempRoots.splice(0)) {
    await fs.rm(d, { recursive: true, force: true });
  }
});

describe('ensureClaudeSkillPlugin', () => {
  it('builds a local plugin with manifest and mounted system + user skills', async () => {
    const sys = await tmp();
    await makeSkill(sys, 'medhelp-deep-research', 'deep research');
    const usr = await tmp();
    await makeSkill(usr, 'my-skill', 'user skill');
    const pluginDir = await tmp();

    const result = await ensureClaudeSkillPlugin('42', {
      pluginDir,
      systemSkillsDir: sys,
      userSkillsDir: usr,
    });
    expect(result).toBe(pluginDir);

    const manifest = JSON.parse(
      await fs.readFile(path.join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8'),
    );
    expect(manifest.name).toBe('medhelp-skills');

    const sysLink = path.join(pluginDir, 'skills', 'medhelp-deep-research');
    expect(await fs.readFile(path.join(sysLink, 'SKILL.md'), 'utf8')).toContain('deep research');
    expect(await fs.readFile(path.join(pluginDir, 'skills', 'my-skill', 'SKILL.md'), 'utf8')).toContain('user skill');
  });

  it('is idempotent and system skills win on name collision', async () => {
    const sys = await tmp();
    await makeSkill(sys, 'dup', 'system version');
    const usr = await tmp();
    await makeSkill(usr, 'dup', 'user version');
    const pluginDir = await tmp();

    await ensureClaudeSkillPlugin('7', { pluginDir, systemSkillsDir: sys, userSkillsDir: usr });
    await ensureClaudeSkillPlugin('7', { pluginDir, systemSkillsDir: sys, userSkillsDir: usr });

    const link = path.join(pluginDir, 'skills', 'dup');
    expect(await fs.readFile(path.join(link, 'SKILL.md'), 'utf8')).toContain('system version');
    expect(await fs.readdir(path.join(pluginDir, 'skills'))).toEqual(['dup']);
  });

  it('hides legacy inno aliases when the canonical medhelp skill exists', async () => {
    const sys = await tmp();
    await makeSkill(sys, 'medhelp-reference-audit', 'canonical audit');
    const usr = await tmp();
    await makeSkill(usr, 'inno-reference-audit', 'legacy audit');
    await makeSkill(usr, 'inno-private-workflow', 'unrelated user skill');
    const pluginDir = await tmp();

    await ensureClaudeSkillPlugin('9', { pluginDir, systemSkillsDir: sys, userSkillsDir: usr });

    const exposedSkills = await fs.readdir(path.join(pluginDir, 'skills'));
    expect(exposedSkills).toContain('medhelp-reference-audit');
    expect(exposedSkills).toContain('inno-private-workflow');
    expect(exposedSkills).not.toContain('inno-reference-audit');
  });

  it('returns null when there are no skills to link', async () => {
    const sys = await tmp();
    const pluginDir = await tmp();
    const result = await ensureClaudeSkillPlugin(null, {
      pluginDir,
      systemSkillsDir: sys,
      userSkillsDir: null,
    });
    expect(result).toBeNull();
  });

  it('uses a Windows junction instead of a privileged directory symlink', async () => {
    const calls = [];
    const result = await mountClaudeSkillDirectory('C:\\source', 'C:\\destination', {
      platform: 'win32',
      symlink: async (...args) => calls.push(args),
      copy: async () => {
        throw new Error('copy should not run');
      },
    });

    expect(result).toBe('junction');
    expect(calls).toEqual([['C:\\source', 'C:\\destination', 'junction']]);
  });

  it('falls back to a recursive copy when Windows junction creation is blocked', async () => {
    const copyCalls = [];
    const result = await mountClaudeSkillDirectory('C:\\source', 'C:\\destination', {
      platform: 'win32',
      symlink: async () => {
        const error = new Error('operation not permitted');
        error.code = 'EPERM';
        throw error;
      },
      copy: async (...args) => copyCalls.push(args),
    });

    expect(result).toBe('copy');
    expect(copyCalls).toEqual([[
      'C:\\source',
      'C:\\destination',
      { recursive: true, force: true, errorOnExist: false },
    ]]);
  });
});
