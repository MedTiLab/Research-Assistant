import fs from 'fs';
import os from 'os';
import path from 'path';

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

function resolveClaudeCodeExecutableInfo({
  env = process.env,
} = {}) {
  const explicitPath = resolveCommandCandidate(env.CLAUDE_CLI_PATH, env);
  if (explicitPath) {
    return { executable: explicitPath, source: 'CLAUDE_CLI_PATH' };
  }

  const cliPath = resolveCommandCandidate('claude', env);
  if (cliPath) {
    return { executable: cliPath, source: 'PATH' };
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
