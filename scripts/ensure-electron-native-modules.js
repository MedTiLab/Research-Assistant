#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const cacheDir = path.join(repoRoot, 'node_modules', '.cache', 'medhelp');
const stampPath = path.join(cacheDir, 'electron-native-modules.json');
const electronBinary = require('electron');
const electronVersion = require('electron/package.json').version;
const electronRebuildCli = path.join(repoRoot, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js');
const prebuildInstallCli = path.join(repoRoot, 'node_modules', 'prebuild-install', 'bin.js');
const nativePackages = ['better-sqlite3', 'sqlite3', 'node-pty', 'bcrypt', 'sharp'];
const electronRebuildPackages = nativePackages.filter((packageName) => packageName !== 'better-sqlite3');

function log(message) {
  console.log(`[electron-native] ${message}`);
}

function warn(message) {
  console.warn(`[electron-native] ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    stdio: options.stdio || 'pipe',
    env: {
      ...process.env,
      ...(options.env || {}),
    },
  });

  return result;
}

function validateElectronNativeModules() {
  const script = `
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.prepare('select 1 as ok').get();
    db.close();
    require('sqlite3');
    require('node-pty');
    require('bcrypt');
    require('sharp');
    console.log(JSON.stringify({
      electron: process.versions.electron,
      node: process.versions.node,
      abi: process.versions.modules,
      platform: process.platform,
      arch: process.arch
    }));
  `;

  const result = run(electronBinary, ['-e', script], {
    env: {
      ELECTRON_RUN_AS_NODE: '1',
    },
  });

  if (result.status !== 0) {
    return {
      ok: false,
      detail: [result.stdout, result.stderr].filter(Boolean).join('\n').trim(),
    };
  }

  try {
    return {
      ok: true,
      runtime: JSON.parse(result.stdout.trim().split(/\n/).at(-1)),
    };
  } catch {
    return {
      ok: true,
      runtime: {
        electron: electronVersion,
        abi: 'unknown',
        platform: process.platform,
        arch: process.arch,
      },
    };
  }
}

function readStamp() {
  try {
    return JSON.parse(fs.readFileSync(stampPath, 'utf8'));
  } catch {
    return null;
  }
}

function writeStamp(runtime) {
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(
    stampPath,
    JSON.stringify(
      {
        ...runtime,
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

  let signedCount = 0;
  for (const nativeModulePath of collectDarwinNativeModulePaths()) {
    const result = run('/usr/bin/codesign', ['--force', '--sign', '-', nativeModulePath], {
      stdio: ['ignore', 'ignore', 'pipe'],
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

function stampMatches(runtime) {
  const stamp = readStamp();
  return Boolean(
    stamp
    && stamp.electron === runtime.electron
    && stamp.abi === runtime.abi
    && stamp.platform === runtime.platform
    && stamp.arch === runtime.arch
  );
}

function rebuildForElectron() {
  log(`Rebuilding ${electronRebuildPackages.join(', ')} for Electron ${electronVersion}.`);
  const result = run(process.execPath, [
    electronRebuildCli,
    '--force',
    '--version',
    electronVersion,
    '--module-dir',
    repoRoot,
    '--only',
    electronRebuildPackages.join(','),
  ], {
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function installBetterSqliteElectronPrebuild() {
  const packageDir = path.join(repoRoot, 'node_modules', 'better-sqlite3');
  log(`Installing better-sqlite3 prebuild for Electron ${electronVersion}.`);
  const result = run(process.execPath, [
    prebuildInstallCli,
    '--runtime',
    'electron',
    '--target',
    electronVersion,
    '--arch',
    process.arch,
    '--platform',
    process.platform,
    '--force',
  ], {
    cwd: packageDir,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    warn('Could not install the better-sqlite3 Electron prebuild; trying node-gyp rebuild as a fallback.');
    const fallback = run(process.execPath, [
      electronRebuildCli,
      '--force',
      '--build-from-source',
      '--version',
      electronVersion,
      '--module-dir',
      repoRoot,
      '--only',
      'better-sqlite3',
    ], {
      stdio: 'inherit',
    });

    if (fallback.status !== 0) {
      process.exit(fallback.status || 1);
    }
  }
}

signDarwinNativeModules();

let validation = validateElectronNativeModules();
if (!validation.ok) {
  warn(`Detected Electron native module mismatch: ${validation.detail || 'validation failed'}`);
  rebuildForElectron();
  installBetterSqliteElectronPrebuild();
  signDarwinNativeModules();
  validation = validateElectronNativeModules();
}

if (!validation.ok) {
  console.error(`[electron-native] Electron native module validation failed after rebuild:\n${validation.detail}`);
  process.exit(1);
}

if (!stampMatches(validation.runtime)) {
  writeStamp(validation.runtime);
}

log(`Native modules match Electron ${validation.runtime.electron || electronVersion} (ABI ${validation.runtime.abi}).`);
