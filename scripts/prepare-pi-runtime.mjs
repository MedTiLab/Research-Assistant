#!/usr/bin/env node

import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAppDataRoot } from '../server/utils/storagePaths.js';
import { PI_HOST_PROTOCOL_VERSION } from '../server/pi-runtime/rpc-client.js';
import { PI_SDK_PACKAGE, PI_SDK_VERSION } from '../server/pi-runtime/provider-config.js';
import {
  PI_HOST_BUILD_ID,
  PI_MCP_SDK_PACKAGE,
  PI_MCP_SDK_VERSION,
  PI_MINIMUM_NODE_VERSION,
  PI_RUNTIME_MANIFEST_SCHEMA,
  PI_SCHEMA_PACKAGE,
  PI_SCHEMA_VERSION,
  isSupportedPiNodeVersion,
} from '../server/pi-runtime/runtime-diagnostics.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const useFaux = process.argv.includes('--faux');
const bundleHost = process.argv.includes('--bundle-host');
const outputDirIndex = process.argv.indexOf('--output-dir');
const explicitOutputDir = outputDirIndex >= 0 ? process.argv[outputDirIndex + 1] : null;
if (outputDirIndex >= 0 && (!explicitOutputDir || explicitOutputDir.startsWith('--'))) {
  throw new Error('--output-dir requires a directory.');
}
if (bundleHost && (useFaux || !explicitOutputDir)) {
  throw new Error('--bundle-host requires --output-dir and the real Pi SDK Host.');
}
const runtimeVersion = useFaux ? 'spike' : PI_SDK_VERSION;
const runtimeDir = explicitOutputDir ? path.resolve(explicitOutputDir) : path.join(
  resolveAppDataRoot(),
  'pi',
  'runtime',
  runtimeVersion,
  `${process.platform}-${process.arch}`,
);
const sourcePath = path.join(
  repoRoot,
  'server',
  'pi-runtime',
  useFaux ? 'faux-host.mjs' : 'sdk-host.mjs',
);
const targetPath = path.join(runtimeDir, useFaux ? 'pi-faux-host.mjs' : 'sdk-host.mjs');
const manifestPath = path.join(runtimeDir, 'manifest.json');

function assertSupportedNode() {
  if (useFaux) return;
  if (!isSupportedPiNodeVersion(process.version)) {
    throw new Error(
      `Pi SDK ${PI_SDK_VERSION} requires Node.js >=${PI_MINIMUM_NODE_VERSION}; current runtime is ${process.version}.`,
    );
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${signal || code}).`));
    });
  });
}

async function installedPackageVersion(packageName) {
  try {
    const packagePath = path.join(runtimeDir, 'node_modules', ...packageName.split('/'), 'package.json');
    return JSON.parse(await fs.readFile(packagePath, 'utf8')).version || null;
  } catch {
    return null;
  }
}

assertSupportedNode();
await fs.mkdir(runtimeDir, { recursive: true, mode: 0o700 });
if (bundleHost) await fs.chmod(runtimeDir, 0o755);
const [installedSdkVersion, installedMcpSdkVersion, installedSchemaVersion] = useFaux
  ? [null, null, null]
  : await Promise.all([
      installedPackageVersion(PI_SDK_PACKAGE),
      installedPackageVersion(PI_MCP_SDK_PACKAGE),
      installedPackageVersion(PI_SCHEMA_PACKAGE),
    ]);
if (
  !useFaux
  && (
    installedSdkVersion !== PI_SDK_VERSION
    || installedMcpSdkVersion !== PI_MCP_SDK_VERSION
    || installedSchemaVersion !== PI_SCHEMA_VERSION
  )
) {
  const npmCommand = process.platform === 'win32' ? process.execPath : 'npm';
  const npmArgs = process.platform === 'win32'
    ? [
        process.env.npm_execpath
          || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        'install',
      ]
    : ['install'];
  await run(npmCommand, [
    ...npmArgs,
    '--prefix', runtimeDir,
    '--ignore-scripts',
    '--omit=dev',
    '--no-package-lock',
    '--save-exact',
    `${PI_SDK_PACKAGE}@${PI_SDK_VERSION}`,
    `${PI_MCP_SDK_PACKAGE}@${PI_MCP_SDK_VERSION}`,
    `${PI_SCHEMA_PACKAGE}@${PI_SCHEMA_VERSION}`,
  ]);
}

if (!useFaux) {
  const { build } = await import('esbuild');
  await build({
    entryPoints: [sourcePath],
    outfile: targetPath,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    target: 'node22',
    minify: bundleHost,
    sourcemap: false,
    legalComments: 'none',
  });
} else {
  await fs.copyFile(sourcePath, targetPath);
}
const source = await fs.readFile(targetPath);
const sha256 = crypto.createHash('sha256').update(source).digest('hex');
await fs.chmod(targetPath, bundleHost ? 0o755 : 0o700);
const manifest = {
  schema: PI_RUNTIME_MANIFEST_SCHEMA,
  kind: useFaux ? 'pi-host-spike' : 'pi-sdk-host',
  provider: useFaux ? 'faux' : 'openai-compatible',
  protocolVersion: PI_HOST_PROTOCOL_VERSION,
  hostBuildId: useFaux ? null : PI_HOST_BUILD_ID,
  sdkPackage: useFaux ? null : PI_SDK_PACKAGE,
  sdkVersion: useFaux ? null : PI_SDK_VERSION,
  mcpSdkPackage: useFaux ? null : PI_MCP_SDK_PACKAGE,
  mcpSdkVersion: useFaux ? null : PI_MCP_SDK_VERSION,
  schemaPackage: useFaux ? null : PI_SCHEMA_PACKAGE,
  schemaVersion: useFaux ? null : PI_SCHEMA_VERSION,
  minimumNodeVersion: useFaux ? null : PI_MINIMUM_NODE_VERSION,
  nodeVersion: process.version,
  platform: process.platform,
  arch: process.arch,
  hostPath: bundleHost ? path.basename(targetPath) : targetPath,
  sha256,
  preparedAt: new Date().toISOString(),
};
await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
  encoding: 'utf8',
  mode: bundleHost ? 0o644 : 0o600,
});
if (bundleHost) await fs.chmod(manifestPath, 0o644);

process.stdout.write(`${JSON.stringify({
  prepared: true,
  ...manifest,
  manifestPath,
})}\n`);
