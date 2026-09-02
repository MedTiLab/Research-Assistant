import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

function processIsAlive(pid, kill = process.kill) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    kill(numericPid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function atomicWrite(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, value, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function acquireOwnerLock(databasePath, { kill = process.kill } = {}) {
  const lockPath = `${databasePath}.owner`;
  const token = crypto.randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = fs.openSync(lockPath, 'wx', 0o600);
      try {
        fs.writeFileSync(descriptor, `${JSON.stringify({
          pid: process.pid,
          token,
          startedAt: new Date().toISOString(),
        })}\n`);
      } finally {
        fs.closeSync(descriptor);
      }
      return { lockPath, token };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const owner = readJson(lockPath);
      if (Number(owner?.pid) !== process.pid && processIsAlive(owner?.pid, kill)) {
        const inUse = new Error(`Database is already owned by process ${owner.pid}: ${databasePath}`);
        inUse.code = 'DATABASE_IN_USE';
        inUse.ownerPid = owner.pid;
        throw inUse;
      }
      fs.rmSync(lockPath, { force: true });
    }
  }
  throw new Error(`Could not acquire database owner lock: ${lockPath}`);
}

function releaseOwnerLock(lock) {
  if (!lock) return;
  const owner = readJson(lock.lockPath);
  if (owner?.token !== lock.token) return;
  fs.rmSync(lock.lockPath, { force: true });
}

function configureDatabase(db) {
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
}

function databasePassesQuickCheck(db) {
  try {
    return db.pragma('quick_check', { simple: true }) === 'ok';
  } catch {
    return false;
  }
}

function quarantineDatabase(databasePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const quarantinePath = `${databasePath}.corrupt-${stamp}`;
  if (fs.existsSync(databasePath)) {
    fs.renameSync(databasePath, quarantinePath);
  }
  for (const suffix of ['-wal', '-shm']) {
    const source = `${databasePath}${suffix}`;
    if (fs.existsSync(source)) {
      fs.renameSync(source, `${quarantinePath}${suffix}`);
    }
  }
  return quarantinePath;
}

export function openManagedDatabase({
  Database,
  databasePath,
  enableCrashGuard = true,
  enableOwnerLock = true,
  kill = process.kill,
} = {}) {
  if (typeof Database !== 'function' || !databasePath) {
    throw new TypeError('Managed database requires a Database constructor and path');
  }

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const dirtyMarkerPath = `${databasePath}.open`;
  const priorRunUnclean = enableCrashGuard && fs.existsSync(dirtyMarkerPath);
  const ownerLock = enableCrashGuard && enableOwnerLock ? acquireOwnerLock(databasePath, { kill }) : null;
  let db = null;
  let quarantinePath = null;
  let closed = false;

  try {
    try {
      db = new Database(databasePath);
      configureDatabase(db);
      if (priorRunUnclean && !databasePassesQuickCheck(db)) {
        const corrupt = new Error('Database failed PRAGMA quick_check after an unclean shutdown');
        corrupt.code = 'DATABASE_CORRUPT';
        throw corrupt;
      }
    } catch (error) {
      try {
        db?.close();
      } catch {
        // The corrupt connection may not be closable.
      }
      db = null;
      if (!priorRunUnclean) throw error;
      quarantinePath = quarantineDatabase(databasePath);
      db = new Database(databasePath);
      configureDatabase(db);
    }

    if (enableCrashGuard) {
      atomicWrite(dirtyMarkerPath, `${JSON.stringify({
        pid: process.pid,
        openedAt: new Date().toISOString(),
      })}\n`);
    }
  } catch (error) {
    try {
      db?.close();
    } catch {
      // Preserve the original startup error.
    }
    releaseOwnerLock(ownerLock);
    throw error;
  }

  const status = {
    priorRunUnclean,
    recoveredFromCorruption: Boolean(quarantinePath),
    quarantinePath,
  };

  return {
    db,
    status,
    close() {
      if (closed) return;
      closed = true;
      let closedCleanly = false;
      try {
        try {
          db.pragma('wal_checkpoint(TRUNCATE)');
        } catch {
          // Closing the handle is still useful if a checkpoint is temporarily blocked.
        }
        db.close();
        closedCleanly = true;
      } finally {
        if (enableCrashGuard && closedCleanly) {
          fs.rmSync(dirtyMarkerPath, { force: true });
        }
        releaseOwnerLock(ownerLock);
      }
    },
  };
}

export async function ensurePreMigrationBackup({
  db,
  databasePath,
  version,
  enabled = true,
} = {}) {
  if (!enabled) return null;
  const safeVersion = String(version || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '-');
  const backupPath = `${databasePath}.pre-migration-${safeVersion}.bak`;
  if (fs.existsSync(backupPath)) return backupPath;

  const temporaryPath = `${backupPath}.${process.pid}.tmp`;
  try {
    await db.backup(temporaryPath);
    const verify = new db.constructor(temporaryPath, { readonly: true, fileMustExist: true });
    try {
      if (!databasePassesQuickCheck(verify)) {
        throw new Error('Pre-migration database backup failed PRAGMA quick_check');
      }
    } finally {
      verify.close();
    }
    // Opening a WAL-mode backup for verification can create temporary SQLite
    // sidecars even when the verifier is read-only. They belong to the staging
    // filename and must never be left beside the promoted backup.
    for (const suffix of ['-wal', '-shm']) {
      fs.rmSync(`${temporaryPath}${suffix}`, { force: true });
    }
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, backupPath);
    return backupPath;
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    for (const suffix of ['-wal', '-shm']) {
      fs.rmSync(`${temporaryPath}${suffix}`, { force: true });
    }
    throw error;
  }
}

export const DATABASE_LIFECYCLE_TEST_CONSTANTS = Object.freeze({
  processIsAlive,
});
