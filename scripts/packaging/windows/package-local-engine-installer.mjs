#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../..');
const runtimeSource = path.resolve(process.argv[2] || path.join(rootDir, 'build', 'secure-headless-kernel'));
const packagingSource = path.join(rootDir, 'packaging', 'windows', 'local-engine');
const releaseDir = path.join(rootDir, 'release');
const controlDir = path.join(rootDir, 'build', 'windows-kernel-control');

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    ...options,
  });
}

function resolveMakeNsis() {
  const configured = String(process.env.MAKENSIS || '').trim();
  if (configured) return configured;

  const cacheRoot = path.join(
    process.env.LOCALAPPDATA || '',
    'electron-builder',
    'Cache',
    'nsis',
  );
  try {
    const cacheEntries = fsSync.readdirSync(cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, 'en'));
    for (const cacheEntry of cacheEntries) {
      const candidate = path.join(cacheRoot, cacheEntry, 'Bin', 'makensis.exe');
      if (fsSync.existsSync(candidate)) return candidate;
    }
  } catch {
    // Fall through to PATH for machines with a system NSIS installation.
  }
  return 'makensis.exe';
}

async function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  const handle = await fs.open(filePath, 'r');
  try {
    for await (const chunk of handle.createReadStream()) {
      hash.update(chunk);
    }
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`The Windows Kernel installer must be built on Windows x64, not ${process.platform}/${process.arch}.`);
}

const runtimePackage = JSON.parse(await fs.readFile(path.join(runtimeSource, 'package.json'), 'utf8'));
const manifest = JSON.parse(await fs.readFile(path.join(runtimeSource, 'security-manifest.json'), 'utf8'));
const version = String(runtimePackage.version || manifest.version || '0.0.0');
const nodeRuntimeRelativePath = 'bin/node.exe';
const nodeRuntimeSource = path.join(runtimeSource, nodeRuntimeRelativePath);
const kernelEntryRelativePath = manifest.files?.['kernel-entry.cjs'] ? 'kernel-entry.cjs' : 'bin/medhelp-kernel.exe';
const kernelEntrySource = path.join(runtimeSource, kernelEntryRelativePath);
const installerPath = path.join(releaseDir, `MedHelp-Kernel-Installer_${version}_windows-x86_64.exe`);

if (manifest.platform !== 'win32' || manifest.arch !== 'x64') {
  throw new Error(`Runtime is for ${manifest.platform}/${manifest.arch}, not win32/x64.`);
}
if (manifest.policy?.rawFirstPartySourceBundled !== false) {
  throw new Error('Security manifest does not confirm that raw first-party source is excluded.');
}
if (manifest.policy?.desktopApplicationBundled !== false) {
  throw new Error('Security manifest does not confirm that the Desktop application is excluded.');
}
if (manifest.policy?.hostedApplicationOnly !== true) {
  throw new Error('Security manifest does not confirm hosted-application-only mode.');
}

for (const [relativePath, sourcePath] of [
  [nodeRuntimeRelativePath, nodeRuntimeSource],
  [kernelEntryRelativePath, kernelEntrySource],
]) {
  const digest = await sha256(sourcePath);
  if (manifest.files?.[relativePath] !== digest) {
    throw new Error(`${relativePath} checksum does not match security-manifest.json.`);
  }
}

await fs.mkdir(releaseDir, { recursive: true });
await fs.rm(installerPath, { force: true });
await fs.rm(`${installerPath}.sha256`, { force: true });
await fs.rm(controlDir, { recursive: true, force: true });
await fs.mkdir(controlDir, { recursive: true });

const controlPath = path.join(controlDir, 'medhelp-kernelctl.mjs');
await build({
  entryPoints: [path.join(rootDir, 'npm', 'windows-headless', 'cli.mjs')],
  outfile: controlPath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  define: {
    __MEDHELP_KERNEL_VERSION__: JSON.stringify(version),
  },
});
const controlSource = await fs.readFile(controlPath, 'utf8');
if (controlSource.includes('sourceMappingURL') || /BrowserWindow|electron/i.test(controlSource)) {
  throw new Error('Windows Kernel control command contains a source map or frontend runtime.');
}

const makeNsis = resolveMakeNsis();
run(makeNsis, [
  `/DPRODUCT_VERSION=${version}`,
  `/DRUNTIME_DIR=${runtimeSource}`,
  `/DCONTROL_DIR=${controlDir}`,
  `/DPACKAGING_DIR=${packagingSource}`,
  `/DOUTPUT_FILE=${installerPath}`,
  path.join(packagingSource, 'installer.nsi'),
]);

const installerDigest = await sha256(installerPath);
const stat = await fs.stat(installerPath);
await fs.writeFile(`${installerPath}.sha256`, `${installerDigest}  ${path.basename(installerPath)}\n`, 'utf8');

console.log(JSON.stringify({
  ok: true,
  installerPath,
  version,
  arch: process.arch,
  bytes: stat.size,
  sha256: installerDigest,
  installMode: 'headless-manual-control',
  controlCommand: 'medhelp-kernelctl',
  desktopApplicationBundled: false,
}, null, 2));
