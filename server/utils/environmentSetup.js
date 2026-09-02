import { constants as fsConstants, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { resolveAppDataRoot } from './storagePaths.js';

const execFileAsync = promisify(execFile);

export const ENVIRONMENT_SETUP_FILENAME = 'environment-setup.json';
export const ENVIRONMENT_SETUP_VERSION = 1;

const EXECUTABLE_TIMEOUT_MS = 4_000;
const MAX_PATH_LENGTH = 4_096;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveHomeDir(options = {}) {
  return path.resolve(options.homeDir || os.homedir());
}

function resolveDefaultWorkspaceRoot(options = {}) {
  return path.join(resolveHomeDir(options), 'Documents', 'MedHelpSec');
}

export function expandEnvironmentSetupPath(value, options = {}) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  if (normalized.includes('\0') || normalized.length > MAX_PATH_LENGTH) return '';

  const homeDir = resolveHomeDir(options);
  if (normalized === '~') return homeDir;
  if (normalized.startsWith('~/') || normalized.startsWith('~\\')) {
    return path.resolve(homeDir, normalized.slice(2));
  }
  return path.resolve(normalized);
}

export function displayEnvironmentSetupPath(value, options = {}) {
  const normalized = normalizeString(value);
  if (!normalized) return '';
  const homeDir = resolveHomeDir(options);
  if (normalized === homeDir) return '~';
  if (normalized.startsWith(`${homeDir}${path.sep}`)) {
    return `~${normalized.slice(homeDir.length)}`;
  }
  return normalized;
}

export function getEnvironmentSetupConfigPath(options = {}) {
  return path.join(resolveAppDataRoot(options), ENVIRONMENT_SETUP_FILENAME);
}

async function pathKind(targetPath) {
  if (!targetPath) return 'missing';
  try {
    const stats = await fs.stat(targetPath);
    if (stats.isDirectory()) return 'directory';
    if (stats.isFile()) return 'file';
    return 'other';
  } catch {
    return 'missing';
  }
}

async function readJsonFile(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return {};
    throw error;
  }
}

async function readSavedSetup(options = {}) {
  return readJsonFile(getEnvironmentSetupConfigPath(options));
}

async function writeSavedSetup(document, options = {}) {
  const configPath = getEnvironmentSetupConfigPath(options);
  await fs.mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fs.rename(temporaryPath, configPath);
  await fs.chmod(configPath, 0o600).catch(() => {});
}

