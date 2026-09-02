import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMeetingTranscriptionService, dedupeTranscriptOverlap } from '../services/meetingTranscription.js';

let root;
let database;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'meeting-transcription-'));
  database = new Database(':memory:');
  database.exec(`
    CREATE TABLE meeting_transcript_segments (
      id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, user_id INTEGER NOT NULL,
      segment_index INTEGER NOT NULL, start_ms INTEGER, end_ms INTEGER,
      text TEXT, speaker TEXT, status TEXT, error TEXT, created_at TEXT, updated_at TEXT
    );
  `);
});

afterEach(async () => {
  database.close();
  await rm(root, { recursive: true, force: true });
});

describe('meeting transcription service', () => {
  it('processes chunks serially and preserves successful text per segment', async () => {
    let active = 0;
    let maxActive = 0;
    let transcriptionCount = 0;
    const client = {
      audio: { transcriptions: { create: async () => {
        active += 1; maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        transcriptionCount += 1;
        return { text: transcriptionCount === 1 ? '第一段转写内容' : '第二段转写内容' };
      } } },
    };
    const service = createMeetingTranscriptionService({ database, dataRoot: root, apiKey: () => 'test-key', createClient: () => client });
    const now = new Date().toISOString();
    const insert = database.prepare(`INSERT INTO meeting_transcript_segments VALUES (?, 'meeting_1', 1, ?, 0, 30000, '', NULL, 'pending', NULL, ?, ?)`);
    insert.run('segment_1', 0, now, now);
    insert.run('segment_2', 1, now, now);
    await service.saveChunk({ userId: 1, meetingId: 'meeting_1', segmentIndex: 0, buffer: Buffer.from('one') });
    await service.saveChunk({ userId: 1, meetingId: 'meeting_1', segmentIndex: 1, buffer: Buffer.from('two') });
    service.enqueue('segment_1', 'zh');
    service.enqueue('segment_2', 'zh');
    await service.waitForIdle();
    expect(maxActive).toBe(1);
    expect(database.prepare('SELECT status, text FROM meeting_transcript_segments ORDER BY segment_index').all())
      .toEqual([{ status: 'done', text: '第一段转写内容' }, { status: 'done', text: '第二段转写内容' }]);
  });

  it('removes repeated text introduced by the five-second segment overlap', () => {
    expect(dedupeTranscriptOverlap(
      '导师建议先完成分层分析，再检查缺失值。',
      '分层分析，再检查缺失值。然后更新结果表。',
    )).toBe('然后更新结果表。');
    expect(dedupeTranscriptOverlap('上一段完全不同', '这是新的内容')).toBe('这是新的内容');
  });

  it('returns a validated summary draft without writing to the database', async () => {
    const client = { chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify({ summary: '会议摘要', notes: [{ content: '导师建议补充分层分析', noteType: 'feedback', speaker: '导师' }], candidateActions: [{ content: '完成分层分析', dueDate: '2026-09-08' }] }) } }] }) } } };
    const service = createMeetingTranscriptionService({ database, dataRoot: root, apiKey: () => 'test-key', createClient: () => client });
    const before = database.prepare('SELECT COUNT(*) AS count FROM meeting_transcript_segments').get().count;
    const draft = await service.summarizeMeeting({
      title: '组会',
      transcriptSegments: [{ status: 'done', start_ms: 0, end_ms: 1000, speaker: '导师', text: '请补充分层分析' }],
      notes: [],
    });
    expect(draft).toEqual({
      summary: '会议摘要',
      notes: [{ content: '导师建议补充分层分析', noteType: 'feedback', speaker: '导师' }],
      candidateActions: [{ content: '完成分层分析', dueDate: '2026-09-08' }],
    });
    expect(database.prepare('SELECT COUNT(*) AS count FROM meeting_transcript_segments').get().count).toBe(before);
  });
});
