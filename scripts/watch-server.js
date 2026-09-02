#!/usr/bin/env node

import chokidar from 'chokidar';
import { spawn } from 'child_process';
import path from 'path';
import { getBackendPortSync, DEFAULT_BACKEND_PORT } from '../server/utils/runtimePorts.js';
import { shouldDeferServerRestart } from './watch-server-restart.js';

const ENTRYPOINT = path.join('server', 'index.js');
const WATCH_PATHS = [
  path.join('server', 'routes'),
  path.join('server', 'middleware'),
  path.join('server', 'database'),
  path.join('server', 'services'),
  path.join('server', 'utils'),
  path.join('server', 'pipeline'),
  path.join('server', 'execution-memory'),
  path.join('server', 'agent-runtime'),
  path.join('server', 'pi-runtime'),
  path.join('server', 'constants'),
  path.join('server', 'templates'),
  path.join('server', 'projects.js'),
  'shared',
  ENTRYPOINT,
];
const IGNORED = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.DS_Store',
  '**/*.swp',
  '**/*.tmp',
];
const RESTART_DEBOUNCE_MS = 150;
const ACTIVE_AGENT_RETRY_MS = 1000;
const FORCE_KILL_AFTER_MS = 5000;

let child = null;
let restartTimer = null;
let pendingRestart = false;
let shuttingDown = false;
let forceKillTimer = null;
let restartDeferredLogged = false;
let restartRequestSeq = 0;

function clearForceKillTimer() {
  if (forceKillTimer) {
    clearTimeout(forceKillTimer);
    forceKillTimer = null;
  }
}

function logRestart() {
  console.log(`Restarting '${ENTRYPOINT}'`);
}

function startChild() {
  child = spawn(process.execPath, [ENTRYPOINT], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  child.on('exit', (code, signal) => {
    clearForceKillTimer();
    child = null;

    if (shuttingDown) {
      process.exit(code ?? (signal ? 1 : 0));
    }

    if (pendingRestart) {
      pendingRestart = false;
      startChild();
      return;
    }

    if (code !== 0) {
      console.error(`Failed running '${ENTRYPOINT}'. Waiting for file changes before restarting...`);
    }
  });
}

async function isAgentBusy() {
  if (!child) {
    return false;
  }

  const backendPort = getBackendPortSync(DEFAULT_BACKEND_PORT);
  try {
    const response = await fetch(`http://127.0.0.1:${backendPort}/health`, {
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) {
      return false;
    }
    return shouldDeferServerRestart(await response.json());
  } catch {
    // If the old process is already unavailable, restart immediately so a
    // broken edit cannot leave the development server permanently stopped.
    return false;
  }
}

async function restartWhenIdle(requestSeq) {
  restartTimer = null;

  const agentBusy = await isAgentBusy();
  if (shuttingDown || requestSeq !== restartRequestSeq) {
    return;
  }

  if (agentBusy) {
    if (!restartDeferredLogged) {
      console.log(`Deferring restart of '${ENTRYPOINT}' until the active agent finishes`);
      restartDeferredLogged = true;
    }
    restartTimer = setTimeout(() => {
      void restartWhenIdle(requestSeq);
    }, ACTIVE_AGENT_RETRY_MS);
    return;
  }

  restartDeferredLogged = false;

  if (!child) {
    logRestart();
    startChild();
    return;
  }

  pendingRestart = true;
  logRestart();

  clearForceKillTimer();
  forceKillTimer = setTimeout(() => {
    if (child && !child.killed) {
      child.kill('SIGKILL');
    }
  }, FORCE_KILL_AFTER_MS);

  child.kill(process.platform === 'win32' ? undefined : 'SIGTERM');
}

function requestRestart() {
  if (shuttingDown) {
    return;
  }

  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartRequestSeq += 1;
  const requestSeq = restartRequestSeq;
  restartTimer = setTimeout(() => {
    void restartWhenIdle(requestSeq);
  }, RESTART_DEBOUNCE_MS);
}

function shutdown(signal) {
  shuttingDown = true;
  restartRequestSeq += 1;

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  clearForceKillTimer();

  if (!child) {
    process.exit(0);
    return;
  }

  child.once('exit', () => {
    process.exit(0);
  });

  child.kill(signal);
}

const watcher = chokidar.watch(WATCH_PATHS, {
  ignored: IGNORED,
  ignoreInitial: true,
  persistent: true,
  followSymlinks: false,
  awaitWriteFinish: {
    stabilityThreshold: 100,
    pollInterval: 50,
  },
});

watcher.on('all', () => {
  requestRestart();
});

watcher.on('error', (error) => {
  console.error('[watch-server] Watcher error:', error.message);
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startChild();
