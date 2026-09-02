import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureClaudeSkillPlugin } from '../utils/claudeSkillPlugin.js';
import { resolveCodexSkillDirs } from '../utils/codexSkillAccess.js';
import { resolveTrustedPiSkills } from '../pi-runtime/skill-projection.js';
import { resolveUserSkillsDir } from '../utils/storagePaths.js';

const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => (
    fs.rm(root, { recursive: true, force: true })
  )));
});

async function writeSkill(directory, name) {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: restart persistence fixture\n---\n`,
    'utf8',
  );
}

describe('user skill restart persistence', () => {
  it('reloads an installed user skill for Claude, Codex, and Pi from durable app data', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-user-skill-restart-'));
    temporaryRoots.push(root);
    const dataDir = path.join(root, 'data');
    const systemSkillsDir = path.join(root, 'system-skills');
    const userSkillsDir = resolveUserSkillsDir('account-7', { dataDir });
    const userSkillDir = path.join(userSkillsDir, 'durable-user-skill');
    const pluginDir = path.join(root, 'claude-plugin');

    await writeSkill(path.join(systemSkillsDir, 'system-skill'), 'system-skill');
    await writeSkill(userSkillDir, 'durable-user-skill');
    await fs.writeFile(
      path.join(userSkillsDir, 'stage-skill-map.json'),
      `${JSON.stringify({ skillOrigins: { 'durable-user-skill': 'market:test' } }, null, 2)}\n`,
      'utf8',
    );

    // Re-resolve every path and projection as a freshly started Kernel would.
    const restartedUserSkillsDir = resolveUserSkillsDir('account-7', { dataDir });
    const codexDirs = await resolveCodexSkillDirs('account-7', {
      systemSkillsDir,
      userSkillsDir: restartedUserSkillsDir,
    });
    await ensureClaudeSkillPlugin('account-7', {
      pluginDir,
      systemSkillsDir,
      userSkillsDir: restartedUserSkillsDir,
    });
    const piProjection = await resolveTrustedPiSkills({
      systemSkillsDir,
      userSkillsDir: restartedUserSkillsDir,
    });

    await expect(fs.access(path.join(userSkillDir, 'SKILL.md'))).resolves.toBeUndefined();
    expect(codexDirs).toContain(path.resolve(restartedUserSkillsDir));
    await expect(
      fs.access(path.join(pluginDir, 'skills', 'durable-user-skill', 'SKILL.md')),
    ).resolves.toBeUndefined();
    expect(piProjection.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'durable-user-skill', source: 'user' }),
    ]));
    expect(piProjection.diagnostics.filter((item) => item.source === 'user')).toEqual([]);
  });
});
