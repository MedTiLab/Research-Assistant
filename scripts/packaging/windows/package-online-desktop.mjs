#!/usr/bin/env node

import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Arch, Platform, build } from 'electron-builder';
import {
  countSkillDirectories,
  requirePositiveSkillCount,
} from '../../../desktop/common/skillBundleValidation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../..');
const offlineUi = true;
const distributionLabel = 'Offline';
const stagingDir = path.join(rootDir, 'build', 'offline-desktop-app');
const runtimeDir = path.join(rootDir, 'build', 'secure-headless-kernel');
const resourceSourcesPolicyPath = path.join(rootDir, 'desktop', 'offline', 'resource-sources.json');
const releaseDir = process.env.MEDHELP_DESKTOP_OUTPUT_DIR
  ? path.resolve(rootDir, process.env.MEDHELP_DESKTOP_OUTPUT_DIR)
  : path.join(rootDir, 'release', 'windows', 'offline-desktop');
const rootPackage = JSON.parse(await fs.readFile(path.join(rootDir, 'package.json'), 'utf8'));
const electronPackage = JSON.parse(await fs.readFile(path.join(rootDir, 'node_modules', 'electron', 'package.json'), 'utf8'));
const runtimeManifest = JSON.parse(await fs.readFile(path.join(runtimeDir, 'security-manifest.json'), 'utf8'));
const resourceSourcesPolicy = offlineUi
  ? JSON.parse(await fs.readFile(resourceSourcesPolicyPath, 'utf8'))
  : null;
const expectedSkillCount = requirePositiveSkillCount(
  runtimeManifest.assets?.skillCount,
  'Kernel runtime manifest',
);
const runtimeSkillsDir = path.join(runtimeDir, runtimeManifest.assets?.skillsDir || 'skills');
const runtimeSkillCount = await countSkillDirectories(runtimeSkillsDir);
const installerIncludePath = path.join(
  rootDir,
  'packaging',
  'windows',
  'online-desktop',
  'installer.nsh',
);
const desktopFiles = [
  'desktop/**/*',
  'dist/**/*',
  // Vite mirrors public/downloads into dist. Those release archives are for
  // website delivery and already contain the bundled Kernel, so including
  // them here would add hundreds of megabytes of duplicate payload.
  '!dist/downloads/**',
  'assets/app-icon.png',
  'assets/app-icon.ico',
  'package.json',
];

// GitHub downloads are unreliable on some mainland-China release machines.
// electron-builder still verifies the official archive, but fetches it from a
// stable mirror when the caller did not provide a mirror explicitly.
process.env.ELECTRON_MIRROR ||= 'https://cdn.npmmirror.com/binaries/electron/';
process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||= 'https://npmmirror.com/mirrors/electron-builder-binaries/';

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error(`MedHelp Desktop Windows builds require win32/x64, got ${process.platform}/${process.arch}.`);
}
if (runtimeManifest.version !== rootPackage.version) {
  throw new Error(`Kernel runtime version ${runtimeManifest.version} does not match app version ${rootPackage.version}.`);
}
if (runtimeSkillCount !== expectedSkillCount) {
  throw new Error(`Desktop release skill count mismatch: manifest has ${expectedSkillCount}, runtime has ${runtimeSkillCount}.`);
}
if (
  offlineUi
  && resourceSourcesPolicy?.bundled?.find((entry) => entry.id === 'local-kernel')?.skillCountSource
    !== 'kernel-security-manifest'
) {
  throw new Error('Offline desktop resource source policy must derive its skill count from the Kernel manifest.');
}

await fs.rm(stagingDir, { recursive: true, force: true });
await fs.mkdir(path.join(stagingDir, 'desktop'), { recursive: true });
await fs.mkdir(path.join(stagingDir, 'assets'), { recursive: true });

