import { describe, expect, it } from 'vitest';
import { readFile } from 'fs/promises';
import path from 'path';

const TEMPLATE_DIR = path.resolve(process.cwd(), 'server', 'templates');
const TEMPLATE_FILES = ['AGENTS.md', 'CLAUDE.md'];

describe('project template file organization', () => {
  it.each(TEMPLATE_FILES)('%s keeps project folders clean and user-directed', async (templateFile) => {
    const content = await readFile(path.join(TEMPLATE_DIR, templateFile), 'utf8');

    expect(content).toContain('Reuse an existing relevant folder whenever possible');
    expect(content).toContain('Apart from `work-output/`, do not pre-create empty folders');
    expect(content).toContain('save it directly under `work-output/`');
    expect(content).toContain('do not move them into `work-output/`');
    expect(content).toContain('create only the smallest intuitive folder');
    expect(content).toContain('Do not create stage folders');
    expect(content).toContain('Do not write a Markdown report merely to prove');
    expect(content).toContain('Keep generated internal metadata under `.medhelpsec/`');

    expect(content).not.toContain('Literature/reports/');
    expect(content).not.toContain('Ideation/ideas/');
    expect(content).not.toContain('Experiment/analysis/');
    expect(content).not.toContain('Publication/manuscript/');
    expect(content).not.toContain('Promotion/slides/');
    expect(content).not.toContain('medhelp-pipeline-planner');
  });
});
