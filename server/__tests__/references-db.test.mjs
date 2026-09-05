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

  it('deduplicates DOI imports across sources and keeps one stable reference id', async () => {
    const { initializeDatabase, referencesDb, userDb } = await loadDatabaseModule();
    await initializeDatabase();

    const userId = userDb.createUser('ref-dedupe-user', 'hashed-password').id;
    const [originalId] = referencesDb.importReferences(userId, [{
      title: 'Original title',
      authors: [{ family: 'Alpha', given: 'Ann' }],
      year: 2024,
      doi: 'https://doi.org/10.1000/Example.DOI',
      keywords: ['baseline'],
      citationKey: 'Alpha2024',
    }], 'bibtex');

    const importedIds = referencesDb.importReferences(userId, [{
      title: 'Authoritative title',
      authors: [{ family: 'Alpha', given: 'Ann' }],
      year: 2024,
      doi: '10.1000/example.doi',
      journal: 'Updated Journal',
      keywords: ['follow-up'],
      citationKey: 'PMID12345678',
    }], 'pubmed');

    expect(importedIds).toEqual([originalId]);
    expect(referencesDb.countUserReferences(userId)).toBe(1);
    expect(referencesDb.getReference(originalId, userId)).toMatchObject({
      title: 'Authoritative title',
      doi: '10.1000/example.doi',
      journal: 'Updated Journal',
    });
    expect(referencesDb.getTags(userId).map((item) => item.tag)).toEqual(expect.arrayContaining(['baseline', 'follow-up']));
  });

  it('lets a Zotero sync attach source identity to an existing DOI row', async () => {
    const { initializeDatabase, referencesDb, userDb } = await loadDatabaseModule();
    await initializeDatabase();

    const userId = userDb.createUser('ref-zotero-dedupe-user', 'hashed-password').id;
    const [originalId] = referencesDb.importReferences(userId, [{
      title: 'BibTeX copy',
      doi: '10.2000/shared',
      citationKey: 'Shared2026',
      keywords: ['manual-tag'],
    }], 'bibtex');

    expect(referencesDb.syncFromZotero(userId, [{
      sourceId: 'ZOTERO123',
      title: 'Zotero copy',
      doi: 'https://doi.org/10.2000/SHARED',
      authors: [{ family: 'Zed', given: 'Zoe' }],
      keywords: ['zotero-tag'],
      itemType: 'journalArticle',
    }])).toEqual([originalId]);
    expect(referencesDb.getReference(originalId, userId)).toMatchObject({
      source: 'zotero',
      source_id: 'ZOTERO123',
      doi: '10.2000/shared',
      title: 'Zotero copy',
    });
    expect(referencesDb.getTags(userId).map((item) => item.tag)).toEqual(expect.arrayContaining(['manual-tag', 'zotero-tag']));
  });

  it('searches DOI, citation key, and keywords as advertised', async () => {
    const { initializeDatabase, referencesDb, userDb } = await loadDatabaseModule();
    await initializeDatabase();

    const userId = userDb.createUser('ref-search-user', 'hashed-password').id;
    const [referenceId] = referencesDb.importReferences(userId, [{
      title: 'Hard to discover title',
      doi: '10.5555/search-me',
      citationKey: 'UniqueCitationKey2026',
      keywords: ['latent biomarker'],
    }], 'bibtex');

    expect(referencesDb.getUserReferences(userId, { search: '10.5555' }).map((item) => item.id)).toEqual([referenceId]);
    expect(referencesDb.getUserReferences(userId, { search: 'UniqueCitationKey' }).map((item) => item.id)).toEqual([referenceId]);
    expect(referencesDb.getUserReferences(userId, { search: 'latent biomarker' }).map((item) => item.id)).toEqual([referenceId]);
    expect(referencesDb.countUserReferences(userId, { search: 'search-me' })).toBe(1);
  });

  it('updates editable metadata and rejects a DOI already owned by another reference', async () => {
    const { initializeDatabase, referencesDb, userDb } = await loadDatabaseModule();
    await initializeDatabase();

    const userId = userDb.createUser('ref-edit-user', 'hashed-password').id;
    const ids = referencesDb.importReferences(userId, [
      { title: 'First paper', doi: '10.1000/first', citationKey: 'First', keywords: [] },
      { title: 'Second paper', doi: '10.1000/second', citationKey: 'Second', keywords: [] },
    ], 'bibtex');

    const updated = referencesDb.updateReference(userId, ids[0], {
      title: 'First paper, corrected',
      doi: 'https://doi.org/10.1000/FIRST',
      authors: [{ family: 'Corrected', given: 'Casey' }],
      keywords: ['reviewed'],
    });
    expect(updated.status).toBe('updated');
    expect(updated.reference).toMatchObject({
      title: 'First paper, corrected',
      doi: '10.1000/first',
      authors: [{ family: 'Corrected', given: 'Casey' }],
      keywords: ['reviewed'],
    });

    expect(referencesDb.updateReference(userId, ids[0], { doi: '10.1000/second' })).toMatchObject({
      status: 'duplicate_doi',
      duplicateId: ids[1],
    });
  });
});
