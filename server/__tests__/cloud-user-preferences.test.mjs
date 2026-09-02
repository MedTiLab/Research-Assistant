import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  resolveCloudUserMemoryContext,
  sanitizeCloudUserMemoryContext,
  resolveCloudUserPreferenceContext,
  sanitizeCloudUserPreferenceContext,
} from '../utils/cloudAgentRuntimeEnv.js';

describe('cloud user preference synchronization', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sanitizes the account preference payload', () => {
    const context = sanitizeCloudUserPreferenceContext({
      enabled: true,
      aboutYou: '  Clinical researcher  ',
      analysisLanguagePreference: 'python',
      autoResearchSenderEmail: ' sender@example.com ',
      memories: [{
        id: '4',
        content: '  Prefer concise summaries  ',
        category: 'preference',
        scope: 'project',
        projectPath: '/old/demo',
        projectKey: 'demo',
      }],
    });

    expect(context.aboutYou).toBe('Clinical researcher');
    expect(context.autoResearchSenderEmail).toBe('sender@example.com');
    expect(context.memories[0]).toMatchObject({
      id: 4,
      content: 'Prefer concise summaries',
      projectKey: 'demo',
    });
  });

  it('fetches on demand and falls back to the last successful context', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          enabled: true,
          aboutYou: 'Synced profile',
          memories: [],
        }),
      })
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);
    const session = {
      cloudAccessToken: 'cloud-token',
      cloudBaseUrl: 'https://app.medtimehelp.com',
      origin: 'https://app.medtimehelp.com',
    };

    const fresh = await resolveCloudUserPreferenceContext(session, { force: true });
    const fallback = await resolveCloudUserPreferenceContext(session, { force: true });

    expect(fetchMock.mock.calls[0][0]).toBe('https://app.medtimehelp.com/api/settings/user-preference-context');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer cloud-token');
    expect(fresh.aboutYou).toBe('Synced profile');
    expect(fallback).toEqual(fresh);
  });

  it('keeps long-term memory in its own synchronized context', async () => {
    const context = sanitizeCloudUserMemoryContext({
      enabled: true,
      autoCaptureEnabled: false,
      memories: [{ id: '9', content: '  The user leads the cohort study.  ', source: 'automatic' }],
    });
    expect(context).toMatchObject({ enabled: true, autoCaptureEnabled: false });
    expect(context.memories).toEqual([expect.objectContaining({ id: 9, content: 'The user leads the cohort study.' })]);

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => context });
    vi.stubGlobal('fetch', fetchMock);
    await resolveCloudUserMemoryContext({
      cloudAccessToken: 'cloud-token',
      cloudBaseUrl: 'https://app.medtimehelp.com',
    }, { force: true });
    expect(fetchMock.mock.calls[0][0]).toBe('https://app.medtimehelp.com/api/settings/long-term-memory/context');
  });
});
