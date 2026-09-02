import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createRuntimeStateJournal } from './runtimeStateJournal.mjs';

const directories = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Runtime state journal', () => {
  it('persists the latest status and a bounded event history atomically', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'medhelp-runtime-journal-'));
    directories.push(directory);
    const filePath = path.join(directory, 'runtime-state.json');
    let time = Date.parse('2026-08-17T00:00:00.000Z');
    const journal = createRuntimeStateJournal({
      filePath,
      maxEvents: 2,
      launchId: 'launch-test',
      now: () => time,
    });

    journal.recordEvent('renderer_failed', { reason: 'crashed' });
    time += 1_000;
    journal.recordStatus({ status: 'starting', reasonCode: 'cold-start', pid: null });
    time += 1_000;
    journal.recordStatus({ status: 'running', reasonCode: 'healthy', pid: 55 });

    expect(journal.read()).toMatchObject({
      launchId: 'launch-test',
      lastStatus: { status: 'running', pid: 55 },
      events: [
        { event: 'status_changed', status: 'starting' },
        { event: 'status_changed', status: 'running', pid: 55 },
      ],
    });
    expect(fs.readdirSync(directory).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
