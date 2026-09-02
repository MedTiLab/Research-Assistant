import crypto from 'node:crypto';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { PROJECT_DATA_DIRNAME } from '../utils/storagePaths.js';

export function positiveLimit(value, fallback, maximum = 256 * 1024) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, maximum) : fallback;
}

const outputSessionHash = (sessionId) => crypto.createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 24);
const outputFileName = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(?:txt|jpg)(?:\.partial-(\d+))?$/;
const GC_GRACE_MS = 60_000;

// This is a regenerable cache, not an artifact store. Never traverse symlinks or remove user files.
export async function prunePiOutputFiles(projectRoot, { env = process.env, now = Date.now(), sessionId, removeSession = false } = {}) {
  const root = await fs.realpath(projectRoot);
  let directory = root;
  for (const component of [PROJECT_DATA_DIRNAME, 'tool-output']) {
    directory = path.join(directory, component);
    const stat = await fs.lstat(directory).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) return { removedFiles: 0, removedBytes: 0, remainingBytes: 0 };
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory) throw new Error('Pi output directory escaped the project or contains a symlink');
  }
  const maxAge = positiveLimit(env.MEDHELP_PI_OUTPUT_RETENTION_DAYS, 7, 3650) * 86400000;
  const sessionCap = positiveLimit(env.MEDHELP_PI_OUTPUT_CACHE_SESSION_BYTES, 256 * 1024 ** 2, 100 * 1024 ** 3);
  const projectCap = positiveLimit(env.MEDHELP_PI_OUTPUT_CACHE_PROJECT_BYTES, 1024 ** 3, 100 * 1024 ** 3);
  const fileCap = positiveLimit(env.MEDHELP_PI_OUTPUT_CACHE_MAX_FILES, 2000, 100000);
  const files = [], directories = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[0-9a-f]{24}$/.test(entry.name)) continue;
    if (removeSession && entry.name !== outputSessionHash(sessionId)) continue;
    const folder = path.join(directory, entry.name);
    if (await fs.realpath(folder).catch(() => null) !== folder) continue;
    directories.push(folder);
    for (const name of await fs.readdir(folder).catch((error) => { if (error.code === 'ENOENT') return []; throw error; })) {
      const match = name.match(outputFileName);
      if (!match) continue;
      const file = path.join(folder, name);
      const stat = await fs.lstat(file).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
      if (!stat?.isFile() || stat.isSymbolicLink()) continue;
      if (match[1]) {
        // An unfinished capture belongs to a writer, not the cache. Only reap dead writers.
        try { process.kill(Number(match[1]), 0); continue; } catch (error) { if (error.code !== 'ESRCH') continue; }
      }
      files.push({ path: file, folder, size: stat.size, mtime: stat.mtimeMs, ino: stat.ino, partial: Boolean(match[1]) });
    }
  }
  files.sort((a, b) => a.mtime - b.mtime || a.path.localeCompare(b.path));
  const totals = new Map();
  let bytes = 0, count = files.length, removedFiles = 0, removedBytes = 0;
  for (const file of files) { bytes += file.size; totals.set(file.folder, (totals.get(file.folder) || 0) + file.size); }
  for (const file of files) {
    if (!removeSession && now - file.mtime < GC_GRACE_MS) continue;
    if (!removeSession && !file.partial && now - file.mtime <= maxAge && totals.get(file.folder) <= sessionCap && bytes <= projectCap && count <= fileCap) continue;
    if (await fs.realpath(file.folder).catch(() => null) !== file.folder) continue;
    const current = await fs.lstat(file.path).catch(() => null);
    if (!current?.isFile() || current.ino !== file.ino || current.mtimeMs !== file.mtime) continue;
    // Readers can hold completed cache files open on Windows; retry those on a later pass.
    try { await fs.unlink(file.path); } catch (error) { if (['ENOENT', 'EBUSY', 'EPERM', 'EACCES'].includes(error.code)) continue; throw error; }
    removedFiles++; removedBytes += file.size; bytes -= file.size; count--;
    totals.set(file.folder, totals.get(file.folder) - file.size);
  }
  for (const folder of directories) {
    const stat = await fs.lstat(folder).catch(() => null);
    if (!removeSession && stat && now - stat.mtimeMs < GC_GRACE_MS) continue;
    await fs.rmdir(folder).catch((error) => { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST', 'EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error; });
  }
  return { removedFiles, removedBytes, remainingBytes: bytes };
}

