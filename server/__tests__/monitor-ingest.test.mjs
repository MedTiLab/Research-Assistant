import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
let tempRoot = null;

async function loadModules() {
  vi.resetModules();
  const dbModule = await import('../database/db.js');
  const ingestModule = await import('../utils/news-monitor-ingest.js');
  return {
    ...dbModule,
    ...ingestModule,
  };
}

describe('ingestMonitorNewsItem', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-monitor-ingest-'));
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

  it('ingests a monitored paper once and skips duplicate scheduler imports', async () => {
    const {
      initializeDatabase,
      monitorDb,
      referencesDb,
      userDb,
      ingestMonitorNewsItem,
    } = await loadModules();
    await initializeDatabase();

    const createdUser = userDb.createUser('scheduler-user', 'hashed-password');
    const userId = createdUser.id;

    const item = {
      id: 'pubmed-41922934',
      title: 'Multi-omics analysis identified SPRR2D as a potential biomarker for hypertensive disorders of pregnancy in women',
      authors: 'Ada Lin and Kai Zhou',
      abstract: 'SPRR2D biomarker signals remained strongest in women with severe disease.',
      published: '2026-04-01',
      matched_keywords: ['biomarker', 'pregnancy'],
      categories: ['Obstetrics'],
      link: 'https://pubmed.ncbi.nlm.nih.gov/41922934/',
      source: 'pubmed',
    };

    const first = await ingestMonitorNewsItem({
      userId,
      item,
      sourceKey: 'pubmed',
      triggerType: 'scheduled_monitor',
    });

    expect(first.skipped).toBe(false);
    expect(first.referenceId).toBeTruthy();
    expect(first.candidateCount).toBeGreaterThan(0);

    const refsAfterFirst = referencesDb.getUserReferences(userId, { limit: 20, offset: 0 });
    expect(refsAfterFirst).toHaveLength(1);

    const statsAfterFirst = monitorDb.getOverviewStats(userId);
    expect(statsAfterFirst.pending_candidates).toBeGreaterThan(0);

    const second = await ingestMonitorNewsItem({
      userId,
      item,
      sourceKey: 'pubmed',
      triggerType: 'scheduled_monitor',
    });

    expect(second.skipped).toBe(true);

    const refsAfterSecond = referencesDb.getUserReferences(userId, { limit: 20, offset: 0 });
    expect(refsAfterSecond).toHaveLength(1);

    const statsAfterSecond = monitorDb.getOverviewStats(userId);
    expect(statsAfterSecond.pending_candidates).toBe(statsAfterFirst.pending_candidates);
  });
});
