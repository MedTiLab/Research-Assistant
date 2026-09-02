import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';
import os from 'os';
import pty from 'node-pty';
import crypto from 'crypto';

const CONFIG_DIR = path.join(os.homedir(), '.openclaw');
const CONFIG_FILE = path.join(CONFIG_DIR, 'compute-node.json');
const COMPUTE_SYNC_STATE_DIR = path.join(CONFIG_DIR, 'compute-sync-state');
const COMPUTE_SYNC_STATE_VERSION = 1;

const SECOND = 1000;
export const COMPUTE_PROCESS_TIMEOUTS = Object.freeze({
  connectionCheck: 60 * SECOND,
  command: 30 * 60 * SECOND,
  archive: 60 * 60 * SECOND,
  transfer: 15 * 60 * SECOND,
  cleanup: 30 * SECOND,
});

const activeComputeProcesses = new Set();
const activeProjectSyncs = new Map();

function createAbortError(message = 'Compute operation was cancelled') {
  const error = new Error(message);
  error.name = 'AbortError';
  error.code = 'COMPUTE_PROCESS_ABORTED';
  return error;
}

function waitForProcessExit(proc, timeoutMs = 2000) {
  return new Promise((resolve) => {
    if (!activeComputeProcesses.has(proc)) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    proc.once?.('exit', finish);
    proc.once?.('close', finish);
  });
}

async function terminateProcessTree(proc, platform = process.platform) {
  const pid = Number(proc?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return;

  if (platform === 'win32') {
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(finish, 2000);
      try {
        const killer = spawn('taskkill.exe', ['/pid', String(pid), '/T', '/F'], {
          shell: false,
          windowsHide: true,
          stdio: 'ignore',
        });
        killer.once('error', finish);
        killer.once('close', finish);
      } catch {
        finish();
      }
    });
    try { proc.kill?.(); } catch {}
    return;
  }

  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try { proc.kill?.('SIGTERM'); } catch {}
  }
  await waitForProcessExit(proc, 750);
  if (activeComputeProcesses.has(proc)) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try { proc.kill?.('SIGKILL'); } catch {}
    }
  }
}

export async function terminateActiveComputeProcesses() {
  await Promise.allSettled(
    [...activeComputeProcesses].map((proc) => terminateProcessTree(proc)),
  );
}

export function terminateActiveComputeProcessesSync() {
  for (const proc of activeComputeProcesses) {
    try { proc.kill?.(); } catch {}
  }
}

function bindAbortSignal(signal, onAbort) {
  if (!signal) return () => {};
  if (signal.aborted) {
    onAbort();
    return () => {};
  }
  signal.addEventListener('abort', onAbort, { once: true });
  return () => signal.removeEventListener('abort', onAbort);
}

// ─── ID generation ───

function generateId(hint) {
  const base = hint.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  const short = base.slice(0, 20) || 'node';
  return `${short}-${crypto.randomBytes(3).toString('hex')}`;
}

// ─── Config storage (multi-node) ───

async function loadRawConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return { nodes: [], activeNodeId: null, selectionMode: 'local' };
  }
}

async function migrateIfNeeded(data) {
  if (data.host && !data.nodes) {
    // Old single-node format → migrate
    const id = generateId(data.host);
    const node = {
      id,
      name: data.host,
      host: data.host,
      user: data.user,
      workDir: data.workDir || '~',
      type: 'direct',
    };
    if (data.keyPath) node.keyPath = data.keyPath;
    if (data.password) node.password = data.password;
    const migrated = { nodes: [node], activeNodeId: null, selectionMode: 'local' };
    await saveRawConfig(migrated);
    return migrated;
  }
  return data;
}

async function saveRawConfig(config) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

// ─── Public config API ───

export async function loadAllNodes() {
  const raw = await loadRawConfig();
  const config = await migrateIfNeeded(raw);
  if (config.selectionMode !== 'local' && config.selectionMode !== 'remote') {
    config.selectionMode = 'local';
    config.activeNodeId = null;
    await saveRawConfig(config);
  }
  return config;
}

export async function loadNodeConfig(nodeId) {
  const config = await loadAllNodes();
  const node = config.nodes.find(n => n.id === nodeId);
  if (!node) throw new Error(`Node "${nodeId}" not found`);
  return node;
}

export async function getActiveNode() {
  const config = await loadAllNodes();
  if (!config.activeNodeId || config.nodes.length === 0) return null;
  return config.nodes.find(n => n.id === config.activeNodeId) || null;
}

export async function saveNode(nodeConfig) {
  const config = await loadAllNodes();
  const idx = config.nodes.findIndex(n => n.id === nodeConfig.id);
  if (idx >= 0) {
    config.nodes[idx] = nodeConfig;
  } else {
    config.nodes.push(nodeConfig);
  }
  await saveRawConfig(config);
  return nodeConfig;
}

