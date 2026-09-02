import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function atomicWriteJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

export function createRuntimeStateJournal({
  filePath,
  maxEvents = 100,
  now = Date.now,
  launchId = crypto.randomUUID(),
} = {}) {
  if (!filePath) throw new TypeError('Runtime state journal requires a file path');
  const existing = readJson(filePath);
  let events = Array.isArray(existing?.events) ? existing.events.slice(-maxEvents) : [];
  let lastStatus = existing?.lastStatus || null;

  const persist = () => {
    atomicWriteJson(filePath, {
      schemaVersion: 1,
      launchId,
      updatedAt: new Date(now()).toISOString(),
      lastStatus,
      events,
    });
  };

  return {
    recordStatus(status) {
      lastStatus = status ? { ...status } : null;
      events.push({
        at: new Date(now()).toISOString(),
        category: 'runtime',
        event: 'status_changed',
        status: status?.status || null,
        reasonCode: status?.reasonCode || null,
        pid: status?.pid || null,
        restartCount: status?.restartCount || 0,
        message: status?.message || '',
      });
      events = events.slice(-maxEvents);
      persist();
    },

    recordEvent(event, details = {}) {
      events.push({
        at: new Date(now()).toISOString(),
        category: 'desktop',
        event,
        ...details,
      });
      events = events.slice(-maxEvents);
      persist();
    },

    read() {
      return readJson(filePath);
    },
  };
}
