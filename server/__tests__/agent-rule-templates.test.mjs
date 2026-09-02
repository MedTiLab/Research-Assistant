import fs from 'fs/promises';
import path from 'path';
import { describe, expect, it } from 'vitest';

const templateDir = path.join(process.cwd(), 'server', 'templates');
const providerTemplates = ['AGENTS.md', 'CLAUDE.md'];

describe('provider research-secretary templates', () => {
  it.each(providerTemplates)('%s uses shared memory and a non-pipeline folder policy', async (filename) => {
    const content = await fs.readFile(path.join(templateDir, filename), 'utf8');

    expect(content).toContain('research management secretary');
    expect(content).toContain('`.medhelpsec/MEMORY.md`');
    expect(content).toContain('This is not a staged research pipeline');
    expect(content).toContain('Apart from `work-output/`, do not pre-create empty folders');
    expect(content).toContain('Application runtime rule: `work-output/`');
    expect(content).toContain('user-facing files generated through chat or automation');
    expect(content).toContain('AI-generated minutes and action items are drafts');
    expect(content).toContain('Do not fabricate references, data, results');
  });
});
