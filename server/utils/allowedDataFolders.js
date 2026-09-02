import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveProjectConfigPath } from './storagePaths.js';

const DATA_ENV_KEYS = [
  'MEDHELP_ALLOWED_DATA_FOLDERS',
  'MEDHELP_LOCAL_DATABASE_APP_ROOT',
  'MEDHELP_LOCAL_DATABASE_RAW_ROOT',
];

// Settings on the execution host are authoritative. Never grant local access
// from a cloud-supplied environment variable or a model-supplied path list.
export function getConfiguredAllowedDataFolders(options = {}) {
  try {
    const config = JSON.parse(fs.readFileSync(resolveProjectConfigPath(options), 'utf8'));
    return normalizeDataFolderPaths(config?._allowedDataFolders);
  } catch {
    return [];
  }
}

export function normalizeDataFolderPaths(entries = []) {
  const seen = new Set();
  const folders = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    let value = typeof entry === 'string' ? entry : entry?.path;
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')) continue;
    value = value.trim();
    if (value === '~') value = os.homedir();
    else if (/^~[/\\]/.test(value)) value = path.join(os.homedir(), value.slice(2));
    if (!path.isAbsolute(value)) continue;
    try {
      const resolved = fs.realpathSync(value);
      if (!fs.statSync(resolved).isDirectory()) continue;
      const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
      if (seen.has(key)) continue;
      seen.add(key);
      folders.push(resolved);
    } catch {
      // Missing/unmounted folders do not confer permission.
    }
  }
  return folders;
}

export function buildAllowedDataFoldersEnv(_folders) {
  return {};
}

export function getAllowedDataFoldersAgentEnv(_options = {}) {
  return {};
}

export function withAllowedDataFoldersAgentEnv(baseEnv = {}, _options = {}) {
  const env = { ...baseEnv };
  // Data folders are no longer mounted into agent sessions.
  for (const key of DATA_ENV_KEYS) delete env[key];
  return env;
}
