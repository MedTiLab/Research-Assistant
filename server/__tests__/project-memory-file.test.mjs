import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { scanProjectReportFiles } from '../utils/project-report-files.js';
import { ensureProjectMemoryFile } from '../templates/index.js';

const cleanupTargets = [];

async function createTempProject() {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-memory-file-'));
  cleanupTargets.push(projectPath);
  return projectPath;
}

afterEach(async () => {
  while (cleanupTargets.length > 0) {
    const target = cleanupTargets.pop();
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe('project memory file', () => {
  it('lives in hidden MedHelpSec metadata', async () => {
    const projectPath = await createTempProject();
    await ensureProjectMemoryFile(projectPath);
    const memoryPath = path.join(projectPath, '.medhelpsec', 'MEMORY.md');
    await fs.writeFile(memoryPath, '# Project\n\n## 下一步\n- 跑 Cox 模型\n', 'utf8');

    const content = await fs.readFile(memoryPath, 'utf8');
    expect(content).toContain('跑 Cox 模型');
  });

  it('is not picked up by the report scan, so it never shows up twice', async () => {
    const projectPath = await createTempProject();
    await fs.mkdir(path.join(projectPath, '.medhelpsec'), { recursive: true });
    await fs.writeFile(path.join(projectPath, '.medhelpsec', 'MEMORY.md'), '# Project\n', 'utf8');
    await fs.mkdir(path.join(projectPath, 'reports'), { recursive: true });
    await fs.writeFile(path.join(projectPath, 'reports', 'stage-01.md'), '# Stage 1\n', 'utf8');

    const paths = (await scanProjectReportFiles(projectPath)).map((item) => item.relativePath);

    expect(paths).toEqual(['reports/stage-01.md']);
    expect(paths).not.toContain('.medhelpsec/MEMORY.md');
  });
});