export async function deleteNode(nodeId) {
  const config = await loadAllNodes();
  config.nodes = config.nodes.filter(n => n.id !== nodeId);
  if (config.activeNodeId === nodeId) {
    config.activeNodeId = null;
    config.selectionMode = 'local';
  }
  await saveRawConfig(config);
}

export async function setActiveNode(nodeId) {
  const config = await loadAllNodes();
  if (!nodeId) {
    config.activeNodeId = null;
    config.selectionMode = 'local';
    await saveRawConfig(config);
    return null;
  }
  const node = config.nodes.find(n => n.id === nodeId);
  if (!node) throw new Error(`Node "${nodeId}" not found`);
  config.activeNodeId = nodeId;
  config.selectionMode = 'remote';
  await saveRawConfig(config);
  return node;
}

// Backward-compatible: returns active node config (flat object)
export async function loadConfig() {
  return await getActiveNode() || {};
}

export async function isComputeConfigured() {
  try {
    const node = await getActiveNode();
    return !!(node && node.host && node.user && (node.keyPath || node.password));
  } catch {
    return false;
  }
}

// ─── Shell execution helpers ───

export function execProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const {
      timeoutMs = COMPUTE_PROCESS_TIMEOUTS.command,
      timeoutMode = 'absolute',
      signal,
      operation = command,
      ...spawnOptions
    } = options;
    if (signal?.aborted) {
      reject(createAbortError(`${operation} was cancelled`));
      return;
    }

    const proc = spawn(command, args, {
      ...spawnOptions,
      shell: false,
      windowsHide: true,
      detached: spawnOptions.detached ?? process.platform !== 'win32',
    });
    activeComputeProcesses.add(proc);
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    let removeAbortListener = () => {};

    const cleanupPromise = () => {
      clearTimeout(timer);
      removeAbortListener();
    };
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanupPromise();
      callback(value);
    };
    const stop = (error) => {
      settle(reject, error);
      void terminateProcessTree(proc);
    };
    const armTimeout = () => {
      clearTimeout(timer);
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return;
      timer = setTimeout(() => {
        const description = timeoutMode === 'idle'
          ? `made no progress for ${Math.ceil(timeoutMs / SECOND)} seconds`
          : `timed out after ${Math.ceil(timeoutMs / SECOND)} seconds`;
        const error = new Error(`${operation} ${description}`);
        error.code = 'COMPUTE_PROCESS_TIMEOUT';
        stop(error);
      }, timeoutMs);
    };
    const captureOutput = (target, data) => {
      if (timeoutMode === 'idle') armTimeout();
      return target + data.toString();
    };
    removeAbortListener = bindAbortSignal(signal, () => {
      stop(createAbortError(`${operation} was cancelled`));
    });
    armTimeout();

    proc.stdout.on('data', (data) => { stdout = captureOutput(stdout, data); });
    proc.stderr.on('data', (data) => { stderr = captureOutput(stderr, data); });
    proc.on('error', (error) => {
      activeComputeProcesses.delete(proc);
      settle(reject, new Error(`Failed to start ${command}: ${error.message}`));
    });
    proc.on('close', (code) => {
      activeComputeProcesses.delete(proc);
      if (code === 0) settle(resolve, stdout.trim());
      else settle(reject, new Error(`Command failed (code ${code}): ${stderr || stdout}`));
    });
  });
}

export function cleanPtyOutput(output, password) {
  const cleanOutput = output
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  return cleanOutput
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => {
      const trimmed = line.trim();
      return trimmed
        && !/password:\s*$/i.test(trimmed)
        && trimmed !== password;
    })
    .join('\n')
    .trim();
}

