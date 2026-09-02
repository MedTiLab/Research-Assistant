#!/usr/bin/env node

// Independent updater launched by the Windows Local Engine.

import crypto from 'crypto';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const payloadPath = process.argv[2];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function writeStatus(statusPath, payload) {
  await fsPromises.mkdir(path.dirname(statusPath), { recursive: true });
  await fsPromises.writeFile(statusPath, `${JSON.stringify({
    updatedAt: new Date().toISOString(),
    ...payload,
  }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function appendLog(logPath, message) {
  await fsPromises.mkdir(path.dirname(logPath), { recursive: true });
  await fsPromises.appendFile(logPath, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
}

function verifySignature(sha256, signature, publicKey) {
  return crypto.verify(
    null,
    Buffer.from(sha256, 'hex'),
    publicKey,
    Buffer.from(signature, 'base64'),
  );
}

if (!payloadPath) {
  process.exit(2);
}

let payload;
try {
  payload = JSON.parse(await fsPromises.readFile(payloadPath, 'utf8'));
  await appendLog(payload.logPath, `Waiting for Kernel PID ${payload.parentPid} to stop`);
  const deadline = Date.now() + 120_000;
  while (processExists(payload.parentPid) && Date.now() < deadline) {
    await sleep(500);
  }
  if (processExists(payload.parentPid)) {
    throw new Error('The previous Kernel did not stop within 120 seconds');
  }

  const actualSha256 = await hashFile(payload.packagePath);
  if (actualSha256 !== payload.expectedSha256) {
    throw new Error('Package checksum changed before installation');
  }
  const publicKey = await fsPromises.readFile(payload.publicKeyPath, 'utf8');
  if (!verifySignature(actualSha256, payload.expectedSignature, publicKey)) {
    throw new Error('Package signature changed before installation');
  }

  await writeStatus(payload.statusPath, {
    state: 'installing',
    progress: 82,
    currentVersion: payload.currentVersion,
    targetVersion: payload.targetVersion,
  });
  await appendLog(payload.logPath, `Installing Kernel ${payload.targetVersion}`);
  const installLogFd = fs.openSync(payload.logPath, 'a');
  const result = spawnSync(payload.nodeExecutable, [
    payload.npmCliPath,
    'install',
    '-g',
    '--force',
    '--no-audit',
    '--no-fund',
    payload.packagePath,
  ], {
    cwd: os.tmpdir(),
    stdio: ['ignore', installLogFd, installLogFd],
    windowsHide: true,
    timeout: 10 * 60 * 1000,
  });
  fs.closeSync(installLogFd);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm install failed with exit code ${result.status}; see ${payload.logPath}`);
  }

  await writeStatus(payload.statusPath, {
    state: 'awaiting_manual_restart',
    progress: 100,
    currentVersion: payload.currentVersion,
    targetVersion: payload.targetVersion,
  });
  await appendLog(
    payload.logPath,
    `Kernel ${payload.targetVersion} installed; automatic restart disabled, waiting for manual start`,
  );
} catch (error) {
  if (payload?.statusPath) {
    await writeStatus(payload.statusPath, {
      state: 'failed',
      progress: 0,
      currentVersion: payload.currentVersion,
      targetVersion: payload.targetVersion,
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => {});
  }
  if (payload?.logPath) {
    await appendLog(payload.logPath, `Update failed: ${error instanceof Error ? error.message : String(error)}`).catch(() => {});
  }
  process.exitCode = 1;
}
