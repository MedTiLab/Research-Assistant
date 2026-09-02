import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  customizeUserSkillDocument,
  resolveUserSkillExtractionPath,
} from '../utils/userSkillFiles.js';

describe('custom user skill files', () => {
  it('overrides user-editable metadata while preserving instructions and unknown frontmatter', () => {
    const output = customizeUserSkillDocument(
      '---\nname: original\ndescription: Original\nlicense: MIT\n---\n# Keep these instructions\n',
      { name: 'custom-skill', description: 'User supplied description' },
    );
    expect(output).toContain('name: custom-skill');
    expect(output).toContain('description: User supplied description');
    expect(output).toContain('license: MIT');
    expect(output).toContain('# Keep these instructions');
  });

  it('keeps extraction inside the private staging directory', () => {
    const root = path.resolve('/tmp/private-user-skill');
    expect(resolveUserSkillExtractionPath(root, 'references/guide.md')).toBe(
      path.join(root, 'references', 'guide.md'),
    );
    expect(resolveUserSkillExtractionPath(root, '../private-user-skill-copy/payload')).toBeNull();
  });
});
