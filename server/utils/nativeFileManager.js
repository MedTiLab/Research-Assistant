import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

function getWindowsExplorerCommand(env = process.env) {
  const systemRoot = env.SystemRoot || env.WINDIR || env.windir;
  if (systemRoot) {
    return path.win32.join(systemRoot, 'explorer.exe');
  }
  return 'explorer.exe';
}

function getWindowsTargetPath(targetPath) {
  return path.win32.normalize(path.win32.resolve(String(targetPath || '')));
}

function isWslEnvironment({
  platform = process.platform,
  release = os.release(),
  env = process.env,
} = {}) {
  return platform === 'linux'
    && (Boolean(env.WSL_DISTRO_NAME) || /microsoft|wsl/i.test(String(release || '')));
}

function spawnDetached(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      ...options,
    });

    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function convertWslPathToWindows(targetPath, { spawnFn = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnFn('wslpath', ['-w', targetPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(stderr.trim() || `wslpath exited with code ${code}`));
    });
  });
}

export function buildNativeFileManagerLaunch(targetPath, {
  isDirectory = false,
  platform = process.platform,
  env = process.env,
  release = os.release(),
  wslWindowsPath = null,
} = {}) {
  const absoluteTargetPath = platform === 'win32'
    ? getWindowsTargetPath(targetPath)
    : path.resolve(targetPath);

  if (platform === 'darwin') {
    return {
      command: 'open',
      args: isDirectory ? [absoluteTargetPath] : ['-R', absoluteTargetPath],
      openedPath: absoluteTargetPath,
    };
  }

  if (platform === 'win32') {
    const windowsTarget = getWindowsTargetPath(absoluteTargetPath);
    return {
      command: getWindowsExplorerCommand(env),
      fallbackCommand: 'explorer.exe',
      args: isDirectory ? [windowsTarget] : [`/select,${windowsTarget}`],
      openedPath: windowsTarget,
    };
  }

  if (isWslEnvironment({ platform, release, env })) {
    const windowsTarget = wslWindowsPath || absoluteTargetPath;
    return {
      command: 'explorer.exe',
      args: isDirectory ? [windowsTarget] : [`/select,${windowsTarget}`],
      openedPath: windowsTarget,
    };
  }

  const openedPath = isDirectory ? absoluteTargetPath : path.dirname(absoluteTargetPath);
  return {
    command: 'xdg-open',
    args: [openedPath],
    openedPath,
  };
}

export async function openPathInNativeFileManager(targetPath, stats, {
  platform = process.platform,
  env = process.env,
  release = os.release(),
  spawnFn = spawnDetached,
  wslPathConverter = convertWslPathToWindows,
} = {}) {
  const isDirectory = Boolean(stats?.isDirectory?.());
  const absoluteTargetPath = platform === 'win32'
    ? getWindowsTargetPath(targetPath)
    : path.resolve(targetPath);
  let wslWindowsPath = null;

  if (isWslEnvironment({ platform, release, env })) {
    wslWindowsPath = await wslPathConverter(absoluteTargetPath);
  }

  const launch = buildNativeFileManagerLaunch(absoluteTargetPath, {
    isDirectory,
    platform,
    env,
    release,
    wslWindowsPath,
  });

  try {
    await spawnFn(launch.command, launch.args);
  } catch (error) {
    if (platform === 'win32' && launch.fallbackCommand && launch.fallbackCommand !== launch.command) {
      await spawnFn(launch.fallbackCommand, launch.args);
    } else {
      throw error;
    }
  }

  return launch.openedPath;
}
