import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdmZip from 'adm-zip';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

const originalMaxFileBytes = process.env.WORKSPACE_ARCHIVE_MAX_FILE_BYTES;

let tempRoot = null;

async function loadArchiveHelpers() {
  vi.resetModules();
  return import('../routes/projects.js');
}

describe('workspace archive filtering', () => {
  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'medhelp-archive-'));
    process.env.WORKSPACE_ARCHIVE_MAX_FILE_BYTES = '10';
  });

  afterEach(async () => {
    vi.resetModules();

    if (originalMaxFileBytes === undefined) delete process.env.WORKSPACE_ARCHIVE_MAX_FILE_BYTES;
    else process.env.WORKSPACE_ARCHIVE_MAX_FILE_BYTES = originalMaxFileBytes;

    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('classifies symlinks, raw-data paths, model memory files, root files, and large files as excluded', async () => {
    const { classifyWorkspaceArchiveEntry } = await loadArchiveHelpers();

    expect(classifyWorkspaceArchiveEntry('Literature/reports/summary.md', { size: 10 })).toMatchObject({ include: true });
    expect(classifyWorkspaceArchiveEntry('README.md', { size: 1 })).toMatchObject({ include: false, reason: 'root_file' });
    expect(classifyWorkspaceArchiveEntry('AGENTS.md', { size: 1 })).toMatchObject({ include: false, reason: 'protected_agent_assets' });
    expect(classifyWorkspaceArchiveEntry('.medhelpsec/MEMORY.md', { size: 1 })).toMatchObject({ include: false, reason: 'protected_agent_assets' });
    expect(classifyWorkspaceArchiveEntry('Literature/reports/CLAUDE.md', { size: 1 })).toMatchObject({ include: false, reason: 'protected_agent_assets' });
    expect(classifyWorkspaceArchiveEntry('Experiment/analysis/working-summary.md', { size: 1 })).toMatchObject({ include: false, reason: 'model_memory' });
    expect(classifyWorkspaceArchiveEntry('linked-data', { isSymbolicLink: true })).toMatchObject({ include: false, reason: 'symbolic_link' });
    expect(classifyWorkspaceArchiveEntry('Literature/reports/data-link.csv', { isSymbolicLink: true })).toMatchObject({ include: false, reason: 'symbolic_link' });
    expect(classifyWorkspaceArchiveEntry('Experiment/raw_data/data.csv', { size: 1 })).toMatchObject({ include: false, reason: 'raw_data' });
    expect(classifyWorkspaceArchiveEntry('Experiment/analysis/large-output.txt', { size: 11 })).toMatchObject({ include: false, reason: 'large_file' });
  });

  it('does not follow symlinks or include raw-data and oversized files in archives', async () => {
    const {
      addWorkspaceArchiveEntries,
      buildWorkspaceArchiveExclusionNotice,
    } = await loadArchiveHelpers();
    const projectRoot = path.join(tempRoot, 'project');
    const reportsDir = path.join(projectRoot, 'Literature', 'reports');
    const analysisDir = path.join(projectRoot, 'Experiment', 'analysis');
    const rawDataDir = path.join(projectRoot, 'Experiment', 'raw_data');
    await mkdir(reportsDir, { recursive: true });
    await mkdir(analysisDir, { recursive: true });
    await mkdir(rawDataDir, { recursive: true });
    await writeFile(path.join(reportsDir, 'summary.md'), 'summary', 'utf8');
    await writeFile(path.join(reportsDir, 'AGENTS.md'), 'agent memory', 'utf8');
    await writeFile(path.join(analysisDir, 'small.txt'), 'small', 'utf8');
    await writeFile(path.join(analysisDir, 'working-summary.md'), 'memory', 'utf8');
    await writeFile(path.join(analysisDir, 'large.txt'), 'larger than ten bytes', 'utf8');
    await writeFile(path.join(rawDataDir, 'patients.csv'), 'id\n1\n', 'utf8');

    const linkedTarget = path.join(tempRoot, 'external-raw.csv');
    const linkedPath = path.join(reportsDir, 'linked-raw.csv');
    await writeFile(linkedTarget, 'external raw data', 'utf8');
    let symlinkCreated = false;
    try {
      await symlink(linkedTarget, linkedPath);
      symlinkCreated = true;
    } catch {
      symlinkCreated = false;
    }

    const archive = new AdmZip();
    const skippedEntries = [];
    await addWorkspaceArchiveEntries(archive, projectRoot, '', {
      skippedEntries,
      maxFileBytes: 10,
    });

    const archivePaths = archive.getEntries().map((entry) => entry.entryName);
    expect(archivePaths).toContain('Literature/reports/summary.md');
    expect(archivePaths).toContain('Experiment/analysis/small.txt');
    expect(archivePaths).not.toContain('Literature/reports/AGENTS.md');
    expect(archivePaths).not.toContain('Experiment/analysis/working-summary.md');
    expect(archivePaths).not.toContain('Experiment/analysis/large.txt');
    expect(archivePaths).not.toContain('Experiment/raw_data/');
    expect(archivePaths).not.toContain('Experiment/raw_data/patients.csv');
    if (symlinkCreated) {
      expect(archivePaths).not.toContain('Literature/reports/linked-raw.csv');
      expect(skippedEntries).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: 'Literature/reports/linked-raw.csv', reason: 'symbolic_link' }),
      ]));
    }
    expect(skippedEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'Literature/reports/AGENTS.md', reason: 'protected_agent_assets' }),
      expect.objectContaining({ path: 'Experiment/analysis/working-summary.md', reason: 'model_memory' }),
      expect.objectContaining({ path: 'Experiment/analysis/large.txt', reason: 'large_file' }),
      expect.objectContaining({ path: 'Experiment/raw_data', reason: 'raw_data' }),
    ]));

    const notice = buildWorkspaceArchiveExclusionNotice(skippedEntries, { maxFileBytes: 10 });
    expect(notice).toContain('Experiment/raw_data');
    expect(notice).toContain('model memory/context file');
    expect(notice).toContain('larger than 10 B');
  });
});
