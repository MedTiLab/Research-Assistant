import crypto from 'node:crypto';
import fsSync from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveAppDataRoot } from '../utils/storagePaths.js';

const INSTALL_SCHEMA = 'medhelp.mcp-bundle-install.v2';
const MAX_SERVERS = 16;
const MAX_ARGS = 128;
const MAX_ENV_KEYS = 128;
const SAFE_NAME = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;
const SAFE_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SHA256 = /^[a-f0-9]{64}$/;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isInside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fsSync.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function compareVersions(left, right) {
  const parse = (value) => String(value).split(/[+-]/, 1)[0].split('.').map((part) => Number(part) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return String(left).localeCompare(String(right));
}

function normalizeServer(metadata) {
  const server = metadata.piProjection;
  if (!isRecord(server) || server.type !== 'stdio') throw new Error('invalid_projection');
  const command = typeof server.command === 'string' ? server.command.trim() : '';
  if (!command || command.includes('\0') || !path.isAbsolute(command)) throw new Error('invalid_command');
  if (!Array.isArray(server.args) || server.args.length > MAX_ARGS) throw new Error('invalid_args');
  const args = server.args.map((value) => {
    if (typeof value !== 'string' || value.includes('\0') || value.length > 16_000) throw new Error('invalid_args');
    return value;
  });
  if (!isRecord(server.env) || Object.keys(server.env).length > MAX_ENV_KEYS) throw new Error('invalid_env');
  const env = {};
  for (const [key, value] of Object.entries(server.env)) {
    if (!SAFE_ENV_KEY.test(key) || typeof value !== 'string' || value.includes('\0') || value.length > 64_000) {
      throw new Error('invalid_env');
    }
    env[key] = value;
  }
  return { type: 'stdio', command: path.resolve(command), args, env };
}

async function validateInstall(versionDir, expectedName, expectedVersion) {
  const canonicalVersionDir = await fs.realpath(versionDir);
  const metadataPath = path.join(canonicalVersionDir, '.medhelp-mcpb.json');
  const metadataStat = await fs.lstat(metadataPath);
  if (!metadataStat.isFile() || metadataStat.isSymbolicLink() || metadataStat.size > 512 * 1024) {
    throw new Error('invalid_metadata');
  }
  const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  if (
    metadata.schema !== INSTALL_SCHEMA
    || metadata.name !== expectedName
    || metadata.version !== expectedVersion
    || !SHA256.test(String(metadata.sha256 || ''))
    || !SHA256.test(String(metadata.entryPointSha256 || ''))
  ) {
    throw new Error('invalid_metadata');
  }
  const entryPoint = String(metadata.entryPoint || '');
  if (!entryPoint || path.isAbsolute(entryPoint) || entryPoint.split(/[\\/]+/).includes('..')) {
    throw new Error('invalid_entry_point');
  }
  const entryPath = await fs.realpath(path.join(canonicalVersionDir, entryPoint));
  if (!isInside(canonicalVersionDir, entryPath)) throw new Error('entry_point_escape');
  const entryStat = await fs.lstat(entryPath);
  if (!entryStat.isFile() || entryStat.isSymbolicLink()) throw new Error('invalid_entry_point');
  if (await sha256File(entryPath) !== metadata.entryPointSha256) throw new Error('entry_point_tampered');
  const server = normalizeServer(metadata);
  let invokesEntryPoint = false;
  for (const argument of server.args) {
    if (!path.isAbsolute(argument)) continue;
    const canonicalArgument = await fs.realpath(argument).catch(() => path.resolve(argument));
    if (canonicalArgument === entryPath) {
      invokesEntryPoint = true;
      break;
    }
  }
  if (!invokesEntryPoint) {
    throw new Error('entry_point_not_invoked');
  }
  const commandStat = await fs.stat(server.command);
  if (!commandStat.isFile()) throw new Error('invalid_command');
  await fs.access(server.command, process.platform === 'win32' ? fsSync.constants.F_OK : fsSync.constants.X_OK);
  return Object.freeze({
    name: expectedName,
    version: expectedVersion,
    server: Object.freeze({ ...server, args: Object.freeze(server.args), env: Object.freeze(server.env) }),
  });
}

export async function resolveTrustedPiMcpServers(options = {}) {
  const root = path.resolve(options.mcpBundlesRoot || path.join(resolveAppDataRoot(options), 'mcp-bundles'));
  const diagnostics = [];
  let nameEntries;
  try {
    nameEntries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') diagnostics.push({ code: 'root_unavailable' });
    return Object.freeze({ servers: Object.freeze([]), diagnostics: Object.freeze(diagnostics), secretValues: Object.freeze([]) });
  }
  const candidates = [];
  for (const nameEntry of nameEntries) {
    if (!nameEntry.isDirectory() || !SAFE_NAME.test(nameEntry.name)) continue;
    let versionEntries = [];
    try {
      versionEntries = await fs.readdir(path.join(root, nameEntry.name), { withFileTypes: true });
    } catch {
      diagnostics.push({ name: nameEntry.name, code: 'bundle_unavailable' });
      continue;
    }
    const validVersions = [];
    for (const versionEntry of versionEntries) {
      if (!versionEntry.isDirectory() || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(versionEntry.name)) continue;
      try {
        validVersions.push(await validateInstall(
          path.join(root, nameEntry.name, versionEntry.name),
          nameEntry.name,
          versionEntry.name,
        ));
      } catch (error) {
        diagnostics.push({ name: nameEntry.name, version: versionEntry.name, code: error?.message || 'invalid_bundle' });
      }
    }
    validVersions.sort((left, right) => compareVersions(right.version, left.version));
    if (validVersions[0]) candidates.push(validVersions[0]);
  }
  candidates.sort((left, right) => left.name.localeCompare(right.name));
  const servers = candidates.slice(0, MAX_SERVERS);
  for (const skipped of candidates.slice(MAX_SERVERS)) {
    diagnostics.push({ name: skipped.name, version: skipped.version, code: 'limit_exceeded' });
  }
  const secretValues = servers.flatMap(({ server }) => Object.values(server.env))
    .filter((value) => typeof value === 'string' && value.length >= 6);
  return Object.freeze({
    servers: Object.freeze(servers),
    diagnostics: Object.freeze(diagnostics),
    secretValues: Object.freeze(secretValues),
  });
}

export const PI_MCP_INSTALL_SCHEMA = INSTALL_SCHEMA;
export const PI_MCP_PROJECTION_LIMITS = Object.freeze({ maxServers: MAX_SERVERS });
