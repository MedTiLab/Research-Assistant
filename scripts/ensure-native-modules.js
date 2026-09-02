#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const repoRoot = path.join(__dirname, '..');
const cacheDir = path.join(repoRoot, 'node_modules', '.cache', 'medhelp');
const stampPath = path.join(cacheDir, 'native-modules.json');
const nativePackages = ['better-sqlite3', 'node-pty', 'bcrypt', 'sharp', 'sqlite3'];
const nativeMismatchPatterns = [
  /NODE_MODULE_VERSION/i,
  /compiled against a different Node\.js version/i,
  /module version mismatch/i,
  /invalid ELF header/i,
  /dlopen\(.+not a mach-o file/i,
];

const runtimeStamp = {
  node: process.versions.node,
  abi: process.versions.modules,
  napi: process.versions.napi ?? null,
  platform: process.platform,
  arch: process.arch,
};

function log(message) {
  console.log(`[native] ${message}`);
}

function warn(message) {
  console.warn(`[native] ${message}`);
}

function ensureCacheDir() {
  fs.mkdirSync(cacheDir, { recursive: true });
}

function readStamp() {
  try {
    return JSON.parse(fs.readFileSync(stampPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      warn(`Could not read native module stamp: ${error.message}`);
    }
    return null;
  }
}

function writeStamp() {
  ensureCacheDir();
  fs.writeFileSync(
    stampPath,
    JSON.stringify(
      {
        ...runtimeStamp,
        packages: nativePackages,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
}

function uniqueExistingPaths(paths) {
  return [...new Set(paths)].filter((candidatePath) => {
    try {
      return fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile();
    } catch {
      return false;
    }
  });
}

function collectDarwinNativeModulePaths() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const nodeModulesDir = path.join(repoRoot, 'node_modules');
  return uniqueExistingPaths([
    path.join(nodeModulesDir, 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
    path.join(nodeModulesDir, 'sqlite3', 'build', 'Release', 'node_sqlite3.node'),
    path.join(nodeModulesDir, 'bcrypt', 'build', 'Release', 'bcrypt_lib.node'),
    path.join(nodeModulesDir, 'bcrypt', 'prebuilds', `darwin-${arch}`, 'bcrypt.node'),
    path.join(nodeModulesDir, 'node-pty', 'build', 'Release', 'pty.node'),
    path.join(nodeModulesDir, 'node-pty', 'prebuilds', `darwin-${arch}`, 'pty.node'),
    path.join(nodeModulesDir, '@img', `sharp-darwin-${arch}`, 'lib', `sharp-darwin-${arch}.node`),
  ]);
}

function signDarwinNativeModules() {
  if (process.platform !== 'darwin') {
    return;
  }

  const nativeModulePaths = collectDarwinNativeModulePaths();
  if (nativeModulePaths.length === 0) {
    return;
  }

  let signedCount = 0;
  for (const nativeModulePath of nativeModulePaths) {
    const result = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', nativeModulePath], {
      cwd: repoRoot,
      stdio: ['ignore', 'ignore', 'pipe'],
      encoding: 'utf8',
    });

    if (result.status !== 0) {
      warn(`Could not ad-hoc sign ${path.relative(repoRoot, nativeModulePath)}: ${result.stderr?.trim() || 'codesign failed'}`);
      continue;
    }

    signedCount += 1;
  }

  if (signedCount > 0) {
    log(`Ad-hoc signed ${signedCount} native module${signedCount === 1 ? '' : 's'} for macOS.`);
  }
}

function needsRebuild(previousStamp) {
  if (!previousStamp) return true;
  return (
    previousStamp.abi !== runtimeStamp.abi ||
    previousStamp.platform !== runtimeStamp.platform ||
    previousStamp.arch !== runtimeStamp.arch
  );
}

function shouldRebuildFromLoadError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return nativeMismatchPatterns.some((pattern) => pattern.test(message));
}

function validateNativePackages() {
  for (const packageName of nativePackages) {
    try {
      const loaded = require(packageName);
      if (packageName === 'better-sqlite3') {
        const tempDb = new loaded(':memory:');
        tempDb.close();
      }
    } catch (error) {
      if (!shouldRebuildFromLoadError(error)) {
        throw error;
      }

      warn(
        `Detected incompatible native package "${packageName}" for Node ${runtimeStamp.node} (ABI ${runtimeStamp.abi}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
  }

  return true;
}

function run(command, args) {
  const nodeBinDir = path.dirname(process.execPath);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      PATH: `${nodeBinDir}${path.delimiter}${process.env.PATH ?? ''}`,
    },
    stdio: 'inherit',
  });
  return result.status ?? 1;
}

function resolveNpmInvocation() {
  const npmExecPath = process.env.npm_execpath;

  if (npmExecPath) {
    if (npmExecPath.endsWith('.js')) {
      return {
        command: process.execPath,
        args: [npmExecPath],
      };
    }

    return {
      command: npmExecPath,
      args: [],
    };
  }

  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: [],
  };
}

function rebuildNativePackages() {
  log(
    `Detected native module/runtime mismatch. Rebuilding ${nativePackages.join(', ')} for Node ${runtimeStamp.node} (ABI ${runtimeStamp.abi}).`,
  );

  const npmInvocation = resolveNpmInvocation();
  const rebuildStatus = run(
    npmInvocation.command,
    [...npmInvocation.args, 'rebuild', ...nativePackages],
  );
  if (rebuildStatus !== 0) {
    process.exit(rebuildStatus);
  }

  const fixNodePtyStatus = run(process.execPath, [path.join(__dirname, 'fix-node-pty.js')]);
  if (fixNodePtyStatus !== 0) {
    warn('node-pty permission fix did not complete cleanly after rebuild.');
  }

  signDarwinNativeModules();
  writeStamp();
  log(`Native modules are now aligned with Node ${runtimeStamp.node}.`);
}

if (process.argv.includes('--record-only')) {
  signDarwinNativeModules();
  writeStamp();
  log(`Recorded native module runtime for Node ${runtimeStamp.node} (ABI ${runtimeStamp.abi}).`);
  process.exit(0);
}

const previousStamp = readStamp();
if (!needsRebuild(previousStamp)) {
  signDarwinNativeModules();
}
if (needsRebuild(previousStamp) || !validateNativePackages()) {
  rebuildNativePackages();
} else {
  log(`Native modules already match Node ${runtimeStamp.node} (ABI ${runtimeStamp.abi}).`);
}
