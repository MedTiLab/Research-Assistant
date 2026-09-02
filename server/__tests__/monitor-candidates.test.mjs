import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildMonitorCandidatesFromNewsItem } from '../utils/monitor-candidate-extractor.js';
import { extractCandidatesForLiteratureRecord } from '../utils/literature-concept-extractor.js';

const originalDatabasePath = process.env.DATABASE_PATH;
let tempRoot = null;

async function loadDatabaseModule() {
  vi.resetModules();
  return import('../database/db.js');
}

describe('monitor candidates', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-monitor-db-'));
    process.env.DATABASE_PATH = path.join(tempRoot, 'auth.db');
  });

  afterEach(async () => {
    vi.resetModules();

    if (originalDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = originalDatabasePath;
    }

    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it('extracts indicator, disease, and stratifier candidates from monitored news items', () => {
    const candidates = buildMonitorCandidatesFromNewsItem({
      title: 'Multi-omics analysis identified SPRR2D as a potential biomarker for hypertensive disorders of pregnancy in women',
      abstract: 'SPRR2D biomarker signals remained strongest in women with severe disease.',
    }, 'pubmed');

    expect(candidates.some((candidate) => candidate.candidate_type === 'indicator')).toBe(true);
    expect(candidates.some((candidate) => candidate.candidate_type === 'disease')).toBe(true);
    expect(candidates.some((candidate) => candidate.candidate_type === 'stratifier')).toBe(true);
  });

  it('trims noisy conjunction edges and captures drug mentions', () => {
    const candidates = buildMonitorCandidatesFromNewsItem({
      title: 'Metformin treatment in and type 2 diabetes with frailty biomarker assessment',
      abstract: 'Metformin remained associated with lower frailty biomarker scores in older adults.',
    }, 'pubmed');

    expect(candidates.some((candidate) => candidate.candidate_type === 'drug' && /metformin/i.test(candidate.display_name))).toBe(true);
    expect(candidates.some((candidate) => /^(and|on)\b/i.test(candidate.display_name))).toBe(false);
    expect(candidates.some((candidate) => /\b(and|on)\b$/i.test(candidate.display_name))).toBe(false);
  });

  it('summarizes fallback concepts as semantic keywords instead of preposition phrases', () => {
    const candidates = buildMonitorCandidatesFromNewsItem({
      title: 'SPRR2D biomarker for hypertensive disorders of pregnancy from plasma profiling in women',
      abstract: 'Frailty score for mortality in older adults was evaluated alongside metformin therapy.',
    }, 'pubmed');

    expect(candidates.some((candidate) => candidate.display_name === 'SPRR2D biomarker')).toBe(true);
    expect(candidates.some((candidate) => /^frailty score$/i.test(candidate.display_name))).toBe(true);
    expect(candidates.some((candidate) => /\b(for|from)\b/i.test(candidate.display_name))).toBe(false);
  });

  it('does not silently fall back when strict LLM extraction is requested', async () => {
    const result = await extractCandidatesForLiteratureRecord({
      userId: 'test-user',
      reference: {
        title: 'Frailty score for mortality in older adults',
        abstract: 'A monitored abstract for tests.',
      },
      extractionConfig: {
        provider: 'claude',
        model: 'sonnet',
      },
      allowFallback: false,
    });

    expect(result.strategy).toBe('llm_unavailable');
    expect(result.candidates).toEqual([]);
    expect(result.error).toMatch(/LLM extraction is unavailable/i);
  });

  it('stores candidates, updates review state, and reports stats', async () => {
    const { initializeDatabase, monitorDb, userDb } = await loadDatabaseModule();
    await initializeDatabase();

    const createdUser = userDb.createUser('monitor-test-user', 'hashed-password');
    const userId = createdUser.id;

    const run = monitorDb.createRun(userId, {
      source_key: 'pubmed',
      trigger_type: 'news_ingest',
      item_title: 'Frailty prediction model in older adults',
      status: 'completed',
    });

    const inserted = monitorDb.createCandidates(userId, run.id, [
      {
        source_key: 'pubmed',
        candidate_type: 'risk_score',
        normalized_name: 'frailty prediction model',
        display_name: 'Frailty prediction model',
        summary: 'Potential risk score extracted from monitored literature.',
        rationale: 'Matched model phrase in title.',
        confidence: 0.81,
      },
      {
        source_key: 'pubmed',
        candidate_type: 'stratifier',
        normalized_name: 'older adults',
        display_name: 'Older adults',
        summary: 'Potential subgroup extracted from monitored literature.',
        rationale: 'Matched subgroup phrase in title.',
        confidence: 0.66,
      },
    ]);

    expect(inserted).toHaveLength(2);

    const pendingStats = monitorDb.getOverviewStats(userId);
    expect(pendingStats).toMatchObject({
      total_candidates: 2,
      pending_candidates: 2,
      accepted_candidates: 0,
      merged_candidates: 0,
      rejected_candidates: 0,
    });

    const updated = monitorDb.updateCandidateStatus(userId, inserted[0].id, {
      status: 'accepted',
      review_note: 'Looks useful for review.',
    });

    expect(updated?.status).toBe('accepted');

    const nextStats = monitorDb.getOverviewStats(userId);
    expect(nextStats).toMatchObject({
      total_candidates: 2,
      pending_candidates: 1,
      accepted_candidates: 1,
    });
  });

});
