import { describe, expect, it } from 'vitest';

import { flattenSurveyFiles } from './useSurveyData';

describe('flattenSurveyFiles', () => {
  it('keeps Zotero-generated reference internals out of literature notes', () => {
    const projectRoot = '/workspace/demo';
    const tree: Parameters<typeof flattenSurveyFiles>[0] = [
      {
        name: 'Literature',
        type: 'directory',
        children: [
          {
            name: 'references',
            type: 'directory',
            children: [
              {
                name: 'zotero-ref',
                type: 'directory',
                children: [
                  {
                    name: 'metadata.json',
                    type: 'file',
                    path: `${projectRoot}/Literature/references/zotero-ref/metadata.json`,
                  },
                  {
                    name: 'note.md',
                    type: 'file',
                    path: `${projectRoot}/Literature/references/zotero-ref/note.md`,
                  },
                  {
                    name: 'extract.txt',
                    type: 'file',
                    path: `${projectRoot}/Literature/references/zotero-ref/extract.txt`,
                  },
                  {
                    name: 'paper.pdf',
                    type: 'file',
                    path: `${projectRoot}/Literature/references/zotero-ref/paper.pdf`,
                  },
                  {
                    name: 'reading-summary.md',
                    type: 'file',
                    path: `${projectRoot}/Literature/references/zotero-ref/reading-summary.md`,
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    const files = flattenSurveyFiles(tree, projectRoot);
    const relativePaths = files.map((file) => file.relativePath);

    expect(relativePaths).not.toContain('Literature/references/zotero-ref/metadata.json');
    expect(relativePaths).not.toContain('Literature/references/zotero-ref/note.md');
    expect(relativePaths).not.toContain('Literature/references/zotero-ref/extract.txt');
    expect(relativePaths).toContain('Literature/references/zotero-ref/paper.pdf');
    expect(relativePaths).toContain('Literature/references/zotero-ref/reading-summary.md');
    expect(files.find((file) => file.name === 'reading-summary.md')?.category).toBe('notes');
  });
});
