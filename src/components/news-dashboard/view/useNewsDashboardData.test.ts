import { describe, expect, it } from 'vitest';

import { normalizeNewsDashboardSnapshot } from './useNewsDashboardData';

describe('normalizeNewsDashboardSnapshot', () => {
  it('keeps supported literature sources and fills missing source maps', () => {
    const snapshot = normalizeNewsDashboardSnapshot({
      sources: [
        {
          key: 'pubmed',
          label: 'PubMed',
          hasResults: true,
          lastSearchDate: '2026-05-27',
          requiresCredentials: false,
          credentialType: null,
          credentialStatus: 'not_required',
        },
        {
          key: 'wechat',
          label: 'WeChat',
          hasResults: false,
          lastSearchDate: null,
          requiresCredentials: false,
          credentialType: null,
          credentialStatus: 'not_required',
        },
        { key: 'unsupported', label: 'Unsupported' },
      ],
      configs: {
        pubmed: { top_n: 20 },
      },
      results: {
        pubmed: {
          top_papers: [{ id: 'pmid-1', title: 'A study' }],
          total_found: 2,
          total_filtered: 1,
          search_date: '2026-05-27',
        },
      },
    });

    expect(snapshot?.sources.map((source) => source.key)).toEqual(['pubmed', 'wechat']);
    expect(snapshot?.configs.pubmed).toMatchObject({ top_n: 20 });
    expect(snapshot?.configs.arxiv).toEqual({});
    expect(snapshot?.configs.wechat).toEqual({});
    expect(snapshot?.results.pubmed.top_papers).toHaveLength(1);
    expect(snapshot?.results.arxiv.top_papers).toEqual([]);
    expect(snapshot?.results.wechat.top_papers).toEqual([]);
  });

  it('rejects empty snapshots so a blank cache does not mask first load', () => {
    expect(normalizeNewsDashboardSnapshot({
      sources: [],
      configs: {},
      results: {},
    })).toBeNull();
  });
});
