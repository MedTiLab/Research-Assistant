import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authenticatedFetch } from '../../../utils/api';
import type { Project } from '../../../types/app';
import { createHttpResearchSecretaryApi } from './httpResearchSecretaryApi';

vi.mock('../../../utils/api', () => ({ authenticatedFetch: vi.fn() }));

const project = (name: string): Project => ({ name, displayName: name, fullPath: `/tmp/${name}` });
const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { 'content-type': 'application/json' },
});

describe('HTTP research secretary snapshot', () => {
  beforeEach(() => vi.mocked(authenticatedFetch).mockReset());

  it('merges real sources and keeps a promoted meeting action exactly once', async () => {
    vi.mocked(authenticatedFetch).mockImplementation(async (path) => {
      const url = String(path);
      if (url === '/api/research/snapshot') return response({
        meetings: [],
        openActions: [
          { id: 'action-1', meetingId: 'meeting-1', content: 'Promoted', status: 'open', owner: 'me', projectId: 'alpha', createdAt: '2026-09-01T00:00:00Z' },
          { id: 'action-2', meetingId: 'meeting-1', content: 'Meeting only', status: 'open', owner: 'me', createdAt: '2026-09-01T00:00:00Z' },
        ],
        advisorNotes: [],
      });
      if (url.includes('/api/taskmaster/tasks/alpha')) return response({ tasks: [{
        id: 1, title: 'Promoted', status: 'done', priority: 'high', source: 'meeting', sourceMeetingActionId: 'action-1',
      }] });
      if (url.includes('/api/taskmaster/artifacts/alpha')) return response({ artifacts: [{
        name: 'forest.png', relativePath: 'figures/forest.png', category: 'figures', modified: '2026-09-01T08:00:00Z',
      }] });
      if (url.includes('/api/agent-services/automations')) return response([{
        id: 'auto-1', title: 'Daily review', prompt: 'Review', status: 'active', intervalMinutes: 1440,
        nextRunAt: '2026-09-02T00:00:00Z', createdAt: '2026-09-01T00:00:00Z', lastStatus: 'failed', lastError: 'boom',
      }]);
      if (url === '/api/agent-runs') return response({ runs: [{
        id: 'run-1', projectKey: 'alpha', runtimeId: 'codex', commandPreview: 'Analyze', status: 'completed', createdAt: 1_788_220_800_000,
      }] });
      if (url === '/api/news/bootstrap') return response({ results: { pubmed: { top_papers: [{
        id: 'pmid-1', title: 'Paper', relevance_score: 0.9, matched_domain: 'Cohort', link: 'https://example.test/paper',
      }] } } });
      return response({ error: 'missing fixture' }, 404);
    });

    const snapshot = await createHttpResearchSecretaryApi().getSnapshot([project('alpha')]);

    expect(snapshot.tasks).toEqual([
      expect.objectContaining({ id: 'action-2', title: 'Meeting only', source: 'meeting' }),
      expect.objectContaining({ id: 'alpha:1', title: 'Promoted', status: 'done', source: 'meeting' }),
    ]);
    expect(snapshot.automationJobs).toEqual([expect.objectContaining({ id: 'auto-1', status: 'error' })]);
    expect(snapshot.agentRuns).toEqual([expect.objectContaining({ id: 'run-1', status: 'succeeded', provider: 'codex' })]);
    expect(snapshot.literatureAlerts).toEqual([expect.objectContaining({ id: 'pubmed:pmid-1', read: false })]);
    expect(snapshot.artifacts).toEqual([expect.objectContaining({ kind: 'figure', path: 'figures/forest.png' })]);
  });

  it('isolates a failed project task endpoint from the remaining projects', async () => {
    vi.mocked(authenticatedFetch).mockImplementation(async (path) => {
      const url = String(path);
      if (url === '/api/research/snapshot') return response({ meetings: [], openActions: [], advisorNotes: [] });
      if (url.includes('/api/taskmaster/tasks/broken')) return response({ error: 'not found' }, 404);
      if (url.includes('/api/taskmaster/tasks/healthy')) return response({ tasks: [{ id: 2, title: 'Healthy task', status: 'pending' }] });
      if (url.includes('/api/taskmaster/artifacts/')) return response({ artifacts: [] });
      if (url.includes('/api/agent-services/automations')) return response([]);
      if (url === '/api/agent-runs') return response({ runs: [] });
      if (url === '/api/news/bootstrap') return response({ results: {} });
      return response({}, 404);
    });

    const snapshot = await createHttpResearchSecretaryApi().getSnapshot([project('broken'), project('healthy')]);
    expect(snapshot.tasks).toEqual([expect.objectContaining({ title: 'Healthy task', projectId: 'healthy' })]);
  });
});
