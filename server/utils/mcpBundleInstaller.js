import crypto from 'node:crypto';
import fsSync from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { resolveAppDataRoot } from './storagePaths.js';
import { PI_MCP_INSTALL_SCHEMA } from '../pi-runtime/mcp-projection.js';

const MAX_BUNDLE_FILES = 10_000;
const MAX_BUNDLE_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 512 * 1024;
const SUPPORTED_MANIFEST_VERSIONS = new Set(['0.1', '0.2', '0.3']);
const configUpdateQueues = new Map();

export class McpBundleInstallError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'McpBundleInstallError';
    this.status = status;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeBundleName(value) {
  const name = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/.test(name)) {
    throw new McpBundleInstallError('Bundle manifest has an invalid machine-readable name.');
  }
  return name;
}

function safeBundleVersion(value) {
  const version = String(value || '').trim();
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new McpBundleInstallError('Bundle manifest has an invalid semantic version.');
  }
  return version;
}

function normalizeEntryName(rawName) {
  const entryName = String(rawName || '').replace(/\\/g, '/');
  if (
    !entryName
    || entryName.includes('\0')
    || entryName.startsWith('/')
    || /^[A-Za-z]:\//.test(entryName)
    || entryName.split('/').some((part) => part === '..' || part === '.')
  ) {
    throw new McpBundleInstallError('Bundle contains an unsafe file path.');
  }
  return entryName.replace(/\/+$/g, '');
}

function entryIsSymlink(entry) {
  const unixMode = (Number(entry.attr || 0) >>> 16) & 0o170000;
  return unixMode === 0o120000;
}

function inspectManifest(manifest, entriesByName) {
  if (!isRecord(manifest)) throw new McpBundleInstallError('manifest.json must contain an object.');
  if (!SUPPORTED_MANIFEST_VERSIONS.has(String(manifest.manifest_version || manifest.dxt_version || ''))) {
    throw new McpBundleInstallError('Unsupported MCP bundle manifest version.');
  }
  const name = safeBundleName(manifest.name);
  const version = safeBundleVersion(manifest.version);
  if (!isRecord(manifest.author) || !String(manifest.author.name || '').trim()) {
    throw new McpBundleInstallError('Bundle manifest must identify its author.');
  }
  if (!isRecord(manifest.server) || manifest.server.type !== 'node') {
    throw new McpBundleInstallError('MedHelp currently installs self-contained Node.js MCP bundles only.');
  }
  const entryPoint = normalizeEntryName(manifest.server.entry_point);
  const entry = entriesByName.get(entryPoint);
  if (!entry || entry.isDirectory || !/\.(?:cjs|mjs|js)$/i.test(entryPoint)) {
    throw new McpBundleInstallError('Bundle server entry point is missing or is not a JavaScript file.');
  }
  return { name, version, entryPoint };
}

export function inspectMcpBundle(archivePath) {
  let zip;
  try {
    zip = new AdmZip(archivePath);
  } catch (error) {
    throw new McpBundleInstallError(`Unable to open MCP bundle: ${error.message}`);
  }
  const entries = zip.getEntries();
  if (entries.length === 0) throw new McpBundleInstallError('MCP bundle is empty.');
  if (entries.length > MAX_BUNDLE_FILES) {
    throw new McpBundleInstallError(`MCP bundle contains too many files (maximum ${MAX_BUNDLE_FILES}).`);
  }

  const entriesByName = new Map();
  const caseInsensitiveNames = new Set();
  let expandedBytes = 0;
  for (const entry of entries) {
    const entryName = normalizeEntryName(entry.entryName);
    if (!entryName) continue;
    const portableKey = entryName.toLocaleLowerCase('en-US');
    if (caseInsensitiveNames.has(portableKey)) {
      throw new McpBundleInstallError(`MCP bundle contains a duplicate path: ${entryName}`);
    }
    caseInsensitiveNames.add(portableKey);
    if (entryIsSymlink(entry)) {
      throw new McpBundleInstallError('MCP bundle contains a symbolic link, which is not allowed.');
    }
    if ((Number(entry.header?.flags || 0) & 1) === 1) {
      throw new McpBundleInstallError('Encrypted MCP bundles are not supported.');
    }
    const bytes = entry.isDirectory ? 0 : Number(entry.header?.size || 0);
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new McpBundleInstallError('MCP bundle contains an invalid file size.');
    }
    expandedBytes += bytes;
    if (expandedBytes > MAX_BUNDLE_EXPANDED_BYTES) {
      throw new McpBundleInstallError('Expanded MCP bundle is too large (maximum 512 MiB).');
    }
    entriesByName.set(entryName, entry);
  }

  const manifestEntry = entriesByName.get('manifest.json');
  if (!manifestEntry || manifestEntry.isDirectory) {
    throw new McpBundleInstallError('MCP bundle must contain manifest.json at its root.');
  }
  if (Number(manifestEntry.header?.size || 0) > MAX_MANIFEST_BYTES) {
    throw new McpBundleInstallError('MCP bundle manifest is too large.');
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
  } catch (error) {
    throw new McpBundleInstallError(`Invalid MCP bundle manifest: ${error.message}`);
  }
  const identity = inspectManifest(manifest, entriesByName);
  return { zip, entries, manifest, expandedBytes, ...identity };
}

