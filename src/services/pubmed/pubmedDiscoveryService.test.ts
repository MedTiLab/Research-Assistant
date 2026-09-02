import { describe, expect, it } from 'vitest';
import {
  hasExpandedCanonicalName,
  isAbbreviationExpansionSupported,
  mapLlmExtractionToCandidates,
  selectRefinementArticles,
} from './pubmedDiscoveryService';
import { rankPubMedArticlesForExtraction } from './pubmedDiscoveryPipeline';

describe('PubMed abbreviation safeguards', () => {
  it('recognizes a literal long-form expansion even when local normalization maps it back to the abbreviation', () => {
    expect(hasExpandedCanonicalName('SII', 'systemic immune-inflammation index')).toBe(true);
    expect(hasExpandedCanonicalName('SII', 'SII')).toBe(false);
  });

  it('accepts an expansion only when PubMed evidence contains the long form', () => {
    const expansion = 'systemic immune-inflammation index';
    expect(isAbbreviationExpansionSupported(
      'SII',
      expansion,
      'The systemic immune-inflammation index (SII) was calculated from blood counts.',
    )).toBe(true);
    expect(isAbbreviationExpansionSupported(
      'SII',
      expansion,
      'SII was calculated from blood counts.',
    )).toBe(false);
  });
});

const ARTICLES = [
  {
    pmid: '111',
    title: 'Association between the triglyceride-glucose index and cognitive decline in CHARLS',
    abstract: 'The triglyceride-glucose (TyG) index was calculated as ln[triglycerides x glucose / 2]. Higher values tracked faster decline.',
    journal: 'J Test',
    publicationDate: '2026-01-01',
  },
  {
    pmid: '222',
    title: 'Estimated glucose disposal rate predicts incident cardiovascular disease in UK Biobank',
    abstract: 'Estimated glucose disposal rate (eGDR) was derived from waist circumference, hypertension status, and HbA1c. eGDR was inversely associated with incident CVD.',
    journal: 'J Test',
    publicationDate: '2026-01-01',
  },
];

describe('abstract refinement selection', () => {
  it('sends high-scoring articles to the model even when the title rules found no seed', () => {
    const selected = selectRefinementArticles(rankPubMedArticlesForExtraction(ARTICLES), []);
    expect(selected.map((article) => article.pmid)).toEqual(['111', '222']);
  });
});

describe('model response grounding', () => {
  it('keeps a model candidate that the title rules missed but the article text supports', () => {
    const candidates = mapLlmExtractionToCandidates(
      {
        candidates: [{
          pmid: '222',
          raw_name: 'eGDR',
          canonical_name_guess: 'estimated glucose disposal rate',
          variable_type_guess: 'derived_index',
          evidence_sentence: 'Estimated glucose disposal rate (eGDR) was derived from waist circumference, hypertension status, and HbA1c.',
          confidence_score: 0.9,
        }],
      } as never,
      ARTICLES,
      'job',
      [{ pmid: '222', raw_name: 'HbA1c', canonical_name_guess: 'HbA1c' }],
    );

    expect(candidates.map((candidate) => candidate.raw_name)).toEqual(['eGDR']);
  });

  it('still drops a model candidate that appears nowhere in the article', () => {
    const candidates = mapLlmExtractionToCandidates(
      {
        candidates: [{
          pmid: '222',
          raw_name: 'Framingham risk score',
          canonical_name_guess: 'Framingham risk score',
          variable_type_guess: 'risk_score',
          evidence_sentence: 'Estimated glucose disposal rate (eGDR) was derived from waist circumference, hypertension status, and HbA1c.',
          confidence_score: 0.9,
        }],
      } as never,
      ARTICLES,
      'job',
      [{ pmid: '222', raw_name: 'HbA1c', canonical_name_guess: 'HbA1c' }],
    );

    expect(candidates).toEqual([]);
  });

  it('accepts a variable whose only verbatim evidence is the title', () => {
    const candidates = mapLlmExtractionToCandidates(
      {
        candidates: [{
          pmid: '111',
          raw_name: 'triglyceride-glucose index',
          canonical_name_guess: 'triglyceride-glucose index',
          variable_type_guess: 'derived_index',
          evidence_sentence: 'Association between the triglyceride-glucose index and cognitive decline in CHARLS',
          confidence_score: 0.8,
        }],
      } as never,
      ARTICLES,
      'job',
      [],
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].evidence_level).toBe('title_only');
  });
});
