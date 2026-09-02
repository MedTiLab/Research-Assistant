import { describe, expect, it } from 'vitest';

import { CHAT_QUICK_ACTION_GROUPS, CHAT_QUICK_ACTION_SCENARIOS } from './guidedPromptScenarios';

describe('CHAT_QUICK_ACTION_SCENARIOS', () => {
  it('keeps the empty-chat shortcuts focused and ordered', () => {
    expect(CHAT_QUICK_ACTION_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      'today-tasks',
      'reply-advisor',
      'research-ideation',
      'search-literature',
      'download-literature',
      'read-paper',
      'paper-card',
      'verify-references',
      'deep-research',
      'writing-assistant',
      'make-presentation',
      'data-analysis',
      'research-design',
      'database-extraction',
      'experiment-log',
      'submit-manuscript',
      'proposal-writing',
      'paper-to-patent',
      'review-manuscript',
      'statistics-audit',
      'reply-reviewers',
      'scientific-figure',
      'mechanism-diagram',
      'graphical-abstract-quick',
      'mind-map',
      'create-knowledge-base',
      'research-insights',
      'watch-news',
      'create-skill',
      'create-program',
      'create-automation',
    ]);
  });

  it('binds only shortcuts with a relevant installed-skill workflow', () => {
    expect(CHAT_QUICK_ACTION_SCENARIOS.find((scenario) => scenario.id === 'make-presentation')?.skills)
      .toContain('making-academic-presentations');
    expect(CHAT_QUICK_ACTION_SCENARIOS.find((scenario) => scenario.id === 'search-literature')?.skills)
      .toContain('literature-review');
    expect(CHAT_QUICK_ACTION_SCENARIOS.find((scenario) => scenario.id === 'download-literature')?.skills)
      .toEqual([
        'legal-pdf-acquisition',
        'public-literature-download',
        'research-paper-downloader',
        'paper-download',
        'meta-zotero-fulltext-handoff',
        'zotero-medautodata-library',
        'mineru-pdf-parser',
        'nature-downloader',
      ]);
    expect(CHAT_QUICK_ACTION_SCENARIOS.find((scenario) => scenario.id === 'submit-manuscript')?.skills)
      .toContain('nature-writing');
    expect(CHAT_QUICK_ACTION_SCENARIOS.find((scenario) => scenario.id === 'reply-reviewers')?.skills)
      .toContain('nature-response');
    expect(CHAT_QUICK_ACTION_SCENARIOS.find((scenario) => scenario.id === 'review-manuscript')?.skills)
      .toContain('nature-reviewer');
    expect(CHAT_QUICK_ACTION_SCENARIOS.find((scenario) => scenario.id === 'paper-card')?.skills)
      .toContain('nature-paper-card');
    expect(CHAT_QUICK_ACTION_SCENARIOS.find((scenario) => scenario.id === 'create-skill')?.skills)
      .toEqual(['skill-creator']);
    expect(CHAT_QUICK_ACTION_SCENARIOS.find((scenario) => scenario.id === 'reply-advisor')?.skills)
      .toEqual(['medhelp-humanizer']);
    expect(CHAT_QUICK_ACTION_SCENARIOS.find((scenario) => scenario.id === 'create-knowledge-base')?.skills)
      .toEqual(['markitdown', 'chroma']);
    expect(CHAT_QUICK_ACTION_SCENARIOS.find((scenario) => scenario.id === 'today-tasks')?.skills)
      .toEqual(['medhelp-workbench-review']);
    expect(CHAT_QUICK_ACTION_SCENARIOS.find((scenario) => scenario.id === 'data-analysis')?.skills)
      .toEqual(expect.arrayContaining(['baseline-table', 'easyukb-analysis', 'gco-database-analysis']));
    expect(CHAT_QUICK_ACTION_SCENARIOS.find((scenario) => scenario.id === 'create-program')?.skills)
      .toEqual(['publish', 'taste-skill', 'popular-web-designs']);
    expect(CHAT_QUICK_ACTION_SCENARIOS.find((scenario) => scenario.id === 'writing-assistant')?.skills)
      .toEqual([
        'nature-polishing',
        'medhelp-humanizer',
        'citation-management',
        'nature-citation',
        'scientific-writing',
        'nature-writing',
        'medhelp-paper-writing',
      ]);

    for (const id of ['watch-news', 'create-automation']) {
      expect(CHAT_QUICK_ACTION_SCENARIOS.find((scenario) => scenario.id === id)?.skills).toEqual([]);
    }
  });

  it('places every shortcut in exactly one visible group', () => {
    expect(CHAT_QUICK_ACTION_GROUPS[0]).toMatchObject({
      id: 'daily',
      scenarioIds: ['today-tasks', 'reply-advisor'],
    });
    expect(CHAT_QUICK_ACTION_GROUPS[1]).toMatchObject({
      id: 'news',
      scenarioIds: ['watch-news'],
    });
    const groupedIds = CHAT_QUICK_ACTION_GROUPS.flatMap((group) => group.scenarioIds);
    expect(groupedIds).toHaveLength(new Set(groupedIds).size);
    expect(new Set(groupedIds)).toEqual(new Set(CHAT_QUICK_ACTION_SCENARIOS.map((scenario) => scenario.id)));
  });
});
