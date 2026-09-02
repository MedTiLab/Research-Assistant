import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { resolveSystemSkillsDir, resolveAgentTemplatesDir } from '../utils/kernelAssetPaths.js';
import { inspectKernelAssets, assertKernelAssets } from '../utils/kernelAssetCheck.js';

let tmpRoot;

async function makeSkill(skillsDir, name) {
  await fs.mkdir(path.join(skillsDir, name), { recursive: true });
  await fs.writeFile(path.join(skillsDir, name, 'SKILL.md'), `---\nname: ${name}\n---\n`, 'utf8');
}

async function makeTemplates(templatesDir) {
  await fs.mkdir(templatesDir, { recursive: true });
  await fs.writeFile(path.join(templatesDir, 'CLAUDE.md'), '# rules\n', 'utf8');
  await fs.writeFile(path.join(templatesDir, 'AGENTS.md'), '# rules\n', 'utf8');
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-assets-'));
});

afterEach(async () => {
  delete process.env.MEDHELP_SKILLS_DIR;
  delete process.env.MEDHELP_TEMPLATES_DIR;
  delete process.env.MEDHELP_SECURE_DISTRIBUTION;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('resolveSystemSkillsDir', () => {
  it('prefers MEDHELP_SKILLS_DIR over the repo-relative fallback', () => {
    process.env.MEDHELP_SKILLS_DIR = path.join(tmpRoot, 'skills');
    expect(resolveSystemSkillsDir()).toBe(path.join(tmpRoot, 'skills'));
  });

  it('falls back to the repo skills directory when unset', () => {
    expect(resolveSystemSkillsDir().replace(/\\/g, '/')).toMatch(/\/skills$/);
  });
});

describe('resolveAgentTemplatesDir', () => {
  it('prefers MEDHELP_TEMPLATES_DIR over the repo-relative fallback', () => {
    process.env.MEDHELP_TEMPLATES_DIR = path.join(tmpRoot, 'tpl');
    expect(resolveAgentTemplatesDir()).toBe(path.join(tmpRoot, 'tpl'));
  });
});

describe('inspectKernelAssets', () => {
  it('reports ok when skills and templates are both present', async () => {
    const skillsDir = path.join(tmpRoot, 'skills');
    const templatesDir = path.join(tmpRoot, 'templates');
    await makeSkill(skillsDir, 'demo-skill');
    await makeTemplates(templatesDir);
    process.env.MEDHELP_SKILLS_DIR = skillsDir;
    process.env.MEDHELP_TEMPLATES_DIR = templatesDir;

    const report = await inspectKernelAssets();
    expect(report.ok).toBe(true);
    expect(report.skills.count).toBe(1);
    expect(report.problems).toEqual([]);
  });

  it('detects a missing skills directory', async () => {
    const templatesDir = path.join(tmpRoot, 'templates');
    await makeTemplates(templatesDir);
    process.env.MEDHELP_SKILLS_DIR = path.join(tmpRoot, 'nope');
    process.env.MEDHELP_TEMPLATES_DIR = templatesDir;

    const report = await inspectKernelAssets();
    expect(report.ok).toBe(false);
    expect(report.skills.count).toBe(0);
    expect(report.problems.join(' ')).toMatch(/skill/i);
  });

  it('detects an empty skills directory, not just a missing one', async () => {
    const skillsDir = path.join(tmpRoot, 'skills');
    const templatesDir = path.join(tmpRoot, 'templates');
    await fs.mkdir(skillsDir, { recursive: true });
    await makeTemplates(templatesDir);
    process.env.MEDHELP_SKILLS_DIR = skillsDir;
    process.env.MEDHELP_TEMPLATES_DIR = templatesDir;

    const report = await inspectKernelAssets();
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toMatch(/skill/i);
  });

  it('detects missing rule templates', async () => {
    const skillsDir = path.join(tmpRoot, 'skills');
    await makeSkill(skillsDir, 'demo-skill');
    process.env.MEDHELP_SKILLS_DIR = skillsDir;
    process.env.MEDHELP_TEMPLATES_DIR = path.join(tmpRoot, 'nope');

    const report = await inspectKernelAssets();
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toMatch(/CLAUDE\.md|AGENTS\.md/);
  });

  it('finds skills nested inside category directories', async () => {
    const skillsDir = path.join(tmpRoot, 'skills');
    const templatesDir = path.join(tmpRoot, 'templates');
    await makeSkill(skillsDir, 'top-level');
    await makeSkill(path.join(skillsDir, 'rag'), 'nested-skill');
    await makeTemplates(templatesDir);
    process.env.MEDHELP_SKILLS_DIR = skillsDir;
    process.env.MEDHELP_TEMPLATES_DIR = templatesDir;

    const report = await inspectKernelAssets();
    expect(report.skills.count).toBe(2);
  });
});

describe('assertKernelAssets', () => {
  it('throws in secure distribution when assets are missing', async () => {
    process.env.MEDHELP_SECURE_DISTRIBUTION = '1';
    process.env.MEDHELP_SKILLS_DIR = path.join(tmpRoot, 'nope');
    process.env.MEDHELP_TEMPLATES_DIR = path.join(tmpRoot, 'nope');

    await expect(assertKernelAssets()).rejects.toThrow(/asset/i);
  });

  it('does not throw outside secure distribution', async () => {
    process.env.MEDHELP_SKILLS_DIR = path.join(tmpRoot, 'nope');
    process.env.MEDHELP_TEMPLATES_DIR = path.join(tmpRoot, 'nope');

    const report = await assertKernelAssets();
    expect(report.ok).toBe(false);
  });

  it('returns a passing report in secure distribution when assets are present', async () => {
    const skillsDir = path.join(tmpRoot, 'skills');
    const templatesDir = path.join(tmpRoot, 'templates');
    await makeSkill(skillsDir, 'demo-skill');
    await makeTemplates(templatesDir);
    process.env.MEDHELP_SECURE_DISTRIBUTION = '1';
    process.env.MEDHELP_SKILLS_DIR = skillsDir;
    process.env.MEDHELP_TEMPLATES_DIR = templatesDir;

    const report = await assertKernelAssets();
    expect(report.ok).toBe(true);
  });
});
