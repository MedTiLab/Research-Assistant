import { describe, expect, it } from 'vitest';

import {
  collectResearchArtifactFiles,
  countResearchStageArtifactsFromFileTree,
  shouldCollectResearchArtifact,
} from './researchStageArtifacts';

describe('research stage artifact helpers', () => {
  it('collects visible Ideation artifacts so stage progress can leave waiting state', () => {
    const projectRoot = '/Users/example/project';
    const tree = [
      {
        name: 'Ideation',
        type: 'directory',
        relativePath: 'Ideation',
        children: [
          {
            name: 'ideas',
            type: 'directory',
            relativePath: 'Ideation/ideas',
            children: [
              {
                name: 'selected_idea.txt',
                type: 'file',
                absolutePath: `${projectRoot}/Ideation/ideas/selected_idea.txt`,
              },
            ],
          },
        ],
      },
    ];

    expect(shouldCollectResearchArtifact('Ideation/ideas/selected_idea.txt')).toBe(true);
    expect(collectResearchArtifactFiles(tree, projectRoot)).toEqual([
      {
        name: 'selected_idea.txt',
        relativePath: 'Ideation/ideas/selected_idea.txt',
        absolutePath: `${projectRoot}/Ideation/ideas/selected_idea.txt`,
      },
    ]);
    expect(countResearchStageArtifactsFromFileTree(tree, projectRoot).ideation).toBe(1);
  });

  it('counts visible Experiment outputs as experiment-stage artifacts', () => {
    const tree = [
      {
        name: 'Experiment',
        type: 'directory',
        relativePath: 'Experiment',
        children: [
          {
            name: 'tables',
            type: 'directory',
            relativePath: 'Experiment/tables',
            children: [
              {
                name: 'baseline-table.csv',
                type: 'file',
                relativePath: 'Experiment/tables/baseline-table.csv',
              },
            ],
          },
          {
            name: 'figures',
            type: 'directory',
            relativePath: 'Experiment/figures',
            children: [
              {
                name: '01_survival_curve.png',
                type: 'file',
                relativePath: 'Experiment/figures/01_survival_curve.png',
              },
            ],
          },
          {
            name: 'attachments',
            type: 'directory',
            relativePath: 'Experiment/attachments',
            children: [
              {
                name: 'run-manifest.zip',
                type: 'file',
                relativePath: 'Experiment/attachments/run-manifest.zip',
              },
            ],
          },
        ],
      },
    ];

    const counts = countResearchStageArtifactsFromFileTree(tree);

    expect(shouldCollectResearchArtifact('Experiment/tables/baseline-table.csv')).toBe(true);
    expect(shouldCollectResearchArtifact('Experiment/figures/01_survival_curve.png')).toBe(true);
    expect(shouldCollectResearchArtifact('Experiment/attachments/run-manifest.zip')).toBe(true);
    expect(counts.experiment).toBe(3);
  });

  it('ignores operating-system metadata in empty publication and promotion stages', () => {
    const tree = [
      {
        name: 'Experiment',
        type: 'directory',
        relativePath: 'Experiment',
        children: [
          {
            name: 'results.csv',
            type: 'file',
            relativePath: 'Experiment/tables/results.csv',
          },
        ],
      },
      {
        name: 'Publication',
        type: 'directory',
        relativePath: 'Publication',
        children: [
          {
            name: '.DS_Store',
            type: 'file',
            relativePath: 'Publication/.DS_Store',
          },
        ],
      },
      {
        name: 'Promotion',
        type: 'directory',
        relativePath: 'Promotion',
        children: [
          {
            name: '.DS_Store',
            type: 'file',
            relativePath: 'Promotion/.DS_Store',
          },
          {
            name: 'Thumbs.db',
            type: 'file',
            relativePath: 'Promotion/Thumbs.db',
          },
        ],
      },
    ];

    const counts = countResearchStageArtifactsFromFileTree(tree);

    expect(shouldCollectResearchArtifact('Publication/.DS_Store')).toBe(false);
    expect(shouldCollectResearchArtifact('Promotion/Thumbs.db')).toBe(false);
    expect(counts.experiment).toBe(1);
    expect(counts.publication).toBe(0);
    expect(counts.promotion).toBe(0);
  });
});
