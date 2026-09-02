import { afterEach, describe, expect, it } from 'vitest';
import { access, lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { ensureProjectSkillLinks } from '../projects.js';
import { resolveUserSkillsDir } from '../utils/storagePaths.js';

let tempProjectDir = null;
let tempDataDir = null;

function expectPortableSymlinkTarget(linkPath, linkTarget) {
  const resolvedTarget = path.resolve(path.dirname(linkPath), linkTarget);
  const crossesWindowsVolume = process.platform === 'win32'
    && path.parse(linkPath).root.toLowerCase() !== path.parse(resolvedTarget).root.toLowerCase();
  expect(path.isAbsolute(linkTarget)).toBe(crossesWindowsVolume);
}

function normalizePathForAssertion(value) {
  return value.split(path.sep).join('/');
}

describe('project skill link bootstrap', () => {
  afterEach(async () => {
    if (tempProjectDir) {
      await rm(tempProjectDir, { recursive: true, force: true });
      tempProjectDir = null;
    }
    if (tempDataDir) {
      await rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = null;
      delete process.env.MEDHELP_DATA_DIR;
    }
    delete process.env.MEDHELP_EXPOSE_PROJECT_AGENT_ASSETS;
  });

  it('does not create a server-relative project from a decoded client drive path', async () => {
    await expect(ensureProjectSkillLinks('D/课题/公共/气候'))
      .rejects.toMatchObject({ code: 'NON_ABSOLUTE_PROJECT_PATH' });
  });

  it('does not expose root instruction files or provider skill directories by default', async () => {
    tempProjectDir = await mkdtemp(path.join(os.tmpdir(), 'medhelp-project-agent-links-'));

    await ensureProjectSkillLinks(tempProjectDir);

    for (const filename of ['AGENTS.md', 'CLAUDE.md', 'CODEX.md', 'GEMINI.md']) {
      const linkPath = path.join(tempProjectDir, filename);
      await expect(access(linkPath)).rejects.toMatchObject({ code: 'ENOENT' });
    }

    await expect(access(path.join(tempProjectDir, '.codex', 'skills'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(path.join(tempProjectDir, '.agents', 'skills'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(tempProjectDir, '.medhelpsec', 'MEMORY.md'), 'utf8')).toBe('# Project Memory\n\n');
    const visibleEntries = (await import('fs/promises')).readdir(tempProjectDir);
    expect((await visibleEntries).sort()).toEqual(['.medhelpsec', 'work-output']);
  });

  it('moves an existing root MEMORY.md into hidden project metadata', async () => {
    tempProjectDir = await mkdtemp(path.join(os.tmpdir(), 'medhelp-existing-memory-'));
    const memoryPath = path.join(tempProjectDir, 'MEMORY.md');
    await writeFile(memoryPath, '# Project Memory\n\n- Keep this decision.\n', 'utf8');

    await ensureProjectSkillLinks(tempProjectDir);

    await expect(access(memoryPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(tempProjectDir, '.medhelpsec', 'MEMORY.md'), 'utf8'))
      .toBe('# Project Memory\n\n- Keep this decision.\n');
  });

  it('migrates the interim .medhelp memory path to .medhelpsec', async () => {
    tempProjectDir = await mkdtemp(path.join(os.tmpdir(), 'medhelp-interim-memory-'));
    const interimDir = path.join(tempProjectDir, '.medhelp');
    await mkdir(interimDir);
    await writeFile(path.join(interimDir, 'MEMORY.md'), '# Interim\n\n- Preserve me.\n', 'utf8');

    await ensureProjectSkillLinks(tempProjectDir);

    await expect(access(interimDir)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(tempProjectDir, '.medhelpsec', 'MEMORY.md'), 'utf8'))
      .toBe('# Interim\n\n- Preserve me.\n');
  });

  it('never overwrites a current memory with a legacy root file', async () => {
    tempProjectDir = await mkdtemp(path.join(os.tmpdir(), 'medhelp-memory-conflict-'));
    await mkdir(path.join(tempProjectDir, '.medhelpsec'));
    await writeFile(path.join(tempProjectDir, '.medhelpsec', 'MEMORY.md'), '# Current\n', 'utf8');
    await writeFile(path.join(tempProjectDir, 'MEMORY.md'), '# Legacy\n', 'utf8');

    await ensureProjectSkillLinks(tempProjectDir);

    expect(await readFile(path.join(tempProjectDir, '.medhelpsec', 'MEMORY.md'), 'utf8')).toBe('# Current\n');
    expect(await readFile(path.join(tempProjectDir, 'MEMORY.md'), 'utf8')).toBe('# Legacy\n');
  });

  it('creates provider skill directories without adding Cursor artifacts', async () => {
    tempProjectDir = await mkdtemp(path.join(os.tmpdir(), 'medhelp-project-skills-'));

    await ensureProjectSkillLinks(tempProjectDir, { exposeAgentAssets: true });

    const codexSkillsDir = path.join(tempProjectDir, '.codex', 'skills');
    const agentsSkillsDir = path.join(tempProjectDir, '.agents', 'skills');
    const cursorDir = path.join(tempProjectDir, '.cursor');
    const linkedSkillPath = path.join(codexSkillsDir, 'peer-review');
    const linkedLibrarySkillPath = path.join(agentsSkillsDir, 'library', 'ukb-skill');
    const tagMappingPath = path.join(codexSkillsDir, 'skill-tag-mapping.json');

    const codexDirStats = await lstat(codexSkillsDir);
    const linkedSkillStats = await lstat(linkedSkillPath);
    const linkedLibrarySkillStats = await lstat(linkedLibrarySkillPath);
    const linkedSkillTarget = await readlink(linkedSkillPath);
    const linkedLibrarySkillTarget = await readlink(linkedLibrarySkillPath);
    const tagMappingTarget = await readlink(tagMappingPath);

    expect(codexDirStats.isDirectory()).toBe(true);
    expect(linkedSkillStats.isSymbolicLink()).toBe(true);
    expect(linkedLibrarySkillStats.isSymbolicLink()).toBe(true);
    expectPortableSymlinkTarget(linkedSkillPath, linkedSkillTarget);
    expectPortableSymlinkTarget(linkedLibrarySkillPath, linkedLibrarySkillTarget);
    expectPortableSymlinkTarget(tagMappingPath, tagMappingTarget);
    expect(normalizePathForAssertion(path.resolve(path.dirname(linkedSkillPath), linkedSkillTarget)))
      .toContain('/skills/peer-review');
    expect(normalizePathForAssertion(path.resolve(path.dirname(linkedLibrarySkillPath), linkedLibrarySkillTarget)))
      .toContain('/skills/ukb-skill');
    expect(normalizePathForAssertion(path.resolve(path.dirname(tagMappingPath), tagMappingTarget)))
      .toContain('/skills/skill-tag-mapping.json');
    for (const legacyPath of ['Literature', 'Ideation', 'Experiment', 'Publication', 'Promotion', 'instance.json']) {
      await expect(access(path.join(tempProjectDir, legacyPath))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    await expect(access(path.join(tempProjectDir, 'work-output'))).resolves.toBeUndefined();
    await expect(access(cursorDir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('leaves an existing legacy folder map unchanged', async () => {
    tempProjectDir = await mkdtemp(path.join(os.tmpdir(), 'medhelp-existing-project-'));
    const instancePath = path.join(tempProjectDir, 'instance.json');
    await writeFile(instancePath, JSON.stringify({
      instance_id: 'existing-project',
      Experiment: {
        analysis: path.join(tempProjectDir, 'Experiment', 'analysis'),
        figures: path.join(tempProjectDir, 'Experiment', 'figures'),
      },
      Publication: {},
    }), 'utf8');

    await ensureProjectSkillLinks(tempProjectDir);

    await expect(access(path.join(tempProjectDir, 'Experiment', 'tables'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(path.join(tempProjectDir, 'Experiment', 'attachments'))).rejects.toMatchObject({ code: 'ENOENT' });
    const instance = JSON.parse(await readFile(instancePath, 'utf8'));
    expect(instance.Experiment.tables).toBeUndefined();
    expect(instance.Experiment.attachments).toBeUndefined();
  });

  it('links current user skills into project provider skill directories', async () => {
    tempProjectDir = await mkdtemp(path.join(os.tmpdir(), 'medhelp-project-user-skills-'));
    tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'medhelp-data-user-skills-'));
    process.env.MEDHELP_DATA_DIR = tempDataDir;

    const userSkillsDir = resolveUserSkillsDir(42);
    const userSkillDir = path.join(userSkillsDir, 'custom-user-skill');
    await mkdir(userSkillDir, { recursive: true });
    await writeFile(
      path.join(userSkillDir, 'SKILL.md'),
      '---\nname: Custom User Skill\ndescription: User-owned test skill\n---\n\nUse only for this test.\n',
      'utf8',
    );

    await ensureProjectSkillLinks(tempProjectDir, { userId: 42, exposeAgentAssets: true });

    const codexSkillPath = path.join(tempProjectDir, '.codex', 'skills', 'custom-user-skill');
    const agentsSkillPath = path.join(tempProjectDir, '.agents', 'skills', 'library', 'custom-user-skill');
    const codexSkillTarget = await readlink(codexSkillPath);
    const agentsSkillTarget = await readlink(agentsSkillPath);

    expect(path.resolve(path.dirname(codexSkillPath), codexSkillTarget)).toBe(userSkillDir);
    expect(path.resolve(path.dirname(agentsSkillPath), agentsSkillTarget)).toBe(userSkillDir);
  });
});
