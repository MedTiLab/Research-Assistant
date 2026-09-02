import { describe, expect, it } from 'vitest';
import type { PubMedVariableCandidate } from './types';
import { findRelatedCandidates } from './candidateRelations';

function candidate(overrides: Partial<PubMedVariableCandidate> = {}): PubMedVariableCandidate {
  const now = '2026-08-23T00:00:00.000Z';
  return {
    id: 'c1',
    job_id: 'job',
    pmid: '1',
    title: 't',
    journal: 'j',
    raw_name: 'TyG',
    canonical_name_guess: 'TyG',
    display_name_zh_guess: '甘油三酯葡萄糖指数',
    display_name_en_guess: 'triglyceride-glucose index',
    variable_type_guess: 'derived_index',
    database_family_guess: ['NHANES'],
    clinical_domain_guess: [],
    role_guess: [],
    evidence_sentence: 's',
    confidence_score: 0.8,
    match_status: 'new',
    review_status: 'pending',
    extraction_source: 'abstract',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('candidate relatedness', () => {
  const subject = candidate();

  it('relates candidates that share a meaningful name word', () => {
    const related = findRelatedCandidates(subject, [
      subject,
      candidate({ id: 'c2', raw_name: 'TyG-BMI', canonical_name_guess: 'TyG-BMI', display_name_en_guess: 'triglyceride-glucose BMI index', database_family_guess: [] }),
    ]);

    expect(related.map((item) => item.name)).toEqual(['triglyceride-glucose BMI index']);
    expect(related[0].reasons.join(' ')).toContain('共享名称词');
  });

  it('does not relate two candidates that only share a generic word like index', () => {
    const related = findRelatedCandidates(subject, [
      candidate({ id: 'c3', raw_name: 'DII', canonical_name_guess: 'DII', display_name_en_guess: 'dietary inflammatory index', database_family_guess: [] }),
    ]);

    expect(related).toEqual([]);
  });

  it('relates candidates found in the same database', () => {
    const related = findRelatedCandidates(subject, [
      candidate({ id: 'c4', raw_name: 'DII', canonical_name_guess: 'DII', display_name_en_guess: 'dietary inflammatory index', database_family_guess: ['NHANES'] }),
    ]);

    expect(related[0].reasons.join(' ')).toContain('同数据库：NHANES');
  });

  it('never relates a candidate to itself', () => {
    expect(findRelatedCandidates(subject, [subject])).toEqual([]);
  });
});
