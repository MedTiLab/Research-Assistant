import { describe, expect, it } from 'vitest';

import {
  buildSkillReferenceContext,
  extractKnownSkillReferences,
  normalizeSkillMentionCandidates,
} from './skillMentions';

const candidates = normalizeSkillMentionCandidates([
  {
    mention: 'data-transform',
    name: 'data-transform',
    dirPath: 'data-transform',
    description: 'Transform datasets',
  },
  {
    mention: 'Academic-Figure-Prompt',
    name: 'Academic Figure Prompt',
    dirPath: 'academic-figure-prompt',
  },
]);

describe('skillMentions', () => {
  it('extracts known slash skill references without matching unknown slash tokens', () => {
    const references = extractKnownSkillReferences(
      '/data-transform 请整理数据，然后忽略 /unknown-skill。',
      candidates,
    );

    expect(references.map((reference) => reference.mention)).toEqual(['data-transform']);
  });

  it('builds agent context for slash-referenced skills', () => {
    const context = buildSkillReferenceContext([candidates[1]]);

    expect(context).toContain('/Academic-Figure-Prompt (Academic Figure Prompt)');
    expect(context).toContain('.agents/skills/academic-figure-prompt/SKILL.md');
    expect(context).toContain('.agents/skills/library/academic-figure-prompt/SKILL.md');
  });
});