function execWithPassword(command, args, password, options = {}) {
  return new Promise((resolve, reject) => {
    const {
      timeoutMs = COMPUTE_PROCESS_TIMEOUTS.connectionCheck,
      timeoutMode = 'absolute',
      signal,
      operation = command,
    } = typeof options === 'number' ? { timeoutMs: options } : options;
    if (signal?.aborted) {
      reject(createAbortError(`${operation} was cancelled`));
      return;
    }
    let output = '';
    let passwordSent = false;
    let finished = false;
    let proc;
    let timer = null;
    let removeAbortListener = () => {};

    try {
      proc = pty.spawn(command, args, {
        name: 'xterm',
        cols: 200,
        rows: 50,
        cwd: os.homedir(),
        env: { ...process.env, TERM: 'xterm' }
      });
    } catch (error) {
      reject(new Error(`Failed to start ${command}: ${error.message}`));
      return;
    }
    activeComputeProcesses.add(proc);

    removeAbortListener = bindAbortSignal(signal, () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(createAbortError(`${operation} was cancelled`));
      void terminateProcessTree(proc);
    });

    const armTimeout = () => {
      clearTimeout(timer);
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return;
      timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          removeAbortListener();
          const description = timeoutMode === 'idle'
            ? `made no progress for ${Math.ceil(timeoutMs / SECOND)} seconds`
            : `timed out after ${Math.ceil(timeoutMs / SECOND)} seconds`;
          const error = new Error(`${operation} ${description}`);
          error.code = 'COMPUTE_PROCESS_TIMEOUT';
          reject(error);
          void terminateProcessTree(proc);
        }
      }, timeoutMs);
    };
    armTimeout();

    proc.onData((data) => {
      const text = data.toString();
      output += text;
      if (timeoutMode === 'idle') armTimeout();

      if (!passwordSent && /password:\s*$/i.test(output.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, ''))) {
        passwordSent = true;
        proc.write(password + '\n');
      }
    });

    proc.onExit(({ exitCode }) => {
      activeComputeProcesses.delete(proc);
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      removeAbortListener();

      const result = cleanPtyOutput(output, password);

      if (exitCode === 0) {
        resolve(result);
      } else {
        reject(new Error(`Command failed (code ${exitCode}): ${result}`));
      }
    });
  });
}

export function buildSshInvocation(nodeConfig, remoteCmd, platform = process.platform) {
  const port = nodeConfig.port || 22;
  const command = platform === 'win32' ? 'ssh.exe' : 'ssh';
  const args = [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ConnectTimeout=15',
    '-o', 'ConnectionAttempts=1',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-p', String(port),
  ];

  if (nodeConfig.keyPath) {
    args.push('-o', 'BatchMode=yes');
    args.push('-i', nodeConfig.keyPath);
  }
  args.push(`${nodeConfig.user}@${nodeConfig.host}`, remoteCmd);
  return { command, args };
}

// Execute SSH command on a specific node
async function execSsh(nodeConfig, remoteCmd, options = {}) {
  const invocation = buildSshInvocation(nodeConfig, remoteCmd);

  if (nodeConfig.keyPath) {
    return await execProcess(invocation.command, invocation.args, {
      timeoutMs: options.timeoutMs ?? COMPUTE_PROCESS_TIMEOUTS.command,
      signal: options.signal,
      operation: options.operation || 'Remote SSH command',
    });
  } else if (nodeConfig.password) {
    return await execWithPassword(invocation.command, invocation.args, nodeConfig.password, {
      timeoutMs: options.timeoutMs ?? COMPUTE_PROCESS_TIMEOUTS.command,
      signal: options.signal,
      operation: options.operation || 'Remote SSH command',
    });
  } else {
    throw new Error('No authentication method configured (need SSH key or password)');
  }
}