function substituteManifestValue(value, variables) {
  const source = String(value ?? '');
  let result = source;
  for (const [key, replacement] of Object.entries(variables)) {
    result = result.split('${' + key + '}').join(replacement);
  }
  if (/\$\{(?:user_config|[^}]+)\}/.test(result)) {
    throw new McpBundleInstallError('Bundle requires configuration values that MedHelp cannot collect yet.');
  }
  const pathVariableMatch = source.match(/^\$\{(__dirname|HOME|DESKTOP|DOCUMENTS|DOWNLOADS)\}([\\/].*)?$/);
  if (pathVariableMatch) {
    const [, variableName, suffix = ''] = pathVariableMatch;
    return path.join(variables[variableName], ...suffix.split(/[\\/]+/).filter(Boolean));
  }
  return result;
}

async function isExecutable(file) {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return false;
    await fs.access(file, process.platform === 'win32' ? fsSync.constants.F_OK : fsSync.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveBundledNode(options = {}) {
  const processExecPath = path.resolve(options.processExecPath || process.execPath);
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const nodeName = platform === 'win32' ? 'node.exe' : 'node';
  const candidates = [
    env.MEDHELP_NODE_EXECUTABLE,
    path.join(path.dirname(processExecPath), nodeName),
    /^(?:node|node\.exe)$/i.test(path.basename(processExecPath)) ? processExecPath : null,
  ].filter(Boolean).map((candidate) => path.resolve(candidate));
  for (const candidate of [...new Set(candidates)]) {
    if (await isExecutable(candidate)) return { command: candidate, env: {} };
  }
  if (process.versions.electron && await isExecutable(processExecPath)) {
    return { command: processExecPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
  }
  throw new McpBundleInstallError('MedHelp bundled Node.js runtime could not be found.', 500);
}

async function readClaudeConfig(configPath) {
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error('configuration root is not an object');
    return { document: parsed, exists: true, raw };
  } catch (error) {
    if (error.code === 'ENOENT') return { document: {}, exists: false, raw: null };
    throw new McpBundleInstallError(`Unable to read Claude MCP configuration: ${error.message}`, 500);
  }
}

function sameServerConfig(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createPiProjectionMetadata(inspection, digest, serverConfig, installedAt = new Date().toISOString()) {
  const entryPointEntry = inspection.entries.find(
    (entry) => normalizeEntryName(entry.entryName) === inspection.entryPoint,
  );
  if (!entryPointEntry || entryPointEntry.isDirectory) {
    throw new McpBundleInstallError('MCP bundle entry point could not be verified.');
  }
  const entryPointSha256 = crypto
    .createHash('sha256')
    .update(entryPointEntry.getData())
    .digest('hex');
  return {
    schema: PI_MCP_INSTALL_SCHEMA,
    name: inspection.name,
    displayName: inspection.manifest.display_name || inspection.name,
    version: inspection.version,
    sha256: digest,
    installedAt,
    fileCount: inspection.entries.length,
    expandedBytes: inspection.expandedBytes,
    entryPoint: inspection.entryPoint,
    entryPointSha256,
    piProjection: serverConfig,
  };
}

async function writeClaudeConfig(configPath, document, previous) {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const candidatePath = `${configPath}.medhelp-new-${process.pid}-${Date.now()}`;
  let backupPath = null;
  let removedOriginal = false;
  if (previous.exists) {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '');
    backupPath = `${configPath}.${stamp}-${process.pid}-${crypto.randomBytes(4).toString('hex')}.medhelp.bak`;
    await fs.copyFile(configPath, backupPath, fsSync.constants.COPYFILE_EXCL);
  }
  try {
    await fs.writeFile(candidatePath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    JSON.parse(await fs.readFile(candidatePath, 'utf8'));
    try {
      await fs.rename(candidatePath, configPath);
    } catch (error) {
      if (process.platform !== 'win32' || !['EEXIST', 'EPERM'].includes(error.code)) throw error;
      await fs.unlink(configPath);
      removedOriginal = true;
      await fs.rename(candidatePath, configPath);
    }
  } catch (error) {
    await fs.unlink(candidatePath).catch(() => {});
    if (removedOriginal && backupPath) {
      await fs.copyFile(backupPath, configPath).catch(() => {});
    }
    throw new McpBundleInstallError(`Unable to update Claude MCP configuration: ${error.message}`, 500);
  }
  return backupPath;
}

function queueConfigUpdate(configPath, task) {
  const previous = configUpdateQueues.get(configPath) || Promise.resolve();
  const current = previous.then(task, task);
  configUpdateQueues.set(configPath, current.catch(() => {}));
  return current;
}

async function extractBundle(inspection, stagingDir) {
  for (const entry of inspection.entries) {
    const entryName = normalizeEntryName(entry.entryName);
    if (!entryName) continue;
    const destination = path.resolve(stagingDir, ...entryName.split('/'));
    const relative = path.relative(stagingDir, destination);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new McpBundleInstallError('MCP bundle path escaped the installation directory.');
    }
    if (entry.isDirectory) {
      await fs.mkdir(destination, { recursive: true });
      continue;
    }
    await fs.mkdir(path.dirname(destination), { recursive: true });
    let data;
    try {
      data = entry.getData();
    } catch (error) {
      throw new McpBundleInstallError(`Failed to verify bundled file ${entryName}: ${error.message}`);
    }
    await fs.writeFile(destination, data, { flag: 'wx', mode: 0o600 });
  }
}

export async function installMcpBundle(options) {
  const target = options.target || 'claude';
  if (!['pi', 'claude'].includes(target)) throw new McpBundleInstallError('Unsupported MCP installation target');
  const archivePath = path.resolve(options.archivePath);
  const homeDir = path.resolve(options.homeDir || os.homedir());
  const dataRoot = path.resolve(options.dataRoot || resolveAppDataRoot({ homeDir }));
  const inspection = inspectMcpBundle(archivePath);
  const digest = await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fsSync.createReadStream(archivePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
  const installRoot = path.join(dataRoot, 'mcp-bundles', inspection.name, inspection.version);
  const nodeRuntime = await resolveBundledNode(options);
  const variables = {
    __dirname: installRoot,
    HOME: homeDir,
    DESKTOP: path.join(homeDir, 'Desktop'),
    DOCUMENTS: path.join(homeDir, 'Documents'),
    DOWNLOADS: path.join(homeDir, 'Downloads'),
    pathSeparator: path.sep,
    '/': path.sep,
  };
  const declaredConfig = isRecord(inspection.manifest.server.mcp_config)
    ? inspection.manifest.server.mcp_config
    : {};
  const declaredArgs = Array.isArray(declaredConfig.args)
    ? declaredConfig.args.map((value) => substituteManifestValue(value, variables))
    : [];
  const installedEntryPoint = path.join(installRoot, ...inspection.entryPoint.split('/'));
  const args = declaredArgs.some((value) => path.resolve(value) === path.resolve(installedEntryPoint))
    ? declaredArgs
    : [installedEntryPoint, ...declaredArgs];
  const declaredEnv = isRecord(declaredConfig.env) ? declaredConfig.env : {};
  const serverConfig = {
    type: 'stdio',
    command: nodeRuntime.command,
    args,
    env: {
      ...Object.fromEntries(Object.entries(declaredEnv).map(([key, value]) => [key, substituteManifestValue(value, variables)])),
      ...nodeRuntime.env,
      MEDHELP_MCP_BUNDLE_ROOT: installRoot,
      MEDHELP_MCP_BUNDLE_SHA256: digest,
    },
  };
  const configPath = target === 'claude' ? path.join(homeDir, '.claude.json') : null;

  // Serialize both targets on the same lock: they share the installed bundle directory.
  return queueConfigUpdate(path.join(homeDir, '.claude.json'), async () => {
    const previous = configPath ? await readClaudeConfig(configPath) : { document: {} };
    const existing = isRecord(previous.document.mcpServers)
      ? previous.document.mcpServers[inspection.name]
      : undefined;
    if (existing && !sameServerConfig(existing, serverConfig)) {
      throw new McpBundleInstallError(
        `An MCP server named "${inspection.name}" is already configured. Remove it before installing this bundle.`,
        409,
      );
    }

    let reused = false;
    let createdInstall = false;
    try {
      const metadataPath = path.join(installRoot, '.medhelp-mcpb.json');
      try {
        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
        if (metadata.sha256 !== digest) {
          throw new McpBundleInstallError('A different bundle is already installed with this name and version.', 409);
        }
        const entryStat = await fs.stat(installedEntryPoint).catch(() => null);
        if (!entryStat?.isFile()) {
          throw new McpBundleInstallError('Existing MCP bundle installation is incomplete or invalid.', 409);
        }
        const expectedMetadata = createPiProjectionMetadata(
          inspection,
          digest,
          serverConfig,
          metadata.installedAt,
        );
        const installedEntrySha256 = crypto
          .createHash('sha256')
          .update(await fs.readFile(installedEntryPoint))
          .digest('hex');
        if (installedEntrySha256 !== expectedMetadata.entryPointSha256) {
          throw new McpBundleInstallError('Existing MCP bundle entry point failed integrity verification.', 409);
        }
        if (metadata.schema !== PI_MCP_INSTALL_SCHEMA || !sameServerConfig(metadata.piProjection, serverConfig)) {
          await fs.writeFile(metadataPath, `${JSON.stringify(expectedMetadata, null, 2)}\n`, {
            encoding: 'utf8',
            mode: 0o600,
          });
        }
        reused = true;
      } catch (error) {
        if (error instanceof McpBundleInstallError) throw error;
        if (error.code !== 'ENOENT') {
          throw new McpBundleInstallError('Existing MCP bundle installation is incomplete or invalid.', 409);
        }
        await fs.mkdir(path.dirname(installRoot), { recursive: true });
        const stagingDir = await fs.mkdtemp(path.join(path.dirname(installRoot), '.mcpb-install-'));
        try {
          await extractBundle(inspection, stagingDir);
          const projectionMetadata = createPiProjectionMetadata(
            inspection,
            digest,
            serverConfig,
          );
          await fs.writeFile(
            path.join(stagingDir, '.medhelp-mcpb.json'),
            `${JSON.stringify(projectionMetadata, null, 2)}\n`,
            { flag: 'wx', mode: 0o600 },
          );
          await fs.rename(stagingDir, installRoot);
          createdInstall = true;
        } catch (error) {
          await fs.rm(stagingDir, { recursive: true, force: true });
          throw error;
        }
      }

      let backupPath = null;
      if (configPath && !existing) {
        const nextDocument = {
          ...previous.document,
          mcpServers: {
            ...(isRecord(previous.document.mcpServers) ? previous.document.mcpServers : {}),
            [inspection.name]: serverConfig,
          },
        };
        backupPath = await writeClaudeConfig(configPath, nextDocument, previous);
      }
      return {
        name: inspection.name,
        displayName: inspection.manifest.display_name || inspection.name,
        version: inspection.version,
        description: inspection.manifest.description || '',
        installRoot,
        configPath,
        backupPath,
        command: serverConfig.command,
        fileCount: inspection.entries.length,
        expandedBytes: inspection.expandedBytes,
        sha256: digest,
        reused,
        target,
      };
    } catch (error) {
      if (createdInstall) await fs.rm(installRoot, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  });
}
