import { describe, expect, it } from 'vitest';

import {
  collectProjectImageFiles,
  isProjectImageFileName,
  isTiffImageFileName,
} from './projectImageGallery';

describe('project image gallery helpers', () => {
  it('recursively collects browser images and TIFF files from the complete project tree', () => {
    const projectRoot = '/Users/example/project';
    const tree = [
      {
        name: 'Experiment',
        type: 'directory',
        children: [
          {
            name: 'figures',
            type: 'directory',
            children: [
              {
                name: 'figure-2.png',
                type: 'file',
                path: `${projectRoot}/Experiment/figures/figure-2.png`,
              },
              {
                name: 'figure-10.webp',
                type: 'file',
                relativePath: 'Experiment/figures/figure-10.webp',
              },
              {
                name: 'microscopy.tiff',
                type: 'file',
                relativePath: 'Experiment/figures/microscopy.tiff',
              },
              {
                name: 'notes.md',
                type: 'file',
                relativePath: 'Experiment/figures/notes.md',
              },
            ],
          },
        ],
      },
      {
        name: 'cover.avif',
        type: 'file',
        relativePath: 'Publication/cover.avif',
        absolutePath: `${projectRoot}/Publication/cover.avif`,
      },
    ];

    expect(isProjectImageFileName('diagram.SVG')).toBe(true);
    expect(isProjectImageFileName('slide.TIF')).toBe(true);
    expect(isTiffImageFileName('slide.TIF')).toBe(true);
    expect(isProjectImageFileName('analysis.csv')).toBe(false);
    expect(collectProjectImageFiles(tree, projectRoot)).toEqual([
      {
        name: 'figure-2.png',
        relativePath: 'Experiment/figures/figure-2.png',
        absolutePath: `${projectRoot}/Experiment/figures/figure-2.png`,
        folder: 'Experiment/figures',
      },
      {
        name: 'figure-10.webp',
        relativePath: 'Experiment/figures/figure-10.webp',
        absolutePath: null,
        folder: 'Experiment/figures',
      },
      {
        name: 'microscopy.tiff',
        relativePath: 'Experiment/figures/microscopy.tiff',
        absolutePath: null,
        folder: 'Experiment/figures',
      },
      {
        name: 'cover.avif',
        relativePath: 'Publication/cover.avif',
        absolutePath: `${projectRoot}/Publication/cover.avif`,
        folder: 'Publication',
      },
    ]);
  });
});