export function buildRsyncInvocation(nodeConfig, sources, destination, excludes = [], platform = process.platform) {
  if (platform === 'win32') {
    throw new Error('rsync is not used for Windows compute synchronization');
  }
  const port = nodeConfig.port || 22;
  const sshExecutable = 'ssh';
  const sshParts = [
    sshExecutable,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ConnectTimeout=15',
    '-o', 'ConnectionAttempts=1',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-p', String(port),
  ];
  if (nodeConfig.keyPath) {
    const escapedKeyPath = nodeConfig.keyPath.replace(/"/g, '\\"');
    sshParts.push('-i', `"${escapedKeyPath}"`);
  }

  return {
    command: 'rsync',
    args: [
      '-a',
      '--partial',
      '--progress',
      ...excludes.flatMap(pattern => ['--exclude', pattern]),
      '-e', sshParts.join(' '),
      ...(Array.isArray(sources) ? sources : [sources]),
      destination,
    ],
  };
}

export function buildScpInvocation(
  nodeConfig,
  sources,
  destination,
  platform = process.platform,
  { recursive = false, command = null } = {},
) {
  const port = nodeConfig.port || 22;
  const args = [
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ConnectTimeout=15',
    '-o', 'ConnectionAttempts=1',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-P', String(port),
  ];
  if (nodeConfig.keyPath) {
    args.push('-o', 'BatchMode=yes');
    args.push('-i', nodeConfig.keyPath);
  }
  if (recursive) {
    args.push('-r');
  }
  args.push(...(Array.isArray(sources) ? sources : [sources]), destination);
  return {
    command: command || (platform === 'win32' ? 'scp.exe' : 'scp'),
    args,
  };
}

function quotePosixShell(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function quoteRemoteDirectory(remotePath) {
  const value = String(remotePath || '').trim();
  if (value === '~') {
    return '"$HOME"';
  }
  if (value.startsWith('~/')) {
    return `"$HOME"/${quotePosixShell(value.slice(2))}`;
  }
  return quotePosixShell(value);
}

export function normalizeSyncEntries(entries = []) {
  if (!Array.isArray(entries) || entries.length > 32) {
    throw new Error('Sync file list is invalid');
  }
  return entries.map((entry) => {
    const normalized = String(entry || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
    const segments = normalized.split('/').filter(Boolean);
    if (
      !normalized
      || normalized.length > 512
      || normalized.startsWith('/')
      || /^[A-Za-z]:/.test(normalized)
      || segments.includes('..')
    ) {
      throw new Error(`Unsafe sync path: ${entry}`);
    }
    return normalized;
  });
}

export function assertSafeArchiveEntries(listing) {
  for (const entry of String(listing || '').split(/\r?\n/).filter(Boolean)) {
    const normalized = entry.trim().replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || segments.includes('..')) {
      throw new Error(`Unsafe path in downloaded archive: ${entry}`);
    }
  }
}

async function resolveWindowsExecutable(command) {
  try {
    const output = await execProcess('where.exe', [command]);
    const resolved = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    if (resolved) {
      return resolved;
    }
  } catch {
    // Return a controlled API error instead of asking node-pty to launch a missing executable.
  }
  throw new Error(`${command} is unavailable. Enable the Windows OpenSSH Client and system tar tools, then retry.`);
}

async function execScp(nodeConfig, sources, destination, options = {}) {
  const invocation = buildScpInvocation(nodeConfig, sources, destination, process.platform, options);
  if (nodeConfig.keyPath) {
    return await execProcess(invocation.command, invocation.args, {
      timeoutMs: options.timeoutMs ?? COMPUTE_PROCESS_TIMEOUTS.transfer,
      timeoutMode: options.timeoutMode || 'idle',
      signal: options.signal,
      operation: options.operation || 'Remote file transfer',
    });
  }
  if (nodeConfig.password) {
    return await execWithPassword(invocation.command, invocation.args, nodeConfig.password, {
      timeoutMs: options.timeoutMs ?? COMPUTE_PROCESS_TIMEOUTS.transfer,
      timeoutMode: options.timeoutMode || 'idle',
      signal: options.signal,
      operation: options.operation || 'Remote file transfer',
    });
  }
  throw new Error('No authentication method configured');
}

function syncGlobToRegExp(pattern) {
  const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
}

export function shouldExcludeSyncPath(relativePath, excludes = []) {
  const normalizedPath = String(relativePath || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  const segments = normalizedPath.split('/').filter(Boolean);
  return excludes.some((rawPattern) => {
    const pattern = String(rawPattern || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '').replace(/\/$/, '');
    if (!pattern) return false;
    const matcher = syncGlobToRegExp(pattern);
    if (pattern.includes('/')) {
      return matcher.test(normalizedPath)
        || normalizedPath.startsWith(`${pattern}/`);
    }
    return segments.some((segment) => matcher.test(segment));
  });
}

export async function createSyncSnapshot(cwd, excludes = [], { signal } = {}) {
  const snapshot = {};

  const walk = async (absoluteDirectory, relativeDirectory = '') => {
    if (signal?.aborted) throw createAbortError('Project snapshot was cancelled');
    let entries;
    try {
      entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (signal?.aborted) throw createAbortError('Project snapshot was cancelled');
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      if (shouldExcludeSyncPath(relativePath, excludes)) continue;

      const absolutePath = path.join(absoluteDirectory, entry.name);
      let stats;
      try {
        stats = await fs.lstat(absolutePath);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }

      const type = stats.isDirectory()
        ? 'directory'
        : stats.isSymbolicLink()
          ? 'symlink'
          : stats.isFile()
            ? 'file'
            : null;
      if (!type) continue;

      snapshot[relativePath.replace(/\\/g, '/')] = {
        type,
        size: stats.size,
        mtimeMs: Math.trunc(stats.mtimeMs),
        mode: stats.mode,
      };
      if (type === 'directory') {
        await walk(absolutePath, relativePath.replace(/\\/g, '/'));
      }
    }
  };

  await walk(path.resolve(cwd));
  return snapshot;
}

export function diffSyncSnapshots(previousSnapshot = {}, currentSnapshot = {}) {
  return Object.keys(currentSnapshot).filter((relativePath) => {
    const previous = previousSnapshot[relativePath];
    const current = currentSnapshot[relativePath];
    return !previous
      || previous.type !== current.type
      || previous.size !== current.size
      || previous.mtimeMs !== current.mtimeMs
      || previous.mode !== current.mode;
  });
}

function getComputeSyncStateFile(nodeConfig, cwd) {
  const identity = `${nodeConfig.id || `${nodeConfig.user}@${nodeConfig.host}`}\0${path.resolve(cwd)}`;
  const digest = crypto.createHash('sha256').update(identity).digest('hex');
  return path.join(COMPUTE_SYNC_STATE_DIR, `${digest}.json`);
}

async function loadComputeSyncState(nodeConfig, cwd, remotePath) {
  try {
    const state = JSON.parse(await fs.readFile(getComputeSyncStateFile(nodeConfig, cwd), 'utf8'));
    if (state.version !== COMPUTE_SYNC_STATE_VERSION || state.remotePath !== remotePath) return null;
    return state;
  } catch {
    return null;
  }
}

async function saveComputeSyncState(nodeConfig, cwd, state) {
  await fs.mkdir(COMPUTE_SYNC_STATE_DIR, { recursive: true });
  const stateFile = getComputeSyncStateFile(nodeConfig, cwd);
  const temporaryFile = `${stateFile}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temporaryFile, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryFile, stateFile);
  } finally {
    await fs.rm(temporaryFile, { force: true }).catch(() => {});
  }
}

async function syncWindowsUpload(nodeConfig, cwd, remotePath, excludes, { signal } = {}) {
  const snapshot = await createSyncSnapshot(cwd, excludes, { signal });
  const remoteMarker = `${remotePath}.medhelp-sync-state`;
  const previousState = await loadComputeSyncState(nodeConfig, cwd, remotePath);
  let previousSnapshot = {};

  if (previousState?.token) {
    const remoteToken = await execSsh(nodeConfig, [
      `if [ -f ${quoteRemoteDirectory(remoteMarker)} ]; then`,
      `cat ${quoteRemoteDirectory(remoteMarker)}`,
      'fi',
    ].join(' '), {
      timeoutMs: COMPUTE_PROCESS_TIMEOUTS.connectionCheck,
      signal,
      operation: 'Remote sync state check',
    });
    if (remoteToken.trim() === previousState.token) {
      previousSnapshot = previousState.snapshot || {};
    }
  }

  const changedEntries = diffSyncSnapshots(previousSnapshot, snapshot);
  if (previousState?.token && previousSnapshot === previousState.snapshot && changedEntries.length === 0) {
    return 'Already up to date (0 files uploaded).';
  }

  const token = crypto.randomBytes(16).toString('hex');
  const state = {
    version: COMPUTE_SYNC_STATE_VERSION,
    remotePath,
    token,
    snapshot,
    updatedAt: new Date().toISOString(),
  };

  if (changedEntries.length === 0) {
    await execSsh(nodeConfig, [
      `mkdir -p ${quoteRemoteDirectory(remotePath)}`,
      `printf '%s' ${quotePosixShell(token)} > ${quoteRemoteDirectory(remoteMarker)}`,
    ].join(' && '), {
      timeoutMs: COMPUTE_PROCESS_TIMEOUTS.connectionCheck,
      signal,
      operation: 'Remote sync state initialization',
    });
    await saveComputeSyncState(nodeConfig, cwd, state);
    return 'Already up to date (empty project initialized).';
  }

  const [tarCommand, scpCommand] = await Promise.all([
    resolveWindowsExecutable('tar.exe'),
    resolveWindowsExecutable('scp.exe'),
  ]);
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-sync-upload-'));
  const archivePath = path.join(tempRoot, 'project.tar');
  const manifestPath = path.join(tempRoot, 'changed-files.txt');
  const remoteArchive = `/tmp/medhelp-sync-${crypto.randomBytes(10).toString('hex')}.tar`;
  let remoteArchiveCreated = false;

  try {
    const archiveEntries = changedEntries.map((relativePath) => {
      if (relativePath.includes('\n') || relativePath.includes('\r')) {
        throw new Error(`Cannot synchronize a path containing a newline: ${relativePath}`);
      }
      return `./${relativePath}`;
    });
    await fs.writeFile(manifestPath, `${archiveEntries.join('\n')}\n`, 'utf8');
    await execProcess(tarCommand, [
      '-cf', archivePath,
      '--no-recursion',
      '-T', manifestPath,
    ], {
      cwd,
      timeoutMs: COMPUTE_PROCESS_TIMEOUTS.archive,
      signal,
      operation: 'Incremental project archive creation',
    });
    // Mark the remote path before SCP starts so a cancelled partial upload is
    // also removed during cleanup.
    remoteArchiveCreated = true;
    const scpOutput = await execScp(
      nodeConfig,
      archivePath,
      `${nodeConfig.user}@${nodeConfig.host}:${remoteArchive}`,
      {
        command: scpCommand,
        signal,
        timeoutMs: 0,
        operation: 'Incremental project upload',
      },
    );
    const remoteOutput = await execSsh(nodeConfig, [
      `mkdir -p ${quoteRemoteDirectory(remotePath)}`,
      `tar -xf ${quotePosixShell(remoteArchive)} -C ${quoteRemoteDirectory(remotePath)}`,
      `rm -f ${quotePosixShell(remoteArchive)}`,
      `printf '%s' ${quotePosixShell(token)} > ${quoteRemoteDirectory(remoteMarker)}`,
    ].join(' && '), {
      timeoutMs: COMPUTE_PROCESS_TIMEOUTS.archive,
      signal,
      operation: 'Remote incremental project extraction',
    });
    remoteArchiveCreated = false;
    await saveComputeSyncState(nodeConfig, cwd, state);
    const changedFiles = changedEntries.filter((relativePath) => snapshot[relativePath]?.type !== 'directory');
    const changedBytes = changedFiles.reduce((total, relativePath) => total + (snapshot[relativePath]?.size || 0), 0);
    const summary = `Incremental sync uploaded ${changedFiles.length} changed files (${changedBytes} bytes).`;
    return [summary, scpOutput, remoteOutput].filter(Boolean).join('\n');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    if (remoteArchiveCreated) {
      await execSsh(nodeConfig, `rm -f ${quotePosixShell(remoteArchive)}`, {
        timeoutMs: COMPUTE_PROCESS_TIMEOUTS.cleanup,
        operation: 'Remote sync cleanup',
      }).catch(() => {});
    }
  }
}

async function syncWindowsDownload(nodeConfig, cwd, remotePath, files, { signal } = {}) {
  const [tarCommand, scpCommand] = await Promise.all([
    resolveWindowsExecutable('tar.exe'),
    resolveWindowsExecutable('scp.exe'),
  ]);
  const safeFiles = normalizeSyncEntries(files);
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-sync-download-'));
  const archivePath = path.join(tempRoot, 'results.tgz');
  const remoteArchive = `/tmp/medhelp-sync-${crypto.randomBytes(10).toString('hex')}.tgz`;
  let remoteArchiveCreated = false;

  try {
    await execSsh(nodeConfig, [
      `tar -czf ${quotePosixShell(remoteArchive)}`,
      '--ignore-failed-read',
      `-C ${quoteRemoteDirectory(remotePath)}`,
      ...safeFiles.map(quotePosixShell),
    ].join(' '), {
      timeoutMs: COMPUTE_PROCESS_TIMEOUTS.archive,
      signal,
      operation: 'Remote result archive creation',
    });
    remoteArchiveCreated = true;
    const scpOutput = await execScp(
      nodeConfig,
      `${nodeConfig.user}@${nodeConfig.host}:${remoteArchive}`,
      archivePath,
      { command: scpCommand, signal, operation: 'Result download' },
    );
    const listing = await execProcess(tarCommand, ['-tzf', archivePath], {
      timeoutMs: COMPUTE_PROCESS_TIMEOUTS.archive,
      signal,
      operation: 'Downloaded archive validation',
    });
    assertSafeArchiveEntries(listing);
    const extractOutput = await execProcess(tarCommand, ['-xzf', archivePath, '-C', cwd], {
      timeoutMs: COMPUTE_PROCESS_TIMEOUTS.archive,
      signal,
      operation: 'Result archive extraction',
    });
    return [scpOutput, extractOutput].filter(Boolean).join('\n');
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    if (remoteArchiveCreated) {
      await execSsh(nodeConfig, `rm -f ${quotePosixShell(remoteArchive)}`, {
        timeoutMs: COMPUTE_PROCESS_TIMEOUTS.cleanup,
        operation: 'Remote sync cleanup',
      }).catch(() => {});
    }
  }
}

// Execute rsync on a specific node
async function execRsync(nodeConfig, sources, destination, excludes = [], options = {}) {
  const invocation = buildRsyncInvocation(nodeConfig, sources, destination, excludes);

  if (nodeConfig.keyPath) {
    return await execProcess(invocation.command, invocation.args, {
      timeoutMs: options.timeoutMs ?? COMPUTE_PROCESS_TIMEOUTS.transfer,
      timeoutMode: options.timeoutMode || 'idle',
      signal: options.signal,
      operation: options.operation || 'Remote file synchronization',
    });
  } else if (nodeConfig.password) {
    return await execWithPassword(invocation.command, invocation.args, nodeConfig.password, {
      timeoutMs: options.timeoutMs ?? COMPUTE_PROCESS_TIMEOUTS.transfer,
      timeoutMode: options.timeoutMode || 'idle',
      signal: options.signal,
      operation: options.operation || 'Remote file synchronization',
    });
  } else {
    throw new Error('No authentication method configured');
  }
}

function getProjectName(cwd) {
  return path.basename(cwd);
}

// ─── Helper: resolve node config from optional nodeId ───

async function resolveNode(nodeId) {
  if (nodeId) {
    return await loadNodeConfig(nodeId);
  }
  const active = await getActiveNode();
  if (!active) throw new Error('No compute node configured. Please add a node first.');
  return active;
}

export async function runProjectSync(config, cwd, externalSignal, operation) {
  const key = `${config.id}:${path.resolve(cwd)}`;
  const previous = activeProjectSyncs.get(key);
  if (previous) {
    previous.controller.abort(createAbortError('Superseded by a newer sync for this project'));
    await Promise.race([
      previous.settled,
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  }

  const controller = new AbortController();
  const removeExternalAbort = bindAbortSignal(externalSignal, () => {
    controller.abort(externalSignal?.reason || createAbortError());
  });
  let markSettled;
  const settled = new Promise((resolve) => { markSettled = resolve; });
  const record = { controller, settled };
  activeProjectSyncs.set(key, record);

  try {
    return await operation(controller.signal);
  } finally {
    removeExternalAbort();
    markSettled();
    if (activeProjectSyncs.get(key) === record) {
      activeProjectSyncs.delete(key);
    }
  }
}

// ─── Main ComputeNode API ───

export const ComputeNode = {
  // Configure / save a node
  async configure({ id, name, host, user, key, password, workDir = '~', type = 'direct', slurm, port, activate = true }) {
    const nodeId = id || generateId(host);
    const node = {
      id: nodeId,
      name: name || host,
      host,
      user,
      port: port || 22,
      workDir,
      type,
    };

    if (key) {
      if (key.includes('BEGIN')) {
        const keyPath = path.join(os.homedir(), '.ssh', `compute_${nodeId}_key`);
        await fs.mkdir(path.dirname(keyPath), { recursive: true });
        await fs.writeFile(keyPath, key + '\n', { mode: 0o600 });
        node.keyPath = keyPath;
      } else {
        node.keyPath = key;
      }
    } else if (password) {
      node.password = password;
    }

    if (type === 'slurm' && slurm) {
      node.slurm = slurm;
    }

    await saveNode(node);
    if (activate) {
      await setActiveNode(node.id);
    }
    return `Configuration saved for ${node.user}@${node.host} (${nodeId})`;
  },

  // Sync code up/down
  async sync({ nodeId, direction = 'up', files = [], cwd, signal }) {
    const config = await resolveNode(nodeId);
    return await runProjectSync(config, cwd, signal, async (syncSignal) => {
      const projectName = getProjectName(cwd);
      const remoteBase = config.workDir.endsWith('/') ? config.workDir : config.workDir + '/';
      const remotePath = `${remoteBase}${projectName}/`;

      if (direction === 'up') {
        const excludes = [
          '.git', 'node_modules', '__pycache__', '*.pyc', '.DS_Store',
          '.env', '.env.*', 'server/data', '*.db', '*.sqlite', '.runtime', '.pipeline', 'backup',
          '.medhelp-sync-state',
        ];
        if (process.platform === 'win32') {
          return await syncWindowsUpload(config, cwd, remotePath, excludes, { signal: syncSignal });
        }
        await execSsh(config, `mkdir -p ${quoteRemoteDirectory(remotePath)}`, {
          timeoutMs: COMPUTE_PROCESS_TIMEOUTS.connectionCheck,
          signal: syncSignal,
          operation: 'Remote project directory creation',
        });
        return await execRsync(
          config,
          `${cwd}/`,
          `${config.user}@${config.host}:${remotePath}`,
          excludes,
          { signal: syncSignal },
        );
      }

      const filesToSync = normalizeSyncEntries(
        files.length > 0 ? files : ['logs/', 'checkpoints/', 'results/'],
      );
      if (process.platform === 'win32') {
        return await syncWindowsDownload(config, cwd, remotePath, filesToSync, { signal: syncSignal });
      }
      const output = [];
      for (const file of filesToSync) {
        output.push(await execRsync(
          config,
          `${config.user}@${config.host}:${remotePath}${file}`,
          `${cwd}/`,
          [],
          { signal: syncSignal },
        ));
      }
      return output.filter(Boolean).join('\n');
    });
  },

  // Run a command on a node
  async run({ nodeId, command, cwd, skipSync = false, signal, timeoutMs }) {
    const config = await resolveNode(nodeId);

    if (cwd) {
      const projectName = getProjectName(cwd);
      const remoteBase = config.workDir.endsWith('/') ? config.workDir : config.workDir + '/';
      const remotePath = `${remoteBase}${projectName}/`;

      if (!skipSync) {
        await this.sync({ nodeId: config.id, direction: 'up', cwd, signal });
      }
      return await execSsh(config, `cd ${quoteRemoteDirectory(remotePath)} && ${command}`, {
        signal,
        timeoutMs,
      });
    } else {
      return await execSsh(config, command, { signal, timeoutMs });
    }
  },

  // ─── Slurm-specific methods ───

  // Get partition info
  async sinfo({ nodeId }) {
    const config = await resolveNode(nodeId);
    if (config.type !== 'slurm') throw new Error('Node is not a Slurm cluster');
    const output = await execSsh(config, 'sinfo --format="%P %a %l %D %G" --noheader');
    // Parse into structured data
    const partitions = output.split('\n').filter(Boolean).map(line => {
      const parts = line.trim().split(/\s+/);
      const name = parts[0]?.replace('*', '') || '';
      const isDefault = parts[0]?.endsWith('*') || false;
      return {
        name,
        isDefault,
        available: parts[1] || '',
        timeLimit: parts[2] || '',
        nodes: parts[3] || '',
        gres: parts[4] || '',
      };
    });
    return partitions;
  },

  // Get job queue
  async squeue({ nodeId }) {
    const config = await resolveNode(nodeId);
    if (config.type !== 'slurm') throw new Error('Node is not a Slurm cluster');
    const output = await execSsh(config, `squeue -u ${config.user} --format="%i %j %P %T %M %l %D %R" --noheader`);
    if (!output.trim()) return [];
    const jobs = output.split('\n').filter(Boolean).map(line => {
      const parts = line.trim().split(/\s+/);
      return {
        jobId: parts[0] || '',
        name: parts[1] || '',
        partition: parts[2] || '',
        state: parts[3] || '',
        elapsed: parts[4] || '',
        timeLimit: parts[5] || '',
        nodes: parts[6] || '',
        reason: parts.slice(7).join(' ') || '',
      };
    });
    return jobs;
  },

  // Interactive GPU allocation (salloc + srun)
  async salloc({ nodeId, partition, time, gpus, account, command }) {
    const config = await resolveNode(nodeId);
    if (config.type !== 'slurm') throw new Error('Node is not a Slurm cluster');

    const defaults = config.slurm || {};
    const p = partition || defaults.defaultPartition;
    const t = time || defaults.defaultTime || '00:30:00';
    const g = gpus ?? defaults.defaultGpus ?? 1;
    const a = account || defaults.defaultAccount;

    let sallocCmd = 'salloc';
    if (p) sallocCmd += ` --partition=${p}`;
    sallocCmd += ` --time=${t}`;
    sallocCmd += ` --gres=gpu:${g}`;
    if (a) sallocCmd += ` -A ${a}`;

    if (command) {
      sallocCmd += ` srun ${command}`;
    }

    return await execSsh(config, sallocCmd);
  },

  // Submit batch job
  async sbatch({ nodeId, rawScript, script, partition, time, gpus, account, jobName }) {
    const config = await resolveNode(nodeId);
    if (config.type !== 'slurm') throw new Error('Node is not a Slurm cluster');

    let sbatchScript;

    if (rawScript) {
      // User provided the full script with #SBATCH directives — use as-is
      sbatchScript = rawScript;
    } else {
      // Auto-generate headers + append user script body
      const defaults = config.slurm || {};
      const p = partition || defaults.defaultPartition;
      const t = time || defaults.defaultTime || '02:00:00';
      const g = gpus ?? defaults.defaultGpus ?? 1;
      const a = account || defaults.defaultAccount;
      const name = jobName || 'medhelp-job';

      sbatchScript = '#!/bin/bash\n';
      sbatchScript += `#SBATCH --job-name=${name}\n`;
      if (p) sbatchScript += `#SBATCH --partition=${p}\n`;
      sbatchScript += `#SBATCH --time=${t}\n`;
      sbatchScript += `#SBATCH --gres=gpu:${g}\n`;
      if (a) sbatchScript += `#SBATCH -A ${a}\n`;
      sbatchScript += `#SBATCH --output=${name}-%j.out\n`;
      sbatchScript += `#SBATCH --error=${name}-%j.err\n`;
      sbatchScript += '\n';
      sbatchScript += script;
    }

    // Write script to remote via base64 to preserve newlines and special chars
    const workDir = config.workDir || '~';
    const scriptPath = `${workDir}/.medhelp-sbatch-${Date.now()}.sh`;
    const b64 = Buffer.from(sbatchScript).toString('base64');
    const remoteCmd = `echo '${b64}' | base64 -d > ${scriptPath} && chmod +x ${scriptPath} && sbatch ${scriptPath} && rm -f ${scriptPath}`;
    return await execSsh(config, remoteCmd);
  },

  // Cancel a job
  async scancel({ nodeId, jobId }) {
    const config = await resolveNode(nodeId);
    if (config.type !== 'slurm') throw new Error('Node is not a Slurm cluster');
    return await execSsh(config, `scancel ${jobId}`);
  },
};
