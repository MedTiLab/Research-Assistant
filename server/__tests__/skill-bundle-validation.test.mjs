import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  countSkillDirectories,
  countSkillDirectoriesSync,
  requirePositiveSkillCount,
} from '../../desktop/common/skillBundleValidation.mjs';

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => (
    fs.rm(root, { recursive: true, force: true })
  )));
});

async function createSkill(root, relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'SKILL.md'), `---\nname: ${path.basename(directory)}\n---\n`, 'utf8');
}

describe('dynamic skill bundle validation', () => {
  it('counts top-level and categorized skills without a fixed catalog size', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-skill-count-'));
    temporaryRoots.push(root);
    await createSkill(root, 'direct-skill');
    await createSkill(root, path.join('category', 'nested-skill'));
    await fs.mkdir(path.join(root, '.ignored', 'hidden-skill'), { recursive: true });
    await fs.writeFile(path.join(root, '.ignored', 'hidden-skill', 'SKILL.md'), '# ignored\n', 'utf8');

    expect(await countSkillDirectories(root)).toBe(2);
    expect(countSkillDirectoriesSync(root)).toBe(2);

    await createSkill(root, path.join('another-category', 'new-skill'));
    expect(await countSkillDirectories(root)).toBe(3);
    expect(countSkillDirectoriesSync(root)).toBe(3);
  });

  it('rejects missing and non-positive manifest counts', () => {
    expect(requirePositiveSkillCount('3')).toBe(3);
    expect(() => requirePositiveSkillCount(0)).toThrow(/positive integer/);
    expect(() => requirePositiveSkillCount(undefined)).toThrow(/positive integer/);
  });
});