// Every directory component is checked: an existing symlink is never followed for output writes.
export async function createOutputFile(projectRoot, sessionId, extension = 'txt', { env = process.env } = {}) {
  if (!['txt', 'jpg'].includes(extension)) throw new Error('Unsupported Pi output extension');
  const root = await fs.realpath(projectRoot);
  await prunePiOutputFiles(root, { env });
  const hash = outputSessionHash(sessionId);
  let directory = root;
  for (const component of [PROJECT_DATA_DIRNAME, 'tool-output', hash]) {
    directory = path.join(directory, component);
    await fs.mkdir(directory, { mode: 0o700 }).catch((error) => { if (error.code !== 'EEXIST') throw error; });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory) throw new Error('Pi output directory escaped the project or contains a symlink');
  }
  const filePath = path.join(directory, `${crypto.randomUUID()}.${extension}`);
  const partialPath = `${filePath}.partial-${process.pid}`;
  const file = await fs.open(partialPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW || 0), 0o600);
  let closing;
  const handle = {
    write: (...args) => file.write(...args),
    writeFile: (...args) => file.writeFile(...args),
    close: () => {
      closing ??= (async () => {
        const completedAt = new Date();
        try { await file.utimes(completedAt, completedAt); } finally { await file.close(); }
        await fs.rename(partialPath, filePath);
        await prunePiOutputFiles(root, { env });
      })();
      return closing;
    },
  };
  return { path: filePath, handle };
}

export function createToolOutputBudget({ projectRoot, sessionId, usedBytes = 0, recordUsage = () => {}, env = process.env }) {
  const normal = positiveLimit(env.MEDHELP_PI_OUTPUT_MAX_BYTES, 50 * 1024);
  const total = positiveLimit(env.MEDHELP_PI_OUTPUT_SESSION_BYTES, 256 * 1024, 1024 ** 3);
  const tight = Math.min(normal, positiveLimit(env.MEDHELP_PI_OUTPUT_TIGHT_BYTES, 12 * 1024));
  const processed = new WeakSet();
  let used = usedBytes;
  let queue = Promise.resolve();
  const serial = (fn) => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
  const consumeFile = (filePath, result = {}, removeSmall = false) => serial(async () => {
    const canonical = await fs.realpath(filePath);
    if (!canonical.startsWith(`${projectRoot}${path.sep}`)) throw new Error('Pi output path escaped the project');
    const file = await fs.open(canonical, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    let bytes, text;
    const limit = used >= total ? tight : normal;
    try {
      bytes = (await file.stat()).size;
      const buffer = Buffer.alloc(Math.min(bytes, limit));
      const read = await file.read(buffer, 0, buffer.length, 0);
      // Drop an incomplete trailing UTF-8 sequence instead of corrupting a multibyte character.
      text = buffer.subarray(0, read.bytesRead).toString('utf8').replace(/\uFFFD$/, '');
    } finally { await file.close(); }
    const truncated = bytes > limit;
    if (truncated) text += `\n[Output truncated: ${bytes} bytes; ${used >= total ? 'session budget reached; tightened ' : ''}per-tool limit ${limit} bytes. Full content: ${canonical}. Use read with offset/limit to inspect more. This cache expires by age/capacity; copy important results to a project artifact.]`;
    used += Buffer.byteLength(text);
    await recordUsage({ usedBytes: used, normalLimit: normal, sessionLimit: total, tightenedLimit: tight });
    if (removeSmall && !truncated) await fs.unlink(canonical);
    const output = { ...result, content: [{ type: 'text', text }, ...(result.content || []).filter((part) => part.type !== 'text')], details: { ...result.details, ...(truncated ? { fullOutputPath: canonical, truncated: true, limitBytes: limit } : {}) } };
    processed.add(output);
    return output;
  });
  return {
    consumeFile,
    resetAfterCompaction: () => serial(async () => {
      await recordUsage({ usedBytes: 0, normalLimit: normal, sessionLimit: total, tightenedLimit: tight, resetReason: 'compaction' });
      used = 0;
    }),
    openCapture: () => createOutputFile(projectRoot, sessionId, 'txt', { env }),
    async apply(result) {
      if (result && typeof result === 'object' && processed.has(result)) return result;
      const content = (result?.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
      if (!content) return result;
      const file = await createOutputFile(projectRoot, sessionId, 'txt', { env });
      try { await file.handle.writeFile(content); } finally { await file.handle.close(); }
      return consumeFile(file.path, result, true);
    },
  };
}
