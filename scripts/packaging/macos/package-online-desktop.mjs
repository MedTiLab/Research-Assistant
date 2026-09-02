#!/usr/bin/env node

import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Arch, Platform, build } from 'electron-builder';
import { extractFile, listPackage } from '@electron/asar';
import { assertNodePtySpawnHelperExecutable } from '../../node-pty-spawn-helper.mjs';
import { diagnosePiHostLaunch } from '../../../server/pi-runtime/runtime-diagnostics.js';
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
const macEntitlementsPath = path.join(rootDir, 'scripts', 'packaging', 'macos', 'entitlements.mac.plist');
const resourceSourcesPolicyPath = path.join(rootDir, 'desktop', 'offline', 'resource-sources.json');
const releaseDir = process.env.MEDHELP_DESKTOP_OUTPUT_DIR
  ? path.resolve(rootDir, process.env.MEDHELP_DESKTOP_OUTPUT_DIR)
  : path.join(rootDir, 'release');
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

process.env.ELECTRON_MIRROR ||= 'https://cdn.npmmirror.com/binaries/electron/';

if (process.platform !== 'darwin') {
  throw new Error(`MedHelp Desktop macOS builds require darwin, got ${process.platform}/${process.arch}.`);
}
if (!['arm64', 'x64'].includes(process.arch)) {
  throw new Error(`MedHelp Desktop macOS builds do not support ${process.arch}.`);
}
if (runtimeManifest.platform !== 'darwin' || runtimeManifest.arch !== process.arch) {
  throw new Error(`Kernel runtime is for ${runtimeManifest.platform}/${runtimeManifest.arch}, but this build is darwin/${process.arch}.`);
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
if (runtimeManifest.policy?.hostedApplicationOnly !== true || runtimeManifest.policy?.rawFirstPartySourceBundled !== false) {
  throw new Error('Kernel runtime security policy is not valid for the Desktop distribution.');
}

// Refuse to produce a DMG whose bundled Kernel cannot launch password or
// interactive SSH sessions. Finder-launched apps cannot rely on postinstall
// scripts to repair node-pty after the app has been signed.
assertNodePtySpawnHelperExecutable({ runtimeRoot: runtimeDir });

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
  fs.copyFile(path.join(rootDir, 'public', 'icons', 'app-icon.icns'), path.join(stagingDir, 'assets', 'app-icon.icns')),
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
      platform: 'darwin',
      arch: process.arch,
      skillCount: runtimeManifest.assets.skillCount,
    },
  }, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    offlineResourceSources: {
      bundled: resourceSourcesPolicy.bundled.map((entry) => entry.id),
      onlineRequired: resourceSourcesPolicy.onlineRequired.map((entry) => entry.id),
      excludedFromBundle: resourceSourcesPolicy.excludedFromBundle,
    },
  }, null, 2));
}

await fs.writeFile(path.join(stagingDir, 'package.json'), `${JSON.stringify({
  name: 'medhelp-offline-desktop',
  version: rootPackage.version,
  description: 'MedHelp desktop application with bundled frontend and local engine',
  author: rootPackage.author,
  main: 'desktop/offline/main.mjs',
  private: true,
}, null, 2)}\n`, 'utf8');

