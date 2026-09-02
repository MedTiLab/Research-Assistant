import fsSync, { constants as fsConstants, promises as fs } from 'fs';
import path from 'path';
import readline from 'readline';

import {
  resolveMedHelpCodexHome,
  resolveSystemCodexHome,
} from './storagePaths.js';

const CODEX_BOOTSTRAP_FILES = ['auth.json', 'config.toml'];
const LEGACY_MEDHELP_ORIGINATORS = new Set(['medhelp', 'codex_sdk_ts']);
const LEGACY_SESSION_MIGRATION_MARKER = '.medhelp-legacy-session-migration-v2.json';

const migrationPromises = new Map();

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyFileAtomically(sourcePath, destinationPath, mode = 0o600) {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${destinationPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    // Prefer a copy-on-write clone on APFS and compatible Linux filesystems so
    // importing large legacy rollouts does not immediately duplicate their
    // full disk usage. Node falls back to a regular copy when cloning is not
    // supported by the filesystem.
    await fs.copyFile(sourcePath, temporaryPath, fsConstants.COPYFILE_FICLONE);
    await fs.chmod(temporaryPath, mode).catch(() => {});
    try {
      await fs.rename(temporaryPath, destinationPath);
    } catch (error) {
      // Windows does not consistently replace an existing destination with
      // rename(). copyFile() does, while the prepared temporary file keeps the
      // source read separate from the replacement write.
      if (!['EEXIST', 'EPERM', 'EACCES'].includes(error?.code)) throw error;
      await fs.copyFile(temporaryPath, destinationPath);
      await fs.chmod(destinationPath, mode).catch(() => {});
    }
  } finally {
    await fs.unlink(temporaryPath).catch(() => {});
  }
}

async function syncBootstrapFile(sourcePath, destinationPath) {
  let sourceStat;
  try {
    sourceStat = await fs.stat(sourcePath);
    if (!sourceStat.isFile()) return false;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }

  let destinationStat = null;
  try {
    destinationStat = await fs.stat(destinationPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (destinationStat && destinationStat.mtimeMs >= sourceStat.mtimeMs) {
    return false;
  }

  await copyFileAtomically(sourcePath, destinationPath, 0o600);
  return true;
}

async function findJsonlFiles(rootDir) {
  const files = [];
  const pendingDirs = [rootDir];

  while (pendingDirs.length > 0) {
    const currentDir = pendingDirs.pop();
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        pendingDirs.push(entryPath);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(entryPath);
      }
    }
  }

  return files;
}

function extractCodexMessageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => (
      item?.type === 'input_text' || item?.type === 'text'
        ? String(item.text || '')
        : ''
    ))
    .filter(Boolean)
    .join('\n');
}

function isLegacyMedHelpPrompt(text) {
  const normalized = typeof text === 'string' ? text.trim() : '';
  if (!normalized) return false;
  return (
    /^#\s+MedHelp Skills(?:\s*\(|\s+Reminder\b)/i.test(normalized)
    || (
      /^(?:<path_display_rule>|<research_lessons>|<execution_memory>|<analysis_preferences>|<user_preferences>|<user_memory>)/i.test(normalized)
      && /(?:^|\n)\s*User request:\s*(?:\n|$)/i.test(normalized)
    )
  );
}

async function inspectLegacyCodexSession(filePath) {
  const fileStream = fsSync.createReadStream(filePath);
  const lines = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });
  let metadata = null;
  let inspectedLines = 0;
  try {
    for await (const line of lines) {
      inspectedLines += 1;
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry?.type === 'session_meta') {
          metadata = entry.payload || null;
          const originator = String(metadata?.originator || '').trim().toLowerCase();
          if (LEGACY_MEDHELP_ORIGINATORS.has(originator)) {
            return { isMedHelp: true, metadata, reason: `originator:${originator}` };
          }
        }

        const eventMessage = entry?.type === 'event_msg' && entry.payload?.type === 'user_message'
          ? entry.payload.message
          : '';
        const rolloutMessage = entry?.type === 'response_item' && entry.payload?.role === 'user'
          ? extractCodexMessageText(entry.payload.content)
          : '';
        if (isLegacyMedHelpPrompt(eventMessage) || isLegacyMedHelpPrompt(rolloutMessage)) {
          return { isMedHelp: true, metadata, reason: 'medhelp-prompt' };
        }
        if (entry?.type === 'response_item' && entry.payload?.role === 'assistant') {
          break;
        }
      } catch {}

      // MedHelp's bootstrap prompt is emitted before the first assistant item.
      // Do not scan entire external Codex rollouts once that boundary is passed.
      if (inspectedLines >= 256) break;
    }
  } finally {
    lines.close();
    fileStream.destroy();
  }

  return { isMedHelp: false, metadata, reason: null };
}

