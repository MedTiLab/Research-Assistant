import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ensurePreMigrationBackup, openManagedDatabase } from './databaseLifecycle.js';

const directories = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryDatabasePath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'medhelp-managed-db-'));
  directories.push(directory);
  return path.join(directory, 'auth.db');
}

describe('database crash lifecycle', () => {
  it('uses WAL, writes a dirty marker, and clears it on a clean close', () => {
    const databasePath = temporaryDatabasePath();
    const managed = openManagedDatabase({ Database, databasePath });

    expect(managed.db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(managed.db.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(fs.existsSync(`${databasePath}.open`)).toBe(true);
    expect(fs.existsSync(`${databasePath}.owner`)).toBe(true);

    managed.close();
    expect(fs.existsSync(`${databasePath}.open`)).toBe(false);
    expect(fs.existsSync(`${databasePath}.owner`)).toBe(false);
  });

  it('quarantines a corrupt database after an unclean shutdown and starts clean', () => {
    const databasePath = temporaryDatabasePath();
    fs.writeFileSync(databasePath, 'not-a-sqlite-database');
    fs.writeFileSync(`${databasePath}.open`, JSON.stringify({ pid: 999 }));

    const managed = openManagedDatabase({ Database, databasePath });
    expect(managed.status).toMatchObject({
      priorRunUnclean: true,
      recoveredFromCorruption: true,
    });
    expect(fs.readFileSync(managed.status.quarantinePath, 'utf8')).toBe('not-a-sqlite-database');
    expect(managed.db.pragma('quick_check', { simple: true })).toBe('ok');
    managed.close();
  });

  it('refuses a second live writer instead of opening the same database twice', () => {
    const databasePath = temporaryDatabasePath();
    fs.writeFileSync(`${databasePath}.owner`, JSON.stringify({ pid: 777, token: 'other' }));

    expect(() => openManagedDatabase({
      Database,
      databasePath,
      kill: vi.fn(),
    })).toThrow(expect.objectContaining({ code: 'DATABASE_IN_USE' }));
  });

  it('creates and verifies one versioned online backup before migrations', async () => {
    const databasePath = temporaryDatabasePath();
    const managed = openManagedDatabase({ Database, databasePath });
    managed.db.exec('CREATE TABLE research_records (id INTEGER PRIMARY KEY, title TEXT);');
    managed.db.prepare('INSERT INTO research_records (title) VALUES (?)').run('preserved');

    const backupPath = await ensurePreMigrationBackup({
      db: managed.db,
      databasePath,
      version: '1.1.19',
    });
    const backup = new Database(backupPath, { readonly: true });
    expect(backup.prepare('SELECT title FROM research_records').get()).toEqual({ title: 'preserved' });
    backup.close();
    expect(fs.readdirSync(path.dirname(databasePath)).some((entry) => (
      entry.includes('.tmp-wal') || entry.includes('.tmp-shm')
    ))).toBe(false);
    await expect(ensurePreMigrationBackup({
      db: managed.db,
      databasePath,
      version: '1.1.19',
    })).resolves.toBe(backupPath);
    managed.close();
  });
});
