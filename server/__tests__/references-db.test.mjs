import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalDatabasePath = process.env.DATABASE_PATH;
let tempRoot = null;

async function loadDatabaseModule() {
  vi.resetModules();
  return import('../database/db.js');
}

describe('referencesDb batch lookups', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-references-db-'));
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

  it('returns references by ids in request order', async () => {
    const { initializeDatabase, referencesDb, userDb } = await loadDatabaseModule();
    await initializeDatabase();

    const createdUser = userDb.createUser('ref-test-user', 'hashed-password');
    const userId = createdUser.id;
    const ids = referencesDb.importReferences(userId, [
      {
        title: 'Paper A',
        authors: [{ family: 'Alpha', given: 'Ann' }],
        year: 2024,
        abstract: 'First paper',
        journal: 'Journal A',
        itemType: 'article',
        keywords: ['screening'],
        citationKey: 'Alpha2024A',
      },
      {
        title: 'Paper B',
        authors: [{ family: 'Beta', given: 'Ben' }],
        year: 2025,
        abstract: 'Second paper',
        journal: 'Journal B',
        itemType: 'article',
        keywords: ['cohort'],
        citationKey: 'Beta2025B',
      },
    ], 'bibtex');

    const result = referencesDb.getReferencesByIds(userId, [ids[1], ids[0]]);

    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe(ids[1]);
    expect(result[0]?.title).toBe('Paper B');
    expect(result[1]?.id).toBe(ids[0]);
    expect(result[1]?.authors).toEqual([{ family: 'Alpha', given: 'Ann' }]);
  });

  it('bulk deletes references together with related monitor artifacts', async () => {
    const { initializeDatabase, referencesDb, monitorDb, userDb } = await loadDatabaseModule();
    await initializeDatabase();

    const createdUser = userDb.createUser('ref-delete-user', 'hashed-password');
    const userId = createdUser.id;
    const [referenceId] = referencesDb.importReferences(userId, [
      {
        title: 'Paper To Delete',
        authors: [{ family: 'Gamma', given: 'Gina' }],
        year: 2026,
        abstract: 'Deletion candidate.',
        journal: 'Cleanup Journal',
        itemType: 'article',
        keywords: ['cleanup'],
        citationKey: 'Gamma2026Delete',
      },
    ], 'bibtex');

    const run = monitorDb.createRun(userId, {
      source_key: 'bibtex',
      trigger_type: 'reference_import',
      item_title: 'Paper To Delete',
      reference_id: referenceId,
      status: 'completed',
    });

    const insertedCandidates = monitorDb.createCandidates(userId, run.id, [
      {
        reference_id: referenceId,
        source_key: 'bibtex',
        candidate_type: 'indicator',
        normalized_name: 'frailty index',
        display_name: 'Frailty index',
        summary: 'Candidate tied to the deleted paper.',
      },
    ]);

    expect(insertedCandidates).toHaveLength(1);

    const deleted = referencesDb.bulkDeleteReferences(userId, [referenceId]);

    expect(deleted).toBe(1);
    expect(referencesDb.getReference(referenceId, userId)).toBeNull();
    expect(monitorDb.getCandidate(userId, insertedCandidates[0].id)).toBeNull();
    expect(monitorDb.getRun(userId, run.id)).toBeNull();
  });

  it('organizes references into folders without deleting the underlying literature', async () => {
    const { initializeDatabase, referencesDb, userDb } = await loadDatabaseModule();
    await initializeDatabase();

    const createdUser = userDb.createUser('ref-folder-user', 'hashed-password');
    const userId = createdUser.id;
    const ids = referencesDb.importReferences(userId, [
      { title: 'Filed paper', citationKey: 'FiledPaper', keywords: [] },
      { title: 'Unfiled paper', citationKey: 'UnfiledPaper', keywords: [] },
    ], 'bibtex');
    const folder = referencesDb.createFolder(userId, 'Methods');

    expect(referencesDb.addReferencesToFolder(userId, folder.id, [ids[0]])).toBe(1);
    expect(referencesDb.getUserReferences(userId, { folderId: folder.id }).map((item) => item.id)).toEqual([ids[0]]);
    expect(referencesDb.getUserReferences(userId, { folderId: 'unfiled' }).map((item) => item.id)).toEqual([ids[1]]);
    expect(referencesDb.countUserReferences(userId, { folderId: folder.id })).toBe(1);
    expect(referencesDb.getFolders(userId)).toMatchObject({
      total_count: 2,
      unfiled_count: 1,
      folders: [{ id: folder.id, name: 'Methods', reference_count: 1 }],
    });

    expect(referencesDb.deleteFolder(userId, folder.id)).toBe(true);
    expect(referencesDb.getReference(ids[0], userId)?.title).toBe('Filed paper');
    expect(referencesDb.getFolders(userId).unfiled_count).toBe(2);
  });
});
