import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appRoot = path.resolve(__dirname, '..', '..');

function stripMatchingQuotes(value) {
  const trimmed = String(value || '').trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function expandHome(candidate, env = process.env) {
  const value = stripMatchingQuotes(candidate);
  if (!value) return null;
  const homeDir = env.HOME || os.homedir();
  if (!homeDir) return value;
  if (value === '~') return homeDir;
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(homeDir, value.slice(2));
  }
  return value;
}

function isExecutableFile(candidate) {
  if (!candidate) return false;
  try {
    const stat = fs.statSync(candidate);
    if (!stat.isFile()) return false;
    fs.accessSync(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function hasPathSeparator(value) {
  return value.includes('/') || value.includes('\\');
}

function getExecutableNames(command) {
  if (process.platform !== 'win32') {
    return [command];
  }
  if (/\.(cmd|exe|bat)$/i.test(command)) {
    return [command];
  }
  return [command, `${command}.cmd`, `${command}.exe`, `${command}.bat`];
}

function addDir(dirs, dir, env = process.env) {
  if (!dir || typeof dir !== 'string') return;
  const normalized = expandHome(dir, env);
  if (!normalized) return;
  dirs.push(normalized);
}

function discoverNvmBinDirs(env = process.env) {
  const homeDir = env.HOME || os.homedir();
  const nvmDir = env.NVM_DIR || (homeDir ? path.join(homeDir, '.nvm') : null);
  const versionsDir = nvmDir ? path.join(nvmDir, 'versions', 'node') : null;
  if (!versionsDir) return [];

  try {
    return fs.readdirSync(versionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      .map((versionDir) => path.join(versionsDir, versionDir, 'bin'));
  } catch {
    return [];
  }
}

function getSearchPathDirs(env = process.env) {
  const dirs = [];
  const searchPath = [env.PATH, process.env.PATH].filter(Boolean).join(path.delimiter);
  for (const dir of searchPath.split(path.delimiter)) {
    addDir(dirs, dir, env);
  }

  addDir(dirs, env.NVM_BIN, env);

  const homeDir = env.HOME || os.homedir();
  if (homeDir) {
    addDir(dirs, path.join(homeDir, '.local', 'bin'), env);
    addDir(dirs, path.join(homeDir, 'bin'), env);
    addDir(dirs, path.join(homeDir, '.volta', 'bin'), env);
    addDir(dirs, path.join(homeDir, '.asdf', 'shims'), env);
    addDir(dirs, path.join(homeDir, '.bun', 'bin'), env);
    addDir(dirs, path.join(homeDir, 'Library', 'pnpm'), env);
  }

  for (const dir of discoverNvmBinDirs(env)) {
    addDir(dirs, dir, env);
  }

  addDir(dirs, '/opt/homebrew/bin', env);
  addDir(dirs, '/usr/local/bin', env);
  addDir(dirs, '/usr/bin', env);

  return [...new Set(dirs)];
}

function resolveCommandCandidate(candidate, env = process.env) {
  const expanded = expandHome(candidate, env);
  if (!expanded) return null;

  if (path.isAbsolute(expanded) || hasPathSeparator(expanded)) {
    const absolutePath = path.resolve(expanded);
    return isExecutableFile(absolutePath) ? absolutePath : null;
  }

  for (const dir of getSearchPathDirs(env)) {
    for (const executableName of getExecutableNames(expanded)) {
      const executablePath = path.join(dir, executableName);
      if (isExecutableFile(executablePath)) {
        return executablePath;
      }
    }
  }

  return null;
}

function getNativePackageNames(platform = process.platform, arch = process.arch) {
  if (platform === 'linux') {
    return [
      `@anthropic-ai/claude-agent-sdk-linux-${arch}-musl`,
      `@anthropic-ai/claude-agent-sdk-linux-${arch}`,
    ];
  }
  return [`@anthropic-ai/claude-agent-sdk-${platform}-${arch}`];
}

function getClaudeNativeExecutableName(platform = process.platform) {
  return platform === 'win32' ? 'claude.exe' : 'claude';
}

function resolveBundledNativeClaudeCode() {
  const executableName = getClaudeNativeExecutableName();
  const packageNames = getNativePackageNames();

  for (const packageName of packageNames) {
    try {
      const resolved = require.resolve(`${packageName}/${executableName}`);
      if (isExecutableFile(resolved)) {
        return resolved;
      }
    } catch {
      // Fall through to explicit app-root probing below.
    }
  }

  const roots = [...new Set([appRoot, process.cwd()])];
  for (const root of roots) {
    for (const packageName of packageNames) {
      const resolved = path.join(root, 'node_modules', packageName, executableName);
      if (isExecutableFile(resolved)) {
        return resolved;
      }
    }
  }

  return null;
}

function resolveClaudeCodeExecutableInfo({
  env = process.env,
  includeBundledNative = true,
  preferBundledNative = false,
} = {}) {
  const explicitPath = resolveCommandCandidate(env.CLAUDE_CLI_PATH, env);
  if (explicitPath) {
    return { executable: explicitPath, source: 'CLAUDE_CLI_PATH' };
  }

  if (includeBundledNative && preferBundledNative) {
    const bundledPath = resolveBundledNativeClaudeCode();
    if (bundledPath) {
      return { executable: bundledPath, source: 'bundled-native' };
    }
  }

  const cliPath = resolveCommandCandidate('claude', env);
  if (cliPath) {
    return { executable: cliPath, source: 'PATH' };
  }

  if (includeBundledNative && !preferBundledNative) {
    const bundledPath = resolveBundledNativeClaudeCode();
    if (bundledPath) {
      return { executable: bundledPath, source: 'bundled-native' };
    }
  }

  return { executable: null, source: null };
}

function resolveClaudeCodeExecutable(options = {}) {
  return resolveClaudeCodeExecutableInfo(options).executable;
}

export {
  resolveClaudeCodeExecutable,
  resolveClaudeCodeExecutableInfo,
};