await Promise.all([
  fs.cp(path.join(rootDir, 'dist'), path.join(stagingDir, 'dist'), { recursive: true }),
  fs.cp(path.join(rootDir, 'desktop', 'online'), path.join(stagingDir, 'desktop', 'online'), { recursive: true }),
  fs.cp(path.join(rootDir, 'desktop', 'common'), path.join(stagingDir, 'desktop', 'common'), { recursive: true }),
  ...(offlineUi ? [
    fs.cp(path.join(rootDir, 'desktop', 'offline'), path.join(stagingDir, 'desktop', 'offline'), { recursive: true }),
  ] : []),
  fs.copyFile(path.join(rootDir, 'public', 'icons', 'app-icon.png'), path.join(stagingDir, 'assets', 'app-icon.png')),
  fs.copyFile(path.join(rootDir, 'public', 'icons', 'app-icon.ico'), path.join(stagingDir, 'assets', 'app-icon.ico')),
  fs.copyFile(
    path.join(rootDir, 'packaging', 'windows', 'online-desktop', 'stop-installed-processes.ps1'),
    path.join(stagingDir, 'assets', 'stop-installed-processes.ps1'),
  ),
  fs.copyFile(
    path.join(rootDir, 'packaging', 'windows', 'online-desktop', 'create-installed-shortcuts.ps1'),
    path.join(stagingDir, 'assets', 'create-installed-shortcuts.ps1'),
  ),
  fs.copyFile(
    path.join(rootDir, 'packaging', 'windows', 'online-desktop', 'repair-installed-executable.ps1'),
    path.join(stagingDir, 'assets', 'repair-installed-executable.ps1'),
  ),
]);

let stagedResourceSourcesPath = null;
if (offlineUi) {
  for (const relativePath of resourceSourcesPolicy.excludedFromBundle) {
    await fs.rm(path.join(stagingDir, relativePath), { recursive: true, force: true });
  }
  const remainingExcludedPaths = [];
  for (const relativePath of resourceSourcesPolicy.excludedFromBundle) {
    try {
      await fs.access(path.join(stagingDir, relativePath));
      remainingExcludedPaths.push(relativePath);
    } catch {
      // Expected: online-only resources must not exist in the staged app.
    }
  }
  if (remainingExcludedPaths.length > 0) {
    throw new Error(`Online-only resources remain in the offline bundle: ${remainingExcludedPaths.join(', ')}`);
  }

  stagedResourceSourcesPath = path.join(stagingDir, 'desktop-resource-sources.json');
  await fs.writeFile(stagedResourceSourcesPath, `${JSON.stringify({
    ...resourceSourcesPolicy,
    build: {
      version: rootPackage.version,
      platform: 'win32',
      arch: 'x64',
      skillCount: runtimeManifest.assets.skillCount,
    },
  }, null, 2)}\n`, 'utf8');
}

await fs.writeFile(path.join(stagingDir, 'package.json'), `${JSON.stringify({
  name: 'medhelp-offline-desktop',
  version: rootPackage.version,
  description: 'MedHelp desktop application with bundled frontend and local Kernel',
  main: 'desktop/offline/main.mjs',
  private: true,
}, null, 2)}\n`, 'utf8');

async function hashDirectory(hash, directory, relativeRoot = directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(relativeRoot, absolutePath).replaceAll(path.sep, '/');
    hash.update(relativePath);
    hash.update('\0');
    if (entry.isDirectory()) {
      await hashDirectory(hash, absolutePath, relativeRoot);
    } else if (entry.isFile()) {
      hash.update(await fs.readFile(absolutePath));
    }
    hash.update('\0');
  }
}

async function resolveWindowsExecutableBuildId() {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(runtimeManifest));
  hash.update(JSON.stringify(desktopFiles));
  hash.update(await fs.readFile(installerIncludePath));
  await hashDirectory(hash, stagingDir);
  return hash.digest('hex').slice(0, 10);
}

const executableBuildId = await resolveWindowsExecutableBuildId();
const executableName = `MedHelp-${rootPackage.version}`;
const executableFileName = `${executableName}.exe`;
const executableRecoveryFileName = '.medhelp-main.bin';

