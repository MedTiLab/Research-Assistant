import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { cleanupProject } from '../routes/agent.js';

const cleanupRoots = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(cleanupRoots.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

describe('external agent cleanup', () => {
  it('removes a cloned project only when it is under an allowed external root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'medhelp-agent-cleanup-'));
    cleanupRoots.push(root);
    const allowedRoot = path.join(root, 'external-projects');
    const projectPath = path.join(allowedRoot, 'project');
    const outsidePath = path.join(root, 'keep-project');
    await mkdir(projectPath, { recursive: true });
    await mkdir(outsidePath, { recursive: true });
    await writeFile(path.join(projectPath, 'README.md'), 'temporary');

    await cleanupProject({
      projectPath,
      provider: 'codex',
      sessionId: 'codex-session',
      allowedExternalRoot: allowedRoot,
    });
    await cleanupProject({
      projectPath: outsidePath,
      provider: 'claude',
      sessionId: null,
      allowedExternalRoot: allowedRoot,
    });

    await expect(stat(projectPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(outsidePath)).resolves.toBeTruthy();
  });

  it('refuses to remove the external root itself', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'medhelp-agent-cleanup-root-'));
    cleanupRoots.push(root);
    const allowedRoot = path.join(root, 'external-projects');
    await mkdir(allowedRoot, { recursive: true });

    await cleanupProject({
      projectPath: allowedRoot,
      provider: 'codex',
      allowedExternalRoot: allowedRoot,
    });

    await expect(stat(allowedRoot)).resolves.toBeTruthy();
  });

  it('never guesses a Codex session path while retaining legacy Claude cleanup', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'medhelp-agent-cleanup-calls-'));
    cleanupRoots.push(root);
    const removeSpy = vi.spyOn(fs, 'rm').mockResolvedValue();

    await cleanupProject({
      projectPath: path.join(root, 'codex-project'),
      provider: 'codex',
      sessionId: 'codex-session',
      allowedExternalRoot: root,
    });
    expect(removeSpy).toHaveBeenCalledTimes(1);

    removeSpy.mockClear();
    await cleanupProject({
      projectPath: path.join(root, 'claude-project'),
      provider: 'claude',
      sessionId: 'claude-session',
      allowedExternalRoot: root,
    });
    expect(removeSpy).toHaveBeenCalledTimes(2);
    expect(removeSpy.mock.calls[1][0]).toBe(path.join(os.homedir(), '.claude', 'sessions', 'claude-session'));
  });

  it('refuses a Claude session id that escapes the legacy session root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'medhelp-agent-cleanup-session-'));
    cleanupRoots.push(root);
    const removeSpy = vi.spyOn(fs, 'rm').mockResolvedValue();

    await cleanupProject({
      projectPath: path.join(root, 'claude-project'),
      provider: 'claude',
      sessionId: '../../do-not-delete',
      allowedExternalRoot: root,
    });

    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith(path.join(root, 'claude-project'), {
      recursive: true,
      force: true,
    });
  });
});
