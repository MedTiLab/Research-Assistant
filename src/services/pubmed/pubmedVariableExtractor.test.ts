import { describe, expect, it } from 'vitest';
import { extractVariableCandidatesFromArticle } from './pubmedVariableExtractor';

function names(title: string, abstract = '') {
  return extractVariableCandidatesFromArticle({ pmid: '1', title, abstract }, 'job')
    .map((candidate) => candidate.raw_name);
}

describe('title-stage rule extraction', () => {
  it('drops interrogative and connective lead-ins instead of baking them into the variable name', () => {
    expect(names('Is Body Roundness Index Associated With All-Cause Mortality? Evidence From NHANES'))
      .toEqual(['BRI']);
  });

  it('recovers the metric when the title opens with an association phrase', () => {
    expect(names('Association between the triglyceride-glucose index and cognitive decline: a CHARLS cohort study'))
      .toContain('TyG');
  });

  it('does not splice the title tail onto the first abstract phrase', () => {
    expect(names(
      'Dietary inflammatory index and depression among US adults',
      'The dietary inflammatory index was computed from 28 food parameters.',
    )).toEqual(['Dietary inflammatory index']);
  });
});
