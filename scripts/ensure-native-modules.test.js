import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { inspectNativePackages, nativePackages } from './check-native-modules.js';

const tempDirs = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function fixture({ broken = false, repair = true, staleStamp = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'medhelp-native-test-'));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  for (const name of ['ensure-native-modules.js', 'check-native-modules.js']) {
    fs.copyFileSync(new URL(name, import.meta.url), path.join(root, 'scripts', name));
  }
  fs.writeFileSync(path.join(root, 'scripts/fix-node-pty.js'), '');
  const healthyDb = 'module.exports = class Database { close() {} };';
  for (const name of nativePackages) {
    const dir = path.join(root, 'node_modules', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.js'), name === 'better-sqlite3'
      ? (broken ? 'module.exports = class Database { constructor() { throw new Error("NODE_MODULE_VERSION mismatch"); } };' : healthyDb)
      : 'module.exports = {};');
  }
  const stampPath = path.join(root, 'node_modules/.cache/medhelp/native-modules.json');
  if (staleStamp) {
    fs.mkdirSync(path.dirname(stampPath), { recursive: true });
    fs.writeFileSync(stampPath, '{"abi":"old","arch":"other"}');
  }
  const npmPath = path.join(root, 'fake-npm.js');
  fs.writeFileSync(npmPath, `import fs from 'fs';
    fs.writeFileSync('rebuild-args.json', JSON.stringify(process.argv.slice(2)));
    ${repair ? `fs.writeFileSync('node_modules/better-sqlite3/index.js', ${JSON.stringify(healthyDb)});` : ''}`);
  return {
    root,
    stampPath,
    run: () => spawnSync(process.execPath, ['scripts/ensure-native-modules.js'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, npm_execpath: npmPath },
    }),
  };
}

describe('native module preflight', () => {
  it.each([false, true])('does not rebuild working modules with staleStamp=%s', (staleStamp) => {
    const test = fixture({ staleStamp });
    const result = test.run();
    expect(result.status, result.stderr).toBe(0);
    expect(fs.existsSync(path.join(test.root, 'rebuild-args.json'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(test.stampPath)).abi).toBe(process.versions.modules);
  });

  it('rebuilds only failing modules and validates repaired bindings in a fresh process', () => {
    const test = fixture({ broken: true });
    const result = test.run();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(test.root, 'rebuild-args.json'))))
      .toEqual(['rebuild', 'better-sqlite3', '--foreground-scripts']);
    expect(fs.existsSync(test.stampPath)).toBe(true);
  });

  it('does not record success when npm succeeds but bindings remain broken', () => {
    const test = fixture({ broken: true, repair: false });
    const result = test.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('still cannot load after rebuild');
    expect(fs.existsSync(test.stampPath)).toBe(false);
  });

  it('recognizes architecture mismatches and checks all packages', () => {
    const failures = inspectNativePackages((name) => {
      if (name === 'better-sqlite3') throw new Error('mach-o file, but is an incompatible architecture');
      if (name === 'sharp') throw new Error('Could not load the "sharp" module using the darwin-x64 runtime');
      return {};
    });
    expect(failures.map(({ packageName, rebuildable }) => ({ packageName, rebuildable })))
      .toEqual([{ packageName: 'better-sqlite3', rebuildable: true }, { packageName: 'sharp', rebuildable: false }]);
  });
});