async function migrateLegacyMedHelpSessions({ sourceHome, destinationHome }) {
  const markerPath = path.join(destinationHome, LEGACY_SESSION_MIGRATION_MARKER);
  if (await pathExists(markerPath)) {
    return { migrated: 0, skipped: 0, alreadyCompleted: true };
  }

  let migrated = 0;
  let skipped = 0;
  const failures = [];

  for (const relativeRoot of ['sessions', 'archived_sessions']) {
    const sourceRoot = path.join(sourceHome, relativeRoot);
    const files = await findJsonlFiles(sourceRoot);

    for (let index = 0; index < files.length; index += 16) {
      const batch = files.slice(index, index + 16);
      const results = await Promise.all(batch.map(async (sourcePath) => {
        try {
          const compatibility = await inspectLegacyCodexSession(sourcePath);
          if (!compatibility.isMedHelp) {
            return { status: 'skipped' };
          }

          const destinationPath = path.join(destinationHome, path.relative(sourceHome, sourcePath));
          if (await pathExists(destinationPath)) {
            return { status: 'skipped' };
          }

          await copyFileAtomically(sourcePath, destinationPath);
          return { status: 'migrated' };
        } catch (error) {
          return {
            status: 'failed',
            file: sourcePath,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }));

      for (const result of results) {
        if (result.status === 'migrated') migrated += 1;
        else if (result.status === 'skipped') skipped += 1;
        else failures.push({ file: result.file, error: result.error });
      }
    }
  }

  const result = {
    version: 2,
    completedAt: new Date().toISOString(),
    sourceHome,
    migrated,
    skipped,
    failures,
  };

  if (failures.length === 0) {
    await fs.writeFile(markerPath, `${JSON.stringify(result, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  return result;
}

async function ensureLegacyMigration(options = {}) {
  const destinationHome = resolveMedHelpCodexHome(options);
  const sourceHome = resolveSystemCodexHome(options);
  if (path.resolve(destinationHome) === path.resolve(sourceHome)) {
    return { migrated: 0, skipped: 0, alreadyCompleted: true };
  }

  const migrationKey = `${sourceHome}\0${destinationHome}`;
  if (!migrationPromises.has(migrationKey)) {
    const migrationPromise = migrateLegacyMedHelpSessions({ sourceHome, destinationHome })
      .then((result) => {
        if (result.failures?.length > 0) migrationPromises.delete(migrationKey);
        return result;
      })
      .catch((error) => {
        migrationPromises.delete(migrationKey);
        throw error;
      });
    migrationPromises.set(migrationKey, migrationPromise);
  }
  return migrationPromises.get(migrationKey);
}

export function getMedHelpCodexSessionRoots(options = {}) {
  const codexHome = resolveMedHelpCodexHome(options);
  return [
    { path: path.join(codexHome, 'sessions'), archived: false },
    { path: path.join(codexHome, 'archived_sessions'), archived: true },
  ];
}

async function findCodexSessionFileById(rootPath, sessionId) {
  const files = await findJsonlFiles(rootPath);
  return files.find((filePath) => path.basename(filePath).includes(sessionId)) || null;
}

function resolveActiveSessionDestination(activeSessionsRoot, sourcePath, metadata = null) {
  const timestamp = metadata?.timestamp || metadata?.created_at || '';
  const parsedTimestamp = timestamp ? new Date(timestamp) : null;
  const usableTimestamp = parsedTimestamp && !Number.isNaN(parsedTimestamp.getTime())
    ? parsedTimestamp
    : new Date();
  const year = String(usableTimestamp.getUTCFullYear());
  const month = String(usableTimestamp.getUTCMonth() + 1).padStart(2, '0');
  const day = String(usableTimestamp.getUTCDate()).padStart(2, '0');
  return path.join(activeSessionsRoot, year, month, day, path.basename(sourcePath));
}

export async function ensureMedHelpCodexSessionAvailable(sessionId, options = {}) {
  const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!normalizedSessionId) {
    return { available: false, migrated: false };
  }

  const { codexHome, systemCodexHome } = await prepareMedHelpCodexHome(options);
  const activeSessionsRoot = path.join(codexHome, 'sessions');
  const managedActiveFile = await findCodexSessionFileById(activeSessionsRoot, normalizedSessionId);
  if (managedActiveFile) {
    return { available: true, migrated: false, filePath: managedActiveFile };
  }

  const candidateRoots = [
    { path: path.join(codexHome, 'archived_sessions'), trusted: true, managedArchive: true },
    { path: path.join(systemCodexHome, 'sessions'), trusted: false },
    { path: path.join(systemCodexHome, 'archived_sessions'), trusted: false },
  ];

  for (const candidateRoot of candidateRoots) {
    const sourcePath = await findCodexSessionFileById(candidateRoot.path, normalizedSessionId);
    if (!sourcePath) continue;

    const compatibility = await inspectLegacyCodexSession(sourcePath);
    if (!candidateRoot.trusted && !compatibility.isMedHelp) continue;
    if (candidateRoot.managedArchive) {
      return {
        available: true,
        archived: true,
        migrated: false,
        filePath: sourcePath,
      };
    }

    const destinationPath = resolveActiveSessionDestination(
      activeSessionsRoot,
      sourcePath,
      compatibility.metadata,
    );
    await copyFileAtomically(sourcePath, destinationPath);
    return { available: true, archived: false, migrated: true, filePath: destinationPath };
  }

  return { available: false, migrated: false };
}

export async function prepareMedHelpCodexHome(options = {}) {
  const codexHome = resolveMedHelpCodexHome(options);
  const systemCodexHome = resolveSystemCodexHome(options);

  await fs.mkdir(codexHome, { recursive: true, mode: 0o700 });

  if (path.resolve(codexHome) !== path.resolve(systemCodexHome)) {
    await Promise.all(CODEX_BOOTSTRAP_FILES.map((fileName) => (
      syncBootstrapFile(
        path.join(systemCodexHome, fileName),
        path.join(codexHome, fileName),
      )
    )));
  }

  const migration = await ensureLegacyMigration(options);
  return { codexHome, systemCodexHome, migration };
}

export async function buildMedHelpCodexEnvironment(baseEnv = process.env, options = {}) {
  const { codexHome } = await prepareMedHelpCodexHome({
    ...options,
    env: baseEnv,
    codexHome: options.codexHome || baseEnv?.MEDHELP_CODEX_HOME,
  });
  return {
    ...baseEnv,
    CODEX_HOME: codexHome,
  };
}
