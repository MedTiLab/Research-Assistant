import { describe, expect, it } from 'vitest';

import { collectSkillDirectories, type SkillNode } from './skillsTree';

describe('skills tree utilities', () => {
  it('counts skill directories instead of de-duping by mention name', () => {
    const tree: SkillNode[] = [
      {
        name: 'document-skills',
        path: '/repo/skills/document-skills',
        type: 'directory',
        children: [
          {
            name: 'docx',
            path: '/repo/skills/document-skills/docx',
            type: 'directory',
            children: [{ name: 'SKILL.md', path: '/repo/skills/document-skills/docx/SKILL.md', type: 'file' }],
          },
        ],
      },
      {
        name: 'docx',
        path: '/repo/skills/docx',
        type: 'directory',
        children: [{ name: 'SKILL.md', path: '/repo/skills/docx/SKILL.md', type: 'file' }],
      },
      {
        name: 'scripts',
        path: '/repo/skills/scripts',
        type: 'directory',
        children: [{ name: 'SKILL.md', path: '/repo/skills/scripts/SKILL.md', type: 'file' }],
      },
    ];

    const skillDirectories = collectSkillDirectories(tree);

    expect(skillDirectories.map((node) => node.path)).toEqual([
      '/repo/skills/document-skills/docx',
      '/repo/skills/docx',
    ]);
  });
});
