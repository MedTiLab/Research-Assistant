import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { buildClaudeProjectInstructionAppend } from '../claude-sdk.js';

const tempRoots = [];
async function tmpProject() {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-proj-'));
  tempRoots.push(d);
  return d;
}
afterEach(async () => {
  for (const d of tempRoots.splice(0)) {
    await fs.rm(d, { recursive: true, force: true });
  }
});

describe('buildClaudeProjectInstructionAppend (B1 regression)', () => {
  it('injects the backend CLAUDE template when the project has no CLAUDE.md', async () => {
    const projectDir = await tmpProject();
    const append = await buildClaudeProjectInstructionAppend(projectDir);
    expect(append).toContain('# Project Instructions (CLAUDE.md)');
    expect(append).toContain('Application runtime rule: `work-output/`');
    expect(append).toContain('generated through chat or automation');
  });

  it('returns empty when the project already has CLAUDE.md (settingSources loads it)', async () => {
    const projectDir = await tmpProject();
    await fs.writeFile(path.join(projectDir, 'CLAUDE.md'), '# custom project rules', 'utf8');
    const append = await buildClaudeProjectInstructionAppend(projectDir);
    expect(append).toBe('');
  });

  it('returns empty for a null projectDir', async () => {
    expect(await buildClaudeProjectInstructionAppend(null)).toBe('');
  });
});