function executableExtensions(platform, env) {
  if (platform !== 'win32') return [''];
  return normalizeString(env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

async function findExecutable(commandNames, extraCandidates = [], options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const pathEntries = normalizeString(env.PATH)
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const extensions = executableExtensions(platform, env);
  const candidates = [...extraCandidates];

  for (const entry of pathEntries) {
    for (const commandName of commandNames) {
      if (platform === 'win32' && path.extname(commandName)) {
        candidates.push(path.join(entry, commandName));
      } else {
        for (const extension of extensions) {
          candidates.push(path.join(entry, `${commandName}${extension}`));
        }
      }
    }
  }

  for (const candidate of Array.from(new Set(candidates.map((entry) => path.resolve(entry))))) {
    try {
      await fs.access(candidate, platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
      const stats = await fs.stat(candidate);
      if (stats.isFile()) return candidate;
    } catch {
      // Keep looking through the deterministic candidate list.
    }
  }
  return '';
}

async function readExecutableVersion(executablePath, args, options = {}) {
  if (!executablePath) return '';
  try {
    const result = await (options.execFileAsync || execFileAsync)(executablePath, args, {
      timeout: EXECUTABLE_TIMEOUT_MS,
      windowsHide: true,
      env: options.env || process.env,
    });
    return normalizeString(result.stdout || result.stderr).split(/\r?\n/)[0].slice(0, 240);
  } catch (error) {
    return normalizeString(error?.stdout || error?.stderr).split(/\r?\n/)[0].slice(0, 240);
  }
}

async function detectPython(options = {}) {
  const platform = options.platform || process.platform;
  const homeDir = resolveHomeDir(options);
  const candidates = platform === 'win32'
    ? [
        path.join(homeDir, 'AppData', 'Local', 'Programs', 'Python', 'Python313', 'python.exe'),
        path.join(homeDir, 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
      ]
    : ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3'];
  const executablePath = await findExecutable(['python3', 'python'], candidates, options);
  return {
    executablePath,
    version: await readExecutableVersion(executablePath, ['--version'], options),
    ready: Boolean(executablePath),
  };
}

async function detectR(options = {}) {
  const platform = options.platform || process.platform;
  const candidates = platform === 'win32'
    ? []
    : [
        '/opt/homebrew/bin/R',
        '/usr/local/bin/R',
        '/usr/bin/R',
        '/Library/Frameworks/R.framework/Resources/bin/R',
      ];
  const executablePath = await findExecutable(['R'], candidates, options);
  return {
    executablePath,
    version: await readExecutableVersion(executablePath, ['--version'], options),
    ready: Boolean(executablePath),
  };
}

async function detectCcSwitch(options = {}, saved = {}) {
  const homeDir = resolveHomeDir(options);
  const platform = options.platform || process.platform;
  const dataDir = expandEnvironmentSetupPath(saved.ccSwitchDataDir || '~/.cc-switch', options);
  const applicationCandidates = platform === 'darwin'
    ? ['/Applications/CC Switch.app', path.join(homeDir, 'Applications', 'CC Switch.app')]
    : platform === 'win32'
      ? [
          path.join(options.env?.LOCALAPPDATA || process.env.LOCALAPPDATA || homeDir, 'CC Switch', 'cc-switch.exe'),
          path.join(options.env?.PROGRAMFILES || process.env.PROGRAMFILES || 'C:\\Program Files', 'CC Switch', 'cc-switch.exe'),
        ]
      : ['/usr/bin/cc-switch', '/usr/local/bin/cc-switch'];

  let applicationPath = '';
  for (const candidate of applicationCandidates) {
    if (await pathKind(candidate) !== 'missing') {
      applicationPath = candidate;
      break;
    }
  }

  const dataKind = await pathKind(dataDir);
  return {
    installed: Boolean(applicationPath) || dataKind === 'directory',
    applicationPath,
    dataDir,
    dataDirExists: dataKind === 'directory',
  };
}

export async function detectEnvironmentSetup(options = {}) {
  const saved = await readSavedSetup(options);
  const [ccSwitch, python, r] = await Promise.all([
    detectCcSwitch(options, saved),
    detectPython(options),
    detectR(options),
  ]);

  return {
    platform: options.platform || process.platform,
    homeDir: resolveHomeDir(options),
    ccSwitch,
    python,
    r,
  };
}

function normalizeSetupInput(input = {}, options = {}) {
  return {
    ccSwitchDataDir: expandEnvironmentSetupPath(input.ccSwitchDataDir, options),
    pythonExecutable: expandEnvironmentSetupPath(input.pythonExecutable, options),
    rExecutable: expandEnvironmentSetupPath(input.rExecutable, options),
    workspaceRoot: expandEnvironmentSetupPath(input.workspaceRoot, options),
    dataPath: expandEnvironmentSetupPath(input.dataPath, options),
  };
}

export function buildEnvironmentSetupRuntimeEnv(config = {}, baseEnv = process.env) {
  const executableDirs = [config.pythonExecutable, config.rExecutable]
    .filter(Boolean)
    .map((entry) => path.dirname(entry));
  const currentPath = normalizeString(baseEnv.PATH);
  const nextPath = Array.from(new Set([
    ...executableDirs,
    ...currentPath.split(path.delimiter).filter(Boolean),
  ])).join(path.delimiter);
  return {
    ...(nextPath ? { PATH: nextPath } : {}),
    ...(config.pythonExecutable ? {
      MEDHELP_PYTHON_EXECUTABLE: config.pythonExecutable,
      MEDHELP_PYTHON: config.pythonExecutable,
    } : {}),
    ...(config.rExecutable ? { MEDHELP_R_EXECUTABLE: config.rExecutable } : {}),
    ...(config.ccSwitchDataDir ? { MEDHELP_CC_SWITCH_DATA_DIR: config.ccSwitchDataDir } : {}),
    ...(config.workspaceRoot ? { MEDHELP_WORKSPACE_ROOT: config.workspaceRoot } : {}),
    ...(config.dataPath ? { MEDHELP_DATA_PATH: config.dataPath } : {}),
  };
}

export function applyEnvironmentSetupRuntimeEnv(config = {}, targetEnv = process.env) {
  const runtimeEnv = buildEnvironmentSetupRuntimeEnv(config, targetEnv);
  // Ignore legacy user-editable provider-home overrides here. MedHelp injects
  // its managed CODEX_HOME only when spawning the embedded Codex app-server,
  // after synchronizing the standard user's auth and provider config.
  delete targetEnv.CLAUDE_CONFIG_DIR;
  delete targetEnv.CODEX_HOME;
  Object.assign(targetEnv, runtimeEnv);
  return targetEnv;
}

async function validateDirectory(field, label, { create = false, required = true } = {}) {
  if (!field) {
    return required ? `${label}不能为空` : '';
  }
  if (create) {
    await fs.mkdir(field, { recursive: true });
  }
  return await pathKind(field) === 'directory' ? '' : `${label}不是可访问的目录`;
}

async function validateExecutable(field, label, options = {}) {
  if (!field) return options.required === false ? '' : `未找到${label}可执行文件`;
  try {
    await fs.access(field, (options.platform || process.platform) === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
    return await pathKind(field) === 'file' ? '' : `${label}路径不是文件`;
  } catch {
    return `${label}可执行文件不可访问`;
  }
}

export async function validateEnvironmentSetup(input = {}, options = {}) {
  const config = normalizeSetupInput(input, options);
  const errors = {};

  const checks = await Promise.all([
    validateDirectory(config.ccSwitchDataDir, 'CC Switch 数据目录', { create: options.createDirectories === true }),
    validateExecutable(config.pythonExecutable, 'Python', { ...options, required: false }),
    validateExecutable(config.rExecutable, 'R', { ...options, required: false }),
    validateDirectory(config.workspaceRoot, '工作区目录'),
    validateDirectory(config.dataPath, '数据目录', { required: false }),
  ]);

  const keys = [
    'ccSwitchDataDir',
    'pythonExecutable',
    'rExecutable',
    'workspaceRoot',
    'dataPath',
  ];
  checks.forEach((message, index) => {
    if (message) errors[keys[index]] = message;
  });

  return { valid: Object.keys(errors).length === 0, errors, config };
}

export async function getEnvironmentSetupStatus(options = {}) {
  const [saved, detected] = await Promise.all([
    readSavedSetup(options),
    detectEnvironmentSetup(options),
  ]);
  const defaults = {
    ccSwitchDataDir: detected.ccSwitch.dataDir,
    pythonExecutable: detected.python.executablePath,
    rExecutable: detected.r.executablePath,
    workspaceRoot: resolveDefaultWorkspaceRoot(options),
    dataPath: '',
  };
  const config = normalizeSetupInput({ ...defaults, ...saved }, options);
  if (saved.completed === true && saved.version === ENVIRONMENT_SETUP_VERSION) {
    applyEnvironmentSetupRuntimeEnv(config, options.targetEnv || process.env);
  }

  return {
    completed: saved.completed === true && saved.version === ENVIRONMENT_SETUP_VERSION,
    completedAt: saved.completedAt || null,
    config,
    displayConfig: Object.fromEntries(
      Object.entries(config).map(([key, value]) => [key, displayEnvironmentSetupPath(value, options)]),
    ),
    detected,
    configPath: getEnvironmentSetupConfigPath(options),
  };
}

export async function saveEnvironmentSetup(input = {}, options = {}) {
  const validation = await validateEnvironmentSetup(input, { ...options, createDirectories: true });
  if (!validation.valid) {
    const error = new Error('环境配置校验失败');
    error.statusCode = 400;
    error.fieldErrors = validation.errors;
    throw error;
  }

  const document = {
    version: ENVIRONMENT_SETUP_VERSION,
    completed: true,
    completedAt: new Date().toISOString(),
    ...validation.config,
  };
  await writeSavedSetup(document, options);
  applyEnvironmentSetupRuntimeEnv(document, options.targetEnv || process.env);
  return getEnvironmentSetupStatus(options);
}
