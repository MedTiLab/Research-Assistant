import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  readClaudeSessionPageFromFile,
  selectClaudeSessionTranscriptFiles,
} from '../projects.js';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(
    (directory) => fs.rm(directory, { recursive: true, force: true }),
  ));
});

describe('Claude session history fast path', () => {
  it('selects only the transcript named after the requested session', () => {
    expect(selectClaudeSessionTranscriptFiles([
      'session-a.jsonl',
      'session-b.jsonl',
      'agent-worker.jsonl',
    ], 'session-b')).toEqual(['session-b.jsonl']);

    expect(selectClaudeSessionTranscriptFiles([
      'legacy-one.jsonl',
      'legacy-two.jsonl',
    ], 'missing-session')).toEqual(['legacy-one.jsonl', 'legacy-two.jsonl']);
  });

  it('reads only the requested reverse page while preserving chronological order', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'medhelp-claude-history-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'session-a.jsonl');
    const lines = [
      { sessionId: 'session-a', timestamp: '2026-01-01T00:00:01Z', text: '一' },
      { sessionId: 'other', timestamp: '2026-01-01T00:00:02Z', text: 'skip' },
      { sessionId: 'session-a', timestamp: '2026-01-01T00:00:03Z', text: '二' },
      { sessionId: 'session-a', timestamp: '2026-01-01T00:00:04Z', text: '三' },
      { sessionId: 'session-a', timestamp: '2026-01-01T00:00:05Z', text: '四' },
    ];
    await fs.writeFile(filePath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

    await expect(readClaudeSessionPageFromFile(filePath, 'session-a', {
      limit: 2,
      offset: 1,
      chunkSize: 1024,
    })).resolves.toMatchObject({
      messages: [
        expect.objectContaining({ text: '二' }),
        expect.objectContaining({ text: '三' }),
      ],
      hasMore: true,
      offset: 1,
      limit: 2,
    });
  });
});
