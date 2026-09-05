#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { nativePackages } from './check-native-modules.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.join(__dirname, '..');
const cacheDir = path.join(repoRoot, 'node_modules', '.cache', 'medhelp');
const stampPath = path.join(cacheDir, 'native-modules.json');

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

function validateNativePackages() {
  // A fresh process avoids cached bindings and verifies rebuilt files on disk.
  const result = spawnSync(process.execPath, [path.join(__dirname, 'check-native-modules.js')], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30000,
    killSignal: 'SIGKILL',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Native module check failed: ${result.error?.message || result.stderr?.trim() || result.signal || result.status}`);
  }
  return JSON.parse(result.stdout);
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
  if (result.error) warn(`Could not run ${command}: ${result.error.message}`);
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

function rebuildNativePackages(packages) {
  log(
    `Rebuilding ${packages.join(', ')} for Node ${runtimeStamp.node} (ABI ${runtimeStamp.abi}, ${runtimeStamp.arch}). This may take a few minutes.`,
  );

  const npmInvocation = resolveNpmInvocation();
  const rebuildStatus = run(
    npmInvocation.command,
    [...npmInvocation.args, 'rebuild', ...packages, '--foreground-scripts'],
  );
  if (rebuildStatus !== 0) {
    process.exit(rebuildStatus);
  }

  const fixNodePtyStatus = run(process.execPath, [path.join(__dirname, 'fix-node-pty.js')]);
  if (fixNodePtyStatus !== 0) {
    warn('node-pty permission fix did not complete cleanly after rebuild.');
  }

  signDarwinNativeModules();
  const failures = validateNativePackages();
  if (failures.length > 0) {
    throw new Error(`Native modules still cannot load after rebuild:\n${formatFailures(failures)}`);
  }
  log(`Native modules are now aligned with Node ${runtimeStamp.node}.`);
}

function formatFailures(failures) {
  return failures.map(({ packageName, message }) => `${packageName}: ${message}`).join('\n');
}

if (process.argv.includes('--record-only')) {
  signDarwinNativeModules();
  writeStamp();
  log(`Recorded native module runtime for Node ${runtimeStamp.node} (ABI ${runtimeStamp.abi}).`);
  process.exit(0);
}

try {
  const failures = validateNativePackages();
  if (failures.some(({ rebuildable }) => !rebuildable)) {
    throw new Error(`${formatFailures(failures)}\nInstall dependencies for the current Node runtime (${runtimeStamp.platform}-${runtimeStamp.arch}) with npm install --include=optional, then retry.`);
  }
  if (failures.length > 0) {
    rebuildNativePackages(failures.map(({ packageName }) => packageName));
  } else {
    log(`Native modules already match Node ${runtimeStamp.node} (ABI ${runtimeStamp.abi}, ${runtimeStamp.arch}).`);
  }
  // The stamp is informational: shared worktrees or Node-API packages can be
  // compatible even when the recorded runtime differs or the stamp is absent.
  const previousStamp = readStamp();
  if (!previousStamp || Object.keys(runtimeStamp).some((key) => previousStamp[key] !== runtimeStamp[key])) {
    try {
      writeStamp();
    } catch (error) {
      warn(`Could not update native module stamp: ${error.message}`);
    }
  }
} catch (error) {
  warn(error.message);
  process.exit(1);
}