const artifacts = await build({
  projectDir: stagingDir,
  targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
  publish: 'never',
  config: {
    appId: 'com.yzglab.medhelpsec',
    productName: 'MedHelpSec',
    // Keep the install directory conventional while giving each released
    // version a distinct executable name. Shortcuts target this exact file.
    executableName,
    electronVersion: electronPackage.version,
    asar: true,
    compression: 'maximum',
    directories: {
      output: releaseDir,
    },
    files: desktopFiles,
    extraResources: [
      {
        from: runtimeDir,
        to: 'kernel-runtime',
        filter: ['**/*', '!node_modules{,/**/*}'],
      },
      {
        from: path.join(runtimeDir, 'node_modules'),
        to: 'kernel-runtime/node_modules',
        filter: ['**/*'],
      },
      ...(offlineUi ? [{
        from: stagedResourceSourcesPath,
        to: 'desktop-resource-sources.json',
      }] : []),
    ],
    win: {
      icon: path.join(stagingDir, 'assets', 'app-icon.ico'),
      target: ['nsis'],
      requestedExecutionLevel: 'asInvoker',
    },
    nsis: {
      oneClick: false,
      // Use one elevated, per-machine install mode. Previous optional
      // elevation could leave an elevated bundled Kernel that the next
      // non-elevated updater was unable to terminate.
      perMachine: true,
      // Keep this disabled. customInit selects the stable
      // C:\Program Files\MedHelp root before the install section starts.
      allowToChangeInstallationDirectory: false,
      include: installerIncludePath,
      createDesktopShortcut: 'always',
      createStartMenuShortcut: true,
      // Keep a normal, versioned shortcut name. installer.nsh removes the old
      // program files synchronously while preserving user data.
      shortcutName: `MedHelp ${rootPackage.version}`,
      runAfterFinish: true,
      deleteAppDataOnUninstall: false,
    },
    // Some endpoint-protection products allow the complete NSIS payload but
    // remove only a same-path replacement of an unsigned Electron EXE. Keep a
    // byte-identical, non-executable recovery copy inside resources; the NSIS
    // hook uses it only when the normal main executable is missing.
    afterSign: async (context) => {
      await fs.copyFile(
        path.join(context.appOutDir, executableFileName),
        path.join(context.appOutDir, 'resources', executableRecoveryFileName),
      );
    },
    artifactName: `MedHelp-${distributionLabel}-\${version}-win-x64.\${ext}`,
  },
});

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const input = createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', resolve);
  });
  return hash.digest('hex');
}

const installerPath = artifacts.find((artifactPath) => artifactPath.toLowerCase().endsWith('.exe'));
if (!installerPath) {
  throw new Error('electron-builder did not produce the expected Windows installer.');
}
const installerSha256 = await sha256File(installerPath);
const checksumPath = `${installerPath}.sha256`;
await fs.writeFile(checksumPath, `${installerSha256}  ${path.basename(installerPath)}\n`, 'utf8');
const sourceManifestPath = offlineUi
  ? path.join(releaseDir, `MedHelp-Offline-${rootPackage.version}-win-x64.sources.json`)
  : null;
if (sourceManifestPath) {
  await fs.copyFile(stagedResourceSourcesPath, sourceManifestPath);
}

console.log(JSON.stringify({
  ok: true,
  product: 'offline-desktop',
  version: rootPackage.version,
  skillCount: runtimeManifest.assets.skillCount,
  claudeSdk: runtimeManifest.agentPackages?.['@anthropic-ai/claude-agent-sdk'],
  codexSdk: runtimeManifest.agentPackages?.['@openai/codex-sdk'],
  executableName,
  executableBuildId,
  installerSha256,
  checksumPath,
  sourceManifestPath,
  bundledSources: resourceSourcesPolicy?.bundled?.map((entry) => entry.id) || null,
  onlineRequiredSources: resourceSourcesPolicy?.onlineRequired?.map((entry) => entry.id) || null,
  artifacts,
}, null, 2));
