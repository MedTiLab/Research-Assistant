import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadPiProjectContext } from '../pi-runtime/project-context.js';

let root;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-pi-context-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('Pi project context loader', () => {
  it('injects bundled MedHelp rules without exposing them as project context items', async () => {
    const context = await loadPiProjectContext(root);

    expect(context.prompt).toContain('<medhelp_system_rules>');
    expect(context.prompt).toContain('## Role');
    expect(context.prompt).toContain('Application runtime rule: `work-output/`');
    expect(context.prompt).toContain('generated through chat or automation');
    expect(context.prompt).toContain('</medhelp_system_rules>');
    expect(context.items).toEqual([]);
  });

  it('loads bounded project instructions from canonical files', async () => {
    await fs.writeFile(path.join(root, 'AGENTS.md'), '# Instructions\nStay in scope.\n');
    await fs.writeFile(path.join(root, 'README.md'), '# Project\nA useful project.\n');

    const context = await loadPiProjectContext(root);
    expect(context.items).toEqual([
      expect.objectContaining({ path: 'AGENTS.md', type: 'instructions', truncated: false }),
      expect.objectContaining({ path: 'README.md', type: 'project_description', truncated: false }),
    ]);
    expect(context.prompt).toContain('<medhelp_project_context>');
    expect(context.prompt).toContain('<medhelp_system_rules>');
    expect(context.prompt).toContain('Stay in scope.');
  });

  it('does not follow a project context symlink outside the project root', async () => {
    const outside = path.join(path.dirname(root), `${path.basename(root)}-outside.md`);
    const projectLink = path.join(root, 'AGENTS.md');
    await fs.writeFile(outside, 'OUTSIDE_CONTEXT_MUST_NOT_LOAD');
    await fs.symlink(outside, projectLink);
    try {
      const context = await loadPiProjectContext(root);
      expect(context.prompt).not.toContain('OUTSIDE_CONTEXT_MUST_NOT_LOAD');
      expect(context.items).toEqual([]);
    } finally {
      // Unlink explicitly before removing the temporary root. On Windows,
      // recursively removing a directory that still contains a symlink can
      // intermittently report ENOTEMPTY even though the target is external.
      await fs.unlink(projectLink).catch(() => {});
      await fs.rm(outside, { force: true });
    }
  });
});
