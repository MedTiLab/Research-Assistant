import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  writeProjectInstructionLinks,
  cleanupGeneratedProjectAgentAssets,
} from '../templates/index.js';

const tempRoots = [];
async function tmpProject() {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-instr-'));
  tempRoots.push(d);
  return d;
}
afterEach(async () => {
  for (const d of tempRoots.splice(0)) {
    await fs.rm(d, { recursive: true, force: true });
  }
});

describe('cleanupGeneratedProjectAgentAssets removes generated instruction symlinks', () => {
  it('deletes generated AGENTS/CLAUDE/CODEX symlinks pointing into .medhelp-agent-rules', async () => {
    const projectDir = await tmpProject();
    await writeProjectInstructionLinks(projectDir);

    for (const name of ['AGENTS.md', 'CLAUDE.md', 'CODEX.md']) {
      const st = await fs.lstat(path.join(projectDir, name));
      expect(st.isSymbolicLink()).toBe(true);
    }

    await cleanupGeneratedProjectAgentAssets(projectDir);

    for (const name of ['AGENTS.md', 'CLAUDE.md', 'CODEX.md']) {
      await expect(fs.lstat(path.join(projectDir, name))).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('does not delete a real user-authored AGENTS.md', async () => {
    const projectDir = await tmpProject();
    await fs.writeFile(path.join(projectDir, 'AGENTS.md'), '# my own notes', 'utf8');
    await cleanupGeneratedProjectAgentAssets(projectDir);
    expect(await fs.readFile(path.join(projectDir, 'AGENTS.md'), 'utf8')).toBe('# my own notes');
  });
});
