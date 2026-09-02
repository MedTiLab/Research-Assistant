import fs from 'node:fs';
import path from 'node:path';

export function getNodePtySpawnHelperPath(runtimeRoot, arch = process.arch) {
  return path.join(
    runtimeRoot,
    'node_modules',
    'node-pty',
    'prebuilds',
    `darwin-${arch}`,
    'spawn-helper',
  );
}

export function ensureNodePtySpawnHelperExecutable({
  runtimeRoot,
  platform = process.platform,
  arch = process.arch,
  fsApi = fs,
} = {}) {
  if (platform !== 'darwin') {
    return { repaired: false, reason: 'not-macos' };
  }
  if (!runtimeRoot) {
    throw new Error('A runtime root is required to repair the node-pty spawn helper.');
  }

  const helperPath = getNodePtySpawnHelperPath(runtimeRoot, arch);
  if (!fsApi.existsSync(helperPath)) {
    throw new Error(`node-pty spawn helper is missing: ${helperPath}`);
  }

  const previousMode = fsApi.statSync(helperPath).mode & 0o777;
  if ((previousMode & 0o111) !== 0o111) {
    fsApi.chmodSync(helperPath, 0o755);
  }

  const mode = fsApi.statSync(helperPath).mode & 0o777;
  if ((mode & 0o111) !== 0o111) {
    throw new Error(`node-pty spawn helper is not executable: ${helperPath}`);
  }

  return {
    repaired: previousMode !== mode,
    helperPath,
    previousMode,
    mode,
  };
}

export function assertNodePtySpawnHelperExecutable({
  runtimeRoot,
  platform = process.platform,
  arch = process.arch,
  fsApi = fs,
} = {}) {
  if (platform !== 'darwin') {
    return { valid: true, reason: 'not-macos' };
  }
  if (!runtimeRoot) {
    throw new Error('A runtime root is required to validate the node-pty spawn helper.');
  }

  const helperPath = getNodePtySpawnHelperPath(runtimeRoot, arch);
  if (!fsApi.existsSync(helperPath)) {
    throw new Error(`node-pty spawn helper is missing: ${helperPath}`);
  }

  const mode = fsApi.statSync(helperPath).mode & 0o777;
  if ((mode & 0o111) !== 0o111) {
    throw new Error(
      `node-pty spawn helper must be executable before packaging (mode ${mode.toString(8)}): ${helperPath}`,
    );
  }

  return { valid: true, helperPath, mode };
}
