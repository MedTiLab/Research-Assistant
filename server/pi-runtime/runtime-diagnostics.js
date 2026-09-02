import crypto from 'node:crypto';
import fsSync from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PI_HOST_PROTOCOL_VERSION } from './rpc-client.js';
import { PI_SDK_PACKAGE, PI_SDK_VERSION } from './provider-config.js';

export const PI_RUNTIME_MANIFEST_SCHEMA = 'medhelp.pi-runtime.v2';
// Bump whenever an older prepared sdk-host.mjs must be rejected after an app upgrade.
export const PI_HOST_BUILD_ID = 19;
export const PI_MCP_SDK_PACKAGE = '@modelcontextprotocol/sdk';
export const PI_MCP_SDK_VERSION = '1.29.0';
export const PI_SCHEMA_PACKAGE = 'typebox';
export const PI_SCHEMA_VERSION = '1.3.7';
export const PI_MINIMUM_NODE_VERSION = '22.19.0';

function parseVersion(value) {
  const [major = 0, minor = 0, patch = 0] = String(value || '')
    .replace(/^v/, '')
    .split('.')
    .map((part) => Number(part) || 0);
  return { major, minor, patch };
}

export function isSupportedPiNodeVersion(value) {
  const current = parseVersion(value);
  const minimum = parseVersion(PI_MINIMUM_NODE_VERSION);
  if (current.major !== minimum.major) return current.major > minimum.major;
  if (current.minor !== minimum.minor) return current.minor > minimum.minor;
  return current.patch >= minimum.patch;
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

async function readPackageVersion(runtimeDir, packageName) {
  try {
    const packagePath = path.join(runtimeDir, 'node_modules', ...packageName.split('/'), 'package.json');
    return JSON.parse(await fs.readFile(packagePath, 'utf8')).version || null;
  } catch {
    return null;
  }
}

function publicIssue(code, message) {
  return Object.freeze({ code, message });
}

export async function diagnosePiHostLaunch(launch, options = {}) {
  const prepareCommand = 'npm run pi-runtime:prepare';
  const base = {
    source: launch?.source || 'unknown',
    hostPath: launch?.hostPath || null,
    manifestPath: launch?.hostPath ? path.join(path.dirname(launch.hostPath), 'manifest.json') : null,
    protocolVersion: options.protocolVersion ?? PI_HOST_PROTOCOL_VERSION,
    hostBuildId: PI_HOST_BUILD_ID,
    sdkVersion: PI_SDK_VERSION,
    mcpSdkVersion: PI_MCP_SDK_VERSION,
    schemaLibraryVersion: PI_SCHEMA_VERSION,
    minimumNodeVersion: PI_MINIMUM_NODE_VERSION,
    prepareCommand,
  };
  if (!launch?.hostPath) {
    return Object.freeze({
      ...base,
      status: 'external',
      health: 'degraded',
      available: true,
      verified: false,
      upgradeRequired: false,
      issues: Object.freeze([publicIssue('PI_HOST_EXTERNAL', 'Pi Host uses an externally managed command.')]),
    });
  }
  try {
    const stat = await fs.stat(launch.hostPath);
    if (!stat.isFile()) throw Object.assign(new Error('host path is not a file'), { code: 'ENOENT' });
  } catch {
    return Object.freeze({
      ...base,
      status: 'missing',
      health: 'unavailable',
      available: false,
      verified: false,
      upgradeRequired: false,
      issues: Object.freeze([publicIssue('PI_HOST_NOT_FOUND', `Pi Host is missing. Run "${prepareCommand}".`)]),
    });
  }
  if (!['prepared', 'bundled'].includes(launch.source)) {
    return Object.freeze({
      ...base,
      status: 'external',
      health: 'degraded',
      available: true,
      verified: false,
      upgradeRequired: false,
      issues: Object.freeze([publicIssue('PI_HOST_UNVERIFIED', 'Pi Host path is configured externally and is not covered by the prepared-runtime manifest.')]),
    });
  }

  const issues = [];
  let manifest = null;
  try {
    const manifestStat = await fs.lstat(base.manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink() || manifestStat.size > 512 * 1024) {
      throw new Error('manifest is not a regular file');
    }
    manifest = JSON.parse(await fs.readFile(base.manifestPath, 'utf8'));
  } catch {
    issues.push(publicIssue('PI_RUNTIME_MANIFEST_MISSING', 'Prepared Pi runtime manifest is missing or invalid.'));
  }
  const runtimeDir = path.dirname(launch.hostPath);
  if (manifest) {
    if (manifest.schema !== PI_RUNTIME_MANIFEST_SCHEMA) {
      issues.push(publicIssue('PI_RUNTIME_MANIFEST_OUTDATED', 'Prepared Pi runtime manifest must be upgraded.'));
    }
    if (manifest.kind !== 'pi-sdk-host') issues.push(publicIssue('PI_RUNTIME_KIND_MISMATCH', 'Prepared runtime kind does not match Pi SDK Host.'));
    if (manifest.protocolVersion !== base.protocolVersion) issues.push(publicIssue('PI_HOST_VERSION_MISMATCH', 'Prepared Pi Host protocol version does not match the server.'));
    if (manifest.hostBuildId !== PI_HOST_BUILD_ID) issues.push(publicIssue('PI_HOST_BUILD_OUTDATED', 'Prepared Pi Host build is outdated.'));
    if (manifest.sdkPackage !== PI_SDK_PACKAGE || manifest.sdkVersion !== PI_SDK_VERSION) {
      issues.push(publicIssue('PI_SDK_VERSION_MISMATCH', 'Prepared Pi SDK version does not match the pinned server version.'));
    }
    if (manifest.mcpSdkPackage !== PI_MCP_SDK_PACKAGE || manifest.mcpSdkVersion !== PI_MCP_SDK_VERSION) {
      issues.push(publicIssue('PI_MCP_SDK_VERSION_MISMATCH', 'Prepared MCP SDK version does not match the pinned server version.'));
    }
    if (manifest.schemaPackage !== PI_SCHEMA_PACKAGE || manifest.schemaVersion !== PI_SCHEMA_VERSION) {
      issues.push(publicIssue('PI_SCHEMA_VERSION_MISMATCH', 'Prepared tool-schema library does not match the pinned Host version.'));
    }
    if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
      issues.push(publicIssue('PI_RUNTIME_PLATFORM_MISMATCH', 'Prepared Pi runtime targets a different platform or architecture.'));
    }
    const manifestHostPath = launch.source === 'bundled'
      ? path.resolve(runtimeDir, manifest.hostPath || '')
      : path.resolve(manifest.hostPath || '');
    if (manifestHostPath !== path.resolve(launch.hostPath)
      || (launch.source === 'bundled' && manifest.hostPath !== 'sdk-host.mjs')) {
      issues.push(publicIssue('PI_RUNTIME_PATH_MISMATCH', 'Prepared Pi runtime manifest points to a different Host path.'));
    }
    if (!isSupportedPiNodeVersion(manifest.nodeVersion)) {
      issues.push(publicIssue('PI_NODE_VERSION_UNSUPPORTED', `Pi SDK requires Node.js >=${PI_MINIMUM_NODE_VERSION}.`));
    }
    const actualHostSha256 = await sha256File(launch.hostPath).catch(() => null);
    if (!actualHostSha256 || actualHostSha256 !== manifest.sha256) {
      issues.push(publicIssue('PI_HOST_INTEGRITY_FAILED', 'Prepared Pi Host failed SHA-256 verification.'));
    }
  }
  const [installedSdkVersion, installedMcpSdkVersion, installedSchemaVersion] = await Promise.all([
    readPackageVersion(runtimeDir, PI_SDK_PACKAGE),
    readPackageVersion(runtimeDir, PI_MCP_SDK_PACKAGE),
    readPackageVersion(runtimeDir, PI_SCHEMA_PACKAGE),
  ]);
  if (installedSdkVersion !== PI_SDK_VERSION) {
    issues.push(publicIssue('PI_SDK_NOT_PREPARED', 'Pinned Pi SDK package is missing or has the wrong version.'));
  }
  if (installedMcpSdkVersion !== PI_MCP_SDK_VERSION) {
    issues.push(publicIssue('PI_MCP_SDK_NOT_PREPARED', 'Pinned MCP SDK package is missing or has the wrong version.'));
  }
  if (installedSchemaVersion !== PI_SCHEMA_VERSION) {
    issues.push(publicIssue('PI_SCHEMA_NOT_PREPARED', 'Pinned tool-schema library is missing or has the wrong version.'));
  }
  const available = issues.length === 0;
  return Object.freeze({
    ...base,
    status: available ? 'ready' : 'upgrade_required',
    health: available ? 'healthy' : 'unavailable',
    available,
    verified: available,
    upgradeRequired: !available,
    installedSdkVersion,
    installedMcpSdkVersion,
    installedSchemaVersion,
    preparedNodeVersion: manifest?.nodeVersion || null,
    issues: Object.freeze(issues),
  });
}
