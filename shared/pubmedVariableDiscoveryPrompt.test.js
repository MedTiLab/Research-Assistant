import { describe, expect, it } from 'vitest';
import {
  buildPubMedExtractionPromptBatches,
  buildPubMedVariableExtractionPrompt,
  estimatePubMedPromptTokens,
} from './pubmedVariableDiscoveryPrompt.js';

const articles = [
  { pmid: '1', title: 'TyG index in NHANES', abstract: 'The TyG index was calculated from triglyceride and glucose.' },
  { pmid: '2', title: 'SII in UK Biobank', abstract: 'SII was defined using platelet, neutrophil, and lymphocyte counts.' },
];

describe('PubMed extraction prompt budget', () => {
  it('uses the minimal extraction schema without the database catalog or match status', () => {
    const prompt = buildPubMedVariableExtractionPrompt({
      articles,
      seedCandidates: [{ pmid: '1', raw_name: 'TyG' }],
    });

    expect(prompt).toContain('verbatim sentence');
    expect(prompt).not.toContain('Known public database catalog');
    expect(prompt).not.toContain('database_family_guess');
    expect(prompt).not.toContain('match_status');
  });

  it('splits before the target token budget is exceeded', () => {
    const oneArticleTokens = estimatePubMedPromptTokens(buildPubMedVariableExtractionPrompt({ articles: [articles[0]] }));
    const batches = buildPubMedExtractionPromptBatches({
      articles,
      seedCandidates: articles.map((item) => ({ pmid: item.pmid, raw_name: item.title.split(' ')[0] })),
      targetTokens: oneArticleTokens + 25,
      hardTokens: oneArticleTokens + 500,
    });

    expect(batches).toHaveLength(2);
    expect(batches.every((batch) => batch.articles.length === 1)).toBe(true);
  });
});

describe('PubMed extraction prompt scope', () => {
  it('lets the model report variables that the keyword pre-screen missed', () => {
    const prompt = buildPubMedVariableExtractionPrompt({
      articles,
      seedCandidates: [{ pmid: '1', raw_name: 'TyG' }],
    });

    expect(prompt).toContain('even when no seed mentions it');
    expect(prompt).not.toContain('Return an empty candidates array when the evidence does not validate a seed.');
  });

  it('still forbids variables that the supplied text does not name', () => {
    const prompt = buildPubMedVariableExtractionPrompt({ articles });

    expect(prompt).toContain('Never infer one from background knowledge');
    expect(prompt).toContain('verbatim sentence copied from the supplied title or evidence_text');
  });
});
