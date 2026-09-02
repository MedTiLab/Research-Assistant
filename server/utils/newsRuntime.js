import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.command}\0${(candidate.args || []).join('\0')}`;
    if (!candidate.command || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildPythonRuntimeCandidates(
  env = process.env,
  platform = process.platform,
) {
  const configured = [
    env.MEDHELP_PYTHON_EXECUTABLE,
    env.MEDHELP_PYTHON,
    env.PYTHON,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((command) => ({ command, args: [], source: 'environment' }));

  const defaults = platform === 'win32'
    ? [
      { command: 'python3', args: [], source: 'system' },
      { command: 'python', args: [], source: 'system' },
      { command: 'py', args: ['-3'], source: 'system' },
    ]
    : [
      { command: 'python3', args: [], source: 'system' },
      { command: 'python', args: [], source: 'system' },
    ];

  return uniqueCandidates([...configured, ...defaults]);
}

function probePython3(candidate, env) {
  const result = spawnSync(
    candidate.command,
    [...candidate.args, '-c', 'import sys; print(sys.version_info[0])'],
    {
      env,
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    },
  );
  return result.status === 0 && String(result.stdout || '').trim() === '3';
}

export function resolvePythonRuntime({
  env = process.env,
  platform = process.platform,
  probe = probePython3,
} = {}) {
  const candidates = buildPythonRuntimeCandidates(env, platform);
  for (const candidate of candidates) {
    if (probe(candidate, env)) return candidate;
  }

  const error = new Error(
    'Python 3 was not found. Install Python 3 on the computer running MedHelp Local Engine, '
      + 'or set MEDHELP_PYTHON_EXECUTABLE to its full path.',
  );
  error.code = 'PYTHON3_NOT_FOUND';
  throw error;
}

function executableNames(command, env, platform) {
  if (platform !== 'win32' || path.extname(command)) return [command];
  const pathExt = String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);
  return [command, ...pathExt.map((extension) => `${command}${extension}`)];
}

function isRunnableFile(filePath, platform) {
  try {
    fs.accessSync(filePath, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function findExecutable(command, {
  env = process.env,
  platform = process.platform,
} = {}) {
  const value = String(command || '').trim();
  if (!value) return null;

  const hasDirectory = value.includes('/') || value.includes('\\') || path.isAbsolute(value);
  const directories = hasDirectory
    ? ['']
    : String(env.PATH || '').split(path.delimiter).filter(Boolean);

  for (const directory of directories) {
    for (const name of executableNames(value, env, platform)) {
      const candidate = directory ? path.join(directory, name) : name;
      if (isRunnableFile(candidate, platform)) return path.resolve(candidate);
    }
  }
  return null;
}

function resolveUvToolBinDir(env, platform) {
  const configured = String(env.UV_TOOL_BIN_DIR || '').trim();
  if (configured) return configured;

  const uv = findExecutable('uv', { env, platform })
    || findExecutable(path.join(os.homedir(), '.local', 'bin', 'uv'), { env, platform });
  if (!uv) return null;

  const result = spawnSync(uv, ['tool', 'dir', '--bin'], {
    env,
    encoding: 'utf8',
    timeout: 5_000,
    windowsHide: true,
  });
  return result.status === 0 ? String(result.stdout || '').trim() || null : null;
}

export function resolveXhsExecutable({
  env = process.env,
  platform = process.platform,
} = {}) {
  const home = os.homedir();
  const uvToolBinDir = resolveUvToolBinDir(env, platform);
  const configured = [env.MEDHELP_XHS_EXECUTABLE, env.XHS_CLI_PATH]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const candidates = [
    ...configured,
    'xhs',
    ...(uvToolBinDir ? [path.join(uvToolBinDir, 'xhs')] : []),
    path.join(home, '.local', 'bin', 'xhs'),
  ];

  for (const candidate of candidates) {
    const resolved = findExecutable(candidate, { env, platform });
    if (resolved) return resolved;
  }
  return null;
}

export function prependExecutableDirectory(env, executablePath) {
  const directory = path.dirname(executablePath);
  const currentPath = String(env.PATH || '');
  const entries = currentPath.split(path.delimiter).filter(Boolean);
  if (entries.includes(directory)) return { ...env };
  return {
    ...env,
    PATH: [directory, ...entries].join(path.delimiter),
  };
}
