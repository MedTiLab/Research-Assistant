import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  decodeReportFileId,
  encodeReportFileId,
  isScannedReportRelativePath,
  scanProjectReportFiles,
} from '../utils/project-report-files.js';

const cleanupTargets = [];

async function createTempProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-report-scan-'));
  cleanupTargets.push(projectPath);
  return projectPath;
}

async function writeProjectFile(projectPath, relativePath, contents = '# report\n') {
  const absolute = path.join(projectPath, ...relativePath.split('/'));
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, contents, 'utf8');
  return absolute;
}

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('project report file scanning', () => {
  it('finds report documents across the scanned directories', async () => {
    const projectPath = await createTempProject();
    await writeProjectFile(projectPath, 'reports/stage-01.md');
    await writeProjectFile(projectPath, 'Publication/manuscript.docx');
    await writeProjectFile(projectPath, 'drafts/outline.tex');
    await writeProjectFile(projectPath, '.pipeline/docs/kb/notes/reading-note.md');

    const found = await scanProjectReportFiles(projectPath);
    const paths = found.map((item) => item.relativePath).sort();

    expect(paths).toEqual([
      '.pipeline/docs/kb/notes/reading-note.md',
      'Publication/manuscript.docx',
      'drafts/outline.tex',
      'reports/stage-01.md',
    ]);
    expect(found.every((item) => item.title && item.modifiedAt)).toBe(true);
  });

  it('ignores data files, plain text, unscanned directories, and hidden files', async () => {
    const projectPath = await createTempProject();
    await writeProjectFile(projectPath, 'reports/keep.md');
    await writeProjectFile(projectPath, 'reports/cohort.csv');
    await writeProjectFile(projectPath, 'reports/config.json');
    await writeProjectFile(projectPath, 'reports/scratch-output.txt');
    await writeProjectFile(projectPath, 'reports/.hidden.md');
    await writeProjectFile(projectPath, 'data/raw-notes.md');
    await writeProjectFile(projectPath, 'analysis/model.md');

    const paths = (await scanProjectReportFiles(projectPath)).map((item) => item.relativePath);

    expect(paths).toEqual(['reports/keep.md']);
  });

  it('walks nested report subdirectories', async () => {
    const projectPath = await createTempProject();
    await writeProjectFile(projectPath, 'Literature/reports/2026/q2/summary.md');

    const paths = (await scanProjectReportFiles(projectPath)).map((item) => item.relativePath);

    expect(paths).toEqual(['Literature/reports/2026/q2/summary.md']);
  });

  it('lists a file once even though the prefix list carries case variants', async () => {
    const projectPath = await createTempProject();
    await writeProjectFile(projectPath, 'Literature/reports/review.md');

    const found = await scanProjectReportFiles(projectPath);

    expect(found).toHaveLength(1);
  });

  it('sorts newest first', async () => {
    const projectPath = await createTempProject();
    const older = await writeProjectFile(projectPath, 'reports/older.md');
    const newer = await writeProjectFile(projectPath, 'reports/newer.md');
    await fs.utimes(older, new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'));
    await fs.utimes(newer, new Date('2026-06-01T00:00:00Z'), new Date('2026-06-01T00:00:00Z'));

    const paths = (await scanProjectReportFiles(projectPath)).map((item) => item.relativePath);

    expect(paths).toEqual(['reports/newer.md', 'reports/older.md']);
  });

  it('returns nothing for a project with no report directories', async () => {
    const projectPath = await createTempProject();
    await writeProjectFile(projectPath, 'src/index.js', 'console.log(1);\n');

    await expect(scanProjectReportFiles(projectPath)).resolves.toEqual([]);
  });

  it('round-trips a file id and rejects malformed ones', async () => {
    const id = encodeReportFileId('lung_cancer', 'reports/stage-01.md');

    expect(decodeReportFileId(id)).toEqual({
      projectName: 'lung_cancer',
      relativePath: 'reports/stage-01.md',
    });
    expect(decodeReportFileId('')).toBeNull();
    expect(decodeReportFileId('bm90LWEtdmFsaWQtaWQ')).toBeNull();
  });

  it('rejects paths that escape the scanned directories', () => {
    expect(isScannedReportRelativePath('reports/stage-01.md')).toBe(true);
    expect(isScannedReportRelativePath('Publication/paper.docx')).toBe(true);
    expect(isScannedReportRelativePath('reports/../../etc/passwd')).toBe(false);
    expect(isScannedReportRelativePath('src/index.js')).toBe(false);
    expect(isScannedReportRelativePath('')).toBe(false);
  });
});