const electronArch = process.arch === 'arm64' ? Arch.arm64 : Arch.x64;
const validatePackagedApp = async (context) => {
  const appPath = path.join(context.appOutDir, 'MedHelp.app');
  const resourcesPath = path.join(appPath, 'Contents', 'Resources');
  const requiredFiles = [
    path.join(appPath, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Versions', 'A', 'Electron Framework'),
    path.join(resourcesPath, 'kernel-runtime', 'bin', 'medhelp-kernel'),
    path.join(resourcesPath, 'app.asar'),
  ];
  for (const requiredFile of requiredFiles) {
    const stats = await fs.stat(requiredFile).catch(() => null);
    if (!stats?.isFile() || stats.size === 0) {
      throw new Error(`Packaged macOS application is missing required file: ${requiredFile}`);
    }
  }

  const piDiagnostics = await diagnosePiHostLaunch({
    source: 'bundled',
    hostPath: path.join(resourcesPath, 'kernel-runtime', 'pi-runtime', 'sdk-host.mjs'),
  });
  if (!piDiagnostics.verified) {
    throw new Error(`Packaged Pi runtime is not ready: ${JSON.stringify(piDiagnostics.issues)}`);
  }

  const packagedSkillsRoot = path.join(resourcesPath, 'kernel-runtime', 'skills');
  const packagedSkillCount = await countSkillDirectories(packagedSkillsRoot);
  if (packagedSkillCount !== expectedSkillCount) {
    throw new Error(`Packaged macOS application requires ${expectedSkillCount} SKILL.md files, found ${packagedSkillCount}.`);
  }

  const kernelBinary = await fs.readFile(path.join(resourcesPath, 'kernel-runtime', 'bin', 'medhelp-kernel'));
  for (const marker of ['Memory must be brief: return at most 5 facts', '<medhelp_project_memory>']) {
    if (!kernelBinary.includes(Buffer.from(marker))) {
      throw new Error(`Bundled Kernel is missing required project-memory marker: ${marker}`);
    }
  }

  const appAsarPath = path.join(resourcesPath, 'app.asar');
  const rendererBundles = listPackage(appAsarPath)
    .filter((entry) => /^\/dist\/assets\/.*\.js$/.test(entry));
  let hasProjectMemoryFilter = false;
  let hasSessionCacheMigration = false;
  for (const entry of rendererBundles) {
    const source = extractFile(appAsarPath, entry.slice(1)).toString('utf8');
    hasProjectMemoryFilter ||= source.includes('## What you remember') && source.includes('medhelp_project_memory');
    hasSessionCacheMigration ||= source.includes('chat_messages_') && source.includes('session-created');
    if (hasProjectMemoryFilter && hasSessionCacheMigration) break;
  }
  if (!hasProjectMemoryFilter || !hasSessionCacheMigration) {
    throw new Error('Packaged renderer is missing the project-memory filter or live-session cache migration.');
  }

  console.log(JSON.stringify({
    packagedAppValidation: {
      appPath,
      packagedSkillCount,
      hasProjectMemoryFilter,
      hasSessionCacheMigration,
      piSdkVersion: piDiagnostics.installedSdkVersion,
      piHostVerified: piDiagnostics.verified,
    },
  }, null, 2));
};

const artifacts = await build({
  projectDir: stagingDir,
  targets: Platform.MAC.createTarget(['dmg'], electronArch),
  publish: 'never',
  config: {
    appId: 'com.yzglab.medhelpsec',
    productName: 'MedHelpSec',
    electronVersion: electronPackage.version,
    asar: true,
    compression: 'maximum',
    directories: {
      output: releaseDir,
    },
    files: [
      'desktop/**/*',
      'dist/**/*',
      'assets/app-icon.png',
      'assets/app-icon.icns',
      'package.json',
    ],
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
    mac: {
      icon: path.join(stagingDir, 'assets', 'app-icon.icns'),
      target: ['dmg'],
      category: 'public.app-category.productivity',
      hardenedRuntime: true,
      entitlements: macEntitlementsPath,
      entitlementsInherit: macEntitlementsPath,
      extendInfo: {
        NSMicrophoneUsageDescription: 'MedHelp uses the microphone for voice input in research conversations.',
      },
      artifactName: `MedHelp-${distributionLabel}-\${version}-mac-\${arch}.\${ext}`,
    },
    dmg: {
      title: 'MedHelp ${version}',
      artifactName: `MedHelp-${distributionLabel}-\${version}-mac-\${arch}.\${ext}`,
    },
    afterPack: validatePackagedApp,
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

const dmgPath = artifacts.find((artifactPath) => artifactPath.toLowerCase().endsWith('.dmg'));
if (!dmgPath) {
  throw new Error('electron-builder did not produce the expected macOS DMG.');
}
const dmgSha256 = await sha256File(dmgPath);
const checksumPath = `${dmgPath}.sha256`;
await fs.writeFile(checksumPath, `${dmgSha256}  ${path.basename(dmgPath)}\n`, 'utf8');
const sourceManifestPath = offlineUi
  ? path.join(releaseDir, `MedHelp-Offline-${rootPackage.version}-mac-${process.arch}.sources.json`)
  : null;
if (sourceManifestPath) {
  await fs.copyFile(stagedResourceSourcesPath, sourceManifestPath);
}

console.log(JSON.stringify({
  ok: true,
  product: 'offline-desktop',
  version: rootPackage.version,
  platform: 'darwin',
  arch: process.arch,
  skillCount: runtimeManifest.assets.skillCount,
  dmgPath,
  dmgSha256,
  checksumPath,
  sourceManifestPath,
  bundledSources: resourceSourcesPolicy?.bundled?.map((entry) => entry.id) || null,
  onlineRequiredSources: resourceSourcesPolicy?.onlineRequired?.map((entry) => entry.id) || null,
  artifacts,
}, null, 2));
