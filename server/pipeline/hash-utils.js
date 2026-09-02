import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';

function normalizeForStableJson(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeForStableJson);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        if (value[key] !== undefined) {
          result[key] = normalizeForStableJson(value[key]);
        }
        return result;
      }, {});
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(normalizeForStableJson(value));
}

function sha256(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ''), 'utf8');
  return `sha256:${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

function hashJson(value) {
  return sha256(stableStringify(value));
}

async function hashFile(filePath) {
  try {
    return sha256(await fs.readFile(filePath));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function buildTaskDefinition(task = {}) {
  const excluded = new Set([
    'status',
    'executionState',
    'createdAt',
    'created',
    'updatedAt',
    'updated',
  ]);
  return Object.keys(task)
    .filter((key) => !excluded.has(key))
    .sort()
    .reduce((result, key) => {
      result[key] = task[key];
      return result;
    }, {});
}

function hashTaskDefinition(task = {}) {
  return hashJson(buildTaskDefinition(task));
}

function hashTasksDefinition(tasks = []) {
  return hashJson((Array.isArray(tasks) ? tasks : []).map(buildTaskDefinition));
}

function resolveProjectRelativePath(projectPath, relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || path.isAbsolute(normalized)) {
    return null;
  }
  const targetPath = path.resolve(projectPath, normalized);
  const projectRoot = `${path.resolve(projectPath)}${path.sep}`;
  return targetPath.startsWith(projectRoot) ? targetPath : null;
}

async function hashProjectFiles(projectPath, relativePaths = []) {
  const entries = await Promise.all((Array.isArray(relativePaths) ? relativePaths : []).map(async (relativePath) => {
    const targetPath = resolveProjectRelativePath(projectPath, relativePath);
    return [String(relativePath), targetPath ? await hashFile(targetPath) : null];
  }));
  return Object.fromEntries(entries);
}

export {
  buildTaskDefinition,
  hashFile,
  hashJson,
  hashProjectFiles,
  hashTaskDefinition,
  hashTasksDefinition,
  normalizeForStableJson,
  resolveProjectRelativePath,
  sha256,
  stableStringify,
};
