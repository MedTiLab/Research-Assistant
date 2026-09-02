import { describe, expect, it } from 'vitest';
import {
  LOCAL_DATABASE_ANALYSIS_SKILLS,
  LOCAL_DATABASE_EXTRACTION_SKILLS,
} from './localDatabaseExtractionSkills';
import {
  buildSkillWorkflowCategories,
  getPrimaryShortcutSkills,
  getSecondaryShortcutSkills,
  parseSkillWorkflowCategoryConfig,
  resolveSkillWorkflowCategoryKey,
  type SkillWorkflowCategoryKey,
} from './skillWorkflowCategories';

describe('resolveSkillWorkflowCategoryKey', () => {
  it('keeps low-level technical skill paths in Other unless explicitly mapped', () => {
    expect(resolveSkillWorkflowCategoryKey({
      name: 'autogpt',
      dirPath: 'agents/autogpt',
      summary: 'Autonomous workflow agent platform',
    })).toBe('other');

    expect(resolveSkillWorkflowCategoryKey({
      name: 'llama-cpp',
      dirPath: 'inference-serving/llama-cpp',
      summary: 'Runs LLM inference on local hardware',
    })).toBe('other');
  });

  it('uses explicit workflow assignments before fallback rules', () => {
    const assignments = new Map<string, SkillWorkflowCategoryKey>([
      ['custom-review-skill', 'paperReview'],
    ]);

    expect(resolveSkillWorkflowCategoryKey({
      name: 'custom-review-skill',
      summary: 'A specialized workflow utility',
      assignments,
    })).toBe('paperReview');
  });

  it('keeps built-in shortcut skills in their primary workflow category', () => {
    expect(resolveSkillWorkflowCategoryKey({ name: 'pubmed-database' })).toBe('literatureDatabases');
    expect(resolveSkillWorkflowCategoryKey({ name: 'citation-management' })).toBe('citationTrace');
    expect(resolveSkillWorkflowCategoryKey({ name: 'paper-analyzer' })).toBe('paperReading');
    expect(resolveSkillWorkflowCategoryKey({ name: 'research-news' })).toBe('researchMonitoring');
    expect(resolveSkillWorkflowCategoryKey({ name: 'statsmodels' })).toBe('statisticalModeling');
    expect(resolveSkillWorkflowCategoryKey({ name: 'medhelp-humanizer' })).toBe('paperPolishing');
  });

  it('keeps the literature review shortcut compact while splitting adjacent tools', () => {
    const categories = buildSkillWorkflowCategories(new Map<string, SkillWorkflowCategoryKey>([
      ['academic-researcher', 'deepLiteratureSearch'],
      ['openalex-database', 'literatureDatabases'],
      ['paper-finder', 'paperReading'],
    ]));

    const literatureReview = categories.find((category) => category.key === 'deepResearch');
    expect(literatureReview?.skills).toEqual([
      'literature-review',
      'pubmed-database',
      'real-literature-trace',
      'citation-management',
    ]);
    expect(getPrimaryShortcutSkills(literatureReview!)).toHaveLength(4);
    expect(getSecondaryShortcutSkills(literatureReview!)).toHaveLength(0);

    expect(categories.find((category) => category.key === 'deepLiteratureSearch')?.skills)
      .toContain('academic-researcher');
    expect(categories.find((category) => category.key === 'literatureDatabases')?.skills)
      .toContain('openalex-database');
    expect(categories.find((category) => category.key === 'paperReading')?.skills)
      .toContain('paper-finder');
  });

  it('puts the MedHelp database API skill first in database extraction shortcuts', () => {
    expect(LOCAL_DATABASE_EXTRACTION_SKILLS).toHaveLength(30);
    expect(LOCAL_DATABASE_EXTRACTION_SKILLS[0]).toBe('medhelp-database-api-access');
    expect(LOCAL_DATABASE_EXTRACTION_SKILLS).toContain('cfps-skill');
    expect(LOCAL_DATABASE_EXTRACTION_SKILLS).toContain('nhanes-skill');
    expect(LOCAL_DATABASE_EXTRACTION_SKILLS).toContain('mhas-skill');
    expect(LOCAL_DATABASE_EXTRACTION_SKILLS).toContain('mimiciii-skill');
    expect(LOCAL_DATABASE_EXTRACTION_SKILLS).toContain('mimiciv-skill');
    expect(LOCAL_DATABASE_EXTRACTION_SKILLS).toContain('mimiciv31-skill');
    expect(LOCAL_DATABASE_EXTRACTION_SKILLS).toContain('class-skill');
    expect(LOCAL_DATABASE_EXTRACTION_SKILLS).toContain('inspire-skill');
    expect(LOCAL_DATABASE_EXTRACTION_SKILLS).toContain('seer-skill');
    expect(LOCAL_DATABASE_EXTRACTION_SKILLS).toContain('sicdb-skill');

    const categories = buildSkillWorkflowCategories();
    const databaseAccess = categories.find((category) => category.key === 'databaseAccess');

    expect(databaseAccess?.skills[0]).toBe('medhelp-database-api-access');
    expect(getPrimaryShortcutSkills(databaseAccess!)).toEqual(['medhelp-database-api-access']);
  });

  it('merges baseline tables and database-specific analysis into data analysis', () => {
    const categories = buildSkillWorkflowCategories();
    const dataAnalysis = categories.find((category) => category.key === 'preAnalysis');

    expect(categories.some((category) => String(category.key) === 'baselineTable')).toBe(false);
    expect(dataAnalysis?.skills).toContain('baseline-table');
    expect(dataAnalysis?.skills).toEqual(expect.arrayContaining([...LOCAL_DATABASE_ANALYSIS_SKILLS]));
    expect(resolveSkillWorkflowCategoryKey({ name: 'gco-database-analysis' })).toBe('preAnalysis');
    const legacyConfig = parseSkillWorkflowCategoryConfig({
      skillCategories: { 'legacy-personal-skill': 'baselineTable' },
    });
    expect(resolveSkillWorkflowCategoryKey({
      name: 'legacy-personal-skill',
      assignments: legacyConfig.assignments,
    })).toBe('preAnalysis');
  });
});
