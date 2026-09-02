import { describe, expect, it } from 'vitest';
import type { PubMedVariableCandidate } from '../../features/variableKnowledge/pubmedDiscovery/types';
import {
  aggregatePubMedCandidates,
  extractAbstractEvidenceWindow,
  isVerbatimEvidence,
  scorePubMedArticleForVariableDiscovery,
} from './pubmedDiscoveryPipeline';
import { buildPubMedNewsSearchConfig, PUBMED_SEARCH_RESULT_LIMIT } from './pubmedQueryBuilder';

function article(overrides: Partial<Parameters<typeof scorePubMedArticleForVariableDiscovery>[0]> = {}) {
  return {
    pmid: '12345678',
    title: 'Systemic immune-inflammation index in NHANES',
    abstract: 'The systemic immune-inflammation index was calculated from platelet, neutrophil, and lymphocyte counts.',
    journal: 'Example Journal',
    ...overrides,
  };
}

function candidate(overrides: Partial<PubMedVariableCandidate> = {}): PubMedVariableCandidate {
  const pmid = overrides.pmid || '12345678';
  const now = '2026-08-23T00:00:00.000Z';
  return {
    id: `candidate_${pmid}`,
    job_id: 'job_test',
    pmid,
    title: 'Systemic immune-inflammation index in NHANES',
    abstract: 'The systemic immune-inflammation index (SII) was calculated from blood counts.',
    journal: 'Example Journal',
    raw_name: 'SII',
    canonical_name_guess: 'SII',
    display_name_zh_guess: '系统免疫炎症指数',
    display_name_en_guess: 'SII',
    variable_type_guess: 'derived_index',
    database_family_guess: ['NHANES'],
    clinical_domain_guess: [],
    role_guess: ['候选变量'],
    evidence_sentence: 'Systemic immune-inflammation index in NHANES.',
    confidence_score: 0.72,
    match_status: 'new',
    review_status: 'pending',
    extraction_source: 'rule_based',
    extraction_stage: 'rule_based',
    evidence_level: 'title_only',
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('PubMed local pre-screen pipeline', () => {
  it('returns enough PubMed records for local scoring without increasing LLM volume', () => {
    const config = buildPubMedNewsSearchConfig({
      frequency: 'weekly',
      dateFrom: '2026-08-16',
      dateTo: '2026-08-23',
      queryMode: 'broad',
    });

    expect(config.top_n).toBe(PUBMED_SEARCH_RESULT_LIMIT);
    expect(config.top_n).toBe(100);
  });

  it('prioritizes named database-derived metrics over endpoint statistics', () => {
    const metric = scorePubMedArticleForVariableDiscovery(article(), { variableKeyword: 'inflammation' });
    const endpoint = scorePubMedArticleForVariableDiscovery(article({
      title: 'Mortality after hospitalization: HR and confidence interval results',
      abstract: 'Mortality was the endpoint.',
    }), { variableKeyword: 'inflammation' });

    expect(metric.score).toBeGreaterThanOrEqual(8);
    expect(endpoint.score).toBeLessThan(0);
  });

  it('keeps at most three nearby abstract sentences and respects the character budget', () => {
    const evidence = extractAbstractEvidenceWindow(article({
      abstract: [
        'This cohort included adults.',
        'The systemic immune-inflammation index (SII) was calculated from blood counts.',
        'Higher SII reflected systemic inflammation.',
        'Mortality was evaluated separately.',
      ].join(' '),
    }), [{ pmid: '12345678', raw_name: 'SII', canonical_name_guess: 'systemic immune-inflammation index' }], 180);

    expect(evidence).toContain('systemic immune-inflammation index');
    expect(evidence.length).toBeLessThanOrEqual(180);
    expect(evidence).not.toContain('Mortality was evaluated separately');
  });

  it('keeps the defining sentence when the seed is mentioned both early and late', () => {
    const evidence = extractAbstractEvidenceWindow(article({
      abstract: [
        'We examined whether SII predicts frailty.',
        'Baseline demographics were collected by trained interviewers.',
        'Blood samples were drawn after an overnight fast.',
        'Covariates were self-reported.',
        'The systemic immune-inflammation index (SII) was calculated as platelet x neutrophil / lymphocyte.',
        'Higher SII reflected systemic inflammation.',
      ].join(' '),
    }), [{ pmid: '12345678', raw_name: 'SII', canonical_name_guess: 'systemic immune-inflammation index' }]);

    expect(evidence).toContain('platelet x neutrophil / lymphocyte');
  });

  it('falls back to the opening sentences when nothing in the abstract looks relevant', () => {
    const evidence = extractAbstractEvidenceWindow(article({
      abstract: 'Participants were recruited in 2019. Follow-up continued until 2024. Attrition was low. Results are reported elsewhere.',
    }), []);

    expect(evidence).toContain('Participants were recruited in 2019.');
    expect(evidence).toContain('Attrition was low.');
    expect(evidence).not.toContain('Results are reported elsewhere.');
  });

  it('aggregates one variable across PMIDs and prefers abstract-supported evidence', () => {
    const aggregated = aggregatePubMedCandidates([
      candidate({ pmid: '11111111' }),
      candidate({ pmid: '22222222' }),
      candidate({
        pmid: '33333333',
        canonical_name_guess: 'systemic immune-inflammation index',
        display_name_en_guess: 'systemic immune-inflammation index',
        evidence_sentence: 'The systemic immune-inflammation index (SII) was calculated from blood counts.',
        confidence_score: 0.94,
        extraction_source: 'abstract',
        extraction_stage: 'abstract_verified',
        evidence_level: 'abstract_supported',
      }),
    ]);

    expect(aggregated).toHaveLength(1);
    expect(aggregated[0].evidence_articles).toHaveLength(3);
    expect(aggregated[0].extraction_stage).toBe('abstract_verified');
    expect(aggregated[0].confidence_score).toBe(0.94);
  });

  it('keeps a formula found on any PMID when merging one variable across articles', () => {
    const aggregated = aggregatePubMedCandidates([
      candidate({
        pmid: '11111111',
        confidence_score: 0.94,
        extraction_stage: 'abstract_verified',
        evidence_level: 'abstract_supported',
      }),
      candidate({
        pmid: '22222222',
        confidence_score: 0.72,
        formula_text: 'platelet x neutrophil / lymphocyte',
        extraction_stage: 'abstract_verified',
        evidence_level: 'abstract_supported',
      }),
    ]);

    expect(aggregated).toHaveLength(1);
    expect(aggregated[0].formula_text).toBe('platelet x neutrophil / lymphocyte');
  });

  it('rejects paraphrased evidence that is not verbatim', () => {
    const source = article();
    expect(isVerbatimEvidence('The systemic immune-inflammation index was calculated from platelet, neutrophil, and lymphocyte counts.', source)).toBe(true);
    expect(isVerbatimEvidence('SII was probably derived from several immune cells.', source)).toBe(false);
  });
});
