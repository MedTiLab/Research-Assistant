import fs from 'node:fs';
import path from 'node:path';

function readFailureTimes(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed?.failures)
      ? parsed.failures.filter((value) => Number.isFinite(Number(value))).map(Number)
      : [];
  } catch {
    return [];
  }
}

function writeFailureTimes(filePath, failures) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify({ failures })}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

export function createRendererRecoveryPolicy({
  filePath,
  now = Date.now,
  windowMs = 5 * 60_000,
  maxAutomaticReloads = 1,
} = {}) {
  if (!filePath) throw new TypeError('Renderer recovery policy requires a file path');

  return {
    registerFailure() {
      const currentTime = now();
      const failures = readFailureTimes(filePath)
        .filter((timestamp) => currentTime - timestamp <= windowMs);
      failures.push(currentTime);
      writeFailureTimes(filePath, failures);
      return {
        failureCount: failures.length,
        autoReloadAllowed: failures.length <= maxAutomaticReloads,
      };
    },

    clear() {
      try {
        fs.rmSync(filePath, { force: true });
      } catch {
        // Recovery metadata is best-effort only.
      }
    },
  };
}
