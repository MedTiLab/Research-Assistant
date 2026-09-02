import { describe, it, expect } from 'vitest';
import { classifySkillCatalogFileRequest } from '../../shared/skillCatalogVisibility.js';

describe('classifySkillCatalogFileRequest', () => {
  it('serves root-level catalog JSON as config', () => {
    expect(classifySkillCatalogFileRequest('skills-catalog-v2.json')).toBe('config');
    expect(classifySkillCatalogFileRequest('skill-tag-mapping.json')).toBe('config');
    expect(classifySkillCatalogFileRequest('stage-skill-map.json')).toBe('config');
  });

  it('serves SKILL.md as metadata only', () => {
    expect(classifySkillCatalogFileRequest('medhelp-deep-research/SKILL.md')).toBe('skill-metadata');
    expect(classifySkillCatalogFileRequest('library/foo/SKILL.md')).toBe('skill-metadata');
  });

  it('blocks skill body and internal files', () => {
    expect(classifySkillCatalogFileRequest('medhelp-deep-research/references/methodology.md')).toBe('blocked');
    expect(classifySkillCatalogFileRequest('medhelp-deep-research/scripts/run.py')).toBe('blocked');
    expect(classifySkillCatalogFileRequest('medhelp-deep-research/prompts/system.md')).toBe('blocked');
    expect(classifySkillCatalogFileRequest('some-skill/nested-config.json')).toBe('blocked');
  });

  it('blocks empty input', () => {
    expect(classifySkillCatalogFileRequest('')).toBe('blocked');
    expect(classifySkillCatalogFileRequest(null)).toBe('blocked');
  });
});
