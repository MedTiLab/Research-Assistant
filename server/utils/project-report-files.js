import path from 'path';
import { promises as fs } from 'fs';

/**
 * Report files are discovered by scanning a project's report directories rather
 * than being curated by hand, so nothing has to be copied, registered, or kept
 * in sync: what the panel lists is what is on disk right now.
 */

export const REPORT_SCAN_PREFIXES = [
  'Literature/reports',
  'literature/reports',
  'Survey/reports',
  'survey/reports',
  'Research/reports',
  'Publication',
  'reports',
  'drafts',
  '.pipeline/docs/kb/uploads',
  '.pipeline/docs/kb/notes',
  '.pipeline/docs/kb/news',
];

// Data files (csv/json/bib/…) are deliberately excluded: they live in a project
// as analysis inputs, not as something you read back as a written report. Plain
// .txt is excluded for the same reason — reports are not written in it, so it
// only ever pulls in scratch output that happens to sit in a report directory.
export const REPORT_SCAN_ALLOWED_EXTENSIONS = new Set([
  'md', 'markdown', 'pdf', 'docx', 'html', 'htm', 'tex',
]);

const REPORT_SCAN_MAX_DEPTH = 4;
const REPORT_SCAN_MAX_FILES_PER_PROJECT = 500;

export function isScannedReportRelativePath(relativePath) {
  const normalized = String(relativePath || '').split(path.sep).join('/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) {
    return false;
  }
  const lower = normalized.toLowerCase();
  return REPORT_SCAN_PREFIXES.some((prefix) => {
    const lowerPrefix = prefix.toLowerCase();
    return lower === lowerPrefix || lower.startsWith(`${lowerPrefix}/`);
  });
}

function isInsideProject(projectPath, absoluteTargetPath) {
  const relative = path.relative(path.resolve(projectPath), path.resolve(absoluteTargetPath));
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * The id has to survive a round trip without any stored row, so it is derived
 * from (project, relative path) instead of a database key.
 */
export function encodeReportFileId(projectName, relativePath) {
  return Buffer.from(`${projectName}\n${relativePath}`, 'utf8').toString('base64url');
}

export function decodeReportFileId(id) {
  try {
    const decoded = Buffer.from(String(id || ''), 'base64url').toString('utf8');
    const separator = decoded.indexOf('\n');
    if (separator <= 0) {
      return null;
    }
    const projectName = decoded.slice(0, separator);
    const relativePath = decoded.slice(separator + 1);
    return projectName && relativePath ? { projectName, relativePath } : null;
  } catch {
    return null;
  }
}

export async function scanProjectReportFiles(projectPath) {
  if (!projectPath || !path.isAbsolute(projectPath)) {
    return [];
  }

  const found = new Map();

  const walk = async (absoluteDir, relativeDir, depth) => {
    if (depth > REPORT_SCAN_MAX_DEPTH || found.size >= REPORT_SCAN_MAX_FILES_PER_PROJECT) {
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (found.size >= REPORT_SCAN_MAX_FILES_PER_PROJECT) {
        return;
      }
      // Hidden entries are skipped inside the scanned roots; the roots
      // themselves may still be dot-paths such as .pipeline/docs/kb/uploads.
      if (entry.name.startsWith('.')) {
        continue;
      }

      const childAbs = path.join(absoluteDir, entry.name);
      const childRel = `${relativeDir}/${entry.name}`;

      if (entry.isDirectory()) {
        await walk(childAbs, childRel, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).slice(1).toLowerCase();
      if (!REPORT_SCAN_ALLOWED_EXTENSIONS.has(extension)) {
        continue;
      }

      // The prefix list carries case variants of the same directory, which
      // resolve to one directory on case-insensitive filesystems; keep one
      // entry per path so those do not show up twice.
      const dedupeKey = childRel.toLowerCase();
      if (found.has(dedupeKey)) {
        continue;
      }

      let stats;
      try {
        stats = await fs.stat(childAbs);
      } catch {
        continue;
      }

      found.set(dedupeKey, {
        relativePath: childRel,
        title: entry.name,
        modifiedAt: stats.mtime.toISOString(),
      });
    }
  };

  for (const prefix of REPORT_SCAN_PREFIXES) {
    const absolutePrefix = path.join(projectPath, ...prefix.split('/'));
    if (!isInsideProject(projectPath, absolutePrefix)) {
      continue;
    }
    await walk(absolutePrefix, prefix, 0);
  }

  return Array.from(found.values()).sort(
    (left, right) => new Date(right.modifiedAt).getTime() - new Date(left.modifiedAt).getTime(),
  );
}
